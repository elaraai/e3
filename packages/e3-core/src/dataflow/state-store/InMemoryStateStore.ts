/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * In-memory implementation of ExecutionStateStore.
 *
 * Useful for testing and simple cases where persistence is not required.
 * State is lost when the process exits.
 */

import { some } from '@elaraai/east';
import type {
  ExecutionStateStore,
  TaskStatusDetails,
  ExecutionStatusDetails,
} from './interfaces.js';
import type {
  DataflowExecutionState,
  DataflowGraph,
  ExecutionEvent,
  TaskStatus,
  TaskState,
} from '../types.js';

// Type helper for mutable state (removes readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };

/**
 * In-memory state store for testing and simple use cases.
 *
 * @remarks
 * - Thread-safe for concurrent access within a single process
 * - State is lost on process exit
 * - No durability guarantees
 */
export class InMemoryStateStore implements ExecutionStateStore {
  /** Map of "repo::workspace" -> execution ID -> state */
  private states = new Map<string, Map<string, DataflowExecutionState>>();

  /** Map of "repo::workspace" -> next execution ID counter */
  private counters = new Map<string, number>();

  private makeKey(repo: string, workspace: string): string {
    return `${repo}::${workspace}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async create(state: DataflowExecutionState): Promise<void> {
    const key = this.makeKey(state.repo, state.workspace);
    if (!this.states.has(key)) {
      this.states.set(key, new Map());
    }

    const wsStates = this.states.get(key)!;
    if (wsStates.has(state.id)) {
      throw new Error(`Execution ${state.id} already exists in ${key}`);
    }

    // Deep clone to prevent external mutation
    wsStates.set(state.id, this.cloneState(state));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async read(repo: string, workspace: string, id: string): Promise<DataflowExecutionState | null> {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    if (!wsStates) return null;

    const state = wsStates.get(id);
    if (!state) return null;

    return this.cloneState(state);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async readLatest(repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    if (!wsStates || wsStates.size === 0) return null;

    // Find the highest execution ID (assuming numeric string IDs)
    let latestId: string | null = null;
    let latestNum = -1;
    for (const id of wsStates.keys()) {
      const num = parseInt(id, 10);
      if (!isNaN(num) && num > latestNum) {
        latestNum = num;
        latestId = id;
      } else if (latestId === null) {
        // Fallback for non-numeric IDs: just take the first one
        latestId = id;
      }
    }

    if (latestId === null) return null;
    return this.cloneState(wsStates.get(latestId)!);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async update(state: DataflowExecutionState): Promise<void> {
    const key = this.makeKey(state.repo, state.workspace);
    const wsStates = this.states.get(key);
    if (!wsStates || !wsStates.has(state.id)) {
      throw new Error(`Execution ${state.id} not found in ${key}`);
    }

    wsStates.set(state.id, this.cloneState(state));
  }

  async updateTaskStatus(
    repo: string,
    workspace: string,
    executionId: string,
    task: string,
    status: TaskStatus,
    details?: TaskStatusDetails
  ): Promise<void> {
    const state = await this.read(repo, workspace, executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found in ${repo}::${workspace}`);
    }

    const taskState = state.tasks.get(task) as Mutable<TaskState> | undefined;
    if (!taskState) {
      throw new Error(`Task '${task}' not found in execution ${executionId}`);
    }

    taskState.status = status;
    if (details) {
      if (details.cached !== undefined) taskState.cached = some(details.cached);
      if (details.outputHash !== undefined) taskState.outputHash = some(details.outputHash);
      if (details.error !== undefined) taskState.error = some(details.error);
      if (details.exitCode !== undefined) taskState.exitCode = some(BigInt(details.exitCode));
      if (details.duration !== undefined) taskState.duration = some(BigInt(details.duration));
    }
    taskState.completedAt = some(new Date());

    await this.update(state);
  }

  async updateStatus(
    repo: string,
    workspace: string,
    executionId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details?: ExecutionStatusDetails
  ): Promise<void> {
    const state = await this.read(repo, workspace, executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found in ${repo}::${workspace}`);
    }

    const mutableState = state as Mutable<DataflowExecutionState>;

    mutableState.status = status;
    if (status !== 'running') {
      mutableState.completedAt = some(new Date());
    }
    if (details?.error) {
      mutableState.error = some(details.error);
    }
    if (details?.summary) {
      mutableState.executed = BigInt(details.summary.executed);
      mutableState.cached = BigInt(details.summary.cached);
      mutableState.failed = BigInt(details.summary.failed);
      mutableState.skipped = BigInt(details.summary.skipped);
    }

    await this.update(state);
  }

  async recordEvent(
    repo: string,
    workspace: string,
    executionId: string,
    event: ExecutionEvent
  ): Promise<void> {
    const state = await this.read(repo, workspace, executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found in ${repo}::${workspace}`);
    }

    // Append event to inline events array (cast to mutable array)
    (state.events as ExecutionEvent[]).push(event);

    await this.update(state);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getEventsSince(
    repo: string,
    workspace: string,
    executionId: string,
    sinceSeq: number
  ): Promise<ExecutionEvent[]> {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    if (!wsStates) return [];

    const state = wsStates.get(executionId);
    if (!state) return [];

    // Filter events from inline array
    const sinceSeqBigInt = BigInt(sinceSeq);
    return state.events.filter(e => e.value.seq > sinceSeqBigInt);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async nextExecutionId(repo: string, workspace: string): Promise<string> {
    const key = this.makeKey(repo, workspace);
    const current = this.counters.get(key) ?? 0;
    const next = current + 1;
    this.counters.set(key, next);
    return String(next);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(repo: string, workspace: string, executionId: string): Promise<void> {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    if (wsStates) {
      wsStates.delete(executionId);
    }
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.states.clear();
    this.counters.clear();
  }

  /**
   * Deep clone execution state to prevent external mutation.
   *
   * Note: We use spread and some() to properly clone the branded option types.
   */
  private cloneState(state: DataflowExecutionState): DataflowExecutionState {
    const tasks = new Map<string, TaskState>();
    for (const [name, taskState] of state.tasks) {
      // Shallow clone is sufficient since we use some() for options
      tasks.set(name, { ...taskState } as TaskState);
    }

    // Clone graph if present
    let graph = state.graph;
    if (state.graph.type === 'some') {
      const graphValue: DataflowGraph = {
        tasks: state.graph.value.tasks.map(t => ({
          ...t,
          inputs: [...t.inputs],
          dependsOn: [...t.dependsOn],
        })),
      };
      graph = some(graphValue);
    }

    // Clone completedAt if present
    let completedAt = state.completedAt;
    if (state.completedAt.type === 'some') {
      completedAt = some(new Date(state.completedAt.value.getTime()));
    }

    return {
      ...state,
      startedAt: new Date(state.startedAt.getTime()),
      completedAt,
      graph,
      tasks,
      events: [...state.events],
    } as DataflowExecutionState;
  }
}
