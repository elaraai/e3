/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Integration tests for `e3 repo create` command
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

describe('e3 repo create', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  it('creates a new repository', async () => {
    // Create the test directory (e3 repo create expects it to exist)
    mkdirSync(testDir, { recursive: true });

    // Run e3 repo create with '.' to use current directory
    const result = await runE3Command(['repo', 'create', '.'], testDir);

    // Check exit code
    assert.strictEqual(result.exitCode, 0, `e3 repo create failed: ${result.stderr}`);

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
    const firstResult = await runE3Command(['repo', 'create', '.'], testDir);
    assert.strictEqual(firstResult.exitCode, 0);

    // Try to initialize again
    const secondResult = await runE3Command(['repo', 'create', '.'], testDir);

    // Should fail
    assert.notStrictEqual(secondResult.exitCode, 0);
    // Check either stdout or stderr for error message
    const output = secondResult.stdout + secondResult.stderr;
    assert.match(output, /already exists/i);
  });

  it('creates directory if it does not exist', async () => {
    // Create the test directory but try to create repo in a subdirectory that doesn't exist
    mkdirSync(testDir, { recursive: true });
    const nonExistentSubdir = join(testDir, 'nonexistent');

    // Run from testDir but specify nonexistent subdir as repo path
    // e3 repo create should create the directory (like git init does)
    const result = await runE3Command(['repo', 'create', nonExistentSubdir], testDir);
    // Should succeed since it creates the directory
    assert.strictEqual(result.exitCode, 0, `repo create failed: ${result.stderr}`);

    // Verify the repo was created
    assert.ok(existsSync(join(nonExistentSubdir, '.e3')), '.e3 directory should exist');
  });

  it('works in current directory when using . as path', async () => {
    // Create the test directory
    mkdirSync(testDir, { recursive: true });

    // Run e3 repo create with '.' to use current directory
    const result = await runE3Command(['repo', 'create', '.'], testDir);

    // Should succeed
    assert.strictEqual(result.exitCode, 0);

    // Verify .e3 directory exists
    const e3Dir = join(testDir, '.e3');
    assert.ok(existsSync(e3Dir));
  });

  it('creates empty repository structure', async () => {
    // Create the test directory
    mkdirSync(testDir, { recursive: true });

    // Run e3 repo create with '.' to use current directory
    const result = await runE3Command(['repo', 'create', '.'], testDir);
    assert.strictEqual(result.exitCode, 0);

    // Verify all required directories exist and are empty (or close to it)
    const e3Dir = join(testDir, '.e3');
    const objectsDir = join(e3Dir, 'objects');
    const packagesDir = join(e3Dir, 'packages');

    assert.ok(existsSync(objectsDir), 'objects directory should exist');
    assert.ok(existsSync(packagesDir), 'packages directory should exist');
  });
});

describe('e3 repo remove', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  it('removes an existing repository', async () => {
    // Create the test directory and initialize a repo
    mkdirSync(testDir, { recursive: true });
    await runE3Command(['repo', 'create', '.'], testDir);

    const e3Dir = join(testDir, '.e3');
    assert.ok(existsSync(e3Dir), '.e3 directory should exist before remove');

    // Remove the repository
    const result = await runE3Command(['repo', 'remove', '.'], testDir);

    assert.strictEqual(result.exitCode, 0, `repo remove failed: ${result.stderr}`);
    assert.ok(!existsSync(e3Dir), '.e3 directory should not exist after remove');
    assert.match(result.stdout, /removed/i);
  });

  it('removes repository at specified path', async () => {
    // Create test directory with a subdirectory for the repo
    mkdirSync(testDir, { recursive: true });
    const repoSubdir = join(testDir, 'my-repo');
    mkdirSync(repoSubdir, { recursive: true });

    await runE3Command(['repo', 'create', repoSubdir], testDir);

    const e3Dir = join(repoSubdir, '.e3');
    assert.ok(existsSync(e3Dir), '.e3 directory should exist before remove');

    // Remove using absolute path
    const result = await runE3Command(['repo', 'remove', repoSubdir], testDir);

    assert.strictEqual(result.exitCode, 0, `repo remove failed: ${result.stderr}`);
    assert.ok(!existsSync(e3Dir), '.e3 directory should not exist after remove');
  });
});
