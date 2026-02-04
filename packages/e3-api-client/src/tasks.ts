/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType } from '@elaraai/east';
import type { TaskListItem, TaskDetails, ExecutionListItem } from './types.js';
import { TaskListItemType, TaskDetailsType, ExecutionListItemType } from './types.js';
import { get, type RequestOptions } from './http.js';

/**
 * List tasks in a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options including auth token
 * @returns Array of task info (name, hash)
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function taskList(url: string, repo: string, workspace: string, options: RequestOptions): Promise<TaskListItem[]> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/tasks`,
    ArrayType(TaskListItemType),
    options
  );
}

/**
 * Get task details including runner and typed inputs/outputs.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param name - Task name
 * @param options - Request options including auth token
 * @returns Task details
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function taskGet(
  url: string,
  repo: string,
  workspace: string,
  name: string,
  options: RequestOptions
): Promise<TaskDetails> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/tasks/${encodeURIComponent(name)}`,
    TaskDetailsType,
    options
  );
}

/**
 * List execution history for a task.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param taskName - Task name
 * @param options - Request options including auth token
 * @returns Array of execution history items
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function taskExecutionList(
  url: string,
  repo: string,
  workspace: string,
  taskName: string,
  options: RequestOptions
): Promise<ExecutionListItem[]> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/tasks/${encodeURIComponent(taskName)}/executions`,
    ArrayType(ExecutionListItemType),
    options
  );
}
