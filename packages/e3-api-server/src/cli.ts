#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Command } from 'commander';
import { createServer } from './server.js';

const program = new Command();

program
  .name('e3-api-server')
  .description('HTTP server for e3 repositories')
  .version('0.0.1-beta.0')
  .argument('<repo>', 'Path to e3 repository')
  .option('-p, --port <port>', 'HTTP port', '3000')
  .option('-H, --host <host>', 'Bind address', 'localhost')
  .action(async (repo: string, options: {
    port: string;
    host: string;
  }) => {
    const server = await createServer({
      repo,
      port: parseInt(options.port, 10),
      host: options.host,
    });

    await server.start();
    console.log(`e3-api-server listening on http://${options.host}:${server.port}`);

    // Handle shutdown signals
    const shutdown = async () => {
      console.log('\nShutting down...');
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

program.parse();
