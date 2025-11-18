#!/usr/bin/env node
/**
 * E3 Node.js Runner - Execute East tasks in the Node.js runtime
 */

import { Command } from 'commander';
import { getRepository } from './repo.js';
import { QueueManager } from './queue.js';
import { executeTask } from './executor.js';

const program = new Command();

program
  .name('e3-runner-node')
  .description('E3 Node.js Runner - Execute East tasks in the Node.js runtime')
  .version('0.0.1-alpha.0')
  .option('-r, --repo <path>', 'Path to E3 repository (default: E3_REPO env or ~/.e3)')
  .action(async (options) => {
    // Validate repository exists
    const repoPath = getRepository(options.repo);

    console.log(`E3 Node.js Runner`);
    console.log(`Repository: ${repoPath}`);
    console.log('');

    // Start queue manager
    const queue = new QueueManager(repoPath, 'node');
    queue.start();

    // Main loop: process tasks
    const processLoop = async () => {
      while (true) {
        const taskId = queue.getNextTask();

        if (taskId) {
          // Try to claim the task
          const claimed = queue.claimTask(taskId);

          if (claimed) {
            try {
              // Execute task
              await executeTask(repoPath, 'node', taskId, queue.getWorkerId());
            } catch (error) {
              console.error(`Failed to execute task ${taskId}:`, error);
            } finally {
              // Always release claim
              queue.releaseClaim(taskId);
            }
          } else {
            console.log(`Task already claimed: ${taskId}`);
          }
        } else {
          // No tasks, wait a bit
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    };

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      queue.stop();
      process.exit(0);
    });

    // Start processing
    console.log('Processing tasks...');
    await processLoop();
  });

program.parse();
