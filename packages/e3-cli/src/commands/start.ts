/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 start command - Execute tasks in a workspace
 *
 * Usage:
 *   e3 start . my-workspace
 *   e3 start . my-workspace --concurrency 2
 *   e3 start . my-workspace --force
 */

import { dataflowExecute, DataflowAbortedError, LocalStorage, type TaskExecutionResult, WorkspaceLockError } from '@elaraai/e3-core';
import { resolveRepo, formatError, exitError } from '../utils.js';

/**
 * Execute tasks in a workspace.
 */
export async function startCommand(
  repoArg: string,
  ws: string,
  options: { filter?: string; concurrency?: string; force?: boolean }
): Promise<void> {
  // Set up abort controller for signal handling
  const controller = new AbortController();

  // Handle SIGINT (Ctrl+C) and SIGTERM gracefully
  const signalHandler = (signal: string) => {
    console.log('');
    console.log(`Received ${signal}, aborting...`);
    controller.abort();
  };

  process.on('SIGINT', () => signalHandler('SIGINT'));
  process.on('SIGTERM', () => signalHandler('SIGTERM'));

  try {
    const repoPath = resolveRepo(repoArg);
    const storage = new LocalStorage();
    const concurrency = options.concurrency ? parseInt(options.concurrency, 10) : 4;

    console.log(`Starting tasks in workspace: ${ws}`);
    if (options.filter) {
      console.log(`Filter: ${options.filter}`);
    }
    console.log(`Concurrency: ${concurrency}`);
    if (options.force) {
      console.log('Force: re-executing all tasks');
    }
    console.log('');

    const result = await dataflowExecute(storage, repoPath, ws, {
      concurrency,
      force: options.force,
      filter: options.filter,
      signal: controller.signal,
      onTaskStart: (name) => {
        console.log(`  [START] ${name}`);
      },
      onTaskComplete: (taskResult: TaskExecutionResult) => {
        const status = formatTaskStatus(taskResult);
        const cached = taskResult.cached ? ' (cached)' : '';
        const duration = taskResult.duration > 0 ? ` [${taskResult.duration}ms]` : '';
        console.log(`  [${status}] ${taskResult.name}${cached}${duration}`);
      },
    });

    console.log('');
    console.log('Summary:');
    console.log(`  Executed: ${result.executed}`);
    console.log(`  Cached:   ${result.cached}`);
    console.log(`  Failed:   ${result.failed}`);
    console.log(`  Skipped:  ${result.skipped}`);
    console.log(`  Duration: ${result.duration}ms`);

    if (!result.success) {
      console.log('');
      console.log('Failed tasks:');
      for (const task of result.tasks) {
        if (task.state === 'failed') {
          const exitInfo = task.exitCode != null ? `exit code ${task.exitCode}` : 'spawn failed';
          const errorInfo = task.error ? ` - ${task.error}` : '';
          console.log(`  ${task.name}: ${exitInfo}${errorInfo}`);
        } else if (task.state === 'error') {
          console.log(`  ${task.name}: ${task.error}`);
        }
      }
      process.exit(1);
    }
  } catch (err) {
    if (err instanceof DataflowAbortedError) {
      console.log('');
      console.log('Aborted.');
      if (err.partialResults && err.partialResults.length > 0) {
        const completed = err.partialResults.filter(r => r.state === 'success').length;
        console.log(`  Completed before abort: ${completed}`);
      }
      process.exit(130); // Standard exit code for SIGINT (128 + 2)
    } else if (err instanceof WorkspaceLockError) {
      console.log('');
      console.log(`Workspace is locked by another process with PID: ${err.holder?.pid ?? 'unknown'}`);
      process.exit(1);
    }
    exitError(formatError(err));
  }
}

function formatTaskStatus(result: TaskExecutionResult): string {
  switch (result.state) {
    case 'success':
      return 'DONE';
    case 'failed':
      return 'FAIL';
    case 'error':
      return 'ERR';
    case 'skipped':
      return 'SKIP';
    default:
      return '???';
  }
}
