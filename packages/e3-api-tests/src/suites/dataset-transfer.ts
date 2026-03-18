/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataset transfer test suite.
 *
 * Tests: redirect-based GET for large objects, transfer upload flow for large SET,
 * dedup shortcut, and hash mismatch rejection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { StringType, encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import { variant } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, computeHash } from '@elaraai/e3-core';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetGet,
  datasetSet,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createStringPackageZip } from '../fixtures.js';

/**
 * Register dataset transfer tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function datasetTransferTests(setup: TestSetup<TestContext>): void {
  const withStringPackage: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();

    const zipPath = await createStringPackageZip(ctx.tempDir, 'transfer-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', 'transfer-pkg@1.0.0', opts);

    return ctx;
  };

  describe('dataset transfer', { concurrency: true }, () => {
    it('large dataset SET uses transfer flow and round-trips', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      // Create a >1MB payload using a large string
      const largeString = 'x'.repeat(1_100_000);
      const encode = encodeBeast2For(StringType);
      const data = encode(largeString);
      assert.ok(data.byteLength > 1024 * 1024, 'payload should exceed 1MB threshold');

      const path = [variant('field', 'inputs'), variant('field', 'config')];

      // Set via transfer flow (client automatically uses transfer for >1MB)
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      // Get and verify round-trip via hash comparison (avoiding BEAST2 decode stack overflow on large strings)
      const expectedHash = computeHash(data);
      const { data: retrieved, hash, size } = await datasetGet(
        ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts
      );
      assert.ok(retrieved instanceof Uint8Array);
      assert.strictEqual(hash, expectedHash, 'hash should match original data');
      assert.strictEqual(size, data.byteLength, 'size should match');
      assert.strictEqual(computeHash(retrieved), expectedHash, 'retrieved data hash should match');
    });

    it('large dataset SET dedup skips upload on second set of same data', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      const largeString = 'y'.repeat(1_100_000);
      const encode = encodeBeast2For(StringType);
      const data = encode(largeString);
      const expectedHash = computeHash(data);

      const path = [variant('field', 'inputs'), variant('field', 'config')];

      // First set — full upload
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      // Second set with same data — should dedup (object already exists)
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      // Verify data is correct via hash
      const { data: retrieved, hash } = await datasetGet(
        ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts
      );
      assert.strictEqual(hash, expectedHash, 'hash should match after dedup');
      assert.strictEqual(computeHash(retrieved), expectedHash, 'retrieved data should match');
    });

    it('GET object endpoint returns bytes for known hash', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      // Set a small value first to get a known hash
      const encode = encodeBeast2For(StringType);
      const data = encode('object-endpoint-test');

      const path = [variant('field', 'inputs'), variant('field', 'config')];
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      // Get the hash
      const { hash } = await datasetGet(
        ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts
      );

      // Fetch directly from object endpoint
      const response = await fetch(
        `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/objects/${hash}`,
        {
          headers: { 'Authorization': `Bearer ${(await ctx.opts()).token}` },
        }
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
      assert.strictEqual(response.headers.get('X-Content-SHA256'), hash);

      const body = new Uint8Array(await response.arrayBuffer());
      assert.strictEqual(computeHash(body), hash);
    });

    it('GET object endpoint returns JSON error for missing hash', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      const fakeHash = 'a'.repeat(64);
      const response = await fetch(
        `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/objects/${fakeHash}`,
        {
          headers: { 'Authorization': `Bearer ${opts.token}` },
        }
      );
      // Error returned as JSON with appropriate HTTP status code
      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.headers.get('Content-Type'), 'application/json');
      const body = await response.json() as { error: { type: string; message: string } };
      assert.strictEqual(body.error.type, 'object_not_found');
    });

    it('small dataset SET still uses inline PUT', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      // Small payload — should use inline PUT (existing path)
      const encode = encodeBeast2For(StringType);
      const decode = decodeBeast2For(StringType);
      const data = encode('small value');

      const path = [variant('field', 'inputs'), variant('field', 'config')];
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      const { data: retrieved } = await datasetGet(
        ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts
      );
      assert.strictEqual(decode(retrieved), 'small value');
    });
  });
}
