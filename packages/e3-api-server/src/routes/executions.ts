/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { NullType, some, none, variant } from '@elaraai/east';
import {
  dataflowStart,
  dataflowExecute,
  dataflowGetGraph,
  workspaceStatus,
  executionFindCurrent,
  executionReadLog,
  LocalStorage,
  WorkspaceLockError,
  type WorkspaceStatusResult as CoreWorkspaceStatusResult,
  type DatasetStatusInfo as CoreDatasetStatusInfo,
  type TaskStatusInfo as CoreTaskStatusInfo,
  type DataflowResult as CoreDataflowResult,
  type TaskExecutionResult as CoreTaskExecutionResult,
} from '@elaraai/e3-core';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  DataflowRequestType,
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

export function createExecutionRoutes(repoPath: string) {
  const app = new Hono();
  const storage = new LocalStorage();

  // POST /api/workspaces/:ws/start - Start dataflow execution (non-blocking)
  app.post('/start', async (c) => {
    const workspace = c.req.param('ws');
    if (!workspace) {
      return sendError(c, NullType, errorToVariant(new Error('Missing workspace parameter')));
    }

    try {
      const body = await decodeBody(c, DataflowRequestType);

      // Acquire lock first - returns null if already locked
      const lock = await storage.locks.acquire(repoPath, workspace, variant('dataflow', null));
      if (!lock) {
        throw new WorkspaceLockError(workspace);
      }

      // Spawn dataflow execution in background
      const concurrency = body.concurrency.type === 'some' ? Number(body.concurrency.value) : 4;
      const filter = body.filter.type === 'some' ? body.filter.value : undefined;

      // Start execution without awaiting - it runs in background
      dataflowStart(storage, repoPath, workspace, {
        concurrency,
        force: body.force,
        filter,
        lock,
      }).catch((err) => {
        // Log error but don't throw - execution is in background
        console.error(`Dataflow execution error for workspace ${workspace}:`, err);
      });

      // Return immediately with 202 Accepted
      c.status(202);
      return sendSuccess(c, NullType, null);
    } catch (err) {
      return sendError(c, NullType, errorToVariant(err));
    }
  });

  // POST /api/workspaces/:ws/execute - Execute dataflow (blocking)
  app.post('/execute', async (c) => {
    const workspace = c.req.param('ws');
    if (!workspace) {
      return sendError(c, DataflowResultType, errorToVariant(new Error('Missing workspace parameter')));
    }

    try {
      const body = await decodeBody(c, DataflowRequestType);

      const concurrency = body.concurrency.type === 'some' ? Number(body.concurrency.value) : 4;
      const filter = body.filter.type === 'some' ? body.filter.value : undefined;

      const result = await dataflowExecute(storage, repoPath, workspace, {
        concurrency,
        force: body.force,
        filter,
      });

      return sendSuccess(c, DataflowResultType, convertDataflowResult(result));
    } catch (err) {
      return sendError(c, DataflowResultType, errorToVariant(err));
    }
  });

  // GET /api/workspaces/:ws/status - Get workspace status (for polling)
  app.get('/status', async (c) => {
    const workspace = c.req.param('ws');
    if (!workspace) {
      return sendError(c, WorkspaceStatusResultType, errorToVariant(new Error('Missing workspace parameter')));
    }

    try {
      const result = await workspaceStatus(storage, repoPath, workspace);
      return sendSuccess(c, WorkspaceStatusResultType, convertWorkspaceStatus(result));
    } catch (err) {
      return sendError(c, WorkspaceStatusResultType, errorToVariant(err));
    }
  });

  // GET /api/workspaces/:ws/graph - Get dependency graph
  app.get('/graph', async (c) => {
    const workspace = c.req.param('ws');
    if (!workspace) {
      return sendError(c, DataflowGraphType, errorToVariant(new Error('Missing workspace parameter')));
    }

    try {
      const graph = await dataflowGetGraph(storage, repoPath, workspace);
      return sendSuccess(c, DataflowGraphType, {
        tasks: graph.tasks.map((t) => ({
          name: t.name,
          hash: t.hash,
          inputs: t.inputs,
          output: t.output,
          dependsOn: t.dependsOn,
        })),
      });
    } catch (err) {
      return sendError(c, DataflowGraphType, errorToVariant(err));
    }
  });

  // GET /api/workspaces/:ws/logs/:task - Get task logs
  app.get('/logs/:task', async (c) => {
    const workspace = c.req.param('ws');
    const taskName = c.req.param('task');
    if (!workspace) {
      return sendError(c, LogChunkType, errorToVariant(new Error('Missing workspace parameter')));
    }
    if (!taskName) {
      return sendError(c, LogChunkType, errorToVariant(new Error('Missing task parameter')));
    }

    try {
      // Get query params
      const stream = (c.req.query('stream') as 'stdout' | 'stderr') || 'stdout';
      const offset = parseInt(c.req.query('offset') || '0', 10);
      const limit = parseInt(c.req.query('limit') || '65536', 10);

      // Find the current execution for this task
      const execution = await executionFindCurrent(storage, repoPath, workspace, taskName);
      if (!execution) {
        return sendError(c, LogChunkType, errorToVariant(new Error('No executions found for task')));
      }

      // Read logs
      const chunk = await executionReadLog(storage, repoPath, execution.taskHash, execution.inputsHash, stream, { offset, limit });

      return sendSuccess(c, LogChunkType, {
        data: chunk.data,
        offset: BigInt(chunk.offset),
        size: BigInt(chunk.size),
        totalSize: BigInt(chunk.totalSize),
        complete: chunk.complete,
      });
    } catch (err) {
      return sendError(c, LogChunkType, errorToVariant(err));
    }
  });

  return app;
}
