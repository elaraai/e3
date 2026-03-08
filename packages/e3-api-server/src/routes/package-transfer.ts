/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { mkdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { variant } from '@elaraai/east';
import {
  packageImport,
  packageExport,
  PackageNotFoundError,
} from '@elaraai/e3-core';
import type { StorageBackend, TransferBackend } from '@elaraai/e3-core';
import {
  PackageTransferInitRequestType,
  PackageTransferInitResponseType,
  PackageJobResponseType,
  PackageImportStatusType,
  PackageExportStatusType,
} from '@elaraai/e3-types';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';

const STAGING_DIR = join(tmpdir(), 'e3-transfers');

/**
 * Create package transfer routes.
 *
 * Returns two Hono apps:
 * - `repoApi`: Authenticated routes at repo level — mount at /api/repos/:repo
 *   (POST /import, POST /import/:id, GET /import/:id, GET /export/:id)
 * - `pkgApi`: Authenticated routes at package level — mount at /api/repos/:repo/packages
 *   (POST /:name/:version/export)
 *
 * Unauthenticated data routes (upload/download bytes) are handled by the
 * generic data endpoints in `data.ts`.
 */
export function createPackageTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
) {
  const repoApi = new Hono();
  const pkgApi = new Hono();

  const MAX_PACKAGE_SIZE = 5n * 1024n * 1024n * 1024n; // 5 GB

  // =========================================================================
  // Repo-level routes (mounted at /api/repos/:repo)
  // =========================================================================

  // POST /api/repos/:repo/import — Init import
  repoApi.post('/import', async (c) => {
    const repo = c.req.param('repo')!;
    const { size } = await decodeBody(c, PackageTransferInitRequestType);

    if (size <= 0n || size > MAX_PACKAGE_SIZE) {
      return sendError(PackageTransferInitResponseType, variant('internal', {
        message: `Invalid size: must be between 1 and ${MAX_PACKAGE_SIZE} bytes`,
      }));
    }

    const transferId = randomUUID();
    await transferBackend.packageImport.create(transferId, {
      repo,
      size,
      status: variant('created', null),
      createdAt: new Date(),
    });

    await mkdir(STAGING_DIR, { recursive: true });

    const uploadUrl = await transferBackend.packageImport.getUploadUrl(transferId, repo);
    // Resolve relative URL against the request origin
    const origin = new URL(c.req.url).origin;
    const resolvedUrl = uploadUrl.startsWith('/') ? `${origin}${uploadUrl}` : uploadUrl;
    return sendSuccess(PackageTransferInitResponseType, { id: transferId, uploadUrl: resolvedUrl });
  });

  // POST /api/repos/:repo/import/:id — Trigger import
  repoApi.post('/import/:id', async (c) => {
    const id = c.req.param('id')!;
    const record = await transferBackend.packageImport.get(id);
    if (!record) {
      return sendError(PackageJobResponseType, variant('internal', { message: 'transfer not found' }));
    }

    const repoPath = getRepoPath(record.repo);
    const stagingPath = join(STAGING_DIR, `${id}.zip.partial`);

    try {
      // Verify staging file exists before attempting import
      await stat(stagingPath);
    } catch {
      await transferBackend.packageImport.delete(id);
      return sendError(PackageJobResponseType, variant('internal', {
        message: 'Upload file not found — upload may have failed or been rejected',
      }));
    }

    try {
      const result = await packageImport(storage, repoPath, stagingPath);
      await transferBackend.packageImport.updateStatus(id, variant('completed', {
        name: result.name,
        version: result.version,
        packageHash: result.packageHash,
        objectCount: BigInt(result.objectCount),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await transferBackend.packageImport.updateStatus(id, variant('failed', { message }));
    } finally {
      await unlink(stagingPath).catch(() => {});
    }

    return sendSuccess(PackageJobResponseType, { id });
  });

  // GET /api/repos/:repo/import/:id — Poll import status
  repoApi.get('/import/:id', async (c) => {
    const id = c.req.param('id')!;

    const record = await transferBackend.packageImport.get(id);
    if (!record) {
      return sendError(PackageImportStatusType, variant('internal', { message: 'import job not found' }));
    }

    const { type, value } = record.status;
    if (type === 'processing' || type === 'created' || type === 'uploaded') {
      return sendSuccess(PackageImportStatusType, variant('processing', null));
    }
    if (type === 'failed') {
      return sendSuccess(PackageImportStatusType, variant('failed', { message: (value as { message: string }).message }));
    }
    if (type === 'completed') {
      return sendSuccess(PackageImportStatusType, variant('completed', value as {
        name: string;
        version: string;
        packageHash: string;
        objectCount: bigint;
      }));
    }

    return sendError(PackageImportStatusType, variant('internal', { message: 'unknown status' }));
  });

  // GET /api/repos/:repo/export/:id — Poll export status
  repoApi.get('/export/:id', async (c) => {
    const id = c.req.param('id')!;

    const record = await transferBackend.packageExport.get(id);
    if (!record) {
      return sendError(PackageExportStatusType, variant('internal', { message: 'export job not found' }));
    }

    const { type, value } = record.status;
    if (type === 'processing') {
      return sendSuccess(PackageExportStatusType, variant('processing', null));
    }
    if (type === 'failed') {
      return sendSuccess(PackageExportStatusType, variant('failed', { message: (value as { message: string }).message }));
    }
    if (type === 'completed') {
      const downloadUrl = await transferBackend.packageExport.getDownloadUrl(id, record.repo);
      // Resolve relative URL against the request origin
      const origin = new URL(c.req.url).origin;
      const resolvedUrl = downloadUrl.startsWith('/') ? `${origin}${downloadUrl}` : downloadUrl;
      return sendSuccess(PackageExportStatusType, variant('completed', {
        downloadUrl: resolvedUrl,
        size: (value as { size: bigint }).size,
      }));
    }

    return sendError(PackageExportStatusType, variant('internal', { message: 'unknown status' }));
  });

  // =========================================================================
  // Package-level routes (mounted at /api/repos/:repo/packages)
  // =========================================================================

  // POST /api/repos/:repo/packages/:name/:version/export — Trigger export
  pkgApi.post('/:name/:version/export', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const name = c.req.param('name')!;
    const version = c.req.param('version')!;

    const id = randomUUID();
    await transferBackend.packageExport.create(id, {
      repo,
      name,
      version,
      status: variant('processing', null),
      createdAt: new Date(),
    });

    await mkdir(STAGING_DIR, { recursive: true });
    const zipPath = join(STAGING_DIR, `${id}.zip`);

    try {
      await packageExport(storage, repoPath, name, version, zipPath);
      const fileStat = await stat(zipPath);
      await transferBackend.packageExport.updateStatus(id, variant('completed', {
        size: BigInt(fileStat.size),
      }));
    } catch (err) {
      await unlink(zipPath).catch(() => {});
      if (err instanceof PackageNotFoundError) {
        return sendError(PackageJobResponseType, errorToVariant(err));
      }
      const message = err instanceof Error ? err.message : String(err);
      await transferBackend.packageExport.updateStatus(id, variant('failed', { message }));
    }

    return sendSuccess(PackageJobResponseType, { id });
  });

  return { repoApi, pkgApi };
}
