/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Hono } from 'hono';
import { ArrayType, BlobType, NullType, some, none } from '@elaraai/east';
import { WorkspaceStateType, parsePackageRef } from '@elaraai/e3-types';
import {
  workspaceList,
  workspaceCreate,
  workspaceRemove,
  workspaceGetState,
  workspaceDeploy,
  workspaceExport,
  packageGetLatestVersion,
} from '@elaraai/e3-core';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { WorkspaceInfoType, CreateWorkspaceType, DeployRequestType } from '../types.js';

export function createWorkspaceRoutes(repoPath: string) {
  const app = new Hono();

  // GET /api/workspaces - List all workspaces
  app.get('/', async (c) => {
    try {
      const workspaces = await workspaceList(repoPath);
      const result = await Promise.all(
        workspaces.map(async (name) => {
          const state = await workspaceGetState(repoPath, name);
          if (state) {
            return {
              name,
              deployed: true,
              packageName: some(state.packageName),
              packageVersion: some(state.packageVersion),
            };
          } else {
            return {
              name,
              deployed: false,
              packageName: none,
              packageVersion: none,
            };
          }
        })
      );
      return sendSuccess(c, ArrayType(WorkspaceInfoType), result);
    } catch (err) {
      return sendError(c, ArrayType(WorkspaceInfoType), errorToVariant(err));
    }
  });

  // POST /api/workspaces - Create a new workspace
  app.post('/', async (c) => {
    try {
      const body = await decodeBody(c, CreateWorkspaceType);
      await workspaceCreate(repoPath, body.name);
      return sendSuccess(c, WorkspaceInfoType, {
        name: body.name,
        deployed: false,
        packageName: none,
        packageVersion: none,
      });
    } catch (err) {
      return sendError(c, WorkspaceInfoType, errorToVariant(err));
    }
  });

  // GET /api/workspaces/:name - Get workspace state
  app.get('/:name', async (c) => {
    try {
      const name = c.req.param('name');
      const state = await workspaceGetState(repoPath, name);
      if (!state) {
        // Workspace exists but not deployed - return error
        return sendError(c, WorkspaceStateType, errorToVariant(new Error(`Workspace '${name}' is not deployed`)));
      }
      return sendSuccess(c, WorkspaceStateType, state);
    } catch (err) {
      return sendError(c, WorkspaceStateType, errorToVariant(err));
    }
  });

  // DELETE /api/workspaces/:name - Remove a workspace
  app.delete('/:name', async (c) => {
    try {
      const name = c.req.param('name');
      await workspaceRemove(repoPath, name);
      return sendSuccess(c, NullType, null);
    } catch (err) {
      return sendError(c, NullType, errorToVariant(err));
    }
  });

  // POST /api/workspaces/:name/deploy - Deploy a package to a workspace
  app.post('/:name/deploy', async (c) => {
    try {
      const name = c.req.param('name');
      if (!name) {
        return sendError(c, NullType, errorToVariant(new Error('Missing workspace name parameter')));
      }
      const body = await decodeBody(c, DeployRequestType);

      const { name: pkgName, version: maybeVersion } = parsePackageRef(body.packageRef);
      const pkgVersion = maybeVersion ?? await packageGetLatestVersion(repoPath, pkgName);
      if (!pkgVersion) {
        return sendError(c, NullType, errorToVariant(new Error(`Package not found: ${pkgName}`)));
      }

      await workspaceDeploy(repoPath, name, pkgName, pkgVersion);
      return sendSuccess(c, NullType, null);
    } catch (err) {
      return sendError(c, NullType, errorToVariant(err));
    }
  });

  // GET /api/workspaces/:name/export - Export workspace as a package zip
  app.get('/:name/export', async (c) => {
    try {
      const name = c.req.param('name');
      if (!name) {
        return sendError(c, BlobType, errorToVariant(new Error('Missing workspace name parameter')));
      }

      // Export to temp file
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e3-ws-export-'));
      const tempPath = path.join(tempDir, 'workspace.zip');
      try {
        await workspaceExport(repoPath, name, tempPath);
        const archive = await fs.readFile(tempPath);
        return sendSuccess(c, BlobType, new Uint8Array(archive));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      return sendError(c, BlobType, errorToVariant(err));
    }
  });

  return app;
}
