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
      const entries = await datasetListWithStatus(ctx.config.baseUrl, ctx.repoName, 'dataset-ws', inputsPath, opts);
      assert.ok(Array.isArray(entries), 'should return an array');
      // The string package has at least one input field
      assert.ok(entries.length >= 1, `expected at least 1 entry, got ${entries.length}`);
      // Each dataset entry should have path, type, hash, size
      const datasets = entries.filter(e => e.type === 'dataset');
      assert.ok(datasets.length >= 1, 'should have at least 1 dataset entry');
      for (const entry of datasets) {
        const item = entry.value;
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

      // List all entries recursively — includes tree and dataset entries
      const entries = await datasetListRecursive(ctx.config.baseUrl, ctx.repoName, 'hashsize-ws', [], opts);

      // Should have tree entries (inputs, tasks, etc.) and dataset entries
      const treeEntries = entries.filter(e => e.type === 'tree');
      const datasetEntries = entries.filter(e => e.type === 'dataset');
      assert.ok(treeEntries.length >= 1, `expected at least 1 tree entry, got ${treeEntries.length}`);
      assert.ok(datasetEntries.length >= 2, `expected at least 2 dataset entries, got ${datasetEntries.length}`);

      // Find the input dataset and task output dataset
      const inputItem = datasetEntries.find(d => d.value.path.includes('value'));
      const outputItem = datasetEntries.find(d => d.value.path.includes('compute'));
      assert.ok(inputItem, 'should find input "value" dataset');
      assert.ok(outputItem, 'should find task "compute" dataset');

      // Input has a default value (10n) — hash and size should be populated
      assert.strictEqual(inputItem.value.hash.type, 'some', 'input hash should be some');
      assert.strictEqual(inputItem.value.size.type, 'some', 'input size should be some');
      assert.strictEqual(typeof inputItem.value.hash.value, 'string');
      assert.strictEqual(inputItem.value.hash.value.length, 64, 'hash should be 64-char hex');
      assert.ok(inputItem.value.size.value > 0n, 'input size should be positive');

      // Task output is unassigned — hash and size should be none
      assert.strictEqual(outputItem.value.hash.type, 'none', 'unassigned output hash should be none');
      assert.strictEqual(outputItem.value.size.type, 'none', 'unassigned output size should be none');

      // Now set the input to a new value and verify hash/size update
      const encode = encodeBeast2For(IntegerType);
      const inputPath = [
        variant('field', 'inputs'),
        variant('field', 'value'),
      ];
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'hashsize-ws', inputPath, encode(42n), opts);

      // List again and check the input has updated hash/size
      const entries2 = await datasetListRecursive(ctx.config.baseUrl, ctx.repoName, 'hashsize-ws', [], opts);
      const datasetEntries2 = entries2.filter(e => e.type === 'dataset');
      const inputItem2 = datasetEntries2.find(d => d.value.path.includes('value'));
      assert.ok(inputItem2, 'should find input after set');
      assert.strictEqual(inputItem2.value.hash.type, 'some', 'updated input hash should be some');
      assert.strictEqual(inputItem2.value.size.type, 'some', 'updated input size should be some');
      assert.strictEqual(inputItem2.value.hash.value.length, 64, 'updated hash should be 64-char hex');
      assert.ok(inputItem2.value.size.value > 0n, 'updated input size should be positive');
    });
  });
}
