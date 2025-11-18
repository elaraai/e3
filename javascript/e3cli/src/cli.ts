#!/usr/bin/env node

/**
 * E3 CLI - East Execution Engine Command-Line Interface
 *
 * Main entry point for the e3 command-line tool.
 */

import { Command } from 'commander';
import { initRepository } from './commands/init.js';
import { runTask } from './commands/run.js';

const program = new Command();

program
  .name('e3')
  .description('East Execution Engine - Execute tasks across multiple runtimes')
  .version('0.0.1-alpha.0');

// TODO: Add commands
// - e3 get <name>
// - e3 list
// - e3 logs <name> [--follow]
// - e3 status
// - e3 gc

program
  .command('init [path]')
  .description('Initialize a new E3 repository')
  .action(async (path) => {
    await initRepository(path);
  });

program
  .command('run <name> <ir>')
  .description('Submit a task for execution')
  .option('-r, --runtime <runtime>', 'Runtime to use (node, python, julia)', 'node')
  .action(async (name, ir, options) => {
    await runTask(name, ir, options.runtime);
  });

program.parse();
