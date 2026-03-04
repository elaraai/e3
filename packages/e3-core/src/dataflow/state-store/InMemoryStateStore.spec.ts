/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Unit tests for InMemoryStateStore cloneState isolation.
 *
 * Ensures that reads return independent copies so that
 * external mutation cannot corrupt the store's internal state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { some, none } from '@elaraai/east';
import type { DataflowExecutionState, TaskState } from '../types.js';
import type { DataflowGraph } from '../../dataflow.js';
import { InMemoryStateStore } from './InMemoryStateStore.js';

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
    executed: 0n,
    cached: 0n,
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
