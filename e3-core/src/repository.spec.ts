/**
 * Tests for repository.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  initRepository,
  isValidRepository,
  findRepository,
  getRepository,
  setTaskRef,
  deleteTaskRef,
  listTaskRefs,
} from './repository.js';
import { createTempDir, removeTempDir } from './test-helpers.js';

describe('repository', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(testDir);
  });

  describe('initRepository', () => {
    it('creates .e3 directory', () => {
      const result = initRepository(testDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(existsSync(join(testDir, '.e3')), true);
    });

    it('creates all required directories', () => {
      const result = initRepository(testDir);

      assert.strictEqual(result.success, true);

      const e3Dir = join(testDir, '.e3');
      assert.strictEqual(existsSync(join(e3Dir, 'objects')), true);
      assert.strictEqual(existsSync(join(e3Dir, 'queue', 'node')), true);
      assert.strictEqual(existsSync(join(e3Dir, 'claims', 'node')), true);
      assert.strictEqual(existsSync(join(e3Dir, 'refs', 'tasks')), true);
      assert.strictEqual(existsSync(join(e3Dir, 'tasks')), true);
      assert.strictEqual(existsSync(join(e3Dir, 'tmp')), true);
    });

    it('returns e3Dir path in result', () => {
      const result = initRepository(testDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.e3Dir, join(testDir, '.e3'));
    });

    it('fails if .e3 already exists', () => {
      // First init succeeds
      const result1 = initRepository(testDir);
      assert.strictEqual(result1.success, true);

      // Second init fails
      const result2 = initRepository(testDir);
      assert.strictEqual(result2.success, false);
      assert.strictEqual(result2.alreadyExists, true);
      assert.strictEqual(result2.error?.message.includes('already exists'), true);
    });

    it('creates repo in nested path', () => {
      const nestedDir = join(testDir, 'foo', 'bar', 'baz');
      mkdirSync(nestedDir, { recursive: true });

      const result = initRepository(nestedDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(existsSync(join(nestedDir, '.e3')), true);
    });

    it('resolves relative paths', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const result = initRepository('.');

        assert.strictEqual(result.success, true);
        assert.strictEqual(existsSync(join(testDir, '.e3')), true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('isValidRepository', () => {
    it('returns true for valid repository', () => {
      initRepository(testDir);

      const e3Dir = join(testDir, '.e3');
      const isValid = isValidRepository(e3Dir);

      assert.strictEqual(isValid, true);
    });

    it('returns false for non-existent directory', () => {
      const isValid = isValidRepository(join(testDir, 'nonexistent'));

      assert.strictEqual(isValid, false);
    });

    it('returns false if missing objects directory', () => {
      initRepository(testDir);

      const e3Dir = join(testDir, '.e3');
      const objectsDir = join(e3Dir, 'objects');
      removeTempDir(objectsDir);

      const isValid = isValidRepository(e3Dir);

      assert.strictEqual(isValid, false);
    });

    it('returns false if missing queue directory', () => {
      initRepository(testDir);

      const e3Dir = join(testDir, '.e3');
      const queueDir = join(e3Dir, 'queue');
      removeTempDir(queueDir);

      const isValid = isValidRepository(e3Dir);

      assert.strictEqual(isValid, false);
    });

    it('returns false if missing refs directory', () => {
      initRepository(testDir);

      const e3Dir = join(testDir, '.e3');
      const refsDir = join(e3Dir, 'refs');
      removeTempDir(refsDir);

      const isValid = isValidRepository(e3Dir);

      assert.strictEqual(isValid, false);
    });

    it('returns false if missing tasks directory', () => {
      initRepository(testDir);

      const e3Dir = join(testDir, '.e3');
      const tasksDir = join(e3Dir, 'tasks');
      removeTempDir(tasksDir);

      const isValid = isValidRepository(e3Dir);

      assert.strictEqual(isValid, false);
    });

    it('returns false if missing tmp directory', () => {
      initRepository(testDir);

      const e3Dir = join(testDir, '.e3');
      const tmpDir = join(e3Dir, 'tmp');
      removeTempDir(tmpDir);

      const isValid = isValidRepository(e3Dir);

      assert.strictEqual(isValid, false);
    });

    it('returns false for empty directory', () => {
      const emptyDir = join(testDir, 'empty');
      mkdirSync(emptyDir);

      const isValid = isValidRepository(emptyDir);

      assert.strictEqual(isValid, false);
    });
  });

  describe('findRepository', () => {
    it('finds repository in current directory', () => {
      initRepository(testDir);

      const found = findRepository(testDir);

      assert.strictEqual(found, join(testDir, '.e3'));
    });

    it('finds repository in parent directory', () => {
      initRepository(testDir);

      const subDir = join(testDir, 'subdir');
      mkdirSync(subDir);

      const found = findRepository(subDir);

      assert.strictEqual(found, join(testDir, '.e3'));
    });

    it('finds repository in ancestor directory', () => {
      initRepository(testDir);

      const deepDir = join(testDir, 'a', 'b', 'c', 'd');
      mkdirSync(deepDir, { recursive: true });

      const found = findRepository(deepDir);

      assert.strictEqual(found, join(testDir, '.e3'));
    });

    it('returns null if no repository found', () => {
      const found = findRepository(testDir);

      assert.strictEqual(found, null);
    });

    it('prefers closer repository', () => {
      // Create repo in testDir
      initRepository(testDir);

      // Create nested dir and repo there
      const nestedDir = join(testDir, 'nested');
      mkdirSync(nestedDir);
      initRepository(nestedDir);

      const found = findRepository(nestedDir);

      // Should find the closer one
      assert.strictEqual(found, join(nestedDir, '.e3'));
    });

    it('uses E3_REPO environment variable if set', () => {
      initRepository(testDir);

      const originalEnv = process.env.E3_REPO;
      try {
        process.env.E3_REPO = join(testDir, '.e3');

        // Find from different directory
        const otherDir = createTempDir();
        const found = findRepository(otherDir);

        assert.strictEqual(found, join(testDir, '.e3'));

        removeTempDir(otherDir);
      } finally {
        if (originalEnv !== undefined) {
          process.env.E3_REPO = originalEnv;
        } else {
          delete process.env.E3_REPO;
        }
      }
    });

    it('ignores invalid E3_REPO', () => {
      initRepository(testDir);

      const originalEnv = process.env.E3_REPO;
      try {
        process.env.E3_REPO = join(testDir, 'nonexistent');

        const found = findRepository(testDir);

        // Should fall back to directory search
        assert.strictEqual(found, join(testDir, '.e3'));
      } finally {
        if (originalEnv !== undefined) {
          process.env.E3_REPO = originalEnv;
        } else {
          delete process.env.E3_REPO;
        }
      }
    });
  });

  describe('getRepository', () => {
    it('returns repository path if found', () => {
      initRepository(testDir);

      const repo = getRepository(testDir);

      assert.strictEqual(repo, join(testDir, '.e3'));
    });

    it('throws if repository not found', () => {
      assert.throws(
        () => getRepository(testDir),
        /E3 repository not found/
      );
    });
  });

  describe('setTaskRef', () => {
    let repoPath: string;

    beforeEach(() => {
      initRepository(testDir);
      repoPath = join(testDir, '.e3');
    });

    it('creates task ref file', async () => {
      const taskId = 'abc123';
      await setTaskRef(repoPath, 'my-task', taskId);

      const refPath = join(repoPath, 'refs', 'tasks', 'my-task');
      assert.strictEqual(existsSync(refPath), true);
    });

    it('writes task ID to ref file', async () => {
      const taskId = 'abc123';
      await setTaskRef(repoPath, 'my-task', taskId);

      const refPath = join(repoPath, 'refs', 'tasks', 'my-task');
      const content = await import('fs/promises').then((fs) => fs.readFile(refPath, 'utf-8'));

      assert.strictEqual(content, taskId);
    });

    it('overwrites existing ref', async () => {
      await setTaskRef(repoPath, 'my-task', 'abc123');
      await setTaskRef(repoPath, 'my-task', 'def456');

      const refPath = join(repoPath, 'refs', 'tasks', 'my-task');
      const content = await import('fs/promises').then((fs) => fs.readFile(refPath, 'utf-8'));

      assert.strictEqual(content, 'def456');
    });

    it('handles refs with special characters', async () => {
      await setTaskRef(repoPath, 'my-task_v2.0', 'abc123');

      const refPath = join(repoPath, 'refs', 'tasks', 'my-task_v2.0');
      assert.strictEqual(existsSync(refPath), true);
    });
  });

  describe('deleteTaskRef', () => {
    let repoPath: string;

    beforeEach(() => {
      initRepository(testDir);
      repoPath = join(testDir, '.e3');
    });

    it('deletes existing ref', async () => {
      await setTaskRef(repoPath, 'my-task', 'abc123');

      const refPath = join(repoPath, 'refs', 'tasks', 'my-task');
      assert.strictEqual(existsSync(refPath), true);

      await deleteTaskRef(repoPath, 'my-task');

      assert.strictEqual(existsSync(refPath), false);
    });

    it('throws if ref does not exist', async () => {
      await assert.rejects(
        async () => await deleteTaskRef(repoPath, 'nonexistent'),
        /ENOENT/
      );
    });
  });

  describe('listTaskRefs', () => {
    let repoPath: string;

    beforeEach(() => {
      initRepository(testDir);
      repoPath = join(testDir, '.e3');
    });

    it('returns empty array for no refs', async () => {
      const refs = await listTaskRefs(repoPath);

      assert.deepStrictEqual(refs, []);
    });

    it('lists single ref', async () => {
      await setTaskRef(repoPath, 'task1', 'abc123');

      const refs = await listTaskRefs(repoPath);

      assert.deepStrictEqual(refs, ['task1']);
    });

    it('lists multiple refs', async () => {
      await setTaskRef(repoPath, 'task1', 'abc123');
      await setTaskRef(repoPath, 'task2', 'def456');
      await setTaskRef(repoPath, 'task3', 'ghi789');

      const refs = await listTaskRefs(repoPath);
      refs.sort(); // Sort for consistent comparison

      assert.deepStrictEqual(refs, ['task1', 'task2', 'task3']);
    });

    it('does not include deleted refs', async () => {
      await setTaskRef(repoPath, 'task1', 'abc123');
      await setTaskRef(repoPath, 'task2', 'def456');
      await deleteTaskRef(repoPath, 'task1');

      const refs = await listTaskRefs(repoPath);

      assert.deepStrictEqual(refs, ['task2']);
    });

    it('returns empty array if refs directory does not exist', async () => {
      // Remove refs directory
      removeTempDir(join(repoPath, 'refs'));

      const refs = await listTaskRefs(repoPath);

      assert.deepStrictEqual(refs, []);
    });
  });
});
