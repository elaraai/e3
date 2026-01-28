/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * State store interface for dataflow execution.
 *
 * Abstracts the persistence of execution state, enabling:
 * - InMemoryStateStore: For testing and simple cases
 * - FileStateStore: Local filesystem persistence (workspace/execution.json)
 * - DynamoDBStateStore: Cloud execution (in e3-aws)
 */

import type {
  DataflowExecutionState,
  ExecutionEvent,
  TaskStatus,
} from '../types.js';

/**
 * Details for task status updates.
 */
export interface TaskStatusDetails {
  /** Whether the result was from cache */
  cached?: boolean;
  /** Output hash (for completed tasks) */
  outputHash?: string;
  /** Error message (for failed tasks) */
  error?: string;
  /** Exit code (for failed tasks) */
  exitCode?: number;
  /** Duration in milliseconds */
  duration?: number;
}

/**
 * Details for execution status updates.
 */
export interface ExecutionStatusDetails {
  /** Error message (for failed executions) */
  error?: string;
  /** Summary counts */
  summary?: {
    executed: number;
    cached: number;
    failed: number;
    skipped: number;
  };
}

/**
 * Interface for persisting and retrieving execution state.
 *
 * Implementations must be thread-safe for concurrent access within a process.
 * For distributed execution (cloud), implementations should use optimistic
 * concurrency control (e.g., DynamoDB conditional writes).
 */
export interface ExecutionStateStore {
  /**
   * Create a new execution state.
   *
   * @param state - The initial execution state
   * @throws If an execution with the same ID already exists
   */
  create(state: DataflowExecutionState): Promise<void>;

  /**
   * Read an execution state by ID.
   *
   * @param workspace - Workspace name
   * @param id - Execution ID
   * @returns The execution state, or null if not found
   */
  read(workspace: string, id: number): Promise<DataflowExecutionState | null>;

  /**
   * Read the most recent execution for a workspace.
   *
   * @param workspace - Workspace name
   * @returns The most recent execution state, or null if none exists
   */
  readLatest(workspace: string): Promise<DataflowExecutionState | null>;

  /**
   * Update the entire execution state.
   *
   * This is used for bulk updates after a sequence of step functions.
   * Implementations may optimize by only writing changed fields.
   *
   * @param state - The updated execution state
   */
  update(state: DataflowExecutionState): Promise<void>;

  /**
   * Update a task's status within an execution.
   *
   * This is a convenience method for updating a single task without
   * reading and writing the entire state.
   *
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   * @param task - Task name
   * @param status - New status
   * @param details - Additional details (output hash, error, etc.)
   */
  updateTaskStatus(
    workspace: string,
    executionId: number,
    task: string,
    status: TaskStatus,
    details?: TaskStatusDetails
  ): Promise<void>;

  /**
   * Update the execution's overall status.
   *
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   * @param status - New status ('running' | 'completed' | 'failed' | 'cancelled')
   * @param details - Additional details (error message, summary)
   */
  updateStatus(
    workspace: string,
    executionId: number,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details?: ExecutionStatusDetails
  ): Promise<void>;

  /**
   * Record an event for an execution.
   *
   * Events are used for monitoring and debugging. They are append-only
   * and can be read with getEventsSince().
   *
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   * @param event - The event to record
   */
  recordEvent(
    workspace: string,
    executionId: number,
    event: ExecutionEvent
  ): Promise<void>;

  /**
   * Get events for an execution since a given sequence number.
   *
   * Used for polling/watching execution progress.
   *
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   * @param sinceSeq - Only return events with seq > sinceSeq
   * @returns Array of events in sequence order
   */
  getEventsSince(
    workspace: string,
    executionId: number,
    sinceSeq: number
  ): Promise<ExecutionEvent[]>;

  /**
   * Get the next execution ID for a workspace.
   *
   * IDs are auto-incrementing integers starting from 1.
   * This method atomically reserves the next ID.
   *
   * @param workspace - Workspace name
   * @returns The next execution ID
   */
  nextExecutionId(workspace: string): Promise<number>;

  /**
   * Delete an execution state.
   *
   * Used for cleanup after execution completion or for removing
   * abandoned executions.
   *
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   */
  delete(workspace: string, executionId: number): Promise<void>;
}
