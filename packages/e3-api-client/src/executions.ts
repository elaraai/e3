/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, none, some } from '@elaraai/east';
import type { LogChunk, DataflowGraph, DataflowResult } from './types.js';
import {
  LogChunkType,
  DataflowRequestType,
  DataflowGraphType,
  DataflowResultType,
} from './types.js';
import { get, post, unwrap } from './http.js';

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
 * @param options - Execution options
 */
export async function dataflowStart(
  url: string,
  repo: string,
  workspace: string,
  options: DataflowOptions = {}
): Promise<void> {
  const response = await post(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow`,
    {
      concurrency: options.concurrency != null ? some(BigInt(options.concurrency)) : none,
      force: options.force ?? false,
      filter: options.filter != null ? some(options.filter) : none,
    },
    DataflowRequestType,
    NullType
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
 * @param options - Execution options
 * @returns Dataflow execution result
 */
export async function dataflowExecute(
  url: string,
  repo: string,
  workspace: string,
  options: DataflowOptions = {}
): Promise<DataflowResult> {
  const response = await post(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/execute`,
    {
      concurrency: options.concurrency != null ? some(BigInt(options.concurrency)) : none,
      force: options.force ?? false,
      filter: options.filter != null ? some(options.filter) : none,
    },
    DataflowRequestType,
    DataflowResultType
  );
  return unwrap(response);
}

/**
 * Get the dependency graph for a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @returns Dataflow graph with tasks and dependencies
 */
export async function dataflowGraph(
  url: string,
  repo: string,
  workspace: string
): Promise<DataflowGraph> {
  const response = await get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/graph`,
    DataflowGraphType
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
 * @param options - Log reading options
 * @returns Log chunk with data and metadata
 */
export async function taskLogs(
  url: string,
  repo: string,
  workspace: string,
  task: string,
  options: LogOptions = {}
): Promise<LogChunk> {
  const params = new URLSearchParams();
  if (options.stream) params.set('stream', options.stream);
  if (options.offset != null) params.set('offset', String(options.offset));
  if (options.limit != null) params.set('limit', String(options.limit));

  const query = params.toString();
  const path = `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/logs/${encodeURIComponent(task)}${query ? `?${query}` : ''}`;

  const response = await get(url, path, LogChunkType);
  return unwrap(response);
}
