/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { StorageBackend, ObjectStore, RefStore, LockService, LogStore } from '../interfaces.js';
import { LocalObjectStore } from './LocalObjectStore.js';
import { LocalRefStore } from './LocalRefStore.js';
import { LocalLockService } from './LocalLockService.js';
import { LocalLogStore } from './LocalLogStore.js';

/**
 * Local filesystem implementation of StorageBackend.
 *
 * This combines the local implementations of all storage interfaces,
 * providing a complete backend for local e3 repositories.
 *
 * @example
 * ```typescript
 * import { LocalBackend } from '@elaraai/e3-core';
 *
 * const backend = new LocalBackend('/path/to/.e3');
 *
 * // Use the backend with storage-agnostic functions
 * const hash = await backend.objects.write(data);
 * const packages = await backend.refs.packageList();
 * ```
 */
export class LocalBackend implements StorageBackend {
  /** Content-addressed object storage */
  public readonly objects: ObjectStore;

  /** Mutable reference storage */
  public readonly refs: RefStore;

  /** Distributed locking service */
  public readonly locks: LockService;

  /** Execution log storage */
  public readonly logs: LogStore;

  /**
   * Create a new LocalBackend.
   *
   * @param repoPath - Path to the .e3 repository directory
   */
  constructor(public readonly repoPath: string) {
    this.objects = new LocalObjectStore(repoPath);
    this.refs = new LocalRefStore(repoPath);
    this.locks = new LocalLockService(repoPath);
    this.logs = new LocalLogStore(repoPath);
  }
}
