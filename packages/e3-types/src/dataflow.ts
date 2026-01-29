/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dataflow execution state type definitions.
 *
 * These types define the persistent state for dataflow execution,
 * stored in workspaces/<ws>/execution.beast2
 *
 * Key design decisions:
 * - Dates are Date objects (via DateTimeType), not strings
 * - Events stored inline as array (single file, not separate JSONL)
 * - Tasks stored as Dict (not Map) for beast2 compatibility
 */

import {
  StructType,
  VariantType,
  ArrayType,
  DictType,
  StringType,
  IntegerType,
  BooleanType,
  DateTimeType,
  OptionType,
  ValueTypeOf,
} from '@elaraai/east';

// =============================================================================
// Status Literals (TypeScript only - East uses StringType)
// =============================================================================

/**
 * Status of a dataflow execution.
 */
export type DataflowExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Status of an individual task within an execution.
 */
export type TaskStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'skipped';

// =============================================================================
// Task State
// =============================================================================

/**
 * Information about a task's execution state.
 *
 * Stored in the tasks Dict of DataflowExecutionStateType.
 */
export const TaskStateType = StructType({
  /** Task name */
  name: StringType,
  /** Current status (TaskStatus as string) */
  status: StringType,
  /** Whether the result was served from cache */
  cached: OptionType(BooleanType),
  /** Output hash if completed successfully */
  outputHash: OptionType(StringType),
  /** Error message if failed */
  error: OptionType(StringType),
  /** Exit code if task process failed */
  exitCode: OptionType(IntegerType),
  /** When the task started */
  startedAt: OptionType(DateTimeType),
  /** When the task completed */
  completedAt: OptionType(DateTimeType),
  /** Duration in milliseconds */
  duration: OptionType(IntegerType),
});
export type TaskState = ValueTypeOf<typeof TaskStateType>;

// =============================================================================
// Graph Types
// =============================================================================

/**
 * A task within the dataflow graph.
 */
export const DataflowGraphTaskType = StructType({
  /** Task name */
  name: StringType,
  /** Task object hash */
  hash: StringType,
  /** Input dataset paths */
  inputs: ArrayType(StringType),
  /** Output dataset path */
  output: StringType,
  /** Names of tasks this depends on */
  dependsOn: ArrayType(StringType),
});
export type DataflowGraphTask = ValueTypeOf<typeof DataflowGraphTaskType>;

/**
 * The complete dataflow dependency graph.
 */
export const DataflowGraphType = StructType({
  /** All tasks in the graph */
  tasks: ArrayType(DataflowGraphTaskType),
});
export type DataflowGraph = ValueTypeOf<typeof DataflowGraphType>;

// =============================================================================
// Event Types
// =============================================================================

/**
 * Execution events (VariantType for discriminated union).
 *
 * Events track the progress of a dataflow execution and are stored
 * inline in the execution state (not as a separate JSONL file).
 */
export const ExecutionEventType = VariantType({
  /** Execution started */
  execution_started: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Execution ID */
    executionId: StringType,
    /** Total number of tasks in the graph */
    totalTasks: IntegerType,
  }),
  /** Task became ready to execute */
  task_ready: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
  }),
  /** Task execution started */
  task_started: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
  }),
  /** Task completed successfully */
  task_completed: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** Whether the result was served from cache */
    cached: BooleanType,
    /** Output hash */
    outputHash: StringType,
    /** Duration in milliseconds */
    duration: IntegerType,
  }),
  /** Task failed */
  task_failed: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** Error message */
    error: OptionType(StringType),
    /** Exit code if task process failed */
    exitCode: OptionType(IntegerType),
    /** Duration in milliseconds */
    duration: IntegerType,
  }),
  /** Task was skipped due to upstream failure */
  task_skipped: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** Name of the upstream task that caused the skip */
    cause: StringType,
  }),
  /** Execution completed */
  execution_completed: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Whether all tasks succeeded */
    success: BooleanType,
    /** Number of tasks executed (not from cache) */
    executed: IntegerType,
    /** Number of tasks served from cache */
    cached: IntegerType,
    /** Number of tasks that failed */
    failed: IntegerType,
    /** Number of tasks skipped */
    skipped: IntegerType,
    /** Total duration in milliseconds */
    duration: IntegerType,
  }),
  /** Execution was cancelled */
  execution_cancelled: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Reason for cancellation */
    reason: OptionType(StringType),
  }),
});
export type ExecutionEvent = ValueTypeOf<typeof ExecutionEventType>;

// =============================================================================
// Main Execution State
// =============================================================================

/**
 * Persistent state for a dataflow execution.
 *
 * Stored in workspaces/<ws>/execution.beast2
 *
 * @remarks
 * - Tasks are stored as a Dict (serializes as object, not array of tuples)
 * - Events are stored inline (not as separate JSONL file)
 * - Dates are Date objects (via DateTimeType)
 */
export const DataflowExecutionStateType = StructType({
  // Identity
  /** Unique execution ID (local: auto-increment, cloud: UUID) */
  id: StringType,
  /** Repository identifier */
  repo: StringType,
  /** Workspace name */
  workspace: StringType,
  /** When the execution started */
  startedAt: DateTimeType,

  // Config (immutable after initialization)
  /** Maximum concurrent task executions */
  concurrency: IntegerType,
  /** Force re-execution even if cached */
  force: BooleanType,
  /** Filter to run only specific task(s) by exact name */
  filter: OptionType(StringType),

  // Graph (inline or by reference)
  /** The dependency graph (for local execution) */
  graph: OptionType(DataflowGraphType),
  /** Hash/key referencing a separately stored graph (for cloud) */
  graphHash: OptionType(StringType),

  // Task tracking
  /** Map of task name -> task state */
  tasks: DictType(StringType, TaskStateType),

  // Summary counters
  /** Number of tasks executed (not from cache) */
  executed: IntegerType,
  /** Number of tasks served from cache */
  cached: IntegerType,
  /** Number of tasks that failed */
  failed: IntegerType,
  /** Number of tasks skipped due to upstream failure */
  skipped: IntegerType,

  // Status
  /** Current execution status */
  status: StringType, // DataflowExecutionStatus
  /** When the execution completed */
  completedAt: OptionType(DateTimeType),
  /** Error message if status is 'failed' */
  error: OptionType(StringType),

  // Events (inline array)
  /** All events for this execution */
  events: ArrayType(ExecutionEventType),
  /** Sequence number for next event (auto-increment) */
  eventSeq: IntegerType,
});
export type DataflowExecutionState = ValueTypeOf<typeof DataflowExecutionStateType>;
