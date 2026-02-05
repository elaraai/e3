/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Storage abstraction interfaces for e3 repositories.
 *
 * These interfaces enable e3-core logic to work against different backends:
 * - LocalBackend: Filesystem (default, for CLI and local dev)
 * - EfsBackend: AWS EFS (for Lambda/Fargate cloud deployment)
 * - S3DynamoBackend: S3 + DynamoDB (future optimization)
 *
 * The core insight: e3-core business logic is storage-agnostic. By injecting
 * a StorageBackend, the same code can run locally or in the cloud.
 */

import type { ExecutionStatus, LockState, LockOperation, DataflowRun } from '@elaraai/e3-types';
import type { LockHolderInfo } from '../errors.js';

// Re-export lock types for consumers of this module
export type { LockState, LockOperation, LockHolderInfo };

// =============================================================================
// Repository Lifecycle Types
// =============================================================================

/**
 * Repository status for lifecycle tracking.
 *
 * - 'creating': Repository is being initialized
 * - 'active': Repository is ready for use
 * - 'gc': Garbage collection is in progress
 * - 'deleting': Repository is being deleted
 */
export type RepoStatus = 'creating' | 'active' | 'gc' | 'deleting';

/**
 * Repository metadata.
 */
export interface RepoMetadata {
  /** Repository name */
  name: string;
  /** Current status */
  status: RepoStatus;
  /** When the repository was created (ISO 8601) */
  createdAt: string;
  /** When the status last changed (ISO 8601) */
  statusChangedAt: string;
}

/**
 * Result from batch operations (resumable pattern).
 *
 * Operations return { status: 'continue', cursor } if more work remains,
 * or { status: 'done' } when complete. This enables Step Functions orchestration.
 */
export interface BatchResult {
  /** 'continue' if more batches remain, 'done' if complete */
  status: 'continue' | 'done';
  /** Opaque cursor for next batch (only present if status='continue') */
  cursor?: string;
  /** Number of items deleted in this batch */
  deleted: number;
}

/**
 * Result from GC mark phase.
 */
export interface GcMarkResult {
  /** Number of reachable objects found */
  reachableCount: number;
  /** Number of root references traced */
  rootCount: number;
  /** Opaque reference to the reachable set (memory ID for local, S3 key for cloud) */
  reachableSetRef: string;
}

/**
 * Result from GC sweep phase.
 */
export interface GcSweepResult {
  /** 'continue' if more batches remain, 'done' if complete */
  status: 'continue' | 'done';
  /** Opaque cursor for next batch (only present if status='continue') */
  cursor?: string;
  /** Number of objects deleted in this batch */
  deleted: number;
  /** Total bytes freed in this batch */
  bytesFreed: number;
  /** Number of objects skipped due to being too young */
  skippedYoung: number;
}

// =============================================================================
// Object Store
// =============================================================================

/**
 * Content-addressed object storage.
 *
 * Objects are immutable and identified by their SHA256 hash.
 * The store handles deduplication automatically.
 *
 * All methods take `repo` as first parameter to identify the repository.
 * For local storage, `repo` is the path to the e3 repository directory.
 * For cloud storage, `repo` is a repository identifier used as a key prefix.
 */
export interface ObjectStore {
  /**
   * Write data to the object store.
   * @param repo - Repository identifier
   * @param data - Raw bytes to store
   * @returns SHA256 hash of the data
   */
  write(repo: string, data: Uint8Array): Promise<string>;

  /**
   * Write data from a stream to the object store.
   * @param repo - Repository identifier
   * @param stream - Async iterable of chunks
   * @returns SHA256 hash of the data
   */
  writeStream(repo: string, stream: AsyncIterable<Uint8Array>): Promise<string>;

  /**
   * Read an object by hash.
   * @param repo - Repository identifier
   * @param hash - SHA256 hash of the object
   * @returns Raw bytes
   * @throws {ObjectNotFoundError} If object doesn't exist
   */
  read(repo: string, hash: string): Promise<Uint8Array>;

