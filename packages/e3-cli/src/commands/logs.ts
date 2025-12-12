/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 logs command - View execution logs for workspace tasks
 *
 * Usage:
 *   e3 logs . ws                    # List tasks in workspace
 *   e3 logs . ws.taskName           # Show logs for task's latest execution
 *   e3 logs . ws.taskName --follow  # Follow log output
 */

import {
  workspaceListTasks,
  workspaceGetTaskHash,
  executionListForTask,
  executionReadLog,
  executionGet,
  inputsHash,
  workspaceGetDatasetHash,
  workspaceGetTask,
} from '@elaraai/e3-core';
import { resolveRepo, formatError, exitError } from '../utils.js';

/**
 * Format a hash for display (abbreviated).
 */
function abbrev(hash: string): string {
  return hash.slice(0, 8);
}

/**
 * Parse task path: ws.taskName
 */
function parseTaskPath(pathSpec: string): { ws: string; taskName?: string } {
  const dotIndex = pathSpec.indexOf('.');
  if (dotIndex === -1) {
    return { ws: pathSpec };
  }
  return {
    ws: pathSpec.slice(0, dotIndex),
    taskName: pathSpec.slice(dotIndex + 1),
  };
}

/**
 * List tasks in a workspace with their execution status.
 */
async function listWorkspaceTasks(repoPath: string, ws: string): Promise<void> {
  const tasks = await workspaceListTasks(repoPath, ws);

  if (tasks.length === 0) {
    console.log(`No tasks in workspace: ${ws}`);
    return;
  }

  console.log(`Tasks in workspace: ${ws}`);
  console.log('');

  for (const taskName of tasks) {
    const taskHash = await workspaceGetTaskHash(repoPath, ws, taskName);
    const executions = await executionListForTask(repoPath, taskHash);

    if (executions.length === 0) {
      console.log(`  ${taskName}  (no executions)`);
    } else {
      // Get status of the most recent execution
      const latestInHash = executions[0];
      const status = await executionGet(repoPath, taskHash, latestInHash);
      const state = status?.type ?? 'unknown';
      console.log(`  ${taskName}  [${state}] (${executions.length} execution(s))`);
    }
  }

  console.log('');
  console.log(`Use "e3 logs . ${ws}.<taskName>" to view logs.`);
}

/**
 * Find the inputs hash for the current workspace state of a task.
 * This matches the execution that corresponds to the current input values.
 */
async function findCurrentExecution(
  repoPath: string,
  ws: string,
  taskName: string
): Promise<{ taskHash: string; inHash: string } | null> {
  const taskHash = await workspaceGetTaskHash(repoPath, ws, taskName);
  const task = await workspaceGetTask(repoPath, ws, taskName);

  // Get the current input hashes from the workspace
  const currentInputHashes: string[] = [];
  for (const inputPath of task.inputs) {
    const { refType, hash } = await workspaceGetDatasetHash(repoPath, ws, inputPath);
    if (refType !== 'value' || hash === null) {
      // Input not assigned - can't find matching execution
      return null;
    }
    currentInputHashes.push(hash);
  }

  const inHash = inputsHash(currentInputHashes);

  // Check if this execution exists
  const executions = await executionListForTask(repoPath, taskHash);
  if (executions.includes(inHash)) {
    return { taskHash, inHash };
  }

  // Fall back to the most recent execution if current inputs don't match
  if (executions.length > 0) {
    return { taskHash, inHash: executions[0] };
  }

  return null;
}

/**
 * Show logs for a specific execution.
 */
async function showLogs(
  repoPath: string,
  taskHash: string,
  inHash: string,
  follow: boolean
): Promise<void> {
  // Read stdout and stderr
  const stdout = await executionReadLog(repoPath, taskHash, inHash, 'stdout');
  const stderr = await executionReadLog(repoPath, taskHash, inHash, 'stderr');

  if (stdout.totalSize === 0 && stderr.totalSize === 0) {
    console.log('No log output.');
    return;
  }

  if (stdout.totalSize > 0) {
    console.log('=== STDOUT ===');
    console.log(stdout.data);
  }

  if (stderr.totalSize > 0) {
    if (stdout.totalSize > 0) {
      console.log('');
    }
    console.log('=== STDERR ===');
    console.log(stderr.data);
  }

  if (follow) {
    // Follow mode: poll for new content
    let stdoutOffset = stdout.offset + stdout.size;
    let stderrOffset = stderr.offset + stderr.size;

    console.log('');
    console.log('[Following... press Ctrl+C to stop]');

    const pollInterval = 500; // ms
    const poll = async () => {
      const newStdout = await executionReadLog(repoPath, taskHash, inHash, 'stdout', {
        offset: stdoutOffset,
      });
      const newStderr = await executionReadLog(repoPath, taskHash, inHash, 'stderr', {
        offset: stderrOffset,
      });

      if (newStdout.size > 0) {
        process.stdout.write(newStdout.data);
        stdoutOffset += newStdout.size;
      }

      if (newStderr.size > 0) {
        process.stderr.write(newStderr.data);
        stderrOffset += newStderr.size;
      }
    };

    // Keep polling until interrupted
    const intervalId = setInterval(() => void poll(), pollInterval);
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log('\n[Stopped]');
      process.exit(0);
    });

    // Keep the process alive
    await new Promise(() => {
      // Never resolves - will be interrupted by Ctrl+C
    });
  }
}

/**
 * View execution logs for workspace tasks.
 */
export async function logsCommand(
  repoArg: string,
  pathSpec?: string,
  options: { follow?: boolean } = {}
): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);

    if (!pathSpec) {
      exitError('Usage: e3 logs <repo> <ws> or e3 logs <repo> <ws.taskName>');
    }

    // Parse the path: ws or ws.taskName
    const { ws, taskName } = parseTaskPath(pathSpec);

    if (!taskName) {
      // No task specified - list tasks in workspace
      await listWorkspaceTasks(repoPath, ws);
      return;
    }

    // Find the execution for this task
    const execution = await findCurrentExecution(repoPath, ws, taskName);

    if (!execution) {
      exitError(`No executions found for task: ${ws}.${taskName}`);
    }

    console.log(`Task: ${ws}.${taskName}`);
    console.log(`Execution: ${abbrev(execution.taskHash)}/${abbrev(execution.inHash)}`);
    console.log('');

    await showLogs(repoPath, execution.taskHash, execution.inHash, options.follow ?? false);
  } catch (err) {
    exitError(formatError(err));
  }
}
