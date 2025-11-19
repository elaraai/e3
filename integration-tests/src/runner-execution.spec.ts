/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Integration tests for runner execution
 *
 * Tests the full execution workflow:
 * 1. Initialize repository and submit task
 * 2. Start runner process
 * 3. Wait for task completion
 * 4. Retrieve and verify result
 * 5. Clean up runner process
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ChildProcess } from 'node:child_process';
import {
  createTestDir,
  removeTestDir,
  runE3Command,
  startRunner,
  stopRunner,
  stopAllRunners,
  waitFor,
} from './helpers.js';
import {
  createSimpleFunctionIR,
  createIdentityFunctionIR,
  createAddFunctionIR,
  createIntegerValue,
} from './ir-helpers.js';

describe('runner execution', () => {
  let testDir: string;
  let e3Dir: string;
  let activeRunners: ChildProcess[] = [];

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    e3Dir = join(testDir, '.e3');
    activeRunners = [];
  });

  afterEach(() => {
    // Clean up all runners
    for (const runner of activeRunners) {
      stopRunner(runner);
    }
    stopAllRunners();
    removeTestDir(testDir);
  });

  it('runner process starts and stays alive', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Start runner
    const runner = startRunner(testDir);
    activeRunners.push(runner);

    // Wait a bit to ensure runner starts
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check runner is still alive
    assert.strictEqual(runner.killed, false, 'runner should still be alive');

    // Stop runner
    stopRunner(runner);
  });

  it('executes a simple task and retrieves result', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create and submit task: () => 42
    const irPath = createSimpleFunctionIR(testDir);
    await runE3Command(['run', 'simple', irPath], testDir);

    // Verify task is pending
    const statusBefore = await runE3Command(['status', 'simple'], testDir);
    assert.match(statusBefore.stdout, /pending/i);

    // Start runner
    const runner = startRunner(testDir);
    activeRunners.push(runner);

    // Give runner a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Wait for task to complete (check status until completed)
    await waitFor(async () => {
      const result = await runE3Command(['status', 'simple'], testDir);
      return result.stdout.toLowerCase().includes('completed');
    }, 10000);

    // Verify task is completed
    const statusAfter = await runE3Command(['status', 'simple'], testDir);
    assert.match(statusAfter.stdout, /completed/i);

    // Get the result
    const getResult = await runE3Command(['get', 'simple', '--format', 'east'], testDir);
    assert.strictEqual(getResult.exitCode, 0);
    assert.match(getResult.stdout, /42/);

    // Stop runner
    stopRunner(runner);
  });

  it('executes task with argument', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create task: (x) => x, with argument 100
    const irPath = createIdentityFunctionIR(testDir);
    const argPath = createIntegerValue(testDir, 100);
    await runE3Command(['run', 'identity', irPath, argPath], testDir);

    // Start runner
    const runner = startRunner(testDir);
    activeRunners.push(runner);

    // Wait for completion
    await waitFor(async () => {
      const result = await runE3Command(['status', 'identity'], testDir);
      return result.stdout.toLowerCase().includes('completed');
    }, 10000);

    // Verify result is 100
    const getResult = await runE3Command(['get', 'identity', '--format', 'east'], testDir);
    assert.strictEqual(getResult.exitCode, 0);
    assert.match(getResult.stdout, /100/);

    stopRunner(runner);
  });

  it('executes task with multiple arguments', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Create task: (a, b) => a + b, with arguments 10, 32
    const irPath = createAddFunctionIR(testDir);
    const arg1 = createIntegerValue(testDir, 10, 'arg1.east');
    const arg2 = createIntegerValue(testDir, 32, 'arg2.east');
    await runE3Command(['run', 'add-numbers', irPath, arg1, arg2], testDir);

    // Start runner
    const runner = startRunner(testDir);
    activeRunners.push(runner);

    // Wait for completion
    await waitFor(async () => {
      const result = await runE3Command(['status', 'add-numbers'], testDir);
      return result.stdout.toLowerCase().includes('completed');
    }, 10000);

    // Verify result is 42 (10 + 32)
    const getResult = await runE3Command(['get', 'add-numbers', '--format', 'east'], testDir);
    assert.strictEqual(getResult.exitCode, 0);
    assert.match(getResult.stdout, /42/);

    stopRunner(runner);
  });

  it('executes multiple tasks in sequence', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Submit three tasks
    const irPath = createSimpleFunctionIR(testDir);
    await runE3Command(['run', 'task1', irPath], testDir);
    await runE3Command(['run', 'task2', irPath], testDir);
    await runE3Command(['run', 'task3', irPath], testDir);

    // Start runner
    const runner = startRunner(testDir);
    activeRunners.push(runner);

    // Wait for all to complete
    await waitFor(async () => {
      const status1 = await runE3Command(['status', 'task1'], testDir);
      const status2 = await runE3Command(['status', 'task2'], testDir);
      const status3 = await runE3Command(['status', 'task3'], testDir);
      return (
        status1.stdout.toLowerCase().includes('completed') &&
        status2.stdout.toLowerCase().includes('completed') &&
        status3.stdout.toLowerCase().includes('completed')
      );
    }, 15000);

    // Verify all results
    const result1 = await runE3Command(['get', 'task1'], testDir);
    const result2 = await runE3Command(['get', 'task2'], testDir);
    const result3 = await runE3Command(['get', 'task3'], testDir);

    assert.match(result1.stdout, /42/);
    assert.match(result2.stdout, /42/);
    assert.match(result3.stdout, /42/);

    stopRunner(runner);
  });

  it('handles runner termination gracefully', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Submit task
    const irPath = createSimpleFunctionIR(testDir);
    await runE3Command(['run', 'graceful', irPath], testDir);

    // Start runner
    const runner = startRunner(testDir);
    activeRunners.push(runner);

    // Wait for task to complete
    await waitFor(async () => {
      const result = await runE3Command(['status', 'graceful'], testDir);
      return result.stdout.toLowerCase().includes('completed');
    }, 10000);

    // Kill runner
    stopRunner(runner);

    // Verify we can still get the result after runner is stopped
    const getResult = await runE3Command(['get', 'graceful'], testDir);
    assert.strictEqual(getResult.exitCode, 0);
    assert.match(getResult.stdout, /42/);
  });

  it('cleans up runner on timeout', async () => {
    // Initialize repository
    await runE3Command(['init'], testDir);

    // Start runner (no task submitted)
    const runner = startRunner(testDir);
    activeRunners.push(runner);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify runner is still alive
    assert.strictEqual(runner.killed, false);

    // Kill runner
    stopRunner(runner);

    // Wait for process to exit
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify runner was terminated
    assert.strictEqual(runner.killed, true);
  });
});
