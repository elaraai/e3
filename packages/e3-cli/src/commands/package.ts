/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 package commands - Package management
 */

import {
  packageImport,
  packageExport,
  packageList,
  packageRemove,
  LocalStorage,
} from '@elaraai/e3-core';
import { resolveRepo, parsePackageSpec, formatError, exitError } from '../utils.js';

export const packageCommand = {
  /**
   * Import a package from a .zip file.
   */
  async import(repoArg: string, zipPath: string): Promise<void> {
    try {
      const repoPath = resolveRepo(repoArg);
      const storage = new LocalStorage();
      const result = await packageImport(storage, repoPath, zipPath);

      console.log(`Imported ${result.name}@${result.version}`);
      console.log(`  Package hash: ${result.packageHash.slice(0, 12)}...`);
      console.log(`  Objects: ${result.objectCount}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Export a package to a .zip file.
   */
  async export(repoArg: string, pkgSpec: string, zipPath: string): Promise<void> {
    try {
      const repoPath = resolveRepo(repoArg);
      const storage = new LocalStorage();
      const { name, version } = parsePackageSpec(pkgSpec);

      const result = await packageExport(storage, repoPath, name, version, zipPath);

      console.log(`Exported ${name}@${version} to ${zipPath}`);
      console.log(`  Package hash: ${result.packageHash.slice(0, 12)}...`);
      console.log(`  Objects: ${result.objectCount}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * List installed packages.
   */
  async list(repoArg: string): Promise<void> {
    try {
      const repoPath = resolveRepo(repoArg);
      const storage = new LocalStorage();
      const packages = await packageList(storage, repoPath);

      if (packages.length === 0) {
        console.log('No packages installed');
        return;
      }

      console.log('Packages:');
      for (const pkg of packages) {
        console.log(`  ${pkg.name}@${pkg.version}`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Remove a package.
   */
  async remove(repoArg: string, pkgSpec: string): Promise<void> {
    try {
      const repoPath = resolveRepo(repoArg);
      const storage = new LocalStorage();
      const { name, version } = parsePackageSpec(pkgSpec);

      await packageRemove(storage, repoPath, name, version);

      console.log(`Removed ${name}@${version}`);
      console.log('Run `e3 gc` to reclaim disk space');
    } catch (err) {
      exitError(formatError(err));
    }
  },
};
