/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 status command - Show repository status
 *
 * Usage:
 *   e3 status .
 */

import {
  packageList,
  workspaceList,
  workspaceGetState,
} from '@elaraai/e3-core';
import { resolveRepo, formatError, exitError } from '../utils.js';

/**
 * Show repository status.
 */
export async function statusCommand(repoArg: string): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);

    console.log(`Repository: ${repoPath}`);
    console.log('');

    // List packages
    const packages = await packageList(repoPath);
    console.log('Packages:');
    if (packages.length === 0) {
      console.log('  (none)');
    } else {
      for (const pkg of packages) {
        console.log(`  ${pkg.name}@${pkg.version}`);
      }
    }
    console.log('');

    // List workspaces with status
    const workspaces = await workspaceList(repoPath);
    console.log('Workspaces:');
    if (workspaces.length === 0) {
      console.log('  (none)');
    } else {
      for (const ws of workspaces) {
        const state = await workspaceGetState(repoPath, ws);
        if (state) {
          console.log(`  ${ws}`);
          console.log(`    Package: ${state.packageName}@${state.packageVersion}`);
          console.log(`    Deployed: ${state.deployedAt.toISOString()}`);
          console.log(`    Updated: ${state.rootUpdatedAt.toISOString()}`);
        } else {
          console.log(`  ${ws} (not deployed)`);
        }
      }
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
