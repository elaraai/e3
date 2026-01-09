/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ArrayType, StringType } from '@elaraai/east';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';

/**
 * List available repositories in the repos directory.
 *
 * Scans the directory for subdirectories containing a .e3 folder.
 */
export async function listRepos(reposDir: string): Promise<Response> {
  try {
    const entries = await fs.readdir(reposDir, { withFileTypes: true });
    const repos: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const e3Path = path.join(reposDir, entry.name, '.e3');
        try {
          const stat = await fs.stat(e3Path);
          if (stat.isDirectory()) {
            repos.push(entry.name);
          }
        } catch {
          // Not a valid repo - skip
        }
      }
    }

    return sendSuccess(ArrayType(StringType), repos);
  } catch (err) {
    return sendError(ArrayType(StringType), errorToVariant(err));
  }
}
