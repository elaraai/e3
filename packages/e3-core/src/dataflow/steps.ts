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

import { variant, some, none } from '@elaraai/east';
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
  workspaceSetDatasetByHash,
} from '../trees.js';
import type { DataflowGraph } from '../dataflow.js';
import type {
  DataflowExecutionState,
  TaskState,
  InitializeResult,
  PrepareTaskResult,
  TaskCompletedResult,
  TaskFailedResult,
  FinalizeResult,
  TreeUpdateResult,
  ExecutionEvent,
} from './types.js';

// Type helper for mutable state (removes readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };

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
  executionId: string,
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
      cached: none,
      outputHash: none,
      error: none,
      exitCode: none,
      startedAt: none,
      completedAt: none,
      duration: none,
    } as TaskState);
  }

  // Create initial state
  const state = {
    id: executionId,
    repo,
    workspace,
    startedAt: new Date(),
    concurrency: BigInt(concurrency),
    force,
    filter: filter !== null ? some(filter) : none,
    graph: some(graph),
    graphHash: none,
    tasks,
    executed: 0n,
    cached: 0n,
    failed: 0n,
    skipped: 0n,
    status: 'running' as const,
    completedAt: none,
    error: none,
    events: [] as ExecutionEvent[],
    eventSeq: 0n,
  } as DataflowExecutionState;

  // Find initially ready tasks
  const readyTasks = stepGetReady(state);

  // Update task states to 'ready' (cast to mutable)
  for (const taskName of readyTasks) {
    const taskState = tasks.get(taskName) as Mutable<TaskState>;
    if (taskState) {
      taskState.status = 'ready';
    }
  }

  return { state, readyTasks };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the graph from state, throwing if not available.
 *
 * For cloud execution, the graph may be stored separately and loaded
 * via graphHash. This helper ensures the graph is present before use.
 */
