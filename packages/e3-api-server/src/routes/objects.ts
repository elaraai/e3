/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { NullType, variant } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, ObjectNotFoundError, type StorageBackend } from '@elaraai/e3-core';
import { sendError } from '../beast2.js';

export function createObjectRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string
) {
  const app = new Hono();

  // GET /api/repos/:repo/objects/:hash — Read object by hash
  app.get('/:hash', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const hash = c.req.param('hash')!;

    try {
      const data = await storage.objects.read(repoPath, hash);
      return new Response(data, {
        headers: {
          'Content-Type': BEAST2_CONTENT_TYPE,
          'Content-Length': String(data.byteLength),
          'X-Content-SHA256': hash,
        },
      });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        return sendError(NullType, variant('object_not_found', { hash }));
      }
      throw err;
    }
  });

  return app;
}
