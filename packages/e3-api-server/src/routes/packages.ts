/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Hono } from 'hono';
import { ArrayType, BlobType, NullType } from '@elaraai/east';
import {
  packageList,
  packageImport,
  packageExport,
  packageRemove,
  packageRead,
} from '@elaraai/e3-core';
import { PackageObjectType } from '@elaraai/e3-types';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { PackageListItemType, PackageImportResultType } from '../types.js';

export function createPackageRoutes(repoPath: string) {
  const app = new Hono();

  // GET /api/packages - List all packages
  app.get('/', async (c) => {
    try {
      const packages = await packageList(repoPath);
      const result = packages.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
      }));
      return sendSuccess(c, ArrayType(PackageListItemType), result);
    } catch (err) {
      return sendError(c, ArrayType(PackageListItemType), errorToVariant(err));
    }
  });

  // GET /api/packages/:name/:version - Get package details
  app.get('/:name/:version', async (c) => {
    try {
      const name = c.req.param('name');
      const version = c.req.param('version');
      if (!name || !version) {
        return sendError(c, PackageObjectType, errorToVariant(new Error('Missing name or version parameter')));
      }

      const pkg = await packageRead(repoPath, name, version);
      return sendSuccess(c, PackageObjectType, pkg);
    } catch (err) {
      return sendError(c, PackageObjectType, errorToVariant(err));
    }
  });

  // POST /api/packages - Import a package from zip
  app.post('/', async (c) => {
    try {
      // Read raw body as zip bytes
      const contentType = c.req.header('content-type');
      let archive: Uint8Array;

      if (contentType === 'application/beast2') {
        // BEAST2 encoded blob
        const { decodeBody } = await import('../beast2.js');
        archive = await decodeBody(c, BlobType);
      } else {
        // Raw zip bytes
        const buffer = await c.req.arrayBuffer();
        archive = new Uint8Array(buffer);
      }

      // Write to temp file
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e3-import-'));
      const tempPath = path.join(tempDir, 'package.zip');
      try {
        await fs.writeFile(tempPath, archive);
        const result = await packageImport(repoPath, tempPath);
        return sendSuccess(c, PackageImportResultType, {
          name: result.name,
          version: result.version,
          packageHash: result.packageHash,
          objectCount: BigInt(result.objectCount),
        });
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      return sendError(c, PackageImportResultType, errorToVariant(err));
    }
  });

  // GET /api/packages/:name/:version/export - Export package as zip
  app.get('/:name/:version/export', async (c) => {
    try {
      const name = c.req.param('name');
      const version = c.req.param('version');
      if (!name || !version) {
        return sendError(c, BlobType, errorToVariant(new Error('Missing name or version parameter')));
      }

      // Export to temp file
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e3-export-'));
      const tempPath = path.join(tempDir, 'package.zip');
      try {
        await packageExport(repoPath, name, version, tempPath);
        const archive = await fs.readFile(tempPath);
        return sendSuccess(c, BlobType, new Uint8Array(archive));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      return sendError(c, BlobType, errorToVariant(err));
    }
  });

  // DELETE /api/packages/:name/:version - Remove a package
  app.delete('/:name/:version', async (c) => {
    try {
      const name = c.req.param('name');
      const version = c.req.param('version');
      if (!name || !version) {
        return sendError(c, NullType, errorToVariant(new Error('Missing name or version parameter')));
      }

      await packageRemove(repoPath, name, version);
      return sendSuccess(c, NullType, null);
    } catch (err) {
      return sendError(c, NullType, errorToVariant(err));
    }
  });

  return app;
}
