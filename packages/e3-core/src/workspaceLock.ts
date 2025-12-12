/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Workspace locking for safe concurrent access.
 *
 * Provides exclusive locks on workspaces to prevent concurrent dataflow
 * executions or writes that could corrupt workspace state. Uses Linux
 * flock() for automatic lock release on process death.
 *
 * Lock mechanism:
 * - Uses flock(LOCK_EX | LOCK_NB) via the `flock` command for kernel-managed locking
 * - Lock is automatically released when the process dies (kernel handles this)
 * - Metadata (PID, bootId, startTime) written to lock file for diagnostics
 * - Stale lock detection via bootId comparison (handles system restarts)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { WorkspaceLockError, type LockHolder } from './errors.js';
import { getBootId, getPidStartTime, isProcessAlive } from './executions.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Handle to a held workspace lock.
 * Call release() when done to free the lock.
 */
export interface WorkspaceLockHandle {
  /** The workspace name this lock is for */
  readonly workspace: string;
  /** Path to the lock file */
  readonly lockPath: string;
  /** Release the lock. Safe to call multiple times. */
  release(): Promise<void>;
}

/**
 * Options for acquiring a workspace lock.
 */
export interface AcquireLockOptions {
  /**
   * If true, wait for the lock to become available instead of failing immediately.
   * Default: false (fail fast if locked)
   */
  wait?: boolean;
  /**
   * Timeout in milliseconds when wait=true. Default: 30000 (30 seconds)
   */
  timeout?: number;
}

// =============================================================================
// Lock File Metadata
// =============================================================================

interface LockMetadata {
  pid: number;
  bootId: string;
  startTime: number;
  acquiredAt: string;
  command: string;
}

/**
 * Get the lock file path for a workspace.
 */
export function workspaceLockPath(repoPath: string, workspace: string): string {
  return path.join(repoPath, 'workspaces', `${workspace}.lock`);
}

/**
 * Read lock metadata from a lock file.
 * Returns null if file doesn't exist or is invalid.
 */
async function readLockMetadata(lockPath: string): Promise<LockMetadata | null> {
  try {
    const data = await fs.readFile(lockPath, 'utf-8');
    return JSON.parse(data) as LockMetadata;
  } catch {
    return null;
  }
}

/**
 * Convert internal metadata to public LockHolder interface.
 */
function metadataToHolder(metadata: LockMetadata): LockHolder {
  return {
    pid: metadata.pid,
    acquiredAt: metadata.acquiredAt,
    bootId: metadata.bootId,
    startTime: metadata.startTime,
    command: metadata.command,
  };
}

// =============================================================================
// Lock Acquisition
// =============================================================================

/**
 * Acquire an exclusive lock on a workspace.
 *
 * Uses Linux flock() for kernel-managed locking. The lock is automatically
 * released when the process exits (even on crash/kill).
 *
 * @param repoPath - Path to .e3 repository
 * @param workspace - Workspace name to lock
 * @param options - Lock acquisition options
 * @returns Lock handle - call release() when done
 * @throws {WorkspaceLockError} If workspace is locked by another process
 *
 * @example
 * ```typescript
 * const lock = await acquireWorkspaceLock(repoPath, 'production');
 * try {
 *   await dataflowExecute(repoPath, 'production', { lock });
 * } finally {
 *   await lock.release();
 * }
 * ```
 */
