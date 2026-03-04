/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Unit tests for dataflow step functions.
 *
 * Tests the individual step functions used by the orchestrator,
 * using inline graph and state construction.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { some, none, variant, StringType, encodeBeast2For } from '@elaraai/east';
import type { TreePath, Structure } from '@elaraai/e3-types';
import { stepInvalidateTasks, stepDetectInputChanges, stepCheckVersionConsistency } from './steps.js';
import type { DataflowExecutionState, TaskState, Mutable } from './types.js';
import type { DataflowGraph } from '../dataflow.js';
import { InMemoryStateStore } from './state-store/InMemoryStateStore.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import { workspaceDeploy } from '../workspaces.js';
import { workspaceSetDataset } from '../trees.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import {
  PackageObjectType,
  TaskObjectType,
} from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { East, ArrayType, IRType } from '@elaraai/east';

/**
 * Create a minimal DataflowExecutionState with the given graph and tasks.
 */
function makeState(
  graph: DataflowGraph,
  tasks: Map<string, TaskState>,
  overrides?: Partial<{
    repo: string;
    workspace: string;
    taskOutputPaths: string[];
    executed: bigint;
    cached: bigint;
  }>,
): DataflowExecutionState {
  return {
    id: 'test-1',
    repo: overrides?.repo ?? '/tmp/test-repo',
    workspace: overrides?.workspace ?? 'test-ws',
    startedAt: new Date(),
    concurrency: 4n,
    force: false,
    filter: none,
    graph: some(graph),
    graphHash: none,
    tasks,
    executed: overrides?.executed ?? 0n,
    cached: overrides?.cached ?? 0n,
    failed: 0n,
    skipped: 0n,
    status: 'running',
    completedAt: none,
    error: none,
    versionVectors: new Map(),
    inputSnapshot: new Map(),
    taskOutputPaths: overrides?.taskOutputPaths ?? [],
    reexecuted: 0n,
    events: [],
    eventSeq: 0n,
  } as DataflowExecutionState;
}

/**
 * Create a minimal TaskState with the given status.
 */
function makeTaskState(name: string, status: TaskState['status']): TaskState {
  return {
    name,
    status,
    cached: none,
    outputHash: none,
    error: none,
    exitCode: none,
    startedAt: none,
    completedAt: none,
    duration: none,
  } as TaskState;
}

describe('stepInvalidateTasks', () => {
  it('does not invalidate failed tasks', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'failed'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'failed');
  });

  it('resets completed tasks to pending', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    const completedTask = makeTaskState('task-a', 'completed');
    // Mark as executed (not cached) so the counter decrement path is exercised
    (completedTask as Mutable<TaskState>).cached = some(false);
    (completedTask as Mutable<TaskState>).outputHash = some('old-output');
    tasks.set('task-a', completedTask);

    const state = makeState(graph, tasks, { executed: 1n });

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, ['task-a']);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
    assert.strictEqual(state.executed, 0n);
  });

  it('resets deferred tasks to pending without counting as invalidated', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'deferred'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
  });

  it('does not invalidate skipped tasks', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'skipped'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'skipped');
  });

  it('does not invalidate pending tasks', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
  });

  it('does not invalidate in-progress tasks', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'in_progress'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'in_progress');
  });

  it('decrements cached counter when invalidating cached task', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    const completedTask = makeTaskState('task-a', 'completed');
    (completedTask as Mutable<TaskState>).cached = some(true);
    (completedTask as Mutable<TaskState>).outputHash = some('old-output');
    tasks.set('task-a', completedTask);

    const state = makeState(graph, tasks, { cached: 1n, executed: 1n });

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, ['task-a']);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
    assert.strictEqual(state.cached, 0n);
    // executed counter should not be decremented for cached tasks
    assert.strictEqual(state.executed, 1n);
  });
});

describe('stepDetectInputChanges', () => {
  let testRepo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  async function createCommandIr(repoPath: string, parts: string[]): Promise<string> {
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => {
        const result: (string | ReturnType<typeof inputs.get>)[] = [];
        for (const part of parts) {
          if (part === '{input}' || part === '{input0}') {
            result.push(inputs.get(0n));
          } else if (part === '{output}') {
            result.push(output);
          } else {
            result.push(part);
          }
        }
        return result;
      }
    );
    const ir = commandFn.toIR().ir;
    const encoder = encodeBeast2For(IRType);
    return objectWrite(repoPath, encoder(ir));
  }

  async function createPackageWithTasks(
    repoPath: string,
    tasks: Array<{
      name: string;
      command: string[];
      inputs: TreePath[];
      output: TreePath;
    }>,
    structure: Structure,
  ): Promise<Map<string, string>> {
    const taskEncoder = encodeBeast2For(TaskObjectType);
    const tasksMap = new Map<string, string>();

    for (const t of tasks) {
      const commandIrHash = await createCommandIr(repoPath, t.command);
      const taskObj = {
        commandIr: commandIrHash,
        inputs: t.inputs,
        output: t.output,
      };
      const taskHash = await objectWrite(repoPath, taskEncoder(taskObj));
      tasksMap.set(t.name, taskHash);
    }

    const pkgEncoder = encodeBeast2For(PackageObjectType);
    const pkgObj = {
      data: {
        structure,
        refs: new Map(),
      },
      tasks: tasksMap,
    };
    const pkgHash = await objectWrite(repoPath, pkgEncoder(pkgObj));

    const pkgDir = join(repoPath, 'packages', 'test');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, '1.0.0'), pkgHash + '\n');

    return tasksMap;
  }

  it('uses cached structure when provided', async () => {
    const structure: Structure = {
      type: 'struct',
      value: new Map([
        ['input', { type: 'value', value: { type: StringType, writable: true } }],
        ['output', { type: 'value', value: { type: StringType, writable: true } }],
      ]),
    } as unknown as Structure;

    const inputPath: TreePath = [variant('field', 'input')];
    const outputPath: TreePath = [variant('field', 'output')];

    await createPackageWithTasks(
      testRepo,
      [{ name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath }],
      structure,
    );
    await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
    await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

    // Build a minimal state that mirrors what stepInitialize would produce
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks, {
      repo: testRepo,
      workspace: 'test-ws',
      taskOutputPaths: ['.output'],
    });
    state.inputSnapshot.set('.input', 'initial-hash');

    // Call without cached structure (reads from storage)
    const result1 = await stepDetectInputChanges(storage, state);

    // Reset snapshot to same value
    state.inputSnapshot.set('.input', 'initial-hash');

    // Call with cached structure (should produce the same results)
    const result2 = await stepDetectInputChanges(storage, state, structure);

    assert.ok(result1.changes.length > 0, 'Expected at least one change detected');
    assert.strictEqual(result1.changes.length, result2.changes.length);
    assert.strictEqual(result1.changes[0]!.path, result2.changes[0]!.path);
    assert.strictEqual(result1.changes[0]!.newHash, result2.changes[0]!.newHash);
  });
});

