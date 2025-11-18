/**
 * Commit helpers for E3 repository
 *
 * Creates and manages commit objects (stored in .east format)
 */

import { storeObject } from './objects.js';

/**
 * Commit types as East variant values
 */

export interface NewTaskCommit {
  tag: 'new_task';
  value: {
    task_id: string;
    ir: string;
    args: string[];
    runtime: string;
    parent: string | null;
    timestamp: string; // ISO 8601 UTC
  };
}

export interface TaskDoneCommit {
  tag: 'task_done';
  value: {
    parent: string;
    result: string;
    runtime: string;
    execution_time_us: number;
    timestamp: string;
  };
}

export interface TaskErrorCommit {
  tag: 'task_error';
  value: {
    parent: string;
    error_message: string;
    error_stack: string[];
    runtime: string;
    execution_time_us: number;
    timestamp: string;
  };
}

export interface TaskFailCommit {
  tag: 'task_fail';
  value: {
    parent: string;
    error_message: string;
    runtime: string;
    execution_time_us: number;
    timestamp: string;
  };
}

export type Commit =
  | NewTaskCommit
  | TaskDoneCommit
  | TaskErrorCommit
  | TaskFailCommit;

/**
 * Format a commit as .east format
 */
function formatCommit(commit: Commit): string {
  // Format as East variant syntax
  const formatValue = (v: any): string => {
    if (v === null) return 'null';
    if (typeof v === 'string') return `"${v}"`;
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) {
      return `[${v.map(formatValue).join(', ')}]`;
    }
    if (typeof v === 'object') {
      const entries = Object.entries(v).map(
        ([k, val]) => `${k}=${formatValue(val)}`
      );
      return `(${entries.join(', ')})`;
    }
    return String(v);
  };

  return `.${commit.tag} ${formatValue(commit.value)}\n`;
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
  const commit: NewTaskCommit = {
    tag: 'new_task',
    value: {
      task_id: taskId,
      ir: irHash,
      args: argsHashes,
      runtime,
      parent,
      timestamp: new Date().toISOString(),
    },
  };

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
  const commit: TaskDoneCommit = {
    tag: 'task_done',
    value: {
      parent: parentCommitHash,
      result: resultHash,
      runtime,
      execution_time_us: executionTimeUs,
      timestamp: new Date().toISOString(),
    },
  };

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
  const commit: TaskErrorCommit = {
    tag: 'task_error',
    value: {
      parent: parentCommitHash,
      error_message: errorMessage,
      error_stack: errorStack,
      runtime,
      execution_time_us: executionTimeUs,
      timestamp: new Date().toISOString(),
    },
  };

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
  const commit: TaskFailCommit = {
    tag: 'task_fail',
    value: {
      parent: parentCommitHash,
      error_message: errorMessage,
      runtime,
      execution_time_us: executionTimeUs,
      timestamp: new Date().toISOString(),
    },
  };

  const commitText = formatCommit(commit);
  const commitData = new TextEncoder().encode(commitText);

  return await storeObject(repoPath, commitData, '.east');
}
