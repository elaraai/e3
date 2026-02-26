/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { urlPathToTreePath } from '@elaraai/e3-types';
import type { StorageBackend } from '@elaraai/e3-core';
import {
  listDatasets,
  listDatasetsRecursive,
  listDatasetsRecursivePaths,
  listDatasetsWithStatus,
  getDataset,
  getDatasetStatus,
  setDataset,
} from '../handlers/datasets.js';

export function createDatasetRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string
) {
  const app = new Hono();

  // GET /api/repos/:repo/workspaces/:ws/datasets - List root fields
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    const list = c.req.query('list') === 'true';
    const recursive = c.req.query('recursive') === 'true';
    const status = c.req.query('status') === 'true';

    if (recursive && !list) {
      return c.json({ error: 'recursive requires list=true' }, 400);
    }

    if (list && recursive && status) return listDatasetsRecursive(storage, repoPath, ws, []);
    if (list && recursive)           return listDatasetsRecursivePaths(storage, repoPath, ws, []);
    if (list && status)              return listDatasetsWithStatus(storage, repoPath, ws, []);

    return listDatasets(storage, repoPath, ws, []);
  });

  // GET /api/repos/:repo/workspaces/:ws/datasets/* - Orthogonal query params
  app.get('/*', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    // Extract the wildcard path
    const fullPath = c.req.path;
    const datasetsPrefix = `/api/repos/${repo}/workspaces/${ws}/datasets/`;
    const pathStr = fullPath.startsWith(datasetsPrefix) ? fullPath.slice(datasetsPrefix.length) : '';
    const treePath = urlPathToTreePath(pathStr);

    const list = c.req.query('list') === 'true';
    const recursive = c.req.query('recursive') === 'true';
    const status = c.req.query('status') === 'true';

    if (recursive && !list) {
      return c.json({ error: 'recursive requires list=true' }, 400);
    }

    if (list && recursive && status) return listDatasetsRecursive(storage, repoPath, ws, treePath);
    if (list && recursive)           return listDatasetsRecursivePaths(storage, repoPath, ws, treePath);
    if (list && status)              return listDatasetsWithStatus(storage, repoPath, ws, treePath);
    if (list)                        return listDatasets(storage, repoPath, ws, treePath);
    if (status)                      return getDatasetStatus(storage, repoPath, ws, treePath);

    return getDataset(storage, repoPath, ws, treePath);
  });

  // PUT /api/repos/:repo/workspaces/:ws/datasets/* - Set dataset value
  app.put('/*', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    // Extract the wildcard path
    const fullPath = c.req.path;
    const datasetsPrefix = `/api/repos/${repo}/workspaces/${ws}/datasets/`;
    const pathStr = fullPath.startsWith(datasetsPrefix) ? fullPath.slice(datasetsPrefix.length) : '';
    const treePath = urlPathToTreePath(pathStr);

    // Body is raw BEAST2
    const buffer = await c.req.arrayBuffer();
    const body = new Uint8Array(buffer);

    return setDataset(storage, repoPath, ws, treePath, body);
  });

  return app;
}
