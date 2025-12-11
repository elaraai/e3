/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 gc command - Garbage collection
 *
 * Usage:
 *   e3 gc .
 *   e3 gc . --dry-run
 */

import { repoGc } from '@elaraai/e3-core';
import { resolveRepo, formatError, exitError } from '../utils.js';

/**
 * Run garbage collection.
 */
export async function gcCommand(
  repoArg: string,
  options: { dryRun?: boolean; minAge?: string }
): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);
    const minAge = options.minAge ? parseInt(options.minAge, 10) : 60000;

    if (options.dryRun) {
      console.log('Dry run - no files will be deleted');
    }
    console.log(`Minimum age: ${minAge}ms`);
    console.log('');

    const result = await repoGc(repoPath, {
      dryRun: options.dryRun,
      minAge,
    });

    console.log('Garbage collection complete:');
    console.log(`  Objects retained: ${result.retainedObjects}`);
    console.log(`  Objects deleted:  ${result.deletedObjects}`);
    console.log(`  Partials deleted: ${result.deletedPartials}`);
    console.log(`  Skipped (young):  ${result.skippedYoung}`);

    if (result.bytesFreed > 0) {
      const mb = (result.bytesFreed / 1024 / 1024).toFixed(2);
      console.log(`  Space reclaimed:  ${mb} MB`);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
