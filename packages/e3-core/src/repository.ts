/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
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
 * Pure business logic - no UI dependencies
 */
export function initRepository(repoPath: string): InitRepositoryResult {
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

    // Create objects directory
    fs.mkdirSync(path.join(e3Dir, 'objects'), { recursive: true });

    // Create queue directory for node runtime
    fs.mkdirSync(path.join(e3Dir, 'queue', 'node'), { recursive: true });

    // Create claims directory for node runtime
    fs.mkdirSync(path.join(e3Dir, 'claims', 'node'), { recursive: true });

    // Create refs directory for named task references
    fs.mkdirSync(path.join(e3Dir, 'refs', 'tasks'), { recursive: true });

    // Create tasks directory (task_id -> commit_hash mapping)
    fs.mkdirSync(path.join(e3Dir, 'tasks'), { recursive: true });

    // Create tmp directory for atomic operations
    fs.mkdirSync(path.join(e3Dir, 'tmp'), { recursive: true });

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
 */
export function isValidRepository(repoPath: string): boolean {
  const requiredDirs = ['objects', 'queue', 'refs', 'tasks', 'tmp'];

  return requiredDirs.every((dir) => fs.existsSync(path.join(repoPath, dir)));
}

/**
 * Find the e3 repository directory
 *
 * Searches:
 * 1. E3_REPO environment variable
 * 2. Current directory and parents (like git)
 */
export function findRepository(startPath?: string): string | null {
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
export function getRepository(repoPath?: string): string {
  const repo = findRepository(repoPath);

  if (!repo) {
    throw new Error('e3 repository not found. Run `e3 init` to create one.');
  }

  return repo;
}

/**
 * Set a named task reference
 */
export async function setTaskRef(
  repoPath: string,
  refName: string,
  taskId: string
): Promise<void> {
  const refPath = path.join(repoPath, 'refs', 'tasks', refName);
  await fsPromises.writeFile(refPath, taskId);
}

/**
 * Delete a named task reference
 */
export async function deleteTaskRef(
  repoPath: string,
  refName: string
): Promise<void> {
  const refPath = path.join(repoPath, 'refs', 'tasks', refName);
  await fsPromises.unlink(refPath);
}

/**
 * List all task refs
 */
export async function listTaskRefs(repoPath: string): Promise<string[]> {
  const refsDir = path.join(repoPath, 'refs', 'tasks');
  try {
    return await fsPromises.readdir(refsDir);
  } catch {
    return [];
  }
}
