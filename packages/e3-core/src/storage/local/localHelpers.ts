/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem helpers for e3 object storage.
 *
 * These functions are local-specific utilities for working with
 * the filesystem-based object store. They are used by LocalObjectStore
 * and other local storage components.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Get the filesystem path for an object.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - SHA256 hash of the object
 * @returns Filesystem path: objects/<hash[0..2]>/<hash[2..]>.beast2
 */
export function objectPath(repoPath: string, hash: string): string {
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + '.beast2';
  return path.join(repoPath, 'objects', dirName, fileName);
}

/**
 * Get the minimum unambiguous prefix length for an object hash.
 *
 * Scans the object store to find the shortest prefix of the given hash
 * that uniquely identifies it among all stored objects.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - Full SHA256 hash of the object
 * @param minLength - Minimum prefix length to return (default: 4)
 * @returns Minimum unambiguous prefix length
 */
export async function objectAbbrev(
  repoPath: string,
  hash: string,
  minLength: number = 4
): Promise<number> {
  const objectsDir = path.join(repoPath, 'objects');
  const targetPrefix = hash.slice(0, 2);

  // Collect all hashes that share the same 2-char prefix directory
  const hashes: string[] = [];

  try {
    const dirPath = path.join(objectsDir, targetPrefix);
    const entries = await fs.readdir(dirPath);

    for (const entry of entries) {
      if (entry.endsWith('.beast2') && !entry.includes('.partial')) {
        // Reconstruct full hash: dir prefix + filename without extension
        const fullHash = targetPrefix + entry.slice(0, -7); // remove '.beast2'
        hashes.push(fullHash);
      }
    }
  } catch {
    // Directory doesn't exist - hash is unique at minimum length
    return minLength;
  }

  // Find minimum length that disambiguates from all other hashes
  let length = minLength;

  while (length < hash.length) {
    const prefix = hash.slice(0, length);
    const conflicts = hashes.filter(
      (h) => h !== hash && h.startsWith(prefix)
    );

    if (conflicts.length === 0) {
      return length;
    }

    length++;
  }

  return hash.length;
}
