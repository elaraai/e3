/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local task execution for e3 repositories.
 *
 * This module handles all local process-specific execution:
 * - Creating temporary scratch directories for task I/O
 * - Spawning runner processes (east-node, east-py, julia)
 * - Capturing stdout/stderr and persisting to logs
 * - Process lifecycle management (signals, timeouts, cleanup)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { decodeBeast2For, variant } from '@elaraai/east';
import { type ExecutionStatus, TaskObjectType, type TaskObject } from '@elaraai/e3-types';
import { inputsHash, evaluateCommandIr } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { TaskRunner, TaskExecuteOptions, TaskResult } from './interfaces.js';
import { getBootId, getPidStartTime } from './processHelpers.js';

/**
 * Options for task execution
 */
export interface ExecuteOptions {
  /** Re-run even if cached (default: false) */
  force?: boolean;
  /** Timeout in milliseconds (default: none) */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
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
  /** Execution ID (UUIDv7) */
  executionId: string;
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
 * TaskRunner implementation for local process execution.
 *
 * Spawns runner processes locally to execute tasks.
 * Used by the local CLI and e3-api-server for task execution.
 */
export class LocalTaskRunner implements TaskRunner {
  constructor(private readonly repo: string) {}

  async execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    const result = await taskExecute(storage, this.repo, taskHash, inputHashes, {
      force: options?.force,
      signal: options?.signal,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });

    // Convert ExecutionResult to TaskResult
    const taskResult: TaskResult = {
      state: result.state,
      cached: result.cached,
      executionId: result.executionId,
    };

    if (result.state === 'success' && result.outputHash) {
      taskResult.outputHash = result.outputHash;
    } else if (result.state === 'failed') {
      taskResult.exitCode = result.exitCode ?? undefined;
    } else if (result.state === 'error') {
      taskResult.error = result.error ?? undefined;
    }

