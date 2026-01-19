/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, none, some } from '@elaraai/east';
import type { LogChunk, DataflowGraph, DataflowResult, DataflowExecutionState } from './types.js';
import {
  LogChunkType,
  DataflowRequestType,
  DataflowGraphType,
  DataflowResultType,
  DataflowExecutionStateType,
} from './types.js';
import { get, post, unwrap, type RequestOptions } from './http.js';

/**
 * Options for starting dataflow execution.
 */
export interface DataflowOptions {
  /** Maximum parallel tasks (default: 4) */
  concurrency?: number;
  /** Force re-execution of all tasks */
  force?: boolean;
  /** Filter to specific task names */
  filter?: string;
}

/**
 * Start dataflow execution on a workspace (non-blocking).
 *
 * Returns immediately after spawning execution in background.
 * Use workspaceStatus() to poll for progress.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param dataflowOptions - Execution options
 * @param options - Request options including auth token
 */
export async function dataflowStart(
  url: string,
  repo: string,
  workspace: string,
  dataflowOptions: DataflowOptions = {},
  options: RequestOptions
): Promise<void> {
  const response = await post(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow`,
    {
      concurrency: dataflowOptions.concurrency != null ? some(BigInt(dataflowOptions.concurrency)) : none,
      force: dataflowOptions.force ?? false,
      filter: dataflowOptions.filter != null ? some(dataflowOptions.filter) : none,
    },
    DataflowRequestType,
    NullType,
    options
  );
  unwrap(response);
}

/**
 * Execute dataflow on a workspace (blocking).
 *
 * Waits for execution to complete and returns the result.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param dataflowOptions - Execution options
 * @param options - Request options including auth token
 * @returns Dataflow execution result
 */
export async function dataflowExecute(
  url: string,
  repo: string,
  workspace: string,
  dataflowOptions: DataflowOptions = {},
  options: RequestOptions
): Promise<DataflowResult> {
  const response = await post(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/execute`,
    {
      concurrency: dataflowOptions.concurrency != null ? some(BigInt(dataflowOptions.concurrency)) : none,
      force: dataflowOptions.force ?? false,
      filter: dataflowOptions.filter != null ? some(dataflowOptions.filter) : none,
    },
    DataflowRequestType,
    DataflowResultType,
    options
  );
  return unwrap(response);
}

/**
 * Get the dependency graph for a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options including auth token
 * @returns Dataflow graph with tasks and dependencies
 */
export async function dataflowGraph(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<DataflowGraph> {
  const response = await get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/graph`,
    DataflowGraphType,
    options
  );
  return unwrap(response);
}

/**
 * Options for reading task logs.
 */
export interface LogOptions {
  /** Which stream to read (default: 'stdout') */
  stream?: 'stdout' | 'stderr';
  /** Byte offset to start from (default: 0) */
  offset?: number;
  /** Maximum bytes to read (default: 65536) */
  limit?: number;
}

/**
 * Read task logs from a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param task - Task name
 * @param logOptions - Log reading options
 * @param options - Request options including auth token
 * @returns Log chunk with data and metadata
 */
export async function taskLogs(
  url: string,
  repo: string,
  workspace: string,
  task: string,
  logOptions: LogOptions = {},
  options: RequestOptions
): Promise<LogChunk> {
  const params = new URLSearchParams();
  if (logOptions.stream) params.set('stream', logOptions.stream);
  if (logOptions.offset != null) params.set('offset', String(logOptions.offset));
  if (logOptions.limit != null) params.set('limit', String(logOptions.limit));

  const query = params.toString();
  const path = `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/logs/${encodeURIComponent(task)}${query ? `?${query}` : ''}`;

  const response = await get(url, path, LogChunkType, options);
  return unwrap(response);
}

/**
 * Options for getting execution state.
 */
export interface ExecutionStateOptions {
  /** Skip first N events (default: 0) */
  offset?: number;
  /** Maximum events to return (default: all) */
  limit?: number;
}

/**
 * Get dataflow execution state (for polling).
 *
 * Returns the current execution state including events for progress tracking.
 * Use offset/limit for pagination of events.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param stateOptions - Pagination options for events
 * @param options - Request options including auth token
 * @returns Execution state with events and summary
 */
export async function dataflowExecution(
  url: string,
  repo: string,
  workspace: string,
  stateOptions: ExecutionStateOptions = {},
  options: RequestOptions
): Promise<DataflowExecutionState> {
  const params = new URLSearchParams();
  if (stateOptions.offset != null) params.set('offset', String(stateOptions.offset));
  if (stateOptions.limit != null) params.set('limit', String(stateOptions.limit));

  const query = params.toString();
  const path = `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/execution${query ? `?${query}` : ''}`;

  const response = await get(url, path, DataflowExecutionStateType, options);
  return unwrap(response);
}
