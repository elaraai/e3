/**
 * Test helpers for e3-core
 * Provides utilities for setting up and tearing down test repositories
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRepository } from './repository.js';

/**
 * Creates a temporary directory for testing
 * @returns Path to temporary directory
 */
export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'e3-test-'));
}

/**
 * Removes a temporary directory and all its contents
 * @param dir Path to directory to remove
 */
export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Track parent directories for cleanup
 */
const parentDirs = new Map<string, string>();

/**
 * Creates a temporary E3 repository for testing
 * @returns Path to .e3 directory
 */
export function createTestRepo(): string {
  const dir = createTempDir();
  const result = initRepository(dir);
  if (!result.success) {
    throw new Error(`Failed to create test repository: ${result.error?.message}`);
  }
  // Track parent directory for cleanup
  parentDirs.set(result.e3Dir, dir);
  return result.e3Dir;
}

/**
 * Remove a test repository (removes parent directory)
 * @param e3Dir Path to .e3 directory
 */
export function removeTestRepo(e3Dir: string): void {
  const parentDir = parentDirs.get(e3Dir);
  if (parentDir) {
    removeTempDir(parentDir);
    parentDirs.delete(e3Dir);
  } else {
    // Fallback: remove the .e3 directory itself
    removeTempDir(e3Dir);
  }
}
