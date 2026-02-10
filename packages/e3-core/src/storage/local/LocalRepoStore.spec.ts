/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for LocalRepoStore.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LocalRepoStore } from './LocalRepoStore.js';
import { LocalStorage } from './LocalBackend.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';
import { createTempDir, removeTempDir } from '../../test-helpers.js';

describe('LocalRepoStore', () => {
  let testDir: string;
  let storage: LocalStorage;
  let store: LocalRepoStore;

  beforeEach(() => {
    testDir = createTempDir();
    storage = new LocalStorage(testDir);
    store = storage.repos as LocalRepoStore;
  });

  afterEach(() => {
    removeTempDir(testDir);
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

    it('does not include invalid directories', async () => {
      await store.create('valid-repo');
      // Create an incomplete repo (missing workspaces dir)
      const invalidDir = join(testDir, 'invalid-repo');
      mkdirSync(invalidDir);
      mkdirSync(join(invalidDir, 'objects'));
      mkdirSync(join(invalidDir, 'packages'));
      mkdirSync(join(invalidDir, 'executions'));
      // Missing 'workspaces' directory

      const repos = await store.list();
      assert.deepStrictEqual(repos, ['valid-repo']);
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

    it('synthesizes metadata for legacy repos without metadata file', async () => {
      // Create a legacy repo structure without metadata file
      const legacyDir = join(testDir, 'legacy-repo');
      mkdirSync(legacyDir);
      mkdirSync(join(legacyDir, 'objects'));
      mkdirSync(join(legacyDir, 'packages'));
      mkdirSync(join(legacyDir, 'executions'));
      mkdirSync(join(legacyDir, 'workspaces'));

      const metadata = await store.getMetadata('legacy-repo');

      assert.ok(metadata);
      assert.strictEqual(metadata.name, 'legacy-repo');
      assert.strictEqual(metadata.status, 'active');
      assert.ok(metadata.createdAt);
    });
  });

  describe('create', () => {
    it('creates a new repo with active status', async () => {
      await store.create('my-repo');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status, 'active');
    });

    it('creates all required directories', async () => {
      await store.create('my-repo');

      const repoDir = join(testDir, 'my-repo');
      assert.strictEqual(existsSync(join(repoDir, 'objects')), true);
      assert.strictEqual(existsSync(join(repoDir, 'packages')), true);
      assert.strictEqual(existsSync(join(repoDir, 'executions')), true);
      assert.strictEqual(existsSync(join(repoDir, 'workspaces')), true);
    });

    it('creates metadata file', async () => {
      await store.create('my-repo');

      const metadataPath = join(testDir, 'my-repo', '.e3-metadata.json');
      assert.strictEqual(existsSync(metadataPath), true);

      const content = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      assert.strictEqual(content.name, 'my-repo');
      assert.strictEqual(content.status, 'active');
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
  });

  describe('remove', () => {
    it('removes a repo and its directory', async () => {
      await store.create('my-repo');
      await store.remove('my-repo');

      const exists = await store.exists('my-repo');
      assert.strictEqual(exists, false);

      const dirExists = existsSync(join(testDir, 'my-repo'));
      assert.strictEqual(dirExists, false);
    });

    it('does not throw for non-existent repo', async () => {
      await store.remove('nonexistent');
      // Should not throw
    });
  });

  describe('deleteRefsBatch', () => {
    it('deletes packages, workspaces, executions, locks directories', async () => {
      await store.create('my-repo');
      const repoDir = join(testDir, 'my-repo');

      // Create some refs
      const packagesDir = join(repoDir, 'packages', 'test-pkg');
      mkdirSync(packagesDir, { recursive: true });
      writeFileSync(join(packagesDir, '1.0.0'), 'abc123');

      const result = await store.deleteRefsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.ok(result.deleted >= 1);

      // Packages dir should be empty now
      assert.strictEqual(existsSync(join(packagesDir, '1.0.0')), false);
    });
  });

  describe('deleteObjectsBatch', () => {
    it('deletes objects directory contents', async () => {
      await store.create('my-repo');
      const repoDir = join(testDir, 'my-repo');

      // Create an object
      const objectDir = join(repoDir, 'objects', 'ab');
      mkdirSync(objectDir, { recursive: true });
      writeFileSync(join(objectDir, 'cd1234.beast2'), 'test data');

      const result = await store.deleteObjectsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.ok(result.deleted >= 1);
    });
  });

  describe('GC primitives', () => {
    // GC primitives receive the full repo path (same as ObjectStore/RefStore),
    // not a repo name relative to reposDir.

    it('gcScanPackageRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanPackageRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
      assert.strictEqual(result.cursor, undefined);
    });

    it('gcScanWorkspaceRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanWorkspaceRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
    });

    it('gcScanExecutionRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanExecutionRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
    });

    it('gcScanObjects returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanObjects(repoPath);
      assert.deepStrictEqual(result.objects, []);
      assert.strictEqual(result.cursor, undefined);
    });

    it('gcScanObjects enumerates objects', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      // Create a fake object file
      const objDir = join(repoPath, 'objects', 'ab');
      mkdirSync(objDir, { recursive: true });
      writeFileSync(join(objDir, 'cd' + '0'.repeat(60) + '.beast2'), 'data');

      const result = await store.gcScanObjects(repoPath);
      assert.strictEqual(result.objects.length, 1);
      assert.strictEqual(result.objects[0].hash, 'ab' + 'cd' + '0'.repeat(60));
    });

    it('gcDeleteObjects removes objects', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const hash = 'ab' + 'cd' + '0'.repeat(60);
      const objDir = join(repoPath, 'objects', 'ab');
      mkdirSync(objDir, { recursive: true });
      writeFileSync(join(objDir, 'cd' + '0'.repeat(60) + '.beast2'), 'data');

      await store.gcDeleteObjects(repoPath, [hash]);

      const result = await store.gcScanObjects(repoPath);
      assert.strictEqual(result.objects.length, 0);
    });
  });
});
