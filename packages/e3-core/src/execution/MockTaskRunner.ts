/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { StorageBackend } from '../storage/interfaces.js';
import type { TaskRunner, TaskExecuteOptions, TaskResult } from './interfaces.js';

/**
 * Record of a single task execution call.
 */
export interface MockTaskCall {
  taskHash: string;
  inputHashes: string[];
  options?: TaskExecuteOptions;
}

/**
 * TaskRunner mock for testing dataflow orchestration without spawning processes.
 *
 * Allows configuring responses per task and records all calls for assertions.
 */
export class MockTaskRunner implements TaskRunner {
  private results = new Map<string, TaskResult | ((inputHashes: string[]) => TaskResult)>();
  private calls: MockTaskCall[] = [];
  private defaultResult: TaskResult = { state: 'success', cached: false, outputHash: 'mock-hash' };

  /**
   * Set result for a specific task hash.
   *
   * @param taskHash - The task hash to configure
   * @param result - Either a static TaskResult or a function that computes result from inputHashes
   */
  setResult(taskHash: string, result: TaskResult | ((inputHashes: string[]) => TaskResult)): void {
    this.results.set(taskHash, result);
  }

  /**
   * Set default result for tasks without specific results configured.
   *
   * @param result - The default TaskResult to return
   */
  setDefaultResult(result: TaskResult): void {
    this.defaultResult = result;
  }

  /**
   * Get all recorded calls.
   *
   * @returns Readonly array of all execute() calls
   */
  getCalls(): readonly MockTaskCall[] {
    return this.calls;
  }

  /**
   * Clear recorded calls.
   */
  clearCalls(): void {
    this.calls = [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(
    _storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    this.calls.push({ taskHash, inputHashes, options });

    const configured = this.results.get(taskHash);
    if (configured) {
      return typeof configured === 'function' ? configured(inputHashes) : configured;
    }
    return this.defaultResult;
  }
}
