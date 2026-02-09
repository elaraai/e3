/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, some, none, variant } from '@elaraai/east';
import {
  dataflowGetGraph,
  workspaceStatus,
  executionFindCurrent,
  executionReadLog,
  WorkspaceLockError,
  ExecutionNotFoundError,
  coreEventToApiEvent,
  coreStatusToApiStatus,
  type WorkspaceStatusResult as CoreWorkspaceStatusResult,
  type DatasetStatusInfo as CoreDatasetStatusInfo,
  type TaskStatusInfo as CoreTaskStatusInfo,
  type DataflowExecutionStatus,
} from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { sendSuccess, sendError, sendSuccessWithStatus } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  WorkspaceStatusResultType,
  DataflowGraphType,
  LogChunkType,
  DataflowExecutionStateType,
  type WorkspaceStatusResult,
  type DatasetStatusInfo,
  type TaskStatusInfo,
  type DataflowExecutionState,
} from '../types.js';
import {
  getOrchestrator,
  getStateStore,
  setActiveExecution,
  getActiveExecution,
  getLatestExecution,
  getExecutionStartTime,
  clearActiveExecution,
} from '../orchestrator-manager.js';

/**
 * Convert core DatasetStatusInfo to API type.
 */
function convertDatasetStatus(info: CoreDatasetStatusInfo): DatasetStatusInfo {
  let status: DatasetStatusInfo['status'];
  switch (info.status.type) {
    case 'unset':
      status = variant('unset', null);
      break;
    case 'stale':
      status = variant('stale', null);
      break;
    case 'up-to-date':
      status = variant('up-to-date', null);
      break;
  }

  return {
    path: info.path,
    status,
    hash: info.hash ? some(info.hash) : none,
    isTaskOutput: info.isTaskOutput,
    producedBy: info.producedBy ? some(info.producedBy) : none,
  };
}

/**
 * Convert core TaskStatusInfo to API type.
 */
function convertTaskStatus(info: CoreTaskStatusInfo): TaskStatusInfo {
  let status: TaskStatusInfo['status'];
  switch (info.status.type) {
    case 'up-to-date':
      status = variant('up-to-date', { cached: info.status.cached });
      break;
    case 'ready':
      status = variant('ready', null);
      break;
    case 'waiting':
      status = variant('waiting', { reason: info.status.reason });
      break;
    case 'in-progress':
      status = variant('in-progress', {
        pid: info.status.pid != null ? some(BigInt(info.status.pid)) : none,
        startedAt: info.status.startedAt ? some(info.status.startedAt) : none,
      });
      break;
    case 'failed':
      status = variant('failed', {
        exitCode: BigInt(info.status.exitCode),
        completedAt: info.status.completedAt ? some(info.status.completedAt) : none,
      });
      break;
    case 'error':
      status = variant('error', {
        message: info.status.message,
        completedAt: info.status.completedAt ? some(info.status.completedAt) : none,
      });
      break;
    case 'stale-running':
      status = variant('stale-running', {
        pid: info.status.pid != null ? some(BigInt(info.status.pid)) : none,
        startedAt: info.status.startedAt ? some(info.status.startedAt) : none,
      });
      break;
  }

  return {
    name: info.name,
    hash: info.hash,
    status,
    inputs: info.inputs,
    output: info.output,
    dependsOn: info.dependsOn,
  };
}

/**
 * Convert core WorkspaceStatusResult to API type.
 */
