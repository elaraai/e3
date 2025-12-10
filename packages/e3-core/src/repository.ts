/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

/**
 * Result of initializing an e3 repository
 */
export interface InitRepositoryResult {
  success: boolean;
  e3Dir: string;
  error?: Error;
  alreadyExists?: boolean;
}

/**
 * Initialize a new e3 repository
 *
 * Creates:
 * - e3.east (empty config)
 * - objects/
 * - packages/
 * - executions/
 * - workspaces/
 *
 * Pure business logic - no UI dependencies
 */
export function repoInit(repoPath: string): InitRepositoryResult {
  const targetPath = path.resolve(repoPath);
  const e3Dir = path.join(targetPath, '.e3');

  // Check if .e3 already exists
  if (fs.existsSync(e3Dir)) {
    return {
      success: false,
      e3Dir,
      alreadyExists: true,
      error: new Error(`e3 repository already exists at ${e3Dir}`),
    };
  }

  try {
    // Create main .e3 directory
    fs.mkdirSync(e3Dir, { recursive: true });

    // Create empty config file
    fs.writeFileSync(path.join(e3Dir, 'e3.east'), '');

    // Create objects directory (content-addressed storage)
    fs.mkdirSync(path.join(e3Dir, 'objects'), { recursive: true });

    // Create packages directory (package refs: packages/<name>/<version> -> hash)
    fs.mkdirSync(path.join(e3Dir, 'packages'), { recursive: true });

    // Create executions directory (execution cache: executions/<hash>/output -> hash)
    fs.mkdirSync(path.join(e3Dir, 'executions'), { recursive: true });

    // Create workspaces directory (workspace state)
    fs.mkdirSync(path.join(e3Dir, 'workspaces'), { recursive: true });

    return {
      success: true,
      e3Dir,
    };
  } catch (error) {
    return {
      success: false,
      e3Dir,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Validate that a directory is a valid e3 repository
 * @internal
 */
function isValidRepository(repoPath: string): boolean {
  const requiredDirs = ['objects', 'packages', 'executions', 'workspaces'];

  return requiredDirs.every((dir) => fs.existsSync(path.join(repoPath, dir)));
}

/**
 * Find the e3 repository directory
 *
 * Searches:
 * 1. E3_REPO environment variable
 * 2. Current directory and parents (like git)
 */
export function repoFind(startPath?: string): string | null {
  // 1. Check E3_REPO environment variable
  if (process.env.E3_REPO) {
    const repoPath = path.resolve(process.env.E3_REPO);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      return repoPath;
    }
  }

  // 2. Check current directory and parents
  let currentDir = startPath !== undefined ? path.resolve(startPath) : process.cwd();
  while (true) {
    const e3Dir = path.join(currentDir, '.e3');
    if (fs.existsSync(e3Dir) && isValidRepository(e3Dir)) {
      return e3Dir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * Get the e3 repository, throw error if not found
 */
export function repoGet(repoPath?: string): string {
  const repo = repoFind(repoPath);

  if (!repo) {
    throw new Error('e3 repository not found. Run `e3 init` to create one.');
  }

  return repo;
}