export async function acquireWorkspaceLock(
  repoPath: string,
  workspace: string,
  options: AcquireLockOptions = {}
): Promise<WorkspaceLockHandle> {
  const lockPath = workspaceLockPath(repoPath, workspace);

  // Ensure workspaces directory exists
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  // Gather our process identification
  const pid = process.pid;
  const bootId = await getBootId();
  const startTime = await getPidStartTime(pid);
  const command = process.argv.join(' ');
  const acquiredAt = new Date().toISOString();

  const metadata: LockMetadata = { pid, bootId, startTime, acquiredAt, command };

  // Try to acquire flock via subprocess
  // The subprocess holds the lock and we communicate with it via stdin/signals
  const flockProcess = await tryAcquireFlock(lockPath, metadata, options);

  if (!flockProcess) {
    // Failed to acquire - read metadata to report who has it
    const existingMetadata = await readLockMetadata(lockPath);
    const holder = existingMetadata ? metadataToHolder(existingMetadata) : undefined;
    throw new WorkspaceLockError(workspace, holder);
  }

  // Lock acquired! Create handle
  let released = false;

  const handle: WorkspaceLockHandle = {
    workspace,
    lockPath,
    async release() {
      if (released) return;
      released = true;

      // Kill the flock subprocess to release the lock
      flockProcess.kill('SIGTERM');

      // Clean up lock file (best effort)
      try {
        await fs.unlink(lockPath);
      } catch {
        // Ignore - file might already be gone
      }
    },
  };

  return handle;
}

/**
 * Try to acquire flock using a subprocess.
 *
 * We spawn `flock --nonblock <lockfile> cat` which:
 * 1. Tries to acquire exclusive lock (non-blocking)
 * 2. If successful, runs `cat` which blocks reading stdin forever
 * 3. We keep the subprocess alive to hold the lock
 * 4. When we kill the subprocess, the lock is released
 *
 * Returns the subprocess if lock acquired, null if lock is held by another.
 */
async function tryAcquireFlock(
  lockPath: string,
  metadata: LockMetadata,
  options: AcquireLockOptions
): Promise<ChildProcess | null> {
  // First, check if there's a stale lock we can clean up
  await checkAndCleanStaleLock(lockPath);

  const args = options.wait
    ? ['--timeout', String((options.timeout ?? 30000) / 1000), lockPath, 'cat']
    : ['--nonblock', lockPath, 'cat'];

  const child = spawn('flock', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  return new Promise((resolve) => {
    let resolved = false;

    // If flock fails to acquire, it exits with code 1
    child.on('error', () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });

    child.on('exit', () => {
      if (!resolved) {
        resolved = true;
        // Exit code 1 means lock is held by another
        resolve(null);
      }
    });

    // Give flock a moment to either acquire or fail
    // If it's still running after 100ms, we have the lock
    setTimeout(() => {
      if (!resolved && !child.killed && child.exitCode === null) {
        resolved = true;

        // Write metadata to lock file now that we have the lock
        // Use void to explicitly ignore the promise (metadata is informational only)
        void fs.writeFile(lockPath, JSON.stringify(metadata, null, 2)).catch(() => {});

        resolve(child);
      }
    }, 100);
  });
}

/**
 * Check if a lock file exists with stale metadata and clean it up.
 * A lock is stale if the holder process no longer exists.
 */
async function checkAndCleanStaleLock(lockPath: string): Promise<void> {
  const metadata = await readLockMetadata(lockPath);
  if (!metadata) return;

  // Check if the process that created this lock is still alive
  const alive = await isProcessAlive(metadata.pid, metadata.startTime, metadata.bootId);

  if (!alive) {
    // Stale lock - try to remove it
    try {
      await fs.unlink(lockPath);
    } catch {
      // Ignore - another process might have cleaned it up
    }
  }
}

/**
 * Check if a workspace is currently locked.
 *
 * @param repoPath - Path to .e3 repository
 * @param workspace - Workspace name to check
 * @returns Lock holder info if locked, null if not locked
 */
export async function getWorkspaceLockHolder(
  repoPath: string,
  workspace: string
): Promise<LockHolder | null> {
  const lockPath = workspaceLockPath(repoPath, workspace);
  const metadata = await readLockMetadata(lockPath);

  if (!metadata) return null;

  // Check if the holder is still alive
  const alive = await isProcessAlive(metadata.pid, metadata.startTime, metadata.bootId);

  if (!alive) {
    // Stale lock - clean it up and report as not locked
    try {
      await fs.unlink(lockPath);
    } catch {
      // Ignore
    }
    return null;
  }

  return metadataToHolder(metadata);
}