function convertWorkspaceStatus(result: CoreWorkspaceStatusResult): WorkspaceStatusResult {
  return {
    workspace: result.workspace,
    lock: result.lock && result.lock.pid !== undefined
      ? some({
          pid: BigInt(result.lock.pid),
          acquiredAt: result.lock.acquiredAt,
          bootId: result.lock.bootId ? some(result.lock.bootId) : none,
          command: result.lock.command ? some(result.lock.command) : none,
        })
      : none,
    datasets: result.datasets.map(convertDatasetStatus),
    tasks: result.tasks.map(convertTaskStatus),
    summary: {
      datasets: {
        total: BigInt(result.summary.datasets.total),
        unset: BigInt(result.summary.datasets.unset),
        stale: BigInt(result.summary.datasets.stale),
        upToDate: BigInt(result.summary.datasets.upToDate),
      },
      tasks: {
        total: BigInt(result.summary.tasks.total),
        upToDate: BigInt(result.summary.tasks.upToDate),
        ready: BigInt(result.summary.tasks.ready),
        waiting: BigInt(result.summary.tasks.waiting),
        inProgress: BigInt(result.summary.tasks.inProgress),
        failed: BigInt(result.summary.tasks.failed),
        error: BigInt(result.summary.tasks.error),
        staleRunning: BigInt(result.summary.tasks.staleRunning),
      },
    },
  };
}

/**
 * Start dataflow execution (non-blocking).
 *
 * Returns 202 Accepted immediately and runs execution in background.
 * Creates execution state that can be polled via getDataflowExecution().
 */
export async function startDataflow(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  options: { concurrency: number; force: boolean; filter?: string }
): Promise<Response> {
  try {
    const orchestrator = getOrchestrator(repoPath);

    // Start execution via orchestrator (acquires lock internally)
    const handle = await orchestrator.start(storage, repoPath, workspace, {
      concurrency: options.concurrency,
      force: options.force,
      filter: options.filter,
    });

    // Track as active execution for this workspace
    setActiveExecution(repoPath, workspace, handle);

    // Set up completion handler to clear active execution
    orchestrator.wait(handle).then(() => {
      clearActiveExecution(repoPath, workspace);
    }).catch(() => {
      clearActiveExecution(repoPath, workspace);
    });

    // Return immediately with 202 Accepted
    return sendSuccessWithStatus(NullType, null, 202);
  } catch (err) {
    if (err instanceof WorkspaceLockError) {
      return sendError(NullType, errorToVariant(err));
    }
    return sendError(NullType, errorToVariant(err));
  }
}

/**
 * Get workspace status (for polling).
 */
export async function getDataflowStatus(
  storage: StorageBackend,
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const result = await workspaceStatus(storage, repoPath, workspace);
    return sendSuccess(WorkspaceStatusResultType, convertWorkspaceStatus(result));
  } catch (err) {
    return sendError(WorkspaceStatusResultType, errorToVariant(err));
  }
}

/**
 * Get dependency graph.
 */
export async function getDataflowGraph(
  storage: StorageBackend,
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const graph = await dataflowGetGraph(storage, repoPath, workspace);
    return sendSuccess(DataflowGraphType, {
      tasks: graph.tasks.map((t) => ({
        name: t.name,
        hash: t.hash,
        inputs: t.inputs,
        output: t.output,
        dependsOn: t.dependsOn,
      })),
    });
  } catch (err) {
    return sendError(DataflowGraphType, errorToVariant(err));
  }
}

/**
 * Get task logs.
 */
export async function getTaskLogs(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  taskName: string,
  stream: 'stdout' | 'stderr',
  offset: number,
  limit: number
): Promise<Response> {
  try {
    // Find the current execution for this task
    const execution = await executionFindCurrent(storage, repoPath, workspace, taskName);
    if (!execution) {
      throw new ExecutionNotFoundError(taskName);
    }

    // Read logs
    const chunk = await executionReadLog(storage, repoPath, execution.taskHash, execution.inputsHash, execution.executionId, stream, { offset, limit });

    return sendSuccess(LogChunkType, {
      data: chunk.data,
      offset: BigInt(chunk.offset),
      size: BigInt(chunk.size),
      totalSize: BigInt(chunk.totalSize),
      complete: chunk.complete,
    });
  } catch (err) {
    return sendError(LogChunkType, errorToVariant(err));
  }
}

/**
 * Get dataflow execution state (for polling).
 *
 * Returns the current execution state including events for progress tracking.
 * Supports offset/limit for paginating events.
 */
