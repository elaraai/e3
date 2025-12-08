/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Update task state to point to new commit
 */
export async function updateTaskState(
  repoPath: string,
  taskId: string,
  commitHash: string
): Promise<void> {
  const taskStatePath = path.join(repoPath, 'tasks', taskId);
  await fs.writeFile(taskStatePath, commitHash);
}

/**
 * Get the current commit hash for a task
 */
export async function getTaskState(
  repoPath: string,
  taskId: string
): Promise<string | null> {
  const taskStatePath = path.join(repoPath, 'tasks', taskId);
  try {
    const commitHash = await fs.readFile(taskStatePath, 'utf-8');
    return commitHash.trim();
  } catch {
    return null;
  }
}

/**
 * List all task IDs
 */
export async function listTasks(repoPath: string): Promise<string[]> {
  const tasksDir = path.join(repoPath, 'tasks');
  try {
    return await fs.readdir(tasksDir);
  } catch {
    return [];
  }
}
