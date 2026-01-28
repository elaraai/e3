/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Step functions for resumable dataflow execution.
 *
 * Each step function represents a single unit of work that can be:
 * - Called locally in a loop (LocalOrchestrator)
 * - Invoked as a Lambda handler (Step Functions orchestration)
 *
 * Step functions are designed to be:
 * - Small and focused (one step = one Lambda invocation)
 * - Deterministic where possible (pure functions marked as such)
 * - Idempotent for retries
 */

import type { StorageBackend } from '../storage/interfaces.js';
import {
  dataflowGetGraph,
  dataflowGetReadyTasks,
  dataflowGetDependentsToSkip,
  dataflowResolveInputHashes,
  dataflowCheckCache,
} from '../dataflow.js';
import {
  workspaceGetDatasetHash,
} from '../trees.js';
import type {
  DataflowExecutionState,
  TaskState,
  InitializeResult,
  PrepareTaskResult,
  TaskCompletedResult,
  TaskFailedResult,
  FinalizeResult,
  ExecutionEvent,
} from './types.js';

// =============================================================================
// Initialization
// =============================================================================

/**
 * Options for initializing a dataflow execution.
 */
export interface StepInitializeOptions {
  /** Maximum concurrent task executions (default: 4) */
  concurrency?: number;
  /** Force re-execution even if cached (default: false) */
  force?: boolean;
  /** Filter to run only specific task(s) by exact name */
  filter?: string;
}

/**
 * Initialize a new dataflow execution.
 *
 * Builds the dependency graph and creates the initial execution state.
 * This is an async operation because it reads workspace and package state.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - Workspace name
 * @param executionId - Unique execution ID
 * @param options - Execution options
 * @returns Initial state and ready tasks
 *
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 * @throws {TaskNotFoundError} If filter specifies a task that doesn't exist
 */
export async function stepInitialize(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  executionId: number,
  options: StepInitializeOptions = {}
): Promise<InitializeResult> {
  const concurrency = options.concurrency ?? 4;
  const force = options.force ?? false;
  const filter = options.filter ?? null;

  // Build the dependency graph
  const graph = await dataflowGetGraph(storage, repo, workspace);

  // Validate filter
  if (filter !== null) {
    const taskExists = graph.tasks.some(t => t.name === filter);
    if (!taskExists) {
      // Import here to avoid circular dependency
      const { TaskNotFoundError } = await import('../errors.js');
      throw new TaskNotFoundError(filter);
    }
  }

  // Initialize task states
  const tasks = new Map<string, TaskState>();
  for (const task of graph.tasks) {
    tasks.set(task.name, {
      name: task.name,
      status: 'pending',
    });
  }

  // Create initial state
  const state: DataflowExecutionState = {
    id: executionId,
    repo,
    workspace,
    startedAt: new Date().toISOString(),
    concurrency,
    force,
    filter,
    graph,
    tasks,
    executed: 0,
    cached: 0,
    failed: 0,
    skipped: 0,
    status: 'running',
    completedAt: null,
    error: null,
    eventSeq: 0,
  };

  // Find initially ready tasks
  const readyTasks = stepGetReady(state);

  // Update task states to 'ready'
  for (const taskName of readyTasks) {
    const taskState = tasks.get(taskName)!;
    taskState.status = 'ready';
  }

  return { state, readyTasks };
}

// =============================================================================
// Pure Step Functions
// =============================================================================

/**
 * Get tasks that are ready to execute.
 *
 * A task is ready when:
 * 1. All tasks it depends on have completed (not just started)
 * 2. It passes the filter (if any)
 * 3. It is not already completed, in-progress, failed, or skipped
 *
 * This is a pure function - it only reads state.
 *
 * @param state - Current execution state
 * @returns Array of task names that are ready to execute
 */
export function stepGetReady(state: DataflowExecutionState): string[] {
  const completedTasks = new Set<string>();
  for (const [name, taskState] of state.tasks) {
    if (taskState.status === 'completed') {
      completedTasks.add(name);
    }
  }

  // Get ready tasks from graph
  const graphReady = dataflowGetReadyTasks(state.graph, completedTasks);

  // Filter by state and filter option
  return graphReady.filter(taskName => {
    const taskState = state.tasks.get(taskName);
    if (!taskState) return false;

    // Skip tasks that are already being processed
    if (taskState.status !== 'pending' && taskState.status !== 'ready') {
      return false;
    }

    // Apply task filter
    if (state.filter !== null && taskName !== state.filter) {
      return false;
    }

    return true;
  });
}

/**
 * Check if the execution is complete.
 *
 * An execution is complete when:
 * - All tasks are in a terminal state (completed, failed, skipped)
 * - Or there are no more ready tasks and no tasks in progress
 *
 * This is a pure function - it only reads state.
 *
 * @param state - Current execution state
 * @returns True if execution is complete
 */
