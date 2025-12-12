/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { NullType, ArrayType, StringType, decodeBeast2 } from '@elaraai/east';
import { urlPathToTreePath } from '@elaraai/e3-types';
import {
  workspaceListTree,
  workspaceGetDatasetHash,
  workspaceSetDataset,
  objectRead,
} from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { extractWildcardPath } from '../utils.js';

export function createDatasetRoutes(repoPath: string) {
  const app = new Hono();

  // GET /list - List field names at root (e3 list <repo> <ws>)
  app.get('/list', async (c) => {
    try {
      const workspace = c.req.param('ws');
      if (!workspace) {
        return sendError(c, ArrayType(StringType), errorToVariant(new Error('Missing workspace parameter')));
      }
      const fields = await workspaceListTree(repoPath, workspace, []);
      return sendSuccess(c, ArrayType(StringType), fields);
    } catch (err) {
      return sendError(c, ArrayType(StringType), errorToVariant(err));
    }
  });

  // GET /list/* - List field names at path (e3 list <repo> <ws.path>)
  app.get('/list/*', async (c) => {
    try {
      const workspace = c.req.param('ws');
      if (!workspace) {
        return sendError(c, ArrayType(StringType), errorToVariant(new Error('Missing workspace parameter')));
      }
      const pathStr = extractWildcardPath(c.req.path, /^\/api\/workspaces\/[^/]+\/list\//);
      const treePath = urlPathToTreePath(pathStr);
      const fields = await workspaceListTree(repoPath, workspace, treePath);
      return sendSuccess(c, ArrayType(StringType), fields);
    } catch (err) {
      return sendError(c, ArrayType(StringType), errorToVariant(err));
    }
  });

  // GET /get/* - Get dataset value as raw BEAST2 (e3 get <repo> <ws.path>)
  app.get('/get/*', async (c) => {
    try {
      const workspace = c.req.param('ws');
      if (!workspace) {
        return sendError(c, NullType, errorToVariant(new Error('Missing workspace parameter')));
      }
      const pathStr = extractWildcardPath(c.req.path, /^\/api\/workspaces\/[^/]+\/get\//);
      const treePath = urlPathToTreePath(pathStr);

      if (treePath.length === 0) {
        return sendError(c, NullType, errorToVariant(new Error('Path required for get')));
      }

      const { refType, hash } = await workspaceGetDatasetHash(repoPath, workspace, treePath);

      if (refType === 'unassigned') {
        return sendError(c, NullType, errorToVariant(new Error('Dataset is unassigned (pending task output)')));
      }

      if (refType === 'null' || !hash) {
        return sendError(c, NullType, errorToVariant(new Error('Dataset is null')));
      }

      // Return raw BEAST2 bytes directly from object store
      const data = await objectRead(repoPath, hash);
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': 'application/beast2' },
      });
    } catch (err) {
      return sendError(c, NullType, errorToVariant(err));
    }
  });

  // PUT /set/* - Set dataset value from raw BEAST2 (e3 set <repo> <ws.path>)
  app.put('/set/*', async (c) => {
    try {
      const workspace = c.req.param('ws');
      if (!workspace) {
        return sendError(c, NullType, errorToVariant(new Error('Missing workspace parameter')));
      }
      const pathStr = extractWildcardPath(c.req.path, /^\/api\/workspaces\/[^/]+\/set\//);
      const treePath = urlPathToTreePath(pathStr);

      if (treePath.length === 0) {
        return sendError(c, NullType, errorToVariant(new Error('Path required for set')));
      }

      // Body is raw BEAST2 - decode to get type and value
      const buffer = await c.req.arrayBuffer();
      const { type, value } = decodeBeast2(new Uint8Array(buffer));

      await workspaceSetDataset(repoPath, workspace, treePath, value, type);
      return sendSuccess(c, NullType, null);
    } catch (err) {
      return sendError(c, NullType, errorToVariant(err));
    }
  });

  return app;
}
