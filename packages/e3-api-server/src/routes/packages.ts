/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import type { StorageBackend } from '@elaraai/e3-core';
import {
  listPackages,
  getPackage,
  deletePackage,
} from '../handlers/packages.js';

export function createPackageRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string
) {
  const app = new Hono();

  // GET /api/repos/:repo/packages - List all packages
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    return listPackages(storage, repoPath);
  });

  // GET /api/repos/:repo/packages/:name/:version - Get package details
  app.get('/:name/:version', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const name = c.req.param('name')!;
    const version = c.req.param('version')!;
    return getPackage(storage, repoPath, name, version);
  });

  // DELETE /api/repos/:repo/packages/:name/:version - Remove a package
  app.delete('/:name/:version', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const name = c.req.param('name')!;
    const version = c.req.param('version')!;
    return deletePackage(storage, repoPath, name, version);
  });

  return app;
}
