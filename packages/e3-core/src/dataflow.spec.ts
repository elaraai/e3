/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for dataflow.ts - DAG execution
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { variant, StringType, encodeBeast2For, StructType } from '@elaraai/east';
import {
  TaskObjectType,
  PackageObjectType,
  DataRefType,
  type CommandPart,
  type TreePath,
  type Structure,
  type DataRef,
} from '@elaraai/e3-types';
import {
  dataflowExecute,
  dataflowGetGraph,
  type TaskExecutionResult,
} from './dataflow.js';
import { configWrite } from './executions.js';
import { objectWrite } from './objects.js';
import { packageImport } from './packages.js';
import { workspaceDeploy } from './workspaces.js';
import { workspaceGetDataset, workspaceSetDataset } from './trees.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

describe('dataflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  // Helper to create a package with tasks
  async function createPackageWithTasks(
    repoPath: string,
    tasks: Array<{
      name: string;
      runner: string;
      inputs: TreePath[];
      output: TreePath;
    }>,
    structure: Structure,
    initialData?: Record<string, { value: unknown; ref: DataRef }>
  ): Promise<string> {
    const taskEncoder = encodeBeast2For(TaskObjectType);
    const tasksMap = new Map<string, string>();

    for (const t of tasks) {
      const taskObj = {
        runner: t.runner,
        inputs: t.inputs,
        output: t.output,
      };
      const taskHash = await objectWrite(repoPath, taskEncoder(taskObj));
      tasksMap.set(t.name, taskHash);
    }

    // Build initial data tree
    // For simplicity, we'll create a flat structure with DataRefs
    const structFields = (structure as { type: 'struct'; value: Map<string, Structure> }).value;
    const dataRefFields: Record<string, typeof DataRefType> = {};
    for (const key of structFields.keys()) {
      dataRefFields[key] = DataRefType;
    }
    const dataTreeType = StructType(dataRefFields);
    const dataTreeEncoder = encodeBeast2For(dataTreeType);

    // Create data refs for initial data
    const dataRefs: Record<string, DataRef> = {};
    for (const key of (structure as { type: 'struct'; value: Map<string, Structure> }).value.keys()) {
      if (initialData && key in initialData) {
        dataRefs[key] = initialData[key].ref;
      } else {
        // Unassigned by default
        dataRefs[key] = { type: 'unassigned', value: null } as DataRef;
      }
    }

    const dataHash = await objectWrite(repoPath, dataTreeEncoder(dataRefs));

    // Create package object
    const pkgEncoder = encodeBeast2For(PackageObjectType);
    const pkgObj = {
      data: {
        structure,
        value: dataHash,
      },
      tasks: tasksMap,
    };
    const pkgHash = await objectWrite(repoPath, pkgEncoder(pkgObj));

    // Write package ref - the ref file is at packages/<name>/<version> (version is the file, not a directory)
    const pkgDir = join(repoPath, 'packages', 'test');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, '1.0.0'), pkgHash + '\n');

    return pkgHash;
  }

  describe('dataflowGetGraph', () => {
    it('returns empty graph for package with no tasks', async () => {
      // Create a minimal package with no tasks
      const structure: Structure = {
        type: 'struct',
        value: new Map([['input', { type: 'value', value: StringType }]]),
      } as unknown as Structure;

      await createPackageWithTasks(testRepo, [], structure);
      await workspaceDeploy(testRepo, 'test-ws', 'test', '1.0.0');

      const graph = await dataflowGetGraph(testRepo, 'test-ws');
      assert.strictEqual(graph.tasks.length, 0);
    });

    it('returns task dependencies', async () => {
      // Create a package with two tasks: A -> B
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: StringType }],
          ['middle', { type: 'value', value: StringType }],
          ['output', { type: 'value', value: StringType }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middlePath: TreePath = [variant('field', 'middle')];
      const outputPath: TreePath = [variant('field', 'output')];

      await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', runner: 'copy', inputs: [inputPath], output: middlePath },
          { name: 'task-b', runner: 'copy', inputs: [middlePath], output: outputPath },
        ],
        structure
      );
      await workspaceDeploy(testRepo, 'test-ws', 'test', '1.0.0');

      const graph = await dataflowGetGraph(testRepo, 'test-ws');
      assert.strictEqual(graph.tasks.length, 2);

      const taskA = graph.tasks.find((t) => t.name === 'task-a');
      const taskB = graph.tasks.find((t) => t.name === 'task-b');

      assert.ok(taskA);
      assert.ok(taskB);
      assert.deepStrictEqual(taskA.dependsOn, []); // A depends on external input
      assert.deepStrictEqual(taskB.dependsOn, ['task-a']); // B depends on A
    });
  });

  describe('dataflowExecute', () => {
    it('executes single task', async () => {
      // Configure runner
      const runners = new Map<string, CommandPart[]>();
      runners.set('copy', [
        variant('literal', 'cp'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create package with one task
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: StringType }],
          ['output', { type: 'value', value: StringType }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      // Create input value
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('hello world'));

      await createPackageWithTasks(
        testRepo,
        [{ name: 'copy-task', runner: 'copy', inputs: [inputPath], output: outputPath }],
        structure,
        {
          input: {
            value: 'hello world',
            ref: { type: 'value', value: inputHash } as DataRef,
          },
        }
      );
      await workspaceDeploy(testRepo, 'test-ws', 'test', '1.0.0');

      // Set the input value in workspace
      await workspaceSetDataset(testRepo, 'test-ws', inputPath, 'hello world', StringType);

      const result = await dataflowExecute(testRepo, 'test-ws');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.executed, 1);
      assert.strictEqual(result.failed, 0);
      assert.strictEqual(result.tasks.length, 1);
      assert.strictEqual(result.tasks[0].state, 'success');

      // Verify output was written
      const outputValue = await workspaceGetDataset(testRepo, 'test-ws', outputPath);
      assert.strictEqual(outputValue, 'hello world');
    });

    it('executes task chain in order', async () => {
      // Configure runner
      const runners = new Map<string, CommandPart[]>();
      runners.set('copy', [
        variant('literal', 'cp'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create package with A -> B chain
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: StringType }],
          ['middle', { type: 'value', value: StringType }],
          ['output', { type: 'value', value: StringType }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middlePath: TreePath = [variant('field', 'middle')];
      const outputPath: TreePath = [variant('field', 'output')];

      // Create input value
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('chain test'));

      await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', runner: 'copy', inputs: [inputPath], output: middlePath },
          { name: 'task-b', runner: 'copy', inputs: [middlePath], output: outputPath },
        ],
        structure,
        {
          input: {
            value: 'chain test',
            ref: { type: 'value', value: inputHash } as DataRef,
          },
        }
      );
      await workspaceDeploy(testRepo, 'test-ws', 'test', '1.0.0');

      // Set the input value in workspace
      await workspaceSetDataset(testRepo, 'test-ws', inputPath, 'chain test', StringType);

      const completedOrder: string[] = [];
      const result = await dataflowExecute(testRepo, 'test-ws', {
        onTaskComplete: (r) => completedOrder.push(r.name),
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.executed, 2);
      assert.strictEqual(completedOrder[0], 'task-a'); // A must complete before B
      assert.strictEqual(completedOrder[1], 'task-b');

      // Verify final output
      const outputValue = await workspaceGetDataset(testRepo, 'test-ws', outputPath);
      assert.strictEqual(outputValue, 'chain test');
    });

    it('handles task failure with fail-fast', async () => {
      // Configure runners
      const runners = new Map<string, CommandPart[]>();
      runners.set('fail', [
        variant('literal', 'bash'),
        variant('literal', '-c'),
        variant('literal', 'exit 1'),
      ]);
      runners.set('copy', [
        variant('literal', 'cp'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create package with A (fails) -> B (should be skipped)
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: StringType }],
          ['middle', { type: 'value', value: StringType }],
          ['output', { type: 'value', value: StringType }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middlePath: TreePath = [variant('field', 'middle')];
      const outputPath: TreePath = [variant('field', 'output')];

      // Create input value
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('fail test'));

      await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', runner: 'fail', inputs: [inputPath], output: middlePath },
          { name: 'task-b', runner: 'copy', inputs: [middlePath], output: outputPath },
        ],
        structure,
        {
          input: {
            value: 'fail test',
            ref: { type: 'value', value: inputHash } as DataRef,
          },
        }
      );
      await workspaceDeploy(testRepo, 'test-ws', 'test', '1.0.0');

      // Set the input value
      await workspaceSetDataset(testRepo, 'test-ws', inputPath, 'fail test', StringType);

      const result = await dataflowExecute(testRepo, 'test-ws');

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.failed, 1);
      assert.strictEqual(result.skipped, 1);

      const taskA = result.tasks.find((t) => t.name === 'task-a');
      const taskB = result.tasks.find((t) => t.name === 'task-b');

      assert.ok(taskA);
      assert.ok(taskB);
      assert.strictEqual(taskA.state, 'failed');
      assert.strictEqual(taskB.state, 'skipped');
    });

    it('caches successful task results', async () => {
      // Configure runner
      const runners = new Map<string, CommandPart[]>();
      runners.set('copy', [
        variant('literal', 'cp'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create package
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: StringType }],
          ['output', { type: 'value', value: StringType }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('cache test'));

      await createPackageWithTasks(
        testRepo,
        [{ name: 'copy-task', runner: 'copy', inputs: [inputPath], output: outputPath }],
        structure,
        {
          input: {
            value: 'cache test',
            ref: { type: 'value', value: inputHash } as DataRef,
          },
        }
      );
      await workspaceDeploy(testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(testRepo, 'test-ws', inputPath, 'cache test', StringType);

      // First execution
      const result1 = await dataflowExecute(testRepo, 'test-ws');
      assert.strictEqual(result1.executed, 1);
      assert.strictEqual(result1.cached, 0);

      // Second execution should be cached (output already assigned)
      const result2 = await dataflowExecute(testRepo, 'test-ws');
      assert.strictEqual(result2.executed, 0);
      assert.strictEqual(result2.cached, 1);
    });

    it('respects concurrency limit', async () => {
      // Configure a slow runner
      const runners = new Map<string, CommandPart[]>();
      runners.set('slow-copy', [
        variant('literal', 'bash'),
        variant('literal', '-c'),
        variant('literal', 'sleep 0.1; cp "$1" "$2"'),
        variant('literal', '--'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create package with 4 parallel tasks
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: StringType }],
          ['out1', { type: 'value', value: StringType }],
          ['out2', { type: 'value', value: StringType }],
          ['out3', { type: 'value', value: StringType }],
          ['out4', { type: 'value', value: StringType }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];

      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('parallel test'));

      await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-1', runner: 'slow-copy', inputs: [inputPath], output: [variant('field', 'out1')] },
          { name: 'task-2', runner: 'slow-copy', inputs: [inputPath], output: [variant('field', 'out2')] },
          { name: 'task-3', runner: 'slow-copy', inputs: [inputPath], output: [variant('field', 'out3')] },
          { name: 'task-4', runner: 'slow-copy', inputs: [inputPath], output: [variant('field', 'out4')] },
        ],
        structure,
        {
          input: {
            value: 'parallel test',
            ref: { type: 'value', value: inputHash } as DataRef,
          },
        }
      );
      await workspaceDeploy(testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(testRepo, 'test-ws', inputPath, 'parallel test', StringType);

      // Track concurrent execution count
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      const result = await dataflowExecute(testRepo, 'test-ws', {
        concurrency: 2,
        onTaskStart: () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        },
        onTaskComplete: () => {
          currentConcurrent--;
        },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.executed, 4);
      assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
    });
  });
});
