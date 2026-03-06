/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Package transfer protocol test suite.
 *
 * Tests the staged transfer flow for package import/export.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  packageList,
  packageImport,
  packageExport,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createPackageZip } from '../fixtures.js';

/**
 * Register package transfer protocol tests.
 */
export function packageTransferTests(setup: TestSetup<TestContext>): void {
  const withPackageZip: TestSetup<TestContext & { packageZip: Uint8Array }> = async (t) => {
    const ctx = await setup(t);
    const zipPath = await createPackageZip(ctx.tempDir, 'transfer-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    return Object.assign(ctx, { packageZip });
  };

  describe('package-transfer', { concurrency: true }, () => {
    it('import via transfer flow round-trips', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      const result = await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);
      assert.strictEqual(result.name, 'transfer-pkg');
      assert.strictEqual(result.version, '1.0.0');
      assert.strictEqual(result.packageHash.length, 64);
      assert.ok(result.objectCount > 0n);

      const packages = await packageList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(packages.length, 1);
      assert.strictEqual(packages[0].name, 'transfer-pkg');
    });

    it('export via transfer flow returns valid zip', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);

      const exported = await packageExport(ctx.config.baseUrl, ctx.repoName, 'transfer-pkg', '1.0.0', opts);
      assert.ok(exported instanceof Uint8Array);
      assert.ok(exported.length > 0);
      // ZIP files start with PK signature
      assert.strictEqual(exported[0], 0x50);
      assert.strictEqual(exported[1], 0x4b);
    });

    it('import then export then re-import round-trip', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      // Import original
      const result1 = await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);
      assert.strictEqual(result1.name, 'transfer-pkg');

      // Export
      const exported = await packageExport(ctx.config.baseUrl, ctx.repoName, 'transfer-pkg', '1.0.0', opts);

      // Re-import (should succeed, package already exists is an error but let's verify zip is valid)
      // The re-import of same name+version may error with package_exists, which is expected
      try {
        await packageImport(ctx.config.baseUrl, ctx.repoName, exported, opts);
        // If it succeeds (idempotent), that's fine too
      } catch (err: any) {
        // PackageExistsError is expected
        assert.ok(err.code === 'package_exists' || err.message.includes('already exists'),
          `Unexpected error: ${err.message}`);
      }
    });
  });
}
