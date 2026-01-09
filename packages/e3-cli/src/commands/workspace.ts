/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 workspace commands - Workspace management
 */

import {
  workspaceCreate,
  workspaceDeploy,
  workspaceExport,
  workspaceList,
  workspaceRemove,
  workspaceGetState,
  WorkspaceLockError,
  LocalStorage,
} from '@elaraai/e3-core';
import {
  workspaceCreate as workspaceCreateRemote,
  workspaceDeploy as workspaceDeployRemote,
  workspaceExport as workspaceExportRemote,
  workspaceList as workspaceListRemote,
  workspaceRemove as workspaceRemoveRemote,
} from '@elaraai/e3-api-client';
import { writeFileSync } from 'node:fs';
import { parseRepoLocation, parsePackageSpec, formatError, exitError } from '../utils.js';

export const workspaceCommand = {
  /**
   * Create an empty workspace.
   */
  async create(repoArg: string, name: string): Promise<void> {
    try {
      const location = parseRepoLocation(repoArg);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        await workspaceCreate(storage, location.path, name);
      } else {
        await workspaceCreateRemote(location.baseUrl, location.repo, name);
      }

      console.log(`Created workspace: ${name}`);
      console.log('Deploy a package with: e3 workspace deploy <repo> <ws> <pkg>[@<ver>]');
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Deploy a package to a workspace.
   */
  async deploy(repoArg: string, ws: string, pkgSpec: string): Promise<void> {
    try {
      const location = parseRepoLocation(repoArg);
      const { name, version } = parsePackageSpec(pkgSpec);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        await workspaceDeploy(storage, location.path, ws, name, version);
      } else {
        // Remote API accepts packageRef string (name@version)
        const packageRef = version === 'latest' ? name : `${name}@${version}`;
        await workspaceDeployRemote(location.baseUrl, location.repo, ws, packageRef);
      }

      console.log(`Deployed ${name}@${version} to workspace: ${ws}`);
    } catch (err) {
      if (err instanceof WorkspaceLockError) {
        console.log('');
        console.log(`Workspace is locked by another process with PID: ${err.holder?.pid ?? 'unknown'}`);
        process.exit(1);
      }
      exitError(formatError(err));
    }
  },

  /**
   * Export workspace as a package.
   */
  async export(
    repoArg: string,
    ws: string,
    zipPath: string,
    options: { name?: string; version?: string }
  ): Promise<void> {
    try {
      const location = parseRepoLocation(repoArg);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        const result = await workspaceExport(storage, location.path, ws, zipPath, options.name, options.version);

        console.log(`Exported workspace ${ws} as ${result.name}@${result.version}`);
        console.log(`  Output: ${zipPath}`);
        console.log(`  Package hash: ${result.packageHash.slice(0, 12)}...`);
        console.log(`  Objects: ${result.objectCount}`);
      } else {
        // Remote export - fetch zip bytes and write to local file
        // Note: Remote export doesn't support custom name/version options
        if (options.name || options.version) {
          console.warn('Warning: --name and --version options are not supported for remote export');
        }
        const zipBytes = await workspaceExportRemote(location.baseUrl, location.repo, ws);
        writeFileSync(zipPath, zipBytes);

        console.log(`Exported workspace ${ws}`);
        console.log(`  Output: ${zipPath}`);
        console.log(`  Size: ${zipBytes.length} bytes`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * List workspaces.
   */
  async list(repoArg: string): Promise<void> {
    try {
      const location = parseRepoLocation(repoArg);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        const workspaces = await workspaceList(storage, location.path);

        if (workspaces.length === 0) {
          console.log('No workspaces');
          return;
        }

        console.log('Workspaces:');
        for (const ws of workspaces) {
          const state = await workspaceGetState(storage, location.path, ws);
          if (state) {
            console.log(`  ${ws} (${state.packageName}@${state.packageVersion})`);
          } else {
            console.log(`  ${ws} (not deployed)`);
          }
        }
      } else {
        // Remote - workspaceListRemote returns WorkspaceInfo[] with package info
        const workspaces = await workspaceListRemote(location.baseUrl, location.repo);

        if (workspaces.length === 0) {
          console.log('No workspaces');
          return;
        }

        console.log('Workspaces:');
        for (const info of workspaces) {
          if (info.deployed && info.packageName.type === 'some') {
            const pkgVersion = info.packageVersion.type === 'some' ? info.packageVersion.value : 'unknown';
            console.log(`  ${info.name} (${info.packageName.value}@${pkgVersion})`);
          } else {
            console.log(`  ${info.name} (not deployed)`);
          }
        }
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Remove a workspace.
   */
  async remove(repoArg: string, ws: string): Promise<void> {
    try {
      const location = parseRepoLocation(repoArg);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        await workspaceRemove(storage, location.path, ws);
        console.log(`Removed workspace: ${ws}`);
        console.log('Run `e3 gc` to reclaim disk space');
      } else {
        await workspaceRemoveRemote(location.baseUrl, location.repo, ws);
        console.log(`Removed workspace: ${ws}`);
      }
    } catch (err) {
      if (err instanceof WorkspaceLockError) {
        console.log('');
        console.log(`Workspace is locked by another process with PID: ${err.holder?.pid ?? 'unknown'}`);
        process.exit(1);
      }
      exitError(formatError(err));
    }
  },
};
