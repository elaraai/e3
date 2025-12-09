#!/usr/bin/env node

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Command } from 'commander';
import { initRepository } from './commands/init.js';
import { runTask } from './commands/run.js';
import { getTaskStatus } from './commands/status.js';
import { getTaskOutput } from './commands/get.js';
import { listTasks } from './commands/list.js';
import { showLog } from './commands/log.js';
import { convertFile } from './commands/convert.js';
import { viewData } from './commands/view.js';
import { getRepository } from './repo.js';

// TODO install commander-completions or similar for bash completions

const program = new Command();

program
  .name('e3')
  .description('East Execution Engine - Execute tasks across multiple runtimes')
  .version('0.0.1-alpha.0');

program
  .command('init [path]')
  .description('Initialize a new e3 repository')
  .action(async (path) => {
    await initRepository(path);
  });

program
  .command('run <name> <ir> [args...]')
  .description('Submit a task for execution')
  .option('--e3-dir <path>', 'Path to e3 repository')
  .action(async (name, ir, args, options) => {
    const repoPath = getRepository(options.e3Dir);
    await runTask(repoPath, name, ir, args || [], 'node');
  });

program
  .command('status <name>')
  .description('Get status of a task')
  .option('--e3-dir <path>', 'Path to e3 repository')
  .action(async (name, options) => {
    const repoPath = getRepository(options.e3Dir);
    await getTaskStatus(repoPath, name);
  });

program
  .command('get <refOrHash>')
  .description('Get output of a completed task or any object by hash')
  .option('-f, --format <format>', 'Output format (east, json)', 'east')
  .option('--e3-dir <path>', 'Path to e3 repository')
  .action(async (refOrHash, options) => {
    const repoPath = getRepository(options.e3Dir);
    await getTaskOutput(repoPath, refOrHash, options.format);
  });

program
  .command('list')
  .description('List all task refs')
  .option('--e3-dir <path>', 'Path to e3 repository')
  .action(async (options) => {
    const repoPath = getRepository(options.e3Dir);
    await listTasks(repoPath);
  });

program
  .command('log <refOrHash>')
  .description('Show commit history for a task')
  .option('--e3-dir <path>', 'Path to e3 repository')
  .action(async (refOrHash, options) => {
    const repoPath = getRepository(options.e3Dir);
    await showLog(repoPath, refOrHash);
  });

program
  .command('convert [input]')
  .description('Convert between .east, .json, and .beast2 formats (reads from stdin if no input file)')
  .option('--from <format>', 'Input format: east, json, or beast2 (default: auto-detect)')
  .option('--to <format>', 'Output format: east, json, beast2, or type (default: east)', 'east')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('--type <typespec>', 'Type specification in .east format (required for .json, optional for .east)')
  .action(async (input, options) => {
    await convertFile(input, options.to, options.output, options.type, options.from);
  });

program
  .command('view [input]')
  .description('Interactive data viewer for East values (reads from stdin if no input file)')
  .option('--from <format>', 'Input format: east, json, or beast2 (default: auto-detect)')
  .option('-f, --fullscreen', 'Start in fullscreen tree mode (detail pane minimized)')
  .action(async (input, options) => {
    await viewData(input, options.from, options.fullscreen);
  });

// TODO: Add additional commands
// - e3 logs <name> [--follow]
// - e3 gc

program.parse();
