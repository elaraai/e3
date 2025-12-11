/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task execution for e3 repositories.
 *
 * Provides APIs for:
 * - Computing execution identity (inputsHash)
 * - Querying execution status and results
 * - Reading execution logs
 * - Running tasks with caching
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { decodeBeast2For, encodeBeast2For, variant, EastIR, IRType } from '@elaraai/east';
import type { FunctionIR } from '@elaraai/east';
import {
  ExecutionStatusType,
  type ExecutionStatus,
  TaskObjectType,
  type TaskObject,
} from '@elaraai/e3-types';
import { computeHash, objectRead, objectWrite } from './objects.js';

// ============================================================================
// Execution Identity
// ============================================================================

/**
 * Compute the combined hash of input hashes.
 *
 * Used to create a unique identifier for an execution based on its inputs.
 * The order of inputs matters - different orderings produce different hashes.
 *
 * @param inputHashes - Array of input dataset hashes
 * @returns Combined SHA256 hash
 */
export function inputsHash(inputHashes: string[]): string {
  const data = inputHashes.join('\0');
  return computeHash(new TextEncoder().encode(data));
}

/**
 * Get the filesystem path for an execution directory.
 *
 * @param repoPath - Path to .e3 repository
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @returns Path to execution directory: executions/<taskHash>/<inputsHash>/
 */
export function executionPath(
  repoPath: string,
  taskHash: string,
  inHash: string
): string {
  return path.join(repoPath, 'executions', taskHash, inHash);
}

// ============================================================================
// Execution Status
// ============================================================================

/**
 * Get execution status.
 *
 * @param repoPath - Path to .e3 repository
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @returns ExecutionStatus or null if execution doesn't exist
 */
export async function executionGet(
  repoPath: string,
  taskHash: string,
  inHash: string
): Promise<ExecutionStatus | null> {
  const execDir = executionPath(repoPath, taskHash, inHash);
  const statusPath = path.join(execDir, 'status.beast2');

  try {
    const data = await fs.readFile(statusPath);
    const decoder = decodeBeast2For(ExecutionStatusType);
    return decoder(data);
  } catch {
    return null;
  }
}

/**
 * Get output hash for a completed execution.
 *
 * @param repoPath - Path to .e3 repository
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @returns Output hash or null if not complete or failed
 */
export async function executionGetOutput(
  repoPath: string,
  taskHash: string,
  inHash: string
): Promise<string | null> {
  const execDir = executionPath(repoPath, taskHash, inHash);
  const outputPath = path.join(execDir, 'output');

  try {
    const content = await fs.readFile(outputPath, 'utf-8');
    return content.trim();
  } catch {
    return null;
  }
}

/**
 * List all input hashes that have executions for a given task.
 *
 * @param repoPath - Path to .e3 repository
 * @param taskHash - Hash of the task object
 * @returns Array of input hashes
 */
export async function executionListForTask(
  repoPath: string,
  taskHash: string
): Promise<string[]> {
  const taskDir = path.join(repoPath, 'executions', taskHash);

  try {
    const entries = await fs.readdir(taskDir);
    // Filter to only valid hash directories (64 hex chars)
    return entries.filter((e) => /^[a-f0-9]{64}$/.test(e));
  } catch {
    return [];
  }
}

/**
 * List all executions in the repository.
 *
 * @param repoPath - Path to .e3 repository
 * @returns Array of { taskHash, inputsHash } objects
 */
export async function executionList(
  repoPath: string
): Promise<Array<{ taskHash: string; inputsHash: string }>> {
  const executionsDir = path.join(repoPath, 'executions');
  const result: Array<{ taskHash: string; inputsHash: string }> = [];

  try {
    const taskDirs = await fs.readdir(executionsDir);

    for (const taskHash of taskDirs) {
      if (!/^[a-f0-9]{64}$/.test(taskHash)) continue;

      const taskDir = path.join(executionsDir, taskHash);
      const stat = await fs.stat(taskDir);
      if (!stat.isDirectory()) continue;

      const inputsDirs = await fs.readdir(taskDir);
      for (const inputsHash of inputsDirs) {
        if (/^[a-f0-9]{64}$/.test(inputsHash)) {
          result.push({ taskHash, inputsHash });
        }
      }
    }
  } catch {
    // Executions directory doesn't exist
  }

  return result;
}

// ============================================================================
// Log Reading
// ============================================================================

/**
 * Options for reading execution logs
 */
export interface LogReadOptions {
  /** Byte offset to start reading from (default: 0) */
  offset?: number;
  /** Maximum bytes to read (default: 64KB) */
  limit?: number;
}

