/**
 * Object storage helpers for loading commits, IR, and results
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  decodeBeast2For,
  decodeBeast2,
  encodeBeast2For,
  parseFor,
  printFor,
  IRType,
  type IR,
} from '@elaraai/east';

/**
 * Commit type definitions
 */
export interface NewTaskCommit {
  tag: 'new_task';
  value: {
    task_id: string;
    ir: string;
    args: string[];
    runtime: string;
    parent: string | null;
    timestamp: string;
  };
}

export interface TaskDoneCommit {
  tag: 'task_done';
  value: {
    parent: string;
    result: string;
    runtime: string;
    execution_time_us: number;
    timestamp: string;
  };
}

export interface TaskErrorCommit {
  tag: 'task_error';
  value: {
    parent: string;
    error_message: string;
    error_stack: string[];
    runtime: string;
    execution_time_us: number;
    timestamp: string;
  };
}

export interface TaskFailCommit {
  tag: 'task_fail';
  value: {
    parent: string;
    error_message: string;
    runtime: string;
    execution_time_us: number;
    timestamp: string;
  };
}

export type Commit = NewTaskCommit | TaskDoneCommit | TaskErrorCommit | TaskFailCommit;

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

  try {
    const data = await loadObject(repoPath, commitHash, '.east');
    const text = new TextDecoder().decode(data);

    // For now, manually parse the .east commit format
    // Format: .new_task (task_id="...", ir="...", args=[], runtime="...", parent=null, timestamp="...")
    const trimmed = text.trim();

    if (trimmed.startsWith('.new_task')) {
      // Extract the struct content
      const match = trimmed.match(/^\.new_task\s*\(([\s\S]+)\)$/);
      if (!match) {
        throw new Error('Invalid .new_task commit format');
      }

      // Parse the fields (simple regex-based parser for now)
      const fields = match[1];
      const taskIdMatch = fields.match(/task_id="([^"]+)"/);
      const irMatch = fields.match(/ir="([^"]+)"/);
      const argsMatch = fields.match(/args=\[([^\]]*)\]/);
      const runtimeMatch = fields.match(/runtime="([^"]+)"/);
      const parentMatch = fields.match(/parent=(null|"[^"]+")/);
      const timestampMatch = fields.match(/timestamp="?([^",)]+)"?/);

      if (!taskIdMatch || !irMatch || !argsMatch || !runtimeMatch) {
        throw new Error('Missing required fields in .new_task commit');
      }

      // Parse args array
      const argsStr = argsMatch[1].trim();
      const args = argsStr ? argsStr.split(',').map(s => s.trim().replace(/"/g, '')) : [];

      return {
        tag: 'new_task',
        value: {
          task_id: taskIdMatch[1],
          ir: irMatch[1],
          args,
          runtime: runtimeMatch[1],
          parent: parentMatch![1] === 'null' ? null : parentMatch![1].replace(/"/g, ''),
          timestamp: timestampMatch![1],
        },
      } as Commit;
    }

    throw new Error('Unsupported commit type (only .new_task supported)');
  } catch (eastError) {
    try {
      const data = await loadObject(repoPath, commitHash, '.beast2');

      // Decode Beast2 format
      // TODO: Use proper CommitType
      const decoder = decodeBeast2For(IRType as any);
      return decoder(data) as Commit;
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
  argType: any
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
  resultType: any
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

  // Format commit as .east
  const commitText = `.task_done (parent="${parentCommitHash}", result="${resultHash}", runtime="${runtime}", execution_time_us=${executionTimeUs}, timestamp="${timestamp}")`;

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