  /**
   * Check if an object exists.
   * @param repo - Repository identifier
   * @param hash - SHA256 hash of the object
   * @returns true if object exists
   */
  exists(repo: string, hash: string): Promise<boolean>;

  /**
   * List all object hashes in the store.
   * Used for garbage collection.
   * @param repo - Repository identifier
   * @returns Array of hashes
   */
  list(repo: string): Promise<string[]>;
}

// =============================================================================
// Reference Store
// =============================================================================

/**
 * Mutable reference storage for packages, workspaces, and executions.
 *
 * Unlike objects, references can be updated and deleted.
 * All methods take `repo` as first parameter to identify the repository.
 */
export interface RefStore {
  // -------------------------------------------------------------------------
  // Package References
  // -------------------------------------------------------------------------

  /**
   * List all packages with their versions.
   * @param repo - Repository identifier
   * @returns Array of {name, version} pairs
   */
  packageList(repo: string): Promise<{ name: string; version: string }[]>;

  /**
   * Resolve a package reference to its hash.
   * @param repo - Repository identifier
   * @param name - Package name
   * @param version - Package version
   * @returns Package object hash, or null if not found
   */
  packageResolve(repo: string, name: string, version: string): Promise<string | null>;

  /**
   * Write a package reference.
   * @param repo - Repository identifier
   * @param name - Package name
   * @param version - Package version
   * @param hash - Package object hash
   */
  packageWrite(repo: string, name: string, version: string, hash: string): Promise<void>;

