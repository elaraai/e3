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

/**
 * Show commit history for a task
 */
export async function showLog(refOrHash: string): Promise<void> {
  const repoPath = getRepository();

  try {
    // Resolve to initial commit
    let commitHash = await resolveToCommit(repoPath, refOrHash);

    const commits: Array<{
      hash: string;
      type: string;
      data: Record<string, any>;
    }> = [];

    // Walk commit chain backwards
    while (commitHash) {
      const commitPath = await findCommitFile(repoPath, commitHash);
      const commitText = (await fs.readFile(commitPath, 'utf-8')).trim();

      const parsed = parseCommit(commitText);
      commits.push({
        hash: commitHash,
        type: parsed.type,
        data: parsed.data,
      });

      // Get parent
      commitHash = parsed.data.parent || null;
    }

    // Display commits
    render(
      <Box flexDirection="column">
        {commits.map((commit, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color="yellow" bold>
                commit {commit.hash.slice(0, 12)}
              </Text>
            </Box>

            {commit.type === 'new_task' && (
              <Box flexDirection="column" marginLeft={2}>
                <Text>
                  <Text color="green">Type:</Text> Task submission
                </Text>
                <Text>
                  <Text color="green">Task ID:</Text> {commit.data.task_id?.slice(0, 12)}
                </Text>
                <Text>
                  <Text color="green">IR:</Text> {commit.data.ir?.slice(0, 12)}
                </Text>
                <Text>
                  <Text color="green">Args:</Text> [{commit.data.args?.length || 0} arguments]
                </Text>
                <Text>
                  <Text color="green">Runtime:</Text> {commit.data.runtime}
                </Text>
                <Text>
                  <Text color="green">Timestamp:</Text> {commit.data.timestamp}
                </Text>
              </Box>
            )}

            {commit.type === 'task_done' && (
              <Box flexDirection="column" marginLeft={2}>
                <Text>
                  <Text color="green">Type:</Text> Task completed
                </Text>
                <Text>
                  <Text color="green">Result:</Text> {commit.data.result?.slice(0, 12)}
                </Text>
                <Text>
                  <Text color="green">Runtime:</Text> {commit.data.runtime}
                </Text>
                <Text>
                  <Text color="green">Execution time:</Text>{' '}
                  {((commit.data.execution_time_us || 0) / 1000).toFixed(2)}ms
                </Text>
                <Text>
                  <Text color="green">Timestamp:</Text> {commit.data.timestamp}
                </Text>
              </Box>
            )}

            {(commit.type === 'task_error' || commit.type === 'task_fail') && (
              <Box flexDirection="column" marginLeft={2}>
                <Text>
                  <Text color="red">Type:</Text> Task failed
                </Text>
                <Text>
                  <Text color="red">Error:</Text> {commit.data.error_message}
                </Text>
                <Text>
                  <Text color="green">Runtime:</Text> {commit.data.runtime}
                </Text>
                <Text>
                  <Text color="green">Timestamp:</Text> {commit.data.timestamp}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    );
  } catch (error: any) {
    render(<ErrorMessage message={`Failed to show log: ${error.message}`} />);
    process.exit(1);
  }
}

/**
 * Parse commit text
 */
function parseCommit(text: string): { type: string; data: Record<string, any> } {
  const trimmed = text.trim();

  // Extract type
  const typeMatch = trimmed.match(/^\.(\w+)\s*\(/);
  if (!typeMatch) {
    throw new Error('Invalid commit format');
  }

  const type = typeMatch[1];

  // Extract fields (simple regex-based parsing)
  const data: Record<string, any> = {};

  // Extract all field="value" pairs
  const stringFields = trimmed.matchAll(/(\w+)="([^"]+)"/g);
  for (const match of stringFields) {
    data[match[1]] = match[2];
  }

  // Extract numeric fields
  const numFields = trimmed.matchAll(/(\w+)=(\d+)/g);
  for (const match of numFields) {
    if (!data[match[1]]) {
      // Don't override string fields
      data[match[1]] = parseInt(match[2], 10);
    }
  }

  // Extract null fields
  const nullFields = trimmed.matchAll(/(\w+)=null/g);
  for (const match of nullFields) {
    data[match[1]] = null;
  }

  // Extract array fields
  const argsMatch = trimmed.match(/args=\[([^\]]*)\]/);
  if (argsMatch) {
    const argsStr = argsMatch[1].trim();
    data.args = argsStr ? argsStr.split(',').map(s => s.trim().replace(/"/g, '')) : [];
  }

  return { type, data };
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
