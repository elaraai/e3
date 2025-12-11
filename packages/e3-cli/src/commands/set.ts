/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 set command - Set dataset value from file
 *
 * Usage:
 *   e3 set . ws.path.to.dataset ./data.beast2
 *   e3 set . ws.path.to.dataset ./data.east
 *   e3 set . ws.path.to.dataset ./data.json --type "Integer"
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';
import { workspaceSetDataset } from '@elaraai/e3-core';
import { decodeBeast2, parseInferred } from '@elaraai/east';
import { resolveRepo, parseDatasetPath, formatError, exitError } from '../utils.js';

/**
 * Set dataset value from a file.
 */
export async function setCommand(
  repoArg: string,
  pathSpec: string,
  filePath: string
): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);
    const { ws, path } = parseDatasetPath(pathSpec);

    if (path.length === 0) {
      exitError('Path must include at least one field (e.g., ws.field)');
    }

    // Read and decode the file based on extension
    const fileContent = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();

    let value: unknown;
    let type: unknown;

    switch (ext) {
      case '.beast2': {
        const decoded = decodeBeast2(fileContent);
        value = decoded.value;
        type = decoded.type;
        break;
      }
      case '.east': {
        const content = fileContent.toString('utf-8');
        const [parsedType, parsedValue] = parseInferred(content);
        value = parsedValue;
        type = parsedType;
        break;
      }
      case '.json': {
        // JSON requires a type annotation - for MVP, we'll need to infer or require --type
        exitError('JSON files require --type flag (not yet implemented). Use .beast2 or .east files.');
        break;
      }
      default:
        exitError(`Unknown file extension: ${ext}. Use .beast2, .east, or .json`);
    }

     
    await workspaceSetDataset(repoPath, ws, path, value, type as any);

    console.log(`Set ${pathSpec} from ${filePath}`);
  } catch (err) {
    exitError(formatError(err));
  }
}
