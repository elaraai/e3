/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local in-process dataflow orchestrator.
 *
 * Executes dataflow using an async loop with step functions.
 * This is the default orchestrator for CLI and local API server usage.
 */

import { variant } from '@elaraai/east';
import type { StorageBackend, LockHandle } from '../../storage/interfaces.js';
import type { TaskExecuteOptions } from '../../execution/interfaces.js';
import { taskExecute } from '../../execution/LocalTaskRunner.js';
import { workspaceSetDatasetByHash } from '../../trees.js';
import { parsePathString } from '../../dataflow.js';
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
} from '../steps.js';

/**
 * Simple async mutex to serialize workspace state updates.
 *
 * When multiple tasks complete concurrently, their workspace writes must be
 * serialized to prevent race conditions (read-modify-write on the workspace
 * root hash). This mutex ensures only one update runs at a time.
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /**
   * Acquire the mutex, execute the callback, then release.
   * If the mutex is already held, waits until it's available.
   */
  async runExclusive<T>(fn: () => T): Promise<Awaited<T>> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Internal state for a running execution.
 */
interface RunningExecution {
  state: DataflowExecutionState;
  lock: LockHandle;
  externalLock: boolean;
  options: OrchestratorStartOptions;
  mutex: AsyncMutex;
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
 * - Serializes workspace writes with AsyncMutex
 * - Supports AbortSignal for cancellation
 * - Persists state through the provided state store
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
    // Acquire lock if not provided externally
    const externalLock = !!options.lock;
    const lock = options.lock ?? await storage.locks.acquire(repo, workspace, variant('dataflow', null));

    if (!lock) {
      throw new WorkspaceLockError(workspace);
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
        lock,
        externalLock,
        options,
        mutex: new AsyncMutex(),
        aborted: false,
        runningTasks: new Map(),
        completionPromise,
        resolveCompletion,
        rejectCompletion,
      };

      const key = this.executionKey(repo, workspace, executionId);
      this.executions.set(key, execution);

      // Listen for abort signal to persist cancellation immediately.
      // This ensures the "cancelled" status survives even if the process
      // is killed (e.g., repeated Ctrl-C) before the loop can persist.
      if (options.signal) {
        const onAbort = () => {
          execution.aborted = true;
          if (this.stateStore) {
            // Fire-and-forget: best-effort immediate persistence
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
      // Release lock on initialization failure (if we acquired it)
      if (!externalLock) {
        await lock.release();
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

    // Persist cancellation immediately so it survives process crashes.
    // The execution loop will also detect the abort and clean up gracefully.
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
   * Main execution loop.
   *
   * Uses step functions to execute tasks, managing concurrency and
   * workspace state updates.
   */
  private async runExecutionLoop(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution
  ): Promise<void> {
    const { state, options, mutex } = execution;

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

          // Prepare task (resolve inputs, check cache)
          const prepared = await stepPrepareTask(storage, state, taskName);

          // Check cache
          if (prepared.cachedOutputHash !== null) {
            // Cache hit - handle synchronously within mutex
            await mutex.runExclusive(async () => {
              stepTaskCompleted(
                state,
                taskName,
                prepared.cachedOutputHash!,
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

              // Update state store (events are added by step function)
              if (this.stateStore) {
                await this.stateStore.update(state);
              }
            });
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
            // Handle task completion within mutex
            await mutex.runExclusive(async () => {
              if (result.state === 'success') {
                const outputPath = parsePathString(prepared.outputPath);
                if (result.outputHash) {
                  await workspaceSetDatasetByHash(
                    storage,
                    repo,
                    state.workspace,
                    outputPath,
                    result.outputHash
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
                  // skipEvents are always task_skipped events
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
            });
          }).finally(() => {
            execution.runningTasks.delete(taskName);
          });

          execution.runningTasks.set(taskName, taskPromise);
        }

        // Wait for at least one task to complete if we can't launch more
        if (execution.runningTasks.size > 0) {
          await Promise.race(execution.runningTasks.values());
        } else if (readyTasks.length === 0 || checkAborted()) {
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
      // Release lock if we acquired it
      if (!execution.externalLock) {
        await execution.lock.release();
      }

      // Clean up execution state
      const key = this.executionKey(repo, state.workspace, state.id);
      this.executions.delete(key);
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
