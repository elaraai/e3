/**
 * e3 get command - Retrieve task output or any object by hash
 */

import { render } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveToCommit, resolveObjectHash } from '@elaraai/e3-core';
import { Error as ErrorMessage } from '../ui/index.js';
import { decodeBeast2, printFor, toJSONFor } from '@elaraai/east';

/**
 * Output format type
 */
export type OutputFormat = 'east' | 'json' | 'beast2';

/**
 * Task output retrieval result
 */
export interface GetTaskOutputResult {
  success: boolean;
  data?: string | Buffer;
  format?: OutputFormat;
  taskStatus?: 'pending' | 'done' | 'error' | 'failed' | 'unknown';
  error?: Error;
  notFound?: boolean;
  notCompleted?: boolean;
}

/**
 * Object retrieval result
 */
export interface GetObjectResult {
  success: boolean;
  data?: string | Buffer;
  format?: OutputFormat;
  hash?: string;
  error?: Error;
  decodeError?: boolean;
}

/**
 * Core logic for retrieving task output or object by hash
 * This function is decoupled from CLI/UI concerns and can be used programmatically
 */
export async function getTaskOutputCore(
  repoPath: string,
  refOrHash: string,
  format: OutputFormat = 'east'
): Promise<GetTaskOutputResult> {
  try {
    // Check if this looks like a hash (not a simple ref name)
    const isHash = /^[0-9a-f]+$/i.test(refOrHash);

    if (isHash) {
      // Try to get object directly by hash
      const objResult = await getObjectByHashCore(repoPath, refOrHash, format);
      if (!objResult.success) {
        return {
          success: false,
          error: objResult.error,
          notFound: objResult.error?.message.includes('not found'),
        };
      }
      return {
        success: true,
        data: objResult.data,
        format: objResult.format,
      };
    }

    // Otherwise, resolve as task ref and get result
    // 1. Resolve to commit
    const commitHash = await resolveToCommit(repoPath, refOrHash);

    // 2. Load commit
    const commitPath = await findCommitFile(repoPath, commitHash);
    const commitText = (await fs.readFile(commitPath, 'utf-8')).trim();

    // 3. Check if task is done
    if (!commitText.startsWith('.task_done')) {
      const taskStatus = commitText.startsWith('.new_task')
        ? 'pending'
        : commitText.startsWith('.task_error')
        ? 'error'
        : commitText.startsWith('.task_fail')
        ? 'failed'
        : 'unknown';

      return {
        success: false,
        notCompleted: true,
        taskStatus,
        error: new Error(`Task '${refOrHash}' has not completed yet`),
      };
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

    // 7. Return raw beast2 if requested
    if (format === 'beast2') {
      return {
        success: true,
        data: resultData,
        format: 'beast2',
        taskStatus: 'done',
      };
    }

    // 8. Decode result (beast2 is self-describing)
    const { type: resultType, value: result } = decodeBeast2(resultData);

    // 9. Format result
    let outputData: string;
    if (format === 'east') {
      const printer = printFor(resultType);
      outputData = printer(result);
    } else {
      // JSON format - use toJSONFor to properly serialize
      const toJSON = toJSONFor(resultType);
      const jsonResult = toJSON(result);
      outputData = JSON.stringify(jsonResult, null, 2);
    }

    return {
      success: true,
      data: outputData,
      format,
      taskStatus: 'done',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      notFound: error.code === 'ENOENT',
    };
  }
}

/**
 * Core logic for getting any object by hash
 */
export async function getObjectByHashCore(
  repoPath: string,
  hashOrPartial: string,
  format: OutputFormat
): Promise<GetObjectResult> {
  try {
    // Resolve partial hash to full hash
    const hash = await resolveObjectHash(repoPath, hashOrPartial);

    // Load object
    const objectPath = await findObjectFile(repoPath, hash);
    const objectData = await fs.readFile(objectPath);

    // Check extension to determine how to handle it
    if (objectPath.endsWith('.east')) {
      if (format === 'beast2') {
        // .east file but beast2 requested - return as-is (text)
        return {
          success: true,
          data: objectData,
          format: 'beast2',
          hash,
        };
      } else {
        // Already text, return as string
        return {
          success: true,
          data: objectData.toString('utf-8'),
          format: 'east',
          hash,
        };
      }
    }

    // Beast2 format - return raw binary if requested
    if (format === 'beast2') {
      return {
        success: true,
        data: objectData,
        format: 'beast2',
        hash,
      };
    }

    // Decode beast2 (self-describing format)
    try {
      const { type: objectType, value } = decodeBeast2(objectData);

      let outputData: string;
      if (format === 'east') {
        const printer = printFor(objectType);
        outputData = printer(value);
      } else {
        // JSON format - use toJSONFor to properly serialize
        const toJSON = toJSONFor(objectType);
        const jsonResult = toJSON(value);
        outputData = JSON.stringify(jsonResult, null, 2);
      }

      return {
        success: true,
        data: outputData,
        format,
        hash,
      };
    } catch (error: any) {
      // Failed to decode
      return {
        success: false,
        decodeError: true,
        hash,
        error: new Error(`Failed to decode beast2: ${error.message}`),
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * CLI handler for the get command
 * This function handles the UI/presentation layer
 */
export async function getTaskOutput(
  repoPath: string,
  refOrHash: string,
  format: OutputFormat = 'east'
): Promise<void> {
  const result = await getTaskOutputCore(repoPath, refOrHash, format);

  if (!result.success) {
    if (result.notCompleted) {
      render(
        <ErrorMessage
          message={`Task '${refOrHash}' has not completed yet`}
          details={[
            result.taskStatus === 'pending'
              ? 'Status: Pending'
              : result.taskStatus === 'error'
              ? 'Status: Error'
              : result.taskStatus === 'failed'
              ? 'Status: Failed'
              : 'Status: Unknown',
          ]}
        />
      );
    } else if (result.notFound) {
      render(<ErrorMessage message={`Task '${refOrHash}' not found`} />);
    } else {
      render(<ErrorMessage message={`Failed to get output: ${result.error?.message}`} />);
    }
    process.exit(1);
  }

  // Output the data
  if (result.data instanceof Buffer) {
    process.stdout.write(result.data);
  } else if (result.data) {
    console.log(result.data);
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
