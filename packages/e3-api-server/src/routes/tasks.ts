/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { ArrayType } from '@elaraai/east';
import {
  workspaceListTasks,
  workspaceGetTask,
  workspaceGetTaskHash,
  LocalBackend,
} from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { TaskInfoType, TaskDetailsType } from '../types.js';

export function createTaskRoutes(repoPath: string) {
  const app = new Hono();

  // GET /api/workspaces/:ws/tasks - List tasks
  app.get('/', async (c) => {
    try {
      const workspace = c.req.param('ws');
      if (!workspace) {
        return sendError(c, ArrayType(TaskInfoType), errorToVariant(new Error('Missing workspace parameter')));
      }
      // workspaceListTasks returns string[] of task names
      const storage = new LocalBackend(repoPath);
      const taskNames = await workspaceListTasks(storage, workspace);

      // Get hash for each task
      const result = await Promise.all(
        taskNames.map(async (name) => {
          const hash = await workspaceGetTaskHash(storage, workspace, name);
          return { name, hash };
        })
      );

      return sendSuccess(c, ArrayType(TaskInfoType), result);
    } catch (err) {
      return sendError(c, ArrayType(TaskInfoType), errorToVariant(err));
    }
  });

  // GET /api/workspaces/:ws/tasks/:name - Get task details
  app.get('/:name', async (c) => {
    try {
      const workspace = c.req.param('ws');
      const name = c.req.param('name');
      if (!workspace || !name) {
        return sendError(c, TaskDetailsType, errorToVariant(new Error('Missing workspace or task name parameter')));
      }

      // Get hash and task object
      const storage = new LocalBackend(repoPath);
      const hash = await workspaceGetTaskHash(storage, workspace, name);
      const task = await workspaceGetTask(storage, workspace, name);

      return sendSuccess(c, TaskDetailsType, {
        name,
        hash,
        commandIr: task.commandIr,
        inputs: task.inputs,
        output: task.output,
      });
    } catch (err) {
      return sendError(c, TaskDetailsType, errorToVariant(err));
    }
  });

  return app;
}