    return taskResult;
  }
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
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param taskHash - Hash of the task object
 * @param inputHashes - Array of input dataset hashes
 * @param options - Execution options
 * @returns Execution result
 */
export async function taskExecute(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inputHashes: string[],
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const inHash = inputsHash(inputHashes);
  const startTime = Date.now();

  // Step 1: Check cache (unless force)
  if (!options.force) {
    const existingOutput = await storage.refs.executionGetLatestOutput(repo, taskHash, inHash);
    if (existingOutput !== null) {
      const status = await storage.refs.executionGetLatest(repo, taskHash, inHash);
      if (status && status.type === 'success') {
        return {
          inputsHash: inHash,
          executionId: status.value.executionId,
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

  // Step 2: Generate a new execution ID
  const executionId = uuidv7();

  // Step 3: Read task object
  let task: TaskObject;
  try {
    const taskData = await storage.objects.read(repo, taskHash);
    const decoder = decodeBeast2For(TaskObjectType);
    task = decoder(Buffer.from(taskData));
  } catch (err) {
    // Record error with executionId for audit trail
    const status: ExecutionStatus = variant('error', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      message: `Failed to read task object: ${err}`,
    });
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

    return {
      inputsHash: inHash,
      executionId,
      cached: false,
      state: 'error',
      outputHash: null,
      exitCode: null,
      duration: Date.now() - startTime,
      error: `Failed to read task object: ${err}`,
    };
  }

  // Step 4: Create scratch directory
  // Include PID to prevent collisions when multiple e3 processes run the same
  // task concurrently (e.g., same task in different workspaces at same millisecond)
  const scratchDir = path.join(
    tmpdir(),
    `e3-exec-${taskHash.slice(0, 8)}-${inHash.slice(0, 8)}-${process.pid}-${Date.now()}`
  );
  await fs.mkdir(scratchDir, { recursive: true });

  try {
    // Step 5: Marshal inputs to scratch dir
    const inputPaths: string[] = [];
    for (let i = 0; i < inputHashes.length; i++) {
      const inputPath = path.join(scratchDir, `input-${i}.beast2`);
      const inputData = await storage.objects.read(repo, inputHashes[i]!);
      await fs.writeFile(inputPath, inputData);
      inputPaths.push(inputPath);
    }

    // Step 6: Evaluate command IR to get exec args
    const outputPath = path.join(scratchDir, 'output.beast2');
    let args: string[];
    try {
      args = await evaluateCommandIr(storage, repo, task.commandIr, inputPaths, outputPath);
    } catch (err) {
      const status: ExecutionStatus = variant('error', {
        executionId,
        inputHashes,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        message: `Failed to evaluate command IR: ${err}`,
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

      return {
        inputsHash: inHash,
        executionId,
        cached: false,
        state: 'error',
        outputHash: null,
        exitCode: null,
        duration: Date.now() - startTime,
        error: `Failed to evaluate command IR: ${err}`,
      };
    }

    if (args.length === 0) {
      const status: ExecutionStatus = variant('error', {
        executionId,
        inputHashes,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        message: 'Command IR produced empty command',
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

      return {
        inputsHash: inHash,
        executionId,
        cached: false,
        state: 'error',
        outputHash: null,
        exitCode: null,
        duration: Date.now() - startTime,
        error: 'Command IR produced empty command',
      };
    }

    // Step 7: Get boot ID for crash detection
    const bootId = await getBootId();

    // Step 8: Execute command
    const result = await runCommand(
      storage,
      repo,
      taskHash,
      inHash,
      executionId,
      args,
      inputHashes,
      bootId,
      options
    );

    // Step 9: Handle result
    if (result.exitCode === 0) {
      // Success - read and store output
      try {
        const outputData = await fs.readFile(outputPath);
        const outputHash = await storage.objects.write(repo, outputData);

        // Write success status (output is stored within status.beast2's directory)
        const status: ExecutionStatus = variant('success', {
          executionId,
          inputHashes,
          outputHash,
          startedAt: new Date(startTime),
          completedAt: new Date(),
        });
        await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

        return {
          inputsHash: inHash,
          executionId,
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
          executionId,
          inputHashes,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          message: `Failed to read output: ${err}`,
        });
        await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

        return {
          inputsHash: inHash,
          executionId,
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
        executionId,
        inputHashes,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        exitCode: BigInt(result?.exitCode ?? -1),
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

      return {
        inputsHash: inHash,
        executionId,
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
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string,
  executionId: string,
  args: string[],
  inputHashes: string[],
  bootId: string,
  options: ExecuteOptions
): Promise<{ exitCode: number | null; error: string | null }> {
  const [cmd, ...cmdArgs] = args;

  // Process Lifecycle Management
  // ============================
  // We use detached: true to create a new process group, allowing us to kill
  // the entire process tree by signaling the negative PID (process group leader).
  //
  // LIMITATION: Process groups are flat, not hierarchical. If a task spawns a
  // subprocess that creates its own process group (via setsid, daemonization,
  // or another detached spawn), that subprocess will escape our kill signal.
  // This is a fundamental Unix limitation - process groups were designed for
  // terminal job control (Ctrl+C/Ctrl+Z), not process tree management.
  //
  // For most tasks (shell scripts, pipelines, normal child processes) this works
  // fine. A task would have to intentionally call setsid() to escape.
  //
  // Potential improvements for hosted e3:
  // - Linux cgroups: Hierarchical containment with no escape. Requires root or
  //   systemd integration (systemd-run --scope). Used by Docker/Kubernetes.
  // - PR_SET_CHILD_SUBREAPER: Makes e3 adopt orphaned processes instead of init,
  //   allowing tracking and cleanup. Requires polling to detect orphans.
  // - Firecracker/microVMs: Complete isolation with hardware virtualization.
  //   The VM boundary provides bulletproof containment. Best for multi-tenant.
  const child = spawn(cmd, cmdArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
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

  // Use promise chains to ensure sequential log writes without overlapping
  let stdoutWriteChain = Promise.resolve();
  let stderrWriteChain = Promise.resolve();

  // Tee stdout - use storage.logs.append for log persistence
  child.stdout?.on('data', (data: Buffer) => {
    const str = data.toString('utf-8');
    // Chain writes sequentially to avoid overlapping
    stdoutWriteChain = stdoutWriteChain.then(async () => {
      try {
        await storage.logs.append(repo, taskHash, inHash, executionId, 'stdout', str);
      } catch (err) {
        console.warn(`Failed to append stdout log: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    if (options.onStdout) {
      options.onStdout(str);
    }
  });

  // Tee stderr - use storage.logs.append for log persistence
  child.stderr?.on('data', (data: Buffer) => {
    const str = data.toString('utf-8');
    // Chain writes sequentially to avoid overlapping
    stderrWriteChain = stderrWriteChain.then(async () => {
      try {
        await storage.logs.append(repo, taskHash, inHash, executionId, 'stderr', str);
      } catch (err) {
        console.warn(`Failed to append stderr log: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    if (options.onStderr) {
      options.onStderr(str);
    }
  });

  // Helper to kill the entire process group (child and all its descendants).
  // With detached: true, child.pid is the process group leader, so killing
  // -child.pid sends the signal to all processes in that group.
  const killProcessGroup = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Process may have already exited
      }
    }
  };

  // Handle timeout
  let timeoutId: NodeJS.Timeout | undefined;
  if (options.timeout) {
    timeoutId = setTimeout(killProcessGroup, options.timeout);
  }

  // Handle abort signal
  if (options.signal) {
    if (options.signal.aborted) {
      // Already aborted before we started
      killProcessGroup();
    } else {
      options.signal.addEventListener('abort', killProcessGroup, { once: true });
    }
  }

  // Write running status with actual child PID
  const pidStartTime = await getPidStartTime(child.pid!);
  const status: ExecutionStatus = variant('running', {
    executionId,
    inputHashes,
    startedAt: new Date(),
    pid: BigInt(child.pid ?? -1),
    pidStartTime: BigInt(pidStartTime ?? -1),
    bootId,
  });
  await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

  // Wait for process to complete
  const result = await resultPromise;

  // Wait for any pending log writes to complete
  await Promise.all([stdoutWriteChain, stderrWriteChain]);

  // Cleanup
  if (timeoutId) clearTimeout(timeoutId);
  if (options.signal) {
    options.signal.removeEventListener('abort', killProcessGroup);
  }

  return result;
}
