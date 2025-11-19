/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isValidRepository as isValidRepositoryCore } from '@elaraai/e3-core';

/**
 * Find the E3 repository directory for the runner
 *
 * Searches (different from CLI):
 * 1. Provided repoPath argument
 * 2. E3_REPO environment variable
 * 3. ~/.e3 (global default)
 */
export function findRepository(repoPath?: string): string | null {
  // 1. Check provided argument
  if (repoPath) {
    const resolved = path.resolve(repoPath);
    if (fs.existsSync(resolved) && isValidRepositoryCore(resolved)) {
      return resolved;
    }
  }

  // 2. Check E3_REPO environment variable
  if (process.env.E3_REPO) {
    const envPath = path.resolve(process.env.E3_REPO);
    if (fs.existsSync(envPath) && isValidRepositoryCore(envPath)) {
      return envPath;
    }
  }

  // 3. Check ~/.e3
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    const globalRepo = path.join(homeDir, '.e3');
    if (fs.existsSync(globalRepo) && isValidRepositoryCore(globalRepo)) {
      return globalRepo;
    }
  }

  return null;
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
