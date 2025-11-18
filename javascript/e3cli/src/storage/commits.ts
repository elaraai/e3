/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { storeObject } from './objects.js';
import { printFor, variant } from '@elaraai/east';
import { CommitType, type Commit } from '@elaraai/e3-types';

/**
 * Format a commit as .east format using printFor
 */
function formatCommit(commit: Commit): string {
  const printer = printFor(CommitType);
  return printer(commit);
}

/**
 * Create a new_task commit
 */
export async function createNewTaskCommit(
  repoPath: string,
  taskId: string,
  irHash: string,
  argsHashes: string[],
  runtime: string,
  parent: string | null = null
): Promise<string> {
  const commit = variant('new_task', {
    task_id: taskId,
    ir: irHash,
    args: argsHashes,
    runtime,
    parent: parent ? variant('Some', parent) : variant('None', null),
    timestamp: new Date().toISOString(),
  });

  const commitText = formatCommit(commit);
  const commitData = new TextEncoder().encode(commitText);

  return await storeObject(repoPath, commitData, '.east');
}

/**
 * Create a task_done commit
 */
export async function createTaskDoneCommit(
  repoPath: string,
  parentCommitHash: string,
  resultHash: string,
  runtime: string,
  executionTimeUs: number
): Promise<string> {
  const commit = variant('task_done', {
    parent: parentCommitHash,
    result: resultHash,
    runtime,
    execution_time_us: BigInt(executionTimeUs),
    timestamp: new Date().toISOString(),
  });

  const commitText = formatCommit(commit);
  const commitData = new TextEncoder().encode(commitText);

  return await storeObject(repoPath, commitData, '.east');
}

/**
 * Create a task_error commit (for East errors)
 */
export async function createTaskErrorCommit(
  repoPath: string,
  parentCommitHash: string,
  errorMessage: string,
  errorStack: string[],
  runtime: string,
  executionTimeUs: number
): Promise<string> {
  const commit: Commit = variant('task_error', {
    parent: parentCommitHash,
    error_message: errorMessage,
    error_stack: errorStack,
    runtime,
    execution_time_us: BigInt(executionTimeUs),
    timestamp: new Date().toISOString(),
  });

  const commitText = formatCommit(commit);
  const commitData = new TextEncoder().encode(commitText);

  return await storeObject(repoPath, commitData, '.east');
}

/**
 * Create a task_fail commit (for non-East errors)
 */
export async function createTaskFailCommit(
  repoPath: string,
  parentCommitHash: string,
  errorMessage: string,
  runtime: string,
  executionTimeUs: number
): Promise<string> {
  const commit: Commit = variant('task_fail', {
    parent: parentCommitHash,
    error_message: errorMessage,
    runtime,
    execution_time_us: BigInt(executionTimeUs),
    timestamp: new Date().toISOString(),
  });

  const commitText = formatCommit(commit);
  const commitData = new TextEncoder().encode(commitText);

  return await storeObject(repoPath, commitData, '.east');
}