export function stepIsComplete(state: DataflowExecutionState): boolean {
  for (const taskState of state.tasks.values()) {
    // Check if any task is still in a non-terminal state
    if (
      taskState.status === 'pending' ||
      taskState.status === 'ready' ||
      taskState.status === 'in_progress'
    ) {
      // If in progress, not complete
      if (taskState.status === 'in_progress') {
        return false;
      }

      // If pending or ready, check if it can ever become ready
      // A task is stuck if it has unmet dependencies that failed/skipped
      const task = state.graph.tasks.find(t => t.name === taskState.name);
      if (task) {
        const hasUnmetDeps = task.dependsOn.some(dep => {
          const depState = state.tasks.get(dep);
          return depState && (depState.status === 'failed' || depState.status === 'skipped');
        });
        // If it's stuck due to failed deps, it should have been skipped
        // If not stuck, we're not complete
        if (!hasUnmetDeps) {
          // Check if it passes the filter
          if (state.filter !== null && taskState.name !== state.filter) {
            continue; // Filtered out, doesn't affect completion
          }
          return false;
        }
      }
    }
  }

  return true;
}

// =============================================================================
// Async Step Functions (I/O operations)
// =============================================================================

/**
 * Prepare a task for execution by resolving inputs and checking cache.
 *
 * This async operation:
 * 1. Resolves input hashes from current workspace state
 * 2. Checks if there's a valid cached execution
 *
 * @param storage - Storage backend
 * @param state - Current execution state
 * @param taskName - Name of the task to prepare
 * @returns Preparation result with input hashes and cache status
 */
export async function stepPrepareTask(
  storage: StorageBackend,
  state: DataflowExecutionState,
  taskName: string
): Promise<PrepareTaskResult> {
  const task = state.graph.tasks.find(t => t.name === taskName);
  if (!task) {
    throw new Error(`Task '${taskName}' not found in graph`);
  }

  // Resolve input hashes
  const inputHashes = await dataflowResolveInputHashes(
    storage,
    state.repo,
    state.workspace,
    task
  );

  // Check for null inputs (unassigned)
  const validInputHashes: string[] = [];
  for (const hash of inputHashes) {
    if (hash === null) {
      throw new Error(`Task '${taskName}' has unassigned input`);
    }
    validInputHashes.push(hash);
  }

  // Check cache if not forcing re-execution
  let cachedOutputHash: string | null = null;
  if (!state.force) {
    cachedOutputHash = await dataflowCheckCache(
      storage,
      state.repo,
      task.hash,
      validInputHashes
    );

    // Also verify the workspace output matches the cached output
    if (cachedOutputHash !== null) {
      const { parsePathString } = await import('../dataflow.js');
      const outputPath = parsePathString(task.output);
      const { refType, hash: wsOutputHash } = await workspaceGetDatasetHash(
        storage,
        state.repo,
        state.workspace,
        outputPath
      );
      if (refType !== 'value' || wsOutputHash !== cachedOutputHash) {
        // Workspace output doesn't match cached output, need to re-execute
        cachedOutputHash = null;
      }
    }
  }

  return {
    task: taskName,
    taskHash: task.hash,
    inputHashes: validInputHashes,
    outputPath: task.output,
    cachedOutputHash,
  };
}

// =============================================================================
// State Mutation Step Functions
// =============================================================================

/**
 * Mark a task as started (in-progress).
 *
 * Mutates the execution state to record that a task has begun execution.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the task
 * @returns Event to record
 */
export function stepTaskStarted(
  state: DataflowExecutionState,
  taskName: string
): ExecutionEvent {
  const taskState = state.tasks.get(taskName);
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  taskState.status = 'in_progress';
  taskState.startedAt = new Date().toISOString();

  state.eventSeq++;
  return {
    type: 'task_started',
    seq: state.eventSeq,
    timestamp: taskState.startedAt,
    task: taskName,
  };
}

/**
 * Mark a task as completed successfully.
 *
 * Mutates the execution state and returns the newly ready tasks.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the task
 * @param outputHash - Hash of the output dataset
 * @param cached - Whether the result was from cache
 * @param duration - Execution duration in milliseconds
 * @returns Result with newly ready tasks and event
 */
