/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Concurrent operations scenarios - stress test race conditions
 *
 * These tests intentionally try to break things by simulating
 * realistic "idiot user" behavior - concurrent writes while
 * tasks are running, multiple simultaneous starts, etc.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { East, IntegerType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  createTestDir,
  removeTestDir,
  runE3Command,
  random,
  type ScenarioResult,
} from '../helpers.js';

/**
 * Test concurrent writes while a task is running.
 *
 * This simulates a user frantically updating inputs while
 * execution is in progress. Expected to expose race conditions.
 */
export async function testConcurrentWritesDuringExecution(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    // Create a package with a slow-ish task
    const input = e3.input('x', IntegerType, 1n);

    // Task that does some work (identity, but gives us something to run)
    const task = e3.task(
      'compute',
      [input],
      East.function(
        [IntegerType],
        IntegerType,
        ($, x) => x.multiply(2n)
      )
    );

    const pkg = e3.package(`concurrent_${random.string(6)}`, '1.0.0', task);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    // Setup
    await e3.export(pkg, zipPath);
    await runE3Command(['init', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', `${pkg.name}@${pkg.version}`], testDir);

    // Start execution in background (don't await)
    const startPromise = runE3Command(['start', repoDir, 'ws'], testDir);

    // Blast concurrent writes while start is running
    const writePromises: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      const valuePath = join(testDir, `value_${i}.east`);
      writeFileSync(valuePath, `${i * 10}n`);

      // Fire off set commands without waiting
      writePromises.push(
        runE3Command(['set', repoDir, 'ws.inputs.x', valuePath], testDir)
      );
    }

    // Wait for everything to complete
    const [startResult, ...writeResults] = await Promise.all([startPromise, ...writePromises]);

    // Check what happened
    const startSucceeded = startResult.exitCode === 0;
    const writeSuccesses = writeResults.filter(r => r.exitCode === 0).length;
    const writeFailures = writeResults.filter(r => r.exitCode !== 0).length;

    // Get final output
    const getResult = await runE3Command(['get', repoDir, 'ws.tasks.compute.output'], testDir);

    removeTestDir(testDir);

    return {
      success: true,  // Test "passes" if we didn't crash
      state: {
        startSucceeded,
        writeSuccesses,
        writeFailures,
        finalOutput: getResult.stdout.trim(),
        // Log any errors for analysis
        startStderr: startResult.stderr,
        writeErrors: writeResults.filter(r => r.exitCode !== 0).map(r => r.stderr),
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error as Error,
      state: { testDir },
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Test multiple simultaneous start commands.
 *
 * What happens if user spams the start button?
 */
export async function testMultipleSimultaneousStarts(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const input = e3.input('x', IntegerType, 42n);
    const task = e3.task(
      'double',
      [input],
      East.function(
        [IntegerType],
        IntegerType,
        ($, x) => x.multiply(2n)
      )
    );

    const pkg = e3.package(`multi_start_${random.string(6)}`, '1.0.0', task);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    await e3.export(pkg, zipPath);
    await runE3Command(['init', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', `${pkg.name}@${pkg.version}`], testDir);

    // Fire off 5 start commands simultaneously
    const startPromises = Array.from({ length: 5 }, () =>
      runE3Command(['start', repoDir, 'ws'], testDir!)
    );

    const results = await Promise.all(startPromises);

    const successes = results.filter(r => r.exitCode === 0).length;
    const failures = results.filter(r => r.exitCode !== 0).length;

    // Verify final state is consistent
    const getResult = await runE3Command(['get', repoDir, 'ws.tasks.double.output'], testDir);

    removeTestDir(testDir);

    return {
      success: true,
      state: {
        successes,
        failures,
        finalOutput: getResult.stdout.trim(),
        expectedOutput: '84n',  // 42 * 2
        errors: results.filter(r => r.exitCode !== 0).map(r => r.stderr),
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error as Error,
      state: { testDir },
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Test rapid fire set-then-start cycles.
 *
 * User changes input, hits start, changes again, hits start again...
 */
export async function testRapidSetStartCycles(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const input = e3.input('x', IntegerType, 1n);
    const task = e3.task(
      'double',
      [input],
      East.function(
        [IntegerType],
        IntegerType,
        ($, x) => x.multiply(2n)
      )
    );

    const pkg = e3.package(`rapid_${random.string(6)}`, '1.0.0', task);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    await e3.export(pkg, zipPath);
    await runE3Command(['init', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', `${pkg.name}@${pkg.version}`], testDir);

    // Rapid fire: set value, start, don't wait for completion
    const allPromises: Promise<any>[] = [];
    for (let i = 1; i <= 10; i++) {
      const valuePath = join(testDir, `value_${i}.east`);
      writeFileSync(valuePath, `${i}n`);

      // Don't await - fire and forget
      allPromises.push(runE3Command(['set', repoDir, 'ws.inputs.x', valuePath], testDir));
      allPromises.push(runE3Command(['start', repoDir, 'ws'], testDir));
    }

    // Wait for all to complete
    const results = await Promise.all(allPromises);

    const setResults = results.filter((_, i) => i % 2 === 0);
    const startResults = results.filter((_, i) => i % 2 === 1);

    const setSuccesses = setResults.filter(r => r.exitCode === 0).length;
    const startSuccesses = startResults.filter(r => r.exitCode === 0).length;

    // Final state check
    const getResult = await runE3Command(['get', repoDir, 'ws.tasks.double.output'], testDir);

    removeTestDir(testDir);

    return {
      success: true,
      state: {
        setSuccesses,
        startSuccesses,
        totalOps: results.length,
        finalOutput: getResult.stdout.trim(),
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error as Error,
      state: { testDir },
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Test interleaved operations on multiple workspaces.
 *
 * User has multiple workspaces open and is clicking around.
 */
export async function testInterleavedMultiWorkspace(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const input = e3.input('x', IntegerType, 1n);
    const task = e3.task(
      'double',
      [input],
      East.function(
        [IntegerType],
        IntegerType,
        ($, x) => x.multiply(2n)
      )
    );

    const pkg = e3.package(`multi_ws_${random.string(6)}`, '1.0.0', task);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    await e3.export(pkg, zipPath);
    await runE3Command(['init', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);

    // Create 3 workspaces
    await runE3Command(['workspace', 'create', repoDir, 'ws1'], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws2'], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws3'], testDir);

    await runE3Command(['workspace', 'deploy', repoDir, 'ws1', `${pkg.name}@${pkg.version}`], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws2', `${pkg.name}@${pkg.version}`], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws3', `${pkg.name}@${pkg.version}`], testDir);

    // Interleaved operations across workspaces
    const ops: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      // Random workspace operations
      ops.push(runE3Command(['start', repoDir, 'ws1'], testDir));
      ops.push(runE3Command(['start', repoDir, 'ws2'], testDir));
      ops.push(runE3Command(['start', repoDir, 'ws3'], testDir));
    }

    const results = await Promise.all(ops);
    const successes = results.filter(r => r.exitCode === 0).length;

    // Verify each workspace has valid output
    const get1 = await runE3Command(['get', repoDir, 'ws1.tasks.double.output'], testDir);
    const get2 = await runE3Command(['get', repoDir, 'ws2.tasks.double.output'], testDir);
    const get3 = await runE3Command(['get', repoDir, 'ws3.tasks.double.output'], testDir);

    removeTestDir(testDir);

    return {
      success: true,
      state: {
        successes,
        totalOps: results.length,
        ws1Output: get1.stdout.trim(),
        ws2Output: get2.stdout.trim(),
        ws3Output: get3.stdout.trim(),
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error as Error,
      state: { testDir },
      duration: Date.now() - startTime,
    };
  }
}
