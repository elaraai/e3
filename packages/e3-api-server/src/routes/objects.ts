/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { BEAST2_CONTENT_TYPE, ObjectNotFoundError, type StorageBackend } from '@elaraai/e3-core';
import { sendJsonError } from '../errors.js';

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

    if (!/^[a-f0-9]{64}$/.test(hash)) {
      return new Response(JSON.stringify({ error: { type: 'bad_request', message: `invalid hash format: ${hash}` } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
      return sendJsonError(err);
    }
  });

  return app;
}
