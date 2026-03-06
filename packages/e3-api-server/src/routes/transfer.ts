/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { variant, NullType } from '@elaraai/east';
import { urlPathToTreePath } from '@elaraai/e3-types';
import {
  computeHash,
  workspaceSetDatasetByHash,
  type StorageBackend,
} from '@elaraai/e3-core';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { TransferUploadRequestType, TransferUploadResponseType, TransferDoneResponseType } from '../types.js';

interface TransferRecord {
  repoPath: string;
  workspace: string;
  path: string;
  hash: string;
  size: bigint;
  stagingPath: string;
}

export function createTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string
) {
  const app = new Hono();

  // In-memory transfer records (scoped to route factory closure)
  const transfers = new Map<string, TransferRecord>();

  // POST /api/repos/:repo/transfer/upload — Init transfer
  app.post('/upload', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const { workspace, path, hash, size } = await decodeBody(c, TransferUploadRequestType);

    // Dedup check — object already verified when originally stored
    if (await storage.objects.exists(repoPath, hash)) {
      const treePath = urlPathToTreePath(path);
      await workspaceSetDatasetByHash(storage, repoPath, workspace, treePath, hash, new Map());
      return sendSuccess(TransferUploadResponseType, variant('completed', null));
    }

    // Create staging slot in OS temp dir
    const transferId = randomUUID();
    const stagingDir = join(tmpdir(), 'e3-transfers');
    await mkdir(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, `${transferId}.beast2.partial`);
    transfers.set(transferId, { repoPath, workspace, path, hash, size, stagingPath });

    const origin = new URL(c.req.url).origin;
    const uploadUrl = `${origin}/api/repos/${encodeURIComponent(repo)}/transfer/${transferId}/data`;
    return sendSuccess(TransferUploadResponseType, variant('upload', { transferId, uploadUrl }));
  });

  // PUT /api/repos/:repo/transfer/:id/data — Receive upload to staging
  app.put('/:id/data', async (c) => {
    const id = c.req.param('id')!;
    const transfer = transfers.get(id);
    if (!transfer) {
      return sendError(NullType, variant('internal', { message: 'transfer not found' }));
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    await writeFile(transfer.stagingPath, body);
    return sendSuccess(NullType, null);
  });

  // POST /api/repos/:repo/transfer/:id/done — Verify hash, atomic move, update ref
  app.post('/:id/done', async (c) => {
    const id = c.req.param('id')!;
    const transfer = transfers.get(id);
    if (!transfer) {
      return sendError(NullType, variant('internal', { message: 'transfer not found' }));
    }

    try {
      // Read from staging to verify size and hash
      const data = await readFile(transfer.stagingPath);

      if (BigInt(data.byteLength) !== transfer.size) {
        await unlink(transfer.stagingPath).catch(() => {});
        return sendSuccess(TransferDoneResponseType,
          variant('error', { message: `size mismatch: expected ${transfer.size}, got ${data.byteLength}` }));
      }

      const actualHash = computeHash(data);

      if (actualHash !== transfer.hash) {
        await unlink(transfer.stagingPath).catch(() => {});
        return sendSuccess(TransferDoneResponseType,
          variant('error', { message: `hash mismatch: expected ${transfer.hash}, got ${actualHash}` }));
      }

      // Write through storage abstraction (re-hashes internally, that's fine)
      await storage.objects.write(transfer.repoPath, data);
      await unlink(transfer.stagingPath).catch(() => {});

      // Update dataset ref
      const treePath = urlPathToTreePath(transfer.path);
      await workspaceSetDatasetByHash(storage, transfer.repoPath, transfer.workspace, treePath, actualHash, new Map());

      return sendSuccess(TransferDoneResponseType, variant('completed', null));
    } finally {
      transfers.delete(id);
    }
  });

  return app;
}
