/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 status command - Show dataset status detail
 *
 * Usage:
 *   e3 status . ws.path.to.dataset
 *   e3 status https://server/repos/myrepo ws.path.to.dataset
 */

import { workspaceGetDatasetStatus, LocalStorage } from '@elaraai/e3-core';
import { datasetGetStatus as datasetGetStatusRemote } from '@elaraai/e3-api-client';
import { printFor, EastTypeType, isVariant, toEastTypeValue, type EastTypeValue } from '@elaraai/east';
import { parseRepoLocation, parseDatasetPath, formatError, exitError } from '../utils.js';
import { formatSize } from '../format.js';

/**
 * Show status detail for a single dataset at a path.
 */
export async function datasetStatusCommand(
  repoArg: string,
  pathSpec: string,
): Promise<void> {
  try {
    const location = await parseRepoLocation(repoArg);
    const { ws, path } = parseDatasetPath(pathSpec);

    if (path.length === 0) {
      exitError('Path must include at least one field (e.g., ws.field)');
    }

    const pathStr = '.' + path.map(s => s.value).join('.');
    const printType = printFor(EastTypeType);

    if (location.type === 'local') {
      const storage = new LocalStorage();
      const result = await workspaceGetDatasetStatus(storage, location.path, ws, path);

      // Convert type to EastTypeValue if needed
      const typeValue: EastTypeValue = isVariant(result.datasetType)
        ? result.datasetType as EastTypeValue
        : toEastTypeValue(result.datasetType);

      console.log(`Path:   ${pathStr}`);
      console.log(`Type:   ${printType(typeValue)}`);

      if (result.refType === 'unassigned') {
        console.log('Status: unset');
      } else if (result.refType === 'null') {
        console.log('Status: set');
        console.log('Hash:   (null)');
        console.log('Size:   0 B');
      } else {
        console.log('Status: set');
        console.log(`Hash:   ${result.hash}`);
        console.log(`Size:   ${formatSize(result.size!)}`);
      }
    } else {
      const detail = await datasetGetStatusRemote(
        location.baseUrl,
        location.repo,
        ws,
        path,
        { token: location.token }
      );

      console.log(`Path:   ${detail.path}`);
      console.log(`Type:   ${printType(detail.type)}`);

      if (detail.hash.type === 'none' && detail.size.type === 'none') {
        console.log('Status: unset');
      } else {
        console.log('Status: set');
        if (detail.hash.type === 'some') {
          console.log(`Hash:   ${detail.hash.value}`);
        } else {
          console.log('Hash:   (null)');
        }
        if (detail.size.type === 'some') {
          console.log(`Size:   ${formatSize(Number(detail.size.value))}`);
        }
      }
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
