/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Reactive dataflow fuzz test scenarios.
 *
 * These tests exercise the reactive re-execution behavior introduced
 * with per-dataset refs: concurrent `e3 set` during execution, version
 * vector consistency in diamond DAGs, fixpoint convergence under rapid
 * mutations, and the dual-lock model (shared workspace + exclusive dataflow).
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
 * Sleep for a random duration up to maxMs, using the seeded RNG
 * for reproducibility.
 */
function randomDelay(maxMs: number): Promise<void> {
  const ms = random.int(0, maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Reactive set during multi-step chain
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify reactive re-execution when input is mutated mid-execution of a
 * 3-task chain. Each task doubles its input: x → x*2 → x*4 → x*8.
 *
 * A concurrent `e3 set` changes x during execution. The final output must
 * be `x*8` for whichever value of x the reactive loop converges to — never
 * a partial result like `newX*4` (which would indicate incomplete re-execution).
 */
export async function testReactiveSetDuringChain(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const input = e3.input('x', IntegerType, 1n);

    const taskA = e3.task(
      'A',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );

    const taskB = e3.task(
      'B',
      [taskA.output],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );

    const taskC = e3.task(
      'C',
      [taskB.output],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );

    const pkg = e3.package(`reactive_chain_${random.string(6)}`, '1.0.0', taskC);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    await e3.export(pkg, zipPath);
    await runE3Command(['repo', 'create', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', `${pkg.name}@${pkg.version}`], testDir);

    const newValue = random.int(2, 100);

    // Start execution and concurrently mutate the input
    const startPromise = runE3Command(['start', repoDir, 'ws'], testDir);

    // Random delay to vary timing of the mutation
    await randomDelay(100);

    const valuePath = join(testDir, 'new_value.east');
    writeFileSync(valuePath, `${newValue}`);
    const setPromise = runE3Command(['set', repoDir, 'ws.inputs.x', valuePath], testDir);

    const [startResult, setResult] = await Promise.all([startPromise, setPromise]);

    if (startResult.exitCode !== 0) {
      throw new Error(`start failed: stdout=${startResult.stdout}, stderr=${startResult.stderr}`);
    }
    if (setResult.exitCode !== 0) {
      throw new Error(`set failed: stdout=${setResult.stdout}, stderr=${setResult.stderr}`);
    }

    // Read final output
    const getResult = await runE3Command(['get', repoDir, 'ws.tasks.C.output'], testDir);
    const output = parseInt(getResult.stdout.trim(), 10);

    removeTestDir(testDir);

    // Output must be x*8 for either the initial value (1) or the new value.
    // It could also be any intermediate value if multiple reactive loops ran.
    // The key invariant: output must be divisible by 8 (each of 3 tasks doubles).
    if (output % 8 !== 0) {
      throw new Error(
        `Inconsistent chain output: ${output} is not divisible by 8. ` +
        `Initial=1, newValue=${newValue}. Expected output = V*8 for some V.`
      );
    }

    const inputUsed = output / 8;
    // The input used should be either 1 (initial) or the new value
    if (inputUsed !== 1 && inputUsed !== newValue) {
      throw new Error(
        `Unexpected chain output: ${output} = ${inputUsed}*8. ` +
        `Expected 1*8=8 or ${newValue}*8=${newValue * 8}.`
      );
    }

    return {
      success: true,
      state: {
        newValue,
        output,
        inputUsed,
        startExitCode: startResult.exitCode,
        setExitCode: setResult.exitCode,
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

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Diamond DAG version vector consistency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify version vector consistency prevents reading stale data in a diamond DAG.
 *
 * Diamond: x → L(x*2), R(x*3), M(L+R) = x*2 + x*3 = x*5
 *
 * A concurrent mutation to x should never produce a mixed result like
 * old_x*2 + new_x*3. The output must always equal x*5 for a single x.
 */
export async function testReactiveDiamondConsistency(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const input = e3.input('x', IntegerType, 1n);

    const taskL = e3.task(
      'left',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );

    const taskR = e3.task(
      'right',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(3n))
    );

    const taskM = e3.task(
      'merge',
      [taskL.output, taskR.output],
      East.function([IntegerType, IntegerType], IntegerType, ($, l, r) => l.add(r))
    );

    const pkg = e3.package(`reactive_diamond_${random.string(6)}`, '1.0.0', taskM);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    await e3.export(pkg, zipPath);
    await runE3Command(['repo', 'create', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', `${pkg.name}@${pkg.version}`], testDir);

    const newValue = random.int(2, 100);

    // Start execution and concurrently mutate the input
    const startPromise = runE3Command(['start', repoDir, 'ws'], testDir);

    await randomDelay(50);

    const valuePath = join(testDir, 'new_value.east');
    writeFileSync(valuePath, `${newValue}`);
    const setPromise = runE3Command(['set', repoDir, 'ws.inputs.x', valuePath], testDir);

    const [startResult, setResult] = await Promise.all([startPromise, setPromise]);

    if (startResult.exitCode !== 0) {
      throw new Error(`start failed: stdout=${startResult.stdout}, stderr=${startResult.stderr}`);
    }
    if (setResult.exitCode !== 0) {
      throw new Error(`set failed: stdout=${setResult.stdout}, stderr=${setResult.stderr}`);
    }

    // Read final output
    const getResult = await runE3Command(['get', repoDir, 'ws.tasks.merge.output'], testDir);
    const output = parseInt(getResult.stdout.trim(), 10);

    removeTestDir(testDir);

    // Invariant: output must equal x*5 for some single value of x.
    // x is either 1 (initial) or newValue.
    if (output % 5 !== 0) {
      throw new Error(
        `Diamond consistency violation: output=${output} is not divisible by 5. ` +
        `This means L and R used different x values! ` +
        `Initial=1, newValue=${newValue}. Expected 5 or ${newValue * 5}.`
      );
    }

    const inputUsed = output / 5;
    if (inputUsed !== 1 && inputUsed !== newValue) {
      throw new Error(
        `Unexpected diamond output: ${output} = ${inputUsed}*5. ` +
        `Expected 1*5=5 or ${newValue}*5=${newValue * 5}.`
      );
    }

    return {
      success: true,
      state: {
        newValue,
        output,
        inputUsed,
        consistent: true,
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

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Concurrent writes to different datasets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify concurrent writes to different input datasets don't corrupt each other.
 *
 * Two independent tasks: A(x)=x*2, B(y)=y*3. Concurrent sets to x and y
 * should produce independent, correct results.
 */
export async function testConcurrentSetDifferentDatasets(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const inputX = e3.input('x', IntegerType, 1n);
    const inputY = e3.input('y', IntegerType, 1n);

    const taskA = e3.task(
      'double_x',
      [inputX],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );

    const taskB = e3.task(
      'triple_y',
      [inputY],
      East.function([IntegerType], IntegerType, ($, y) => y.multiply(3n))
    );

    const pkg = e3.package(`concurrent_set_${random.string(6)}`, '1.0.0', taskA, taskB);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    await e3.export(pkg, zipPath);
    await runE3Command(['repo', 'create', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', `${pkg.name}@${pkg.version}`], testDir);

    // Initial execution
    const initStart = await runE3Command(['start', repoDir, 'ws'], testDir);
    if (initStart.exitCode !== 0) {
      throw new Error(`Initial start failed: stdout=${initStart.stdout}, stderr=${initStart.stderr}`);
    }

    // Concurrent writes to different datasets
    const xValue = random.int(2, 50);
    const yValue = random.int(2, 50);

    const xPath = join(testDir, 'x.east');
    const yPath = join(testDir, 'y.east');
    writeFileSync(xPath, `${xValue}`);
    writeFileSync(yPath, `${yValue}`);

    // Small random delay between the two sets for variety
    const setXPromise = (async () => {
      await randomDelay(10);
      return runE3Command(['set', repoDir, 'ws.inputs.x', xPath], testDir!);
    })();
    const setYPromise = (async () => {
      await randomDelay(10);
      return runE3Command(['set', repoDir, 'ws.inputs.y', yPath], testDir!);
    })();

    const [setXResult, setYResult] = await Promise.all([setXPromise, setYPromise]);

    if (setXResult.exitCode !== 0) {
      throw new Error(`set x failed: stdout=${setXResult.stdout}, stderr=${setXResult.stderr}`);
    }
    if (setYResult.exitCode !== 0) {
      throw new Error(`set y failed: stdout=${setYResult.stdout}, stderr=${setYResult.stderr}`);
    }

    // Re-execute with new values
    const reStart = await runE3Command(['start', repoDir, 'ws'], testDir);
    if (reStart.exitCode !== 0) {
      throw new Error(`Re-start failed: stdout=${reStart.stdout}, stderr=${reStart.stderr}`);
    }

    // Read outputs
    const getA = await runE3Command(['get', repoDir, 'ws.tasks.double_x.output'], testDir);
    const getB = await runE3Command(['get', repoDir, 'ws.tasks.triple_y.output'], testDir);

    const outputA = parseInt(getA.stdout.trim(), 10);
    const outputB = parseInt(getB.stdout.trim(), 10);

    removeTestDir(testDir);

    // Verify independence: A = x*2, B = y*3
    const expectedA = xValue * 2;
    const expectedB = yValue * 3;

    if (outputA !== expectedA) {
      throw new Error(
        `Dataset cross-contamination? double_x output=${outputA}, ` +
        `expected ${xValue}*2=${expectedA}`
      );
    }
    if (outputB !== expectedB) {
      throw new Error(
        `Dataset cross-contamination? triple_y output=${outputB}, ` +
        `expected ${yValue}*3=${expectedB}`
      );
    }

    return {
      success: true,
      state: {
        xValue,
        yValue,
        outputA,
        outputB,
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

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Rapid mutations and fixpoint convergence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify fixpoint convergence under rapid-fire mutations.
 *
 * Single task A(x) = x*2. Fire 20 rapid set commands with values 1..20
 * during execution. The reactive loop should converge to a consistent
 * state: output = 2*V for some V that was set.
 */
export async function testReactiveRapidMutations(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const input = e3.input('x', IntegerType, 1n);

    const task = e3.task(
      'double',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );

    const pkg = e3.package(`reactive_rapid_${random.string(6)}`, '1.0.0', task);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    await e3.export(pkg, zipPath);
    await runE3Command(['repo', 'create', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', `${pkg.name}@${pkg.version}`], testDir);

    const numMutations = 20;
    const values = Array.from({ length: numMutations }, (_, i) => i + 1);

    // Start execution in background
    const startPromise = runE3Command(['start', repoDir, 'ws'], testDir);

    // Fire rapid mutations with small random delays
    const setPromises = values.map(async (v) => {
      await randomDelay(20);
      const valuePath = join(testDir!, `value_${v}.east`);
      writeFileSync(valuePath, `${v}`);
      return runE3Command(['set', repoDir, 'ws.inputs.x', valuePath], testDir!);
    });

    const [startResult, ...setResults] = await Promise.all([startPromise, ...setPromises]);

    if (startResult.exitCode !== 0) {
      throw new Error(`start failed: stdout=${startResult.stdout}, stderr=${startResult.stderr}`);
    }

    const setFailures = setResults.filter(r => r.exitCode !== 0);
    if (setFailures.length > 0) {
      throw new Error(
        `${setFailures.length} set commands failed: ` +
        setFailures.map(r => `stdout=${r.stdout}, stderr=${r.stderr}`).join('; ')
      );
    }

    // Read final output
    const getResult = await runE3Command(['get', repoDir, 'ws.tasks.double.output'], testDir);
    const output = parseInt(getResult.stdout.trim(), 10);

    removeTestDir(testDir);

    // Output must be even (x*2)
    if (output % 2 !== 0) {
      throw new Error(
        `Inconsistent output: ${output} is not even. Expected 2*V for some integer V.`
      );
    }

    // The input that was used must be one of: initial (1) or one of the set values (1..20)
    const inputUsed = output / 2;
    const validInputs = new Set([1, ...values]);
    if (!validInputs.has(inputUsed)) {
      throw new Error(
        `Unexpected output: ${output} = 2*${inputUsed}. ` +
        `Input must be one of: 1 (initial) or 1..${numMutations}.`
      );
    }

    return {
      success: true,
      state: {
        numMutations,
        output,
        inputUsed,
        setSuccesses: setResults.filter(r => r.exitCode === 0).length,
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

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Concurrent starts with shared input writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify the dual-lock model: exclusive dataflow lock prevents concurrent starts,
 * while shared workspace lock allows concurrent sets.
 *
 * Fire 3 starts and 5 sets concurrently. Exactly 1 start should succeed,
 * all sets should succeed, and the output must be consistent.
 */
export async function testConcurrentStartsWithSharedInput(): Promise<ScenarioResult> {
  const startTime = Date.now();
  let testDir: string | undefined;

  try {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const input = e3.input('x', IntegerType, 1n);

    const task = e3.task(
      'double',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );

    const pkg = e3.package(`reactive_dual_lock_${random.string(6)}`, '1.0.0', task);

    const repoDir = join(testDir, 'repo');
    const zipPath = join(testDir, 'package.zip');

    await e3.export(pkg, zipPath);
    await runE3Command(['repo', 'create', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, zipPath], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', `${pkg.name}@${pkg.version}`], testDir);

    const numStarts = 3;
    const numSets = 5;

    // Fire concurrent starts with random delays
    const startPromises = Array.from({ length: numStarts }, async () => {
      await randomDelay(30);
      return runE3Command(['start', repoDir, 'ws'], testDir!);
    });

    // Fire concurrent sets with random delays
    const setValues = Array.from({ length: numSets }, () => random.int(1, 100));
    const setPromises = setValues.map(async (v, i) => {
      await randomDelay(30);
      const valuePath = join(testDir!, `value_${i}.east`);
      writeFileSync(valuePath, `${v}`);
      return runE3Command(['set', repoDir, 'ws.inputs.x', valuePath], testDir!);
    });

    const allResults = await Promise.all([...startPromises, ...setPromises]);
    const startResults = allResults.slice(0, numStarts);
    const setResults = allResults.slice(numStarts);

    const isLockError = (r: { stdout: string; stderr: string }) =>
      r.stderr.includes('is locked by another process');

    const startSuccesses = startResults.filter(r => r.exitCode === 0).length;
    const startLockErrors = startResults.filter(r => r.exitCode !== 0 && isLockError(r)).length;
    const startOtherErrors = startResults.filter(r => r.exitCode !== 0 && !isLockError(r));
    const setSuccesses = setResults.filter(r => r.exitCode === 0).length;
    const setFailures = setResults.filter(r => r.exitCode !== 0);

    // Read final output
    const getResult = await runE3Command(['get', repoDir, 'ws.tasks.double.output'], testDir);
    const output = parseInt(getResult.stdout.trim(), 10);

    removeTestDir(testDir);

    // Verify locking: exactly 1 start should succeed (exclusive dataflow lock)
    if (startSuccesses !== 1) {
      throw new Error(
        `Expected exactly 1 successful start, got ${startSuccesses}. ` +
        `Lock errors: ${startLockErrors}, other errors: ${startOtherErrors.length}`
      );
    }

    // All start failures must be lock errors
    if (startOtherErrors.length > 0) {
      throw new Error(
        `Unexpected start errors: ${startOtherErrors.map(r => `stdout=${r.stdout}, stderr=${r.stderr}`).join('; ')}`
      );
    }

    // All sets should succeed (shared workspace lock)
    if (setFailures.length > 0) {
      throw new Error(
        `Set commands failed (shared lock should allow concurrent sets): ` +
        setFailures.map(r => `stdout=${r.stdout}, stderr=${r.stderr}`).join('; ')
      );
    }

    // Output must be even (x*2)
    if (output % 2 !== 0) {
      throw new Error(`Inconsistent output: ${output} is not even.`);
    }

    return {
      success: true,
      state: {
        startSuccesses,
        startLockErrors,
        setSuccesses,
        output,
        inputUsed: output / 2,
        setValues,
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
