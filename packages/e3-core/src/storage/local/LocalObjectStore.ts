/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem implementation of object storage.
 *
 * Objects are stored as files in a content-addressed layout:
 * - objects/<hash[0..2]>/<hash[2..]>.beast2
 *
 * Writes are atomic using stage-and-rename pattern:
 * 1. Write to a temporary .partial file
 * 2. Rename to final destination (atomic on POSIX filesystems)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { ObjectNotFoundError, isNotFoundError } from '../../errors.js';
import { objectPath } from './localHelpers.js';
import type { ObjectStore } from '../interfaces.js';

// =============================================================================
// Hash Computation
// =============================================================================

/**
 * Calculate SHA256 hash of a stream
 * @internal
 */
async function computeHashFromStream(
  stream: ReadableStream<Uint8Array>
): Promise<{ hash: string; data: Uint8Array[] }> {
  const hash = crypto.createHash('sha256');
  const chunks: Uint8Array[] = [];

  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    hash.update(value);
    chunks.push(value);
  }

  return {
    hash: hash.digest('hex'),
    data: chunks,
  };
}

// =============================================================================
// Standalone Functions (for backwards compatibility)
// =============================================================================

/**
 * Atomically write an object to the repository.
 *
 * @param repoPath - Path to e3 repository
 * @param data - Data to store
 * @returns SHA256 hash of the data
 */
export async function objectWrite(
  repoPath: string,
  data: Uint8Array
): Promise<string> {
  const { computeHash } = await import('../../objects.js');
  const extension = '.beast2';
  const hash = computeHash(data);

  // Split hash: first 2 chars as directory
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + extension;

  const dirPath = path.join(repoPath, 'objects', dirName);
  const filePath = path.join(dirPath, fileName);

  // Check if already exists
  try {
    await fs.access(filePath);
    return hash; // Already exists
  } catch {
    // Doesn't exist, continue
  }

  // Create directory if needed
  await fs.mkdir(dirPath, { recursive: true });

  // Write atomically: stage in same directory (same filesystem) + rename
  // Staging files use .partial extension; gc can clean up any orphaned ones
  // Use random suffix to avoid collisions with concurrent writes
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const stagingPath = path.join(dirPath, `${fileName}.${Date.now()}.${randomSuffix}.partial`);
  await fs.writeFile(stagingPath, data);

  try {
    await fs.rename(stagingPath, filePath);
  } catch (err) {
    // If rename fails because target exists (concurrent write won), that's fine
    // Clean up our staging file
    try {
      await fs.unlink(stagingPath);
    } catch {
      // Ignore cleanup errors
    }
    // Verify the file exists (another writer should have created it)
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist and rename failed - re-throw original error
      throw err;
    }
  }

  return hash;
}

/**
 * Atomically write a stream to the repository.
 *
 * @param repoPath - Path to e3 repository
 * @param stream - Stream to store
 * @returns SHA256 hash of the data
 */
export async function objectWriteStream(
  repoPath: string,
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const extension = '.beast2';
  // First pass: compute hash while collecting data
  const { hash, data } = await computeHashFromStream(stream);

  // Split hash: first 2 chars as directory
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + extension;

  const dirPath = path.join(repoPath, 'objects', dirName);
  const filePath = path.join(dirPath, fileName);

  // Check if already exists
  try {
    await fs.access(filePath);
    return hash; // Already exists
  } catch {
    // Doesn't exist, continue
  }

  // Create directory if needed
  await fs.mkdir(dirPath, { recursive: true });

  // Write atomically: stage in same directory (same filesystem) + rename
  // Staging files use .partial extension; gc can clean up any orphaned ones
  // Use random suffix to avoid collisions with concurrent writes
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const stagingPath = path.join(dirPath, `${fileName}.${Date.now()}.${randomSuffix}.partial`);

  // Reconstruct stream from collected chunks
  const nodeStream = Readable.from(data);
  const writeStream = createWriteStream(stagingPath);

  await pipeline(nodeStream, writeStream);

  try {
    await fs.rename(stagingPath, filePath);
  } catch (err) {
    // If rename fails because target exists (concurrent write won), that's fine
    // Clean up our staging file
    try {
      await fs.unlink(stagingPath);
    } catch {
      // Ignore cleanup errors
    }
    // Verify the file exists (another writer should have created it)
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist and rename failed - re-throw original error
      throw err;
    }
  }

  return hash;
}

/**
 * Read an object from the repository.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - SHA256 hash of the object
 * @returns Object data
 * @throws {ObjectNotFoundError} If object not found
 */
export async function objectRead(
  repoPath: string,
  hash: string
): Promise<Uint8Array> {
  const extension = '.beast2';
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + extension;

  const filePath = path.join(repoPath, 'objects', dirName, fileName);

  try {
    return await fs.readFile(filePath);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new ObjectNotFoundError(hash);
    }
    throw err;
  }
}

/**
 * Check if an object exists in the repository.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - SHA256 hash of the object
 * @returns true if object exists
 */
export async function objectExists(
  repoPath: string,
  hash: string
): Promise<boolean> {
  const filePath = objectPath(repoPath, hash);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// ObjectStore Interface Implementation
// =============================================================================

/**
 * Local filesystem implementation of ObjectStore.
 *
 * The `repo` parameter is the path to the e3 repository directory.
 */
export class LocalObjectStore implements ObjectStore {
  async write(repo: string, data: Uint8Array): Promise<string> {
    return objectWrite(repo, data);
  }

  async writeStream(repo: string, stream: AsyncIterable<Uint8Array>): Promise<string> {
    // Convert AsyncIterable to ReadableStream for objectWriteStream
    const readableStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const chunk of stream) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    return objectWriteStream(repo, readableStream);
  }

  async read(repo: string, hash: string): Promise<Uint8Array> {
    return objectRead(repo, hash);
  }

  async exists(repo: string, hash: string): Promise<boolean> {
    return objectExists(repo, hash);
  }

  async stat(repo: string, hash: string): Promise<{ size: number }> {
    const filePath = objectPath(repo, hash);
    try {
      const stats = await fs.stat(filePath);
      return { size: stats.size };
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new ObjectNotFoundError(hash);
      }
      throw err;
    }
  }

  async list(repo: string): Promise<string[]> {
    const objectsDir = path.join(repo, 'objects');
    const hashes: string[] = [];

    try {
      const prefixDirs = await fs.readdir(objectsDir);

      for (const prefix of prefixDirs) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) continue;

        const prefixPath = path.join(objectsDir, prefix);
        const stat = await fs.stat(prefixPath);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(prefixPath);
        for (const file of files) {
          if (file.endsWith('.beast2') && !file.includes('.partial')) {
            // Reconstruct full hash: prefix + filename without extension
            const hash = prefix + file.slice(0, -7);
            hashes.push(hash);
          }
        }
      }
    } catch (err) {
      // Only suppress ENOENT - directory may not exist yet
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return hashes;
  }

  async count(repo: string): Promise<number> {
    const objectsDir = path.join(repo, 'objects');
    let count = 0;

    try {
      const prefixDirs = await fs.readdir(objectsDir);

      for (const prefix of prefixDirs) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) continue;

        const prefixPath = path.join(objectsDir, prefix);
        const files = await fs.readdir(prefixPath);
        for (const file of files) {
          if (file.endsWith('.beast2') && !file.includes('.partial')) {
            count++;
          }
        }
      }
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return count;
  }
}
