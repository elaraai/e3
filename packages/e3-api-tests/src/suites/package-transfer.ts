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
  ApiError,
  ApiTypes,
  fetchWithAuth,
  type Response,
} from '@elaraai/e3-api-client';
import { encodeBeast2For, decodeBeast2For, NullType } from '@elaraai/east';
import {
  PackageTransferInitRequestType,
  PackageTransferInitResponseType,
  PackageImportStatusType,
  type PackageImportStatus,
} from '@elaraai/e3-types';

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

    // =========================================================================
    // Failure-path tests
    // =========================================================================

    it('export of non-existent package fails with package_not_found', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      await assert.rejects(
        () => packageExport(ctx.config.baseUrl, ctx.repoName, 'no-such-pkg', '9.9.9', opts),
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.code, 'package_not_found');
          return true;
        }
      );
    });

    it('import of corrupted zip fails', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // Random bytes — not a valid zip
      const garbage = new Uint8Array(1024);
      for (let i = 0; i < garbage.length; i++) garbage[i] = Math.floor(Math.random() * 256);

      await assert.rejects(
        () => packageImport(ctx.config.baseUrl, ctx.repoName, garbage, opts),
        (err: any) => {
          // Import should fail — either ApiError or Error with failure message
          assert.ok(err instanceof Error, `Expected Error, got ${err}`);
          return true;
        }
      );
    });

    it('upload with wrong size is rejected', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      const repoEncoded = encodeURIComponent(ctx.repoName);
      const BEAST2 = 'application/beast2';

      // 1. Init transfer claiming size 100
      const encode = encodeBeast2For(PackageTransferInitRequestType);
      const initRes = await fetchWithAuth(
        `${ctx.config.baseUrl}/api/repos/${repoEncoded}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': BEAST2, 'Accept': BEAST2 },
          body: encode({ size: 100n }),
        },
        opts
      );
      assert.ok(initRes.ok, `Init should succeed, got ${initRes.status}`);

      // Decode to get uploadUrl and id
      const initBuffer = new Uint8Array(await initRes.arrayBuffer());
      const decodeInit = decodeBeast2For(ApiTypes.ResponseType(PackageTransferInitResponseType));
      const initResult = decodeInit(initBuffer) as Response<{ id: string; uploadUrl: string }>;
      assert.strictEqual(initResult.type, 'success');
      const { id, uploadUrl } = initResult.value;

      // 2. Upload only 50 bytes (mismatched with declared size of 100)
      //    Local server validates size at upload time (BEAST2 error response).
      //    Cloud server accepts the upload (S3 presigned URL) and validates at execute time.
      const shortData = new Uint8Array(50);
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/zip' },
        body: shortData,
      });

      // Check if the upload itself rejected the size mismatch (local server behavior)
      // Local server returns HTTP 400 for size mismatch
      if (!uploadRes.ok) {
        // Size mismatch caught at upload time — test passes
        return;
      }
      if (uploadRes.headers.get('content-type')?.includes('beast2')) {
        const uploadBuffer = new Uint8Array(await uploadRes.arrayBuffer());
        if (uploadBuffer.length > 0) {
          const decodeUpload = decodeBeast2For(ApiTypes.ResponseType(NullType));
          const uploadResult = decodeUpload(uploadBuffer) as Response<null>;
          if (uploadResult.type === 'error') {
            // Size mismatch caught at upload time — test passes
            return;
          }
        }
      }

      // 3. Upload was accepted (cloud/presigned URL) — trigger import to validate
      const triggerRes = await fetchWithAuth(
        `${ctx.config.baseUrl}/api/repos/${repoEncoded}/import/${id}`,
        {
          method: 'POST',
          headers: { 'Accept': BEAST2 },
        },
        opts
      );
      assert.ok(triggerRes.ok, `Trigger should return 200, got ${triggerRes.status}`);

      // 4. Poll until terminal status — expect failure due to size mismatch or corrupt zip
      const decodePoll = decodeBeast2For(ApiTypes.ResponseType(PackageImportStatusType));
      let status: PackageImportStatus | undefined;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const pollRes = await fetchWithAuth(
          `${ctx.config.baseUrl}/api/repos/${repoEncoded}/import/${id}`,
          {
            method: 'GET',
            headers: { 'Accept': BEAST2 },
          },
          opts
        );
        assert.ok(pollRes.ok);
        const pollBuffer = new Uint8Array(await pollRes.arrayBuffer());
        const pollResult = decodePoll(pollBuffer) as Response<PackageImportStatus>;
        assert.strictEqual(pollResult.type, 'success');
        status = pollResult.value;
        if (status.type === 'failed' || status.type === 'completed') break;
      }

      assert.ok(status, 'Should have received a terminal status');
      assert.strictEqual(status.type, 'failed', 'Expected failed status due to size mismatch');
    });

    it('poll for non-existent import returns error', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      const repoEncoded = encodeURIComponent(ctx.repoName);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await fetchWithAuth(
        `${ctx.config.baseUrl}/api/repos/${repoEncoded}/import/${fakeId}`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/beast2' },
        },
        opts
      );

      // Server returns 200 with BEAST2 error response for unknown jobs
      assert.ok(res.ok, `Expected 200 response, got ${res.status}`);
      const buffer = new Uint8Array(await res.arrayBuffer());
      const decode = decodeBeast2For(ApiTypes.ResponseType(PackageImportStatusType));
      const result = decode(buffer) as Response<PackageImportStatus>;
      assert.strictEqual(result.type, 'error', 'Expected error variant for non-existent job');
    });
  });
}
