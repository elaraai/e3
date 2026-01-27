/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for InMemoryRepoStore.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { InMemoryRepoStore } from './InMemoryRepoStore.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';

describe('InMemoryRepoStore', () => {
  let store: InMemoryRepoStore;

  beforeEach(() => {
    store = new InMemoryRepoStore();
  });

  describe('list', () => {
    it('returns empty array initially', async () => {
      const repos = await store.list();
      assert.deepStrictEqual(repos, []);
    });

    it('returns all created repos', async () => {
      await store.create('repo1');
      await store.create('repo2');
      await store.create('repo3');

      const repos = await store.list();
      assert.deepStrictEqual(repos.sort(), ['repo1', 'repo2', 'repo3']);
    });
  });

  describe('exists', () => {
    it('returns false for non-existent repo', async () => {
      const exists = await store.exists('nonexistent');
      assert.strictEqual(exists, false);
    });

    it('returns true for existing repo', async () => {
      await store.create('my-repo');
      const exists = await store.exists('my-repo');
      assert.strictEqual(exists, true);
    });
  });

  describe('getMetadata', () => {
    it('returns null for non-existent repo', async () => {
      const metadata = await store.getMetadata('nonexistent');
      assert.strictEqual(metadata, null);
    });

    it('returns metadata for existing repo', async () => {
      await store.create('my-repo');
      const metadata = await store.getMetadata('my-repo');

      assert.ok(metadata);
      assert.strictEqual(metadata.name, 'my-repo');
      assert.strictEqual(metadata.status, 'active');
      assert.ok(metadata.createdAt);
      assert.ok(metadata.statusChangedAt);
    });
  });

  describe('create', () => {
    it('creates a new repo with active status', async () => {
      await store.create('my-repo');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status, 'active');
    });

    it('throws RepoAlreadyExistsError if repo exists', async () => {
      await store.create('my-repo');

      await assert.rejects(
        () => store.create('my-repo'),
        RepoAlreadyExistsError
      );
    });
  });

  describe('setStatus', () => {
    it('updates status', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status, 'gc');
    });

    it('updates statusChangedAt', async () => {
      await store.create('my-repo');
      const before = await store.getMetadata('my-repo');

      // Wait a tiny bit to ensure timestamps differ
      await new Promise(resolve => setTimeout(resolve, 10));

      await store.setStatus('my-repo', 'gc');
      const after = await store.getMetadata('my-repo');

      assert.ok(before && after);
      assert.notStrictEqual(before.statusChangedAt, after.statusChangedAt);
    });

    it('throws RepoNotFoundError for non-existent repo', async () => {
      await assert.rejects(
        () => store.setStatus('nonexistent', 'gc'),
        RepoNotFoundError
      );
    });

    it('succeeds with correct expected status', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc', 'active');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status, 'gc');
    });

    it('throws RepoStatusConflictError with wrong expected status', async () => {
      await store.create('my-repo');

      await assert.rejects(
        () => store.setStatus('my-repo', 'gc', 'deleting'),
        RepoStatusConflictError
      );
    });

    it('succeeds with expected status array', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc', ['active', 'creating']);

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status, 'gc');
    });

    it('throws RepoStatusConflictError with expected status array not matching', async () => {
      await store.create('my-repo');

      await assert.rejects(
        () => store.setStatus('my-repo', 'gc', ['creating', 'deleting']),
        RepoStatusConflictError
      );
    });
  });

  describe('remove', () => {
    it('removes a repo', async () => {
      await store.create('my-repo');
      await store.remove('my-repo');

      const exists = await store.exists('my-repo');
      assert.strictEqual(exists, false);
    });

    it('does not throw for non-existent repo', async () => {
      await store.remove('nonexistent');
      // Should not throw
    });
  });

  describe('deleteRefsBatch', () => {
    it('returns done immediately (no-op for in-memory)', async () => {
      await store.create('my-repo');
      const result = await store.deleteRefsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.deleted, 0);
    });
  });

  describe('deleteObjectsBatch', () => {
    it('returns done immediately (no-op for in-memory)', async () => {
      await store.create('my-repo');
      const result = await store.deleteObjectsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.deleted, 0);
    });
  });

  describe('gcMark', () => {
    it('returns empty mark result (no-op for in-memory)', async () => {
      await store.create('my-repo');
      const result = await store.gcMark('my-repo');

      assert.strictEqual(result.reachableCount, 0);
      assert.strictEqual(result.rootCount, 0);
      assert.ok(result.reachableSetRef);
    });
  });

  describe('gcSweep', () => {
    it('returns done immediately (no-op for in-memory)', async () => {
      await store.create('my-repo');
      const result = await store.gcSweep('my-repo', 'any-ref');

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.deleted, 0);
      assert.strictEqual(result.bytesFreed, 0);
      assert.strictEqual(result.skippedYoung, 0);
    });
  });

  describe('gcCleanup', () => {
    it('succeeds (no-op for in-memory)', async () => {
      await store.create('my-repo');
      await store.gcCleanup('my-repo', 'any-ref');
      // Should not throw
    });
  });

  describe('clear', () => {
    it('removes all repos', async () => {
      await store.create('repo1');
      await store.create('repo2');

      store.clear();

      const repos = await store.list();
      assert.deepStrictEqual(repos, []);
    });
  });
});
