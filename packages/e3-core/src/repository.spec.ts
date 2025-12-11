/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for repository.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  repoInit,
  repoFind,
  repoGet,
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

  describe('repoInit', () => {
    it('creates .e3 directory', () => {
      const result = repoInit(testDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(existsSync(join(testDir, '.e3')), true);
    });

    it('creates all required directories', () => {
      const result = repoInit(testDir);

      assert.strictEqual(result.success, true);

      const e3Dir = join(testDir, '.e3');
      assert.strictEqual(existsSync(join(e3Dir, 'objects')), true);
      assert.strictEqual(existsSync(join(e3Dir, 'packages')), true);
      assert.strictEqual(existsSync(join(e3Dir, 'executions')), true);
      assert.strictEqual(existsSync(join(e3Dir, 'workspaces')), true);
    });

    it('does not create any config file', () => {
      const result = repoInit(testDir);

      assert.strictEqual(result.success, true);

      const e3Dir = join(testDir, '.e3');
      // No config file should be created - runner config is in tasks
      assert.strictEqual(existsSync(join(e3Dir, 'e3.east')), false);
      assert.strictEqual(existsSync(join(e3Dir, 'e3.beast2')), false);
    });

    it('returns e3Dir path in result', () => {
      const result = repoInit(testDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.e3Dir, join(testDir, '.e3'));
    });

    it('fails if .e3 already exists', () => {
      // First init succeeds
      const result1 = repoInit(testDir);
      assert.strictEqual(result1.success, true);

      // Second init fails
      const result2 = repoInit(testDir);
      assert.strictEqual(result2.success, false);
      assert.strictEqual(result2.alreadyExists, true);
      assert.strictEqual(result2.error?.message.includes('already exists'), true);
    });

    it('creates repo in nested path', () => {
      const nestedDir = join(testDir, 'foo', 'bar', 'baz');
      mkdirSync(nestedDir, { recursive: true });

      const result = repoInit(nestedDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(existsSync(join(nestedDir, '.e3')), true);
    });

    it('resolves relative paths', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const result = repoInit('.');

        assert.strictEqual(result.success, true);
        assert.strictEqual(existsSync(join(testDir, '.e3')), true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('repoFind', () => {
    it('finds repository in current directory', () => {
      repoInit(testDir);

      const found = repoFind(testDir);

      assert.strictEqual(found, join(testDir, '.e3'));
    });

    it('finds repository in parent directory', () => {
      repoInit(testDir);

      const subDir = join(testDir, 'subdir');
      mkdirSync(subDir);

      const found = repoFind(subDir);

      assert.strictEqual(found, join(testDir, '.e3'));
    });

    it('finds repository in ancestor directory', () => {
      repoInit(testDir);

      const deepDir = join(testDir, 'a', 'b', 'c', 'd');
      mkdirSync(deepDir, { recursive: true });

      const found = repoFind(deepDir);

      assert.strictEqual(found, join(testDir, '.e3'));
    });

    it('returns null if no repository found', () => {
      const found = repoFind(testDir);

      assert.strictEqual(found, null);
    });

    it('prefers closer repository', () => {
      // Create repo in testDir
      repoInit(testDir);

      // Create nested dir and repo there
      const nestedDir = join(testDir, 'nested');
      mkdirSync(nestedDir);
      repoInit(nestedDir);

      const found = repoFind(nestedDir);

      // Should find the closer one
      assert.strictEqual(found, join(nestedDir, '.e3'));
    });

    it('uses E3_REPO environment variable if set', () => {
      repoInit(testDir);

      const originalEnv = process.env.E3_REPO;
      try {
        process.env.E3_REPO = join(testDir, '.e3');

        // Find from different directory
        const otherDir = createTempDir();
        const found = repoFind(otherDir);

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
      repoInit(testDir);

      const originalEnv = process.env.E3_REPO;
      try {
        process.env.E3_REPO = join(testDir, 'nonexistent');

        const found = repoFind(testDir);

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

    it('returns false if missing objects directory', () => {
      repoInit(testDir);

      const e3Dir = join(testDir, '.e3');
      const objectsDir = join(e3Dir, 'objects');
      rmSync(objectsDir, { recursive: true });

      const found = repoFind(testDir);

      assert.strictEqual(found, null);
    });

    it('returns false if missing packages directory', () => {
      repoInit(testDir);

      const e3Dir = join(testDir, '.e3');
      const packagesDir = join(e3Dir, 'packages');
      rmSync(packagesDir, { recursive: true });

      const found = repoFind(testDir);

      assert.strictEqual(found, null);
    });

    it('returns false if missing executions directory', () => {
      repoInit(testDir);

      const e3Dir = join(testDir, '.e3');
      const executionsDir = join(e3Dir, 'executions');
      rmSync(executionsDir, { recursive: true });

      const found = repoFind(testDir);

      assert.strictEqual(found, null);
    });

    it('returns false if missing workspaces directory', () => {
      repoInit(testDir);

      const e3Dir = join(testDir, '.e3');
      const workspacesDir = join(e3Dir, 'workspaces');
      rmSync(workspacesDir, { recursive: true });

      const found = repoFind(testDir);

      assert.strictEqual(found, null);
    });
  });

  describe('repoGet', () => {
    it('returns repository path if found', () => {
      repoInit(testDir);

      const repo = repoGet(testDir);

      assert.strictEqual(repo, join(testDir, '.e3'));
    });

    it('throws if repository not found', () => {
      assert.throws(
        () => repoGet(testDir),
        /e3 repository not found/
      );
    });
  });
});
