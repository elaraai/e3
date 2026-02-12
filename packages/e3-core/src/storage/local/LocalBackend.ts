/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { StorageBackend, ObjectStore, RefStore, LockService, LogStore, RepoStore } from '../interfaces.js';
import { LocalObjectStore } from './LocalObjectStore.js';
import { LocalRefStore } from './LocalRefStore.js';
import { LocalLockService } from './LocalLockService.js';
import { LocalLogStore } from './LocalLogStore.js';
import { LocalRepoStore } from './LocalRepoStore.js';
import { RepoNotFoundError } from '../../errors.js';

/**
 * Thrown when a local repository directory is not found or is missing required structure.
 * This is an internal error for LocalStorage — external consumers see RepoNotFoundError.
 */
class RepoDirNotFoundError extends RepoNotFoundError {
  constructor(public readonly path: string) {
    super(path);
  }
}

/**
 * Local filesystem implementation of StorageBackend.
 *
 * This combines the local implementations of all storage interfaces,
 * providing a complete backend for local e3 repositories.
 *
 * The `repo` parameter passed to each method is the path to the e3 repository directory.
 * This allows a single LocalStorage instance to be used for multiple repositories.
 *
 * @example
 * ```typescript
 * import { LocalStorage } from '@elaraai/e3-core';
 *
 * const storage = new LocalStorage();
 * const repo = '/path/to/repo';
 *
 * // Use the backend with storage-agnostic functions
 * const hash = await storage.objects.write(repo, data);
 * const packages = await storage.refs.packageList(repo);
 * ```
 */
export class LocalStorage implements StorageBackend {
  /** Content-addressed object storage */
  public readonly objects: ObjectStore;

  /** Mutable reference storage */
  public readonly refs: RefStore;

  /** Distributed locking service */
  public readonly locks: LockService;

  /** Execution log storage */
  public readonly logs: LogStore;

  /** Repository lifecycle management */
  public readonly repos: RepoStore;

  /**
   * Create a new LocalStorage instance.
   *
   * @param reposDir - Optional parent directory containing repositories.
   *                   Required for repo lifecycle operations (repos.*).
   *                   If not provided, repos.* methods will throw.
   */
  constructor(reposDir?: string) {
    this.objects = new LocalObjectStore();
    this.refs = new LocalRefStore();
    this.locks = new LocalLockService();
    this.logs = new LocalLogStore();
    // repos requires reposDir for multi-repo operations
    // If not provided, create a RepoStore that throws on all operations
    this.repos = reposDir
      ? new LocalRepoStore(reposDir, this.refs)
      : new NoOpRepoStore();
  }

  /**
   * Validate that a repository exists and is properly structured.
   * @param repo - Path to the e3 repository directory
   * @throws {RepoNotFoundError} If repository doesn't exist or is invalid
   */
  async validateRepository(repo: string): Promise<void> {
    const requiredDirs = ['objects', 'packages', 'workspaces', 'executions'];
    for (const dir of requiredDirs) {
      try {
        await fs.access(path.join(repo, dir));
      } catch {
        throw new RepoDirNotFoundError(repo);
      }
    }
  }
}

// Re-export as LocalBackend for backwards compatibility during migration
export { LocalStorage as LocalBackend };

/**
 * No-op implementation of RepoStore that throws on all operations.
 * Used when LocalStorage is created without a reposDir.
 */
class NoOpRepoStore implements RepoStore {
  private error(): never {
    throw new Error('RepoStore operations require reposDir to be configured');
  }

  list(): Promise<string[]> {
    return this.error();
  }

  exists(_repo: string): Promise<boolean> {
    return this.error();
  }

  getMetadata(_repo: string): Promise<import('../interfaces.js').RepoMetadata | null> {
    return this.error();
  }

  create(_repo: string): Promise<void> {
    return this.error();
  }

  setStatus(
    _repo: string,
    _status: import('../interfaces.js').RepoStatus,
    _expected?: import('../interfaces.js').RepoStatus | import('../interfaces.js').RepoStatus[]
  ): Promise<void> {
    return this.error();
  }

  remove(_repo: string): Promise<void> {
    return this.error();
  }

  deleteRefsBatch(_repo: string, _cursor?: string): Promise<import('../interfaces.js').BatchResult> {
    return this.error();
  }

  deleteObjectsBatch(_repo: string, _cursor?: string): Promise<import('../interfaces.js').BatchResult> {
    return this.error();
  }

  gcScanPackageRoots(_repo: string, _cursor?: unknown): Promise<import('../interfaces.js').GcRootScanResult> {
    return this.error();
  }

  gcScanWorkspaceRoots(_repo: string, _cursor?: unknown): Promise<import('../interfaces.js').GcRootScanResult> {
    return this.error();
  }

  gcScanExecutionRoots(_repo: string, _cursor?: unknown): Promise<import('../interfaces.js').GcRootScanResult> {
    return this.error();
  }

  gcScanObjects(_repo: string, _cursor?: unknown): Promise<import('../interfaces.js').GcObjectScanResult> {
    return this.error();
  }

  gcDeleteObjects(_repo: string, _hashes: string[]): Promise<void> {
    return this.error();
  }
}
