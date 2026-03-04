/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * End-to-end integration tests for the complete e3 workflow.
 *
 * Tests the full pipeline:
 * 1. Create packages using the SDK (with East tasks and custom bash tasks)
 * 2. Export packages to .zip files
 * 3. Use CLI to initialize a repository
 * 4. Import packages via CLI
 * 5. Create and deploy workspaces
 * 6. Set input values
 * 7. Run dataflow execution with `e3 start`
 * 8. Validate output values are correct
 *
 * This tests a diamond dependency pattern:
 *
 *       input_a    input_b
 *          \        /
 *        task_left  task_right   (both read both inputs)
 *              \    /
 *            task_merge          (reads both task outputs)
 *                |
 *             output
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDir, removeTestDir, runE3Command, spawnE3Command, waitFor } from './helpers.js';

// SDK imports
import e3 from '@elaraai/e3';
import { IntegerType, StringType, East } from '@elaraai/east';

describe('end-to-end workflow', () => {
  let testDir: string;
  let repoDir: string;
  let packageZipPath: string;

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
    packageZipPath = join(testDir, 'test-package.zip');
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  describe('diamond dependency with East tasks', () => {
    it('executes full workflow with east-py runner', async () => {
      // =====================================================================
      // Step 1: Create package using SDK
      // =====================================================================

      // Define inputs
      const input_a = e3.input('a', IntegerType, 10n);
      const input_b = e3.input('b', IntegerType, 5n);

      // Left branch: computes a + b
      const task_left = e3.task(
        'left',
        [input_a, input_b],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, a, b) => a.add(b)
        )
      );

      // Right branch: computes a * b
      const task_right = e3.task(
        'right',
        [input_a, input_b],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, a, b) => a.multiply(b)
        )
      );

      // Merge: computes left + right = (a+b) + (a*b)
      const task_merge = e3.task(
        'merge',
        [task_left.output, task_right.output],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, left, right) => left.add(right)
        )
      );

      // Create package with all tasks
      const pkg = e3.package('diamond-test', '1.0.0', task_merge);

      console.log('=== Package Contents ===');
      for (const item of pkg.contents) {
        if (item.kind === 'dataset') {
          console.log(`  dataset: ${item.name} at ${JSON.stringify(item.path)}`);
        } else if (item.kind === 'datatree') {
          console.log(`  tree: ${item.name} at ${JSON.stringify(item.path)}`);
        } else if (item.kind === 'task') {
          console.log(`  task: ${item.name}`);
          console.log(`    inputs: ${item.inputs.map(i => JSON.stringify(i.path)).join(', ')}`);
        }
      }

      // =====================================================================
      // Step 2: Export package to .zip file
      // =====================================================================

      await e3.export(pkg, packageZipPath);
      assert.ok(existsSync(packageZipPath), 'Package zip should exist');

      // =====================================================================
      // Step 3: Initialize repository via CLI
      // =====================================================================

      const initResult = await runE3Command(['repo', 'create', repoDir], testDir);
      assert.strictEqual(initResult.exitCode, 0, `init failed: ${initResult.stderr}`);
      assert.ok(existsSync(join(repoDir, 'objects')), 'repository should exist');

      // =====================================================================
      // Step 4: Import package via CLI
      // =====================================================================

      const importResult = await runE3Command(
        ['package', 'import', repoDir, packageZipPath],
        testDir
      );
      assert.strictEqual(importResult.exitCode, 0, `import failed: ${importResult.stderr}`);

      // Verify package is listed
      const listPkgResult = await runE3Command(['package', 'list', repoDir], testDir);
      assert.strictEqual(listPkgResult.exitCode, 0, `package list failed: ${listPkgResult.stderr}`);
      assert.ok(listPkgResult.stdout.includes('diamond-test'), 'Package should be listed');
      assert.ok(listPkgResult.stdout.includes('1.0.0'), 'Version should be listed');

      // =====================================================================
      // Step 5: Create workspace via CLI
      // =====================================================================

      const wsCreateResult = await runE3Command(
        ['workspace', 'create', repoDir, 'test-ws'],
        testDir
      );
      assert.strictEqual(wsCreateResult.exitCode, 0, `workspace create failed: ${wsCreateResult.stderr}`);

      // =====================================================================
      // Step 6: Deploy package to workspace via CLI
      // =====================================================================

      const deployResult = await runE3Command(
        ['workspace', 'deploy', repoDir, 'test-ws', 'diamond-test@1.0.0'],
        testDir
      );
      assert.strictEqual(deployResult.exitCode, 0, `deploy failed: ${deployResult.stderr}`);

      // =====================================================================
      // Step 7: Check workspace status - should show tasks need execution
      // =====================================================================

      const statusResult = await runE3Command(['workspace', 'status', repoDir, 'test-ws'], testDir);
      assert.strictEqual(statusResult.exitCode, 0, `status failed: ${statusResult.stderr}`);

      // =====================================================================
      // Step 8: Run dataflow execution with `e3 start`
      // =====================================================================

      // First let's check what we have
      const listResult = await runE3Command(['list', repoDir, 'test-ws'], testDir);
      console.log('=== List before start ===');
      console.log(listResult.stdout);

      const startResult = await runE3Command(
        ['start', repoDir, 'test-ws'],
        testDir
      );
      console.log('=== Start result ===');
      console.log('stdout:', startResult.stdout);
      console.log('stderr:', startResult.stderr);
      console.log('exitCode:', startResult.exitCode);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // Check that execution completed
      assert.ok(
        startResult.stdout.includes('success') || startResult.stdout.includes('completed') || startResult.stdout.toLowerCase().includes('executed'),
        `Execution should indicate success: ${startResult.stdout}`
      );

      // =====================================================================
      // Step 9: Validate output values
      // =====================================================================

      // Get the merge task output: should be (10+5) + (10*5) = 15 + 50 = 65
      const getResult = await runE3Command(
        ['get', repoDir, 'test-ws.tasks.merge.output'],
        testDir
      );
      assert.strictEqual(getResult.exitCode, 0, `get failed: ${getResult.stderr}`);

      // The output should contain the value 65
      assert.ok(
        getResult.stdout.includes('65'),
        `Output should be 65, got: ${getResult.stdout}`
      );

      // Also verify intermediate results
      const getLeftResult = await runE3Command(
        ['get', repoDir, 'test-ws.tasks.left.output'],
        testDir
      );
      assert.strictEqual(getLeftResult.exitCode, 0, `get left failed: ${getLeftResult.stderr}`);
      assert.ok(getLeftResult.stdout.includes('15'), `Left should be 15, got: ${getLeftResult.stdout}`);

      const getRightResult = await runE3Command(
        ['get', repoDir, 'test-ws.tasks.right.output'],
        testDir
      );
      assert.strictEqual(getRightResult.exitCode, 0, `get right failed: ${getRightResult.stderr}`);
      assert.ok(getRightResult.stdout.includes('50'), `Right should be 50, got: ${getRightResult.stdout}`);
    });

    it('handles input value changes and re-execution', async () => {
      // Create a simple package with one task
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('double-test', '1.0.0', task_double);

      // Export and set up
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'double-test@1.0.0'], testDir);

      // Run with default value (10)
      let startResult = await runE3Command(['start', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `first start failed: ${startResult.stderr}`);

      let getResult = await runE3Command(['get', repoDir, 'ws.tasks.double.output'], testDir);
      assert.ok(getResult.stdout.includes('20'), `Output should be 20, got: ${getResult.stdout}`);

      // Change input value to 25
      // Note: e3 set requires a file, so we write the value to a .east file first
      const newValuePath = join(testDir, 'new_value.east');
      writeFileSync(newValuePath, '25');
      const setResult = await runE3Command(
        ['set', repoDir, 'ws.inputs.x', newValuePath],
        testDir
      );
      assert.strictEqual(setResult.exitCode, 0, `set failed: ${setResult.stderr}`);

      // Verify the input was actually changed
      const getInputResult = await runE3Command(['get', repoDir, 'ws.inputs.x'], testDir);
      assert.ok(getInputResult.stdout.includes('25'), `Input should be 25 after set, got: ${getInputResult.stdout}`);

      // Re-run - should compute new value (input changed, so cache should miss)
      startResult = await runE3Command(['start', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `second start failed: ${startResult.stderr}`);

      getResult = await runE3Command(['get', repoDir, 'ws.tasks.double.output'], testDir);
      assert.ok(getResult.stdout.includes('50'), `Output should be 50 after change, got: ${getResult.stdout}`);
    });
  });

  describe('custom tasks with bash commands', () => {
    it('executes customTask with bash script', async () => {
      // Create a custom task that uses bash to transform data
      // This simulates a task that might call external tools like Python

      const input_text = e3.input('text', StringType, 'hello');

      // Custom task that uses bash to uppercase the input
      // The command function receives input paths and output path
      const task_upper = e3.customTask(
        'upper',
        [input_text],
        StringType,
        ($, inputs, output) => {
          // Read beast2 input, decode, uppercase, re-encode, write to output
          // For simplicity, we just copy the file (real test would transform)
          return East.str`cp ${inputs.get(0n)} ${output}`;
        }
      );

      const pkg = e3.package('custom-test', '1.0.0', task_upper);

      // Export and set up
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      const importResult = await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      assert.strictEqual(importResult.exitCode, 0, `import failed: ${importResult.stderr}`);

      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'custom-test@1.0.0'], testDir);

      // Run
      const startResult = await runE3Command(['start', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // Verify output exists (content should be same as input since we just copied)
      const getResult = await runE3Command(['get', repoDir, 'ws.tasks.upper.output'], testDir);
      assert.strictEqual(getResult.exitCode, 0, `get failed: ${getResult.stderr}`);
      assert.ok(getResult.stdout.includes('hello'), `Output should contain 'hello', got: ${getResult.stdout}`);
    });
  });

  describe('mixed East and custom tasks', () => {
    it('executes workflow with both task types', async () => {
      // Input: a number
      const input_n = e3.input('n', IntegerType, 7n);

      // East task: compute n * 2
      const task_double = e3.task(
        'double',
        [input_n],
        East.function(
          [IntegerType],
          IntegerType,
          ($, n) => n.multiply(2n)
        )
      );

      // Custom task: copy the result (simulating external processing)
      const task_process = e3.customTask(
        'process',
        [task_double.output],
        IntegerType,
        ($, inputs, output) => East.str`cp ${inputs.get(0n)} ${output}`
      );

      // East task: add 1 to the processed result
      const task_increment = e3.task(
        'increment',
        [task_process.output],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.add(1n)
        )
      );

      const pkg = e3.package('mixed-test', '1.0.0', task_increment);

      // Export and set up
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'mixed-test@1.0.0'], testDir);

      // Run
      const startResult = await runE3Command(['start', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // Verify: (7 * 2) + 1 = 15
      const getResult = await runE3Command(['get', repoDir, 'ws.tasks.increment.output'], testDir);
      assert.strictEqual(getResult.exitCode, 0, `get failed: ${getResult.stderr}`);
      assert.ok(getResult.stdout.includes('15'), `Output should be 15, got: ${getResult.stdout}`);
    });
  });

  describe('list -r -l with status and size', () => {
    it('shows dataset status and size in tabular output', async () => {
      // Create a simple package with one task
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('list-status-test', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'list-status-test@1.0.0'], testDir);

      // Before execution: input has a default value (set), task output is unset
      let listResult = await runE3Command(['list', repoDir, 'ws', '-r', '-l'], testDir);
      assert.strictEqual(listResult.exitCode, 0, `list -r -l failed: ${listResult.stderr}`);
      assert.match(listResult.stdout, /unset/, 'Task output should show unset');
      assert.match(listResult.stdout, /\bset\b/, 'Input should show set');
      assert.match(listResult.stdout, /\d+ B/, 'Input should show byte size');
      // Tree entries should appear with (tree) marker
      assert.match(listResult.stdout, /\(tree\)/, 'Should show tree entries');

      // Update input
      const newValuePath = join(testDir, 'val.east');
      writeFileSync(newValuePath, '25');
      await runE3Command(['set', repoDir, 'ws.inputs.x', newValuePath], testDir);

      // After set: input still shows set
      listResult = await runE3Command(['list', repoDir, 'ws', '-r', '-l'], testDir);
      assert.strictEqual(listResult.exitCode, 0, `list -r -l failed after set: ${listResult.stderr}`);
      assert.match(listResult.stdout, /\bset\b/, 'Updated input should show set');

      // -r -l should show types
      assert.match(listResult.stdout, /Integer/, 'Should show type');

      // Execute dataflow
      const startResult = await runE3Command(['start', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // After execution: all datasets should be set
      listResult = await runE3Command(['list', repoDir, 'ws', '-r', '-l'], testDir);
      assert.strictEqual(listResult.exitCode, 0, `list -r -l after start failed: ${listResult.stderr}`);
      // All datasets should now show "set" (no more "unset")
      assert.doesNotMatch(listResult.stdout, /\bunset\b/, 'No datasets should be unset after execution');

      // -r (paths only) should return dot-separated paths
      listResult = await runE3Command(['list', repoDir, 'ws', '-r'], testDir);
      assert.strictEqual(listResult.exitCode, 0, `list -r failed: ${listResult.stderr}`);
      assert.match(listResult.stdout, /\.inputs\.x/, 'Should show input path');
      // Tasks are collapsed to leaves (e.g., .tasks.double, not .tasks.double.output)
      assert.match(listResult.stdout, /\.tasks\.double/, 'Should show task path');
    });
  });

  describe('status command', () => {
    it('shows dataset status detail', async () => {
      // Create a simple package with one task
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('status-test', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'status-test@1.0.0'], testDir);

      // Check input status — should show set with hash and size
      let statusResult = await runE3Command(['status', repoDir, 'ws.inputs.x'], testDir);
      assert.strictEqual(statusResult.exitCode, 0, `status failed: ${statusResult.stderr}`);
      assert.match(statusResult.stdout, /Status: set/, 'Input should show Status: set');
      assert.match(statusResult.stdout, /Hash:/, 'Input should show Hash');
      assert.match(statusResult.stdout, /Size:/, 'Input should show Size');
      assert.match(statusResult.stdout, /Type:/, 'Should show Type');

      // Check task output status — should show unset
      statusResult = await runE3Command(['status', repoDir, 'ws.tasks.double.output'], testDir);
      assert.strictEqual(statusResult.exitCode, 0, `status failed: ${statusResult.stderr}`);
      assert.match(statusResult.stdout, /Status: unset/, 'Task output should show Status: unset');

      // Execute dataflow
      const startResult = await runE3Command(['start', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // After execution: task output should now show set
      statusResult = await runE3Command(['status', repoDir, 'ws.tasks.double.output'], testDir);
      assert.strictEqual(statusResult.exitCode, 0, `status after start failed: ${statusResult.stderr}`);
      assert.match(statusResult.stdout, /Status: set/, 'Task output should show Status: set after execution');
      assert.match(statusResult.stdout, /Hash:/, 'Task output should show Hash after execution');
      assert.match(statusResult.stdout, /Size:/, 'Task output should show Size after execution');
    });

    it('reports error for non-existent field', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const pkg = e3.package('status-err-field', '1.0.0', input_x);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'status-err-field@1.0.0'], testDir);

      // Typo in field name
      const result = await runE3Command(['status', repoDir, 'ws.inputs.typo'], testDir);
      assert.notStrictEqual(result.exitCode, 0, 'Should fail for non-existent field');
      assert.match(result.stderr, /not found/i, 'Should mention field not found');
    });

    it('reports error when path points to tree', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const pkg = e3.package('status-err-tree', '1.0.0', input_x);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'status-err-tree@1.0.0'], testDir);

      // Path points to a tree (inputs), not a dataset
      const result = await runE3Command(['status', repoDir, 'ws.inputs'], testDir);
      assert.notStrictEqual(result.exitCode, 0, 'Should fail when path points to tree');
      assert.match(result.stderr, /tree, not a dataset/, 'Should mention tree vs dataset');
    });
  });

  describe('error handling', () => {
    it('reports task failure gracefully', async () => {
      // Create a custom task that fails
      const input_x = e3.input('x', IntegerType, 1n);

      const task_fail = e3.customTask(
        'fail',
        [input_x],
        IntegerType,
        (_$, _inputs, _output) => East.str`exit 1`  // Always fail
      );

      const pkg = e3.package('fail-test', '1.0.0', task_fail);

      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'fail-test@1.0.0'], testDir);

      // Run - should report failure but not crash
      const startResult = await runE3Command(['start', repoDir, 'ws'], testDir);

      // The CLI should exit with non-zero or report failure
      // Either the exit code is non-zero, or the output mentions failure
      const output = startResult.stdout + startResult.stderr;
      const indicatesFailure = startResult.exitCode !== 0 ||
        output.toLowerCase().includes('fail') ||
        output.toLowerCase().includes('error');

      assert.ok(indicatesFailure, `Should indicate failure: exitCode=${startResult.exitCode}, output=${output}`);
    });
  });

  describe('concurrent set during start', () => {
    it('allows e3 set while e3 start is running', async () => {
      // Create a package with a slow custom task (sleep 5s) so we can
      // reliably issue `e3 set` while the task is in-flight.
      const input_x = e3.input('x', IntegerType, 10n);

      const task_slow = e3.customTask(
        'slow',
        [input_x],
        IntegerType,
        ($, inputs, output) => East.str`sleep 5 && cp ${inputs.get(0n)} ${output}`
      );

      const pkg = e3.package('concurrent-test', '1.0.0', task_slow);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'concurrent-test@1.0.0'], testDir);

      // Start dataflow in background (task sleeps 5s — plenty of time)
      const startProc = spawnE3Command(['start', repoDir, 'ws'], testDir);

      // Wait until the CLI has actually started the task (look for [START] in output).
      // This ensures the dataflow lock is held and the task is running.
      await waitFor(
        () => startProc.getStdout().includes('[START]'),
        10000, // timeout — generous for CI
        50     // poll interval
      );

      // Run e3 set while start is running — should succeed (shared lock model)
      const newValuePath = join(testDir, 'val.east');
      writeFileSync(newValuePath, '42');
      const setResult = await runE3Command(
        ['set', repoDir, 'ws.inputs.x', newValuePath],
        testDir
      );
      assert.strictEqual(setResult.exitCode, 0, `set during start should succeed: ${setResult.stderr}`);

      // Wait for start to finish
      const startResult = await startProc.result;
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // Verify the input was updated to the concurrent-set value
      const getInputResult = await runE3Command(['get', repoDir, 'ws.inputs.x'], testDir);
      assert.strictEqual(getInputResult.exitCode, 0, `get input failed: ${getInputResult.stderr}`);
      assert.ok(getInputResult.stdout.includes('42'), `Input should be 42, got: ${getInputResult.stdout}`);

      // The first start ran with the original input (10), so the output is 10.
      // Re-run start — this time it should pick up the new input and produce 42.
      // (Reactive re-execution within a single start is tested at the unit level
      // in dataflow-orchestration.spec.ts; the LocalOrchestrator will gain that
      // capability in a future change.)
      const start2 = await runE3Command(['start', repoDir, 'ws'], testDir);
      assert.strictEqual(start2.exitCode, 0, `second start failed: ${start2.stderr}\n${start2.stdout}`);

      const getOutput = await runE3Command(['get', repoDir, 'ws.tasks.slow.output'], testDir);
      assert.strictEqual(getOutput.exitCode, 0, `get output failed: ${getOutput.stderr}`);
      assert.ok(getOutput.stdout.includes('42'), `Output should be 42 after re-run, got: ${getOutput.stdout}`);
    });
  });

  describe('writable enforcement', () => {
    it('rejects e3 set on non-writable dataset (task output)', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('writable-test', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'writable-test@1.0.0'], testDir);

      // Try to set the task output — should fail (not writable)
      const valuePath = join(testDir, 'val.east');
      writeFileSync(valuePath, '999');
      const setResult = await runE3Command(
        ['set', repoDir, 'ws.tasks.double.output', valuePath],
        testDir
      );
      assert.notStrictEqual(setResult.exitCode, 0, 'set on task output should fail');
      const output = setResult.stdout + setResult.stderr;
      assert.ok(
        output.toLowerCase().includes('not writable'),
        `Should mention not writable. Got: ${output}`
      );
    });

    it('rejects e3 set on function_ir dataset', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('writable-test-ir', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'writable-test-ir@1.0.0'], testDir);

      // Try to set the function_ir — should fail (not writable)
      const valuePath = join(testDir, 'val.east');
      writeFileSync(valuePath, '0');
      const setResult = await runE3Command(
        ['set', repoDir, 'ws.tasks.double.function_ir', valuePath],
        testDir
      );
      assert.notStrictEqual(setResult.exitCode, 0, 'set on function_ir should fail');
      const output = setResult.stdout + setResult.stderr;
      assert.ok(
        output.toLowerCase().includes('not writable'),
        `Should mention not writable. Got: ${output}`
      );
    });

    it('allows e3 set on writable input dataset', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const pkg = e3.package('writable-ok', '1.0.0', input_x);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'writable-ok@1.0.0'], testDir);

      // Set the input — should succeed (writable)
      const valuePath = join(testDir, 'val.east');
      writeFileSync(valuePath, '42');
      const setResult = await runE3Command(
        ['set', repoDir, 'ws.inputs.x', valuePath],
        testDir
      );
      assert.strictEqual(setResult.exitCode, 0, `set on input should succeed: ${setResult.stderr}`);

      // Verify the value was set
      const getResult = await runE3Command(['get', repoDir, 'ws.inputs.x'], testDir);
      assert.ok(getResult.stdout.includes('42'), `Input should be 42, got: ${getResult.stdout}`);
    });
  });

  describe('per-dataset ref files', () => {
    it('creates ref files after deploy', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('ref-test', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'ref-test@1.0.0'], testDir);

      // After deploy, ref files should exist in workspaces/ws/data/
      const dataDir = join(repoDir, 'workspaces', 'ws', 'data');
      assert.ok(existsSync(dataDir), 'workspace data directory should exist');

      // Check for ref files — the structure has inputs.x, tasks.double.output,
      // tasks.double.function_ir. Ref files end in .ref
      const refFiles = findRefFiles(dataDir);
      assert.ok(refFiles.length >= 3, `Should have at least 3 ref files (input, output, function_ir), found ${refFiles.length}: ${refFiles.join(', ')}`);

      // Input should have a value ref (it has a default value)
      const inputRefPath = join(dataDir, 'inputs', 'x.ref');
      assert.ok(existsSync(inputRefPath), `Input ref file should exist at ${inputRefPath}`);

      // Verify input has a value (not unassigned)
      const getResult = await runE3Command(['get', repoDir, 'ws.inputs.x'], testDir);
      assert.ok(getResult.stdout.includes('10'), `Input default should be 10, got: ${getResult.stdout}`);
    });

    it('updates ref files after set', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const pkg = e3.package('ref-set-test', '1.0.0', input_x);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'ref-set-test@1.0.0'], testDir);

      // Read ref file before set
      const inputRefPath = join(repoDir, 'workspaces', 'ws', 'data', 'inputs', 'x.ref');
      assert.ok(existsSync(inputRefPath), 'Input ref should exist');
      const refBefore = readFileSync(inputRefPath);

      // Set a new value
      const valuePath = join(testDir, 'val.east');
      writeFileSync(valuePath, '99');
      await runE3Command(['set', repoDir, 'ws.inputs.x', valuePath], testDir);

      // Ref file should be updated (different content)
      const refAfter = readFileSync(inputRefPath);
      assert.ok(!refBefore.equals(refAfter), 'Ref file content should change after set');

      // Verify new value
      const getResult = await runE3Command(['get', repoDir, 'ws.inputs.x'], testDir);
      assert.ok(getResult.stdout.includes('99'), `Input should be 99, got: ${getResult.stdout}`);
    });

    it('populates task output refs after start', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('ref-start-test', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'ref-start-test@1.0.0'], testDir);

      // Before start, task output status should be unset
      const statusBefore = await runE3Command(
        ['status', repoDir, 'ws.tasks.double.output'],
        testDir
      );
      assert.match(statusBefore.stdout, /unset/, 'Task output should be unset before start');

      // Run start
      const startResult = await runE3Command(['start', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // After start, task output should be set with correct value
      const statusAfter = await runE3Command(
        ['status', repoDir, 'ws.tasks.double.output'],
        testDir
      );
      assert.match(statusAfter.stdout, /Status: set/, 'Task output should be set after start');

      // Verify value: 10 * 2 = 20
      const getResult = await runE3Command(['get', repoDir, 'ws.tasks.double.output'], testDir);
      assert.ok(getResult.stdout.includes('20'), `Output should be 20, got: ${getResult.stdout}`);

      // Output ref file should exist
      const outputRefPath = join(repoDir, 'workspaces', 'ws', 'data', 'tasks', 'double', 'output.ref');
      assert.ok(existsSync(outputRefPath), 'Output ref file should exist after start');
    });
  });
});

/**
 * Recursively find all .ref files in a directory.
 */
function findRefFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRefFiles(fullPath));
    } else if (entry.name.endsWith('.ref')) {
      results.push(fullPath);
    }
  }
  return results;
}
