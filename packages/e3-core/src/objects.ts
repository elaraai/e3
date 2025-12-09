/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

/**
 * Calculate SHA256 hash of data
 */
export function computeHash(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Calculate SHA256 hash of a stream
 */
export async function computeHashFromStream(
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

/**
 * Atomically store an object in the repository
 *
 * @param repoPath - Path to .e3 repository
 * @param data - Data to store
 * @param extension - File extension (e.g., '.beast2', '.east')
 * @returns SHA256 hash of the data
 */
export async function storeObject(
  repoPath: string,
  data: Uint8Array,
  extension: string = '.beast2'
): Promise<string> {
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

  // Write atomically: tmp file + rename
  const tmpPath = path.join(repoPath, 'tmp', `${hash}-${Date.now()}`);
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);

  return hash;
}

/**
 * Atomically store a stream in the repository
 *
 * @param repoPath - Path to .e3 repository
 * @param stream - Stream to store
 * @param extension - File extension (e.g., '.beast2', '.east')
 * @returns SHA256 hash of the data
 */
export async function storeObjectFromStream(
  repoPath: string,
  stream: ReadableStream<Uint8Array>,
  extension: string = '.beast2'
): Promise<string> {
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

  // Write atomically: tmp file + rename
  const tmpPath = path.join(repoPath, 'tmp', `${hash}-${Date.now()}`);

  // Reconstruct stream from collected chunks
  const nodeStream = Readable.from(data);
  const writeStream = createWriteStream(tmpPath);

  await pipeline(nodeStream, writeStream);
  await fs.rename(tmpPath, filePath);

  return hash;
}

/**
 * Load an object from the repository
 *
 * @param repoPath - Path to .e3 repository
 * @param hash - SHA256 hash of the object
 * @param extension - File extension (e.g., '.beast2', '.east')
 * @returns Object data
 */
export async function loadObject(
  repoPath: string,
  hash: string,
  extension: string = '.beast2'
): Promise<Uint8Array> {
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + extension;

  const filePath = path.join(repoPath, 'objects', dirName, fileName);

  try {
    return await fs.readFile(filePath);
  } catch {
    throw new Error(`Object not found: ${hash}`);
  }
}

/**
 * Compute task ID from IR hash, argument hashes, and runtime
 *
 * task_id = SHA256(ir_hash + ":" + arg1_hash + ":" + arg2_hash + ... + [":" + runtime])
 */
export function computeTaskId(
  irHash: string,
  argsHashes: string[],
  runtime?: string
): string {
  const components = [irHash, ...argsHashes];
  if (runtime) {
    components.push(runtime);
  }

  const taskKey = components.join(':');
  return crypto.createHash('sha256').update(taskKey).digest('hex');
}
