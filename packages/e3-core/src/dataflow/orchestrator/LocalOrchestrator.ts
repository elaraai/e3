/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local in-process dataflow orchestrator.
 *
 * Executes dataflow using an async loop with step functions.
 * This is the default orchestrator for CLI and local API server usage.
 *
 * Supports reactive execution: after each task completes, checks for
 * root input changes. If inputs changed, affected tasks are invalidated
 * and re-executed. Version vector consistency checks defer tasks whose
 * inputs have conflicting provenance (diamond dependency protection).
 */

import { variant } from '@elaraai/east';
import type { VersionVector } from '@elaraai/e3-types';
import type { StorageBackend, LockHandle } from '../../storage/interfaces.js';
import type { TaskExecuteOptions } from '../../execution/interfaces.js';
import { taskExecute } from '../../execution/LocalTaskRunner.js';
import { WorkspaceLockError, DataflowAbortedError } from '../../errors.js';
import type { TaskExecutionResult } from '../../dataflow.js';
import type {
  DataflowOrchestrator,
  ExecutionHandle,
  ExecutionStatus,
  OrchestratorStartOptions,
} from './interfaces.js';
import { stateToStatus } from './interfaces.js';
import type { ExecutionStateStore } from '../state-store/interfaces.js';
import type {
  DataflowExecutionState,
  ExecutionEvent,
  FinalizeResult,
  TaskState,
} from '../types.js';
import {
  stepInitialize,
  stepGetReady,
  stepPrepareTask,
  stepTaskStarted,
  stepTaskCompleted,
  stepTaskFailed,
  stepTasksSkipped,
  stepIsComplete,
  stepFinalize,
  stepCancel,
  stepApplyTreeUpdate,
  stepDetectInputChanges,
  stepInvalidateTasks,
  stepCheckVersionConsistency,
} from '../steps.js';

// Type helper for mutable state (removes readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };

/**
 * Internal state for a running execution.
 */
interface RunningExecution {
  state: DataflowExecutionState;
  lock: LockHandle;
  /** Shared workspace lock (allows concurrent set operations) */
  sharedLock: LockHandle | null;
  externalLock: boolean;
  options: OrchestratorStartOptions;
  aborted: boolean;
  runningTasks: Map<string, Promise<void>>;
  completionPromise: Promise<FinalizeResult>;
  resolveCompletion: (result: FinalizeResult) => void;
  rejectCompletion: (error: Error) => void;
}

/**
 * Local orchestrator for in-process dataflow execution.
 *
 * @remarks
 * - Uses step functions for each operation
 * - Per-dataset ref writes are atomic and independent (no mutex needed)
 * - Supports AbortSignal for cancellation
 * - Persists state through the provided state store
 * - Reactive: detects input changes after each task, invalidates and
 *   re-executes affected tasks until fixpoint
 */
export class LocalOrchestrator implements DataflowOrchestrator {
  private executions = new Map<string, RunningExecution>();

  /**
   * Create a new LocalOrchestrator.
   *
   * @param stateStore - Optional state store for persistence.
   *   If not provided, state is only kept in memory.
   */
  constructor(private readonly stateStore?: ExecutionStateStore) {}

  async start(
    storage: StorageBackend,
    repo: string,
    workspace: string,
    options: OrchestratorStartOptions = {}
  ): Promise<ExecutionHandle> {
    // Acquire locks if not provided externally.
    // Dual-lock model:
    //   - Shared lock on workspace (allows concurrent e3 set)
    //   - Exclusive lock on workspace#dataflow (prevents concurrent starts)
    const externalLock = !!options.lock;

    let sharedLock: LockHandle | null = null;
    let dataflowLock: LockHandle | null = null;

    if (externalLock) {
      dataflowLock = options.lock!;
    } else {
      // Acquire shared workspace lock first (coexists with e3 set)
      sharedLock = await storage.locks.acquire(repo, workspace, variant('dataflow', null), { mode: 'shared' });
      if (!sharedLock) {
        throw new WorkspaceLockError(workspace);
      }

      // Acquire exclusive dataflow lock (prevents concurrent starts)
      dataflowLock = await storage.locks.acquire(repo, `${workspace}#dataflow`, variant('dataflow', null));
      if (!dataflowLock) {
        await sharedLock.release();
        throw new WorkspaceLockError(workspace);
      }
    }

    try {
      // Get next execution ID from state store if available
      const executionId = this.stateStore
        ? await this.stateStore.nextExecutionId(repo, workspace)
        : String(Date.now()); // Fallback to timestamp if no state store

      // Initialize execution state
      const { state, readyTasks: _ } = await stepInitialize(
        storage,
        repo,
        workspace,
        executionId,
        {
          concurrency: options.concurrency,
          force: options.force,
          filter: options.filter,
        }
      );

      // Persist initial state
      if (this.stateStore) {
        await this.stateStore.create(state);
      }

      // Create completion promise
      let resolveCompletion!: (result: FinalizeResult) => void;
      let rejectCompletion!: (error: Error) => void;
      const completionPromise = new Promise<FinalizeResult>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });

