/**
 * Tests for objects.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeHash,
  computeHashFromStream,
  storeObject,
  storeObjectFromStream,
  loadObject,
  computeTaskId,
} from './objects.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

describe('objects', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  describe('computeHash', () => {
    it('computes correct SHA256 hash', () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = computeHash(data);

      // Expected hash for [1, 2, 3]
      assert.strictEqual(hash, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    });

    it('returns same hash for same data', () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash1 = computeHash(data);
      const hash2 = computeHash(data);

      assert.strictEqual(hash1, hash2);
    });

    it('returns different hash for different data', () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([1, 2, 4]);

      const hash1 = computeHash(data1);
      const hash2 = computeHash(data2);

      assert.notStrictEqual(hash1, hash2);
    });

    it('handles empty data', () => {
      const data = new Uint8Array([]);
      const hash = computeHash(data);

      // SHA256 hash of empty data
      assert.strictEqual(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('handles large data', () => {
      const data = new Uint8Array(1024 * 1024); // 1MB of zeros
      const hash = computeHash(data);

      assert.strictEqual(typeof hash, 'string');
      assert.strictEqual(hash.length, 64); // SHA256 produces 64 hex chars
    });
  });

  describe('computeHashFromStream', () => {
    it('computes hash from stream', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });

      const result = await computeHashFromStream(stream);

      assert.strictEqual(result.hash, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
      assert.strictEqual(result.data.length, 1);
      assert.deepStrictEqual(result.data[0], data);
    });

    it('handles chunked stream', async () => {
      const chunk1 = new Uint8Array([1, 2]);
      const chunk2 = new Uint8Array([3]);

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk1);
          controller.enqueue(chunk2);
          controller.close();
        },
      });

      const result = await computeHashFromStream(stream);

      // Should produce same hash as [1, 2, 3]
      assert.strictEqual(result.hash, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
      assert.strictEqual(result.data.length, 2);
      assert.deepStrictEqual(result.data[0], chunk1);
      assert.deepStrictEqual(result.data[1], chunk2);
    });
  });

  describe('storeObject', () => {
    it('stores and returns hash', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = await storeObject(testRepo, data, '.beast2');

      assert.strictEqual(hash, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    });

    it('creates correct directory structure', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = await storeObject(testRepo, data, '.beast2');

      const dirName = hash.slice(0, 2);
      const fileName = hash.slice(2) + '.beast2';
      const filePath = join(testRepo, 'objects', dirName, fileName);

      const stored = readFileSync(filePath);
      assert.deepStrictEqual(new Uint8Array(stored), data);
    });

    it('uses provided extension', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = await storeObject(testRepo, data, '.east');

      const dirName = hash.slice(0, 2);
      const fileName = hash.slice(2) + '.east';
      const filePath = join(testRepo, 'objects', dirName, fileName);

      const stored = readFileSync(filePath);
      assert.deepStrictEqual(new Uint8Array(stored), data);
    });

    it('deduplicates identical data', async () => {
      const data = new Uint8Array([1, 2, 3]);

      const hash1 = await storeObject(testRepo, data, '.beast2');
      const hash2 = await storeObject(testRepo, data, '.beast2');

      assert.strictEqual(hash1, hash2);

      // Verify only one file exists
      const dirName = hash1.slice(0, 2);
      const fileName = hash1.slice(2) + '.beast2';
      const filePath = join(testRepo, 'objects', dirName, fileName);

      const stored = readFileSync(filePath);
      assert.deepStrictEqual(new Uint8Array(stored), data);
    });

    it('stores different extensions separately', async () => {
      const data = new Uint8Array([1, 2, 3]);

      const hash1 = await storeObject(testRepo, data, '.beast2');
      const hash2 = await storeObject(testRepo, data, '.east');

      assert.strictEqual(hash1, hash2); // Same hash

      // Both files should exist
      const dirName = hash1.slice(0, 2);
      const file1 = join(testRepo, 'objects', dirName, hash1.slice(2) + '.beast2');
      const file2 = join(testRepo, 'objects', dirName, hash2.slice(2) + '.east');

      assert.doesNotThrow(() => readFileSync(file1));
      assert.doesNotThrow(() => readFileSync(file2));
    });

    it.skip('handles concurrent writes to same hash', async () => {
      const data = new Uint8Array([1, 2, 3]);

      // Concurrent writes
      const [hash1, hash2, hash3] = await Promise.all([
        storeObject(testRepo, data, '.beast2'),
        storeObject(testRepo, data, '.beast2'),
        storeObject(testRepo, data, '.beast2'),
      ]);

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash2, hash3);

      // Verify data is correct
      const dirName = hash1.slice(0, 2);
      const fileName = hash1.slice(2) + '.beast2';
      const filePath = join(testRepo, 'objects', dirName, fileName);

      const stored = readFileSync(filePath);
      assert.deepStrictEqual(new Uint8Array(stored), data);
    });

    it('stores empty data', async () => {
      const data = new Uint8Array([]);
      const hash = await storeObject(testRepo, data, '.beast2');

      assert.strictEqual(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('stores large data', async () => {
      const data = new Uint8Array(1024 * 1024); // 1MB
      data.fill(42);

      const hash = await storeObject(testRepo, data, '.beast2');
      const loaded = await loadObject(testRepo, hash, '.beast2');

      assert.deepStrictEqual(new Uint8Array(loaded), data);
    });
  });

  describe('storeObjectFromStream', () => {
    it('stores stream and returns hash', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });

      const hash = await storeObjectFromStream(testRepo, stream, '.beast2');

      assert.strictEqual(hash, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    });

    it('stores chunked stream correctly', async () => {
      const chunk1 = new Uint8Array([1, 2]);
      const chunk2 = new Uint8Array([3]);

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk1);
          controller.enqueue(chunk2);
          controller.close();
        },
      });

      const hash = await storeObjectFromStream(testRepo, stream, '.beast2');
      const loaded = await loadObject(testRepo, hash, '.beast2');

      // Should reconstruct [1, 2, 3]
      assert.deepStrictEqual(new Uint8Array(loaded), new Uint8Array([1, 2, 3]));
    });

    it('deduplicates stream with existing object', async () => {
      const data = new Uint8Array([1, 2, 3]);

      // Store via regular storeObject first
      const hash1 = await storeObject(testRepo, data, '.beast2');

      // Store same data via stream
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });

      const hash2 = await storeObjectFromStream(testRepo, stream, '.beast2');

      assert.strictEqual(hash1, hash2);
    });
  });

  describe('loadObject', () => {
    it('loads stored object', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = await storeObject(testRepo, data, '.beast2');

      const loaded = await loadObject(testRepo, hash, '.beast2');

      assert.deepStrictEqual(new Uint8Array(loaded), data);
    });

    it('loads object with different extension', async () => {
      const data = new Uint8Array([4, 5, 6]);
      const hash = await storeObject(testRepo, data, '.east');

      const loaded = await loadObject(testRepo, hash, '.east');

      assert.deepStrictEqual(new Uint8Array(loaded), data);
    });

    it('throws on non-existent hash', async () => {
      const fakeHash = 'a'.repeat(64);

      await assert.rejects(
        async () => await loadObject(testRepo, fakeHash, '.beast2'),
        /Object not found/
      );
    });

    it('throws on wrong extension', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = await storeObject(testRepo, data, '.beast2');

      // Try to load with wrong extension
      await assert.rejects(
        async () => await loadObject(testRepo, hash, '.east'),
        /Object not found/
      );
    });

    it('round-trips correctly', async () => {
      const original = new Uint8Array([7, 8, 9, 10, 11]);
      const hash = await storeObject(testRepo, original, '.beast2');
      const loaded = await loadObject(testRepo, hash, '.beast2');

      assert.deepStrictEqual(new Uint8Array(loaded), original);
    });
  });

  describe('computeTaskId', () => {
    it('computes task ID from IR and args', () => {
      const irHash = 'a'.repeat(64);
      const argsHashes = ['b'.repeat(64), 'c'.repeat(64)];

      const taskId = computeTaskId(irHash, argsHashes);

      assert.strictEqual(typeof taskId, 'string');
      assert.strictEqual(taskId.length, 64);
    });

    it('produces same ID for same inputs', () => {
      const irHash = 'a'.repeat(64);
      const argsHashes = ['b'.repeat(64)];

      const taskId1 = computeTaskId(irHash, argsHashes);
      const taskId2 = computeTaskId(irHash, argsHashes);

      assert.strictEqual(taskId1, taskId2);
    });

    it('produces different ID for different IR', () => {
      const argsHashes = ['b'.repeat(64)];

      const taskId1 = computeTaskId('a'.repeat(64), argsHashes);
      const taskId2 = computeTaskId('c'.repeat(64), argsHashes);

      assert.notStrictEqual(taskId1, taskId2);
    });

    it('produces different ID for different args', () => {
      const irHash = 'a'.repeat(64);

      const taskId1 = computeTaskId(irHash, ['b'.repeat(64)]);
      const taskId2 = computeTaskId(irHash, ['c'.repeat(64)]);

      assert.notStrictEqual(taskId1, taskId2);
    });

    it('handles no arguments', () => {
      const irHash = 'a'.repeat(64);
      const taskId = computeTaskId(irHash, []);

      assert.strictEqual(typeof taskId, 'string');
      assert.strictEqual(taskId.length, 64);
    });

    it('handles multiple arguments', () => {
      const irHash = 'a'.repeat(64);
      const argsHashes = ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];

      const taskId = computeTaskId(irHash, argsHashes);

      assert.strictEqual(typeof taskId, 'string');
      assert.strictEqual(taskId.length, 64);
    });

    it('includes runtime when provided', () => {
      const irHash = 'a'.repeat(64);
      const argsHashes = ['b'.repeat(64)];

      const taskId1 = computeTaskId(irHash, argsHashes, 'node');
      const taskId2 = computeTaskId(irHash, argsHashes, 'python');
      const taskId3 = computeTaskId(irHash, argsHashes); // No runtime

      assert.notStrictEqual(taskId1, taskId2);
      assert.notStrictEqual(taskId1, taskId3);
      assert.notStrictEqual(taskId2, taskId3);
    });

    it('produces consistent ID with runtime', () => {
      const irHash = 'a'.repeat(64);
      const argsHashes = ['b'.repeat(64)];

      const taskId1 = computeTaskId(irHash, argsHashes, 'node');
      const taskId2 = computeTaskId(irHash, argsHashes, 'node');

      assert.strictEqual(taskId1, taskId2);
    });
  });
});
