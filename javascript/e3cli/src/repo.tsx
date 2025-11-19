/**
 * Repository discovery and validation
 */

import { render } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { Error } from './ui/index.js';

/**
 * Find the E3 repository directory
 *
 * Searches:
 * 1. .e3/ in current directory (or provided path)
 * 2. .e3/ in parent directories (like git)
 */
export function findRepository(repoPath?: string): string | null {
  // 1. Check E3_REPO environment variable
  if (process.env.E3_REPO) {
    const repoPath = path.resolve(process.env.E3_REPO);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      return repoPath;
    }
  }

  // 2. Check current directory and parents
  let currentDir = repoPath !== undefined ? path.resolve(repoPath) : process.cwd();
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
export function getRepository(repoPath?: string): string {
  const repo = findRepository(repoPath);

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