/**
 * Result of reading a log chunk
 */
export interface LogChunk {
  /** Log content (UTF-8) */
  data: string;
  /** Byte offset of this chunk */
  offset: number;
  /** Bytes in this chunk */
  size: number;
  /** Total log file size (for pagination) */
  totalSize: number;
  /** True if this is the end of the file */
  complete: boolean;
}

/**
 * Read execution logs with pagination support.
 *
 * @param repoPath - Path to .e3 repository
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @param stream - Which log stream to read ('stdout' or 'stderr')
 * @param options - Pagination options
 * @returns Log chunk with data and metadata
 */
export async function executionReadLog(
  repoPath: string,
  taskHash: string,
  inHash: string,
  stream: 'stdout' | 'stderr',
  options: LogReadOptions = {}
): Promise<LogChunk> {
  const execDir = executionPath(repoPath, taskHash, inHash);
  const logPath = path.join(execDir, `${stream}.txt`);

  const offset = options.offset ?? 0;
  const limit = options.limit ?? 65536; // 64KB default

  try {
    const stat = await fs.stat(logPath);
    const totalSize = stat.size;

    // Open file and read chunk
    const fd = await fs.open(logPath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(limit, totalSize - offset));
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, offset);

      return {
        data: buffer.slice(0, bytesRead).toString('utf-8'),
        offset,
        size: bytesRead,
        totalSize,
        complete: offset + bytesRead >= totalSize,
      };
    } finally {
      await fd.close();
    }
  } catch {
    // Log file doesn't exist yet
    return {
      data: '',
      offset: 0,
      size: 0,
      totalSize: 0,
      complete: true,
    };
  }
}

// ============================================================================
// Command IR Evaluation
// ============================================================================

/**
 * Evaluate command IR to get exec args.
 *
 * The IR is an East function: (inputs: Array<String>, output: String) -> Array<String>
 *
 * @param repoPath - Path to .e3 repository
 * @param commandIrHash - Hash of the IR object
 * @param inputPaths - Paths to staged input files
 * @param outputPath - Path where output should be written
 * @returns Array of strings to exec
 */
export async function evaluateCommandIr(
  repoPath: string,
  commandIrHash: string,
  inputPaths: string[],
  outputPath: string
): Promise<string[]> {
  const irData = await objectRead(repoPath, commandIrHash);

  try {
    // Decode the IR from beast2 format
    const decoder = decodeBeast2For(IRType);
    const ir = decoder(Buffer.from(irData)) as FunctionIR;

    // Create EastIR wrapper and compile it (no platform functions needed)
    const eastIr = new EastIR<[string[], string], string[]>(ir);
    const compiledFn = eastIr.compile([]);

    // Execute the compiled function with inputPaths and outputPath
    const result = compiledFn(inputPaths, outputPath);

    // Validate result is an array of strings
    if (!Array.isArray(result)) {
      throw new Error(`Command IR returned ${typeof result}, expected array`);
    }
    for (const item of result) {
      if (typeof item !== 'string') {
        throw new Error(`Command IR returned array containing ${typeof item}, expected strings`);
      }
    }

    return result;
  } catch (err) {
    throw new Error(`Failed to evaluate command IR: ${err}`);
  }
}

// ============================================================================
// Process Identification (for crash detection)
// ============================================================================

/**
 * Get the current system boot ID
 */
async function getBootId(): Promise<string> {
  try {
    const data = await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf-8');
    return data.trim();
  } catch {
    // Not on Linux, use a placeholder
    return 'unknown-boot-id';
  }
}

/**
 * Get process start time from /proc/<pid>/stat
 * Returns the starttime field (field 22) which is jiffies since boot
 */
async function getPidStartTime(pid: number): Promise<number> {
  try {
    const data = await fs.readFile(`/proc/${pid}/stat`, 'utf-8');
    // Fields are space-separated, but comm (field 2) can contain spaces and is in parens
    // Find the closing paren, then split the rest
    const closeParen = data.lastIndexOf(')');
    const fields = data.slice(closeParen + 2).split(' ');
    // After the closing paren, field index 0 is state (field 3), so starttime is at index 19
    // (field 22 - 3 = 19)
    return parseInt(fields[19], 10);
  } catch {
    return 0;
  }
}

/**
 * Check if a process is still alive based on stored identification
 */
