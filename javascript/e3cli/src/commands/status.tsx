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
import { CommitType, type Commit } from '@elaraai/e3-types';

/**
 * Task status type
 */
export type TaskStatus = 'pending' | 'done' | 'error' | 'failed' | 'unknown';

/**
 * Task status information
 */
export interface TaskStatusInfo {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  commitHash: string;
  commit: Commit;
  executionTimeMs?: number;
  errorMessage?: string;
  errorStack?: string[];
}

/**
 * Result of getting task status
 */
export interface GetTaskStatusResult {
  success: boolean;
  statusInfo?: TaskStatusInfo;
  error?: Error;
  notFound?: boolean;
}

/**
 * Core logic for getting task status
 * This function is decoupled from CLI/UI concerns and can be used programmatically
 */
export async function getTaskStatusCore(taskName: string): Promise<GetTaskStatusResult> {
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

    // Parse commit using East parser
    const parser = parseFor(CommitType);
    const parseResult = parser(commitText);

    if (!parseResult.success) {
      throw new Error(`Failed to parse commit: ${parseResult.error}`);
    }

    const commit = parseResult.value;

    // Determine status and extract relevant info
    let status: TaskStatus;
    let executionTimeMs: number | undefined;
    let errorMessage: string | undefined;
    let errorStack: string[] | undefined;

    if (commit.type === 'new_task') {
      status = 'pending';
    } else if (commit.type === 'task_done') {
      status = 'done';
      const executionTimeUs = Number(commit.value.execution_time_us);
      executionTimeMs = executionTimeUs / 1000;
    } else if (commit.type === 'task_error') {
      status = 'error';
      errorMessage = commit.value.error_message;
      errorStack = commit.value.error_stack;
    } else if (commit.type === 'task_fail') {
      status = 'failed';
      errorMessage = commit.value.error_message;
    } else {
      status = 'unknown';
    }

    return {
      success: true,
      statusInfo: {
        taskId,
        taskName,
        status,
        commitHash,
        commit,
        executionTimeMs,
        errorMessage,
        errorStack,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      notFound: error.code === 'ENOENT',
    };
  }
}

/**
 * CLI handler for the status command
 * This function handles the UI/presentation layer
 */
export async function getTaskStatus(taskName: string): Promise<void> {
  const result = await getTaskStatusCore(taskName);

  if (!result.success) {
    if (result.notFound) {
      render(<ErrorMessage message={`Task '${taskName}' not found`} />);
    } else {
      render(<ErrorMessage message={`Failed to get status: ${result.error?.message}`} />);
    }
    process.exit(1);
  }

  const info = result.statusInfo!;

  // Display status based on type
  switch (info.status) {
    case 'pending':
      render(
        <Info
          message={`Task '${info.taskName}' is pending`}
          details={[
            `Task ID: ${info.taskId}`,
            `Status: Queued for execution`,
          ]}
        />
      );
      break;

    case 'done':
      render(
        <Success
          message={`Task '${info.taskName}' completed successfully`}
          details={[
            `Task ID: ${info.taskId}`,
            `Status: Completed`,
            `Execution time: ${info.executionTimeMs?.toFixed(2)}ms`,
            `Commit: ${info.commitHash}`,
          ]}
        />
      );
      break;

    case 'error':
      render(
        <ErrorMessage
          message={`Task '${info.taskName}' failed with error`}
          details={[
            `Task ID: ${info.taskId}`,
            `Status: Error`,
            `Error: ${info.errorMessage}`,
            ...(info.errorStack?.map(loc => `  at ${loc}`) || []),
            `Commit: ${info.commitHash}`,
          ]}
        />
      );
      break;

    case 'failed':
      render(
        <ErrorMessage
          message={`Task '${info.taskName}' failed`}
          details={[
            `Task ID: ${info.taskId}`,
            `Status: Failed`,
            `Error: ${info.errorMessage}`,
            `Commit: ${info.commitHash}`,
          ]}
        />
      );
      break;

    case 'unknown':
    default:
      render(
        <Info
          message={`Task '${info.taskName}' status unknown`}
          details={[`Task ID: ${info.taskId}`, `Commit: ${info.commitHash}`]}
        />
      );
      break;
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
