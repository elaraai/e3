/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Remote dataflow execution integration tests
 *
 * Tests the full remote execution flow:
 * 1. Start execution via POST /dataflow (non-blocking)
 * 2. Poll for progress via GET /dataflow/execution
 * 3. Verify events are recorded correctly
 * 4. Verify summary and status on completion
 *
 * These tests are designed to be reusable in e3-aws where the
 * polling endpoint will be backed by AWS Step Functions.
 *
 * Key scenarios:
 * - Diamond dependency pattern (parallel tasks merging)
 * - Caching behavior (cached vs executed)
 * - Input changes triggering re-execution
 * - Error handling (task failures, skipped tasks)
 * - Event pagination (offset/limit)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import e3 from '@elaraai/e3';
import { IntegerType, East } from '@elaraai/east';
import { createServer, type Server } from '@elaraai/e3-api-server';
import {
  dataflowStart,
  dataflowExecution,
  dataflowExecute,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetSet,
  datasetGet,
  type DataflowExecutionState,
  type DataflowEvent,
} from '@elaraai/e3-api-client';
import { encodeBeast2For, decodeBeast2For, variant } from '@elaraai/east';
import { createTestRepo, removeTestRepo } from '@elaraai/e3-core/test';

import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

/** Polling interval for tests (ms) */
const POLL_INTERVAL = 100;

/** Maximum wait time for execution (ms) */
const MAX_WAIT = 30000;

/**
 * Poll execution state until completion or timeout
 */
async function waitForExecution(
  baseUrl: string,
  repo: string,
  workspace: string,
  opts: { token: string },
  maxWait: number = MAX_WAIT
): Promise<DataflowExecutionState> {
  const startTime = Date.now();
  let state: DataflowExecutionState;

  while (Date.now() - startTime < maxWait) {
    state = await dataflowExecution(baseUrl, repo, workspace, {}, opts);

    if (state.status.type !== 'running') {
      return state;
    }

    await sleep(POLL_INTERVAL);
  }

  throw new Error(`Execution did not complete within ${maxWait}ms`);
}

/**
 * Collect all events from execution state with pagination
 */
