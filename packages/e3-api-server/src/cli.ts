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
  .requiredOption('--repos <dir>', 'Directory containing e3 repositories')
  .option('-p, --port <port>', 'HTTP port', '3000')
  .option('-H, --host <host>', 'Bind address', 'localhost')
  .option('--cors', 'Enable CORS')
  .option('--auth-key <path>', 'JWT public key path')
  .option('--auth-issuer <iss>', 'Expected JWT issuer')
  .option('--auth-audience <aud>', 'Expected JWT audience')
  .action(async (options: {
    repos: string;
    port: string;
    host: string;
    cors?: boolean;
    authKey?: string;
    authIssuer?: string;
    authAudience?: string;
  }) => {
    // Build auth config if all auth options provided
    const auth = options.authKey && options.authIssuer && options.authAudience
      ? {
          publicKeyPath: options.authKey,
          issuer: options.authIssuer,
          audience: options.authAudience,
        }
      : undefined;

    const server = await createServer({
      reposDir: options.repos,
      port: parseInt(options.port, 10),
      host: options.host,
      cors: options.cors,
      auth,
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
