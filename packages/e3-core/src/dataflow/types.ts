/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Resumable dataflow execution types.
 *
 * These types support both local and cloud execution by separating
 * execution state from orchestration. The state can be persisted to
 * a file (local) or DynamoDB (cloud) and resumed after interruption.
 */

import type { DataflowGraph } from '../dataflow.js';

// =============================================================================
// Execution State
// =============================================================================

/**
 * Status of a dataflow execution.
 */
export type DataflowExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Status of an individual task within an execution.
 */
export type TaskStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * Information about a task's execution state.
 */
export interface TaskState {
  /** Task name */
  name: string;
  /** Current status */
  status: TaskStatus;
  /** Whether the result was served from cache */
  cached?: boolean;
  /** Output hash if completed successfully */
  outputHash?: string;
  /** Error message if failed */
  error?: string;
  /** Exit code if task process failed */
  exitCode?: number;
  /** When the task started (ISO 8601) */
  startedAt?: string;
  /** When the task completed (ISO 8601) */
  completedAt?: string;
  /** Duration in milliseconds */
  duration?: number;
}

/**
 * Persistent state for a dataflow execution.
 *
 * This state can be serialized to JSON and stored in a file or database,
 * enabling resumable execution across process restarts.
 *
 * @remarks
 * - Sets are serialized as arrays when persisted to JSON
 * - The graph is immutable once the execution starts
 * - Task states track individual task progress
 */
export interface DataflowExecutionState {
  // Identity
  /** Unique execution ID (auto-increment integer) */
  id: number;
  /** Repository identifier */
  repo: string;
  /** Workspace name */
  workspace: string;
  /** When the execution started (ISO 8601) */
  startedAt: string;

  // Config (immutable after initialization)
  /** Maximum concurrent task executions */
  concurrency: number;
  /** Force re-execution even if cached */
  force: boolean;
  /** Filter to run only specific task(s) by exact name */
  filter: string | null;
  /** The dependency graph (computed at initialization) */
  graph: DataflowGraph;

  // Task tracking (mutable)
  /** Map of task name -> task state */
  tasks: Map<string, TaskState>;

  // Summary counters
  /** Number of tasks executed (not from cache) */
  executed: number;
  /** Number of tasks served from cache */
  cached: number;
  /** Number of tasks that failed */
  failed: number;
  /** Number of tasks skipped due to upstream failure */
  skipped: number;

  // Execution status
  /** Current execution status */
  status: DataflowExecutionStatus;
  /** When the execution completed (ISO 8601) */
  completedAt: string | null;
  /** Error message if status is 'failed' */
  error: string | null;

  // Event tracking
  /** Sequence number for events (auto-increment) */
  eventSeq: number;
}

// =============================================================================
// Events
// =============================================================================

/**
 * Base interface for all execution events.
 */
interface BaseEvent {
  /** Event sequence number within the execution */
  seq: number;
  /** When the event occurred (ISO 8601) */
  timestamp: string;
}

/**
 * Event: Execution started.
 */
export interface ExecutionStartedEvent extends BaseEvent {
  type: 'execution_started';
  /** Execution ID */
  executionId: number;
  /** Total number of tasks in the graph */
  totalTasks: number;
}

/**
 * Event: Task became ready to execute.
 */
export interface TaskReadyEvent extends BaseEvent {
  type: 'task_ready';
  /** Task name */
  task: string;
}

/**
 * Event: Task execution started.
 */
export interface TaskStartedEvent extends BaseEvent {
  type: 'task_started';
  /** Task name */
  task: string;
}

/**
 * Event: Task completed successfully.
 */
