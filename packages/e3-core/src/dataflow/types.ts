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
 *
 * Types are derived from EastType definitions in @elaraai/e3-types using
 * ValueTypeOf for proper branded variant/option support.
 */

import { type ValueTypeOf } from '@elaraai/east';
import {
  TaskStateType,
  DataflowGraphTaskType,
  DataflowGraphType,
  ExecutionEventType,
  DataflowExecutionStateType,
} from '@elaraai/e3-types';

// Re-export EastType schemas for serialization
export {
  TaskStateType,
  DataflowGraphTaskType,
  DataflowGraphType,
  ExecutionEventType,
  DataflowExecutionStateType,
} from '@elaraai/e3-types';

// Re-export status type aliases
export type { DataflowExecutionStatus, TaskStatus } from '@elaraai/e3-types';

// =============================================================================
// Types derived from EastTypes via ValueTypeOf
// =============================================================================

/**
 * Task state information.
 */
export type TaskState = ValueTypeOf<typeof TaskStateType>;

/**
 * Task in the dataflow graph.
 */
export type DataflowGraphTask = ValueTypeOf<typeof DataflowGraphTaskType>;

/**
 * Dataflow dependency graph.
 */
export type DataflowGraph = ValueTypeOf<typeof DataflowGraphType>;

/**
 * Execution event (discriminated union via VariantType).
 */
export type ExecutionEvent = ValueTypeOf<typeof ExecutionEventType>;

/**
 * Dataflow execution state.
 */
export type DataflowExecutionState = ValueTypeOf<typeof DataflowExecutionStateType>;

// =============================================================================
// Step Results (TypeScript-only, not persisted)
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

/**
 * Result of stepApplyTreeUpdate.
 */
export interface TreeUpdateResult {
  /** The new workspace root hash after the update */
  newRootHash: string;
}
