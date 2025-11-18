#!/usr/bin/env node

/**
 * E3 CLI - East Execution Engine Command-Line Interface
 *
 * Main entry point for the e3 command-line tool.
 */

import { Command } from 'commander';
import { initRepository } from './commands/init.js';
import { runTask } from './commands/run.js';
import { getTaskStatus } from './commands/status.js';
import { getTaskOutput } from './commands/get.js';
import { listTasks } from './commands/list.js';
import { showLog } from './commands/log.js';

const program = new Command();

program
  .name('e3')
  .description('East Execution Engine - Execute tasks across multiple runtimes')
  .version('0.0.1-alpha.0');

program
  .command('init [path]')
  .description('Initialize a new E3 repository')
  .action(async (path) => {
    await initRepository(path);
  });

program
  .command('run <name> <ir> [args...]')
  .description('Submit a task for execution')
  .option('-r, --runtime <runtime>', 'Runtime to use (node, python, julia)', 'node')
  .action(async (name, ir, args, options) => {
    await runTask(name, ir, args || [], options.runtime);
  });

program
  .command('status <name>')
  .description('Get status of a task')
  .action(async (name) => {
    await getTaskStatus(name);
  });

program
  .command('get <refOrHash>')
  .description('Get output of a completed task or any object by hash')
  .option('-f, --format <format>', 'Output format (east, json)', 'east')
  .action(async (refOrHash, options) => {
    await getTaskOutput(refOrHash, options.format);
  });

program
  .command('list')
  .description('List all task refs')
  .action(async () => {
    await listTasks();
  });

program
  .command('log <refOrHash>')
  .description('Show commit history for a task')
  .action(async (refOrHash) => {
    await showLog(refOrHash);
  });

// TODO: Add additional commands
// - e3 logs <name> [--follow]
// - e3 gc

program.parse();
