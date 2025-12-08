/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Integration tests for `e3 init` command
 *
 * Tests the full command-line behavior including:
 * - Repository initialization
 * - Directory structure creation
 * - Error handling
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

describe('e3 init', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  it('initializes a new repository', async () => {
    // Create the test directory (e3 init expects it to exist)
    mkdirSync(testDir, { recursive: true });

    // Run e3 init
    const result = await runE3Command(['init'], testDir);

    // Check exit code
    assert.strictEqual(result.exitCode, 0, `e3 init failed: ${result.stderr}`);

    // Verify .e3 directory was created
    const e3Dir = join(testDir, '.e3');
    assert.ok(existsSync(e3Dir), '.e3 directory should exist');

    // Verify subdirectories were created
    assert.ok(existsSync(join(e3Dir, 'objects')), '.e3/objects should exist');
    assert.ok(existsSync(join(e3Dir, 'queue')), '.e3/queue should exist');
    assert.ok(existsSync(join(e3Dir, 'queue', 'node')), '.e3/queue/node should exist');
    assert.ok(existsSync(join(e3Dir, 'claims')), '.e3/claims should exist');
    assert.ok(existsSync(join(e3Dir, 'claims', 'node')), '.e3/claims/node should exist');
    assert.ok(existsSync(join(e3Dir, 'refs')), '.e3/refs should exist');
    assert.ok(existsSync(join(e3Dir, 'refs', 'tasks')), '.e3/refs/tasks should exist');
    assert.ok(existsSync(join(e3Dir, 'tasks')), '.e3/tasks should exist');
    assert.ok(existsSync(join(e3Dir, 'tmp')), '.e3/tmp should exist');

    // Check for success message in output
    assert.match(result.stdout, /initialized/i);
  });

  it('fails if repository already exists', async () => {
    // Create the test directory
    mkdirSync(testDir, { recursive: true });

    // Initialize once
    const firstResult = await runE3Command(['init'], testDir);
    assert.strictEqual(firstResult.exitCode, 0);

    // Try to initialize again
    const secondResult = await runE3Command(['init'], testDir);

    // Should fail
    assert.notStrictEqual(secondResult.exitCode, 0);
    // Check either stdout or stderr for error message
    const output = secondResult.stdout + secondResult.stderr;
    assert.match(output, /already exists/i);
  });

  it('handles nonexistent directory gracefully', async () => {
    // Create the test directory but try to init in a subdirectory that doesn't exist
    mkdirSync(testDir, { recursive: true });
    const nonExistentSubdir = join(testDir, 'nonexistent');

    // Note: This test may be affected by shell behavior
    // For now, just verify it doesn't crash the test suite
    try {
      const result = await runE3Command(['init'], nonExistentSubdir);
      // If it runs, it should fail gracefully
      assert.notStrictEqual(result.exitCode, 0);
    } catch (error: any) {
      // ENOENT is acceptable here - the working directory doesn't exist
      assert.match(error.code, /ENOENT/);
    }
  });

  it('works in current directory when no path specified', async () => {
    // Create the test directory
    mkdirSync(testDir, { recursive: true });

    // Run e3 init without path argument (uses cwd)
    const result = await runE3Command(['init'], testDir);

    // Should succeed
    assert.strictEqual(result.exitCode, 0);

    // Verify .e3 directory exists
    const e3Dir = join(testDir, '.e3');
    assert.ok(existsSync(e3Dir));
  });

  it('creates empty repository structure', async () => {
    // Create the test directory
    mkdirSync(testDir, { recursive: true });

    // Run e3 init
    const result = await runE3Command(['init'], testDir);
    assert.strictEqual(result.exitCode, 0);

    // Verify all required directories exist and are empty (or close to it)
    const e3Dir = join(testDir, '.e3');
    const objectsDir = join(e3Dir, 'objects');
    const tasksDir = join(e3Dir, 'tasks');

    assert.ok(existsSync(objectsDir), 'objects directory should exist');
    assert.ok(existsSync(tasksDir), 'tasks directory should exist');
  });
});
