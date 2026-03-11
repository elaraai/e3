/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeast2For, StringType, variant } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, computeHash, InMemoryTransferBackend } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { getDataset } from './datasets.js';

const REPO = 'test-repo';
const WS = 'test-ws';

describe('getDataset', () => {
  it('returns BEAST2 bytes with correct headers', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    // Write a BEAST2-encoded value to the object store
    const encode = encodeBeast2For(StringType);
    const data = encode('hello');
    const hash = await storage.objects.write(REPO, data);

    // Write a dataset ref pointing to that object
    await storage.datasets.write(REPO, WS, 'inputs/config', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'config')];
    const response = await getDataset(storage, REPO, WS, treePath);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
    assert.equal(response.headers.get('Content-Length'), String(data.byteLength));

    const body = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(body, data);
  });

  it('returns correct Content-Length for large payloads', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    // Create a larger payload (~100KB)
    const largeString = 'x'.repeat(100_000);
    const encode = encodeBeast2For(StringType);
    const data = encode(largeString);
    const hash = await storage.objects.write(REPO, data);

    await storage.datasets.write(REPO, WS, 'inputs/big', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'big')];
    const response = await getDataset(storage, REPO, WS, treePath);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Length'), String(data.byteLength));
    assert.equal(response.headers.get('X-Content-SHA256'), hash);

    // Verify hash matches actual content
    const body = new Uint8Array(await response.arrayBuffer());
    assert.equal(computeHash(body), hash);
  });

  it('returns JSON with download URL for >1MB datasets when transferBackend provided', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    const transferBackend = new InMemoryTransferBackend({ baseUrl: '' });

    // Create a >1MB payload
    const largeString = 'x'.repeat(1_100_000);
    const encode = encodeBeast2For(StringType);
    const data = encode(largeString);
    const hash = await storage.objects.write(REPO, data);

    await storage.datasets.write(REPO, WS, 'inputs/big', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'big')];
    const requestUrl = `http://localhost:3000/api/repos/${REPO}/workspaces/${WS}/datasets/inputs/big`;
    const response = await getDataset(storage, REPO, WS, treePath, REPO, requestUrl, transferBackend);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
    assert.equal(response.headers.get('X-Content-Length'), String(data.byteLength));

    const body = await response.json() as { url: string };
    assert.ok(body.url, 'should have url in body');
    assert.ok(body.url.includes('/api/downloads/'), `Expected /api/downloads/ URL, got ${body.url}`);
  });

  it('returns inline bytes for >1MB datasets without transferBackend', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    // Create a >1MB payload
    const largeString = 'x'.repeat(1_100_000);
    const encode = encodeBeast2For(StringType);
    const data = encode(largeString);
    const hash = await storage.objects.write(REPO, data);

    await storage.datasets.write(REPO, WS, 'inputs/big', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'big')];
    const requestUrl = `http://localhost:3000/api/repos/${REPO}/workspaces/${WS}/datasets/inputs/big`;
    const response = await getDataset(storage, REPO, WS, treePath, REPO, requestUrl);

    // Without transferBackend, large datasets are served inline
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
  });

  it('returns inline bytes for ≤1MB datasets even with requestUrl', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    const encode = encodeBeast2For(StringType);
    const data = encode('small value');
    const hash = await storage.objects.write(REPO, data);

    await storage.datasets.write(REPO, WS, 'inputs/small', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'small')];
    const requestUrl = `http://localhost:3000/api/repos/${REPO}/workspaces/${WS}/datasets/inputs/small`;
    const response = await getDataset(storage, REPO, WS, treePath, REPO, requestUrl);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
  });

  it('returns error for null dataset', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    await storage.datasets.write(REPO, WS, 'inputs/empty', variant('null', {
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'empty')];
    const response = await getDataset(storage, REPO, WS, treePath);

    // Error responses are wrapped in BEAST2 Response variant
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
  });

  it('returns error for unassigned dataset', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    await storage.datasets.write(REPO, WS, 'tasks/output', variant('unassigned', null));

    const treePath = [variant('field', 'tasks'), variant('field', 'output')];
    const response = await getDataset(storage, REPO, WS, treePath);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
  });

  it('returns error for empty path', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    const response = await getDataset(storage, REPO, WS, []);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
  });
});
