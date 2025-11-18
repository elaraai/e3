/**
 * Repository discovery and validation
 */

import React from 'react';
import { render } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { Error } from './ui/index.js';

/**
 * Find the E3 repository directory
 *
 * Searches:
 * 1. E3_REPO environment variable
 * 2. .e3/ in current directory
 * 3. .e3/ in parent directories (like git)
 * 4. ~/.e3 (global default)
 */
export function findRepository(): string | null {
  // 1. Check E3_REPO environment variable
  if (process.env.E3_REPO) {
    const repoPath = path.resolve(process.env.E3_REPO);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      return repoPath;
    }
  }

  // 2. Check current directory and parents
  let currentDir = process.cwd();
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

  // 3. Check ~/.e3
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    const globalRepo = path.join(homeDir, '.e3');
    if (fs.existsSync(globalRepo) && isValidRepository(globalRepo)) {
      return globalRepo;
    }
  }

  return null;
}

/**
 * Validate that a directory is a valid E3 repository
 */
function isValidRepository(repoPath: string): boolean {
  const requiredDirs = ['objects', 'queue', 'refs', 'tasks', 'tmp'];

  return requiredDirs.every((dir) =>
    fs.existsSync(path.join(repoPath, dir))
  );
}

/**
 * Get the E3 repository, or error if not found
 */
export function getRepository(): string {
  const repo = findRepository();

  if (!repo) {
    render(
      <Error
        message="Not in an E3 repository"
        details={[
          'Run `e3 init` to create a new repository, or',
          'Set E3_REPO environment variable to point to an existing repository',
        ]}
      />
    );
    process.exit(1);
  }

  return repo;
}
