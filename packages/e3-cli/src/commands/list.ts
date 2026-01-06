/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 list command - List workspaces or tree contents
 *
 * Usage:
 *   e3 list .                    # List all workspaces
 *   e3 list . ws                 # List root tree of workspace
 *   e3 list . ws.inputs          # List fields under inputs
 */

import {
  workspaceList,
  workspaceListTree,
  workspaceGetState,
  LocalBackend,
} from '@elaraai/e3-core';
import { resolveRepo, parseDatasetPath, formatError, exitError } from '../utils.js';

/**
 * List workspaces or tree contents at a path.
 */
export async function listCommand(repoArg: string, pathSpec?: string): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);

    // If no path, list workspaces
    if (!pathSpec) {
      const storage = new LocalBackend(repoPath);
      const workspaces = await workspaceList(storage);

      if (workspaces.length === 0) {
        console.log('No workspaces');
        return;
      }

      for (const ws of workspaces) {
        const state = await workspaceGetState(storage, ws);
        if (state) {
          console.log(`${ws}  (${state.packageName}@${state.packageVersion})`);
        } else {
          console.log(`${ws}  (not deployed)`);
        }
      }
      return;
    }

    // Parse path and list tree contents
    const storage = new LocalBackend(repoPath);
    const { ws, path } = parseDatasetPath(pathSpec);
    const fields = await workspaceListTree(storage, ws, path);

    if (fields.length === 0) {
      console.log('(empty)');
      return;
    }

    for (const field of fields) {
      console.log(field);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
