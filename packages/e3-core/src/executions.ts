/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Generic task execution APIs for e3 repositories.
 *
 * Provides storage-agnostic APIs for:
 * - Computing execution identity (inputsHash)
 * - Querying execution status and results
 * - Reading execution logs
 * - Evaluating command IR
 *
 * Note: Local process execution is in execution/LocalTaskRunner.ts
 */

import { decodeBeast2For, EastIR, IRType } from '@elaraai/east';
import type { FunctionIR } from '@elaraai/east';
import type { ExecutionStatus } from '@elaraai/e3-types';
import type { StorageBackend, LogChunk } from './storage/interfaces.js';
import { computeHash } from './objects.js';

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

// ============================================================================
// Execution Status
// ============================================================================

/**
 * Get execution status for a specific execution.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @param executionId - Execution ID (UUIDv7)
 * @returns ExecutionStatus or null if execution doesn't exist
 * @throws {ExecutionCorruptError} If status file exists but cannot be decoded
 */
export async function executionGet(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string,
  executionId: string
): Promise<ExecutionStatus | null> {
  return storage.refs.executionGet(repo, taskHash, inHash, executionId);
}

/**
 * Get the latest execution status (lexicographically greatest executionId).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @returns ExecutionStatus or null if no executions exist
 */
export async function executionGetLatest(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string
): Promise<ExecutionStatus | null> {
  return storage.refs.executionGetLatest(repo, taskHash, inHash);
}

/**
 * Get the latest successful output hash for a completed execution.
 * This is the primary cache lookup function.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @returns Output hash or null if no successful execution exists
 */
export async function executionGetOutput(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string
): Promise<string | null> {
  return storage.refs.executionGetLatestOutput(repo, taskHash, inHash);
}

/**
 * List all execution IDs for a (taskHash, inputsHash) pair.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @returns Array of execution IDs (sorted lexicographically ascending)
 */
export async function executionListIds(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string
): Promise<string[]> {
  return storage.refs.executionListIds(repo, taskHash, inHash);
}

/**
 * List all input hashes that have executions for a given task.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param taskHash - Hash of the task object
 * @returns Array of input hashes
 */
export async function executionListForTask(
  storage: StorageBackend,
  repo: string,
  taskHash: string
): Promise<string[]> {
  return storage.refs.executionListForTask(repo, taskHash);
}

/**
 * List all executions in the repository.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @returns Array of { taskHash, inputsHash } objects
 */
export async function executionList(
  storage: StorageBackend,
  repo: string
): Promise<Array<{ taskHash: string; inputsHash: string }>> {
  return storage.refs.executionList(repo);
}

/**
 * Result of finding the current execution for a task
 */
export interface CurrentExecutionRef {
  /** Hash of the task object */
  taskHash: string;
  /** Combined hash of input hashes */
  inputsHash: string;
  /** Execution ID (UUIDv7) */
  executionId: string;
  /** True if this matches the current workspace input state */
  isCurrent: boolean;
}

/**
 * Find the execution reference for a task in a workspace.
 *
 * This looks up the task's current input hashes from the workspace state
 * and finds the matching execution. If no execution exists for the current
 * inputs, falls back to the most recent execution.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param ws - Workspace name
 * @param taskName - Task name
 * @returns Execution reference or null if no executions exist
 */
export async function executionFindCurrent(
  storage: StorageBackend,
  repo: string,
  ws: string,
  taskName: string
): Promise<CurrentExecutionRef | null> {
  // Import here to avoid circular dependency
  const { workspaceGetTaskHash, workspaceGetTask } = await import('./tasks.js');
  const { workspaceGetDatasetHash } = await import('./trees.js');

  const taskHash = await workspaceGetTaskHash(storage, repo, ws, taskName);
  const task = await workspaceGetTask(storage, repo, ws, taskName);

  // Get the current input hashes from the workspace
  const currentInputHashes: string[] = [];
  let allInputsAssigned = true;

  for (const inputPath of task.inputs) {
    const { refType, hash } = await workspaceGetDatasetHash(storage, repo, ws, inputPath);
    if (refType !== 'value' || hash === null) {
      allInputsAssigned = false;
      break;
    }
    currentInputHashes.push(hash);
  }

  const executions = await executionListForTask(storage, repo, taskHash);

  if (allInputsAssigned) {
    const inHash = inputsHash(currentInputHashes);
    if (executions.includes(inHash)) {
      // Get the latest execution status to get the executionId
      const status = await storage.refs.executionGetLatest(repo, taskHash, inHash);
      if (status) {
        // Extract executionId from the status (all variants have it)
        const executionId = status.value.executionId;
        return { taskHash, inputsHash: inHash, executionId, isCurrent: true };
      }
    }
  }

  // Fall back to most recent execution
  if (executions.length > 0) {
    const inHash = executions[0]!;
    const status = await storage.refs.executionGetLatest(repo, taskHash, inHash);
    if (status) {
      const executionId = status.value.executionId;
      return { taskHash, inputsHash: inHash, executionId, isCurrent: false };
    }
  }

  return null;
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

// Re-export LogChunk from storage interfaces for backwards compatibility
export type { LogChunk };

/**
 * Read execution logs with pagination support.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param taskHash - Hash of the task object
 * @param inHash - Combined hash of input hashes
 * @param executionId - Execution ID (UUIDv7)
 * @param stream - Which log stream to read ('stdout' or 'stderr')
 * @param options - Pagination options
 * @returns Log chunk with data and metadata
 */
export async function executionReadLog(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string,
  executionId: string,
  stream: 'stdout' | 'stderr',
  options: LogReadOptions = {}
): Promise<LogChunk> {
  return storage.logs.read(repo, taskHash, inHash, executionId, stream, options);
}

// ============================================================================
// Command IR Evaluation
// ============================================================================

/**
 * Evaluate command IR to get exec args.
 *
 * The IR is an East function: (inputs: Array<String>, output: String) -> Array<String>
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param commandIrHash - Hash of the IR object
 * @param inputPaths - Paths to staged input files
 * @param outputPath - Path where output should be written
 * @returns Array of strings to exec
 */
export async function evaluateCommandIr(
  storage: StorageBackend,
  repo: string,
  commandIrHash: string,
  inputPaths: string[],
  outputPath: string
): Promise<string[]> {
  const irData = await storage.objects.read(repo, commandIrHash);

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
