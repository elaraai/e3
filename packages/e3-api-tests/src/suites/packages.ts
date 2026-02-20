/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Package operations test suite.
 *
 * Tests: import, list, get, export, remove
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  packageList,
  packageGet,
  packageImport,
  packageExport,
  packageRemove,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createPackageZip } from '../fixtures.js';

/**
 * Register package operation tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function packageTests(setup: TestSetup<TestContext>): void {
  const withPackageZip: TestSetup<TestContext & { packageZip: Uint8Array }> = async (t) => {
    const ctx = await setup(t);
    const zipPath = await createPackageZip(ctx.tempDir, 'test-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    return Object.assign(ctx, { packageZip });
  };

  describe('packages', { concurrency: true }, () => {
    it('packageList returns empty initially', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      const packages = await packageList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.deepStrictEqual(packages, []);
    });

    it('packageImport and packageList round-trip', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      // Import
      const result = await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);
      assert.strictEqual(result.name, 'test-pkg');
      assert.strictEqual(result.version, '1.0.0');
      assert.strictEqual(result.packageHash.length, 64); // SHA256 hex
      assert.ok(result.objectCount > 0n);

      // List
      const packages = await packageList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(packages.length, 1);
      assert.strictEqual(packages[0].name, 'test-pkg');
      assert.strictEqual(packages[0].version, '1.0.0');
    });

    it('packageGet returns package object', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);

      const pkg = await packageGet(ctx.config.baseUrl, ctx.repoName, 'test-pkg', '1.0.0', opts);
      // PackageObject has tasks Map with our 'compute' task
      assert.ok(pkg.tasks instanceof Map);
      assert.strictEqual(pkg.tasks.size, 1);
      assert.ok(pkg.tasks.has('compute'));
    });

    it('packageExport returns zip bytes', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);

      const exported = await packageExport(ctx.config.baseUrl, ctx.repoName, 'test-pkg', '1.0.0', opts);
      assert.ok(exported instanceof Uint8Array);
      assert.ok(exported.length > 0);
      // ZIP files start with PK signature
      assert.strictEqual(exported[0], 0x50); // 'P'
      assert.strictEqual(exported[1], 0x4b); // 'K'
    });

    it('packageRemove deletes package', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);

      // Verify exists
      let packages = await packageList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(packages.length, 1);

      // Remove
      await packageRemove(ctx.config.baseUrl, ctx.repoName, 'test-pkg', '1.0.0', opts);

      // Verify gone
      packages = await packageList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(packages.length, 0);
    });
  });
}
