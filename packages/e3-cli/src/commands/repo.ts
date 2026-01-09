/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 repo commands - Repository management
 */

import { resolve } from 'path';
import { rmSync } from 'fs';
import {
  repoInit,
  repoGc,
  packageList,
  workspaceList,
  workspaceGetState,
  LocalStorage,
} from '@elaraai/e3-core';
import {
  repoStatus as repoStatusRemote,
  repoGc as repoGcRemote,
  repoCreate as repoCreateRemote,
  repoRemove as repoRemoveRemote,
} from '@elaraai/e3-api-client';
import { some, none } from '@elaraai/east';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { getValidToken } from '../credentials.js';

/**
 * Parse repo URL for create command (doesn't validate existence).
 * Returns { type: 'remote', baseUrl, repo } for URLs, or { type: 'local', path } for paths.
 */
function parseRepoForCreate(arg: string): { type: 'remote'; baseUrl: string; repo: string } | { type: 'local'; path: string } {
  if (arg.startsWith('https://') || arg.startsWith('http://')) {
    const url = new URL(arg);
    const match = url.pathname.match(/^\/repos\/([^/]+)/);
    if (!match) {
      throw new Error(`Invalid remote URL: expected /repos/{repo} in path, got ${url.pathname}`);
    }
    return { type: 'remote', baseUrl: url.origin, repo: match[1] };
  }
  return { type: 'local', path: resolve(arg) };
}

export const repoCommand = {
  /**
   * Create a new repository.
   *
   * Local: e3 repo create <path>
   * Remote: e3 repo create <url>  (e.g., http://server/repos/name)
   */
  async create(repoArg: string): Promise<void> {
    try {
      const location = parseRepoForCreate(repoArg);

      if (location.type === 'remote') {
        const token = await getValidToken(location.baseUrl);
        await repoCreateRemote(location.baseUrl, location.repo, { token });
        console.log(`Created repository: ${location.repo}`);
        console.log(`  URL: ${location.baseUrl}/repos/${location.repo}`);
      } else {
        const result = repoInit(location.path);

        if (!result.success) {
          if (result.alreadyExists) {
            exitError(`e3 repository already exists at ${result.e3Dir}`);
          } else {
            exitError(`Failed to create repository: ${formatError(result.error)}`);
          }
        }

        console.log(`Initialized e3 repository at ${result.e3Dir}`);
        console.log('');
        console.log('Created:');
        console.log('  objects/      Content-addressable storage');
        console.log('  packages/     Package references');
        console.log('  workspaces/   Workspace state');
        console.log('  executions/   Task execution cache');
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Remove a repository.
   */
  async remove(locationArg: string): Promise<void> {
    try {
      const location = await parseRepoLocation(locationArg);

      if (location.type === 'local') {
        // Remove the .e3 directory
        rmSync(location.path, { recursive: true, force: true });
        console.log(`Removed repository at ${location.path}`);
      } else {
        await repoRemoveRemote(location.baseUrl, location.repo, { token: location.token });
        console.log(`Removed repository: ${location.repo}`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Show repository status.
   */
  async status(locationArg: string): Promise<void> {
    try {
      const location = await parseRepoLocation(locationArg);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        console.log(`Repository: ${location.path}`);
        console.log('');

        // List packages
        const packages = await packageList(storage, location.path);
        console.log('Packages:');
        if (packages.length === 0) {
          console.log('  (none)');
        } else {
          for (const pkg of packages) {
            console.log(`  ${pkg.name}@${pkg.version}`);
          }
        }
        console.log('');

        // List workspaces
        const workspaces = await workspaceList(storage, location.path);
        console.log('Workspaces:');
        if (workspaces.length === 0) {
          console.log('  (none)');
        } else {
          for (const ws of workspaces) {
            const state = await workspaceGetState(storage, location.path, ws);
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
      } else {
        const status = await repoStatusRemote(location.baseUrl, location.repo, { token: location.token });
        console.log(`Repository: ${location.repo}`);
        console.log('');
        console.log(`  Objects: ${status.objectCount}`);
        console.log(`  Packages: ${status.packageCount}`);
        console.log(`  Workspaces: ${status.workspaceCount}`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Run garbage collection.
   */
  async gc(locationArg: string, options: { dryRun?: boolean; minAge?: string }): Promise<void> {
    try {
      const location = await parseRepoLocation(locationArg);
      const minAge = options.minAge ? parseInt(options.minAge, 10) : 60000;

      if (options.dryRun) {
        console.log('Dry run - no files will be deleted');
      }
      console.log(`Minimum age: ${minAge}ms`);
      console.log('');

      if (location.type === 'local') {
        const storage = new LocalStorage();
        const result = await repoGc(storage, location.path, {
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
      } else {
        const result = await repoGcRemote(location.baseUrl, location.repo, {
          dryRun: options.dryRun ?? false,
          minAge: minAge ? some(BigInt(minAge)) : none,
        }, { token: location.token });

        console.log('Garbage collection complete:');
        console.log(`  Objects retained: ${result.retainedObjects}`);
        console.log(`  Objects deleted:  ${result.deletedObjects}`);
        console.log(`  Partials deleted: ${result.deletedPartials}`);
        console.log(`  Skipped (young):  ${result.skippedYoung}`);

        if (result.bytesFreed > 0n) {
          const mb = (Number(result.bytesFreed) / 1024 / 1024).toFixed(2);
          console.log(`  Space reclaimed:  ${mb} MB`);
        }
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },
};
