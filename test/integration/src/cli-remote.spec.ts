/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Integration tests for CLI commands with remote URLs
 *
 * Tests the CLI commands work correctly when using http:// URLs
 * to communicate with an e3-api-server.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import e3 from '@elaraai/e3';
import { IntegerType, East } from '@elaraai/east';
import { createServer, type Server } from '@elaraai/e3-api-server';

import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

describe('CLI remote operations', () => {
  let reposDir: string;
  let repoName: string;
  let repoDir: string;
  let tempDir: string;
  let server: Server;
  let remoteUrl: string;
  let serverUrl: string;
  let credentialsPath: string;
  let originalAutoApprove: string | undefined;

  // Env vars for authenticated CLI commands
  const authEnv = () => ({
    E3_CREDENTIALS_PATH: credentialsPath,
  });

  beforeEach(async () => {
    // Enable auto-approve for tests (server checks this env var)
    originalAutoApprove = process.env.E3_AUTH_AUTO_APPROVE;
    process.env.E3_AUTH_AUTO_APPROVE = '1';

    // Create test directory structure
    tempDir = createTestDir();
    mkdirSync(tempDir, { recursive: true });

    // Create repos directory structure: tempDir/repos/test-repo
    reposDir = join(tempDir, 'repos');
    repoName = 'test-repo';
    repoDir = join(reposDir, repoName);
    mkdirSync(repoDir, { recursive: true });

    // Create credentials file location
    credentialsPath = join(tempDir, 'credentials.json');

    // Initialize the repository using CLI (local, no auth needed)
    const initResult = await runE3Command(['repo', 'create', '.'], repoDir);
    assert.strictEqual(initResult.exitCode, 0, `Failed to init repo: ${initResult.stderr}`);

    // Get an available port first
    const tempServer = await createServer({ reposDir, port: 0, host: 'localhost' });
    await tempServer.start();
    const assignedPort = tempServer.port;
    await tempServer.stop();

    serverUrl = `http://localhost:${assignedPort}`;

    // Start server with OIDC enabled
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

    // Remote URL in the user-facing format
    remoteUrl = `${serverUrl}/repos/${repoName}`;

    // Login (auto-approve enabled via process.env in beforeEach)
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
    // Restore original auto-approve setting
    if (originalAutoApprove === undefined) {
      delete process.env.E3_AUTH_AUTO_APPROVE;
    } else {
      process.env.E3_AUTH_AUTO_APPROVE = originalAutoApprove;
    }
  });

  describe('repo commands', () => {
    it('creates repository via remote URL', async () => {
      const newRepoUrl = `http://localhost:${server.port}/repos/new-remote-repo`;

      // Create a new repo on the server using the full URL
      const result = await runE3Command(['repo', 'create', newRepoUrl], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /Created repository: new-remote-repo/);
    });

    it('removes repository via remote URL', async () => {
      const repoToDeleteUrl = `http://localhost:${server.port}/repos/repo-to-delete`;

      // Create repo first
      await runE3Command(['repo', 'create', repoToDeleteUrl], tempDir, { env: authEnv() });

      // Remove it using the same URL format
      const result = await runE3Command(['repo', 'remove', repoToDeleteUrl], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /Removed repository: repo-to-delete/);
    });

    it('shows status via remote URL', async () => {
      const result = await runE3Command(['repo', 'status', remoteUrl], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /Repository: test-repo/);
      assert.match(result.stdout, /Objects:/);
      assert.match(result.stdout, /Packages:/);
      assert.match(result.stdout, /Workspaces:/);
    });
  });

  describe('workspace commands', () => {
    it('lists workspaces via remote URL', async () => {
      const result = await runE3Command(['workspace', 'list', remoteUrl], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /No workspaces/i);
    });

    it('creates workspace via remote URL', async () => {
      const result = await runE3Command(['workspace', 'create', remoteUrl, 'test-ws'], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /Created workspace: test-ws/);

      // Verify via list
      const listResult = await runE3Command(['workspace', 'list', remoteUrl], tempDir, { env: authEnv() });
      assert.strictEqual(listResult.exitCode, 0);
      assert.match(listResult.stdout, /test-ws/);
    });

    it('removes workspace via remote URL', async () => {
      // Create first
      await runE3Command(['workspace', 'create', remoteUrl, 'to-delete'], tempDir, { env: authEnv() });

      // Remove
      const result = await runE3Command(['workspace', 'remove', remoteUrl, 'to-delete'], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /Removed workspace: to-delete/);

      // Verify via list
      const listResult = await runE3Command(['workspace', 'list', remoteUrl], tempDir, { env: authEnv() });
      assert.strictEqual(listResult.exitCode, 0);
      assert.match(listResult.stdout, /No workspaces/i);
    });
  });

  describe('package commands', () => {
    let packageZipPath: string;

    beforeEach(async () => {
      // Create a test package zip
      const input = e3.input('value', IntegerType, 42n);
      const task = e3.task(
        'double',
        [input],
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
      );
      const pkg = e3.package('test-pkg', '1.0.0', task);

      packageZipPath = join(tempDir, 'test-pkg.zip');
      await e3.export(pkg, packageZipPath);
    });

    it('lists packages via remote URL', async () => {
      const result = await runE3Command(['package', 'list', remoteUrl], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /No packages/i);
    });

    it('imports package via remote URL', async () => {
      const result = await runE3Command(['package', 'import', remoteUrl, packageZipPath], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /Imported test-pkg@1.0.0/);

      // Verify via list
      const listResult = await runE3Command(['package', 'list', remoteUrl], tempDir, { env: authEnv() });
      assert.strictEqual(listResult.exitCode, 0);
      assert.match(listResult.stdout, /test-pkg@1.0.0/);
    });

    it('removes package via remote URL', async () => {
      // Import first
      await runE3Command(['package', 'import', remoteUrl, packageZipPath], tempDir, { env: authEnv() });

      // Remove
      const result = await runE3Command(['package', 'remove', remoteUrl, 'test-pkg@1.0.0'], tempDir, { env: authEnv() });

      assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /Removed test-pkg@1.0.0/);

      // Verify via list
      const listResult = await runE3Command(['package', 'list', remoteUrl], tempDir, { env: authEnv() });
      assert.strictEqual(listResult.exitCode, 0);
      assert.match(listResult.stdout, /No packages/i);
    });
  });

  describe('full workflow', () => {
    it('imports package, creates workspace, deploys, and lists via remote URL', async () => {
      // Create a test package
      const input = e3.input('n', IntegerType, 10n);
      const task = e3.task(
        'square',
        [input],
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(x))
      );
      const pkg = e3.package('compute-pkg', '1.0.0', task);

      const zipPath = join(tempDir, 'compute-pkg.zip');
      await e3.export(pkg, zipPath);

      // Import package
      const importResult = await runE3Command(['package', 'import', remoteUrl, zipPath], tempDir, { env: authEnv() });
      assert.strictEqual(importResult.exitCode, 0, `Import failed: ${importResult.stderr}`);

      // Create workspace
      const createResult = await runE3Command(['workspace', 'create', remoteUrl, 'compute-ws'], tempDir, { env: authEnv() });
      assert.strictEqual(createResult.exitCode, 0, `Create failed: ${createResult.stderr}`);

      // Deploy package to workspace
      const deployResult = await runE3Command(
        ['workspace', 'deploy', remoteUrl, 'compute-ws', 'compute-pkg@1.0.0'],
        tempDir,
        { env: authEnv() }
      );
      assert.strictEqual(deployResult.exitCode, 0, `Deploy failed: ${deployResult.stderr}`);
      assert.match(deployResult.stdout, /Deployed compute-pkg@1.0.0 to workspace: compute-ws/);

      // List workspaces - should show deployed package
      const listResult = await runE3Command(['workspace', 'list', remoteUrl], tempDir, { env: authEnv() });
      assert.strictEqual(listResult.exitCode, 0, `List failed: ${listResult.stderr}`);
      assert.match(listResult.stdout, /compute-ws.*compute-pkg@1.0.0/);
    });
  });
});
