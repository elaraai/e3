/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Workspace operations test suite.
 *
 * Tests: create, list, get, status, deploy, remove
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  packageImport,
  workspaceList,
  workspaceCreate,
  workspaceGet,
  workspaceStatus,
  workspaceRemove,
  workspaceDeploy,
  taskList,
  taskGet,
  dataflowGraph,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createPackageZip } from '../fixtures.js';

/**
 * Register workspace operation tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function workspaceTests(setup: TestSetup<TestContext>): void {
  const withDeployedPackage: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();

    const zipPath = await createPackageZip(ctx.tempDir, 'compute-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', 'compute-pkg@1.0.0', opts);

    return ctx;
  };

  describe('workspaces', { concurrency: true }, () => {
    it('workspaceList returns empty initially', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      const workspaces = await workspaceList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.deepStrictEqual(workspaces, []);
    });

    it('workspaceCreate and workspaceList round-trip', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      const info = await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'test-ws', opts);
      assert.strictEqual(info.name, 'test-ws');
      assert.strictEqual(info.deployed, false);

      const workspaces = await workspaceList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(workspaces.length, 1);
      assert.strictEqual(workspaces[0].name, 'test-ws');

      // Clean up
      await workspaceRemove(ctx.config.baseUrl, ctx.repoName, 'test-ws', opts);
    });

    it('workspaceRemove deletes workspace', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'to-delete', opts);

      let workspaces = await workspaceList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(workspaces.length, 1);

      await workspaceRemove(ctx.config.baseUrl, ctx.repoName, 'to-delete', opts);

      workspaces = await workspaceList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(workspaces.length, 0);
    });

    describe('with deployed package', { concurrency: true }, () => {
      it('workspaceGet returns deployed state', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const state = await workspaceGet(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);
        assert.ok(state !== null);
        assert.strictEqual(state.packageName, 'compute-pkg');
        assert.strictEqual(state.packageVersion, '1.0.0');
      });

      it('workspaceStatus returns datasets and tasks', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);

        assert.strictEqual(status.workspace, 'deployed-ws');
        // Should have input and output datasets
        assert.ok(status.datasets.length >= 2);
        // Should have the compute task
        assert.strictEqual(status.tasks.length, 1);
        assert.strictEqual(status.tasks[0].name, 'compute');
        // Summary should match
        assert.strictEqual(status.summary.tasks.total, 1n);
      });

      it('taskList returns task info', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const tasks = await taskList(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);
        assert.ok(Array.isArray(tasks));
        assert.ok(tasks.length > 0, 'should have at least one task');

        const computeTask = tasks.find(t => t.name === 'compute');
        assert.ok(computeTask, 'should have compute task');
        assert.ok(computeTask.hash.length > 0);
      });

      it('taskGet returns task details', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const task = await taskGet(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', 'compute', opts);
        assert.strictEqual(task.name, 'compute');
        assert.ok(task.hash.length > 0);
        assert.ok(Array.isArray(task.inputs));
        assert.ok(task.output);
      });

      it('dataflowGraph returns dependency graph', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const graph = await dataflowGraph(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);
        assert.ok(Array.isArray(graph.tasks));
        assert.ok(graph.tasks.length > 0);

        const computeTask = graph.tasks.find(t => t.name === 'compute');
        assert.ok(computeTask);
        assert.ok(Array.isArray(computeTask.inputs));
        assert.ok(computeTask.output);
        assert.ok(Array.isArray(computeTask.dependsOn));
      });
    });
  });
}
