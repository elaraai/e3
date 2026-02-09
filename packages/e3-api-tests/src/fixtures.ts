/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Test fixture creation utilities.
 *
 * Creates test packages using the @elaraai/e3 SDK to ensure
 * fixtures stay in sync with the SDK.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import e3 from '@elaraai/e3';
import { IntegerType, StringType, East } from '@elaraai/east';

/**
 * Create a simple compute package for testing.
 *
 * Creates a package with:
 * - Input: "value" (Integer, default 10)
 * - Task: "compute" - multiplies input by 2
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @returns Path to the created zip file
 */
export async function createPackageZip(
  tempDir: string,
  name: string,
  version: string
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const input = e3.input('value', IntegerType, 10n);
  const task = e3.task(
    'compute',
    [input],
    East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
  );
  const pkg = e3.package(name, version, task);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}

/**
 * Create a package with multiple inputs for testing.
 *
 * Creates a package with:
 * - Input: "a" (Integer, default 1)
 * - Input: "b" (Integer, default 2)
 * - Task: "add" - returns a + b
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @returns Path to the created zip file
 */
export async function createMultiInputPackageZip(
  tempDir: string,
  name: string,
  version: string
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const inputA = e3.input('a', IntegerType, 1n);
  const inputB = e3.input('b', IntegerType, 2n);
  const task = e3.task(
    'add',
    [inputA, inputB],
    East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
  );
  const pkg = e3.package(name, version, task);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}

/**
 * Create a package with string input for testing.
 *
 * Creates a package with:
 * - Input: "config" (String, default "default")
 * - Task: "echo" - returns input unchanged
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @returns Path to the created zip file
 */
export async function createStringPackageZip(
  tempDir: string,
  name: string,
  version: string
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const input = e3.input('config', StringType, 'default');
  const task = e3.task(
    'echo',
    [input],
    East.function([StringType], StringType, ($, x) => x)
  );
  const pkg = e3.package(name, version, task);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}

/**
 * Create a package with diamond dependencies for testing dataflow.
 *
 * Creates a package with:
 * - Input: "a" (Integer, default 10)
 * - Input: "b" (Integer, default 5)
 * - Task: "left" - returns a + b
 * - Task: "right" - returns a * b
 * - Task: "merge" - returns left + right
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @returns Path to the created zip file
 */
export async function createDiamondPackageZip(
  tempDir: string,
  name: string,
  version: string
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const inputA = e3.input('a', IntegerType, 10n);
  const inputB = e3.input('b', IntegerType, 5n);

  const leftTask = e3.task(
    'left',
    [inputA, inputB],
    East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
  );

  const rightTask = e3.task(
    'right',
    [inputA, inputB],
    East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.multiply(b))
  );

  const mergeTask = e3.task(
    'merge',
    [leftTask.output, rightTask.output],
    East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
  );

  const pkg = e3.package(name, version, mergeTask);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}

/**
 * Create a package with a task that always fails.
 *
 * Creates a package with:
 * - Input: "value" (String, default "test")
 * - Task: "failing" - exits with code 1
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @returns Path to the created zip file
 */
export async function createFailingPackageZip(
  tempDir: string,
  name: string,
  version: string
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const input = e3.input('value', StringType, 'test');
  const task = e3.customTask(
    'failing',
    [input],
    StringType,
    ($, _inputs, _output) => East.str`exit 1`
  );
  const pkg = e3.package(name, version, task);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}

/**
 * Create a package with a slow task for testing concurrency/cancellation.
 *
 * Creates a package with:
 * - Input: "value" (String, default "test")
 * - Task: "slow" - sleeps for specified seconds then copies input to output
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @param sleepSeconds - How long the task should sleep (default: 10)
 * @returns Path to the created zip file
 */
