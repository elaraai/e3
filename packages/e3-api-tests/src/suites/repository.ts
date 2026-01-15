/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Repository operations test suite.
 *
 * Tests: status, gc, create, remove
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { variant } from '@elaraai/east';
import {
  repoStatus,
  repoGc,
  repoCreate,
  repoRemove,
  packageRemove,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';

/**
 * Register repository operation tests.
 *
 * @param getContext - Function that returns the current test context
 */
export function repositoryTests(getContext: () => TestContext): void {
  describe('repository', () => {
    it('repoStatus returns repository info', async () => {
      const ctx = getContext();
      const opts = await ctx.opts();

      const status = await repoStatus(ctx.config.baseUrl, ctx.repoName, opts);

      assert.ok(typeof status.path === 'string' && status.path.length > 0, 'path should be a non-empty string');
      assert.ok(typeof status.objectCount === 'bigint');
      assert.ok(typeof status.packageCount === 'bigint');
      assert.ok(typeof status.workspaceCount === 'bigint');
    });

    it('repoGc with dryRun returns stats', async () => {
      const ctx = getContext();
      const opts = await ctx.opts();

      const result = await repoGc(
        ctx.config.baseUrl,
        ctx.repoName,
        { dryRun: true, minAge: variant('none', null) },
        opts
      );

      // Empty repo - nothing to delete
      assert.strictEqual(result.deletedObjects, 0n);
      assert.strictEqual(result.deletedPartials, 0n);
      assert.ok(result.retainedObjects >= 0n);
      assert.ok(result.bytesFreed >= 0n);
    });

    it('repoGc runs garbage collection', async () => {
      const ctx = getContext();
      const opts = await ctx.opts();

      // Import a package then remove it to create garbage
      const zipPath = await ctx.createPackage('gc-test-pkg', '1.0.0');
      await ctx.importPackage(zipPath);

      // Remove the package to create garbage (orphaned objects)
      await packageRemove(ctx.config.baseUrl, ctx.repoName, 'gc-test-pkg', '1.0.0', opts);

      // Run GC (not dry run)
      const result = await repoGc(
        ctx.config.baseUrl,
        ctx.repoName,
        { dryRun: false, minAge: variant('none', null) },
        opts
      );

      // Should return valid stats
      assert.ok(typeof result.deletedObjects === 'bigint');
      assert.ok(typeof result.retainedObjects === 'bigint');
    });

    it('repoCreate creates a new repository', async () => {
      const ctx = getContext();
      const opts = await ctx.opts();
      const newRepoName = `create-test-${Date.now()}`;

      try {
        // Create a new repo via API
        const result = await repoCreate(ctx.config.baseUrl, newRepoName, opts);
        assert.strictEqual(result, newRepoName);

        // Verify it exists by getting status
        const status = await repoStatus(ctx.config.baseUrl, newRepoName, opts);
        assert.ok(typeof status.path === 'string' && status.path.length > 0, 'new repo should have a valid path');
      } finally {
        // Clean up
        try {
          await repoRemove(ctx.config.baseUrl, newRepoName, opts);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('repoRemove removes an existing repository', async () => {
      const ctx = getContext();
      const opts = await ctx.opts();
      const tempRepoName = `remove-test-${Date.now()}`;

      // Create a repo to delete
      await repoCreate(ctx.config.baseUrl, tempRepoName, opts);

      // Verify it exists
      const status = await repoStatus(ctx.config.baseUrl, tempRepoName, opts);
      assert.ok(typeof status.path === 'string' && status.path.length > 0);

      // Remove it - should complete without error
      await repoRemove(ctx.config.baseUrl, tempRepoName, opts);

      // Verify removal worked by trying to create it again (should succeed if it was removed)
      await repoCreate(ctx.config.baseUrl, tempRepoName, opts);
      await repoRemove(ctx.config.baseUrl, tempRepoName, opts); // Clean up
    });
  });
}
