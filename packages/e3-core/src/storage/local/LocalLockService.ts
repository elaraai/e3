/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { LockState, LockOperation, LockHolder } from '@elaraai/e3-types';
import type { LockHandle, LockService } from '../interfaces.js';
import {
  acquireWorkspaceLock,
  getWorkspaceLockState,
  isLockHolderAlive,
  type AcquireLockOptions,
} from '../../workspaceLock.js';

/**
 * Local filesystem implementation of LockService.
 *
 * Uses flock() for kernel-managed locking with lock state
 * stored in beast2 format using LockStateType.
 */
export class LocalLockService implements LockService {
  constructor(private readonly repoPath: string) {}

  async acquire(
    resource: string,
    operation: LockOperation,
    options?: { wait?: boolean; timeout?: number }
  ): Promise<LockHandle | null> {
    const acquireOptions: AcquireLockOptions = {
      wait: options?.wait ?? false,
      timeout: options?.timeout,
    };

    try {
      const handle = await acquireWorkspaceLock(this.repoPath, resource, operation, acquireOptions);
      return {
        resource,
        release: () => handle.release(),
      };
    } catch {
      // Lock couldn't be acquired
      return null;
    }
  }

  getState(resource: string): Promise<LockState | null> {
    return getWorkspaceLockState(this.repoPath, resource);
  }

  isHolderAlive(holder: LockHolder): Promise<boolean> {
    return isLockHolderAlive(holder);
  }
}
