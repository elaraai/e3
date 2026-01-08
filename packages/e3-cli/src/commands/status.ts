/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 status command - Show repository or workspace status
 *
 * Usage:
 *   e3 status .              # Show repository status
 *   e3 status . production   # Show detailed workspace status
 */

import {
  packageList,
  workspaceList,
  workspaceGetState,
  workspaceStatus,
  LocalStorage,
  type WorkspaceStatusResult,
} from '@elaraai/e3-core';
import { resolveRepo, formatError, exitError } from '../utils.js';

/**
 * Show repository or workspace status.
 */
export async function statusCommand(repoArg: string, workspace?: string): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);

    if (workspace) {
      await showWorkspaceStatus(repoPath, workspace);
    } else {
      await showRepoStatus(repoPath);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}

/**
 * Show repository-level status.
 */
async function showRepoStatus(repoPath: string): Promise<void> {
  const storage = new LocalStorage();
  console.log(`Repository: ${repoPath}`);
  console.log('');

  // List packages
  const packages = await packageList(storage, repoPath);
  console.log('Packages:');
  if (packages.length === 0) {
    console.log('  (none)');
  } else {
    for (const pkg of packages) {
      console.log(`  ${pkg.name}@${pkg.version}`);
    }
  }
  console.log('');
  const workspaces = await workspaceList(storage, repoPath);
  console.log('Workspaces:');
  if (workspaces.length === 0) {
    console.log('  (none)');
  } else {
    for (const ws of workspaces) {
      const state = await workspaceGetState(storage, repoPath, ws);
      if (state) {
        console.log(`  ${ws}`);
        console.log(`    Package: ${state.packageName}@${state.packageVersion}`);
        console.log(`    Deployed: ${state.deployedAt.toISOString()}`);
        console.log(`    Updated: ${state.rootUpdatedAt.toISOString()}`);
      } else {
        console.log(`  ${ws} (not deployed)`);
      }
    }
  }
}

/**
 * Show detailed workspace status.
 */
async function showWorkspaceStatus(repoPath: string, ws: string): Promise<void> {
  const storage = new LocalStorage();
  const status = await workspaceStatus(storage, repoPath, ws);

  console.log(`Workspace: ${status.workspace}`);
  console.log('');

  // Lock status
  if (status.lock) {
    console.log('Lock:');
    console.log(`  Held by PID ${status.lock.pid}`);
    console.log(`  Since: ${status.lock.acquiredAt}`);
    if (status.lock.command) {
      console.log(`  Command: ${status.lock.command}`);
    }
    console.log('');
  }

  // Summary
  console.log('Summary:');
  console.log(`  Datasets: ${status.summary.datasets.upToDate} up-to-date, ${status.summary.datasets.stale} stale, ${status.summary.datasets.unset} unset`);

  // Build task summary line - only include non-zero counts
  const taskParts: string[] = [];
  if (status.summary.tasks.upToDate > 0) taskParts.push(`${status.summary.tasks.upToDate} up-to-date`);
  if (status.summary.tasks.ready > 0) taskParts.push(`${status.summary.tasks.ready} ready`);
  if (status.summary.tasks.waiting > 0) taskParts.push(`${status.summary.tasks.waiting} waiting`);
  if (status.summary.tasks.inProgress > 0) taskParts.push(`${status.summary.tasks.inProgress} in-progress`);
  if (status.summary.tasks.failed > 0) taskParts.push(`${status.summary.tasks.failed} failed`);
  if (status.summary.tasks.error > 0) taskParts.push(`${status.summary.tasks.error} error`);
  if (status.summary.tasks.staleRunning > 0) taskParts.push(`${status.summary.tasks.staleRunning} stale-running`);
  console.log(`  Tasks: ${taskParts.join(', ') || 'none'}`);
  console.log('');

  // Tasks section
  if (status.tasks.length > 0) {
    console.log('Tasks:');
    for (const task of status.tasks) {
      const statusStr = formatTaskStatus(task.status);
      console.log(`  ${task.name}: ${statusStr}`);
      if (task.dependsOn.length > 0) {
        console.log(`    depends on: ${task.dependsOn.join(', ')}`);
      }
    }
    console.log('');
  }

  // Datasets section (only show non-up-to-date ones for brevity)
  const nonUpToDate = status.datasets.filter(d => d.status.type !== 'up-to-date');
  if (nonUpToDate.length > 0) {
    console.log('Datasets needing attention:');
    for (const dataset of nonUpToDate) {
      const statusStr = dataset.status.type === 'unset' ? 'unset' : 'stale';
      const producer = dataset.producedBy ? ` (from ${dataset.producedBy})` : ' (input)';
      console.log(`  ${dataset.path}: ${statusStr}${producer}`);
    }
  } else if (status.datasets.length > 0) {
    console.log('All datasets up-to-date');
  }
}

/**
 * Format task status for display.
 */
function formatTaskStatus(status: WorkspaceStatusResult['tasks'][0]['status']): string {
  switch (status.type) {
    case 'up-to-date':
      return status.cached ? 'up-to-date (cached)' : 'up-to-date';
    case 'ready':
      return 'ready to run';
    case 'waiting':
      return `waiting (${status.reason})`;
    case 'in-progress':
      return status.pid ? `in-progress (PID ${status.pid})` : 'in-progress';
    case 'failed':
      return `FAILED (exit code ${status.exitCode})`;
    case 'error':
      return `ERROR: ${status.message}`;
    case 'stale-running':
      return `stale-running (PID ${status.pid} no longer exists)`;
    default:
      return 'unknown';
  }
}
