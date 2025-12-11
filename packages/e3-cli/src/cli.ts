#!/usr/bin/env node

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 CLI - East Execution Engine command-line interface
 *
 * All commands take a repository path as the first argument (`.` for current directory).
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { packageCommand } from './commands/package.js';
import { workspaceCommand } from './commands/workspace.js';
import { listCommand } from './commands/list.js';
import { getCommand } from './commands/get.js';
import { setCommand } from './commands/set.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { gcCommand } from './commands/gc.js';
import { convertCommand } from './commands/convert.js';

const program = new Command();

program
  .name('e3')
  .description('East Execution Engine - Execute tasks across multiple runtimes')
  .version('0.0.1-alpha.0');

// Repository commands
program
  .command('init <repo>')
  .description('Initialize a new e3 repository')
  .action(initCommand);

program
  .command('status <repo>')
  .description('Show repository status (packages, workspaces)')
  .action(statusCommand);

program
  .command('gc <repo>')
  .description('Remove unreferenced objects')
  .option('--dry-run', 'Report what would be deleted without deleting')
  .option('--min-age <ms>', 'Minimum file age in ms before deletion', '60000')
  .action(gcCommand);

// Package commands
program
  .command('package')
  .description('Package operations')
  .addCommand(
    new Command('import')
      .description('Import package from .zip file')
      .argument('<repo>', 'Repository path')
      .argument('<zipPath>', 'Path to .zip file')
      .action(packageCommand.import)
  )
  .addCommand(
    new Command('export')
      .description('Export package to .zip file')
      .argument('<repo>', 'Repository path')
      .argument('<pkg>', 'Package name[@version]')
      .argument('<zipPath>', 'Output .zip path')
      .action(packageCommand.export)
  )
  .addCommand(
    new Command('list')
      .description('List installed packages')
      .argument('<repo>', 'Repository path')
      .action(packageCommand.list)
  )
  .addCommand(
    new Command('remove')
      .description('Remove a package')
      .argument('<repo>', 'Repository path')
      .argument('<pkg>', 'Package name[@version]')
      .action(packageCommand.remove)
  );

// Workspace commands
program
  .command('workspace')
  .description('Workspace operations')
  .addCommand(
    new Command('create')
      .description('Create an empty workspace')
      .argument('<repo>', 'Repository path')
      .argument('<name>', 'Workspace name')
      .action(workspaceCommand.create)
  )
  .addCommand(
    new Command('deploy')
      .description('Deploy a package to a workspace')
      .argument('<repo>', 'Repository path')
      .argument('<ws>', 'Workspace name')
      .argument('<pkg>', 'Package name[@version]')
      .action(workspaceCommand.deploy)
  )
  .addCommand(
    new Command('export')
      .description('Export workspace as a package')
      .argument('<repo>', 'Repository path')
      .argument('<ws>', 'Workspace name')
      .argument('<zipPath>', 'Output .zip path')
      .option('--name <name>', 'Package name (default: deployed package name)')
      .option('--version <version>', 'Package version (default: auto-generated)')
      .action(workspaceCommand.export)
  )
  .addCommand(
    new Command('list')
      .description('List workspaces')
      .argument('<repo>', 'Repository path')
      .action(workspaceCommand.list)
  )
  .addCommand(
    new Command('remove')
      .description('Remove a workspace')
      .argument('<repo>', 'Repository path')
      .argument('<ws>', 'Workspace name')
      .action(workspaceCommand.remove)
  );

// Dataset commands
program
  .command('list <repo> [path]')
  .description('List workspaces or tree contents at path (ws.path.to.tree)')
  .action(listCommand);

program
  .command('get <repo> <path>')
  .description('Get dataset value at path (ws.path.to.dataset)')
  .option('-f, --format <format>', 'Output format: east, json, beast2', 'east')
  .action(getCommand);

program
  .command('set <repo> <path> <file>')
  .description('Set dataset value from file (ws.path.to.dataset)')
  .action(setCommand);

// Execution commands
program
  .command('start <repo> <ws>')
  .description('Execute tasks in a workspace')
  .option('--filter <pattern>', 'Only run tasks matching pattern')
  .option('--concurrency <n>', 'Max concurrent tasks', '4')
  .option('--force', 'Force re-execution even if cached')
  .action(startCommand);

// Utility commands
program
  .command('convert [input]')
  .description('Convert between .east, .json, and .beast2 formats')
  .option('--from <format>', 'Input format: east, json, beast2 (default: auto-detect)')
  .option('--to <format>', 'Output format: east, json, beast2', 'east')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('--type <typespec>', 'Type specification in .east format')
  .action(convertCommand);

program.parse();