  /**
   * Remove a package reference.
   * @param repo - Repository identifier
   * @param name - Package name
   * @param version - Package version
   */
  packageRemove(repo: string, name: string, version: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Workspace State
  // -------------------------------------------------------------------------

  /**
   * List all workspace names.
   * @param repo - Repository identifier
   * @returns Array of workspace names
   */
  workspaceList(repo: string): Promise<string[]>;

  /**
   * Read workspace state.
   * @param repo - Repository identifier
   * @param name - Workspace name
   * @returns Encoded workspace state, or null if not found
   */
  workspaceRead(repo: string, name: string): Promise<Uint8Array | null>;

  /**
   * Write workspace state.
   * @param repo - Repository identifier
   * @param name - Workspace name
   * @param state - Encoded workspace state (empty = undeployed)
   */
  workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void>;

  /**
   * Remove a workspace.
   * @param repo - Repository identifier
   * @param name - Workspace name
   */
  workspaceRemove(repo: string, name: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Execution Cache (with execution history)
  // -------------------------------------------------------------------------

  /**
   * Get execution status for a specific execution.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @returns ExecutionStatus or null if not found
   */
  executionGet(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionStatus | null>;

  /**
   * Write execution status.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @param status - Execution status
   */
  executionWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, status: ExecutionStatus): Promise<void>;

  /**
   * List all execution IDs for a (taskHash, inputsHash) pair.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @returns Array of executionId values (sorted lexicographically ascending)
   */
  executionListIds(repo: string, taskHash: string, inputsHash: string): Promise<string[]>;

  /**
   * Get the latest execution status (lexicographically greatest executionId).
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @returns ExecutionStatus or null if no executions exist
   */
  executionGetLatest(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null>;

  /**
   * Get the latest successful output hash (for cache lookup).
   * Iterates from latest executionId backwards, returns first success.outputHash found.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @returns Output hash or null if no successful execution exists
   */
  executionGetLatestOutput(repo: string, taskHash: string, inputsHash: string): Promise<string | null>;

  /**
   * List all executions in the repository.
   * @param repo - Repository identifier
   * @returns Array of {taskHash, inputsHash} pairs
   */
  executionList(repo: string): Promise<{ taskHash: string; inputsHash: string }[]>;

  /**
   * List executions for a specific task.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @returns Array of inputsHash values
   */
  executionListForTask(repo: string, taskHash: string): Promise<string[]>;

  // -------------------------------------------------------------------------
  // Dataflow Run History
  // -------------------------------------------------------------------------

  /**
   * Get a specific dataflow run.
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param runId - Run ID (UUIDv7)
   * @returns DataflowRun or null if not found
   */
  dataflowRunGet(repo: string, workspace: string, runId: string): Promise<DataflowRun | null>;

  /**
   * Write a dataflow run.
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param run - The dataflow run record
   */
  dataflowRunWrite(repo: string, workspace: string, run: DataflowRun): Promise<void>;

  /**
   * List all run IDs for a workspace (sorted lexicographically ascending).
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @returns Array of runId values
   */
  dataflowRunList(repo: string, workspace: string): Promise<string[]>;

  /**
   * Get the latest dataflow run for a workspace.
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @returns DataflowRun or null if no runs exist
   */
  dataflowRunGetLatest(repo: string, workspace: string): Promise<DataflowRun | null>;

  /**
   * Delete a specific dataflow run.
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param runId - Run ID (UUIDv7)
   */
  dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void>;
}

// =============================================================================
// Lock Service
// =============================================================================

/**
 * Handle to a held lock.
 */
export interface LockHandle {
  /** The resource this lock is for */
  readonly resource: string;
  /** Release the lock. Safe to call multiple times. */
  release(): Promise<void>;
}

/**
 * Distributed locking service for exclusive access.
 *
 * Used to prevent concurrent modifications to workspaces.
 * The lock state is stored using the LockState type from e3-types,
 * enabling cloud implementations to extend the holder variants.
 * All methods (except isHolderAlive) take `repo` as first parameter.
 */
export interface LockService {
  /**
   * Acquire an exclusive lock on a resource.
   *
   * The implementation gathers holder information (process ID for local,
   * request ID for Lambda, etc.) and writes the lock state.
   *
   * @param repo - Repository identifier
   * @param resource - Resource identifier (e.g., "workspaces/production")
   * @param operation - What operation is acquiring the lock
   * @param options - Lock options
   * @returns Lock handle, or null if lock couldn't be acquired
   */
  acquire(
    repo: string,
    resource: string,
    operation: LockOperation,
    options?: { wait?: boolean; timeout?: number }
  ): Promise<LockHandle | null>;

  /**
   * Get the current lock state.
   * @param repo - Repository identifier
   * @param resource - Resource identifier
   * @returns Lock state, or null if not locked
   */
  getState(repo: string, resource: string): Promise<LockState | null>;

  /**
   * Check if a lock holder is still alive.
   *
   * For local process locks, checks if the PID is still running.
   * For cloud locks, checks expiry or queries the cloud service.
   *
   * @param holder - East text-encoded holder string from LockState
   * @returns true if the holder is still active
   */
  isHolderAlive(holder: string): Promise<boolean>;
}

// =============================================================================
// Log Store
// =============================================================================

/**
 * A chunk of log output.
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
 * Log storage for execution stdout/stderr.
 * All methods take `repo` as first parameter to identify the repository.
 */
export interface LogStore {
  /**
   * Append data to a log stream.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @param stream - 'stdout' or 'stderr'
   * @param data - Data to append
   */
  append(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): Promise<void>;

  /**
   * Read from a log stream.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @param stream - 'stdout' or 'stderr'
   * @param options - Read options
   * @returns Log chunk
   */
  read(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number }
  ): Promise<LogChunk>;

  // Note: The options.limit parameter corresponds to a maximum bytes to read.
  // The returned LogChunk.size indicates actual bytes read.
  // The returned LogChunk.complete indicates if end of file was reached.
}

// =============================================================================
// Repository Store
// =============================================================================

/**
 * Repository lifecycle management.
 *
 * Handles repo creation, deletion, status tracking, and GC.
 * Follows the sub-interface pattern (storage.repos.*) like other stores.
 */
export interface RepoStore {
  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * List all repository names.
   * @returns Array of repository names
   */
  list(): Promise<string[]>;

  /**
   * Check if a repository exists.
   * @param repo - Repository name
   * @returns true if repository exists
   */
  exists(repo: string): Promise<boolean>;

  /**
   * Get repository metadata.
   * @param repo - Repository name
   * @returns Metadata or null if not found
   */
  getMetadata(repo: string): Promise<RepoMetadata | null>;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create a new repository.
   * Sets status to 'active' after initialization.
   * @param repo - Repository name
   * @throws {RepoAlreadyExistsError} If repository already exists
   */
  create(repo: string): Promise<void>;

  /**
   * Atomically set repository status.
   * Used for CAS (compare-and-swap) operations.
   * @param repo - Repository name
   * @param status - New status
   * @param expected - Optional expected current status (single or array) for CAS
   * @throws {RepoNotFoundError} If repository doesn't exist
   * @throws {RepoStatusConflictError} If expected status doesn't match
   */
  setStatus(repo: string, status: RepoStatus, expected?: RepoStatus | RepoStatus[]): Promise<void>;

  /**
   * Remove repository metadata/tombstone.
   * Called after GC completes for 'deleting' repos.
   * @param repo - Repository name
   */
  remove(repo: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Batched Deletion (Resumable)
  // -------------------------------------------------------------------------

  /**
   * Delete all refs for a repo in batches.
   * Loop until status='done'.
   * @param repo - Repository name
   * @param cursor - Cursor from previous call (undefined for first call)
   * @returns Batch result with status and optional cursor
   */
  deleteRefsBatch(repo: string, cursor?: string): Promise<BatchResult>;

  /**
   * Delete all objects for a repo in batches.
   * Loop until status='done'.
   * @param repo - Repository name
   * @param cursor - Cursor from previous call (undefined for first call)
   * @returns Batch result with status and optional cursor
   */
  deleteObjectsBatch(repo: string, cursor?: string): Promise<BatchResult>;

  // -------------------------------------------------------------------------
  // GC Phases (Resumable)
  // -------------------------------------------------------------------------

  /**
   * Mark phase: Collect roots, trace reachable objects.
   * @param repo - Repository name
   * @returns Mark result with reachable set reference
   */
  gcMark(repo: string): Promise<GcMarkResult>;

  /**
   * Sweep phase: Delete unreachable objects in batches.
   * @param repo - Repository name
   * @param reachableSetRef - Reference from gcMark
   * @param options - Sweep options (minAge to skip young objects, cursor for pagination)
   * @returns Sweep result with status and optional cursor
   */
  gcSweep(
    repo: string,
    reachableSetRef: string,
    options?: { minAge?: number; cursor?: string }
  ): Promise<GcSweepResult>;

  /**
   * Cleanup phase: Remove temporary files (reachable set, etc.).
   * @param repo - Repository name
   * @param reachableSetRef - Reference from gcMark
   */
  gcCleanup(repo: string, reachableSetRef: string): Promise<void>;
}

// =============================================================================
// Combined Storage Backend
// =============================================================================

/**
 * Complete storage backend combining all storage interfaces.
 *
 * This is the main abstraction point for e3-core. Functions receive a
 * StorageBackend instead of a repoPath, allowing the same logic to work
 * against different storage implementations.
 */
export interface StorageBackend {
  /** Content-addressed object storage */
  readonly objects: ObjectStore;

  /** Mutable reference storage */
  readonly refs: RefStore;

  /** Distributed locking service */
  readonly locks: LockService;

  /** Execution log storage */
  readonly logs: LogStore;

  /** Repository lifecycle management */
  readonly repos: RepoStore;

  /**
   * Validate that a repository exists and is properly structured.
   * @param repo - Repository identifier (path to e3 repository directory for local storage)
   * @throws {RepositoryNotFoundError} If repository doesn't exist or is invalid
   */
  validateRepository(repo: string): Promise<void>;
}
