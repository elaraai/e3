/**
 * e3 log command - Show commit history (git log style)
 */

import React from 'react';
import { render, Box, Text } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepository } from '../repo.js';
import { resolveToCommit } from '../resolve.js';
import { Error as ErrorMessage } from '../ui/index.js';
import { parseFor, decodeBeast2For } from '@elaraai/east';
import { CommitType, type Commit } from '@elaraai/e3-types';

/**
 * Commit history entry
 */
export interface CommitHistoryEntry {
  hash: string;
  commit: Commit;
}

/**
 * Result of getting commit history
 */
export interface GetCommitHistoryResult {
  success: boolean;
  history?: CommitHistoryEntry[];
  error?: Error;
}

/**
 * Core logic for retrieving commit history
 * This function is decoupled from CLI/UI concerns and can be used programmatically
 */
export async function getCommitHistoryCore(refOrHash: string): Promise<GetCommitHistoryResult> {
  const repoPath = getRepository();

  try {
    // Resolve to initial commit
    let commitHash: string | null = await resolveToCommit(repoPath, refOrHash);

    const commits: CommitHistoryEntry[] = [];

    // Walk commit chain backwards
    while (commitHash) {
      const commit = await loadCommit(repoPath, commitHash);
      commits.push({
        hash: commitHash,
        commit,
      });

      // Get parent from commit
      if (commit.type === 'new_task') {
        const parent = commit.value.parent;
        commitHash = parent.type === 'Some' ? parent.value : null;
      } else {
        commitHash = commit.value.parent;
      }
    }

    return {
      success: true,
      history: commits,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * CLI handler for the log command
 * This function handles the UI/presentation layer
 */
export async function showLog(refOrHash: string): Promise<void> {
  const result = await getCommitHistoryCore(refOrHash);

  if (!result.success) {
    render(<ErrorMessage message={`Failed to show log: ${result.error?.message}`} />);
    process.exit(1);
  }

  const commits = result.history!;

  // Display commits
  render(
    <Box flexDirection="column">
      {commits.map((item, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="yellow" bold>
              commit {item.hash.slice(0, 12)}
            </Text>
          </Box>

          {item.commit.type === 'new_task' && (
            <Box flexDirection="column" marginLeft={2}>
              <Text>
                <Text color="green">Type:</Text> Task submission
              </Text>
              <Text>
                <Text color="green">Task ID:</Text> {item.commit.value.task_id.slice(0, 12)}
              </Text>
              <Text>
                <Text color="green">IR:</Text> {item.commit.value.ir.slice(0, 12)}
              </Text>
              <Text>
                <Text color="green">Args:</Text> [{item.commit.value.args.length} arguments]
              </Text>
              <Text>
                <Text color="green">Runtime:</Text> {item.commit.value.runtime}
              </Text>
              <Text>
                <Text color="green">Timestamp:</Text> {item.commit.value.timestamp}
              </Text>
            </Box>
          )}

          {item.commit.type === 'task_done' && (
            <Box flexDirection="column" marginLeft={2}>
              <Text>
                <Text color="green">Type:</Text> Task completed
              </Text>
              <Text>
                <Text color="green">Result:</Text> {item.commit.value.result.slice(0, 12)}
              </Text>
              <Text>
                <Text color="green">Runtime:</Text> {item.commit.value.runtime}
              </Text>
              <Text>
                <Text color="green">Execution time:</Text>{' '}
                {(Number(item.commit.value.execution_time_us) / 1000).toFixed(2)}ms
              </Text>
              <Text>
                <Text color="green">Timestamp:</Text> {item.commit.value.timestamp}
              </Text>
            </Box>
          )}

          {(item.commit.type === 'task_error' || item.commit.type === 'task_fail') && (
            <Box flexDirection="column" marginLeft={2}>
              <Text>
                <Text color="red">Type:</Text> Task failed
              </Text>
              <Text>
                <Text color="red">Error:</Text> {item.commit.value.error_message}
              </Text>
              <Text>
                <Text color="green">Runtime:</Text> {item.commit.value.runtime}
              </Text>
              <Text>
                <Text color="green">Timestamp:</Text> {item.commit.value.timestamp}
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

/**
 * Load and decode a commit
 */
async function loadCommit(repoPath: string, commitHash: string): Promise<Commit> {
  // Try .east first (for debugging), then .beast2
  try {
    const commitPath = await findCommitFile(repoPath, commitHash);
    const data = await fs.readFile(commitPath);

    if (commitPath.endsWith('.east')) {
      const text = new TextDecoder().decode(data);
      const parser = parseFor(CommitType);
      const result = parser(text);

      if (!result.success) {
        throw new Error(`Failed to parse .east commit: ${result.error}`);
      }

      return result.value;
    } else {
      // .beast2 format
      const decoder = decodeBeast2For(CommitType);
      return decoder(data);
    }
  } catch (error: any) {
    throw new Error(`Failed to load commit ${commitHash}: ${error.message}`);
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