export interface TaskCompletedEvent extends BaseEvent {
  type: 'task_completed';
  /** Task name */
  task: string;
  /** Whether the result was served from cache */
  cached: boolean;
  /** Output hash */
  outputHash: string;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Event: Task failed.
 */
export interface TaskFailedEvent extends BaseEvent {
  type: 'task_failed';
  /** Task name */
  task: string;
  /** Error message */
  error?: string;
  /** Exit code if task process failed */
  exitCode?: number;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Event: Task was skipped due to upstream failure.
 */
export interface TaskSkippedEvent extends BaseEvent {
  type: 'task_skipped';
  /** Task name */
  task: string;
  /** Name of the upstream task that caused the skip */
  cause: string;
}

/**
 * Event: Execution completed.
 */
export interface ExecutionCompletedEvent extends BaseEvent {
  type: 'execution_completed';
  /** Whether all tasks succeeded */
  success: boolean;
  /** Summary counts */
  summary: {
    executed: number;
    cached: number;
    failed: number;
    skipped: number;
  };
  /** Total duration in milliseconds */
  duration: number;
}

/**
 * Event: Execution was cancelled.
 */
export interface ExecutionCancelledEvent extends BaseEvent {
  type: 'execution_cancelled';
  /** Reason for cancellation */
  reason?: string;
}

/**
 * Union of all execution event types.
 */
export type ExecutionEvent =
  | ExecutionStartedEvent
  | TaskReadyEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskSkippedEvent
  | ExecutionCompletedEvent
  | ExecutionCancelledEvent;

// =============================================================================
// Step Results
// =============================================================================

/**
 * Result of stepInitialize.
 */
export interface InitializeResult {
  /** The initialized execution state */
  state: DataflowExecutionState;
  /** Tasks that are immediately ready (no dependencies) */
  readyTasks: string[];
}

/**
 * Result of stepPrepareTask - information needed to execute a task.
 */
export interface PrepareTaskResult {
  /** Task name */
  task: string;
  /** Task object hash */
  taskHash: string;
  /** Input dataset hashes (in order) */
  inputHashes: string[];
  /** Output path string */
  outputPath: string;
  /** Cached output hash if available (skip execution) */
  cachedOutputHash: string | null;
}

/**
 * Result of a task execution (returned by TaskRunner).
 */
export interface TaskExecuteResult {
  /** Final state */
  state: 'success' | 'failed' | 'error';
  /** Whether the result was served from cache */
  cached: boolean;
  /** Output hash (if state is 'success') */
  outputHash?: string;
  /** Exit code (if state is 'failed') */
  exitCode?: number;
  /** Error message (if state is 'error') */
  error?: string;
}

/**
 * Result of stepTaskCompleted.
 */
export interface TaskCompletedResult {
  /** Tasks that became ready after this completion */
  newlyReady: string[];
}

/**
 * Result of stepTaskFailed.
 */
export interface TaskFailedResult {
  /** Tasks that should be skipped due to this failure */
  toSkip: string[];
}

/**
 * Result of stepFinalize.
 */
export interface FinalizeResult {
  /** Overall success - true if all tasks completed successfully */
  success: boolean;
  /** Number of tasks executed (not from cache) */
  executed: number;
  /** Number of tasks served from cache */
  cached: number;
  /** Number of tasks that failed */
  failed: number;
  /** Number of tasks skipped due to upstream failure */
  skipped: number;
  /** Total duration in milliseconds */
  duration: number;
}

// =============================================================================
// Serialization Helpers
// =============================================================================

/**
 * JSON-serializable version of DataflowExecutionState.
 *
 * Maps are converted to arrays of [key, value] pairs.
 */
export interface SerializedExecutionState {
  id: number;
  repo: string;
  workspace: string;
  startedAt: string;
  concurrency: number;
  force: boolean;
  filter: string | null;
  graph: DataflowGraph;
  tasks: Array<[string, TaskState]>;
  executed: number;
  cached: number;
  failed: number;
  skipped: number;
  status: DataflowExecutionStatus;
  completedAt: string | null;
  error: string | null;
  eventSeq: number;
}

/**
 * Serialize execution state to JSON-compatible format.
 */
export function serializeExecutionState(state: DataflowExecutionState): SerializedExecutionState {
  return {
    ...state,
    tasks: Array.from(state.tasks.entries()),
  };
}

/**
 * Deserialize execution state from JSON format.
 */
export function deserializeExecutionState(serialized: SerializedExecutionState): DataflowExecutionState {
  return {
    ...serialized,
    tasks: new Map(serialized.tasks),
  };
}
