/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve, type ServerType } from '@hono/node-server';
import { LocalStorage } from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { createAuthMiddleware, type AuthConfig } from './middleware/auth.js';
import { listRepos } from './handlers/repos.js';
import { createPackageRoutes } from './routes/packages.js';
import { createWorkspaceRoutes } from './routes/workspaces.js';
import { createDatasetRoutes } from './routes/datasets.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createExecutionRoutes } from './routes/executions.js';
import { createRepositoryRoutes } from './routes/repository.js';

export type { AuthConfig } from './middleware/auth.js';

/**
 * Server configuration options.
 */
export interface ServerConfig {
  /** Directory containing repositories (each subdirectory with .e3/ is a repo) */
  reposDir: string;
  /** HTTP port (default: 3000) */
  port?: number;
  /** Bind address (default: "localhost") */
  host?: string;
  /** Enable CORS for cross-origin requests (default: false) */
  cors?: boolean;
  /** Optional JWT authentication config */
  auth?: AuthConfig;
}

/**
 * Server instance handle.
 */
export interface Server {
  /** Start the server */
  start(): Promise<void>;
  /** Stop the server */
  stop(): Promise<void>;
  /** The underlying HTTP server */
  readonly httpServer: ServerType;
  /** The port the server is listening on */
  readonly port: number;
}

/**
 * Create an e3 API server.
 *
 * The server operates in multi-repo mode, serving multiple repositories
 * from subdirectories of the configured reposDir.
 *
 * URL structure:
 * - GET /api/repos - List available repositories
 * - /api/repos/:repo/... - Repository-specific endpoints
 *
 * @param config - Server configuration
 * @returns Server instance
 */
export async function createServer(config: ServerConfig): Promise<Server> {
  const { reposDir, port = 3000, host = 'localhost', cors: enableCors = false, auth } = config;

  // Single storage instance shared across all requests
  const storage: StorageBackend = new LocalStorage();

  // Helper to compute repo path from repo name
  const getRepoPath = (repoName: string) => path.join(reposDir, repoName, '.e3');

  const app = new Hono();

  // Enable CORS if configured
  if (enableCors) {
    app.use('*', cors({ origin: '*' }));
  }

  // Apply auth middleware to all repo-specific routes if configured
  if (auth) {
    const authMiddleware = await createAuthMiddleware(auth);
    app.use('/api/repos/:repo/*', authMiddleware);
  }

  // GET /api/repos - List available repositories
  app.get('/api/repos', async () => {
    return listRepos(reposDir);
  });

  // Mount repository-specific routes
  // Each route file creates a sub-app that uses getRepoPath to resolve the repo

  // Repository status and GC: /api/repos/:repo/status, /api/repos/:repo/gc
  app.route('/api/repos/:repo', createRepositoryRoutes(storage, getRepoPath));

  // Package routes: /api/repos/:repo/packages/*
  app.route('/api/repos/:repo/packages', createPackageRoutes(storage, getRepoPath));

  // Workspace routes: /api/repos/:repo/workspaces/*
  app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, getRepoPath));

  // Dataset routes: /api/repos/:repo/workspaces/:ws/datasets/*
  app.route('/api/repos/:repo/workspaces/:ws/datasets', createDatasetRoutes(storage, getRepoPath));

  // Task routes: /api/repos/:repo/workspaces/:ws/tasks/*
  app.route('/api/repos/:repo/workspaces/:ws/tasks', createTaskRoutes(storage, getRepoPath));

  // Execution/Dataflow routes: /api/repos/:repo/workspaces/:ws/dataflow/*
  app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(storage, getRepoPath));

  let httpServer: ServerType | null = null;
  let actualPort = port;

  const server: Server = {
    async start() {
      return new Promise((resolve) => {
        httpServer = serve({
          fetch: app.fetch,
          port,
          hostname: host,
        }, (info) => {
          actualPort = info.port;
          resolve();
        });
      });
    },

    async stop() {
      return new Promise((resolve, reject) => {
        if (!httpServer) {
          resolve();
          return;
        }
        // Force close all connections immediately
        (httpServer as unknown as { closeAllConnections(): void }).closeAllConnections();
        httpServer.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },

    get httpServer() {
      if (!httpServer) {
        throw new Error('Server not started');
      }
      return httpServer;
    },

    get port() {
      return actualPort;
    },
  };

  return server;
}
