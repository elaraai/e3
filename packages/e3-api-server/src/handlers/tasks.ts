/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType } from '@elaraai/east';
import {
  workspaceListTasks,
  workspaceGetTask,
  workspaceGetTaskHash,
} from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { TaskInfoType, TaskDetailsType } from '../types.js';

/**
 * List all tasks in a workspace.
 */
export async function listTasks(
  storage: StorageBackend,
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const taskNames = await workspaceListTasks(storage, repoPath, workspace);

    // Get hash for each task
    const result = await Promise.all(
      taskNames.map(async (name) => {
        const hash = await workspaceGetTaskHash(storage, repoPath, workspace, name);
        return { name, hash };
      })
    );

    return sendSuccess(ArrayType(TaskInfoType), result);
  } catch (err) {
    return sendError(ArrayType(TaskInfoType), errorToVariant(err));
  }
}

/**
 * Get task details.
 */
export async function getTask(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  taskName: string
): Promise<Response> {
  try {
    const hash = await workspaceGetTaskHash(storage, repoPath, workspace, taskName);
    const task = await workspaceGetTask(storage, repoPath, workspace, taskName);

    return sendSuccess(TaskDetailsType, {
      name: taskName,
      hash,
      commandIr: task.commandIr,
      inputs: task.inputs,
      output: task.output,
    });
  } catch (err) {
    return sendError(TaskDetailsType, errorToVariant(err));
  }
}