async function collectAllEvents(
  baseUrl: string,
  repo: string,
  workspace: string,
  opts: { token: string }
): Promise<DataflowEvent[]> {
  const events: DataflowEvent[] = [];
  let offset = 0;
  const limit = 10;

  while (true) {
    const state = await dataflowExecution(baseUrl, repo, workspace, { offset, limit }, opts);

    events.push(...state.events);

    if (events.length >= Number(state.totalEvents)) {
      break;
    }

    offset += state.events.length;
  }

  return events;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// API Client Tests (no authentication)
// =============================================================================

describe('remote dataflow execution - API client', () => {
  let repoPath: string;
  let reposDir: string;
  let repoName: string;
  let tempDir: string;
  let server: Server;
  let baseUrl: string;

  // Empty token for unauthenticated server
  const opts = { token: '' };

  beforeEach(async () => {
    // Create temp repo
    repoPath = createTestRepo();
    tempDir = join(repoPath, '..', 'temp');
    mkdirSync(tempDir, { recursive: true });

    // Get the parent of .e3 (the repo root)
    const repoRoot = dirname(repoPath);
    reposDir = dirname(repoRoot);
    repoName = repoRoot.split('/').pop()!;

    // Start server without OIDC
    server = await createServer({
      reposDir,
      port: 0,
      host: 'localhost',
    });
    await server.start();
    baseUrl = `http://localhost:${server.port}`;
  });

  afterEach(async () => {
    await server.stop();
    removeTestRepo(repoPath);
  });

  it('executes single task and returns completion events', async () => {
    // Create and import a simple package
    const input = e3.input('n', IntegerType, 5n);
    const task = e3.task(
      'square',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(x))
    );
    const pkg = e3.package('single-task', '1.0.0', task);

    const zipPath = join(tempDir, 'single-task.zip');
    await e3.export(pkg, zipPath);

    const packageZip = readFileSync(zipPath);
    await packageImport(baseUrl, repoName, packageZip, opts);

    await workspaceCreate(baseUrl, repoName, 'single-ws', opts);
    await workspaceDeploy(baseUrl, repoName, 'single-ws', 'single-task@1.0.0', opts);

    // Start non-blocking execution
    await dataflowStart(baseUrl, repoName, 'single-ws', { force: true }, opts);

    // Poll until complete
    const state = await waitForExecution(baseUrl, repoName, 'single-ws', opts);

    // Verify final state
    assert.strictEqual(state.status.type, 'completed', 'Execution should complete');
    assert.strictEqual(state.summary.type, 'some', 'Summary should be present');

    const summary = state.summary.value!;
    assert.strictEqual(summary.executed, 1n, 'Should execute 1 task');
    assert.strictEqual(summary.failed, 0n, 'No tasks should fail');
    assert.strictEqual(summary.cached, 0n, 'No tasks should be cached (force=true)');

    // Verify events
    const events = await collectAllEvents(baseUrl, repoName, 'single-ws', opts);

    // Should have start and complete events for 'square'
    const startEvents = events.filter(e => e.type === 'start');
    const completeEvents = events.filter(e => e.type === 'complete');

    assert.strictEqual(startEvents.length, 1, 'Should have 1 start event');
    assert.strictEqual(completeEvents.length, 1, 'Should have 1 complete event');
    assert.strictEqual(startEvents[0].value.task, 'square');
    assert.strictEqual(completeEvents[0].value.task, 'square');
    assert.ok(completeEvents[0].value.duration >= 0, 'Complete event should have duration');
  });

  it('diamond dependency pattern executes all tasks', async () => {
    // Diamond: input_a, input_b -> task_left, task_right -> task_merge -> output
    const input_a = e3.input('a', IntegerType, 10n);
    const input_b = e3.input('b', IntegerType, 5n);

    const task_left = e3.task(
      'left',
      [input_a, input_b],
      East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
    );

    const task_right = e3.task(
      'right',
      [input_a, input_b],
      East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.multiply(b))
    );

    const task_merge = e3.task(
      'merge',
      [task_left.output, task_right.output],
      East.function([IntegerType, IntegerType], IntegerType, ($, left, right) => left.add(right))
    );

    const pkg = e3.package('diamond', '1.0.0', task_merge);

    const zipPath = join(tempDir, 'diamond.zip');
    await e3.export(pkg, zipPath);

    const packageZip = readFileSync(zipPath);
    await packageImport(baseUrl, repoName, packageZip, opts);

    await workspaceCreate(baseUrl, repoName, 'diamond-ws', opts);
    await workspaceDeploy(baseUrl, repoName, 'diamond-ws', 'diamond@1.0.0', opts);

    // Execute
    await dataflowStart(baseUrl, repoName, 'diamond-ws', { force: true }, opts);
    const state = await waitForExecution(baseUrl, repoName, 'diamond-ws', opts);

    // Verify
    assert.strictEqual(state.status.type, 'completed');
    assert.strictEqual(state.summary.type, 'some');
    assert.strictEqual(state.summary.value!.executed, 3n, 'Should execute 3 tasks');
    assert.strictEqual(state.summary.value!.failed, 0n);

    // Verify events: should have start+complete for each task
    const events = await collectAllEvents(baseUrl, repoName, 'diamond-ws', opts);
    const taskNames = ['left', 'right', 'merge'];

    for (const taskName of taskNames) {
      const starts = events.filter(e => e.type === 'start' && e.value.task === taskName);
      const completes = events.filter(e => e.type === 'complete' && e.value.task === taskName);
      assert.strictEqual(starts.length, 1, `${taskName} should have start event`);
      assert.strictEqual(completes.length, 1, `${taskName} should have complete event`);
    }

    // Verify final output: (10+5) + (10*5) = 15 + 50 = 65
    const decode = decodeBeast2For(IntegerType);
    const outputPath = [
      variant('field', 'tasks'),
      variant('field', 'merge'),
      variant('field', 'output'),
    ];
    const outputData = await datasetGet(baseUrl, repoName, 'diamond-ws', outputPath, opts);
    const result = decode(outputData);
    assert.strictEqual(result, 65n, 'Output should be 65');
  });

  it('caching returns cached events on second run', async () => {
    // Create simple package
    const input = e3.input('x', IntegerType, 10n);
    const task = e3.task(
      'double',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );
    const pkg = e3.package('caching-test', '1.0.0', task);

    const zipPath = join(tempDir, 'caching-test.zip');
    await e3.export(pkg, zipPath);

    const packageZip = readFileSync(zipPath);
    await packageImport(baseUrl, repoName, packageZip, opts);

    await workspaceCreate(baseUrl, repoName, 'cache-ws', opts);
    await workspaceDeploy(baseUrl, repoName, 'cache-ws', 'caching-test@1.0.0', opts);

    // First run: should execute
    await dataflowStart(baseUrl, repoName, 'cache-ws', {}, opts);
    let state = await waitForExecution(baseUrl, repoName, 'cache-ws', opts);

    assert.strictEqual(state.status.type, 'completed');
    assert.strictEqual(state.summary.type, 'some', 'Summary should be present');
    assert.strictEqual(state.summary.value!.executed, 1n, 'First run should execute');
    assert.strictEqual(state.summary.value!.cached, 0n, 'First run should not cache');

    // Second run: should be cached
    await dataflowStart(baseUrl, repoName, 'cache-ws', {}, opts);
    state = await waitForExecution(baseUrl, repoName, 'cache-ws', opts);

    assert.strictEqual(state.status.type, 'completed');
    assert.strictEqual(state.summary.type, 'some', 'Summary should be present');
    assert.strictEqual(state.summary.value!.executed, 0n, 'Second run should not execute');
    assert.strictEqual(state.summary.value!.cached, 1n, 'Second run should be cached');

    // Verify cached event type
    const events = await collectAllEvents(baseUrl, repoName, 'cache-ws', opts);
    const cachedEvents = events.filter(e => e.type === 'cached');
    assert.strictEqual(cachedEvents.length, 1, 'Should have cached event');
    assert.strictEqual(cachedEvents[0].value.task, 'double');

    // Cached events should NOT have a preceding start event
    const startEvents = events.filter(e => e.type === 'start');
    assert.strictEqual(startEvents.length, 0, 'Cached tasks should not have start events');
  });

  it('input change causes re-execution', async () => {
    // Create package
    const input = e3.input('x', IntegerType, 10n);
    const task = e3.task(
      'double',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );
    const pkg = e3.package('input-change', '1.0.0', task);

    const zipPath = join(tempDir, 'input-change.zip');
    await e3.export(pkg, zipPath);

    const packageZip = readFileSync(zipPath);
    await packageImport(baseUrl, repoName, packageZip, opts);

    await workspaceCreate(baseUrl, repoName, 'input-ws', opts);
    await workspaceDeploy(baseUrl, repoName, 'input-ws', 'input-change@1.0.0', opts);

    // First run with default input (10)
    await dataflowStart(baseUrl, repoName, 'input-ws', {}, opts);
    await waitForExecution(baseUrl, repoName, 'input-ws', opts);

    // Verify output is 20
    const decode = decodeBeast2For(IntegerType);
    const outputPath = [
      variant('field', 'tasks'),
      variant('field', 'double'),
      variant('field', 'output'),
    ];
    let outputData = await datasetGet(baseUrl, repoName, 'input-ws', outputPath, opts);
    assert.strictEqual(decode(outputData), 20n, 'First output should be 20');

    // Change input to 25
    const encode = encodeBeast2For(IntegerType);
    const inputPath = [
      variant('field', 'inputs'),
      variant('field', 'x'),
    ];
    await datasetSet(baseUrl, repoName, 'input-ws', inputPath, encode(25n), opts);

    // Second run should execute (input changed)
    await dataflowStart(baseUrl, repoName, 'input-ws', {}, opts);
    const state = await waitForExecution(baseUrl, repoName, 'input-ws', opts);

    assert.strictEqual(state.summary.type, 'some', 'Summary should be present');
    assert.strictEqual(state.summary.value!.executed, 1n, 'Should re-execute after input change');
    assert.strictEqual(state.summary.value!.cached, 0n, 'Should not be cached after input change');

    // Verify new output is 50
    outputData = await datasetGet(baseUrl, repoName, 'input-ws', outputPath, opts);
    assert.strictEqual(decode(outputData), 50n, 'New output should be 50');
  });

  it('task failure returns failed status and events', async () => {
    // Create a custom task that fails
    const input = e3.input('x', IntegerType, 1n);
    const task = e3.customTask(
      'failing',
      [input],
      IntegerType,
      (_$, _inputs, _output) => East.str`exit 1`
    );
    const pkg = e3.package('failing-pkg', '1.0.0', task);

    const zipPath = join(tempDir, 'failing-pkg.zip');
    await e3.export(pkg, zipPath);

    const packageZip = readFileSync(zipPath);
    await packageImport(baseUrl, repoName, packageZip, opts);

    await workspaceCreate(baseUrl, repoName, 'fail-ws', opts);
    await workspaceDeploy(baseUrl, repoName, 'fail-ws', 'failing-pkg@1.0.0', opts);

    // Execute
    await dataflowStart(baseUrl, repoName, 'fail-ws', { force: true }, opts);
    const state = await waitForExecution(baseUrl, repoName, 'fail-ws', opts);

    // Verify failed status
    assert.strictEqual(state.status.type, 'failed', 'Status should be failed');
    assert.strictEqual(state.summary.type, 'some', 'Summary should be present');
    assert.strictEqual(state.summary.value!.failed, 1n, 'Should have 1 failed task');
    assert.strictEqual(state.summary.value!.executed, 0n, 'Should have 0 executed tasks');

    // Verify failed event
    const events = await collectAllEvents(baseUrl, repoName, 'fail-ws', opts);
    const failedEvents = events.filter(e => e.type === 'failed');
    assert.strictEqual(failedEvents.length, 1, 'Should have 1 failed event');
    assert.strictEqual(failedEvents[0].value.task, 'failing');
    assert.strictEqual(failedEvents[0].value.exitCode, 1n, 'Exit code should be 1');
  });

  it('skipped tasks due to upstream failure return input_unavailable events', async () => {
    // Create a chain: input -> failing_task -> dependent_task
    const input = e3.input('x', IntegerType, 1n);

    const failing_task = e3.customTask(
      'failing',
      [input],
      IntegerType,
      (_$, _inputs, _output) => East.str`exit 1`
    );

    const dependent_task = e3.task(
      'dependent',
      [failing_task.output],
      East.function([IntegerType], IntegerType, ($, x) => x.add(1n))
    );

    const pkg = e3.package('skip-test', '1.0.0', dependent_task);

    const zipPath = join(tempDir, 'skip-test.zip');
    await e3.export(pkg, zipPath);

    const packageZip = readFileSync(zipPath);
    await packageImport(baseUrl, repoName, packageZip, opts);

    await workspaceCreate(baseUrl, repoName, 'skip-ws', opts);
    await workspaceDeploy(baseUrl, repoName, 'skip-ws', 'skip-test@1.0.0', opts);

    // Execute
    await dataflowStart(baseUrl, repoName, 'skip-ws', { force: true }, opts);
    const state = await waitForExecution(baseUrl, repoName, 'skip-ws', opts);

    // Verify state
    assert.strictEqual(state.status.type, 'failed');
    assert.strictEqual(state.summary.type, 'some', 'Summary should be present');
    assert.strictEqual(state.summary.value!.failed, 1n, 'Should have 1 failed task');
    assert.strictEqual(state.summary.value!.skipped, 1n, 'Should have 1 skipped task');

    // Verify input_unavailable event
    const events = await collectAllEvents(baseUrl, repoName, 'skip-ws', opts);
    const unavailableEvents = events.filter(e => e.type === 'input_unavailable');
    assert.strictEqual(unavailableEvents.length, 1, 'Should have 1 input_unavailable event');
    assert.strictEqual(unavailableEvents[0].value.task, 'dependent');
    assert.ok(unavailableEvents[0].value.reason, 'Should have reason');
  });

  it('pagination with offset/limit works correctly', async () => {
    // Create a package with multiple tasks
    const input = e3.input('x', IntegerType, 1n);
    const task1 = e3.task('t1', [input], East.function([IntegerType], IntegerType, ($, x) => x.add(1n)));
    const task2 = e3.task('t2', [task1.output], East.function([IntegerType], IntegerType, ($, x) => x.add(2n)));
    const task3 = e3.task('t3', [task2.output], East.function([IntegerType], IntegerType, ($, x) => x.add(3n)));
    const pkg = e3.package('pagination', '1.0.0', task3);

    const zipPath = join(tempDir, 'pagination.zip');
    await e3.export(pkg, zipPath);

    const packageZip = readFileSync(zipPath);
    await packageImport(baseUrl, repoName, packageZip, opts);

    await workspaceCreate(baseUrl, repoName, 'page-ws', opts);
    await workspaceDeploy(baseUrl, repoName, 'page-ws', 'pagination@1.0.0', opts);

    // Execute
    await dataflowStart(baseUrl, repoName, 'page-ws', { force: true }, opts);
    await waitForExecution(baseUrl, repoName, 'page-ws', opts);

    // Get all events with pagination (limit 2)
    const allEvents: DataflowEvent[] = [];
    let offset = 0;

    while (true) {
      const state = await dataflowExecution(baseUrl, repoName, 'page-ws', { offset, limit: 2 }, opts);
      allEvents.push(...state.events);

      if (state.events.length < 2 || allEvents.length >= Number(state.totalEvents)) {
        break;
      }

      offset += 2;
    }

    // Should have 6 events total: start+complete for each of 3 tasks
    assert.strictEqual(allEvents.length, 6, 'Should have 6 events total');

    // Verify offset skips correctly
    const offsetState = await dataflowExecution(baseUrl, repoName, 'page-ws', { offset: 2, limit: 2 }, opts);
    assert.ok(offsetState.events.length <= 2, 'Limit should cap events');
    assert.notDeepEqual(offsetState.events, allEvents.slice(0, 2), 'Offset should skip first events');
  });

  it('blocking dataflowExecute returns same results as polling', async () => {
    // Create package
    const input = e3.input('n', IntegerType, 4n);
    const task = e3.task(
      'cube',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(x).multiply(x))
    );
    const pkg = e3.package('blocking-test', '1.0.0', task);

    const zipPath = join(tempDir, 'blocking-test.zip');
    await e3.export(pkg, zipPath);

    const packageZip = readFileSync(zipPath);
    await packageImport(baseUrl, repoName, packageZip, opts);

    await workspaceCreate(baseUrl, repoName, 'blocking-ws', opts);
    await workspaceDeploy(baseUrl, repoName, 'blocking-ws', 'blocking-test@1.0.0', opts);

    // Use blocking API
    const result = await dataflowExecute(baseUrl, repoName, 'blocking-ws', { force: true }, opts);

    // Verify result matches what polling would return
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.executed, 1n);
    assert.strictEqual(result.failed, 0n);
    assert.strictEqual(result.tasks.length, 1);
    assert.strictEqual(result.tasks[0].name, 'cube');
    assert.strictEqual(result.tasks[0].state.type, 'success');

    // Verify output: 4^3 = 64
    const decode = decodeBeast2For(IntegerType);
    const outputPath = [
      variant('field', 'tasks'),
      variant('field', 'cube'),
      variant('field', 'output'),
    ];
    const outputData = await datasetGet(baseUrl, repoName, 'blocking-ws', outputPath, opts);
    assert.strictEqual(decode(outputData), 64n, 'Output should be 64');
  });
});

