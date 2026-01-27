/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { none } from '@elaraai/east';
import { computeHash } from '../../objects.js';
import { ObjectNotFoundError, RepositoryNotFoundError } from '../../errors.js';
import type { ExecutionStatus } from '@elaraai/e3-types';
import type {
  StorageBackend,
  ObjectStore,
  RefStore,
  LockService,
  LockHandle,
  LockOperation,
  LockState,
  LogStore,
  LogChunk,
} from '../interfaces.js';
import { InMemoryRepoStore } from './InMemoryRepoStore.js';

/**
 * In-memory implementation of ObjectStore for testing.
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryObjectStore implements ObjectStore {
  private objects = new Map<string, Map<string, Uint8Array>>();

  private getRepoObjects(repo: string): Map<string, Uint8Array> {
    let repoObjects = this.objects.get(repo);
    if (!repoObjects) {
      repoObjects = new Map();
      this.objects.set(repo, repoObjects);
    }
    return repoObjects;
  }

  async write(repo: string, data: Uint8Array): Promise<string> {
    const hash = computeHash(data);
    this.getRepoObjects(repo).set(hash, data);
    return hash;
  }

  async writeStream(repo: string, stream: AsyncIterable<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return this.write(repo, data);
  }

  async read(repo: string, hash: string): Promise<Uint8Array> {
    const data = this.getRepoObjects(repo).get(hash);
    if (!data) {
      throw new ObjectNotFoundError(hash);
    }
    return data;
  }

  async exists(repo: string, hash: string): Promise<boolean> {
    return this.getRepoObjects(repo).has(hash);
  }

  async list(repo: string): Promise<string[]> {
    return [...this.getRepoObjects(repo).keys()];
  }

  clear(): void {
    this.objects.clear();
  }
}

/**
 * In-memory implementation of RefStore for testing.
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryRefStore implements RefStore {
  private packages = new Map<string, Map<string, string>>();
  private workspaces = new Map<string, Map<string, Uint8Array>>();
  private executions = new Map<string, Map<string, ExecutionStatus>>();
  private executionOutputs = new Map<string, Map<string, string>>();

  private getPackages(repo: string): Map<string, string> {
    let repoPackages = this.packages.get(repo);
    if (!repoPackages) {
      repoPackages = new Map();
      this.packages.set(repo, repoPackages);
    }
    return repoPackages;
  }

  private getWorkspaces(repo: string): Map<string, Uint8Array> {
    let repoWorkspaces = this.workspaces.get(repo);
    if (!repoWorkspaces) {
      repoWorkspaces = new Map();
      this.workspaces.set(repo, repoWorkspaces);
    }
    return repoWorkspaces;
  }

  private getExecutions(repo: string): Map<string, ExecutionStatus> {
    let repoExecutions = this.executions.get(repo);
    if (!repoExecutions) {
      repoExecutions = new Map();
      this.executions.set(repo, repoExecutions);
    }
    return repoExecutions;
  }

  private getExecutionOutputs(repo: string): Map<string, string> {
    let repoOutputs = this.executionOutputs.get(repo);
    if (!repoOutputs) {
      repoOutputs = new Map();
      this.executionOutputs.set(repo, repoOutputs);
    }
    return repoOutputs;
  }

  private makePackageKey(name: string, version: string): string {
    return `${name}@${version}`;
  }

  private makeExecutionKey(taskHash: string, inputsHash: string): string {
    return `${taskHash}/${inputsHash}`;
  }

  // Package operations
  async packageList(repo: string): Promise<{ name: string; version: string }[]> {
    const result: { name: string; version: string }[] = [];
    for (const key of this.getPackages(repo).keys()) {
      const [name, version] = key.split('@');
      result.push({ name, version });
    }
    return result;
  }

  async packageResolve(repo: string, name: string, version: string): Promise<string | null> {
    return this.getPackages(repo).get(this.makePackageKey(name, version)) ?? null;
  }

  async packageWrite(repo: string, name: string, version: string, hash: string): Promise<void> {
    this.getPackages(repo).set(this.makePackageKey(name, version), hash);
  }

  async packageRemove(repo: string, name: string, version: string): Promise<void> {
    this.getPackages(repo).delete(this.makePackageKey(name, version));
  }

  // Workspace operations
  async workspaceList(repo: string): Promise<string[]> {
    return [...this.getWorkspaces(repo).keys()];
  }

  async workspaceRead(repo: string, name: string): Promise<Uint8Array | null> {
    return this.getWorkspaces(repo).get(name) ?? null;
  }

  async workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void> {
    this.getWorkspaces(repo).set(name, state);
  }

  async workspaceRemove(repo: string, name: string): Promise<void> {
    this.getWorkspaces(repo).delete(name);
  }

  // Execution operations
  async executionGet(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null> {
    return this.getExecutions(repo).get(this.makeExecutionKey(taskHash, inputsHash)) ?? null;
  }

  async executionWrite(repo: string, taskHash: string, inputsHash: string, status: ExecutionStatus): Promise<void> {
    this.getExecutions(repo).set(this.makeExecutionKey(taskHash, inputsHash), status);
  }

  async executionGetOutput(repo: string, taskHash: string, inputsHash: string): Promise<string | null> {
    return this.getExecutionOutputs(repo).get(this.makeExecutionKey(taskHash, inputsHash)) ?? null;
  }

  async executionWriteOutput(repo: string, taskHash: string, inputsHash: string, outputHash: string): Promise<void> {
    this.getExecutionOutputs(repo).set(this.makeExecutionKey(taskHash, inputsHash), outputHash);
  }

  async executionList(repo: string): Promise<{ taskHash: string; inputsHash: string }[]> {
    const result: { taskHash: string; inputsHash: string }[] = [];
    for (const key of this.getExecutions(repo).keys()) {
      const [taskHash, inputsHash] = key.split('/');
      result.push({ taskHash, inputsHash });
    }
    return result;
  }

  async executionListForTask(repo: string, taskHash: string): Promise<string[]> {
    const result: string[] = [];
    for (const key of this.getExecutions(repo).keys()) {
      if (key.startsWith(`${taskHash}/`)) {
        result.push(key.split('/')[1]);
      }
    }
    return result;
  }

  clear(): void {
    this.packages.clear();
    this.workspaces.clear();
    this.executions.clear();
    this.executionOutputs.clear();
  }
}

/**
 * In-memory implementation of LockService for testing.
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryLockService implements LockService {
  private locks = new Map<string, LockState>();

  private makeLockKey(repo: string, resource: string): string {
    return `${repo}:${resource}`;
  }

  async acquire(
    repo: string,
    resource: string,
    operation: LockOperation,
    _options?: { wait?: boolean; timeout?: number }
  ): Promise<LockHandle | null> {
    const key = this.makeLockKey(repo, resource);
    if (this.locks.has(key)) {
      return null;
    }

    const now = new Date();
    // holder is an East text-encoded variant string
    const state: LockState = {
      holder: `.process (pid=${process.pid}, bootId="in-memory", startTime=0, command="test")`,
      operation,
      acquiredAt: now,
      expiresAt: none,
    };
    this.locks.set(key, state);

    return {
      resource,
      release: async () => {
        this.locks.delete(key);
      },
    };
  }

  async getState(repo: string, resource: string): Promise<LockState | null> {
    return this.locks.get(this.makeLockKey(repo, resource)) ?? null;
  }

  async isHolderAlive(_holder: string): Promise<boolean> {
    return true;
  }

  clear(): void {
    this.locks.clear();
  }
}

/**
 * In-memory implementation of LogStore for testing.
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryLogStore implements LogStore {
  private logs = new Map<string, string>();

  private makeLogKey(repo: string, taskHash: string, inputsHash: string, stream: string): string {
    return `${repo}:${taskHash}:${inputsHash}:${stream}`;
  }

  async append(
    repo: string,
    taskHash: string,
    inputsHash: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): Promise<void> {
    const key = this.makeLogKey(repo, taskHash, inputsHash, stream);
    const existing = this.logs.get(key) ?? '';
    this.logs.set(key, existing + data);
  }

  async read(
    repo: string,
    taskHash: string,
    inputsHash: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number }
  ): Promise<LogChunk> {
    const key = this.makeLogKey(repo, taskHash, inputsHash, stream);
    const content = this.logs.get(key) ?? '';
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? content.length - offset;
    const data = content.slice(offset, offset + limit);

    return {
      data,
      offset,
      size: data.length,
      totalSize: content.length,
      complete: offset + data.length >= content.length,
    };
  }

  clear(): void {
    this.logs.clear();
  }
}

/**
 * In-memory implementation of StorageBackend for testing.
 *
 * All data is stored in memory maps. Useful for unit tests
 * where filesystem access is not needed.
 */
export class InMemoryStorage implements StorageBackend {
  public readonly objects: InMemoryObjectStore;
  public readonly refs: InMemoryRefStore;
  public readonly locks: InMemoryLockService;
  public readonly logs: InMemoryLogStore;
  public readonly repos: InMemoryRepoStore;

  constructor() {
    this.objects = new InMemoryObjectStore();
    this.refs = new InMemoryRefStore();
    this.locks = new InMemoryLockService();
    this.logs = new InMemoryLogStore();
    this.repos = new InMemoryRepoStore();
  }

  async validateRepository(repo: string): Promise<void> {
    if (!(await this.repos.exists(repo))) {
      throw new RepositoryNotFoundError(repo);
    }
  }

  /**
   * Clear all stored data.
   * Useful for test cleanup.
   */
  clear(): void {
    this.objects.clear();
    this.refs.clear();
    this.locks.clear();
    this.logs.clear();
    this.repos.clear();
  }
}
