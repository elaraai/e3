/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType } from '@elaraai/east';
import type { TaskListItem, TaskDetails } from './types.js';
import { TaskListItemType, TaskDetailsType } from './types.js';
import { get, unwrap } from './http.js';

/**
 * List tasks in a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @returns Array of task info (name, hash)
 */
export async function taskList(url: string, repo: string, workspace: string): Promise<TaskListItem[]> {
  const response = await get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/tasks`,
    ArrayType(TaskListItemType)
  );
  return unwrap(response);
}

/**
 * Get task details including runner and typed inputs/outputs.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param name - Task name
 * @returns Task details
 */
export async function taskGet(
  url: string,
  repo: string,
  workspace: string,
  name: string
): Promise<TaskDetails> {
  const response = await get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/tasks/${encodeURIComponent(name)}`,
    TaskDetailsType
  );
  return unwrap(response);
}
