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

import type {
  ExecutionStateStore,
  TaskStatusDetails,
  ExecutionStatusDetails,
} from './interfaces.js';
import type {
  DataflowExecutionState,
  ExecutionEvent,
  TaskStatus,
  TaskState,
} from '../types.js';

/**
 * In-memory state store for testing and simple use cases.
 *
 * @remarks
 * - Thread-safe for concurrent access within a single process
 * - State is lost on process exit
 * - No durability guarantees
 */
export class InMemoryStateStore implements ExecutionStateStore {
  /** Map of workspace -> execution ID -> state */
  private states = new Map<string, Map<number, DataflowExecutionState>>();

  /** Map of workspace -> execution ID -> events */
  private events = new Map<string, Map<number, ExecutionEvent[]>>();

  /** Map of workspace -> next execution ID */
  private counters = new Map<string, number>();

  // eslint-disable-next-line @typescript-eslint/require-await
  async create(state: DataflowExecutionState): Promise<void> {
    const ws = state.workspace;
    if (!this.states.has(ws)) {
      this.states.set(ws, new Map());
      this.events.set(ws, new Map());
    }

    const wsStates = this.states.get(ws)!;
    if (wsStates.has(state.id)) {
      throw new Error(`Execution ${state.id} already exists in workspace '${ws}'`);
    }

    // Deep clone to prevent external mutation
    wsStates.set(state.id, this.cloneState(state));
    this.events.get(ws)!.set(state.id, []);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async read(workspace: string, id: number): Promise<DataflowExecutionState | null> {
    const wsStates = this.states.get(workspace);
    if (!wsStates) return null;

    const state = wsStates.get(id);
    if (!state) return null;

    return this.cloneState(state);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async readLatest(workspace: string): Promise<DataflowExecutionState | null> {
    const wsStates = this.states.get(workspace);
    if (!wsStates || wsStates.size === 0) return null;

    // Find the highest execution ID
    let maxId = -1;
    for (const id of wsStates.keys()) {
      if (id > maxId) maxId = id;
    }

    if (maxId === -1) return null;
    return this.cloneState(wsStates.get(maxId)!);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async update(state: DataflowExecutionState): Promise<void> {
    const wsStates = this.states.get(state.workspace);
    if (!wsStates || !wsStates.has(state.id)) {
      throw new Error(`Execution ${state.id} not found in workspace '${state.workspace}'`);
    }

    wsStates.set(state.id, this.cloneState(state));
  }

  async updateTaskStatus(
    workspace: string,
    executionId: number,
    task: string,
    status: TaskStatus,
    details?: TaskStatusDetails
  ): Promise<void> {
    const state = await this.read(workspace, executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
    }

    const taskState = state.tasks.get(task);
    if (!taskState) {
      throw new Error(`Task '${task}' not found in execution ${executionId}`);
    }

    taskState.status = status;
    if (details) {
      if (details.cached !== undefined) taskState.cached = details.cached;
      if (details.outputHash !== undefined) taskState.outputHash = details.outputHash;
      if (details.error !== undefined) taskState.error = details.error;
      if (details.exitCode !== undefined) taskState.exitCode = details.exitCode;
      if (details.duration !== undefined) taskState.duration = details.duration;
    }
    taskState.completedAt = new Date().toISOString();

    await this.update(state);
  }

  async updateStatus(
    workspace: string,
    executionId: number,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details?: ExecutionStatusDetails
  ): Promise<void> {
    const state = await this.read(workspace, executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
    }

    state.status = status;
    if (status !== 'running') {
      state.completedAt = new Date().toISOString();
    }
    if (details?.error) {
      state.error = details.error;
    }
    if (details?.summary) {
      state.executed = details.summary.executed;
      state.cached = details.summary.cached;
      state.failed = details.summary.failed;
      state.skipped = details.summary.skipped;
    }

    await this.update(state);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async recordEvent(
    workspace: string,
    executionId: number,
    event: ExecutionEvent
  ): Promise<void> {
    const wsEvents = this.events.get(workspace);
    if (!wsEvents) {
      throw new Error(`Workspace '${workspace}' not found`);
    }

    const execEvents = wsEvents.get(executionId);
    if (!execEvents) {
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
    }

    execEvents.push({ ...event });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getEventsSince(
    workspace: string,
    executionId: number,
    sinceSeq: number
  ): Promise<ExecutionEvent[]> {
    const wsEvents = this.events.get(workspace);
    if (!wsEvents) return [];

    const execEvents = wsEvents.get(executionId);
    if (!execEvents) return [];

    return execEvents.filter(e => e.seq > sinceSeq).map(e => ({ ...e }));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async nextExecutionId(workspace: string): Promise<number> {
    const current = this.counters.get(workspace) ?? 0;
    const next = current + 1;
    this.counters.set(workspace, next);
    return next;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(workspace: string, executionId: number): Promise<void> {
    const wsStates = this.states.get(workspace);
    if (wsStates) {
      wsStates.delete(executionId);
    }

    const wsEvents = this.events.get(workspace);
    if (wsEvents) {
      wsEvents.delete(executionId);
    }
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.states.clear();
    this.events.clear();
    this.counters.clear();
  }

  /**
   * Deep clone execution state to prevent external mutation.
   */
  private cloneState(state: DataflowExecutionState): DataflowExecutionState {
    const tasks = new Map<string, TaskState>();
    for (const [name, taskState] of state.tasks) {
      tasks.set(name, { ...taskState });
    }

    return {
      ...state,
      graph: {
        tasks: state.graph.tasks.map(t => ({
          ...t,
          inputs: [...t.inputs],
          dependsOn: [...t.dependsOn],
        })),
      },
      tasks,
    };
  }
}
