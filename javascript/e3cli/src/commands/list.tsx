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
 * A task reference with its name and ID
 */
export interface TaskRef {
  name: string;
  taskId: string;
}

/**
 * Result of listing tasks
 */
export interface ListTasksResult {
  success: boolean;
  tasks?: TaskRef[];
  error?: Error;
  noTasksFound?: boolean;
}

/**
 * Core logic for listing all task refs
 * This function is decoupled from CLI/UI concerns and can be used programmatically
 */
export async function listTasksCore(): Promise<ListTasksResult> {
  const repoPath = getRepository();

  try {
    const refsDir = path.join(repoPath, 'refs', 'tasks');

    try {
      const files = await fs.readdir(refsDir);

      if (files.length === 0) {
        return {
          success: true,
          tasks: [],
          noTasksFound: true,
        };
      }

      // Read task IDs for each ref
      const tasks: TaskRef[] = [];

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

      return {
        success: true,
        tasks,
        noTasksFound: tasks.length === 0,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // refs/tasks directory doesn't exist - this is normal for a new repo
        return {
          success: true,
          tasks: [],
          noTasksFound: true,
        };
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * CLI handler for the list command
 * This function handles the UI/presentation layer
 */
export async function listTasks(): Promise<void> {
  const result = await listTasksCore();

  if (!result.success) {
    render(<ErrorMessage message={`Failed to list tasks: ${result.error?.message}`} />);
    process.exit(1);
  }

  if (result.noTasksFound || !result.tasks || result.tasks.length === 0) {
    console.log('No tasks found');
    return;
  }

  // Display
  render(
    <Box flexDirection="column">
      {result.tasks.map(({ name, taskId }) => (
        <Box key={name}>
          <Text color="cyan" bold>
            {name}
          </Text>
          <Text dimColor> → {taskId.slice(0, 12)}</Text>
        </Box>
      ))}
    </Box>
  );
}
