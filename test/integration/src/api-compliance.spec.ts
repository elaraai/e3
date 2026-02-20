/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API Compliance Tests
 *
 * Runs the shared e3-api-tests suites against the local server.
 * One shared server, per-test context for full isolation and concurrency.
 */

import { describe, after } from 'node:test';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer, type Server } from '@elaraai/e3-api-server';
import {
  createTestContext,
  allApiTests,
  cliTests,
  transferTests,
  type TestSetup,
  type TestContext,
} from '@elaraai/e3-api-tests';

// Shared server (lazy-initialized, one per test run)
let server: Server;
let baseUrl: string;
let credentialsPath: string;
let parentDir: string;

const getServerConfig = (() => {
  let cached: Promise<void> | null = null;
  return () => (cached ??= (async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'e3-compliance-'));
    const tempDir = join(parentDir, 'test');
    mkdirSync(tempDir, { recursive: true });

    const reposDir = join(tempDir, 'repos');
    mkdirSync(reposDir, { recursive: true });

    server = await createServer({
      reposDir,
      port: 0,
      host: 'localhost',
    });
    await server.start();

    baseUrl = `http://localhost:${server.port}`;
    credentialsPath = join(tempDir, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify({
      version: 1,
      credentials: {
        [baseUrl]: {
          accessToken: 'mock-test-token',
          refreshToken: 'mock-refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      },
    }, null, 2));
  })());
})();

// Per-test setup: creates a fresh repo + context
const setup: TestSetup<TestContext> = async (t) => {
  await getServerConfig();
  const ctx = await createTestContext({
    baseUrl,
    getToken: async () => '',
    cleanup: true,
  });
  t.after(() => ctx.cleanup());
  return ctx;
};

describe('API compliance', { timeout: 300_000, concurrency: true }, () => {
  after(async () => {
    await server?.stop();
    try {
      rmSync(parentDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Run all API test suites
  allApiTests(setup);

  // Run CLI test suite with credentials env
  cliTests(
    setup,
    () => ({
      E3_CREDENTIALS_PATH: credentialsPath,
      E3_AUTH_AUTO_APPROVE: 'true',
    })
  );

  // Run cross-repository transfer tests
  transferTests(
    setup,
    () => ({
      E3_CREDENTIALS_PATH: credentialsPath,
      E3_AUTH_AUTO_APPROVE: 'true',
    })
  );
});
