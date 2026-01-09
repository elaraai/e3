/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { repoGc, packageList, workspaceList } from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { RepositoryStatusType, GcResultType } from '../types.js';

/**
 * Get repository status.
 */
export async function getStatus(
  storage: StorageBackend,
  repoPath: string
): Promise<Response> {
  try {
    // Count objects
    const objectsDir = path.join(repoPath, 'objects');
    let objectCount = 0;
    try {
      const subdirs = await fs.readdir(objectsDir);
      for (const subdir of subdirs) {
        if (subdir.length === 2) {
          const files = await fs.readdir(path.join(objectsDir, subdir));
          objectCount += files.length;
        }
      }
    } catch {
      // objects dir doesn't exist
    }

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
 * Run garbage collection.
 */
export async function runGc(
  storage: StorageBackend,
  repoPath: string,
  options: { dryRun: boolean; minAge?: number }
): Promise<Response> {
  try {
    const result = await repoGc(storage, repoPath, options);
    return sendSuccess(GcResultType, {
      deletedObjects: BigInt(result.deletedObjects),
      deletedPartials: BigInt(result.deletedPartials),
      retainedObjects: BigInt(result.retainedObjects),
      skippedYoung: BigInt(result.skippedYoung),
      bytesFreed: BigInt(result.bytesFreed),
    });
  } catch (err) {
    return sendError(GcResultType, errorToVariant(err));
  }
}
