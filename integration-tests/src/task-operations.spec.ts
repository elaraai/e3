/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Integration tests for basic task operations
 *
 * Note: These tests focus on repository operations and object storage.
 * Full task execution tests (requiring function IR compilation) are deferred
 * until we have better IR generation capabilities in the test suite.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

describe('task operations - basic repository functionality', () => {
  let testDir: string;
  let e3Dir: string;

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    e3Dir = join(testDir, '.e3');
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  it('initializes repository and lists tasks (empty)', async () => {
    // Initialize repository
    const initResult = await runE3Command(['init'], testDir);
    assert.strictEqual(initResult.exitCode, 0, `init failed: ${initResult.stderr}`);

    // List tasks (should be empty initially)
    const listResult = await runE3Command(['list'], testDir);
    assert.strictEqual(listResult.exitCode, 0, `list failed: ${listResult.stderr}`);

    // Output should indicate no tasks or be empty
    // (exact format depends on implementation)
  });

  it('shows helpful error for non-existent task status', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Try to get status of non-existent task
    const statusResult = await runE3Command(['status', 'nonexistent-task'], testDir);

    // Should fail gracefully
    assert.notStrictEqual(statusResult.exitCode, 0);

    // Output should mention the task not being found
    const output = statusResult.stdout + statusResult.stderr;
    assert.ok(
      output.includes('not found') || output.includes('does not exist') || output.includes('ENOENT'),
      'Error message should indicate task not found'
    );
  });

  it('shows helpful error for non-existent task in get command', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Try to get non-existent task
    const getResult = await runE3Command(['get', 'nonexistent-task'], testDir);

    // Should fail gracefully
    assert.notStrictEqual(getResult.exitCode, 0);

    // Output should mention not found (case insensitive)
    const output = (getResult.stdout + getResult.stderr).toLowerCase();
    assert.ok(
      output.includes('not found') || output.includes('does not exist') || output.includes('enoent') || output.includes('no task found'),
      'Error message should indicate not found'
    );
  });

  it('shows helpful error when get is used with invalid hash', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Try to get object with invalid/non-existent hash
    const fakeHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const getResult = await runE3Command(['get', fakeHash], testDir);

    // Should fail gracefully
    assert.notStrictEqual(getResult.exitCode, 0);

    // Output should mention not found or ENOENT (case insensitive)
    const output = (getResult.stdout + getResult.stderr).toLowerCase();
    assert.ok(
      output.includes('not found') || output.includes('does not exist') || output.includes('enoent'),
      'Error message should indicate object not found'
    );
  });

  it('repository structure persists after initialization', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Verify all expected directories exist
    const expectedDirs = [
      join(e3Dir, 'objects'),
      join(e3Dir, 'queue', 'node'),
      join(e3Dir, 'claims', 'node'),
      join(e3Dir, 'refs', 'tasks'),
      join(e3Dir, 'tasks'),
      join(e3Dir, 'tmp'),
    ];

    for (const dir of expectedDirs) {
      assert.ok(existsSync(dir), `Directory should exist: ${dir}`);
    }
  });

  it('help commands work', async () => {
    // Test that help commands exit successfully
    const commands = ['init', 'run', 'status', 'get', 'list', 'log'];

    for (const cmd of commands) {
      const helpResult = await runE3Command([cmd, '--help'], testDir);
      assert.strictEqual(helpResult.exitCode, 0, `${cmd} --help should succeed`);
      assert.match(helpResult.stdout, new RegExp(cmd, 'i'), `Help should mention ${cmd}`);
    }
  });
});
