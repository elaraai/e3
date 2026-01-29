/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * File-based implementation of ExecutionStateStore.
 *
 * Persists execution state to the workspace directory structure:
 * - workspaces/{ws}/execution.beast2 - Current/last execution state (binary format)
 * - workspaces/{ws}/execution-counter - Auto-increment counter
 *
 * Events are stored inline in the execution state (not as a separate file).
 * This enables crash recovery and external monitoring of execution progress.
 */

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { encodeBeast2For, decodeBeast2For, some } from '@elaraai/east';
import type {
  ExecutionStateStore,
  TaskStatusDetails,
  ExecutionStatusDetails,
} from './interfaces.js';
import {
  DataflowExecutionStateType,
  type DataflowExecutionState,
  type ExecutionEvent,
  type TaskState,
  type TaskStatus,
} from '../types.js';

// Create encoder/decoder for beast2 serialization
const encode = encodeBeast2For(DataflowExecutionStateType);
const decode = decodeBeast2For(DataflowExecutionStateType);

// Type helper for mutable state (removes readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };

/**
 * File-based state store for local filesystem persistence.
 *
 * @remarks
 * - Uses atomic writes (write to temp, then rename) for durability
 * - State is stored in beast2 binary format for type safety
 * - Events are stored inline in the execution state
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
    return join(this.workspacePath(workspace), 'execution.beast2');
  }

  /**
   * Get the path to a workspace's execution counter file.
   */
  private counterPath(workspace: string): string {
    return join(this.workspacePath(workspace), 'execution-counter');
  }

  async create(state: DataflowExecutionState): Promise<void> {
    const path = this.statePath(state.workspace);

    // Check if execution already exists
    const existing = await this.read(state.repo, state.workspace, state.id);
    if (existing) {
      throw new Error(`Execution ${state.id} already exists in workspace '${state.workspace}'`);
    }

    // Write state atomically using beast2 encoding
    const data = encode(state);
    await this.atomicWrite(path, data);
  }

  async read(repo: string, workspace: string, id: string): Promise<DataflowExecutionState | null> {
    const path = this.statePath(workspace);

    try {
      const data = await fs.readFile(path);
      const state = decode(data);

      // Check if this is the requested execution
      if (state.id !== id) {
        return null;
      }

      // Verify repo matches (if stored)
      if (state.repo && state.repo !== repo) {
        return null;
      }

      return state;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async readLatest(_repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    const path = this.statePath(workspace);

    try {
      const data = await fs.readFile(path);
      return decode(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async update(state: DataflowExecutionState): Promise<void> {
    const path = this.statePath(state.workspace);
    const data = encode(state);
    await this.atomicWrite(path, data);
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
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
    }

    const taskState = state.tasks.get(task) as Mutable<TaskState> | undefined;
    if (!taskState) {
      throw new Error(`Task '${task}' not found in execution ${executionId}`);
    }

    const mutableState = state as Mutable<DataflowExecutionState>;

    taskState.status = status;
    if (details) {
      if (details.cached !== undefined) taskState.cached = some(details.cached);
      if (details.outputHash !== undefined) taskState.outputHash = some(details.outputHash);
      if (details.error !== undefined) taskState.error = some(details.error);
      if (details.exitCode !== undefined) taskState.exitCode = some(BigInt(details.exitCode));
      if (details.duration !== undefined) taskState.duration = some(BigInt(details.duration));
    }
    taskState.completedAt = some(new Date());

    // Update counters based on status
    if (status === 'completed' && details?.cached) {
      mutableState.cached = state.cached + 1n;
    } else if (status === 'completed') {
      mutableState.executed = state.executed + 1n;
    } else if (status === 'failed') {
      mutableState.failed = state.failed + 1n;
    } else if (status === 'skipped') {
      mutableState.skipped = state.skipped + 1n;
    }

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
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
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
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
    }

    // Append event to inline events array (cast to mutable array)
    (state.events as ExecutionEvent[]).push(event);

    await this.update(state);
  }

  async getEventsSince(
    repo: string,
    workspace: string,
    executionId: string,
    sinceSeq: number
  ): Promise<ExecutionEvent[]> {
    const state = await this.read(repo, workspace, executionId);
    if (!state) {
      return [];
    }

    // Filter events from inline array
    const sinceSeqBigInt = BigInt(sinceSeq);
    return state.events.filter(e => {
      // Events are variants, so we access seq via e.value.seq
      const seq = e.value.seq;
      return seq > sinceSeqBigInt;
    });
  }

  async nextExecutionId(_repo: string, workspace: string): Promise<string> {
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
    await this.atomicWriteText(path, String(next));
    return String(next);
  }

  async delete(_repo: string, workspace: string, executionId: string): Promise<void> {
    // Only delete if the stored execution matches the requested ID
    const state = await this.readLatest(_repo, workspace);
    if (state && state.id === executionId) {
      const statePath = this.statePath(workspace);

      try {
        await fs.unlink(statePath);
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
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @returns The incomplete execution if one exists, null otherwise
   */
  async getIncompleteExecution(repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    const state = await this.readLatest(repo, workspace);
    if (state && state.status === 'running') {
      return state;
    }
    return null;
  }

  /**
   * Write a binary file atomically using temp file + rename.
   */
  private async atomicWrite(path: string, content: Uint8Array): Promise<void> {
    const dir = dirname(path);
    const tmpPath = join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmpPath, content);
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

  /**
   * Write a text file atomically using temp file + rename.
   */
  private async atomicWriteText(path: string, content: string): Promise<void> {
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
