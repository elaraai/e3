/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 get command - Get dataset value
 *
 * Usage:
 *   e3 get . ws.path.to.dataset
 *   e3 get . ws.path.to.dataset -f json
 */

import { workspaceGetDatasetHash, datasetRead } from '@elaraai/e3-core';
import { printFor, toJSONFor } from '@elaraai/east';
import { resolveRepo, parseDatasetPath, formatError, exitError } from '../utils.js';

/**
 * Get dataset value at a path.
 */
export async function getCommand(
  repoArg: string,
  pathSpec: string,
  options: { format?: string }
): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);
    const { ws, path } = parseDatasetPath(pathSpec);

    if (path.length === 0) {
      exitError('Path must include at least one field (e.g., ws.field)');
    }

    // Get the hash first, then read with type info
    const { refType, hash } = await workspaceGetDatasetHash(repoPath, ws, path);

    if (refType === 'unassigned') {
      exitError('Dataset is unassigned (pending task output)');
    }

    if (refType === 'null' || hash === null) {
      console.log('null');
      return;
    }

    // Read the dataset to get both value and type
    const { type, value } = await datasetRead(repoPath, hash);

    const format = options.format ?? 'east';

    switch (format) {
      case 'east': {
        const printer = printFor(type);
        console.log(printer(value));
        break;
      }
      case 'json': {
        const toJSON = toJSONFor(type);
        const jsonValue = toJSON(value);
        console.log(JSON.stringify(jsonValue, null, 2));
        break;
      }
      case 'beast2':
        exitError('beast2 output format not yet implemented for get command');
        break;
      default:
        exitError(`Unknown format: ${format}. Use: east, json, beast2`);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
