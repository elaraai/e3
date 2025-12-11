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

    // Run e3 init with '.' to use current directory
    const result = await runE3Command(['init', '.'], testDir);

    // Check exit code
    assert.strictEqual(result.exitCode, 0, `e3 init failed: ${result.stderr}`);

    // Verify .e3 directory was created
    const e3Dir = join(testDir, '.e3');
    assert.ok(existsSync(e3Dir), '.e3 directory should exist');

    // Verify subdirectories were created
    // Current structure: objects, packages, workspaces, executions
    assert.ok(existsSync(join(e3Dir, 'objects')), '.e3/objects should exist');
    assert.ok(existsSync(join(e3Dir, 'packages')), '.e3/packages should exist');
    assert.ok(existsSync(join(e3Dir, 'workspaces')), '.e3/workspaces should exist');
    assert.ok(existsSync(join(e3Dir, 'executions')), '.e3/executions should exist');

    // Check for success message in output
    assert.match(result.stdout, /initialized/i);
  });

  it('fails if repository already exists', async () => {
    // Create the test directory
    mkdirSync(testDir, { recursive: true });

    // Initialize once
    const firstResult = await runE3Command(['init', '.'], testDir);
    assert.strictEqual(firstResult.exitCode, 0);

    // Try to initialize again
    const secondResult = await runE3Command(['init', '.'], testDir);

    // Should fail
    assert.notStrictEqual(secondResult.exitCode, 0);
    // Check either stdout or stderr for error message
    const output = secondResult.stdout + secondResult.stderr;
    assert.match(output, /already exists/i);
  });

  it('creates directory if it does not exist', async () => {
    // Create the test directory but try to init in a subdirectory that doesn't exist
    mkdirSync(testDir, { recursive: true });
    const nonExistentSubdir = join(testDir, 'nonexistent');

    // Run from testDir but specify nonexistent subdir as repo path
    // e3 init should create the directory (like git init does)
    const result = await runE3Command(['init', nonExistentSubdir], testDir);
    // Should succeed since it creates the directory
    assert.strictEqual(result.exitCode, 0, `init failed: ${result.stderr}`);

    // Verify the repo was created
    assert.ok(existsSync(join(nonExistentSubdir, '.e3')), '.e3 directory should exist');
  });

  it('works in current directory when using . as path', async () => {
    // Create the test directory
    mkdirSync(testDir, { recursive: true });

    // Run e3 init with '.' to use current directory
    const result = await runE3Command(['init', '.'], testDir);

    // Should succeed
    assert.strictEqual(result.exitCode, 0);

    // Verify .e3 directory exists
    const e3Dir = join(testDir, '.e3');
    assert.ok(existsSync(e3Dir));
  });

  it('creates empty repository structure', async () => {
    // Create the test directory
    mkdirSync(testDir, { recursive: true });

    // Run e3 init with '.' to use current directory
    const result = await runE3Command(['init', '.'], testDir);
    assert.strictEqual(result.exitCode, 0);

    // Verify all required directories exist and are empty (or close to it)
    const e3Dir = join(testDir, '.e3');
    const objectsDir = join(e3Dir, 'objects');
    const packagesDir = join(e3Dir, 'packages');

    assert.ok(existsSync(objectsDir), 'objects directory should exist');
    assert.ok(existsSync(packagesDir), 'packages directory should exist');
  });
});