// =============================================================================
// CLI Tests (with authentication)
// =============================================================================

describe('remote dataflow execution - CLI', () => {
  let reposDir: string;
  let repoName: string;
  let repoDir: string;
  let tempDir: string;
  let server: Server;
  let remoteUrl: string;
  let credentialsPath: string;
  let originalAutoApprove: string | undefined;

  // Env vars for authenticated CLI commands
  const authEnv = () => ({
    E3_CREDENTIALS_PATH: credentialsPath,
  });

  beforeEach(async () => {
    // Enable auto-approve for tests
    originalAutoApprove = process.env.E3_AUTH_AUTO_APPROVE;
    process.env.E3_AUTH_AUTO_APPROVE = '1';

    // Create test directory structure
    tempDir = createTestDir();
    mkdirSync(tempDir, { recursive: true });

    reposDir = join(tempDir, 'repos');
    repoName = 'test-repo';
    repoDir = join(reposDir, repoName);
    mkdirSync(repoDir, { recursive: true });

    credentialsPath = join(tempDir, 'credentials.json');

    // Initialize the repository using CLI (local)
    const initResult = await runE3Command(['repo', 'create', '.'], repoDir);
    assert.strictEqual(initResult.exitCode, 0, `Failed to init repo: ${initResult.stderr}`);

    // Get an available port
    const tempServer = await createServer({ reposDir, port: 0, host: 'localhost' });
    await tempServer.start();
    const assignedPort = tempServer.port;
    await tempServer.stop();

    const serverUrl = `http://localhost:${assignedPort}`;

    // Start server with OIDC
    server = await createServer({
      reposDir,
      port: assignedPort,
      host: 'localhost',
      oidc: {
        baseUrl: serverUrl,
        tokenExpiry: '1h',
        refreshTokenExpiry: '90d',
      },
    });
    await server.start();

    remoteUrl = `${serverUrl}/repos/${repoName}`;

    // Login
    const loginResult = await runE3Command(
      ['login', '--no-browser', serverUrl],
      tempDir,
      { env: authEnv() }
    );
    assert.strictEqual(loginResult.exitCode, 0, `Login failed: ${loginResult.stderr}\n${loginResult.stdout}`);
  });

  afterEach(async () => {
    await server.stop();
    removeTestDir(tempDir);
    if (originalAutoApprove === undefined) {
      delete process.env.E3_AUTH_AUTO_APPROVE;
    } else {
      process.env.E3_AUTH_AUTO_APPROVE = originalAutoApprove;
    }
  });

  it('executes dataflow via remote URL', async () => {
    // Create and import package
    const input = e3.input('n', IntegerType, 7n);
    const task = e3.task(
      'triple',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(3n))
    );
    const pkg = e3.package('cli-exec', '1.0.0', task);

    const zipPath = join(tempDir, 'cli-exec.zip');
    await e3.export(pkg, zipPath);

    // Import, create workspace, deploy via CLI
    await runE3Command(['package', 'import', remoteUrl, zipPath], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'create', remoteUrl, 'cli-ws'], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'deploy', remoteUrl, 'cli-ws', 'cli-exec@1.0.0'], tempDir, { env: authEnv() });

    // Execute via e3 start
    const startResult = await runE3Command(
      ['start', remoteUrl, 'cli-ws'],
      tempDir,
      { env: authEnv() }
    );

    assert.strictEqual(startResult.exitCode, 0, `Start failed: ${startResult.stderr}\n${startResult.stdout}`);

    // Verify output shows execution events
    const output = startResult.stdout;
    assert.ok(output.includes('[START]') || output.includes('triple'), 'Should show task start');
    assert.ok(output.includes('[DONE]') || output.includes('Executed'), 'Should show completion');
    assert.ok(output.includes('Summary'), 'Should show summary');
    assert.ok(output.includes('Executed:   1') || output.includes('Executed: 1'), 'Should execute 1 task');
  });

  it('shows cached tasks on re-execution', async () => {
    // Create simple package
    const input = e3.input('x', IntegerType, 5n);
    const task = e3.task(
      'square',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(x))
    );
    const pkg = e3.package('cli-cache', '1.0.0', task);

    const zipPath = join(tempDir, 'cli-cache.zip');
    await e3.export(pkg, zipPath);

    await runE3Command(['package', 'import', remoteUrl, zipPath], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'create', remoteUrl, 'cache-cli-ws'], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'deploy', remoteUrl, 'cache-cli-ws', 'cli-cache@1.0.0'], tempDir, { env: authEnv() });

    // First run
    await runE3Command(['start', remoteUrl, 'cache-cli-ws'], tempDir, { env: authEnv() });

    // Second run - should be cached
    const startResult = await runE3Command(
      ['start', remoteUrl, 'cache-cli-ws'],
      tempDir,
      { env: authEnv() }
    );

    assert.strictEqual(startResult.exitCode, 0);
    assert.ok(startResult.stdout.includes('[CACHED]'), 'Should show cached indicator');
    assert.ok(startResult.stdout.includes('Cached:') && startResult.stdout.includes('1'), 'Summary should show 1 cached');
  });

  it('handles task failure gracefully', async () => {
    // Create failing package
    const input = e3.input('x', IntegerType, 1n);
    const task = e3.customTask(
      'fail',
      [input],
      IntegerType,
      (_$, _inputs, _output) => East.str`exit 1`
    );
    const pkg = e3.package('cli-fail', '1.0.0', task);

    const zipPath = join(tempDir, 'cli-fail.zip');
    await e3.export(pkg, zipPath);

    await runE3Command(['package', 'import', remoteUrl, zipPath], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'create', remoteUrl, 'fail-cli-ws'], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'deploy', remoteUrl, 'fail-cli-ws', 'cli-fail@1.0.0'], tempDir, { env: authEnv() });

    // Execute
    const startResult = await runE3Command(
      ['start', remoteUrl, 'fail-cli-ws'],
      tempDir,
      { env: authEnv() }
    );

    // Should exit with non-zero code
    assert.notStrictEqual(startResult.exitCode, 0, 'Should fail');
    assert.ok(startResult.stdout.includes('[FAIL]'), 'Should show failure indicator');
    assert.ok(startResult.stdout.includes('exit code'), 'Should show exit code');
  });

  it('--force re-executes all tasks', async () => {
    // Create package
    const input = e3.input('x', IntegerType, 5n);
    const task = e3.task(
      'identity',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x)
    );
    const pkg = e3.package('cli-force', '1.0.0', task);

    const zipPath = join(tempDir, 'cli-force.zip');
    await e3.export(pkg, zipPath);

    await runE3Command(['package', 'import', remoteUrl, zipPath], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'create', remoteUrl, 'force-ws'], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'deploy', remoteUrl, 'force-ws', 'cli-force@1.0.0'], tempDir, { env: authEnv() });

    // First run
    await runE3Command(['start', remoteUrl, 'force-ws'], tempDir, { env: authEnv() });

    // Second run without force - should be cached
    let startResult = await runE3Command(
      ['start', remoteUrl, 'force-ws'],
      tempDir,
      { env: authEnv() }
    );
    assert.ok(startResult.stdout.includes('[CACHED]'), 'Second run should be cached');

    // Third run with force - should re-execute
    startResult = await runE3Command(
      ['start', remoteUrl, 'force-ws', '--force'],
      tempDir,
      { env: authEnv() }
    );
    assert.ok(startResult.stdout.includes('[DONE]'), 'Force run should execute');
    assert.ok(
      !startResult.stdout.includes('[CACHED]') || startResult.stdout.includes('Cached:   0'),
      'Force run should not show cached'
    );
  });

  it('diamond dependency shows all task events', async () => {
    // Diamond pattern via CLI
    const input_a = e3.input('a', IntegerType, 2n);
    const input_b = e3.input('b', IntegerType, 3n);

    const task_left = e3.task(
      'left',
      [input_a, input_b],
      East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
    );

    const task_right = e3.task(
      'right',
      [input_a, input_b],
      East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.multiply(b))
    );

    const task_merge = e3.task(
      'merge',
      [task_left.output, task_right.output],
      East.function([IntegerType, IntegerType], IntegerType, ($, left, right) => left.add(right))
    );

    const pkg = e3.package('cli-diamond', '1.0.0', task_merge);

    const zipPath = join(tempDir, 'cli-diamond.zip');
    await e3.export(pkg, zipPath);

    await runE3Command(['package', 'import', remoteUrl, zipPath], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'create', remoteUrl, 'diamond-cli-ws'], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'deploy', remoteUrl, 'diamond-cli-ws', 'cli-diamond@1.0.0'], tempDir, { env: authEnv() });

    // Execute
    const startResult = await runE3Command(
      ['start', remoteUrl, 'diamond-cli-ws'],
      tempDir,
      { env: authEnv() }
    );

    assert.strictEqual(startResult.exitCode, 0, `Start failed: ${startResult.stderr}\n${startResult.stdout}`);

    // Verify all tasks shown
    const output = startResult.stdout;
    assert.ok(output.includes('left'), 'Should show left task');
    assert.ok(output.includes('right'), 'Should show right task');
    assert.ok(output.includes('merge'), 'Should show merge task');
    assert.ok(output.includes('Executed:   3') || output.includes('Executed: 3'), 'Should execute 3 tasks');
    assert.ok(output.includes('Failed:   0') || output.includes('Failed: 0'), 'No tasks should fail');
  });
});