export async function isProcessAlive(
  pid: number,
  pidStartTime: number,
  bootId: string
): Promise<boolean> {
  // Different boot? Process is dead
  const currentBootId = await getBootId();
  if (currentBootId !== bootId) return false;

  // Check if PID exists and has same start time
  const currentStartTime = await getPidStartTime(pid);
  if (currentStartTime === 0) return false; // PID doesn't exist
  if (currentStartTime !== pidStartTime) return false; // PID reused

  return true;
}

// ============================================================================
// Task Execution
// ============================================================================

/**
 * Options for task execution
 */
export interface ExecuteOptions {
  /** Re-run even if cached (default: false) */
  force?: boolean;
  /** Timeout in milliseconds (default: none) */
  timeout?: number;
  /** Stream stdout callback */
  onStdout?: (data: string) => void;
  /** Stream stderr callback */
  onStderr?: (data: string) => void;
}

/**
 * Result of task execution
 */
export interface ExecutionResult {
  /** Combined inputs hash (identifies this execution) */
  inputsHash: string;
  /** True if result was from cache */
  cached: boolean;
  /** Final state */
  state: 'success' | 'failed' | 'error';
  /** Output dataset hash (null on failure) */
  outputHash: string | null;
  /** Process exit code (null if not applicable) */
  exitCode: number | null;
  /** Execution time in ms (0 if cached) */
  duration: number;
  /** Error message on failure */
  error: string | null;
}

/**
 * Execute a single task.
 *
 * This is the core execution primitive. It:
 * 1. Computes the execution identity from task + inputs
 * 2. Checks cache (unless force=true)
 * 3. Marshals inputs to a scratch directory
 * 4. Evaluates command IR to get exec args
 * 5. Runs the command
 * 6. Stores the output and updates status
 *
 * @param repoPath - Path to .e3 repository
 * @param taskHash - Hash of the task object
 * @param inputHashes - Array of input dataset hashes
 * @param options - Execution options
 * @returns Execution result
 */