describe('stepCheckVersionConsistency', () => {
  it('returns consistent for non-conflicting version vectors', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.x', '.y'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks);
    // Both inputs agree on the shared key '.root'
    state.versionVectors.set('.x', new Map([
      ['.root', 'hash-1'],
    ]));
    state.versionVectors.set('.y', new Map([
      ['.root', 'hash-1'],
      ['.other', 'hash-2'],
    ]));

    const result = stepCheckVersionConsistency(state, 'task-a');

    assert.strictEqual(result.consistent, true);
    assert.ok('mergedVV' in result);
    assert.strictEqual(result.mergedVV.get('.root'), 'hash-1');
    assert.strictEqual(result.mergedVV.get('.other'), 'hash-2');
  });

  it('returns inconsistent for conflicting version vectors', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.x', '.y'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks);
    // Inputs disagree on '.root' — different hashes
    state.versionVectors.set('.x', new Map([
      ['.root', 'hash-1'],
    ]));
    state.versionVectors.set('.y', new Map([
      ['.root', 'hash-DIFFERENT'],
    ]));

    const result = stepCheckVersionConsistency(state, 'task-a');

    assert.strictEqual(result.consistent, false);
    assert.ok('conflictPath' in result);
    assert.strictEqual(result.conflictPath, '.root');
  });

  it('treats missing version vectors as consistent', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.x', '.y'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks);
    // Only set VV for one input — the other defaults to empty map
    state.versionVectors.set('.x', new Map([
      ['.root', 'hash-1'],
    ]));

    const result = stepCheckVersionConsistency(state, 'task-a');

    assert.strictEqual(result.consistent, true);
    assert.ok('mergedVV' in result);
    assert.strictEqual(result.mergedVV.get('.root'), 'hash-1');
  });

  it('throws for task not found in graph', () => {
    const graph: DataflowGraph = {
      tasks: [],
    };

    const tasks = new Map<string, TaskState>();
    const state = makeState(graph, tasks);

    assert.throws(
      () => stepCheckVersionConsistency(state, 'nonexistent'),
      { message: /nonexistent.*not found/ },
    );
  });
});

describe('InMemoryStateStore cloneState isolation', () => {
  it('isolates versionVectors across reads', async () => {
    const store = new InMemoryStateStore();
    const graph: DataflowGraph = { tasks: [] };
    const tasks = new Map<string, TaskState>();
    const state = makeState(graph, tasks);
    state.versionVectors.set('.x', new Map([['.x', 'hash-1']]));
    await store.create(state);

    // Read, mutate the inner map, then read again
    const read1 = await store.read(state.repo, state.workspace, state.id);
    read1!.versionVectors.get('.x')!.set('.y', 'leaked');

    const read2 = await store.read(state.repo, state.workspace, state.id);
    // The mutation on read1 must not be visible in read2
    assert.equal(read2!.versionVectors.get('.x')!.has('.y'), false);
  });

  it('isolates inputSnapshot across reads', async () => {
    const store = new InMemoryStateStore();
    const graph: DataflowGraph = { tasks: [] };
    const tasks = new Map<string, TaskState>();
    const state = makeState(graph, tasks);
    state.inputSnapshot.set('.input', 'hash-1');
    await store.create(state);

    const read1 = await store.read(state.repo, state.workspace, state.id);
    read1!.inputSnapshot.set('.leaked', 'bad');

    const read2 = await store.read(state.repo, state.workspace, state.id);
    assert.equal(read2!.inputSnapshot.has('.leaked'), false);
  });

  it('isolates taskOutputPaths across reads', async () => {
    const store = new InMemoryStateStore();
    const graph: DataflowGraph = { tasks: [] };
    const tasks = new Map<string, TaskState>();
    const state = makeState(graph, tasks, { taskOutputPaths: ['.output'] });
    await store.create(state);

    const read1 = await store.read(state.repo, state.workspace, state.id);
    read1!.taskOutputPaths.push('.leaked');

    const read2 = await store.read(state.repo, state.workspace, state.id);
    assert.equal(read2!.taskOutputPaths.length, 1);
  });
});
