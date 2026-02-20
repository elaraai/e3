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

import { StringType, encodeBeast2For, decodeBeast2For, variant } from '@elaraai/east';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetList,
  datasetListAt,
  datasetGet,
  datasetSet,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createStringPackageZip } from '../fixtures.js';

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
  });
}