      // Create running execution state
      const execution: RunningExecution = {
        state,
        lock: dataflowLock,
        sharedLock,
        externalLock,
        options,
        aborted: false,
        runningTasks: new Map(),
        completionPromise,
        resolveCompletion,
        rejectCompletion,
      };

      const key = this.executionKey(repo, workspace, executionId);
      this.executions.set(key, execution);

      // Listen for abort signal to persist cancellation immediately.
      if (options.signal) {
        const onAbort = () => {
          execution.aborted = true;
          if (this.stateStore) {
            void this.stateStore.updateStatus(
              repo,
              workspace,
              executionId,
              'cancelled',
              { error: 'Execution was cancelled' }
            ).catch(() => { /* ignore errors during shutdown */ });
          }
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      // Start the execution loop (non-blocking)
      this.runExecutionLoop(storage, repo, execution).catch(err => {
        rejectCompletion(err);
      });

      return { id: executionId, repo, workspace };
    } catch (err) {
      // Release locks on initialization failure (if we acquired them)
      if (!externalLock) {
        await dataflowLock!.release();
        if (sharedLock) await sharedLock.release();
      }
      throw err;
    }
  }

  async wait(handle: ExecutionHandle): Promise<FinalizeResult> {
    const key = this.executionKey(handle.repo, handle.workspace, handle.id);
    const execution = this.executions.get(key);

    if (!execution) {
      throw new Error(`Execution ${handle.id} not found for workspace '${handle.workspace}'`);
    }

    return execution.completionPromise;
  }

  async getStatus(handle: ExecutionHandle): Promise<ExecutionStatus> {
    const key = this.executionKey(handle.repo, handle.workspace, handle.id);
    const execution = this.executions.get(key);

    if (!execution) {
      // Try to read from state store
      if (this.stateStore) {
        const state = await this.stateStore.read(handle.repo, handle.workspace, handle.id);
        if (state) {
          return stateToStatus(state);
        }
      }
      throw new Error(`Execution ${handle.id} not found for workspace '${handle.workspace}'`);
    }

    return stateToStatus(execution.state);
  }

  async cancel(handle: ExecutionHandle): Promise<void> {
    const key = this.executionKey(handle.repo, handle.workspace, handle.id);
    const execution = this.executions.get(key);

    if (!execution) {
      throw new Error(`Execution ${handle.id} not found for workspace '${handle.workspace}'`);
    }

    execution.aborted = true;

    if (this.stateStore) {
      await this.stateStore.updateStatus(
        handle.repo,
        handle.workspace,
        handle.id,
        'cancelled',
        { error: 'Execution was cancelled' }
      );
    }
  }

  async getEvents(handle: ExecutionHandle, sinceSeq: number): Promise<ExecutionEvent[]> {
    if (!this.stateStore) {
      return [];
    }
    return this.stateStore.getEventsSince(handle.repo, handle.workspace, handle.id, sinceSeq);
  }

