/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { variant } from '@elaraai/east';
import { repoGc, packageList, workspaceList } from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { sendSuccess, sendSuccessWithStatus, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  RepositoryStatusType,
  GcStartResultType,
  GcStatusResultType,
} from '../types.js';
import {
  createGcOperation,
  completeGcOperation,
  failGcOperation,
  getGcOperationStatus,
  hasGcOperation,
} from '../async-operation-state.js';

/**
 * Get repository status.
 */
export async function getStatus(
  storage: StorageBackend,
  repoPath: string
): Promise<Response> {
  try {
    // Count objects
    const objectCount = await storage.objects.count(repoPath);

    // Count packages and workspaces
    const packages = await packageList(storage, repoPath);
    const workspaces = await workspaceList(storage, repoPath);

    const status = {
      path: repoPath,
      objectCount: BigInt(objectCount),
      packageCount: BigInt(packages.length),
      workspaceCount: BigInt(workspaces.length),
    };
    return sendSuccess(RepositoryStatusType, status);
  } catch (err) {
    return sendError(RepositoryStatusType, errorToVariant(err));
  }
}

/**
 * Start garbage collection (async).
 *
 * Returns immediately with an executionId. GC runs in background.
 * Poll getGcStatus() for progress.
 */
export function startGc(
  storage: StorageBackend,
  repoPath: string,
  options: { dryRun: boolean; minAge?: number }
): Response {
  // Create operation and get executionId
  const executionId = createGcOperation();

  // Run GC in background (don't await)
  void (async () => {
    try {
      const result = await repoGc(storage, repoPath, options);
      completeGcOperation(executionId, {
        deletedObjects: BigInt(result.deletedObjects),
        deletedPartials: BigInt(result.deletedPartials),
        retainedObjects: BigInt(result.retainedObjects),
        skippedYoung: BigInt(result.skippedYoung),
        bytesFreed: BigInt(result.bytesFreed),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failGcOperation(executionId, message);
    }
  })();

  // Return 202 Accepted with executionId
  return sendSuccessWithStatus(GcStartResultType, { executionId }, 202);
}

/**
 * Get garbage collection status.
 */
export function getGcStatus(executionId: string): Response {
  if (!hasGcOperation(executionId)) {
    return sendError(GcStatusResultType, variant('internal', {
      message: `GC operation not found: ${executionId}`,
    }));
  }

  const status = getGcOperationStatus(executionId);
  if (!status) {
    return sendError(GcStatusResultType, variant('internal', {
      message: `GC operation not found: ${executionId}`,
    }));
  }

  return sendSuccess(GcStatusResultType, status);
}

