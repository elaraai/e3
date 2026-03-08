/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { mkdir, stat as fsStat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { variant, some } from '@elaraai/east';
import type { StorageBackend, TransferBackend } from '@elaraai/e3-core';
import {
  workspaceExport,
  workspaceGetState,
} from '@elaraai/e3-core';
import { PackageJobResponseType } from '@elaraai/e3-types';
import {
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  getWorkspaceStatus,
  deleteWorkspace,
  deployWorkspace,
  exportWorkspace,
} from '../handlers/workspaces.js';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { CreateWorkspaceType, DeployRequestType, WorkspaceExportRequestType } from '../types.js';

export function createWorkspaceRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend?: TransferBackend,
) {
  const app = new Hono();

  // GET /api/repos/:repo/workspaces - List all workspaces
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    return listWorkspaces(storage, repoPath);
  });

  // POST /api/repos/:repo/workspaces - Create a new workspace
  app.post('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const body = await decodeBody(c, CreateWorkspaceType);
    return createWorkspace(storage, repoPath, body.name);
  });

  // GET /api/repos/:repo/workspaces/:ws - Get workspace state
  app.get('/:ws', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return getWorkspace(storage, repoPath, ws);
  });

  // GET /api/repos/:repo/workspaces/:ws/status - Get comprehensive workspace status
  app.get('/:ws/status', (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return getWorkspaceStatus(storage, repoPath, ws);
  });

  // DELETE /api/repos/:repo/workspaces/:ws - Remove a workspace
  app.delete('/:ws', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return deleteWorkspace(storage, repoPath, ws);
  });

  // POST /api/repos/:repo/workspaces/:ws/deploy - Deploy a package to a workspace
  app.post('/:ws/deploy', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    const body = await decodeBody(c, DeployRequestType);
    return deployWorkspace(storage, repoPath, ws, body.packageRef);
  });

  // POST /api/repos/:repo/workspaces/:ws/export - Trigger async workspace export
  if (transferBackend) {
    app.post('/:ws/export', async (c) => {
      const repo = c.req.param('repo')!;
      const repoPath = getRepoPath(repo);
      const ws = c.req.param('ws')!;

      // Determine name and version from request body or deployed package
      let requestName: string | undefined;
      let requestVersion: string | undefined;
      try {
        const body = await decodeBody(c, WorkspaceExportRequestType);
        if (body.name?.type === 'some') requestName = body.name.value;
        if (body.version?.type === 'some') requestVersion = body.version.value;
      } catch {
        // No body or invalid — use defaults
      }

      const state = await workspaceGetState(storage, repoPath, ws);
      if (!state) {
        return sendError(PackageJobResponseType, variant('internal', { message: 'workspace not found or not deployed' }));
      }

      const exportName = requestName ?? state.packageName;
      const exportVersion = requestVersion ?? `${state.packageVersion}-${Date.now().toString(36)}`;

      const id = randomUUID();
      await transferBackend.packageExport.create(id, {
        repo,
        name: exportName,
        version: exportVersion,
        workspace: some(ws),
        status: variant('processing', variant('pending', null)),
        createdAt: new Date(),
      });

      const STAGING_DIR = join(tmpdir(), 'e3-transfers');
      await mkdir(STAGING_DIR, { recursive: true });
      const zipPath = join(STAGING_DIR, `${id}.zip`);

      try {
        await workspaceExport(storage, repoPath, ws, zipPath, exportName, exportVersion);
        const fileStat = await fsStat(zipPath);
        await transferBackend.packageExport.updateStatus(id, variant('completed', {
          size: BigInt(fileStat.size),
        }));
      } catch (err) {
        await unlink(zipPath).catch(() => {});
        const message = err instanceof Error ? err.message : String(err);
        await transferBackend.packageExport.updateStatus(id, variant('failed', { message }));
      }

      return sendSuccess(PackageJobResponseType, { id });
    });
  }

  // GET /api/repos/:repo/workspaces/:ws/export - Export workspace as a package zip
  app.get('/:ws/export', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return exportWorkspace(storage, repoPath, ws);
  });

  return app;
}