function getGraph(state: DataflowExecutionState): DataflowGraph {
  if (state.graph.type !== 'some') {
    throw new Error(
      'Execution state has no graph. For cloud execution, load the graph using graphHash before calling step functions.'
    );
  }
  return state.graph.value;
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
  const graphReady = dataflowGetReadyTasks(getGraph(state), completedTasks);

  // Get filter value (handle Option type)
  const filterValue = state.filter.type === 'some' ? state.filter.value : null;

  // Filter by state and filter option
  return graphReady.filter(taskName => {
    const taskState = state.tasks.get(taskName);
    if (!taskState) return false;

    // Skip tasks that are already being processed
    if (taskState.status !== 'pending' && taskState.status !== 'ready') {
      return false;
    }

    // Apply task filter
    if (filterValue !== null && taskName !== filterValue) {
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
  const filterValue = state.filter.type === 'some' ? state.filter.value : null;

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
      const task = getGraph(state).tasks.find(t => t.name === taskState.name);
      if (task) {
        const hasUnmetDeps = task.dependsOn.some(dep => {
          const depState = state.tasks.get(dep);
          return depState && (depState.status === 'failed' || depState.status === 'skipped');
        });
        // If it's stuck due to failed deps, it should have been skipped
        // If not stuck, we're not complete
        if (!hasUnmetDeps) {
          // Check if it passes the filter
          if (filterValue !== null && taskState.name !== filterValue) {
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
  const graph = getGraph(state);
  const task = graph.tasks.find(t => t.name === taskName);
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
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  const now = new Date();
  taskState.status = 'in_progress';
  taskState.startedAt = some(now);

  const mutableState = state as Mutable<DataflowExecutionState>;
  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_started', {
    seq: mutableState.eventSeq,
    timestamp: now,
    task: taskName,
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
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
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  const now = new Date();
  const mutableState = state as Mutable<DataflowExecutionState>;

  taskState.status = 'completed';
  taskState.cached = some(cached);
  taskState.outputHash = some(outputHash);
  taskState.completedAt = some(now);
  taskState.duration = some(BigInt(duration));

  // Update counters
  if (cached) {
    mutableState.cached = state.cached + 1n;
  } else {
    mutableState.executed = state.executed + 1n;
  }

  // Find newly ready tasks
  const newlyReady = stepGetReady(state);
  for (const name of newlyReady) {
    const ts = state.tasks.get(name) as Mutable<TaskState> | undefined;
    if (ts && ts.status === 'pending') {
      ts.status = 'ready';
    }
  }

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_completed', {
    seq: mutableState.eventSeq,
    timestamp: now,
    task: taskName,
    cached,
    outputHash,
    duration: BigInt(duration),
  });
  (mutableState.events as ExecutionEvent[]).push(event);

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
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  const now = new Date();
  const mutableState = state as Mutable<DataflowExecutionState>;

  taskState.status = 'failed';
  taskState.error = error !== undefined ? some(error) : none;
  taskState.exitCode = exitCode !== undefined ? some(BigInt(exitCode)) : none;
  taskState.completedAt = some(now);
  taskState.duration = some(BigInt(duration));

  // Update counters
  mutableState.failed = state.failed + 1n;

  // Get filter value (handle Option type)
  const filterValue = state.filter.type === 'some' ? state.filter.value : null;

  // Find tasks to skip (transitive dependents)
  const completedSet = new Set<string>();
  const skippedSet = new Set<string>();
  for (const [name, ts] of state.tasks) {
    if (ts.status === 'completed') completedSet.add(name);
    if (ts.status === 'skipped') skippedSet.add(name);
  }

  const toSkip = dataflowGetDependentsToSkip(
    getGraph(state),
    taskName,
    completedSet,
    skippedSet
  ).filter(name => {
    // Also exclude in-progress tasks and apply filter
    const ts = state.tasks.get(name);
    if (!ts || ts.status === 'in_progress') return false;
    if (filterValue !== null && name !== filterValue) return false;
    return true;
  });

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_failed', {
    seq: mutableState.eventSeq,
    timestamp: now,
    task: taskName,
    error: error !== undefined ? some(error) : none,
    exitCode: exitCode !== undefined ? some(BigInt(exitCode)) : none,
    duration: BigInt(duration),
  });
  (mutableState.events as ExecutionEvent[]).push(event);

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
  const now = new Date();
  const mutableState = state as Mutable<DataflowExecutionState>;

  for (const taskName of taskNames) {
    const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
    if (!taskState) continue;

    taskState.status = 'skipped';
    taskState.completedAt = some(now);
    taskState.duration = some(0n);

    mutableState.skipped = mutableState.skipped + 1n;

    mutableState.eventSeq = mutableState.eventSeq + 1n;
    const event: ExecutionEvent = variant('task_skipped', {
      seq: mutableState.eventSeq,
      timestamp: now,
      task: taskName,
      cause,
    });
    (mutableState.events as ExecutionEvent[]).push(event);
    events.push(event);
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
  const now = new Date();
  const startTime = state.startedAt.getTime();
  const duration = Date.now() - startTime;
  const mutableState = state as Mutable<DataflowExecutionState>;

  // Determine success
  const success = state.failed === 0n;

  // Update state
  mutableState.status = success ? 'completed' : 'failed';
  mutableState.completedAt = some(now);

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('execution_completed', {
    seq: mutableState.eventSeq,
    timestamp: now,
    success,
    executed: state.executed,
    cached: state.cached,
    failed: state.failed,
    skipped: state.skipped,
    duration: BigInt(duration),
  });
  (mutableState.events as ExecutionEvent[]).push(event);

  const result: FinalizeResult = {
    success,
    executed: Number(state.executed),
    cached: Number(state.cached),
    failed: Number(state.failed),
    skipped: Number(state.skipped),
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
  const now = new Date();
  const mutableState = state as Mutable<DataflowExecutionState>;

  mutableState.status = 'cancelled';
  mutableState.completedAt = some(now);
  mutableState.error = some(reason ?? 'Execution was cancelled');

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('execution_cancelled', {
    seq: mutableState.eventSeq,
    timestamp: now,
    reason: reason !== undefined ? some(reason) : none,
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
}

// =============================================================================
// Tree Update Step Function
// =============================================================================

/**
 * Apply a task's output to the workspace tree.
 *
 * This step function handles workspace tree updates, which must be serialized
 * to prevent lost-update race conditions when multiple tasks complete
 * concurrently.
 *
 * For local execution, the LocalOrchestrator handles this internally with
 * an AsyncMutex. For cloud execution (e.g., AWS Step Functions), this should
 * be called in a dedicated "ApplyTreeUpdates" state that processes updates
 * serially.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - Workspace name
 * @param outputPathStr - Output path as a keypath string (e.g., ".results.data")
 * @param outputHash - Hash of the output dataset to write
 * @returns Result with the new workspace root hash
 *
 * @remarks
 * Tree updates must be serialized to prevent race conditions:
 * - Two tasks complete concurrently, both read the same workspace root
 * - Both compute new roots with their outputs
 * - One write overwrites the other, losing the first task's output
 *
 * Cloud implementations should use a dedicated serialization mechanism
 * (e.g., a single Lambda invocation per update, or DynamoDB transactions).
 */
export async function stepApplyTreeUpdate(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  outputPathStr: string,
  outputHash: string
): Promise<TreeUpdateResult> {
  const { parsePathString } = await import('../dataflow.js');
  const outputPath = parsePathString(outputPathStr);

  // Write the output to the workspace tree
  const newRootHash = await workspaceSetDatasetByHash(
    storage,
    repo,
    workspace,
    outputPath,
    outputHash
  );

  return { newRootHash };
}
