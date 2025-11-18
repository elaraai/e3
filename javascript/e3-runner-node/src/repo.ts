/**
 * Repository discovery and validation for E3 runner
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Find the E3 repository directory
 *
 * Searches:
 * 1. Provided repoPath argument
 * 2. E3_REPO environment variable
 * 3. ~/.e3 (global default)
 */
export function findRepository(repoPath?: string): string | null {
  // 1. Check provided argument
  if (repoPath) {
    const resolved = path.resolve(repoPath);
    if (fs.existsSync(resolved) && isValidRepository(resolved)) {
      return resolved;
    }
  }

  // 2. Check E3_REPO environment variable
  if (process.env.E3_REPO) {
    const envPath = path.resolve(process.env.E3_REPO);
    if (fs.existsSync(envPath) && isValidRepository(envPath)) {
      return envPath;
    }
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
  const requiredDirs = ['objects', 'queue', 'claims', 'refs', 'tasks', 'tmp'];

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
    console.error('Error: E3 repository not found');
    console.error('');
    console.error('Provide --repo <path>, or');
    console.error('Set E3_REPO environment variable, or');
    console.error('Create repository at ~/.e3');
    process.exit(1);
  }

  return repo;
}