  /**
   * Main execution loop with reactive fixpoint.
   *
   * After each task completes, checks for input changes and invalidates
   * affected tasks. Uses version vector consistency checks to defer tasks
   * whose inputs have conflicting provenance. Execution continues until
   * fixpoint (no more ready, running, or deferred tasks).
   */
  private async runExecutionLoop(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution
  ): Promise<void> {
    const { state, options } = execution;

    try {
      let hasFailure = false;

      // Check for abort signal from options
      const checkAborted = () => {
        if (options.signal?.aborted && !execution.aborted) {
          execution.aborted = true;
        }
        return execution.aborted;
      };

      while (true) {
        // Check if we're done
        if (execution.runningTasks.size === 0 && stepIsComplete(state)) {
          break;
        }

        // Get ready tasks
        const readyTasks = stepGetReady(state);

        // Launch tasks up to concurrency limit if no failure and not aborted
        const concurrencyLimit = Number(state.concurrency);
        while (
          !hasFailure &&
          !checkAborted() &&
          readyTasks.length > 0 &&
          execution.runningTasks.size < concurrencyLimit
        ) {
          const taskName = readyTasks.shift()!;
          const taskState = state.tasks.get(taskName);

          if (!taskState || taskState.status === 'in_progress' || taskState.status === 'completed') {
            continue;
          }

          // Version vector consistency check before launching
          const vvCheck = stepCheckVersionConsistency(state, taskName);
          if (!vvCheck.consistent) {
            // Defer: inputs have inconsistent versions of the same root input
            const ts = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
            if (ts) ts.status = 'deferred' as TaskState['status'];
            options.onTaskDeferred?.(taskName, vvCheck.conflictPath);
            continue;
          }

          // Prepare task (resolve inputs, check cache)
          const prepared = await stepPrepareTask(storage, state, taskName);

          // Check cache
          if (prepared.cachedOutputHash !== null) {
            // Cache hit — write ref with merged VV and update state
            await stepApplyTreeUpdate(
              storage, repo, state.workspace,
              prepared.outputPath, prepared.cachedOutputHash, vvCheck.mergedVV
            );

            stepTaskCompleted(
              state,
              taskName,
              prepared.cachedOutputHash,
              true,
              0
            );

            // Notify callback
            options.onTaskComplete?.({
              name: taskName,
              cached: true,
              state: 'success',
              duration: 0,
            });

            // Detect input changes after cached result
            await this.handleInputChanges(storage, state, options);

            // Update state store
            if (this.stateStore) {
              await this.stateStore.update(state);
            }
            continue;
          }

          // Mark as started (event added by step function)
          stepTaskStarted(state, taskName);
          if (this.stateStore) {
            await this.stateStore.update(state);
          }
          options.onTaskStart?.(taskName);

          // Launch task execution
          const taskPromise = this.executeTask(
            storage,
            repo,
            execution,
            taskName,
            prepared
          ).then(async (result) => {
            // Handle task completion
            if (result.state === 'success') {
              // Re-check VV consistency (inputs may have changed during execution)
              const postVVCheck = stepCheckVersionConsistency(state, taskName);
              const mergedVV: VersionVector = postVVCheck.consistent
                ? postVVCheck.mergedVV
                : new Map();

              if (result.outputHash) {
                // Write output ref with merged VV
                await stepApplyTreeUpdate(
                  storage, repo, state.workspace,
                  prepared.outputPath, result.outputHash, mergedVV
                );
              }

              stepTaskCompleted(
                state,
                taskName,
                result.outputHash ?? '',
                result.cached,
                result.duration
              );

              options.onTaskComplete?.({
                name: taskName,
                cached: result.cached,
                state: 'success',
                duration: result.duration,
              });

              // Detect input changes after task completion
              await this.handleInputChanges(storage, state, options);
            } else {
              hasFailure = true;

              const { result: failedResult } = stepTaskFailed(
                state,
                taskName,
                result.error,
                result.exitCode,
                result.duration
              );

              options.onTaskComplete?.({
                name: taskName,
                cached: false,
                state: result.state === 'failed' ? 'failed' : 'error',
                error: result.error,
                exitCode: result.exitCode,
                duration: result.duration,
              });

              // Skip dependents (events added by step function)
              const skipEvents = stepTasksSkipped(state, failedResult.toSkip, taskName);
              for (const skipEvent of skipEvents) {
                if (skipEvent.type === 'task_skipped') {
                  options.onTaskComplete?.({
                    name: skipEvent.value.task,
                    cached: false,
                    state: 'skipped',
                    duration: 0,
                  });
                }
              }
            }

            // Update state store
            if (this.stateStore) {
              await this.stateStore.update(state);
            }
          }).finally(() => {
            execution.runningTasks.delete(taskName);
          });

          execution.runningTasks.set(taskName, taskPromise);
        }

        // Wait for at least one task to complete if we can't launch more
        if (execution.runningTasks.size > 0) {
          await Promise.race(execution.runningTasks.values());
        } else if (readyTasks.length === 0 || checkAborted() || hasFailure) {
          break;
        }
      }

      // Wait for any remaining tasks
      if (execution.runningTasks.size > 0) {
        await Promise.all(execution.runningTasks.values());
      }

      // Check for abort one final time
      if (checkAborted()) {
        stepCancel(state, 'Execution was aborted');
        if (this.stateStore) {
          await this.stateStore.update(state);
        }

        // Build partial results for abort error
        const partialResults = this.buildPartialResults(state);
        throw new DataflowAbortedError(partialResults);
      }

      // Finalize (event added by step function)
      const { result } = stepFinalize(state);
      if (this.stateStore) {
        await this.stateStore.update(state);
      }

      execution.resolveCompletion(result);
    } finally {
      // Release locks if we acquired them
      if (!execution.externalLock) {
        await execution.lock.release();
        if (execution.sharedLock) {
          await execution.sharedLock.release();
        }
      }

      // Clean up execution state
      const key = this.executionKey(repo, state.workspace, state.id);
      this.executions.delete(key);
    }
  }

