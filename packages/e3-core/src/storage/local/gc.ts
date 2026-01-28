/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Garbage collection for local e3 repositories.
 *
 * Uses mark-and-sweep algorithm:
 * 1. Mark: Find all root refs (packages, executions, workspaces) and trace reachable objects
 * 2. Sweep: Delete unreachable objects and orphaned staging files
 *
 * Note: This is a local-only operation. Cloud backends would use different
 * GC strategies (e.g., S3 lifecycle policies, TTL-based expiration).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { StorageBackend } from '../interfaces.js';
import { LocalStorage, collectRoots, sweep } from './index.js';

/**
 * Options for garbage collection
 */
export interface GcOptions {
  /**
   * Minimum age in milliseconds for files to be considered for deletion.
   * Files younger than this are skipped to avoid race conditions with concurrent writes.
   * Default: 60000 (1 minute)
   */
  minAge?: number;

  /**
   * If true, only report what would be deleted without actually deleting.
   * Default: false
   */
  dryRun?: boolean;
}

/**
 * Result of garbage collection
 */
export interface GcResult {
  /**
   * Number of objects deleted
   */
  deletedObjects: number;

  /**
   * Number of orphaned staging files deleted
   */
  deletedPartials: number;

  /**
   * Number of objects retained
   */
  retainedObjects: number;

  /**
   * Number of files skipped due to being too young
   */
  skippedYoung: number;

  /**
   * Total bytes freed
   */
  bytesFreed: number;
}

/**
 * Run garbage collection on an e3 repository.
 *
 * Note: GC currently requires LocalStorage as it needs direct filesystem access
 * to enumerate and delete unreachable objects. Cloud backends will need their
 * own GC implementation (e.g., using S3 lifecycle policies).
 *
 * @param storage - Storage backend (must be LocalStorage)
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param options - GC options
 * @returns GC result with statistics
 * @throws Error if storage is not a LocalStorage
 */
export async function repoGc(
  storage: StorageBackend,
  repo: string,
  options: GcOptions = {}
): Promise<GcResult> {
  // GC requires direct filesystem access - verify we have LocalStorage
  if (!(storage instanceof LocalStorage)) {
    throw new Error('GC is only supported with LocalStorage storage');
  }

  const minAge = options.minAge ?? 60000; // Default 1 minute
  const dryRun = options.dryRun ?? false;

  // Step 1: Collect all root hashes
  const roots = await collectRoots(repo);

  // Step 2: Mark all reachable objects starting from roots
  const reachable = new Set<string>();
  for (const root of roots) {
    await markReachable(storage, repo, root, reachable);
  }

  // Step 3: Sweep - enumerate all objects and delete unreachable ones
  if (dryRun) {
    // For dry run, we need to count without deleting
    const result = await sweepDryRun(repo, reachable, minAge);
    return result;
  }

  const result = await sweep(repo, reachable, minAge);
  return {
    deletedObjects: result.deletedObjects,
    deletedPartials: result.deletedPartials,
    retainedObjects: result.retainedObjects,
    skippedYoung: result.skippedYoung,
    bytesFreed: result.bytesFreed,
  };
}

/**
 * Mark all objects reachable from a root hash.
 *
 * Traverses the object graph by scanning for hash patterns in the data.
 */
async function markReachable(
  storage: StorageBackend,
  repo: string,
  hash: string,
  reachable: Set<string>
): Promise<void> {
  // Already visited?
  if (reachable.has(hash)) {
    return;
  }

  // Try to load the object
  try {
    const data = await storage.objects.read(repo, hash);
    reachable.add(hash);

    // Scan for hash patterns in the data
    const dataStr = Buffer.from(data).toString('latin1');
    const hashPattern = /[a-f0-9]{64}/g;
    const matches = dataStr.matchAll(hashPattern);

    for (const match of matches) {
      const potentialHash = match[0];
      if (!reachable.has(potentialHash)) {
        // Recursively mark if it exists
        await markReachable(storage, repo, potentialHash, reachable);
      }
    }
  } catch {
    // Object doesn't exist - not an error, just means this hash
    // wasn't actually a reference to an object
  }
}

/**
 * Dry-run sweep: count what would be deleted without actually deleting.
 */
async function sweepDryRun(
  repoPath: string,
  reachable: Set<string>,
  minAge: number
): Promise<GcResult> {
  const objectsDir = path.join(repoPath, 'objects');
  const now = Date.now();
  const result: GcResult = {
    deletedObjects: 0,
    deletedPartials: 0,
    retainedObjects: 0,
    skippedYoung: 0,
    bytesFreed: 0,
  };

  try {
    const subdirs = await fs.readdir(objectsDir);

    for (const subdir of subdirs) {
      if (!/^[a-f0-9]{2}$/.test(subdir)) {
        continue;
      }

      const subdirPath = path.join(objectsDir, subdir);
      const stat = await fs.stat(subdirPath);
      if (!stat.isDirectory()) {
        continue;
      }

      const files = await fs.readdir(subdirPath);

      for (const file of files) {
        const filePath = path.join(subdirPath, file);

        try {
          const fileStat = await fs.stat(filePath);
          const age = now - fileStat.mtimeMs;
          if (minAge > 0 && age < minAge) {
            result.skippedYoung++;
            continue;
          }

          if (file.endsWith('.partial')) {
            result.deletedPartials++;
            result.bytesFreed += fileStat.size;
            continue;
          }

          if (file.endsWith('.beast2')) {
            const hash = subdir + file.slice(0, -7);
            if (reachable.has(hash)) {
              result.retainedObjects++;
            } else {
              result.deletedObjects++;
              result.bytesFreed += fileStat.size;
            }
          }
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Objects directory doesn't exist or can't be read
  }

  return result;
}
