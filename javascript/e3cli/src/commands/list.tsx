/**
 * e3 list command - List all task refs
 */

import React from 'react';
import { render, Box, Text } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepository } from '../repo.js';
import { Error as ErrorMessage } from '../ui/index.js';

/**
 * List all task refs
 */
export async function listTasks(): Promise<void> {
  const repoPath = getRepository();

  try {
    const refsDir = path.join(repoPath, 'refs', 'tasks');

    try {
      const files = await fs.readdir(refsDir);

      if (files.length === 0) {
        console.log('No tasks found');
        return;
      }

      // Read task IDs for each ref
      const tasks: Array<{ name: string; taskId: string }> = [];

      for (const name of files) {
        const refPath = path.join(refsDir, name);
        const stat = await fs.stat(refPath);

        if (stat.isFile()) {
          const taskId = (await fs.readFile(refPath, 'utf-8')).trim();
          tasks.push({ name, taskId });
        }
      }

      // Sort by name
      tasks.sort((a, b) => a.name.localeCompare(b.name));

      // Display
      render(
        <Box flexDirection="column">
          {tasks.map(({ name, taskId }) => (
            <Box key={name}>
              <Text color="cyan" bold>
                {name}
              </Text>
              <Text dimColor> → {taskId.slice(0, 12)}</Text>
            </Box>
          ))}
        </Box>
      );
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('No tasks found');
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    render(<ErrorMessage message={`Failed to list tasks: ${error.message}`} />);
    process.exit(1);
  }
}
