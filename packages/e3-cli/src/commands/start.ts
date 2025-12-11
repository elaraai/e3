/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 start command - Execute tasks in a workspace
 *
 * Usage:
 *   e3 start . my-workspace
 *   e3 start . my-workspace --concurrency 2
 *   e3 start . my-workspace --force
 */

import { dataflowExecute, type TaskExecutionResult } from '@elaraai/e3-core';
import { resolveRepo, formatError, exitError } from '../utils.js';

/**
 * Execute tasks in a workspace.
 */
export async function startCommand(
  repoArg: string,
  ws: string,
  options: { filter?: string; concurrency?: string; force?: boolean }
): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);
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

    const result = await dataflowExecute(repoPath, ws, {
      concurrency,
      force: options.force,
      filter: options.filter,
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
          console.log(`  ${task.name}: exit code ${task.exitCode}`);
        } else if (task.state === 'error') {
          console.log(`  ${task.name}: ${task.error}`);
        }
      }
      process.exit(1);
    }
  } catch (err) {
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
