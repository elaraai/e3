#!/usr/bin/env node

/**
 * E3 CLI - East Execution Engine Command-Line Interface
 *
 * Main entry point for the e3 command-line tool.
 */

import { Command } from 'commander';

const program = new Command();

program
  .name('e3')
  .description('East Execution Engine - Execute tasks across multiple runtimes')
  .version('0.0.1-alpha.0');

// TODO: Add commands
// - e3 init [path]
// - e3 run <name> <ir> [args...]
// - e3 get <name>
// - e3 list
// - e3 logs <name> [--follow]
// - e3 status
// - e3 gc

program
  .command('init [path]')
  .description('Initialize a new E3 repository')
  .action((path) => {
    console.log(`TODO: Initialize E3 repository at ${path || '.'}`);
  });

program.parse();
