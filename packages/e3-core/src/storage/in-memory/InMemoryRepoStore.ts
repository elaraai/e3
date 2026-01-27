/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type {
  RepoStore,
  RepoStatus,
  RepoMetadata,
  BatchResult,
  GcMarkResult,
  GcSweepResult,
} from '../interfaces.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';

/**
 * In-memory implementation of RepoStore for testing.
 *
 * Stores all data in memory maps. Useful for unit tests
 * where filesystem access is not needed.
 *
 * All methods are synchronous but return Promises to match the interface.
 */
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryRepoStore implements RepoStore {
  private repos = new Map<string, RepoMetadata>();

  // ===========================================================================
  // Queries
  // ===========================================================================

  async list(): Promise<string[]> {
    return [...this.repos.keys()];
  }

  async exists(repo: string): Promise<boolean> {
    return this.repos.has(repo);
  }

  async getMetadata(repo: string): Promise<RepoMetadata | null> {
    return this.repos.get(repo) ?? null;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async create(repo: string): Promise<void> {
    if (this.repos.has(repo)) {
      throw new RepoAlreadyExistsError(repo);
    }

    const now = new Date().toISOString();
    this.repos.set(repo, {
      name: repo,
      status: 'active',
      createdAt: now,
      statusChangedAt: now,
    });
  }

  async setStatus(
    repo: string,
    status: RepoStatus,
    expected?: RepoStatus | RepoStatus[]
  ): Promise<void> {
    const current = this.repos.get(repo);
    if (!current) {
      throw new RepoNotFoundError(repo);
    }

    // Check expected status (CAS)
    if (expected !== undefined) {
      const expectedArray = Array.isArray(expected) ? expected : [expected];
      if (!expectedArray.includes(current.status)) {
        throw new RepoStatusConflictError(repo, expected, current.status);
      }
    }

    // Update status
    const now = new Date().toISOString();
    this.repos.set(repo, {
      ...current,
      status,
      statusChangedAt: now,
    });
  }

  async remove(repo: string): Promise<void> {
    this.repos.delete(repo);
  }

  // ===========================================================================
  // Batched Deletion
  // ===========================================================================

  async deleteRefsBatch(_repo: string, _cursor?: string): Promise<BatchResult> {
    // In-memory doesn't have refs to delete
    return { status: 'done', deleted: 0 };
  }

  async deleteObjectsBatch(_repo: string, _cursor?: string): Promise<BatchResult> {
    // In-memory doesn't have objects to delete
    return { status: 'done', deleted: 0 };
  }

  // ===========================================================================
  // GC Phases
  // ===========================================================================

  async gcMark(_repo: string): Promise<GcMarkResult> {
    // In-memory doesn't need GC
    return { reachableCount: 0, rootCount: 0, reachableSetRef: 'mem' };
  }

  async gcSweep(
    _repo: string,
    _reachableSetRef: string,
    _options?: { minAge?: number; cursor?: string }
  ): Promise<GcSweepResult> {
    // In-memory doesn't need GC
    return { status: 'done', deleted: 0, bytesFreed: 0, skippedYoung: 0 };
  }

  async gcCleanup(_repo: string, _reachableSetRef: string): Promise<void> {
    // Nothing to clean up
  }

  // ===========================================================================
  // Test Utilities
  // ===========================================================================

  /**
   * Clear all repositories.
   * Useful for test cleanup.
   */
  clear(): void {
    this.repos.clear();
  }
}
