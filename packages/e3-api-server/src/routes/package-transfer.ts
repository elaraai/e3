/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { variant, none } from '@elaraai/east';
import { packageResolve, PackageNotFoundError } from '@elaraai/e3-core';
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

    const uploadUrl = await transferBackend.packageImport.getUploadUrl(transferId, repo);
    // Resolve relative URL against the request origin
    const origin = new URL(c.req.url).origin;
    const resolvedUrl = uploadUrl.startsWith('/') ? `${origin}${uploadUrl}` : uploadUrl;
    return sendSuccess(PackageTransferInitResponseType, { id: transferId, uploadUrl: resolvedUrl });
  });

  // POST /api/repos/:repo/import/:id — Trigger import processing
  repoApi.post('/import/:id', async (c) => {
    const id = c.req.param('id')!;
    const record = await transferBackend.packageImport.get(id);
    if (!record) {
      return sendError(PackageJobResponseType, variant('internal', { message: 'transfer not found' }));
    }

    if (record.status.type === 'completed' || record.status.type === 'failed') {
      return sendSuccess(PackageJobResponseType, { id });
    }

    if (record.status.type === 'created') {
      return sendError(PackageJobResponseType, variant('internal', {
        message: 'Upload not yet received',
      }));
    }

    await transferBackend.packageImport.execute(id, record.repo);
    return sendSuccess(PackageJobResponseType, { id });
  });

  // GET /api/repos/:repo/import/:id — Poll import status
  repoApi.get('/import/:id', async (c) => {
    const id = c.req.param('id')!;

    const record = await transferBackend.packageImport.get(id);
    if (!record) {
      return sendError(PackageImportStatusType, variant('internal', { message: 'import job not found' }));
    }

    const status = record.status;
    if (status.type === 'processing') {
      return sendSuccess(PackageImportStatusType, variant('processing', status.value));
    }
    if (status.type === 'created' || status.type === 'uploaded') {
      return sendSuccess(PackageImportStatusType, variant('processing', variant('pending', null)));
    }
    if (status.type === 'failed') {
      return sendSuccess(PackageImportStatusType, variant('failed', { message: status.value.message }));
    }
    if (status.type === 'completed') {
      return sendSuccess(PackageImportStatusType, variant('completed', status.value));
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

    const status = record.status;
    if (status.type === 'processing') {
      return sendSuccess(PackageExportStatusType, variant('processing', status.value));
    }
    if (status.type === 'failed') {
      return sendSuccess(PackageExportStatusType, variant('failed', { message: status.value.message }));
    }
    if (status.type === 'completed') {
      const downloadUrl = await transferBackend.packageExport.getDownloadUrl(id, record.repo);
      // Resolve relative URL against the request origin
      const origin = new URL(c.req.url).origin;
      const resolvedUrl = downloadUrl.startsWith('/') ? `${origin}${downloadUrl}` : downloadUrl;
      return sendSuccess(PackageExportStatusType, variant('completed', {
        downloadUrl: resolvedUrl,
        size: status.value.size,
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

    // Pre-flight: verify package exists before creating job
    try {
      await packageResolve(storage, repoPath, name, version);
    } catch (err) {
      if (err instanceof PackageNotFoundError) {
        return sendError(PackageJobResponseType, errorToVariant(err));
      }
      throw err;
    }

    const id = randomUUID();
    await transferBackend.packageExport.create(id, {
      repo,
      name,
      version,
      workspace: none,
      status: variant('processing', variant('pending', null)),
      createdAt: new Date(),
    });

    await transferBackend.packageExport.execute(id, repo);
    return sendSuccess(PackageJobResponseType, { id });
  });

  return { repoApi, pkgApi };
}
