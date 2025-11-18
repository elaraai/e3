/**
 * e3 get command - Retrieve task output or any object by hash
 */

import React from 'react';
import { render } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepository } from '../repo.js';
import { resolveToCommit, resolveObjectHash } from '../resolve.js';
import { Error as ErrorMessage, Info } from '../ui/index.js';
import { decodeBeast2For, decodeBeast2, printFor, toJSONFor, IntegerType, IRType } from '@elaraai/east';

/**
 * Get output of a completed task or retrieve any object by hash
 */
export async function getTaskOutput(
  refOrHash: string,
  format: 'east' | 'json' | 'beast2' = 'east'
): Promise<void> {
  const repoPath = getRepository();

  try {
    // Check if this looks like a hash (not a simple ref name)
    const isHash = /^[0-9a-f]+$/i.test(refOrHash);

    if (isHash) {
      // Try to get object directly by hash
      await getObjectByHash(repoPath, refOrHash, format);
      return;
    }

    // Otherwise, resolve as task ref and get result
    // 1. Resolve to commit
    const commitHash = await resolveToCommit(repoPath, refOrHash);

    // 2. Load commit
    const commitPath = await findCommitFile(repoPath, commitHash);
    const commitText = (await fs.readFile(commitPath, 'utf-8')).trim();

    // 3. Check if task is done
    if (!commitText.startsWith('.task_done')) {
      render(
        <ErrorMessage
          message={`Task '${refOrHash}' has not completed yet`}
          details={[
            commitText.startsWith('.new_task')
              ? 'Status: Pending'
              : commitText.startsWith('.task_error') || commitText.startsWith('.task_fail')
              ? 'Status: Failed'
              : 'Status: Unknown',
          ]}
        />
      );
      process.exit(1);
    }

    // 4. Extract result hash from commit
    const resultMatch = commitText.match(/result="([^"]+)"/);
    if (!resultMatch) {
      throw new Error('Could not find result hash in task_done commit');
    }

    const resultHash = resultMatch[1];

    // 6. Load result blob
    const resultPath = await findResultFile(repoPath, resultHash);
    const resultData = await fs.readFile(resultPath);

    // 7. Output raw beast2 if requested
    if (format === 'beast2') {
      process.stdout.write(resultData);
      return;
    }

    // 8. Decode result (beast2 is self-describing)
    const { type: resultType, value: result } = decodeBeast2(resultData);

    // 9. Output result
    if (format === 'east') {
      const printer = printFor(resultType);
      const output = printer(result);
      console.log(output);
    } else {
      // JSON format - use toJSONFor to properly serialize
      const toJSON = toJSONFor(resultType);
      const jsonResult = toJSON(result);
      console.log(JSON.stringify(jsonResult, null, 2));
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      render(<ErrorMessage message={`Task '${refOrHash}' not found`} />);
    } else {
      render(<ErrorMessage message={`Failed to get output: ${error.message}`} />);
    }
    process.exit(1);
  }
}

/**
 * Get any object by hash
 */
async function getObjectByHash(
  repoPath: string,
  hashOrPartial: string,
  format: 'east' | 'json' | 'beast2'
): Promise<void> {
  // Resolve partial hash to full hash
  const hash = await resolveObjectHash(repoPath, hashOrPartial);

  // Load object
  const objectPath = await findObjectFile(repoPath, hash);
  const objectData = await fs.readFile(objectPath);

  // Check extension to determine how to handle it
  if (objectPath.endsWith('.east')) {
    if (format === 'beast2') {
      // .east file but beast2 requested - just output as-is (text)
      process.stdout.write(objectData);
    } else {
      // Already text, just print
      console.log(objectData.toString('utf-8'));
    }
    return;
  }

  // Beast2 format - output raw binary if requested
  if (format === 'beast2') {
    process.stdout.write(objectData);
    return;
  }

  // Decode beast2 (self-describing format)
  try {
    const { type: objectType, value } = decodeBeast2(objectData);

    if (format === 'east') {
      const printer = printFor(objectType);
      console.log(printer(value));
    } else {
      // JSON format - use toJSONFor to properly serialize
      const toJSON = toJSONFor(objectType);
      const jsonResult = toJSON(value);
      console.log(JSON.stringify(jsonResult, null, 2));
    }
  } catch (error: any) {
    // Failed to decode - show error
    console.log(`<failed to decode beast2: ${error.message}>`);
    console.log(`Hash: ${hash}`);
  }
}

/**
 * Find commit file (try .east then .beast2)
 */
async function findCommitFile(repoPath: string, hash: string): Promise<string> {
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2);

  const eastPath = path.join(repoPath, 'objects', dirName, `${fileName}.east`);
  const beast2Path = path.join(repoPath, 'objects', dirName, `${fileName}.beast2`);

  try {
    await fs.access(eastPath);
    return eastPath;
  } catch {
    return beast2Path;
  }
}

/**
 * Find result file (.beast2)
 */
async function findResultFile(repoPath: string, hash: string): Promise<string> {
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2);

  return path.join(repoPath, 'objects', dirName, `${fileName}.beast2`);
}

/**
 * Find object file (try .beast2, then .east)
 */
async function findObjectFile(repoPath: string, hash: string): Promise<string> {
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2);

  const beast2Path = path.join(repoPath, 'objects', dirName, `${fileName}.beast2`);
  const eastPath = path.join(repoPath, 'objects', dirName, `${fileName}.east`);

  try {
    await fs.access(beast2Path);
    return beast2Path;
  } catch {
    return eastPath;
  }
}