  /**
   * Detect input changes and invalidate affected tasks.
   *
   * Called after each task completion to implement the reactive loop.
   */
  private async handleInputChanges(
    storage: StorageBackend,
    state: DataflowExecutionState,
    options: OrchestratorStartOptions
  ): Promise<void> {
    const { changes, events: changeEvents } = await stepDetectInputChanges(storage, state);

    // Notify via callbacks
    for (const evt of changeEvents) {
      if (evt.type === 'input_changed') {
        options.onInputChanged?.(evt.value.path, evt.value.previousHash, evt.value.newHash);
      }
    }

    if (changes.length > 0) {
      const mutableState = state as Mutable<DataflowExecutionState>;
      const { invalidated, events: invEvents } = stepInvalidateTasks(state, changes);

      // Track re-executions (tasks that were completed and are now invalidated)
      mutableState.reexecuted = state.reexecuted + BigInt(invalidated.length);

      for (const evt of invEvents) {
        if (evt.type === 'task_invalidated') {
          options.onTaskInvalidated?.(evt.value.task, evt.value.reason);
        }
      }
    }
  }

  /**
   * Execute a single task.
   */
  private async executeTask(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: { taskHash: string; inputHashes: string[] }
  ): Promise<{
    state: 'success' | 'failed' | 'error';
    cached: boolean;
    outputHash?: string;
    exitCode?: number;
    error?: string;
    duration: number;
  }> {
    const { options } = execution;
    const startTime = Date.now();

    const execOptions: TaskExecuteOptions = {
      force: execution.state.force,
      signal: options.signal,
      onStdout: options.onStdout ? (data) => options.onStdout!(taskName, data) : undefined,
      onStderr: options.onStderr ? (data) => options.onStderr!(taskName, data) : undefined,
    };

    // Use provided runner if available, otherwise call taskExecute directly
    if (options.runner) {
      const result = await options.runner.execute(storage, prepared.taskHash, prepared.inputHashes, execOptions);
      return {
        state: result.state,
        cached: result.cached,
        outputHash: result.outputHash,
        exitCode: result.exitCode,
        error: result.error,
        duration: Date.now() - startTime,
      };
    } else {
      const result = await taskExecute(storage, repo, prepared.taskHash, prepared.inputHashes, execOptions);
      return {
        state: result.state,
        cached: result.cached,
        outputHash: result.outputHash ?? undefined,
        exitCode: result.exitCode ?? undefined,
        error: result.error ?? undefined,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Build partial results for abort error.
   */
  private buildPartialResults(state: DataflowExecutionState): TaskExecutionResult[] {
    const results: TaskExecutionResult[] = [];

    for (const [name, taskState] of state.tasks) {
      if (taskState.status === 'completed' || taskState.status === 'failed' || taskState.status === 'skipped') {
        // Extract values from Option types
        const cached = taskState.cached.type === 'some' ? taskState.cached.value : false;
        const error = taskState.error.type === 'some' ? taskState.error.value : undefined;
        const exitCode = taskState.exitCode.type === 'some' ? Number(taskState.exitCode.value) : undefined;
        const duration = taskState.duration.type === 'some' ? Number(taskState.duration.value) : 0;

        results.push({
          name,
          cached,
          state: taskState.status === 'completed' ? 'success' : taskState.status,
          error,
          exitCode,
          duration,
        });
      }
    }

    return results;
  }

  /**
   * Generate unique key for an execution.
   */
  private executionKey(repo: string, workspace: string, id: string): string {
    return `${repo}::${workspace}:${id}`;
  }
}
