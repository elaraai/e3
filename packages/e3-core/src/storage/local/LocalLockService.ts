/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { LockHolder, LockHandle, LockService } from '../interfaces.js';
import {
  acquireWorkspaceLock,
  getWorkspaceLockHolder,
  type AcquireLockOptions,
} from '../../workspaceLock.js';
import { isProcessAlive } from '../../executions.js';

/**
 * Local filesystem implementation of LockService.
 *
 * Wraps the existing workspaceLock.ts functions.
 */
export class LocalLockService implements LockService {
  constructor(private readonly repoPath: string) {}

  async acquire(
    resource: string,
    holder: Omit<LockHolder, 'acquiredAt'>,
    options?: { wait?: boolean; timeout?: number }
  ): Promise<LockHandle | null> {
    const acquireOptions: AcquireLockOptions = {
      wait: options?.wait ?? false,
      timeout: options?.timeout,
    };

    try {
      const handle = await acquireWorkspaceLock(this.repoPath, resource, acquireOptions);
      return {
        resource,
        release: () => handle.release(),
      };
    } catch {
      // Lock couldn't be acquired
      return null;
    }
  }

  async getHolder(resource: string): Promise<LockHolder | null> {
    return getWorkspaceLockHolder(this.repoPath, resource);
  }

  async isHolderAlive(holder: LockHolder): Promise<boolean> {
    // If we don't have the required fields, assume alive (safer default)
    if (holder.bootId === undefined || holder.startTime === undefined) {
      return true;
    }
    return isProcessAlive(holder.pid, holder.startTime, holder.bootId);
  }
}