// =============================================================================
// CLI get/set/list Tests (with authentication)
// =============================================================================

describe('remote CLI get/set/list', () => {
  let reposDir: string;
  let repoName: string;
  let repoDir: string;
  let tempDir: string;
  let server: Server;
  let remoteUrl: string;
  let credentialsPath: string;
  let originalAutoApprove: string | undefined;

  // Env vars for authenticated CLI commands
  const authEnv = () => ({
    E3_CREDENTIALS_PATH: credentialsPath,
  });

  beforeEach(async () => {
    // Enable auto-approve for tests
    originalAutoApprove = process.env.E3_AUTH_AUTO_APPROVE;
    process.env.E3_AUTH_AUTO_APPROVE = '1';

    // Create test directory structure
    tempDir = createTestDir();
    mkdirSync(tempDir, { recursive: true });

    reposDir = join(tempDir, 'repos');
    repoName = 'test-repo';
    repoDir = join(reposDir, repoName);
    mkdirSync(repoDir, { recursive: true });

    credentialsPath = join(tempDir, 'credentials.json');

    // Initialize the repository using CLI (local)
    const initResult = await runE3Command(['repo', 'create', '.'], repoDir);
    assert.strictEqual(initResult.exitCode, 0, `Failed to init repo: ${initResult.stderr}`);

    // Get an available port
    const tempServer = await createServer({ reposDir, port: 0, host: 'localhost' });
    await tempServer.start();
    const assignedPort = tempServer.port;
    await tempServer.stop();

    const serverUrl = `http://localhost:${assignedPort}`;

    // Start server with OIDC
    server = await createServer({
      reposDir,
      port: assignedPort,
      host: 'localhost',
      oidc: {
        baseUrl: serverUrl,
        tokenExpiry: '1h',
        refreshTokenExpiry: '90d',
      },
    });
    await server.start();

    remoteUrl = `${serverUrl}/repos/${repoName}`;

    // Login
    const loginResult = await runE3Command(
      ['login', '--no-browser', serverUrl],
      tempDir,
      { env: authEnv() }
    );
    assert.strictEqual(loginResult.exitCode, 0, `Login failed: ${loginResult.stderr}\n${loginResult.stdout}`);

    // Create and deploy a simple package
    const input = e3.input('n', IntegerType, 42n);
    const task = e3.task(
      'double',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );
    const pkg = e3.package('getset-test', '1.0.0', task);

    const zipPath = join(tempDir, 'getset-test.zip');
    await e3.export(pkg, zipPath);

    await runE3Command(['package', 'import', remoteUrl, zipPath], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'create', remoteUrl, 'getset-ws'], tempDir, { env: authEnv() });
    await runE3Command(['workspace', 'deploy', remoteUrl, 'getset-ws', 'getset-test@1.0.0'], tempDir, { env: authEnv() });
  });

  afterEach(async () => {
    await server.stop();
    removeTestDir(tempDir);
    if (originalAutoApprove === undefined) {
      delete process.env.E3_AUTH_AUTO_APPROVE;
    } else {
      process.env.E3_AUTH_AUTO_APPROVE = originalAutoApprove;
    }
  });

  it('e3 list shows workspaces via remote URL', async () => {
    const result = await runE3Command(['list', remoteUrl], tempDir, { env: authEnv() });

    assert.strictEqual(result.exitCode, 0, `List failed: ${result.stderr}\n${result.stdout}`);
    assert.ok(result.stdout.includes('getset-ws'), 'Should list workspace name');
    assert.ok(result.stdout.includes('getset-test@1.0.0'), 'Should show deployed package');
  });

  it('e3 list shows tree contents via remote URL', async () => {
    const result = await runE3Command(['list', remoteUrl, 'getset-ws'], tempDir, { env: authEnv() });

    assert.strictEqual(result.exitCode, 0, `List tree failed: ${result.stderr}\n${result.stdout}`);
    // Should show root fields: inputs, tasks
    assert.ok(result.stdout.includes('inputs'), 'Should list inputs field');
    assert.ok(result.stdout.includes('tasks'), 'Should list tasks field');
  });

  it('e3 list shows nested tree contents via remote URL', async () => {
    const result = await runE3Command(['list', remoteUrl, 'getset-ws.inputs'], tempDir, { env: authEnv() });

    assert.strictEqual(result.exitCode, 0, `List nested failed: ${result.stderr}\n${result.stdout}`);
    // Should show the input 'n'
    assert.ok(result.stdout.includes('n'), 'Should list input n');
  });

  it('e3 get retrieves dataset value via remote URL', async () => {
    const result = await runE3Command(['get', remoteUrl, 'getset-ws.inputs.n'], tempDir, { env: authEnv() });

    assert.strictEqual(result.exitCode, 0, `Get failed: ${result.stderr}\n${result.stdout}`);
    // Default value is 42 (bigint in East format)
    assert.ok(result.stdout.includes('42'), 'Should show value 42');
  });

  it('e3 get with json format via remote URL', async () => {
    const result = await runE3Command(['get', remoteUrl, 'getset-ws.inputs.n', '-f', 'json'], tempDir, { env: authEnv() });

    assert.strictEqual(result.exitCode, 0, `Get JSON failed: ${result.stderr}\n${result.stdout}`);
    // JSON format for bigint
    assert.ok(result.stdout.includes('42'), 'Should show value 42');
  });

  it('e3 set updates dataset value via remote URL', async () => {
    // Write a file with new value
    const dataPath = join(tempDir, 'newvalue.east');
    writeFileSync(dataPath, '99');

    const setResult = await runE3Command(
      ['set', remoteUrl, 'getset-ws.inputs.n', dataPath],
      tempDir,
      { env: authEnv() }
    );

    assert.strictEqual(setResult.exitCode, 0, `Set failed: ${setResult.stderr}\n${setResult.stdout}`);
    assert.ok(setResult.stdout.includes('Set'), 'Should confirm set');

    // Verify the value was updated
    const getResult = await runE3Command(['get', remoteUrl, 'getset-ws.inputs.n'], tempDir, { env: authEnv() });
    assert.strictEqual(getResult.exitCode, 0);
    assert.ok(getResult.stdout.includes('99'), 'Value should be updated to 99');
  });

  it('e3 set with JSON file via remote URL', async () => {
    // Write a JSON file - integers must be strings in East JSON format for bigint precision
    const dataPath = join(tempDir, 'newvalue.json');
    writeFileSync(dataPath, '"123"');

    const setResult = await runE3Command(
      ['set', remoteUrl, 'getset-ws.inputs.n', dataPath, '--type', '.Integer'],
      tempDir,
      { env: authEnv() }
    );

    assert.strictEqual(setResult.exitCode, 0, `Set JSON failed: ${setResult.stderr}\n${setResult.stdout}`);

    // Verify the value was updated
    const getResult = await runE3Command(['get', remoteUrl, 'getset-ws.inputs.n'], tempDir, { env: authEnv() });
    assert.strictEqual(getResult.exitCode, 0);
    assert.ok(getResult.stdout.includes('123'), 'Value should be updated to 123');
  });

  it('e3 get retrieves task output after execution via remote URL', async () => {
    // First, run the dataflow to produce output
    const startResult = await runE3Command(['start', remoteUrl, 'getset-ws'], tempDir, { env: authEnv() });
    assert.strictEqual(startResult.exitCode, 0, `Start failed: ${startResult.stderr}`);

    // Now get the task output
    const result = await runE3Command(
      ['get', remoteUrl, 'getset-ws.tasks.double.output'],
      tempDir,
      { env: authEnv() }
    );

    assert.strictEqual(result.exitCode, 0, `Get task output failed: ${result.stderr}\n${result.stdout}`);
    // 42 * 2 = 84
    assert.ok(result.stdout.includes('84'), 'Task output should be 84');
  });

  it('round trip: set value, execute, get output via remote URL', async () => {
    // Set input to 10
    const dataPath = join(tempDir, 'input.east');
    writeFileSync(dataPath, '10');

    await runE3Command(['set', remoteUrl, 'getset-ws.inputs.n', dataPath], tempDir, { env: authEnv() });

    // Execute
    const startResult = await runE3Command(['start', remoteUrl, 'getset-ws'], tempDir, { env: authEnv() });
    assert.strictEqual(startResult.exitCode, 0);

    // Get output
    const getResult = await runE3Command(
      ['get', remoteUrl, 'getset-ws.tasks.double.output'],
      tempDir,
      { env: authEnv() }
    );

    assert.strictEqual(getResult.exitCode, 0);
    // 10 * 2 = 20
    assert.ok(getResult.stdout.includes('20'), 'Output should be 20');
  });
});
