/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Hono } from 'hono';
import { repoGc, packageList, workspaceList } from '@elaraai/e3-core';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { RepositoryStatusType, GcRequestType, GcResultType } from '../types.js';

export function createRepositoryRoutes(repoPath: string) {
  const app = new Hono();

  // GET /api/status - Get repository status
  app.get('/status', async (c) => {
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
      const packages = await packageList(repoPath);
      const workspaces = await workspaceList(repoPath);

      const status = {
        path: repoPath,
        objectCount: BigInt(objectCount),
        packageCount: BigInt(packages.length),
        workspaceCount: BigInt(workspaces.length),
      };
      return sendSuccess(c, RepositoryStatusType, status);
    } catch (err) {
      return sendError(c, RepositoryStatusType, errorToVariant(err));
    }
  });

  // POST /api/gc - Run garbage collection
  app.post('/gc', async (c) => {
    try {
      const options = await decodeBody(c, GcRequestType);
      const minAge = options.minAge?.type === 'some' ? Number(options.minAge.value) : undefined;
      const result = await repoGc(repoPath, { dryRun: options.dryRun, minAge });
      return sendSuccess(c, GcResultType, {
        deletedObjects: BigInt(result.deletedObjects),
        deletedPartials: BigInt(result.deletedPartials),
        retainedObjects: BigInt(result.retainedObjects),
        skippedYoung: BigInt(result.skippedYoung),
        bytesFreed: BigInt(result.bytesFreed),
      });
    } catch (err) {
      return sendError(c, GcResultType, errorToVariant(err));
    }
  });

  return app;
}
