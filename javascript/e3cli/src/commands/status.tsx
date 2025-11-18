/**
 * e3 status command - Get task status
 */

import React from 'react';
import { render } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepository } from '../repo.js';
import { Success, Error as ErrorMessage, Info } from '../ui/index.js';
import { parseFor } from '@elaraai/east';

/**
 * Get status of a named task
 */
export async function getTaskStatus(taskName: string): Promise<void> {
  const repoPath = getRepository();

  try {
    // 1. Resolve task name to task_id
    const refPath = path.join(repoPath, 'refs', 'tasks', taskName);
    const taskId = (await fs.readFile(refPath, 'utf-8')).trim();

    // 2. Get latest commit for task
    const taskStatePath = path.join(repoPath, 'tasks', taskId);
    const commitHash = (await fs.readFile(taskStatePath, 'utf-8')).trim();

    // 3. Load commit to determine status
    const commitPath = await findCommitFile(repoPath, commitHash);
    const commitText = (await fs.readFile(commitPath, 'utf-8')).trim();

    // Parse commit type
    if (commitText.startsWith('.new_task')) {
      render(
        <Info
          message={`Task '${taskName}' is pending`}
          details={[
            `Task ID: ${taskId}`,
            `Status: Queued for execution`,
          ]}
        />
      );
    } else if (commitText.startsWith('.task_done')) {
      // Extract execution time
      const timeMatch = commitText.match(/execution_time_us=(\d+)/);
      const executionTimeUs = timeMatch ? parseInt(timeMatch[1], 10) : 0;
      const executionTimeMs = (executionTimeUs / 1000).toFixed(2);

      render(
        <Success
          message={`Task '${taskName}' completed successfully`}
          details={[
            `Task ID: ${taskId}`,
            `Status: Completed`,
            `Execution time: ${executionTimeMs}ms`,
            `Commit: ${commitHash}`,
          ]}
        />
      );
    } else if (commitText.startsWith('.task_error')) {
      render(
        <ErrorMessage
          message={`Task '${taskName}' failed with error`}
          details={[
            `Task ID: ${taskId}`,
            `Status: Error`,
            `Commit: ${commitHash}`,
          ]}
        />
      );
    } else if (commitText.startsWith('.task_fail')) {
      render(
        <ErrorMessage
          message={`Task '${taskName}' failed`}
          details={[
            `Task ID: ${taskId}`,
            `Status: Failed`,
            `Commit: ${commitHash}`,
          ]}
        />
      );
    } else {
      render(
        <Info
          message={`Task '${taskName}' status unknown`}
          details={[`Task ID: ${taskId}`, `Commit: ${commitHash}`]}
        />
      );
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      render(<ErrorMessage message={`Task '${taskName}' not found`} />);
    } else {
      render(<ErrorMessage message={`Failed to get status: ${error.message}`} />);
    }
    process.exit(1);
  }
}

/**
 * Find commit file (try .east then .beast2)
 */
async function findCommitFile(repoPath: string, hash: string): Promise<string> {
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2);

  const eastPath = path.join(repoPath, 'objects', dirName, `${fileName}.east`);
  const beast2Path = path.join(repoPath, 'objects', dirName, `${fileName}.beast2`);

  try {
    await fs.access(eastPath);
    return eastPath;
  } catch {
    return beast2Path;
  }
}
