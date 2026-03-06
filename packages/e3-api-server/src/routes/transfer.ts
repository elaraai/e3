/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { variant, NullType } from '@elaraai/east';
import { urlPathToTreePath } from '@elaraai/e3-types';
import {
  computeHash,
  workspaceSetDatasetByHash,
  type StorageBackend,
  type TransferBackend,
} from '@elaraai/e3-core';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { TransferUploadRequestType, TransferUploadResponseType, TransferDoneResponseType } from '../types.js';

const STAGING_DIR = join(tmpdir(), 'e3-transfers');

/**
 * Create dataset transfer routes.
 *
 * Returns an `api` Hono app with authenticated routes (init upload, commit)
 * mounted at /api/repos/:repo/workspaces/:ws/datasets.
 *
 * Unauthenticated data routes (upload/download bytes) are handled by the
 * generic data endpoints in `data.ts`.
 */
export function createTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
) {
  const api = new Hono();

  /**
   * Extract dataset path from the request URL wildcard.
   * The route is mounted at /api/repos/:repo/workspaces/:ws/datasets
   * so a request to .../datasets/inputs/config/upload yields path "inputs/config".
   */
  function extractDatasetPath(c: { req: { path: string; param(name: string): string | undefined } }, suffix: string): string {
    const fullPath = c.req.path;
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    const datasetsPrefix = `/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(ws)}/datasets/`;
    let pathStr = fullPath.startsWith(datasetsPrefix) ? fullPath.slice(datasetsPrefix.length) : '';
    // Strip trailing suffix (e.g. "/upload" or "/upload/<id>")
    if (pathStr.endsWith(suffix)) {
      pathStr = pathStr.slice(0, -suffix.length);
    }
    // Remove trailing slash
    if (pathStr.endsWith('/')) {
      pathStr = pathStr.slice(0, -1);
    }
    return pathStr;
  }

  // =========================================================================
  // Authenticated API routes (mounted at /api/repos/:repo/workspaces/:ws/datasets)
  // =========================================================================

  // POST routes use catch-all wildcard and dispatch based on URL suffix:
  // - .../datasets/<path>/upload          → init transfer
  // - .../datasets/<path>/upload/<id>     → commit transfer
  api.post('/*', async (c) => {
    const fullPath = c.req.path;

    // Check for commit: .../upload/<uuid>
    const commitMatch = fullPath.match(/\/upload\/([0-9a-f-]{36})$/);
    if (commitMatch) {
      return handleCommit(c, commitMatch[1]);
    }

    // Check for init: .../upload
    if (fullPath.endsWith('/upload')) {
      return handleInit(c);
    }

    // Not a transfer route — return 404
    return new Response('Not found', { status: 404 });
  });

  async function handleInit(c: Context) {
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    const repoPath = getRepoPath(repo);
    const pathStr = extractDatasetPath(c, '/upload');
    const { hash, size } = await decodeBody(c, TransferUploadRequestType);

    // Dedup check — object already verified when originally stored
    if (await storage.objects.exists(repoPath, hash)) {
      const treePath = urlPathToTreePath(pathStr);
      await workspaceSetDatasetByHash(storage, repoPath, ws, treePath, hash, new Map());
      return sendSuccess(TransferUploadResponseType, variant('completed', null));
    }

    // Create transfer record in backend
    const transferId = randomUUID();
    await transferBackend.datasetUpload.create(transferId, { repo, workspace: ws, path: pathStr, hash, size });

    // Create staging slot in OS temp dir
    await mkdir(STAGING_DIR, { recursive: true });

    const uploadUrl = await transferBackend.datasetUpload.getUploadUrl(transferId, repo, hash);
    // Resolve relative URL against the request origin
    const origin = new URL(c.req.url).origin;
    const resolvedUrl = uploadUrl.startsWith('/') ? `${origin}${uploadUrl}` : uploadUrl;
    return sendSuccess(TransferUploadResponseType, variant('upload', { id: transferId, uploadUrl: resolvedUrl }));
  }

  async function handleCommit(c: Context, id: string) {
    const transfer = await transferBackend.datasetUpload.get(id);
    if (!transfer) {
      return sendError(NullType, variant('internal', { message: 'transfer not found' }));
    }

    const repoPath = getRepoPath(transfer.repo);
    const stagingPath = join(STAGING_DIR, `${id}.beast2.partial`);

    try {
      // Read from staging to verify size and hash
      const data = await readFile(stagingPath);

      if (BigInt(data.byteLength) !== transfer.size) {
        await unlink(stagingPath).catch(() => {});
        return sendSuccess(TransferDoneResponseType,
          variant('error', { message: `size mismatch: expected ${transfer.size}, got ${data.byteLength}` }));
      }

      const actualHash = computeHash(data);

      if (actualHash !== transfer.hash) {
        await unlink(stagingPath).catch(() => {});
        return sendSuccess(TransferDoneResponseType,
          variant('error', { message: `hash mismatch: expected ${transfer.hash}, got ${actualHash}` }));
      }

      // Write through storage abstraction (re-hashes internally, that's fine)
      await storage.objects.write(repoPath, data);
      await unlink(stagingPath).catch(() => {});

      // Update dataset ref
      const treePath = urlPathToTreePath(transfer.path);
      await workspaceSetDatasetByHash(storage, repoPath, transfer.workspace, treePath, actualHash, new Map());

      return sendSuccess(TransferDoneResponseType, variant('completed', null));
    } finally {
      await transferBackend.datasetUpload.delete(id);
    }
  }

  return { api };
}
