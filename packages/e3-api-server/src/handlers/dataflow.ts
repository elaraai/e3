/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, some, none, variant } from '@elaraai/east';
import {
  dataflowStart,
  dataflowExecute,
  dataflowGetGraph,
  workspaceStatus,
  executionFindCurrent,
  executionReadLog,
  WorkspaceLockError,
  type WorkspaceStatusResult as CoreWorkspaceStatusResult,
  type DatasetStatusInfo as CoreDatasetStatusInfo,
  type TaskStatusInfo as CoreTaskStatusInfo,
  type DataflowResult as CoreDataflowResult,
  type TaskExecutionResult as CoreTaskExecutionResult,
} from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { sendSuccess, sendError, sendSuccessWithStatus } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  WorkspaceStatusResultType,
  DataflowGraphType,
  LogChunkType,
  DataflowResultType,
  type WorkspaceStatusResult,
  type DatasetStatusInfo,
  type TaskStatusInfo,
  type DataflowResult,
  type TaskExecutionResult,
} from '../types.js';

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
 * Convert core TaskExecutionResult to API type.
 */
function convertTaskExecutionResult(result: CoreTaskExecutionResult): TaskExecutionResult {
  let state: TaskExecutionResult['state'];
  switch (result.state) {
    case 'success':
      state = variant('success', null);
      break;
    case 'failed':
      state = variant('failed', { exitCode: BigInt(result.exitCode ?? -1) });
      break;
    case 'error':
      state = variant('error', { message: result.error ?? 'Unknown error' });
      break;
    case 'skipped':
      state = variant('skipped', null);
      break;
  }

  return {
    name: result.name,
    cached: result.cached,
    state,
    duration: result.duration,
  };
}

/**
 * Convert core DataflowResult to API type.
 */
function convertDataflowResult(result: CoreDataflowResult): DataflowResult {
  return {
    success: result.success,
    executed: BigInt(result.executed),
    cached: BigInt(result.cached),
    failed: BigInt(result.failed),
    skipped: BigInt(result.skipped),
    tasks: result.tasks.map(convertTaskExecutionResult),
    duration: result.duration,
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
 */
export async function startDataflow(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  options: { concurrency: number; force: boolean; filter?: string }
): Promise<Response> {
  try {
    // Acquire lock first - returns null if already locked
    const lock = await storage.locks.acquire(repoPath, workspace, variant('dataflow', null));
    if (!lock) {
      throw new WorkspaceLockError(workspace);
    }

    // Start execution without awaiting - it runs in background
    dataflowStart(storage, repoPath, workspace, {
      concurrency: options.concurrency,
      force: options.force,
      filter: options.filter,
      lock,
    }).catch((err) => {
      // Log error but don't throw - execution is in background
      console.error(`Dataflow execution error for workspace ${workspace}:`, err);
    });

    // Return immediately with 202 Accepted
    return sendSuccessWithStatus(NullType, null, 202);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}

/**
 * Execute dataflow (blocking).
 *
 * Blocks until execution completes and returns the result.
 */
export async function executeDataflow(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  options: { concurrency: number; force: boolean; filter?: string }
): Promise<Response> {
  try {
    const result = await dataflowExecute(storage, repoPath, workspace, options);
    return sendSuccess(DataflowResultType, convertDataflowResult(result));
  } catch (err) {
    return sendError(DataflowResultType, errorToVariant(err));
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
      return sendError(LogChunkType, errorToVariant(new Error('No executions found for task')));
    }

    // Read logs
    const chunk = await executionReadLog(storage, repoPath, execution.taskHash, execution.inputsHash, stream, { offset, limit });

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
