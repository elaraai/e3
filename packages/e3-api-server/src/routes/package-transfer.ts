/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { NullType, variant } from '@elaraai/east';
import {
  packageImport,
  packageExport,
} from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import {
  PackageTransferInitRequestType,
  PackageTransferInitResponseType,
  PackageExportRequestType,
  PackageJobResponseType,
  PackageJobStatusType,
} from '@elaraai/e3-types';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';

interface PackageTransferRecord {
  repoPath: string;
  size: bigint;
  stagingPath: string;
}

interface PackageJobRecord {
  type: 'import' | 'export';
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export function createPackageTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string
) {
  const app = new Hono();

  const transfers = new Map<string, PackageTransferRecord>();
  const jobs = new Map<string, PackageJobRecord>();

  // POST /api/repos/:repo/packages/transfer/upload — Init upload
  app.post('/upload', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const { size } = await decodeBody(c, PackageTransferInitRequestType);

    const transferId = randomUUID();
    const stagingDir = join(tmpdir(), 'e3-transfers');
    await mkdir(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, `${transferId}.zip.partial`);
    transfers.set(transferId, { repoPath, size, stagingPath });

    const origin = new URL(c.req.url).origin;
    const uploadUrl = `${origin}/api/repos/${encodeURIComponent(repo)}/packages/transfer/${transferId}/data`;
    return sendSuccess(PackageTransferInitResponseType, { transferId, uploadUrl });
  });

  // PUT /api/repos/:repo/packages/transfer/:id/data — Upload zip to staging
  app.put('/:id/data', async (c) => {
    const id = c.req.param('id')!;
    const transfer = transfers.get(id);
    if (!transfer) {
      return sendError(NullType, variant('internal', { message: 'transfer not found' }));
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (BigInt(body.byteLength) !== transfer.size) {
      transfers.delete(id);
      return sendError(NullType, variant('internal', {
        message: `size mismatch: expected ${transfer.size}, got ${body.byteLength}`,
      }));
    }

    await writeFile(transfer.stagingPath, body);
    return sendSuccess(NullType, null);
  });

  // POST /api/repos/:repo/packages/transfer/:id/import — Trigger import
  app.post('/:id/import', async (c) => {
    const id = c.req.param('id')!;
    const transfer = transfers.get(id);
    if (!transfer) {
      return sendError(PackageJobResponseType, variant('internal', { message: 'transfer not found' }));
    }

    const jobId = randomUUID();

    try {
      const result = await packageImport(storage, transfer.repoPath, transfer.stagingPath);
      jobs.set(jobId, {
        type: 'import',
        status: 'completed',
        result: variant('import', {
          name: result.name,
          version: result.version,
          packageHash: result.packageHash,
          objectCount: BigInt(result.objectCount),
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jobs.set(jobId, { type: 'import', status: 'failed', error: message });
    } finally {
      await unlink(transfer.stagingPath).catch(() => {});
      transfers.delete(id);
    }

    return sendSuccess(PackageJobResponseType, { jobId });
  });

  // POST /api/repos/:repo/packages/transfer/export — Trigger export
  app.post('/export', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const { name, version } = await decodeBody(c, PackageExportRequestType);

    const jobId = randomUUID();
    const stagingDir = join(tmpdir(), 'e3-transfers');
    await mkdir(stagingDir, { recursive: true });
    const downloadPath = join(stagingDir, `${jobId}.zip`);

    try {
      await packageExport(storage, repoPath, name, version, downloadPath);
      const fileStat = await stat(downloadPath);

      const origin = new URL(c.req.url).origin;
      const downloadUrl = `${origin}/api/repos/${encodeURIComponent(repo)}/packages/transfer/download/${jobId}`;

      jobs.set(jobId, {
        type: 'export',
        status: 'completed',
        result: variant('export', {
          downloadUrl,
          size: BigInt(fileStat.size),
        }),
      });
    } catch (err) {
      await unlink(downloadPath).catch(() => {});
      if (err instanceof Error && err.message.includes('not found')) {
        return sendError(PackageJobResponseType, errorToVariant(err));
      }
      const message = err instanceof Error ? err.message : String(err);
      jobs.set(jobId, { type: 'export', status: 'failed', error: message });
    }

    return sendSuccess(PackageJobResponseType, { jobId });
  });

  // GET /api/repos/:repo/packages/transfer/jobs/:jobId — Poll job status
  app.get('/jobs/:jobId', (c) => {
    const jobId = c.req.param('jobId')!;
    const job = jobs.get(jobId);
    if (!job) {
      return sendError(PackageJobStatusType, variant('internal', { message: 'job not found' }));
    }

    if (job.status === 'processing') {
      return sendSuccess(PackageJobStatusType, variant('processing', null));
    }

    if (job.status === 'failed') {
      return sendSuccess(PackageJobStatusType, variant('failed', { message: job.error! }));
    }

    return sendSuccess(PackageJobStatusType, variant('completed', job.result));
  });

  // GET /api/repos/:repo/packages/transfer/download/:jobId — Download export zip
  app.get('/download/:jobId', async (c) => {
    const jobId = c.req.param('jobId')!;
    const stagingPath = join(tmpdir(), 'e3-transfers', `${jobId}.zip`);

    try {
      const data = await readFile(stagingPath);
      await unlink(stagingPath).catch(() => {});
      jobs.delete(jobId);

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(data.byteLength),
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  return app;
}
