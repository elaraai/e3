/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Integration tests for task execution workflow
 *
 * Tests the full workflow:
 * 1. Initialize repository
 * 2. Compile IR using East builders
 * 3. Submit task (e3 run)
 * 4. Check task status (should be pending without runner)
 * 5. Retrieve task IR and arguments by hash
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';
import {
  createSimpleFunctionIR,
  createIdentityFunctionIR,
  createAddFunctionIR,
  createIntegerValue,
} from './ir-helpers.js';

describe('task execution workflow', () => {
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

  it('submits a simple task (no arguments) and checks status', async () => {
    // Initialize repository
    const initResult = await runE3Command(['init'], testDir);
    assert.strictEqual(initResult.exitCode, 0, `init failed: ${initResult.stderr}`);

    // Create IR: () => 42
    const irPath = createSimpleFunctionIR(testDir, 'simple.beast2');

    // Submit task
    const runResult = await runE3Command(['run', 'simple-task', irPath], testDir);
    assert.strictEqual(runResult.exitCode, 0, `run failed: ${runResult.stderr}`);

    // Verify success message
    assert.match(runResult.stdout, /queued successfully/i);

    // Check task status - should be pending (no runner)
    const statusResult = await runE3Command(['status', 'simple-task'], testDir);
    assert.strictEqual(statusResult.exitCode, 0, `status failed: ${statusResult.stderr}`);

    // Should show pending status
    assert.match(statusResult.stdout, /pending/i);

    // Verify task ref was created
    const refPath = join(e3Dir, 'refs', 'tasks', 'simple-task');
    assert.ok(existsSync(refPath), 'task ref should exist');

    // Verify queue file was created
    const queueDir = join(e3Dir, 'queue', 'node');
    assert.ok(existsSync(queueDir), 'queue directory should exist');
  });

  it('submits a task with one argument', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create IR: (x: Integer) => x
    const irPath = createIdentityFunctionIR(testDir);

    // Create argument: 42
    const argPath = createIntegerValue(testDir, 42, 'arg.east');

    // Submit task with argument
    const runResult = await runE3Command(['run', 'identity-task', irPath, argPath], testDir);
    assert.strictEqual(runResult.exitCode, 0, `run failed: ${runResult.stderr}`);

    // Verify submission
    assert.match(runResult.stdout, /queued successfully/i);
    assert.match(runResult.stdout, /Arguments: 1/i);

    // Check status
    const statusResult = await runE3Command(['status', 'identity-task'], testDir);
    assert.strictEqual(statusResult.exitCode, 0);
    assert.match(statusResult.stdout, /pending/i);
  });

  it('submits a task with multiple arguments', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create IR: (a: Integer, b: Integer) => a + b
    const irPath = createAddFunctionIR(testDir);

    // Create arguments
    const arg1Path = createIntegerValue(testDir, 10, 'arg1.east');
    const arg2Path = createIntegerValue(testDir, 32, 'arg2.east');

    // Submit task
    const runResult = await runE3Command(['run', 'add-task', irPath, arg1Path, arg2Path], testDir);
    assert.strictEqual(runResult.exitCode, 0, `run failed: ${runResult.stderr}`);

    // Verify submission
    assert.match(runResult.stdout, /queued successfully/i);
    assert.match(runResult.stdout, /Arguments: 2/i);
  });

  it('retrieves task IR by hash', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create and submit task
    const irPath = createSimpleFunctionIR(testDir);
    const runResult = await runE3Command(['run', 'my-task', irPath], testDir);
    assert.strictEqual(runResult.exitCode, 0);

    // Extract IR hash from output
    const irHashMatch = runResult.stdout.match(/IR.*?([0-9a-f]{64})/i);
    assert.ok(irHashMatch, 'should find IR hash in output');
    const irHash = irHashMatch[1];

    // Retrieve IR by hash
    const getResult = await runE3Command(['get', irHash, '--format', 'east'], testDir);
    assert.strictEqual(getResult.exitCode, 0, `get failed: ${getResult.stderr}`);

    // Verify the retrieved IR mentions Function
    assert.match(getResult.stdout, /Function/i);
  });

  it('retrieves task argument by hash', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create task with argument
    const irPath = createIdentityFunctionIR(testDir);
    const argPath = createIntegerValue(testDir, 100);

    const runResult = await runE3Command(['run', 'test-task', irPath, argPath], testDir);
    assert.strictEqual(runResult.exitCode, 0);

    // Extract argument hash from output
    // Format is: "Argument Hashes:\n    [0]: <hash>"
    const argHashMatch = runResult.stdout.match(/\[0\]:\s*([0-9a-f]{64})/i);
    assert.ok(argHashMatch, 'should find argument hash in output');
    const argHash = argHashMatch[1];

    // Retrieve argument by hash
    const getResult = await runE3Command(['get', argHash, '--format', 'east'], testDir);
    assert.strictEqual(getResult.exitCode, 0, `get failed: ${getResult.stderr}`);

    // Verify the retrieved argument is 100
    assert.match(getResult.stdout, /100/);
  });

  it('lists submitted tasks', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create IR
    const irPath = createSimpleFunctionIR(testDir);

    // Submit multiple tasks
    await runE3Command(['run', 'task-one', irPath], testDir);
    await runE3Command(['run', 'task-two', irPath], testDir);
    await runE3Command(['run', 'task-three', irPath], testDir);

    // List all tasks
    const listResult = await runE3Command(['list'], testDir);
    assert.strictEqual(listResult.exitCode, 0, `list failed: ${listResult.stderr}`);

    // Verify all task names appear
    assert.match(listResult.stdout, /task-one/);
    assert.match(listResult.stdout, /task-two/);
    assert.match(listResult.stdout, /task-three/);
  });

  it('shows task details in status', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Submit task
    const irPath = createSimpleFunctionIR(testDir);
    await runE3Command(['run', 'detailed-task', irPath], testDir);

    // Check status
    const statusResult = await runE3Command(['status', 'detailed-task'], testDir);
    assert.strictEqual(statusResult.exitCode, 0);

    // Should show task name and status
    assert.match(statusResult.stdout, /detailed-task/);
    assert.match(statusResult.stdout, /pending/i);

    // Should show task ID
    assert.match(statusResult.stdout, /task/i);
  });

  it('fails gracefully when submitting task with wrong argument count', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create IR that expects 2 arguments: (a, b) => a + b
    const irPath = createAddFunctionIR(testDir);

    // Try to submit with only 1 argument
    const argPath = createIntegerValue(testDir, 10);
    const runResult = await runE3Command(['run', 'bad-task', irPath, argPath], testDir);

    // Should fail
    assert.notStrictEqual(runResult.exitCode, 0);

    // Error should mention argument count
    const output = runResult.stdout + runResult.stderr;
    assert.match(output, /argument/i);
  });
});