export async function taskExecute(
  repoPath: string,
  taskHash: string,
  inputHashes: string[],
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const inHash = inputsHash(inputHashes);
  const execDir = executionPath(repoPath, taskHash, inHash);
  const startTime = Date.now();

  // Step 1: Check cache (unless force)
  if (!options.force) {
    const existingOutput = await executionGetOutput(repoPath, taskHash, inHash);
    if (existingOutput !== null) {
      const status = await executionGet(repoPath, taskHash, inHash);
      if (status && status.type === 'success') {
        return {
          inputsHash: inHash,
          cached: true,
          state: 'success',
          outputHash: existingOutput,
          exitCode: 0,
          duration: 0,
          error: null,
        };
      }
    }
  }

  // Step 2: Read task object
  let task: TaskObject;
  try {
    const taskData = await objectRead(repoPath, taskHash);
    const decoder = decodeBeast2For(TaskObjectType);
    task = decoder(Buffer.from(taskData));
  } catch (err) {
    return {
      inputsHash: inHash,
      cached: false,
      state: 'error',
      outputHash: null,
      exitCode: null,
      duration: Date.now() - startTime,
      error: `Failed to read task object: ${err}`,
    };
  }

  // Step 3: Create scratch directory
  const scratchDir = path.join(
    tmpdir(),
    `e3-exec-${taskHash.slice(0, 8)}-${inHash.slice(0, 8)}-${Date.now()}`
  );
  await fs.mkdir(scratchDir, { recursive: true });

  try {
    // Step 4: Marshal inputs to scratch dir
    const inputPaths: string[] = [];
    for (let i = 0; i < inputHashes.length; i++) {
      const inputPath = path.join(scratchDir, `input-${i}.beast2`);
      const inputData = await objectRead(repoPath, inputHashes[i]);
      await fs.writeFile(inputPath, inputData);
      inputPaths.push(inputPath);
    }

    // Step 5: Evaluate command IR to get exec args
    const outputPath = path.join(scratchDir, 'output.beast2');
    let args: string[];
    try {
      args = await evaluateCommandIr(repoPath, task.commandIr, inputPaths, outputPath);
    } catch (err) {
      return {
        inputsHash: inHash,
        cached: false,
        state: 'error',
        outputHash: null,
        exitCode: null,
        duration: Date.now() - startTime,
        error: `Failed to evaluate command IR: ${err}`,
      };
    }

    if (args.length === 0) {
      return {
        inputsHash: inHash,
        cached: false,
        state: 'error',
        outputHash: null,
        exitCode: null,
        duration: Date.now() - startTime,
        error: 'Command IR produced empty command',
      };
    }

    // Step 6: Create execution directory
    await fs.mkdir(execDir, { recursive: true });

    // Step 7: Get boot ID for crash detection
    const bootId = await getBootId();

    // Step 8: Execute command
    const result = await runCommand(
      args,
      execDir,
      inputHashes,
      bootId,
      options
    );

    // Step 9: Handle result
    if (result.exitCode === 0) {
      // Success - read and store output
      try {
        const outputData = await fs.readFile(outputPath);
        const outputHash = await objectWrite(repoPath, outputData);

        // Write output ref
        await fs.writeFile(path.join(execDir, 'output'), outputHash + '\n');

        // Write success status
        const status: ExecutionStatus = variant('success', {
          inputHashes,
          outputHash,
          startedAt: new Date(startTime),
          completedAt: new Date(),
        });
        const encoder = encodeBeast2For(ExecutionStatusType);
        await fs.writeFile(path.join(execDir, 'status.beast2'), encoder(status));

        return {
          inputsHash: inHash,
          cached: false,
          state: 'success',
          outputHash,
          exitCode: 0,
          duration: Date.now() - startTime,
          error: null,
        };
      } catch (err) {
        // Output file missing or unreadable
        const status: ExecutionStatus = variant('error', {
          inputHashes,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          message: `Failed to read output: ${err}`,
        });
        const encoder = encodeBeast2For(ExecutionStatusType);
        await fs.writeFile(path.join(execDir, 'status.beast2'), encoder(status));

        return {
          inputsHash: inHash,
          cached: false,
          state: 'error',
          outputHash: null,
          exitCode: 0,
          duration: Date.now() - startTime,
          error: `Failed to read output: ${err}`,
        };
      }
    } else {
      // Failed - write failed status
      const status: ExecutionStatus = variant('failed', {
        inputHashes,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        exitCode: BigInt(result.exitCode ?? -1),
      });
      const encoder = encodeBeast2For(ExecutionStatusType);
      await fs.writeFile(path.join(execDir, 'status.beast2'), encoder(status));

      return {
        inputsHash: inHash,
        cached: false,
        state: 'failed',
        outputHash: null,
        exitCode: result.exitCode,
        duration: Date.now() - startTime,
        error: result.error,
      };
    }
  } finally {
    // Cleanup scratch directory
    try {
      await fs.rm(scratchDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run a command and capture output
 */
async function runCommand(
  args: string[],
  execDir: string,
  inputHashes: string[],
  bootId: string,
  options: ExecuteOptions
): Promise<{ exitCode: number | null; error: string | null }> {
  const [cmd, ...cmdArgs] = args;

  const child = spawn(cmd, cmdArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Set up event listeners IMMEDIATELY before any async work
  // to avoid missing events if the process completes quickly
  const resultPromise = new Promise<{ exitCode: number | null; error: string | null }>((resolve) => {
    child.on('error', (err) => {
      resolve({ exitCode: null, error: `Failed to spawn: ${err.message}` });
    });

    child.on('close', (code) => {
      resolve({ exitCode: code, error: code !== 0 ? `Exit code: ${code}` : null });
    });
  });

  // Open log files for writing
  const stdoutStream = createWriteStream(path.join(execDir, 'stdout.txt'));
  const stderrStream = createWriteStream(path.join(execDir, 'stderr.txt'));

  // Tee stdout
  child.stdout?.on('data', (data: Buffer) => {
    stdoutStream.write(data);
    if (options.onStdout) {
      options.onStdout(data.toString('utf-8'));
    }
  });

  // Tee stderr
  child.stderr?.on('data', (data: Buffer) => {
    stderrStream.write(data);
    if (options.onStderr) {
      options.onStderr(data.toString('utf-8'));
    }
  });

  // Handle timeout
  let timeoutId: NodeJS.Timeout | undefined;
  if (options.timeout) {
    timeoutId = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeout);
  }

  // Write running status with actual child PID (can be async now)
  const pidStartTime = await getPidStartTime(child.pid!);
  const status: ExecutionStatus = variant('running', {
    inputHashes,
    startedAt: new Date(),
    pid: BigInt(child.pid!),
    pidStartTime: BigInt(pidStartTime),
    bootId,
  });
  const encoder = encodeBeast2For(ExecutionStatusType);
  await fs.writeFile(path.join(execDir, 'status.beast2'), encoder(status));

  // Wait for process to complete
  const result = await resultPromise;

  // Cleanup
  if (timeoutId) clearTimeout(timeoutId);
  stdoutStream.end();
  stderrStream.end();

  return result;
}