export async function createSlowPackageZip(
  tempDir: string,
  name: string,
  version: string,
  sleepSeconds: number = 10
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const input = e3.input('value', StringType, 'test');
  const task = e3.customTask(
    'slow',
    [input],
    StringType,
    ($, inputs, output) => East.str`sleep ${sleepSeconds.toString()} && cp ${inputs.get(0n)} ${output}`
  );
  const pkg = e3.package(name, version, task);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}

/**
 * Create a package with three independent tasks where one fails.
 *
 * Creates a package with:
 * - Input: "a" (Integer, default 3)
 * - Input: "b" (Integer, default 4)
 * - Task: "succeed_a" - returns a + b (succeeds)
 * - Task: "succeed_b" - returns a * b (succeeds)
 * - Task: "fail_c" - exits with code 1 (always fails)
 *
 * All tasks are independent — dispatched in the same Map iteration.
 * Stresses apply-results serialization with mixed success/failure.
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @returns Path to the created zip file
 */
export async function createParallelMixedPackageZip(
  tempDir: string,
  name: string,
  version: string
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const inputA = e3.input('a', IntegerType, 3n);
  const inputB = e3.input('b', IntegerType, 4n);

  const succeedA = e3.task(
    'succeed_a',
    [inputA, inputB],
    East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
  );

  const succeedB = e3.task(
    'succeed_b',
    [inputA, inputB],
    East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.multiply(b))
  );

  const failC = e3.customTask(
    'fail_c',
    [inputA],
    StringType,
    ($, _inputs, _output) => East.str`exit 1`
  );

  const pkg = e3.package(name, version, succeedA, succeedB, failC);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}

/**
 * Create a diamond-shaped package where one branch fails.
 *
 * Creates a package with:
 * - Input: "a" (Integer, default 10)
 * - Input: "b" (Integer, default 5)
 * - Task: "left" - returns a + b (succeeds)
 * - Task: "right" - exits with code 1 (always fails)
 * - Task: "merge" - depends on left.output + right.output (should be skipped)
 *
 * Tests that merge is properly skipped and the dataflow completes without stalling.
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @returns Path to the created zip file
 */
export async function createFailingDiamondPackageZip(
  tempDir: string,
  name: string,
  version: string
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const inputA = e3.input('a', IntegerType, 10n);
  const inputB = e3.input('b', IntegerType, 5n);

  const leftTask = e3.task(
    'left',
    [inputA, inputB],
    East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
  );

  const rightTask = e3.customTask(
    'right',
    [inputA],
    IntegerType,
    ($, _inputs, _output) => East.str`exit 1`
  );

  const mergeTask = e3.task(
    'merge',
    [leftTask.output, rightTask.output],
    East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
  );

  const pkg = e3.package(name, version, mergeTask);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}

/**
 * Create a package with N independent tasks for stress testing parallelism.
 *
 * Creates a package with:
 * - Input: "value" (Integer, default 7)
 * - Tasks: task_0 through task_{N-1}, each computing value * i
 *
 * Stresses that apply-results handles a large batch of concurrent completions correctly.
 *
 * @param tempDir - Directory to write the zip file
 * @param name - Package name
 * @param version - Package version
 * @param taskCount - Number of independent tasks to create (default: 6)
 * @returns Path to the created zip file
 */
export async function createWideParallelPackageZip(
  tempDir: string,
  name: string,
  version: string,
  taskCount: number = 6
): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const input = e3.input('value', IntegerType, 7n);
  const fn = (multiplier: bigint) =>
    East.function([IntegerType], IntegerType, ($, x) => x.multiply(multiplier));

  const task0 = e3.task('task_0', [input], fn(1n));
  const task1 = e3.task('task_1', [input], fn(2n));
  const task2 = e3.task('task_2', [input], fn(3n));
  const task3 = e3.task('task_3', [input], fn(4n));
  const task4 = e3.task('task_4', [input], fn(5n));
  const task5 = e3.task('task_5', [input], fn(6n));

  const pkg = e3.package(name, version, task0, task1, task2, task3, task4, task5);

  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);

  return zipPath;
}
