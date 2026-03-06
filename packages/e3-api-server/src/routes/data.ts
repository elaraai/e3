/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NullType, variant } from '@elaraai/east';
import {
  BEAST2_CONTENT_TYPE,
  ObjectNotFoundError,
  type StorageBackend,
  type TransferBackend,
} from '@elaraai/e3-core';
import { sendError } from '../beast2.js';

const STAGING_DIR = join(tmpdir(), 'e3-transfers');

/**
 * Reject requests that carry an Authorization header.
 *
 * Data endpoints are authenticated by the unguessable transfer UUID in the
 * URL path (capability URL pattern). In cloud deployments these URLs are S3
 * presigned URLs that reject extra auth headers, so the local server enforces
 * the same contract.
 */
function rejectAuthHeader(c: { req: { header(name: string): string | undefined } }): Response | null {
  if (c.req.header('authorization')) {
    return new Response('Authorization header must not be sent to data endpoints', { status: 400 });
  }
  return null;
}

/**
 * Create generic upload/download data endpoints.
 *
 * Returns two Hono apps:
 * - `uploads`: PUT /:id — upload data (dataset BEAST2 or package zip)
 * - `downloads`: GET /:id — download data (dataset BEAST2 or package zip)
 *
 * These are unauthenticated — the UUID in the URL is the sole capability.
 * In cloud deployments, these map directly to S3 presigned URLs.
 */
export function createDataEndpoints(
  transferBackend: TransferBackend,
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
) {
  const uploads = new Hono();
  const downloads = new Hono();

  // PUT /api/uploads/:id — Upload data (dataset BEAST2 or package zip)
  uploads.put('/:id', async (c) => {
    const rejected = rejectAuthHeader(c);
    if (rejected) return rejected;

    const id = c.req.param('id')!;

    // Try dataset upload first
    const dsRecord = await transferBackend.datasetUpload.get(id);
    if (dsRecord) {
      const stagingPath = join(STAGING_DIR, `${id}.beast2.partial`);
      const body = new Uint8Array(await c.req.arrayBuffer());
      await mkdir(STAGING_DIR, { recursive: true });
      await writeFile(stagingPath, body);
      return new Response(null, { status: 200 });
    }

    // Try package import
    const pkgRecord = await transferBackend.packageImport.get(id);
    if (pkgRecord) {
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (BigInt(body.byteLength) !== pkgRecord.size) {
        await transferBackend.packageImport.delete(id);
        return sendError(NullType, variant('internal', {
          message: `size mismatch: expected ${pkgRecord.size}, got ${body.byteLength}`,
        }));
      }

      const stagingPath = join(STAGING_DIR, `${id}.zip.partial`);
      await mkdir(STAGING_DIR, { recursive: true });
      await writeFile(stagingPath, body);
      return new Response(null, { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  });

  // GET /api/downloads/:id — Download data (dataset BEAST2 or package zip)
  downloads.get('/:id', async (c) => {
    const rejected = rejectAuthHeader(c);
    if (rejected) return rejected;

    const id = c.req.param('id')!;

    // Try dataset download
    const dsRecord = await transferBackend.datasetDownload.get(id);
    if (dsRecord) {
      const repoPath = getRepoPath(dsRecord.repo);
      try {
        const data = await storage.objects.read(repoPath, dsRecord.hash);
        await transferBackend.datasetDownload.delete(id);
        return new Response(data, {
          headers: {
            'Content-Type': BEAST2_CONTENT_TYPE,
            'Content-Length': String(data.byteLength),
            'X-Content-SHA256': dsRecord.hash,
          },
        });
      } catch (err) {
        await transferBackend.datasetDownload.delete(id);
        if (err instanceof ObjectNotFoundError) {
          return new Response('Not found', { status: 404 });
        }
        throw err;
      }
    }

    // Try package export
    const pkgRecord = await transferBackend.packageExport.get(id);
    if (pkgRecord && pkgRecord.status.type === 'completed') {
      const stagingPath = join(STAGING_DIR, `${id}.zip`);
      try {
        const fileData = await readFile(stagingPath);
        await unlink(stagingPath).catch(() => {});
        await transferBackend.packageExport.delete(id);

        return new Response(fileData, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Length': String(fileData.byteLength),
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }

    return new Response('Not found', { status: 404 });
  });

  return { uploads, downloads };
}
