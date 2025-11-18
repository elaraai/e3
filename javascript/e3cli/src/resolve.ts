/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Resolve a ref or hash to a task_id
 *
 * Input can be:
 * - A task ref name (e.g., "my-task")
 * - A full task_id hash
 * - A partial hash (prefix)
 */
export async function resolveToTaskId(
  repoPath: string,
  refOrHash: string
): Promise<string> {
  // 1. Try as task ref
  const refPath = path.join(repoPath, 'refs', 'tasks', refOrHash);
  try {
    const taskId = (await fs.readFile(refPath, 'utf-8')).trim();
    return taskId;
  } catch {
    // Not a ref, continue
  }

  // 2. Check if it looks like a full hash (64 hex chars)
  if (/^[0-9a-f]{64}$/i.test(refOrHash)) {
    return refOrHash;
  }

  // 3. Try as partial hash - search tasks/ directory
  const tasksDir = path.join(repoPath, 'tasks');
  try {
    const files = await fs.readdir(tasksDir);
    const matches = files.filter(f => f.startsWith(refOrHash.toLowerCase()));

    if (matches.length === 0) {
      throw new Error(`No task found matching '${refOrHash}'`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous hash '${refOrHash}' - matches: ${matches.slice(0, 3).join(', ')}`);
    }

    return matches[0];
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Task not found: '${refOrHash}'`);
    }
    throw error;
  }
}

/**
 * Resolve to latest commit hash for a task
 */
export async function resolveToCommit(
  repoPath: string,
  refOrHash: string
): Promise<string> {
  const taskId = await resolveToTaskId(repoPath, refOrHash);

  // Read tasks/<task_id> to get latest commit
  const taskStatePath = path.join(repoPath, 'tasks', taskId);
  const commitHash = (await fs.readFile(taskStatePath, 'utf-8')).trim();

  return commitHash;
}

/**
 * Check if a hash/partial hash refers to an object
 */
export async function resolveObjectHash(
  repoPath: string,
  hashOrPartial: string
): Promise<string> {
  // Full hash
  if (/^[0-9a-f]{64}$/i.test(hashOrPartial)) {
    return hashOrPartial;
  }

  // Partial hash - search objects/ directory
  const objectsDir = path.join(repoPath, 'objects');
  const dirPrefix = hashOrPartial.slice(0, 2);

  try {
    const subDir = path.join(objectsDir, dirPrefix);
    const files = await fs.readdir(subDir);

    const remainingSuffix = hashOrPartial.slice(2).toLowerCase();
    const matches = files
      .map(f => f.replace(/\.(east|beast2)$/, ''))
      .filter(f => f.startsWith(remainingSuffix));

    if (matches.length === 0) {
      throw new Error(`No object found matching '${hashOrPartial}'`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous hash '${hashOrPartial}' - matches multiple objects`);
    }

    return dirPrefix + matches[0];
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Object not found: '${hashOrPartial}'`);
    }
    throw error;
  }
}
