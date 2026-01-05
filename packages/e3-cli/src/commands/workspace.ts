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
  LocalBackend,
} from '@elaraai/e3-core';
import { resolveRepo, parsePackageSpec, formatError, exitError } from '../utils.js';

export const workspaceCommand = {
  /**
   * Create an empty workspace.
   */
  async create(repoArg: string, name: string): Promise<void> {
    try {
      const repoPath = resolveRepo(repoArg);
      await workspaceCreate(repoPath, name);

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
      const repoPath = resolveRepo(repoArg);
      const { name, version } = parsePackageSpec(pkgSpec);

      await workspaceDeploy(repoPath, ws, name, version);

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
      const repoPath = resolveRepo(repoArg);
      const result = await workspaceExport(repoPath, ws, zipPath, options.name, options.version);

      console.log(`Exported workspace ${ws} as ${result.name}@${result.version}`);
      console.log(`  Output: ${zipPath}`);
      console.log(`  Package hash: ${result.packageHash.slice(0, 12)}...`);
      console.log(`  Objects: ${result.objectCount}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * List workspaces.
   */
  async list(repoArg: string): Promise<void> {
    try {
      const repoPath = resolveRepo(repoArg);
      const storage = new LocalBackend(repoPath);
      const workspaces = await workspaceList(storage);

      if (workspaces.length === 0) {
        console.log('No workspaces');
        return;
      }

      console.log('Workspaces:');
      for (const ws of workspaces) {
        const state = await workspaceGetState(storage, ws);
        if (state) {
          console.log(`  ${ws} (${state.packageName}@${state.packageVersion})`);
        } else {
          console.log(`  ${ws} (not deployed)`);
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
      const repoPath = resolveRepo(repoArg);
      await workspaceRemove(repoPath, ws);

      console.log(`Removed workspace: ${ws}`);
      console.log('Run `e3 gc` to reclaim disk space');
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
