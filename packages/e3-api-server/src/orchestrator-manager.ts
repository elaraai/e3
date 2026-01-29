/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Orchestrator manager for e3-api-server.
 *
 * Provides a singleton LocalOrchestrator with InMemoryStateStore
 * and manages active executions per workspace.
 */

import {
  LocalOrchestrator,
  InMemoryStateStore,
  type ExecutionHandle,
  type ExecutionStateStore,
} from '@elaraai/e3-core';

/**
 * Singleton state store shared across all executions.
 */
const stateStore = new InMemoryStateStore();

/**
 * Singleton orchestrator for the API server.
 */
const orchestrator = new LocalOrchestrator(stateStore);

/**
 * Map of active execution handles by workspace key.
 * Key format: `${repoPath}::${workspace}`
 */
const activeExecutions = new Map<string, ExecutionHandle>();

/**
 * Map of execution start times for duration tracking.
 * Key format: `${repoPath}::${workspace}:${executionId}`
 */
const executionStartTimes = new Map<string, number>();

/**
 * Generate a key for workspace-level lookups.
 */
function makeWorkspaceKey(repoPath: string, workspace: string): string {
  return `${repoPath}::${workspace}`;
}

/**
 * Generate a key for execution-level lookups.
 */
function makeExecutionKey(repoPath: string, workspace: string, executionId: string): string {
  return `${repoPath}::${workspace}:${executionId}`;
}

/**
 * Get the singleton orchestrator instance.
 */
export function getOrchestrator(): LocalOrchestrator {
  return orchestrator;
}

/**
 * Get the singleton state store instance.
 */
export function getStateStore(): ExecutionStateStore {
  return stateStore;
}

/**
 * Set the active execution for a workspace.
 * Replaces any previous execution.
 */
export function setActiveExecution(repoPath: string, workspace: string, handle: ExecutionHandle): void {
  const key = makeWorkspaceKey(repoPath, workspace);
  activeExecutions.set(key, handle);

  // Record start time for duration tracking
  const execKey = makeExecutionKey(repoPath, workspace, handle.id);
  executionStartTimes.set(execKey, Date.now());
}

/**
 * Get the active execution for a workspace.
 */
export function getActiveExecution(repoPath: string, workspace: string): ExecutionHandle | null {
  const key = makeWorkspaceKey(repoPath, workspace);
  return activeExecutions.get(key) ?? null;
}

/**
 * Clear the active execution for a workspace.
 */
export function clearActiveExecution(repoPath: string, workspace: string): void {
  const key = makeWorkspaceKey(repoPath, workspace);
  const handle = activeExecutions.get(key);
  if (handle) {
    const execKey = makeExecutionKey(repoPath, workspace, handle.id);
    executionStartTimes.delete(execKey);
  }
  activeExecutions.delete(key);
}

/**
 * Check if there's an active (running) execution for a workspace.
 */
export function hasActiveExecution(repoPath: string, workspace: string): boolean {
  return activeExecutions.has(makeWorkspaceKey(repoPath, workspace));
}

/**
 * Get the start time for an execution (for duration calculation).
 */
export function getExecutionStartTime(repoPath: string, workspace: string, executionId: string): number | null {
  const key = makeExecutionKey(repoPath, workspace, executionId);
  return executionStartTimes.get(key) ?? null;
}

/**
 * Get the latest execution for a workspace (may not be active/running).
 * Useful for polling completed executions.
 */
export async function getLatestExecution(repoPath: string, workspace: string): Promise<ExecutionHandle | null> {
  // First check for active execution
  const active = getActiveExecution(repoPath, workspace);
  if (active) {
    return active;
  }

  // Otherwise check state store for latest
  const state = await stateStore.readLatest(repoPath, workspace);
  if (state) {
    return { id: state.id, repo: repoPath, workspace };
  }

  return null;
}

/**
 * Clear all state (for testing).
 */
export function clearAll(): void {
  activeExecutions.clear();
  executionStartTimes.clear();
  stateStore.clear();
}
