/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve, type ServerType } from '@hono/node-server';
import { createRepositoryRoutes } from './routes/repository.js';
import { createPackageRoutes } from './routes/packages.js';
import { createWorkspaceRoutes } from './routes/workspaces.js';
import { createDatasetRoutes } from './routes/datasets.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createExecutionRoutes } from './routes/executions.js';

/**
 * Server configuration options.
 */
export interface ServerConfig {
  /** Path to e3 repository (required) */
  repo: string;
  /** HTTP port (default: 3000) */
  port?: number;
  /** Bind address (default: "localhost") */
  host?: string;
  /** Enable CORS for cross-origin requests (default: false) */
  cors?: boolean;
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
 * @param config - Server configuration
 * @returns Server instance
 */
export function createServer(config: ServerConfig): Server {
  const { repo: repoPath, port = 3000, host = 'localhost', cors: enableCors = false } = config;

  const app = new Hono();

  // Enable CORS if configured
  if (enableCors) {
    app.use('*', cors({ origin: '*' }));
  }

  // Repository routes: /api/status, /api/gc
  app.route('/api', createRepositoryRoutes(repoPath));

  // Package routes: /api/packages/*
  app.route('/api/packages', createPackageRoutes(repoPath));

  // Workspace routes: /api/workspaces/*
  const workspaceRoutes = createWorkspaceRoutes(repoPath);
  app.route('/api/workspaces', workspaceRoutes);

  // Dataset routes mounted under workspaces: /api/workspaces/:ws/list, /get, /set
  const datasetRoutes = createDatasetRoutes(repoPath);
  app.route('/api/workspaces/:ws', datasetRoutes);

  // Task routes: /api/workspaces/:ws/tasks/*
  const taskRoutes = createTaskRoutes(repoPath);
  app.route('/api/workspaces/:ws/tasks', taskRoutes);

  // Execution routes: /api/workspaces/:ws/start, /status, /graph, /logs/:task
  const executionRoutes = createExecutionRoutes(repoPath);
  app.route('/api/workspaces/:ws', executionRoutes);

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
