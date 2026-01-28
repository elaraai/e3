/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { taskExecute } from '../executions.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { TaskRunner, TaskExecuteOptions, TaskResult } from './interfaces.js';

/**
 * TaskRunner implementation for local process execution.
 *
 * Wraps the existing taskExecute() function to conform to the TaskRunner interface.
 * Used by the local CLI and e3-api-server for task execution.
 */
export class LocalTaskRunner implements TaskRunner {
  constructor(private readonly repo: string) {}

  async execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    const result = await taskExecute(storage, this.repo, taskHash, inputHashes, {
      force: options?.force,
      signal: options?.signal,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });

    // Convert ExecutionResult to TaskResult
    const taskResult: TaskResult = {
      state: result.state,
      cached: result.cached,
    };

    if (result.state === 'success' && result.outputHash) {
      taskResult.outputHash = result.outputHash;
    } else if (result.state === 'failed') {
      taskResult.exitCode = result.exitCode ?? undefined;
    } else if (result.state === 'error') {
      taskResult.error = result.error ?? undefined;
    }

    return taskResult;
  }
}
