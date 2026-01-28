/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * File-based implementation of ExecutionStateStore.
 *
 * Persists execution state to the workspace directory structure:
 * - workspaces/{ws}/execution.json - Current/last execution state
 * - workspaces/{ws}/execution-counter - Auto-increment counter
 * - workspaces/{ws}/execution-events.jsonl - Event log (append-only)
 *
 * This enables crash recovery and external monitoring of execution progress.
 */

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  ExecutionStateStore,
  TaskStatusDetails,
  ExecutionStatusDetails,
} from './interfaces.js';
import type {
  DataflowExecutionState,
  ExecutionEvent,
  TaskStatus,
  SerializedExecutionState,
} from '../types.js';
import {
  serializeExecutionState,
  deserializeExecutionState,
} from '../types.js';

/**
 * File-based state store for local filesystem persistence.
 *
 * @remarks
 * - Uses atomic writes (write to temp, then rename) for durability
 * - Event log uses append-only JSONL format
 * - Thread-safe for concurrent access within a single process (via file locking)
 * - Suitable for local CLI and API server usage
 */
export class FileStateStore implements ExecutionStateStore {
  /**
   * Create a new FileStateStore.
   *
   * @param workspacesDir - Path to the workspaces directory (e.g., repo/workspaces)
   */
  constructor(private readonly workspacesDir: string) {}

  /**
   * Get the path to a workspace's directory.
   */
  private workspacePath(workspace: string): string {
    return join(this.workspacesDir, workspace);
  }

  /**
   * Get the path to a workspace's execution state file.
   */
  private statePath(workspace: string): string {
    return join(this.workspacePath(workspace), 'execution.json');
  }

  /**
   * Get the path to a workspace's execution counter file.
   */
  private counterPath(workspace: string): string {
    return join(this.workspacePath(workspace), 'execution-counter');
  }

  /**
   * Get the path to a workspace's event log file.
   */
  private eventsPath(workspace: string): string {
    return join(this.workspacePath(workspace), 'execution-events.jsonl');
  }

  async create(state: DataflowExecutionState): Promise<void> {
    const path = this.statePath(state.workspace);

    // Check if execution already exists
    const existing = await this.read(state.workspace, state.id);
    if (existing) {
      throw new Error(`Execution ${state.id} already exists in workspace '${state.workspace}'`);
    }

    // Write state atomically
    await this.atomicWrite(path, JSON.stringify(serializeExecutionState(state), null, 2));

    // Clear events file for new execution
    await this.atomicWrite(this.eventsPath(state.workspace), '');
  }

  async read(workspace: string, id: number): Promise<DataflowExecutionState | null> {
    const path = this.statePath(workspace);

    try {
      const data = await fs.readFile(path, 'utf-8');
      const serialized = JSON.parse(data) as SerializedExecutionState;

      // Check if this is the requested execution
      if (serialized.id !== id) {
        return null;
      }

      return deserializeExecutionState(serialized);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async readLatest(workspace: string): Promise<DataflowExecutionState | null> {
    const path = this.statePath(workspace);

    try {
      const data = await fs.readFile(path, 'utf-8');
      const serialized = JSON.parse(data) as SerializedExecutionState;
      return deserializeExecutionState(serialized);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async update(state: DataflowExecutionState): Promise<void> {
    const path = this.statePath(state.workspace);
    await this.atomicWrite(path, JSON.stringify(serializeExecutionState(state), null, 2));
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

    // Update counters based on status
    if (status === 'completed' && details?.cached) {
      state.cached++;
    } else if (status === 'completed') {
      state.executed++;
    } else if (status === 'failed') {
      state.failed++;
    } else if (status === 'skipped') {
      state.skipped++;
    }

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

  async recordEvent(
    workspace: string,
    _executionId: number,
    event: ExecutionEvent
  ): Promise<void> {
    const path = this.eventsPath(workspace);
    const line = JSON.stringify(event) + '\n';

    // Append to events file
    await fs.appendFile(path, line, 'utf-8');
  }

  async getEventsSince(
    workspace: string,
    _executionId: number,
    sinceSeq: number
  ): Promise<ExecutionEvent[]> {
    const path = this.eventsPath(workspace);

    try {
      const data = await fs.readFile(path, 'utf-8');
      const events: ExecutionEvent[] = [];

      for (const line of data.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as ExecutionEvent;
          if (event.seq > sinceSeq) {
            events.push(event);
          }
        } catch {
          // Skip malformed lines
        }
      }

      return events;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async nextExecutionId(workspace: string): Promise<number> {
    const path = this.counterPath(workspace);

    let current = 0;
    try {
      const data = await fs.readFile(path, 'utf-8');
      current = parseInt(data.trim(), 10) || 0;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    const next = current + 1;
    await this.atomicWrite(path, String(next));
    return next;
  }

  async delete(workspace: string, executionId: number): Promise<void> {
    // Only delete if the stored execution matches the requested ID
    const state = await this.readLatest(workspace);
    if (state && state.id === executionId) {
      const statePath = this.statePath(workspace);
      const eventsPath = this.eventsPath(workspace);

      try {
        await fs.unlink(statePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }

      try {
        await fs.unlink(eventsPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
  }

  /**
   * Check if an incomplete execution exists for a workspace.
   *
   * An execution is incomplete if its status is 'running'.
   * This is used to detect crash recovery scenarios.
   *
   * @param workspace - Workspace name
   * @returns The incomplete execution if one exists, null otherwise
   */
  async getIncompleteExecution(workspace: string): Promise<DataflowExecutionState | null> {
    const state = await this.readLatest(workspace);
    if (state && state.status === 'running') {
      return state;
    }
    return null;
  }

  /**
   * Write a file atomically using temp file + rename.
   */
  private async atomicWrite(path: string, content: string): Promise<void> {
    const dir = dirname(path);
    const tmpPath = join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, path);
    } catch (err) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }
}