export async function getDataflowExecution(
  repoPath: string,
  workspace: string,
  options: { offset?: number; limit?: number } = {}
): Promise<Response> {
  const stateStore = getStateStore(repoPath);

  // Find the latest execution for this workspace
  const handle = await getLatestExecution(repoPath, workspace);
  if (!handle) {
    return sendError(DataflowExecutionStateType, variant('internal', {
      message: 'No execution found for this workspace',
    }));
  }

  // Read execution state
  const coreState = await stateStore.read(repoPath, workspace, handle.id);
  if (!coreState) {
    return sendError(DataflowExecutionStateType, variant('internal', {
      message: 'No execution found for this workspace',
    }));
  }

  // Get events with offset/limit from inline events array
  const offset = options.offset ?? 0;
  const allEvents = coreState.events;
  const totalEvents = allEvents.length;

  // Apply offset and limit
  let events = allEvents.slice(offset);
  if (options.limit !== undefined) {
    events = events.slice(0, options.limit);
  }

  // Convert events to API format
  const apiEvents: DataflowExecutionState['events'] = [];
  for (const event of events) {
    const apiEvent = coreEventToApiEvent(event);
    if (apiEvent !== null) {
      // Convert to East variant format
      switch (apiEvent.type) {
        case 'start':
          apiEvents.push(variant('start', {
            task: apiEvent.task,
            timestamp: apiEvent.timestamp,
          }));
          break;
        case 'complete':
          apiEvents.push(variant('complete', {
            task: apiEvent.task,
            timestamp: apiEvent.timestamp,
            duration: apiEvent.duration ?? 0,
          }));
          break;
        case 'cached':
          apiEvents.push(variant('cached', {
            task: apiEvent.task,
            timestamp: apiEvent.timestamp,
          }));
          break;
        case 'failed':
          apiEvents.push(variant('failed', {
            task: apiEvent.task,
            timestamp: apiEvent.timestamp,
            duration: apiEvent.duration ?? 0,
            exitCode: apiEvent.exitCode ?? BigInt(-1),
          }));
          break;
        case 'error':
          apiEvents.push(variant('error', {
            task: apiEvent.task,
            timestamp: apiEvent.timestamp,
            message: apiEvent.message ?? 'Unknown error',
          }));
          break;
        case 'input_unavailable':
          apiEvents.push(variant('input_unavailable', {
            task: apiEvent.task,
            timestamp: apiEvent.timestamp,
            reason: apiEvent.reason ?? 'Upstream task failed',
          }));
          break;
      }
    }
  }

  // Convert status to API format
  const apiStatus = coreStatusToApiStatus(coreState.status as DataflowExecutionStatus);
  let status: DataflowExecutionState['status'];
  switch (apiStatus) {
    case 'running':
      status = variant('running', null);
      break;
    case 'completed':
      status = variant('completed', null);
      break;
    case 'failed':
      status = variant('failed', null);
      break;
    case 'aborted':
      status = variant('aborted', null);
      break;
  }

  // Calculate duration
  const startTime = getExecutionStartTime(repoPath, workspace, handle.id);
  const duration = startTime ? Date.now() - startTime : 0;

  // Build summary if not running
  let summary: DataflowExecutionState['summary'];
  if (coreState.status !== 'running') {
    summary = some({
      executed: coreState.executed,
      cached: coreState.cached,
      failed: coreState.failed,
      skipped: coreState.skipped,
      duration,
    });
  } else {
    summary = none;
  }

  // Get completedAt value (handle Option type)
  const completedAtValue = coreState.completedAt.type === 'some'
    ? some(coreState.completedAt.value.toISOString())
    : none;

  const state: DataflowExecutionState = {
    status,
    startedAt: coreState.startedAt.toISOString(),
    completedAt: completedAtValue,
    summary,
    events: apiEvents,
    totalEvents: BigInt(totalEvents),
  };

  return sendSuccess(DataflowExecutionStateType, state);
}

/**
 * Cancel a running dataflow execution.
 */
export async function cancelDataflow(
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const orchestrator = getOrchestrator(repoPath);
    const execution = getActiveExecution(repoPath, workspace);

    if (!execution) {
      return sendError(NullType, variant('internal', {
        message: 'No active execution for this workspace',
      }));
    }

    await orchestrator.cancel(execution);

    return sendSuccess(NullType, null);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}