export function stepTaskCompleted(
  state: DataflowExecutionState,
  taskName: string,
  outputHash: string,
  cached: boolean,
  duration: number
): { result: TaskCompletedResult; event: ExecutionEvent } {
  const taskState = state.tasks.get(taskName);
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  const now = new Date().toISOString();

  taskState.status = 'completed';
  taskState.cached = cached;
  taskState.outputHash = outputHash;
  taskState.completedAt = now;
  taskState.duration = duration;

  // Update counters
  if (cached) {
    state.cached++;
  } else {
    state.executed++;
  }

  // Find newly ready tasks
  const newlyReady = stepGetReady(state);
  for (const name of newlyReady) {
    const ts = state.tasks.get(name);
    if (ts && ts.status === 'pending') {
      ts.status = 'ready';
    }
  }

  state.eventSeq++;
  const event: ExecutionEvent = {
    type: 'task_completed',
    seq: state.eventSeq,
    timestamp: now,
    task: taskName,
    cached,
    outputHash,
    duration,
  };

  return { result: { newlyReady }, event };
}

/**
 * Mark a task as failed.
 *
 * Mutates the execution state and returns tasks that should be skipped.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the failed task
 * @param error - Error message (optional)
 * @param exitCode - Exit code if process failed (optional)
 * @param duration - Execution duration in milliseconds
 * @returns Result with tasks to skip and event
 */
export function stepTaskFailed(
  state: DataflowExecutionState,
  taskName: string,
  error: string | undefined,
  exitCode: number | undefined,
  duration: number
): { result: TaskFailedResult; event: ExecutionEvent } {
  const taskState = state.tasks.get(taskName);
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  const now = new Date().toISOString();

  taskState.status = 'failed';
  taskState.error = error;
  taskState.exitCode = exitCode;
  taskState.completedAt = now;
  taskState.duration = duration;

  // Update counters
  state.failed++;

  // Find tasks to skip (transitive dependents)
  const completedSet = new Set<string>();
  const skippedSet = new Set<string>();
  for (const [name, ts] of state.tasks) {
    if (ts.status === 'completed') completedSet.add(name);
    if (ts.status === 'skipped') skippedSet.add(name);
  }

  const toSkip = dataflowGetDependentsToSkip(
    state.graph,
    taskName,
    completedSet,
    skippedSet
  ).filter(name => {
    // Also exclude in-progress tasks and apply filter
    const ts = state.tasks.get(name);
    if (!ts || ts.status === 'in_progress') return false;
    if (state.filter !== null && name !== state.filter) return false;
    return true;
  });

  state.eventSeq++;
  const event: ExecutionEvent = {
    type: 'task_failed',
    seq: state.eventSeq,
    timestamp: now,
    task: taskName,
    error,
    exitCode,
    duration,
  };

  return { result: { toSkip }, event };
}

/**
 * Mark tasks as skipped due to upstream failure.
 *
 * @param state - Execution state to mutate
 * @param taskNames - Names of tasks to skip
 * @param cause - Name of the task that caused the skip
 * @returns Array of events to record
 */
export function stepTasksSkipped(
  state: DataflowExecutionState,
  taskNames: string[],
  cause: string
): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  const now = new Date().toISOString();

  for (const taskName of taskNames) {
    const taskState = state.tasks.get(taskName);
    if (!taskState) continue;

    taskState.status = 'skipped';
    taskState.completedAt = now;
    taskState.duration = 0;

    state.skipped++;

    state.eventSeq++;
    events.push({
      type: 'task_skipped',
      seq: state.eventSeq,
      timestamp: now,
      task: taskName,
      cause,
    });
  }

  return events;
}

/**
 * Finalize the execution and return the result.
 *
 * Mutates the execution state to mark it as completed or failed.
 *
 * @param state - Execution state to mutate
 * @returns Final result
 */
export function stepFinalize(state: DataflowExecutionState): {
  result: FinalizeResult;
  event: ExecutionEvent;
} {
  const now = new Date().toISOString();
  const startTime = new Date(state.startedAt).getTime();
  const duration = Date.now() - startTime;

  // Determine success
  const success = state.failed === 0;

  // Update state
  state.status = success ? 'completed' : 'failed';
  state.completedAt = now;

  state.eventSeq++;
  const event: ExecutionEvent = {
    type: 'execution_completed',
    seq: state.eventSeq,
    timestamp: now,
    success,
    summary: {
      executed: state.executed,
      cached: state.cached,
      failed: state.failed,
      skipped: state.skipped,
    },
    duration,
  };

  const result: FinalizeResult = {
    success,
    executed: state.executed,
    cached: state.cached,
    failed: state.failed,
    skipped: state.skipped,
    duration,
  };

  return { result, event };
}

/**
 * Cancel the execution.
 *
 * @param state - Execution state to mutate
 * @param reason - Reason for cancellation
 * @returns Event to record
 */
export function stepCancel(
  state: DataflowExecutionState,
  reason?: string
): ExecutionEvent {
  const now = new Date().toISOString();

  state.status = 'cancelled';
  state.completedAt = now;
  state.error = reason ?? 'Execution was cancelled';

  state.eventSeq++;
  return {
    type: 'execution_cancelled',
    seq: state.eventSeq,
    timestamp: now,
    reason,
  };
}
