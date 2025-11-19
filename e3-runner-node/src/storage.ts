/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as fs from 'fs/promises';
import { decodeBeast2For, encodeBeast2For, IRType, type IR } from '@elaraai/east';
import { type Commit } from '@elaraai/e3-types';
import { EastTypeValue } from '../../../East/dist/src/type_of_type.js';

// Re-export commonly used functions from e3-core
export {
  loadObject,
  storeObject,
  loadCommit,
  createTaskDoneCommit,
  updateTaskState,
} from '@elaraai/e3-core';

/**
 * Load and decode IR
 */
export async function loadIR(
  repoPath: string,
  irHash: string
): Promise<IR> {
  const { loadObject } = await import('@elaraai/e3-core');
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
  const { loadObject } = await import('@elaraai/e3-core');
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
 * Store a result value
 */
export async function storeResult(
  repoPath: string,
  result: any,
  resultType: EastTypeValue
): Promise<string> {
  const { storeObject } = await import('@elaraai/e3-core');

  // Encode result as Beast2
  const encoder = encodeBeast2For(resultType);
  const data = encoder(result);

  return await storeObject(repoPath, data, '.beast2');
}
