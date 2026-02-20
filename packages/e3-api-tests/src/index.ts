/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 API Compliance Tests
 *
 * Shared test suites for verifying e3 API implementations.
 * Works with both local (e3-api-server) and cloud (e3-aws) deployments.
 *
 * @example
 * ```typescript
 * import { describe } from 'node:test';
 * import { createServer } from '@elaraai/e3-api-server';
 * import { allTests, createTestContext, type TestSetup, type TestContext } from '@elaraai/e3-api-tests';
 *
 * const setup: TestSetup<TestContext> = async (t) => {
 *   const ctx = await createTestContext({
 *     baseUrl: 'http://localhost:3000',
 *     getToken: async () => 'test-token',
 *     cleanup: true,
 *   });
 *   t.after(() => ctx.cleanup());
 *   return ctx;
 * };
 *
 * describe('API compliance', { concurrency: true }, () => {
 *   allTests(setup, () => ({ E3_CREDENTIALS_PATH: '/path/to/creds' }));
 * });
 * ```
 */

// Setup type
export { type TestSetup } from './setup.js';

// Context and configuration
export { createTestContext, type TestConfig, type TestContext } from './context.js';

// Fixture creation utilities
export {
  createPackageZip,
  createMultiInputPackageZip,
  createStringPackageZip,
  createDiamondPackageZip,
  createParallelMixedPackageZip,
  createFailingDiamondPackageZip,
  createWideParallelPackageZip,
} from './fixtures.js';

// CLI utilities
export {
  runE3Command,
  spawnE3Command,
  getE3CliPath,
  waitFor,
  type CliResult,
  type RunE3Options,
  type RunningCliProcess,
} from './cli.js';

// Test suites
export { repositoryTests } from './suites/repository.js';
export { packageTests } from './suites/packages.js';
export { workspaceTests } from './suites/workspaces.js';
export { datasetTests } from './suites/datasets.js';
export { dataflowTests } from './suites/dataflow.js';
export { platformTests } from './suites/platform.js';
export { cliTests } from './suites/cli.js';
export { transferTests } from './suites/transfer.js';

import type { TestContext } from './context.js';
import type { TestSetup } from './setup.js';
import { repositoryTests } from './suites/repository.js';
import { packageTests } from './suites/packages.js';
import { workspaceTests } from './suites/workspaces.js';
import { datasetTests } from './suites/datasets.js';
import { dataflowTests } from './suites/dataflow.js';
import { platformTests } from './suites/platform.js';
import { cliTests } from './suites/cli.js';
import { transferTests } from './suites/transfer.js';

/**
 * Register all API test suites (excluding CLI tests).
 *
 * CLI tests require additional credentials setup and are registered separately.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function allApiTests(setup: TestSetup<TestContext>): void {
  repositoryTests(setup);
  packageTests(setup);
  workspaceTests(setup);
  datasetTests(setup);
  dataflowTests(setup);
  platformTests(setup);
}

/**
 * Register all test suites including CLI tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 * @param getCredentialsEnv - Function that returns env vars for CLI auth
 */
export function allTests(
  setup: TestSetup<TestContext>,
  getCredentialsEnv: () => Record<string, string>
): void {
  allApiTests(setup);
  cliTests(setup, getCredentialsEnv);
  transferTests(setup, getCredentialsEnv);
}
