/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataset operations test suite.
 *
 * Tests: list, listAt, get, set
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IntegerType, StringType, encodeBeast2For, decodeBeast2For, variant } from '@elaraai/east';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetList,
  datasetListAt,
  datasetListRecursive,
  datasetListRecursivePaths,
  datasetListWithStatus,
  datasetGet,
  datasetGetStatus,
  datasetSet,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createStringPackageZip, createPackageZip } from '../fixtures.js';

/**
 * Register dataset operation tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function datasetTests(setup: TestSetup<TestContext>): void {
  const withStringPackage: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();

    const zipPath = await createStringPackageZip(ctx.tempDir, 'dataset-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', 'dataset-pkg@1.0.0', opts);

    return ctx;
  };

  describe('datasets', { concurrency: true }, () => {
    it('datasetList returns field names', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      const fields = await datasetList(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', opts);
      // Should have inputs and tasks (outputs are under tasks)
      assert.ok(fields.includes('inputs'));
      assert.ok(fields.includes('tasks'));
    });

    it('datasetListAt returns nested fields', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      const path = [variant('field', 'inputs')];
      const fields = await datasetListAt(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', path, opts);
      assert.ok(Array.isArray(fields));
      assert.ok(fields.includes('config'), 'should have config field under inputs');
    });

    it('datasetSet and datasetGet round-trip', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      // Encode value as BEAST2
      const encode = encodeBeast2For(StringType);
      const decode = decodeBeast2For(StringType);
      const data = encode('hello world');

      // Set - TreePath uses variant('field', name) elements
      const path = [
        variant('field', 'inputs'),
        variant('field', 'config'),
      ];
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', path, data, opts);

      // Get and decode
      const retrieved = await datasetGet(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', path, opts);
      assert.ok(retrieved instanceof Uint8Array);

      const decoded = decode(retrieved);
      assert.strictEqual(decoded, 'hello world');
    });

    it('datasetSet overwrites existing value', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      const encode = encodeBeast2For(StringType);
      const decode = decodeBeast2For(StringType);

      const path = [
        variant('field', 'inputs'),
        variant('field', 'config'),
      ];

      // Set initial value
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', path, encode('first'), opts);

      // Overwrite with new value
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', path, encode('second'), opts);

      // Verify new value
      const retrieved = await datasetGet(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', path, opts);
      const decoded = decode(retrieved);
      assert.strictEqual(decoded, 'second');
    });

    it('datasetGetStatus returns status detail', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // Use createPackageZip: integer input (default 10n), task "compute" (multiplies by 2)
      const zipPath = await createPackageZip(ctx.tempDir, 'status-pkg', '1.0.0');
      const packageZip = readFileSync(zipPath);
      await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'status-ws', opts);
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'status-ws', 'status-pkg@1.0.0', opts);

      // Check input status — should be 'value' with hash and size
      const inputPath = [variant('field', 'inputs'), variant('field', 'value')];
      const inputStatus = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'status-ws', inputPath, opts);
      assert.strictEqual(inputStatus.refType, 'value');
      assert.strictEqual(inputStatus.hash.type, 'some');
      assert.strictEqual(inputStatus.hash.value.length, 64, 'hash should be 64-char hex');
      assert.strictEqual(inputStatus.size.type, 'some');
      assert.ok(inputStatus.size.value > 0n, 'input size should be positive');

      // Check task output status — should be 'unassigned'
      const outputPath = [variant('field', 'tasks'), variant('field', 'compute'), variant('field', 'output')];
      const outputStatus = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'status-ws', outputPath, opts);
      assert.strictEqual(outputStatus.refType, 'unassigned');
      assert.strictEqual(outputStatus.hash.type, 'none');
      assert.strictEqual(outputStatus.size.type, 'none');

      // Set input to 42n and verify updated status
      const encode = encodeBeast2For(IntegerType);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'status-ws', inputPath, encode(42n), opts);

      const updatedStatus = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'status-ws', inputPath, opts);
      assert.strictEqual(updatedStatus.refType, 'value');
      assert.strictEqual(updatedStatus.hash.type, 'some');
      assert.strictEqual(updatedStatus.hash.value.length, 64);
      assert.strictEqual(updatedStatus.size.type, 'some');
      assert.ok(updatedStatus.size.value > 0n);
    });

    it('datasetListRecursivePaths returns string array of paths', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      const zipPath = await createPackageZip(ctx.tempDir, 'paths-pkg', '1.0.0');
      const packageZip = readFileSync(zipPath);
      await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'paths-ws', opts);
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'paths-ws', 'paths-pkg@1.0.0', opts);

      const paths = await datasetListRecursivePaths(ctx.config.baseUrl, ctx.repoName, 'paths-ws', [], opts);
      assert.ok(Array.isArray(paths), 'should return an array');
      assert.ok(paths.length >= 2, `expected at least 2 paths, got ${paths.length}`);
      // Each path should be a dot-separated string starting with "."
      for (const p of paths) {
        assert.ok(typeof p === 'string', 'each path should be a string');
        assert.ok(p.startsWith('.'), `path should start with ".", got: ${p}`);
      }
      // Should include input and task output paths
      assert.ok(paths.some(p => p.includes('value')), 'should include input path');
      assert.ok(paths.some(p => p.includes('compute')), 'should include task output path');
    });

    it('datasetListWithStatus returns immediate children with details', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      // List immediate children under "inputs" (should have "config")
      const inputsPath = [variant('field', 'inputs')];
      const items = await datasetListWithStatus(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', inputsPath, opts);
      assert.ok(Array.isArray(items), 'should return an array');
      // The string package has at least one input field
      assert.ok(items.length >= 1, `expected at least 1 item, got ${items.length}`);
      // Each item should have path, type, hash, size
      for (const item of items) {
        assert.ok(typeof item.path === 'string', 'item should have path');
        assert.ok(item.type !== undefined, 'item should have type');
        assert.ok(item.hash.type === 'some' || item.hash.type === 'none', 'item should have hash option');
        assert.ok(item.size.type === 'some' || item.size.type === 'none', 'item should have size option');
      }
    });

    it('datasetListRecursive returns hash and size', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // Use createPackageZip: integer input (default 10n), task "compute" (multiplies by 2)
      const zipPath = await createPackageZip(ctx.tempDir, 'hashsize-pkg', '1.0.0');
      const packageZip = readFileSync(zipPath);
      await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'hashsize-ws', opts);
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'hashsize-ws', 'hashsize-pkg@1.0.0', opts);

      // List all datasets recursively — input has a default value, task output is unassigned
      const items = await datasetListRecursive(ctx.config.baseUrl, ctx.repoName, 'hashsize-ws', [], opts);
      assert.ok(items.length >= 2, `expected at least 2 datasets, got ${items.length}`);

      // Find the input dataset and task output dataset
      const inputItem = items.find(d => d.path.includes('value'));
      const outputItem = items.find(d => d.path.includes('compute'));
      assert.ok(inputItem, 'should find input "value" dataset');
      assert.ok(outputItem, 'should find task "compute" dataset');

      // Input has a default value (10n) — hash and size should be populated
      assert.strictEqual(inputItem.hash.type, 'some', 'input hash should be some');
      assert.strictEqual(inputItem.size.type, 'some', 'input size should be some');
      assert.strictEqual(typeof inputItem.hash.value, 'string');
      assert.strictEqual(inputItem.hash.value.length, 64, 'hash should be 64-char hex');
      assert.ok(inputItem.size.value > 0n, 'input size should be positive');

      // Task output is unassigned — hash and size should be none
      assert.strictEqual(outputItem.hash.type, 'none', 'unassigned output hash should be none');
      assert.strictEqual(outputItem.size.type, 'none', 'unassigned output size should be none');

      // Now set the input to a new value and verify hash/size update
      const encode = encodeBeast2For(IntegerType);
      const inputPath = [
        variant('field', 'inputs'),
        variant('field', 'value'),
      ];
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'hashsize-ws', inputPath, encode(42n), opts);

      // List again and check the input has updated hash/size
      const items2 = await datasetListRecursive(ctx.config.baseUrl, ctx.repoName, 'hashsize-ws', [], opts);
      const inputItem2 = items2.find(d => d.path.includes('value'));
      assert.ok(inputItem2, 'should find input after set');
      assert.strictEqual(inputItem2.hash.type, 'some', 'updated input hash should be some');
      assert.strictEqual(inputItem2.size.type, 'some', 'updated input size should be some');
      assert.strictEqual(inputItem2.hash.value.length, 64, 'updated hash should be 64-char hex');
      assert.ok(inputItem2.size.value > 0n, 'updated input size should be positive');
    });
  });
}
