/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API round-trip integration tests
 *
 * Tests the full flow: client -> server -> e3-core -> server -> client
 * Verifies that the API server correctly exposes e3-core operations.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// e3-core for repo setup
import {
  createTestRepo,
  removeTestRepo,
  createTempDir,
  removeTempDir,
} from '@elaraai/e3-core/test';

// SDK for creating test packages
import e3 from '@elaraai/e3';
import { IntegerType, StringType, NullType, ArrayType, East, encodeBeast2For, decodeBeast2For, variant } from '@elaraai/east';

// Server
import { createServer, type Server } from '@elaraai/e3-api-server';

// Client
import {
  repoStatus,
  repoGc,
  repoCreate,
  repoRemove,
  packageList,
  packageGet,
  packageImport,
  packageExport,
  packageRemove,
  workspaceList,
  workspaceCreate,
  workspaceGet,
  workspaceStatus,
  workspaceRemove,
  workspaceDeploy,
  datasetList,
  datasetListAt,
  datasetGet,
  datasetSet,
  taskList,
  taskGet,
  dataflowStart,
  dataflowExecute,
  dataflowGraph,
  Platform,
  PlatformImpl,
} from '@elaraai/e3-api-client';

describe('API round-trip', () => {
  let repoPath: string;
  let reposDir: string;
  let repoName: string;
  let tempDir: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    // Create temp repo - this creates path/to/temp/.e3
    repoPath = createTestRepo();
    tempDir = createTempDir();

    // For multi-repo server, we need reposDir to contain repos as subdirs
    // createTestRepo returns a path like /tmp/e3-test-xxx/.e3
    // We need reposDir to be the parent of the parent, and repo name to be the second-to-last dir
    // Actually, let's set up a proper structure:
    // reposDir = parent temp dir
    // reposDir/test-repo/.e3 = the actual repo

    // Get the parent of .e3 (the repo root)
    const repoRoot = dirname(repoPath); // e.g., /tmp/e3-test-xxx

    // Use the repo root's parent as reposDir, and repo root's name as the repo name
    reposDir = dirname(repoRoot);
    repoName = repoRoot.split('/').pop()!;

    // Start server on random available port
    server = await createServer({
      reposDir,
      port: 0, // Let OS assign port
      host: 'localhost',
    });
    await server.start();
    baseUrl = `http://localhost:${server.port}`;
  });

  afterEach(async () => {
    await server.stop();
    removeTestRepo(repoPath);
    removeTempDir(tempDir);
  });

  describe('repository operations', () => {
    it('repoStatus returns repository info', async () => {
      const status = await repoStatus(baseUrl, repoName);

      assert.ok(status.path.includes('.e3'), 'path should contain .e3');
      assert.strictEqual(status.objectCount, 0n);
      assert.strictEqual(status.packageCount, 0n);
      assert.strictEqual(status.workspaceCount, 0n);
    });

    it('repoGc with dryRun returns stats', async () => {
      const result = await repoGc(baseUrl, repoName, { dryRun: true, minAge: variant('none', null) });

      // Empty repo - nothing to delete
      assert.strictEqual(result.deletedObjects, 0n);
      assert.strictEqual(result.deletedPartials, 0n);
      assert.strictEqual(result.retainedObjects, 0n);
      assert.strictEqual(result.bytesFreed, 0n);
    });

    it('repoCreate creates a new repository', async () => {
      const newRepoName = 'new-test-repo';

      // Create a new repo via API
      const result = await repoCreate(baseUrl, newRepoName);
      assert.strictEqual(result, newRepoName);

      // Verify it exists by getting status
      const status = await repoStatus(baseUrl, newRepoName);
      assert.ok(status.path.includes('.e3'), 'new repo path should contain .e3');

      // Clean up
      await repoRemove(baseUrl, newRepoName);
    });

    it('repoRemove removes an existing repository', async () => {
      const tempRepoName = 'repo-to-delete';

      // Create a repo to delete
      await repoCreate(baseUrl, tempRepoName);

      // Verify it exists
      const status = await repoStatus(baseUrl, tempRepoName);
      assert.ok(status.path.includes('.e3'));

      // Remove it - should complete without error
      await repoRemove(baseUrl, tempRepoName);

      // Verify removal worked by trying to create it again (should succeed if it was removed)
      await repoCreate(baseUrl, tempRepoName);
      await repoRemove(baseUrl, tempRepoName); // Clean up
    });
  });

  describe('package operations', () => {
    let packageZip: Uint8Array;

    beforeEach(async () => {
      // Create a simple test package
      const input = e3.input('value', IntegerType, 42n);
      const task = e3.task(
        'double',
        [input],
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
      );
      const pkg = e3.package('test-pkg', '1.0.0', task);

      // Export to zip
      const zipPath = join(tempDir, 'test-pkg.zip');
      await e3.export(pkg, zipPath);

      // Read zip bytes
      packageZip = readFileSync(zipPath);
    });

    it('packageList returns empty initially', async () => {
      const packages = await packageList(baseUrl, repoName);
      assert.deepStrictEqual(packages, []);
    });

    it('packageImport and packageList round-trip', async () => {
      // Import
      const result = await packageImport(baseUrl, repoName, packageZip);
      assert.strictEqual(result.name, 'test-pkg');
      assert.strictEqual(result.version, '1.0.0');
      assert.strictEqual(result.packageHash.length, 64); // SHA256 hex
      assert.ok(result.objectCount > 0n);

      // List
      const packages = await packageList(baseUrl, repoName);
      assert.strictEqual(packages.length, 1);
      assert.strictEqual(packages[0].name, 'test-pkg');
      assert.strictEqual(packages[0].version, '1.0.0');
    });

    it('packageGet returns package object', async () => {
      await packageImport(baseUrl, repoName, packageZip);

      const pkg = await packageGet(baseUrl, repoName, 'test-pkg', '1.0.0');
      // PackageObject has tasks Map with our 'double' task
      assert.ok(pkg.tasks instanceof Map);
      assert.strictEqual(pkg.tasks.size, 1);
      assert.ok(pkg.tasks.has('double'));
    });

    it('packageExport returns zip bytes', async () => {
      await packageImport(baseUrl, repoName, packageZip);

      const exported = await packageExport(baseUrl, repoName, 'test-pkg', '1.0.0');
      assert.ok(exported instanceof Uint8Array);
      assert.ok(exported.length > 0);
      // ZIP files start with PK signature
      assert.strictEqual(exported[0], 0x50); // 'P'
      assert.strictEqual(exported[1], 0x4b); // 'K'
    });

    it('packageRemove deletes package', async () => {
      await packageImport(baseUrl, repoName, packageZip);

      // Verify exists
      let packages = await packageList(baseUrl, repoName);
      assert.strictEqual(packages.length, 1);

      // Remove
      await packageRemove(baseUrl, repoName, 'test-pkg', '1.0.0');

      // Verify gone
      packages = await packageList(baseUrl, repoName);
      assert.strictEqual(packages.length, 0);
    });
  });

  describe('workspace operations', () => {
    it('workspaceList returns empty initially', async () => {
      const workspaces = await workspaceList(baseUrl, repoName);
      assert.deepStrictEqual(workspaces, []);
    });

    it('workspaceCreate and workspaceList round-trip', async () => {
      const info = await workspaceCreate(baseUrl, repoName, 'test-ws');
      assert.strictEqual(info.name, 'test-ws');
      assert.strictEqual(info.deployed, false);

      const workspaces = await workspaceList(baseUrl, repoName);
      assert.strictEqual(workspaces.length, 1);
      assert.strictEqual(workspaces[0].name, 'test-ws');
    });

    it('workspaceRemove deletes workspace', async () => {
      await workspaceCreate(baseUrl, repoName, 'to-delete');

      let workspaces = await workspaceList(baseUrl, repoName);
      assert.strictEqual(workspaces.length, 1);

      await workspaceRemove(baseUrl, repoName, 'to-delete');

      workspaces = await workspaceList(baseUrl, repoName);
      assert.strictEqual(workspaces.length, 0);
    });
  });

  describe('workspace with deployed package', () => {
    beforeEach(async () => {
      // Create and import a test package
      const inputVal = e3.input('value', IntegerType, 10n);
      const task = e3.task(
        'compute',
        [inputVal],
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
      );
      const pkg = e3.package('compute-pkg', '1.0.0', task);

      const zipPath = join(tempDir, 'compute-pkg.zip');
      await e3.export(pkg, zipPath);

      const packageZip = readFileSync(zipPath);
      await packageImport(baseUrl, repoName, packageZip);

      // Create workspace and deploy
      await workspaceCreate(baseUrl, repoName, 'deployed-ws');
      await workspaceDeploy(baseUrl, repoName, 'deployed-ws', 'compute-pkg@1.0.0');
    });

    it('workspaceGet returns deployed state', async () => {
      const state = await workspaceGet(baseUrl, repoName, 'deployed-ws');
      assert.ok(state !== null);
      assert.strictEqual(state.packageName, 'compute-pkg');
      assert.strictEqual(state.packageVersion, '1.0.0');
    });

    it('workspaceStatus returns datasets and tasks', async () => {
      const status = await workspaceStatus(baseUrl, repoName, 'deployed-ws');

      assert.strictEqual(status.workspace, 'deployed-ws');
      // Should have input and output datasets
      assert.ok(status.datasets.length >= 2);
      // Should have the compute task
      assert.strictEqual(status.tasks.length, 1);
      assert.strictEqual(status.tasks[0].name, 'compute');
      // Summary should match
      assert.strictEqual(status.summary.tasks.total, 1n);
    });

    it('datasetList returns field names', async () => {
      const fields = await datasetList(baseUrl, repoName, 'deployed-ws');
      // Should have inputs and tasks (outputs are under tasks)
      assert.ok(fields.includes('inputs'));
      assert.ok(fields.includes('tasks'));
    });

    it('taskList returns task info', async () => {
      const tasks = await taskList(baseUrl, repoName, 'deployed-ws');
      assert.ok(Array.isArray(tasks));
      assert.ok(tasks.length > 0, 'should have at least one task');

      const computeTask = tasks.find(t => t.name === 'compute');
      assert.ok(computeTask, 'should have compute task');
      assert.ok(computeTask.hash.length > 0);
    });

    it('taskGet returns task details', async () => {
      const task = await taskGet(baseUrl, repoName, 'deployed-ws', 'compute');
      assert.strictEqual(task.name, 'compute');
      assert.ok(task.hash.length > 0);
      assert.ok(Array.isArray(task.inputs));
      assert.ok(task.output);
    });

    it('dataflowGraph returns dependency graph', async () => {
      const graph = await dataflowGraph(baseUrl, repoName, 'deployed-ws');
      assert.ok(Array.isArray(graph.tasks));
      assert.ok(graph.tasks.length > 0);

      const computeTask = graph.tasks.find(t => t.name === 'compute');
      assert.ok(computeTask);
      assert.ok(Array.isArray(computeTask.inputs));
      assert.ok(computeTask.output);
      assert.ok(Array.isArray(computeTask.dependsOn));
    });
  });

  describe('dataset operations', () => {
    beforeEach(async () => {
      // Create package with manual input
      const inputVal = e3.input('config', StringType, 'default');
      const task = e3.task(
        'echo',
        [inputVal],
        East.function([StringType], StringType, ($, x) => x)
      );
      const pkg = e3.package('dataset-pkg', '1.0.0', task);

      const zipPath = join(tempDir, 'dataset-pkg.zip');
      await e3.export(pkg, zipPath);

      const packageZip = readFileSync(zipPath);
      await packageImport(baseUrl, repoName, packageZip);

      await workspaceCreate(baseUrl, repoName, 'dataset-ws');
      await workspaceDeploy(baseUrl, repoName, 'dataset-ws', 'dataset-pkg@1.0.0');
    });

    it('datasetSet and datasetGet round-trip', async () => {
      // Encode value as BEAST2
      const encode = encodeBeast2For(StringType);
      const decode = decodeBeast2For(StringType);
      const data = encode('hello world');

      // Set - TreePath uses variant('field', name) elements
      const path = [
        variant('field', 'inputs'),
        variant('field', 'config'),
      ];
      await datasetSet(baseUrl, repoName, 'dataset-ws', path, data);

      // Get and decode
      const retrieved = await datasetGet(baseUrl, repoName, 'dataset-ws', path);
      assert.ok(retrieved instanceof Uint8Array);

      const decoded = decode(retrieved);
      assert.strictEqual(decoded, 'hello world');
    });

    it('datasetListAt returns nested fields', async () => {
      const path = [variant('field', 'inputs')];
      const fields = await datasetListAt(baseUrl, repoName, 'dataset-ws', path);
      assert.ok(Array.isArray(fields));
      assert.ok(fields.includes('config'), 'should have config field under inputs');
    });
  });

  describe('execution operations', () => {
    beforeEach(async () => {
      // Create package with a simple task
      const inputVal = e3.input('n', IntegerType, 5n);
      const task = e3.task(
        'square',
        [inputVal],
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(x))
      );
      const pkg = e3.package('exec-pkg', '1.0.0', task);

      const zipPath = join(tempDir, 'exec-pkg.zip');
      await e3.export(pkg, zipPath);

      const packageZip = readFileSync(zipPath);
      await packageImport(baseUrl, repoName, packageZip);

      await workspaceCreate(baseUrl, repoName, 'exec-ws');
      await workspaceDeploy(baseUrl, repoName, 'exec-ws', 'exec-pkg@1.0.0');
    });

    it('dataflowExecute runs tasks and returns result (blocking)', async () => {
      const result = await dataflowExecute(baseUrl, repoName, 'exec-ws', { force: true });

      // Verify execution result
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.executed, 1n);
      assert.strictEqual(result.failed, 0n);
      assert.strictEqual(result.tasks.length, 1);
      assert.strictEqual(result.tasks[0].name, 'square');
      assert.strictEqual(result.tasks[0].state.type, 'success');

      // Verify workspace status reflects completion
      const status = await workspaceStatus(baseUrl, repoName, 'exec-ws');
      const task = status.tasks[0];
      assert.strictEqual(task.name, 'square');
      assert.strictEqual(task.status.type, 'up-to-date');

      const outputDataset = status.datasets.find(d => d.path === '.tasks.square.output');
      assert.ok(outputDataset, 'Output dataset .tasks.square.output should exist');
      assert.strictEqual(outputDataset.status.type, 'up-to-date');
    });

    it('dataflowStart triggers execution (non-blocking)', async () => {
      // Should return immediately
      await dataflowStart(baseUrl, repoName, 'exec-ws', { force: true });

      // Poll until execution completes (wait for it to start first, then complete)
      const maxWait = 10000;
      const startTime = Date.now();
      let status = await workspaceStatus(baseUrl, repoName, 'exec-ws');

      while (Date.now() - startTime < maxWait) {
        status = await workspaceStatus(baseUrl, repoName, 'exec-ws');
        const { upToDate } = status.summary.tasks;
        // Done when task is up-to-date
        if (upToDate === 1n) {
          break;
        }
        await new Promise(r => setTimeout(r, 100));
      }

      // Verify execution completed
      assert.strictEqual(status.tasks[0].status.type, 'up-to-date');
    });
  });

  describe('platform function integration', () => {
    it('repoStatus platform function compiles and runs', async () => {
      // Define an East function that uses the platform function
      const getStatus = East.asyncFunction([StringType, StringType], Platform.Types.RepositoryStatus, ($, url, repo) => {
        return Platform.repoStatus(url, repo);
      });

      // Compile with platform implementation
      const compiled = East.compileAsync(getStatus, PlatformImpl);

      // Run the compiled function
      const status = await compiled(baseUrl, repoName);

      // Verify results
      assert.ok(status.path.includes('.e3'), 'path should contain .e3');
      assert.strictEqual(status.objectCount, 0n);
      assert.strictEqual(status.packageCount, 0n);
      assert.strictEqual(status.workspaceCount, 0n);
    });

    it('workspaceList platform function compiles and runs', async () => {
      // Create a workspace first
      await workspaceCreate(baseUrl, repoName, 'platform-test-ws');

      // Define an East function that lists workspaces
      const listWorkspaces = East.asyncFunction(
        [StringType, StringType],
        ArrayType(Platform.Types.WorkspaceInfo),
        ($, url, repo) => {
          return Platform.workspaceList(url, repo);
        }
      );

      // Compile with platform implementation
      const compiled = East.compileAsync(listWorkspaces, PlatformImpl);

      // Run the compiled function
      const workspaces = await compiled(baseUrl, repoName);

      // Verify results
      assert.strictEqual(workspaces.length, 1);
      assert.strictEqual(workspaces[0].name, 'platform-test-ws');

      // Clean up
      await workspaceRemove(baseUrl, repoName, 'platform-test-ws');
    });

    it('workspace create/remove flow via platform functions', async () => {
      // Define East function that creates and lists workspaces
      const createAndList = East.asyncFunction(
        [StringType, StringType, StringType],
        ArrayType(Platform.Types.WorkspaceInfo),
        ($, url, repo, name) => {
          // Create workspace
          $.let(Platform.workspaceCreate(url, repo, name));
          // Return list
          return Platform.workspaceList(url, repo);
        }
      );

      // Compile with platform implementation
      const compiled = East.compileAsync(createAndList, PlatformImpl);

      // Run the compiled function
      const workspaces = await compiled(baseUrl, repoName, 'east-created-ws');

      // Verify workspace was created
      assert.strictEqual(workspaces.length, 1);
      assert.strictEqual(workspaces[0].name, 'east-created-ws');
      assert.strictEqual(workspaces[0].deployed, false);

      // Clean up using platform function
      const removeWs = East.asyncFunction([StringType, StringType, StringType], NullType, ($, url, repo, name) => {
        return Platform.workspaceRemove(url, repo, name);
      });
      const compiledRemove = East.compileAsync(removeWs, PlatformImpl);
      await compiledRemove(baseUrl, repoName, 'east-created-ws');

      // Verify removed
      const finalList = await workspaceList(baseUrl, repoName);
      assert.strictEqual(finalList.length, 0);
    });

    it('$.let correctly infers array type from platform function', async () => {
      // This test verifies the type inference fix - $.let should produce ArrayExpr not StructExpr
      const listAndCount = East.asyncFunction([StringType, StringType], IntegerType, ($, url, repo) => {
        // $.let should correctly infer this as ArrayExpr
        const packages = $.let(Platform.packageList(url, repo));
        // .size() should work since it's an array
        return packages.size();
      });

      // Compile with platform implementation
      const compiled = East.compileAsync(listAndCount, PlatformImpl);

      // Run the compiled function
      const count = await compiled(baseUrl, repoName);

      // Empty repo should have 0 packages
      assert.strictEqual(count, 0n);
    });
  });
});
