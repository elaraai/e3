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

import type { ExecutionStatus } from '@elaraai/e3-types';
import type { LockHolder } from '../errors.js';

// Re-export LockHolder for consumers of this module
export type { LockHolder };

// =============================================================================
// Object Store
// =============================================================================

/**
 * Content-addressed object storage.
 *
 * Objects are immutable and identified by their SHA256 hash.
 * The store handles deduplication automatically.
 */
export interface ObjectStore {
  /**
   * Write data to the object store.
   * @param data - Raw bytes to store
   * @returns SHA256 hash of the data
   */
  write(data: Uint8Array): Promise<string>;

  /**
   * Write data from a stream to the object store.
   * @param stream - Async iterable of chunks
   * @returns SHA256 hash of the data
   */
  writeStream(stream: AsyncIterable<Uint8Array>): Promise<string>;

  /**
   * Read an object by hash.
   * @param hash - SHA256 hash of the object
   * @returns Raw bytes
   * @throws {ObjectNotFoundError} If object doesn't exist
   */
  read(hash: string): Promise<Uint8Array>;

  /**
   * Check if an object exists.
   * @param hash - SHA256 hash of the object
   * @returns true if object exists
   */
  exists(hash: string): Promise<boolean>;

  /**
   * List all object hashes in the store.
   * Used for garbage collection.
   * @returns Array of hashes
   */
  list(): Promise<string[]>;
}

// =============================================================================
// Reference Store
// =============================================================================

/**
 * Mutable reference storage for packages, workspaces, and executions.
 *
 * Unlike objects, references can be updated and deleted.
 */
export interface RefStore {
  // -------------------------------------------------------------------------
  // Package References
  // -------------------------------------------------------------------------

  /**
   * List all packages with their versions.
   * @returns Array of {name, version} pairs
   */
  packageList(): Promise<{ name: string; version: string }[]>;

  /**
   * Resolve a package reference to its hash.
   * @param name - Package name
   * @param version - Package version
   * @returns Package object hash, or null if not found
   */
  packageResolve(name: string, version: string): Promise<string | null>;

  /**
   * Write a package reference.
   * @param name - Package name
   * @param version - Package version
   * @param hash - Package object hash
   */
  packageWrite(name: string, version: string, hash: string): Promise<void>;

  /**
   * Remove a package reference.
   * @param name - Package name
   * @param version - Package version
   */
  packageRemove(name: string, version: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Workspace State
  // -------------------------------------------------------------------------

  /**
   * List all workspace names.
   * @returns Array of workspace names
   */
  workspaceList(): Promise<string[]>;

  /**
   * Read workspace state.
   * @param name - Workspace name
   * @returns Encoded workspace state, or null if not found
   */
  workspaceRead(name: string): Promise<Uint8Array | null>;

  /**
   * Write workspace state.
   * @param name - Workspace name
   * @param state - Encoded workspace state (empty = undeployed)
   */
  workspaceWrite(name: string, state: Uint8Array): Promise<void>;

  /**
   * Remove a workspace.
   * @param name - Workspace name
   */
  workspaceRemove(name: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Execution Cache
  // -------------------------------------------------------------------------

  /**
   * Get execution status.
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @returns ExecutionStatus or null if not found
   */
  executionGet(taskHash: string, inputsHash: string): Promise<ExecutionStatus | null>;

  /**
   * Write execution status.
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param status - Execution status
   */
  executionWrite(taskHash: string, inputsHash: string, status: ExecutionStatus): Promise<void>;

  /**
   * Get execution output hash.
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @returns Output hash or null if not available
   */
  executionGetOutput(taskHash: string, inputsHash: string): Promise<string | null>;

  /**
   * Write execution output hash.
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param outputHash - Output object hash
   */
  executionWriteOutput(taskHash: string, inputsHash: string, outputHash: string): Promise<void>;

  /**
   * List all executions.
   * @returns Array of {taskHash, inputsHash} pairs
   */
  executionList(): Promise<{ taskHash: string; inputsHash: string }[]>;

  /**
   * List executions for a specific task.
   * @param taskHash - Task object hash
   * @returns Array of inputsHash values
   */
  executionListForTask(taskHash: string): Promise<string[]>;
}

// =============================================================================
// Lock Service
// =============================================================================

// Note: LockHolder is imported from ../errors.js and re-exported above

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
 */
export interface LockService {
  /**
   * Acquire an exclusive lock on a resource.
   * @param resource - Resource identifier (e.g., workspace name)
   * @param holder - Information about this lock holder
   * @param options - Lock options
   * @returns Lock handle, or null if lock couldn't be acquired
   */
  acquire(
    resource: string,
    holder: Omit<LockHolder, 'acquiredAt'>,
    options?: { wait?: boolean; timeout?: number }
  ): Promise<LockHandle | null>;

  /**
   * Get information about the current lock holder.
   * @param resource - Resource identifier
   * @returns Lock holder info, or null if not locked
   */
  getHolder(resource: string): Promise<LockHolder | null>;

  /**
   * Check if a lock holder is still alive.
   * @param holder - Lock holder info
   * @returns true if the holder process is still running
   */
  isHolderAlive(holder: LockHolder): Promise<boolean>;
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
 */
export interface LogStore {
  /**
   * Append data to a log stream.
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param stream - 'stdout' or 'stderr'
   * @param data - Data to append
   */
  append(
    taskHash: string,
    inputsHash: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): Promise<void>;

  /**
   * Read from a log stream.
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param stream - 'stdout' or 'stderr'
   * @param options - Read options
   * @returns Log chunk
   */
  read(
    taskHash: string,
    inputsHash: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number }
  ): Promise<LogChunk>;

  // Note: The options.limit parameter corresponds to a maximum bytes to read.
  // The returned LogChunk.size indicates actual bytes read.
  // The returned LogChunk.complete indicates if end of file was reached.
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
}
