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
  executionGetLatest,
  executionFindCurrent,
  isProcessAlive,
  LocalStorage,
  type StorageBackend,
} from '@elaraai/e3-core';
import {
  taskList as taskListRemote,
  taskExecutionList as taskExecutionListRemote,
  taskLogs as taskLogsRemote,
  ApiError,
} from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError } from '../utils.js';

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
async function listWorkspaceTasks(storage: StorageBackend, repoPath: string, ws: string): Promise<void> {
  const tasks = await workspaceListTasks(storage, repoPath, ws);

  if (tasks.length === 0) {
    console.log(`No tasks in workspace: ${ws}`);
    return;
  }

  console.log(`Tasks in workspace: ${ws}`);
  console.log('');

  for (const taskName of tasks) {
    const taskHash = await workspaceGetTaskHash(storage, repoPath, ws, taskName);
    const executions = await executionListForTask(storage, repoPath, taskHash);

    if (executions.length === 0) {
      console.log(`  ${taskName}  (no executions)`);
    } else {
      // Get status of the most recent execution
      const latestInHash = executions[0]!;
      const status = await executionGetLatest(storage, repoPath, taskHash, latestInHash);
      let state = status?.type ?? 'unknown';

      // Check if running process is actually alive
      if (status?.type === 'running') {
        const pid = Number(status.value.pid);
        const pidStartTime = Number(status.value.pidStartTime);
        const bootId = status.value.bootId;
        const alive = await isProcessAlive(pid, pidStartTime, bootId);
        if (!alive) {
          state = 'stale-running';
        }
      }

      console.log(`  ${taskName}  [${state}] (${executions.length} execution(s))`);
    }
  }

  console.log('');
  console.log(`Use "e3 logs . ${ws}.<taskName>" to view logs.`);
}


/** Normalized log chunk with plain numbers. */
interface LogData {
  data: string;
  offset: number;
  size: number;
  totalSize: number;
  complete: boolean;
}

/** Callback to fetch new log data from a given offset. */
type PollFn = (stream: 'stdout' | 'stderr', offset: number) => Promise<LogData>;

/**
 * Display logs and optionally follow for new output.
 */
async function displayLogs(
  stdout: LogData,
  stderr: LogData,
  follow: boolean,
  poll: PollFn
): Promise<void> {
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
    let stdoutOffset = stdout.offset + stdout.size;
    let stderrOffset = stderr.offset + stderr.size;

    console.log('');
    console.log('[Following... press Ctrl+C to stop]');

    const pollInterval = 500; // ms
    const tick = async () => {
      const newStdout = await poll('stdout', stdoutOffset);
      const newStderr = await poll('stderr', stderrOffset);

      if (newStdout.size > 0) {
        process.stdout.write(newStdout.data);
        stdoutOffset += newStdout.size;
      }

      if (newStderr.size > 0) {
        process.stderr.write(newStderr.data);
        stderrOffset += newStderr.size;
      }
    };

    const intervalId = setInterval(() => void tick(), pollInterval);
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log('\n[Stopped]');
      process.exit(0);
    });

    // Keep the process alive — interrupted by Ctrl+C
    await new Promise(() => {});
  }
}

/**
 * List tasks in a workspace (remote).
 */
async function listWorkspaceTasksRemote(
  baseUrl: string,
  repo: string,
  ws: string,
  token: string
): Promise<void> {
  const tasks = await taskListRemote(baseUrl, repo, ws, { token });

  if (tasks.length === 0) {
    console.log(`No tasks in workspace: ${ws}`);
    return;
  }

  console.log(`Tasks in workspace: ${ws}`);
  console.log('');

  for (const task of tasks) {
    const executions = await taskExecutionListRemote(baseUrl, repo, ws, task.name, { token });

    if (executions.length === 0) {
      console.log(`  ${task.name}  (no executions)`);
    } else {
      // Get status of the most recent execution
      const latest = executions[0]!;
      const state = latest.status.type;
      console.log(`  ${task.name}  [${state}] (${executions.length} execution(s))`);
    }
  }

  console.log('');
  console.log(`Use "e3 logs <repo> ${ws}.<taskName>" to view logs.`);
}

/** Convert a remote LogChunk (bigint fields) to LogData. */
function toLogData(chunk: Awaited<ReturnType<typeof taskLogsRemote>>): LogData {
  return {
    data: chunk.data,
    offset: Number(chunk.offset),
    size: Number(chunk.size),
    totalSize: Number(chunk.totalSize),
    complete: chunk.complete,
  };
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
    const location = await parseRepoLocation(repoArg);

    if (!pathSpec) {
      exitError('Usage: e3 logs <repo> <ws> or e3 logs <repo> <ws.taskName>');
    }

    // Parse the path: ws or ws.taskName
    const { ws, taskName } = parseTaskPath(pathSpec);

    if (location.type === 'local') {
      const storage = new LocalStorage();

      if (!taskName) {
        // No task specified - list tasks in workspace
        await listWorkspaceTasks(storage, location.path, ws);
        return;
      }

      // Find the execution for this task
      const execution = await executionFindCurrent(storage, location.path, ws, taskName);

      if (!execution) {
        exitError(`No executions found for task: ${ws}.${taskName}`);
      }

      const { taskHash, inputsHash, executionId } = execution;

      console.log(`Task: ${ws}.${taskName}`);
      console.log(`Execution: ${abbrev(taskHash)}/${abbrev(inputsHash)}/${abbrev(executionId)}`);
      console.log('');

      const stdout = await executionReadLog(storage, location.path, taskHash, inputsHash, executionId, 'stdout');
      const stderr = await executionReadLog(storage, location.path, taskHash, inputsHash, executionId, 'stderr');

      await displayLogs(stdout, stderr, options.follow ?? false, (stream, offset) =>
        executionReadLog(storage, location.path, taskHash, inputsHash, executionId, stream, { offset })
      );
    } else {
      // Remote
      if (!taskName) {
        // No task specified - list tasks in workspace
        await listWorkspaceTasksRemote(location.baseUrl, location.repo, ws, location.token);
        return;
      }

      console.log(`Task: ${ws}.${taskName}`);
      console.log('');

      const { baseUrl, repo, token } = location;
      let stdout, stderr;
      try {
        stdout = toLogData(await taskLogsRemote(baseUrl, repo, ws, taskName, { stream: 'stdout' }, { token }));
        stderr = toLogData(await taskLogsRemote(baseUrl, repo, ws, taskName, { stream: 'stderr' }, { token }));
      } catch (err) {
        if (err instanceof ApiError && err.code === 'execution_not_found') {
          exitError(`No executions found for task: ${ws}.${taskName}`);
        }
        throw err;
      }

      await displayLogs(stdout, stderr, options.follow ?? false, async (stream, offset) =>
        toLogData(await taskLogsRemote(baseUrl, repo, ws, taskName, { stream, offset }, { token }))
      );
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
