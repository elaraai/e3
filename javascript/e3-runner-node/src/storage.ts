/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  decodeBeast2For,
  encodeBeast2For,
  parseFor,
  printFor,
  variant,
  IRType,
  type IR,
} from '@elaraai/east';
import { CommitType, type Commit } from '@elaraai/e3-types';
import { EastTypeValue } from '../../../../East/dist/src/type_of_type.js';

// Commit types are now imported from @elaraai/e3-types

/**
 * Load an object from content-addressable storage
 */
export async function loadObject(
  repoPath: string,
  hash: string,
  extension: string = '.beast2'
): Promise<Uint8Array> {
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + extension;
  const filePath = path.join(repoPath, 'objects', dirName, fileName);

  return await fs.readFile(filePath);
}

/**
 * Load and decode a commit
 */
export async function loadCommit(
  repoPath: string,
  commitHash: string
): Promise<Commit> {
  // Commits can be stored as .east or .beast2
  // Try .east first (for debugging), then .beast2

  // TODO we should probably standardize on one format

  try {
    const data = await loadObject(repoPath, commitHash, '.east');
    const text = new TextDecoder().decode(data);

    // Parse .east format using East's parser
    const parser = parseFor(CommitType);
    const result = parser(text);

    if (!result.success) {
      throw new Error(`Failed to parse .east commit: ${result.error}`);
    }

    return result.value;
  } catch (eastError) {
    try {
      const data = await loadObject(repoPath, commitHash, '.beast2');

      // Decode Beast2 format using CommitType
      const decoder = decodeBeast2For(CommitType);
      return decoder(data);
    } catch (beast2Error) {
      throw new Error(`Failed to load commit: ${eastError} / ${beast2Error}`);
    }
  }
}

/**
 * Load and decode IR
 */
export async function loadIR(
  repoPath: string,
  irHash: string
): Promise<IR> {
  const data = await loadObject(repoPath, irHash, '.beast2');
  const decoder = decodeBeast2For(IRType);
  return decoder(data) as IR;
}

/**
 * Load and decode an argument blob
 */
export async function loadArg(
  repoPath: string,
  argHash: string,
  argType: EastTypeValue
): Promise<any> {
  const data = await loadObject(repoPath, argHash, '.beast2');
  const decoder = decodeBeast2For(argType);
  return decoder(data);
}

/**
 * Read commit hash from queue or claim file
 */
export async function readCommitHashFromFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  return content.trim();
}

/**
 * Compute SHA256 hash of data
 */
export function computeHash(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Store an object in content-addressable storage
 */
export async function storeObject(
  repoPath: string,
  data: Uint8Array,
  extension: string = '.beast2'
): Promise<string> {
  const hash = computeHash(data);
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + extension;
  const dirPath = path.join(repoPath, 'objects', dirName);
  const filePath = path.join(dirPath, fileName);

  // Check if already exists
  try {
    await fs.access(filePath);
    return hash; // Already exists
  } catch {
    // Doesn't exist, store it
  }

  // Create directory
  await fs.mkdir(dirPath, { recursive: true });

  // Atomic write via tmp/
  const tmpPath = path.join(repoPath, 'tmp', `${hash}-${Date.now()}`);
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);

  return hash;
}

/**
 * Store a result value
 */
export async function storeResult(
  repoPath: string,
  result: any,
  resultType: EastTypeValue
): Promise<string> {
  // Encode result as Beast2
  const encoder = encodeBeast2For(resultType);
  const data = encoder(result);

  return await storeObject(repoPath, data, '.beast2');
}

/**
 * Create and store a task_done commit
 */
export async function createTaskDoneCommit(
  repoPath: string,
  parentCommitHash: string,
  resultHash: string,
  runtime: string,
  executionTimeUs: number
): Promise<string> {
  const timestamp = new Date().toISOString();

  const commit: Commit = variant('task_done', {
    parent: parentCommitHash,
    result: resultHash,
    runtime,
    execution_time_us: BigInt(executionTimeUs),
    timestamp,
  });

  const printer = printFor(CommitType);
  const commitText = printer(commit);
  const commitData = new TextEncoder().encode(commitText);

  return await storeObject(repoPath, commitData, '.east');
}

/**
 * Update task state to point to new commit
 */
export async function updateTaskState(
  repoPath: string,
  taskId: string,
  commitHash: string
): Promise<void> {
  const taskStatePath = path.join(repoPath, 'tasks', taskId);
  await fs.writeFile(taskStatePath, commitHash);
}
