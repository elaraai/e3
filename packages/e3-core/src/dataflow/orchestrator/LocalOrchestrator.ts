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

import { decodeBeast2For, encodeBeast2For, variant } from '@elaraai/east';
import type { VersionVector, DataflowRun, TaskExecutionRecord, Structure } from '@elaraai/e3-types';
import { WorkspaceStateType } from '@elaraai/e3-types';
import type { StorageBackend, LockHandle } from '../../storage/interfaces.js';
import type { TaskExecuteOptions } from '../../execution/interfaces.js';
import { taskExecute } from '../../execution/LocalTaskRunner.js';
import { WorkspaceLockError, DataflowAbortedError, DataflowError } from '../../errors.js';
import type { TaskExecutionResult } from '../../dataflow.js';
import { uuidv7 } from '../../uuid.js';
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
import type { Mutable } from '../types.js';

// =============================================================================
// Async Mutex for State Mutations
// =============================================================================

/**
 * Simple async mutex to serialize state mutations.
 *
 * When multiple tasks complete concurrently, their `.then()` callbacks
 * mutate shared DataflowExecutionState. Between `await` points
 * (stepApplyTreeUpdate, handleInputChanges), another callback can run
 * and corrupt counters/version vectors. This mutex ensures only one
 * state mutation runs at a time while task execution itself runs in parallel.
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
  /** Shared workspace lock (allows concurrent set operations) */
  sharedLock: LockHandle | null;
  externalLock: boolean;
  options: OrchestratorStartOptions;
  aborted: boolean;
  runningTasks: Map<string, Promise<void>>;
  /** Mutex to serialize state mutations from concurrent task completions */
  mutex: AsyncMutex;
  /** Dataflow run ID (UUIDv7) for DataflowRun recording */
  runId: string;
  /** Task execution records for DataflowRun */
  taskExecutions: Map<string, TaskExecutionRecord>;
  /** Cleanup function to remove abort listener on normal completion */
  abortCleanup?: () => void;
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
      // Caller's lock serves as shared workspace lock
      sharedLock = options.lock!;
      // Still acquire exclusive dataflow lock (prevents concurrent starts)
      dataflowLock = await storage.locks.acquire(repo, `${workspace}#dataflow`, variant('dataflow', null));
      if (!dataflowLock) {
        throw new WorkspaceLockError(workspace);
      }
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
        mutex: new AsyncMutex(),
        runId: uuidv7(),
        taskExecutions: new Map(),
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
        execution.abortCleanup = () => options.signal!.removeEventListener('abort', onAbort);
      }

      // Start the execution loop (non-blocking)
      this.runExecutionLoop(storage, repo, execution).catch(err => {
        rejectCompletion(err);
      });

      return { id: executionId, repo, workspace };
    } catch (err) {
      // Always release the dataflow lock on initialization failure
      await dataflowLock!.release();
      // Release shared workspace lock only if we acquired it (not external)
      if (!externalLock && sharedLock) {
        await sharedLock.release();
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

      // Read workspace state for DataflowRun recording
      const wsData = await storage.refs.workspaceRead(repo, state.workspace);
      const wsDecoder = decodeBeast2For(WorkspaceStateType);
      const wsState = wsData && wsData.length > 0 ? wsDecoder(wsData) : null;

      // Cache structure for the entire execution (immutable during execution)
      const structure = wsState ? await this.readStructure(storage, repo, wsState.packageHash) : null;

      // Write initial DataflowRun record
      if (wsState) {
        const initialRun: DataflowRun = {
          runId: execution.runId,
          workspaceName: state.workspace,
          packageRef: `${wsState.packageName}@${wsState.packageVersion}`,
          startedAt: state.startedAt,
          completedAt: variant('none', null),
          status: variant('running', {}),
          inputVersions: new Map(state.inputSnapshot),
          outputVersions: variant('none', null),
          taskExecutions: new Map(),
          summary: {
            total: BigInt(state.tasks.size),
            completed: 0n,
            cached: 0n,
            failed: 0n,
            skipped: 0n,
            reexecuted: 0n,
          },
        };
        await storage.refs.dataflowRunWrite(repo, state.workspace, initialRun);
      }

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

        // Track whether any task was completed synchronously (via cache hit)
        // in this iteration. If so, new downstream tasks may have become ready
        // that aren't in the stale readyTasks array.
        let hadSyncCompletion = false;

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
            if (ts) ts.status = 'deferred';

            // Emit task_deferred event
            const mutableState = state as Mutable<DataflowExecutionState>;
            mutableState.eventSeq = state.eventSeq + 1n;
            const deferEvent: ExecutionEvent = variant('task_deferred', {
              seq: mutableState.eventSeq,
              timestamp: new Date(),
              task: taskName,
              conflictPath: vvCheck.conflictPath,
            });
            (mutableState.events as ExecutionEvent[]).push(deferEvent);

            options.onTaskDeferred?.(taskName, vvCheck.conflictPath);
            continue;
          }

          // Prepare task (resolve inputs, check cache)
          const prepared = await stepPrepareTask(storage, state, taskName);

          // Check cache
          if (prepared.cachedOutputHash !== null) {
            hadSyncCompletion = true;
            // Cache hit — wrap in mutex to serialize with concurrent .then() callbacks
            await execution.mutex.runExclusive(async () => {
              // Write ref with merged VV and update state
              await stepApplyTreeUpdate(
                storage, repo, state.workspace,
                prepared.outputPath, prepared.cachedOutputHash!, vvCheck.mergedVV
              );

              stepTaskCompleted(
                state,
                taskName,
                prepared.cachedOutputHash!,
                true,
                0
              );

              // Track task execution for DataflowRun
              const existingCached = execution.taskExecutions.get(taskName);
              execution.taskExecutions.set(taskName, {
                executionId: state.id,
                cached: true,
                outputVersions: new Map(vvCheck.mergedVV),
                executionCount: (existingCached?.executionCount ?? 0n) + 1n,
              });

              // Notify callback
              options.onTaskComplete?.({
                name: taskName,
                cached: true,
                state: 'success',
                duration: 0,
              });

              // Detect input changes after cached result
              await this.handleInputChanges(storage, state, options, structure);

              // Update state store
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
          ).then(result =>
            execution.mutex.runExclusive(async () => {
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

                // Track task execution for DataflowRun
                const existing = execution.taskExecutions.get(taskName);
                execution.taskExecutions.set(taskName, {
                  executionId: result.executionId ?? state.id,
                  cached: result.cached,
                  outputVersions: new Map(mergedVV),
                  executionCount: (existing?.executionCount ?? 0n) + 1n,
                });

                options.onTaskComplete?.({
                  name: taskName,
                  cached: result.cached,
                  state: 'success',
                  duration: result.duration,
                });

                // Detect input changes after task completion
                await this.handleInputChanges(storage, state, options, structure);
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
            })
          ).finally(() => {
            execution.runningTasks.delete(taskName);
          });

          execution.runningTasks.set(taskName, taskPromise);
        }

        // Wait for at least one task to complete if we can't launch more
        if (execution.runningTasks.size > 0) {
          await Promise.race(execution.runningTasks.values());
        } else if (hadSyncCompletion) {
          // A cached task completed synchronously, which may have made new
          // downstream tasks ready. Continue to re-check at the top of the loop.
          continue;
        } else if (readyTasks.length === 0 || checkAborted() || hasFailure) {
          break;
        }
      }

      // Wait for any remaining tasks
      if (execution.runningTasks.size > 0) {
        await Promise.all(execution.runningTasks.values());
      }

      // Check for stuck state: non-terminal tasks remain but none are ready or running.
      // When a filter is active, only the filtered task is relevant — non-filtered
      // tasks are expected to remain pending.
      const filterValue = state.filter.type === 'some' ? state.filter.value : null;
      const stuckTasks = [...state.tasks.entries()]
        .filter(([name, ts]) => {
          if (ts.status !== 'pending' && ts.status !== 'ready' && ts.status !== 'deferred') {
            return false;
          }
          // When a filter is active, non-filtered tasks staying pending is expected
          if (filterValue !== null && name !== filterValue) {
            return false;
          }
          return true;
        })
        .map(([name, ts]) => `${name} (${ts.status})`)
        .join(', ');
      if (stuckTasks.length > 0 && !checkAborted() && !hasFailure) {
        throw new DataflowError(`Dataflow stuck: ${stuckTasks}`);
      }

      // Check for abort one final time
      if (checkAborted()) {
        stepCancel(state, 'Execution was aborted');
        if (this.stateStore) {
          await this.stateStore.update(state);
        }

        // Write cancelled DataflowRun record
        if (wsState) {
          const cancelledRun: DataflowRun = {
            runId: execution.runId,
            workspaceName: state.workspace,
            packageRef: `${wsState.packageName}@${wsState.packageVersion}`,
            startedAt: state.startedAt,
            completedAt: variant('some', new Date()),
            status: variant('cancelled', {}),
            inputVersions: new Map(state.inputSnapshot),
            outputVersions: variant('some', this.buildOutputVersions(state)),
            taskExecutions: new Map(execution.taskExecutions),
            summary: {
              total: BigInt(state.tasks.size),
              completed: state.executed + state.cached,
              cached: state.cached,
              failed: state.failed,
              skipped: state.skipped,
              reexecuted: state.reexecuted,
            },
          };
          await storage.refs.dataflowRunWrite(repo, state.workspace, cancelledRun);
        }

        // Build partial results for abort error
        const partialResults = this.buildPartialResults(state);
        throw new DataflowAbortedError(partialResults);
      }

      // Finalize (event added by step function)
      const { result } = stepFinalize(state, execution.runId);
      if (this.stateStore) {
        await this.stateStore.update(state);
      }

      // Write final DataflowRun record
      if (wsState) {
        let finalStatus: DataflowRun['status'];
        if (!result.success) {
          // Find the failed task for the error record
          const failedTaskEntry = [...state.tasks.entries()]
            .find(([, ts]) => ts.status === 'failed');
          const failedTaskName = failedTaskEntry?.[0] ?? 'unknown';
          const failedError = failedTaskEntry?.[1].error.type === 'some'
            ? failedTaskEntry[1].error.value
            : 'Task failed';
          finalStatus = variant('failed', {
            failedTask: failedTaskName,
            error: failedError,
          });
        } else {
          finalStatus = variant('completed', {});
        }

        const finalRun: DataflowRun = {
          runId: execution.runId,
          workspaceName: state.workspace,
          packageRef: `${wsState.packageName}@${wsState.packageVersion}`,
          startedAt: state.startedAt,
          completedAt: variant('some', new Date()),
          status: finalStatus,
          inputVersions: new Map(state.inputSnapshot),
          outputVersions: variant('some', this.buildOutputVersions(state)),
          taskExecutions: new Map(execution.taskExecutions),
          summary: {
            total: BigInt(state.tasks.size),
            completed: state.executed + state.cached,
            cached: state.cached,
            failed: state.failed,
            skipped: state.skipped,
            reexecuted: state.reexecuted,
          },
        };
        await storage.refs.dataflowRunWrite(repo, state.workspace, finalRun);

        // Update workspace state with currentRunId on success
        if (result.success) {
          const currentWsData = await storage.refs.workspaceRead(repo, state.workspace);
          if (currentWsData && currentWsData.length > 0) {
            const currentWsState = wsDecoder(currentWsData);
            const updatedWsState = {
              ...currentWsState,
              currentRunId: variant('some', execution.runId),
            };
            const encoder = encodeBeast2For(WorkspaceStateType);
            await storage.refs.workspaceWrite(repo, state.workspace, encoder(updatedWsState));
          }
        }
      }

      execution.resolveCompletion(result);
    } finally {
      // Remove abort listener to avoid leaking execution object
      execution.abortCleanup?.();

      // Always release the dataflow lock (we always acquire it)
      await execution.lock.release();
      // Release shared workspace lock only if we acquired it (not external)
      if (!execution.externalLock && execution.sharedLock) {
        await execution.sharedLock.release();
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
    options: OrchestratorStartOptions,
    structure: Structure | null
  ): Promise<void> {
    const { changes, events: changeEvents } = await stepDetectInputChanges(storage, state, structure);

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
    executionId?: string;
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
        executionId: result.executionId,
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
        executionId: result.executionId,
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
   * Build output versions map from completed task states.
   */
  private buildOutputVersions(state: DataflowExecutionState): Map<string, string> {
    const outputVersions = new Map<string, string>();
    const graph = state.graph.type === 'some' ? state.graph.value : null;
    if (graph) {
      for (const task of graph.tasks) {
        const ts = state.tasks.get(task.name);
        if (ts && ts.outputHash.type === 'some') {
          outputVersions.set(task.output, ts.outputHash.value);
        }
      }
    }
    return outputVersions;
  }

  /**
   * Read workspace structure from storage.
   */
  private async readStructure(
    storage: StorageBackend,
    repo: string,
    packageHash: string
  ): Promise<Structure> {
    const { PackageObjectType } = await import('@elaraai/e3-types');
    const pkgData = await storage.objects.read(repo, packageHash);
    const pkgDecoder = decodeBeast2For(PackageObjectType);
    const pkgObject = pkgDecoder(Buffer.from(pkgData));
    return pkgObject.data.structure;
  }

  /**
   * Generate unique key for an execution.
   */
  private executionKey(repo: string, workspace: string, id: string): string {
    return `${repo}::${workspace}:${id}`;
  }
}
