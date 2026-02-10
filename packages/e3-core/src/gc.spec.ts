/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for gc.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { StringType, StructType, encodeBeast2For, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { WorkspaceStateType, PackageObjectType, TaskObjectType, DataRefType } from '@elaraai/e3-types';
import type { WorkspaceState, PackageObject, TaskObject } from '@elaraai/e3-types';
import { repoGc, collectAllRoots, markReachable, sweepBatch } from './storage/local/gc.js';
import { objectWrite, objectRead } from './storage/local/LocalObjectStore.js';
import { packageImport, packageRemove } from './packages.js';
import { ObjectNotFoundError } from './errors.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { GcObjectEntry } from './storage/interfaces.js';

describe('gc', () => {
  let testRepoPath: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepoPath = createTestRepo();
    tempDir = createTempDir();
    // Create LocalStorage with the parent of testRepo as reposDir.
    // This allows repoGc to use repoName for repos.* operations,
    // while objects/refs still use testRepoPath (full path).
    storage = new LocalStorage(dirname(testRepoPath));
  });

  afterEach(() => {
    removeTestRepo(testRepoPath);
    removeTempDir(tempDir);
  });

  describe('with no objects', () => {
    it('returns zero counts for empty repository', async () => {
      const result = await repoGc(storage, testRepoPath);

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.deletedPartials, 0);
      assert.strictEqual(result.retainedObjects, 0);
      assert.strictEqual(result.bytesFreed, 0);
    });
  });

  describe('with orphaned objects', () => {
    it('deletes orphaned objects', async () => {
      // Store an object directly without any ref
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await objectWrite(testRepoPath, data);

      // Verify object exists
      const loaded = await objectRead(testRepoPath, hash);
      assert.deepStrictEqual(new Uint8Array(loaded), data);

      // Run gc with minAge=0 to delete immediately
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 1);
      assert.strictEqual(result.retainedObjects, 0);
      assert.ok(result.bytesFreed > 0);

      // Verify object is gone
      await assert.rejects(
        async () => await objectRead(testRepoPath, hash),
        ObjectNotFoundError
      );
    });

    it('deletes multiple orphaned objects', async () => {
      // Store several objects
      await objectWrite(testRepoPath, new Uint8Array([1]));
      await objectWrite(testRepoPath, new Uint8Array([2]));
      await objectWrite(testRepoPath, new Uint8Array([3]));

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 3);
      assert.strictEqual(result.retainedObjects, 0);
    });
  });

  describe('with package refs', () => {
    it('retains objects referenced by packages', async () => {
      // Create and import a package
      const myInput = e3.input('greeting', StringType, 'hello');
      const pkg = e3.package('gc-test', '1.0.0', myInput);
      const zipPath = join(tempDir, 'gc-test.zip');
      await e3.export(pkg, zipPath);

      const importResult = await packageImport(storage, testRepoPath, zipPath);

      // Run gc - should not delete anything
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.ok(result.retainedObjects >= 3, `Expected at least 3 retained objects, got ${result.retainedObjects}`);

      // Verify package object still exists
      const packageData = await objectRead(testRepoPath, importResult.packageHash);
      assert.ok(packageData.length > 0);
    });

    it('deletes objects after package is removed', async () => {
      // Create and import a package
      const pkg = e3.package('remove-gc', '1.0.0') as any;
      const zipPath = join(tempDir, 'remove-gc.zip');
      await e3.export(pkg, zipPath);

      const importResult = await packageImport(storage, testRepoPath, zipPath);
      const objectCount = importResult.objectCount;

      // Remove the package
      await packageRemove(storage, testRepoPath, 'remove-gc', '1.0.0');

      // Run gc - should delete all package objects
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, objectCount);
      assert.strictEqual(result.retainedObjects, 0);
    });

    it('retains shared objects between packages', async () => {
      // Create and import two packages
      const pkg1 = e3.package('shared-a', '1.0.0') as any;
      const pkg2 = e3.package('shared-b', '1.0.0') as any;

      const zip1 = join(tempDir, 'shared-a.zip');
      const zip2 = join(tempDir, 'shared-b.zip');

      await e3.export(pkg1, zip1);
      await e3.export(pkg2, zip2);

      await packageImport(storage, testRepoPath, zip1);
      await packageImport(storage, testRepoPath, zip2);

      // Remove one package
      await packageRemove(storage, testRepoPath, 'shared-a', '1.0.0');

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      // Some objects may be deleted, but shared-b's objects are retained
      assert.ok(result.retainedObjects >= 2);
    });
  });

  describe('with staging files', () => {
    it('deletes orphaned .partial files', async () => {
      // Create a fake .partial staging file
      const partialDir = join(testRepoPath, 'objects', 'ab');
      mkdirSync(partialDir, { recursive: true });
      const partialPath = join(partialDir, 'cdef.beast2.123456.abc123.partial');
      writeFileSync(partialPath, 'orphaned staging data');

      assert.ok(existsSync(partialPath));

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedPartials, 1);
      assert.ok(!existsSync(partialPath));
    });

    it('skips young .partial files', async () => {
      // Create a .partial file
      const partialDir = join(testRepoPath, 'objects', 'cd');
      mkdirSync(partialDir, { recursive: true });
      const partialPath = join(partialDir, 'efgh.beast2.123456.xyz789.partial');
      writeFileSync(partialPath, 'in-progress data');

      // Run gc with default minAge (60s) - file is brand new
      const result = await repoGc(storage, testRepoPath, { minAge: 60000 });

      assert.strictEqual(result.deletedPartials, 0);
      assert.strictEqual(result.skippedYoung, 1);
      assert.ok(existsSync(partialPath));
    });
  });

  describe('minAge option', () => {
    it('skips young objects', async () => {
      // Store an object
      const hash = await objectWrite(testRepoPath, new Uint8Array([42]));

      // Run gc with high minAge - object is too young
      const result = await repoGc(storage, testRepoPath, { minAge: 60000 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.skippedYoung, 1);

      // Object should still exist
      const data = await objectRead(testRepoPath, hash);
      assert.deepStrictEqual(new Uint8Array(data), new Uint8Array([42]));
    });

    it('deletes old objects with minAge=0', async () => {
      const hash = await objectWrite(testRepoPath, new Uint8Array([99]));

      // Run gc with minAge=0
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 1);

      await assert.rejects(
        async () => await objectRead(testRepoPath, hash),
        ObjectNotFoundError
      );
    });
  });

  describe('dryRun option', () => {
    it('reports but does not delete in dry run mode', async () => {
      // Store an orphaned object
      const data = new Uint8Array([10, 20, 30]);
      const hash = await objectWrite(testRepoPath, data);

      // Run gc in dry run mode
      const result = await repoGc(storage, testRepoPath, { minAge: 0, dryRun: true });

      assert.strictEqual(result.deletedObjects, 1);
      assert.ok(result.bytesFreed > 0);

      // Object should still exist
      const loaded = await objectRead(testRepoPath, hash);
      assert.deepStrictEqual(new Uint8Array(loaded), data);
    });

    it('reports partials but does not delete in dry run mode', async () => {
      const partialDir = join(testRepoPath, 'objects', 'ef');
      mkdirSync(partialDir, { recursive: true });
      const partialPath = join(partialDir, 'ghij.beast2.999999.dry123.partial');
      writeFileSync(partialPath, 'dry run test');

      const result = await repoGc(storage, testRepoPath, { minAge: 0, dryRun: true });

      assert.strictEqual(result.deletedPartials, 1);
      assert.ok(existsSync(partialPath)); // Still exists
    });
  });

  describe('object graph traversal', () => {
    // Helper: create a tree type with DataRef fields
    const makeTreeType = (fieldNames: string[]) => {
      const fields: Record<string, typeof DataRefType> = {};
      for (const name of fieldNames) {
        fields[name] = DataRefType;
      }
      return StructType(fields);
    };

    it('retains transitively referenced objects via tree → value chain', async () => {
      // Create a chain: Package → Tree → Value (leaf)
      // Tree has a 'data' field pointing to a value object

      // Create value leaf object (some arbitrary beast2 data)
      const valueEncoder = encodeBeast2For(StringType);
      const hashValue = await objectWrite(testRepoPath, valueEncoder('hello world'));

      // Create a tree object with one field pointing to the value
      const treeType = makeTreeType(['data']);
      const treeEncoder = encodeBeast2For(treeType);
      const hashTree = await objectWrite(testRepoPath, treeEncoder({
        data: variant('value', hashValue),
      }));

      // Create a package object referencing the tree as its root
      const pkgEncoder = encodeBeast2For(PackageObjectType);
      const hashPkg = await objectWrite(testRepoPath, pkgEncoder({
        tasks: new Map(),
        data: {
          structure: variant('struct', new Map()),
          value: hashTree,
        },
      } as PackageObject));

      // Create a package ref pointing to the package
      const refDir = join(testRepoPath, 'packages', 'transitive');
      mkdirSync(refDir, { recursive: true });
      writeFileSync(join(refDir, '1.0.0'), hashPkg + '\n');

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.retainedObjects, 3); // pkg, tree, value all retained

      // All objects should still exist
      await objectRead(testRepoPath, hashPkg);
      await objectRead(testRepoPath, hashTree);
      await objectRead(testRepoPath, hashValue);
    });

    it('deletes unreachable objects in graph', async () => {
      // Create a reachable package → tree chain, plus an unreachable orphan

      // Reachable tree (leaf - no children)
      const treeType = makeTreeType(['x']);
      const treeEncoder = encodeBeast2For(treeType);
      const hashTree = await objectWrite(testRepoPath, treeEncoder({
        x: variant('unassigned', null),
      }));

      // Reachable package referencing the tree
      const pkgEncoder = encodeBeast2For(PackageObjectType);
      const hashPkg = await objectWrite(testRepoPath, pkgEncoder({
        tasks: new Map(),
        data: {
          structure: variant('struct', new Map()),
          value: hashTree,
        },
      } as PackageObject));

      // Unreachable orphan object
      const orphanData = new Uint8Array([77, 88, 99]);
      const hashOrphan = await objectWrite(testRepoPath, orphanData);

      // Only package is a root
      const refDir = join(testRepoPath, 'packages', 'graph-test');
      mkdirSync(refDir, { recursive: true });
      writeFileSync(join(refDir, '1.0.0'), hashPkg + '\n');

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 1); // orphan deleted
      assert.strictEqual(result.retainedObjects, 2); // pkg, tree retained

      // Package and tree exist, orphan is gone
      await objectRead(testRepoPath, hashPkg);
      await objectRead(testRepoPath, hashTree);
      await assert.rejects(
        async () => await objectRead(testRepoPath, hashOrphan),
        ObjectNotFoundError
      );
    });
  });

  describe('execution refs', () => {
    it('retains objects referenced by execution refs', async () => {
      // Store an object
      const data = new Uint8Array([11, 22, 33]);
      const hash = await objectWrite(testRepoPath, data);

      // Create an execution ref using the new schema:
      // executions/<taskHash>/<inputsHash>/<executionId>/status.beast2
      const taskHash = 'a'.repeat(64);
      const inputsHash = 'b'.repeat(64);
      const executionId = '01900000-0000-7000-8000-000000000001';
      const execDir = join(testRepoPath, 'executions', taskHash, inputsHash, executionId);
      mkdirSync(execDir, { recursive: true });

      // Write a success execution status with outputHash
      const { encodeBeast2For: encodeFor } = await import('@elaraai/east');
      const { ExecutionStatusType } = await import('@elaraai/e3-types');
      const encoder = encodeFor(ExecutionStatusType);
      const status = variant('success', {
        executionId,
        inputHashes: [inputsHash],
        outputHash: hash,
        startedAt: new Date(),
        completedAt: new Date(),
      });
      writeFileSync(join(execDir, 'status.beast2'), encoder(status));

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.retainedObjects, 1);

      // Object still exists
      const loaded = await objectRead(testRepoPath, hash);
      assert.deepStrictEqual(new Uint8Array(loaded), data);
    });
  });

  describe('workspace refs', () => {
    it('retains objects referenced by workspace state', async () => {
      // Store objects for root and package
      const rootData = new Uint8Array([44, 55, 66]);
      const rootHash = await objectWrite(testRepoPath, rootData);
      const pkgData = new Uint8Array([77, 88, 99]);
      const pkgHash = await objectWrite(testRepoPath, pkgData);

      // Create workspace state file at workspaces/<name>.beast2
      const wsDir = join(testRepoPath, 'workspaces');
      mkdirSync(wsDir, { recursive: true });

      const state: WorkspaceState = {
        packageName: 'test-pkg',
        packageVersion: '1.0.0',
        packageHash: pkgHash,
        deployedAt: new Date(),
        rootHash: rootHash,
        rootUpdatedAt: new Date(),
        currentRunId: variant('none', null),
      };
      const encoder = encodeBeast2For(WorkspaceStateType);
      writeFileSync(join(wsDir, 'myworkspace.beast2'), encoder(state));

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.retainedObjects, 2); // both rootHash and pkgHash

      // Objects still exist
      await objectRead(testRepoPath, rootHash);
      await objectRead(testRepoPath, pkgHash);
    });

    it('ignores undeployed workspaces', async () => {
      // Store an orphaned object
      const data = new Uint8Array([11, 22, 33]);
      await objectWrite(testRepoPath, data);

      // Create empty workspace file (undeployed)
      const wsDir = join(testRepoPath, 'workspaces');
      mkdirSync(wsDir, { recursive: true });
      writeFileSync(join(wsDir, 'undeployed.beast2'), '');

      // Run gc - orphaned object should be deleted
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 1);
      assert.strictEqual(result.retainedObjects, 0);
    });
  });

  // ==========================================================================
  // Unit tests for shared algorithm functions
  // ==========================================================================

  describe('collectAllRoots', () => {
    it('collects roots from all root types', async () => {
      const roots = await collectAllRoots(storage.repos, testRepoPath);
      // Empty repo has no roots
      assert.strictEqual(roots.size, 0);
    });

    it('collects package roots', async () => {
      // Create a package ref
      const hash = 'a'.repeat(64);
      const refDir = join(testRepoPath, 'packages', 'test-pkg');
      mkdirSync(refDir, { recursive: true });
      writeFileSync(join(refDir, '1.0.0'), hash + '\n');

      const roots = await collectAllRoots(storage.repos, testRepoPath);
      assert.ok(roots.has(hash));
    });
  });

  describe('markReachable', () => {
    // Helper: create a tree type with DataRef fields
    const makeTreeType = (fieldNames: string[]) => {
      const fields: Record<string, typeof DataRefType> = {};
      for (const name of fieldNames) {
        fields[name] = DataRefType;
      }
      return StructType(fields);
    };

    it('follows PackageObject → TaskObject → IR chain', async () => {
      const irHash = 'c'.repeat(64);
      const treeHash = 'd'.repeat(64);

      // Encode a TaskObject referencing the IR hash
      const taskEncoder = encodeBeast2For(TaskObjectType);
      const taskData = taskEncoder({
        commandIr: irHash,
        inputs: [[variant('field', 'x')]],
        output: [variant('field', 'y')],
      } as TaskObject);
      const taskHash = 'b'.repeat(64);

      // Encode a PackageObject referencing the task and a root tree
      const pkgEncoder = encodeBeast2For(PackageObjectType);
      const pkgData = pkgEncoder({
        tasks: new Map([['myTask', taskHash]]),
        data: {
          structure: variant('struct', new Map()),
          value: treeHash,
        },
      } as PackageObject);
      const pkgHash = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(pkgHash, pkgData);
      objects.set(taskHash, taskData);
      // treeHash and irHash are NOT in the object store — they are leaves

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([pkgHash]));

      // Package (read) + task (read) + IR leaf (not read) + tree (not in store, pushed to stack but not found)
      assert.ok(reachable.has(pkgHash), 'package should be reachable');
      assert.ok(reachable.has(taskHash), 'task should be reachable');
      assert.ok(reachable.has(irHash), 'IR leaf should be reachable (marked without reading)');
      // treeHash was pushed to stack but readObject returns null — not added to reachable
      assert.ok(!reachable.has(treeHash), 'tree hash should not be reachable when object is missing');
      assert.strictEqual(reachable.size, 3);
    });

    it('follows TreeObject DataRef children', async () => {
      const subtreeHash = 'b'.repeat(64);
      const valueHash = 'c'.repeat(64);

      // Encode a tree with both a tree ref and a value ref
      const treeType = makeTreeType(['subtree', 'leaf']);
      const treeEncoder = encodeBeast2For(treeType);
      const treeData = treeEncoder({
        subtree: variant('tree', subtreeHash),
        leaf: variant('value', valueHash),
      });
      const treeHash = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(treeHash, treeData);
      // subtreeHash and valueHash not in store

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([treeHash]));

      assert.ok(reachable.has(treeHash), 'tree should be reachable');
      assert.ok(reachable.has(valueHash), 'value leaf should be reachable (marked without reading)');
      // subtreeHash pushed to stack, readObject returns null
      assert.ok(!reachable.has(subtreeHash), 'subtree should not be reachable when object is missing');
      assert.strictEqual(reachable.size, 2);
    });

    it('skips unassigned and null DataRefs', async () => {
      // Tree with only unassigned/null refs — no children to follow
      const treeType = makeTreeType(['pending', 'empty']);
      const treeEncoder = encodeBeast2For(treeType);
      const treeData = treeEncoder({
        pending: variant('unassigned', null),
        empty: variant('null', null),
      });
      const treeHash = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(treeHash, treeData);

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([treeHash]));

      assert.strictEqual(reachable.size, 1); // Only the tree itself
      assert.ok(reachable.has(treeHash));
    });

    it('handles non-BEAST2 data gracefully', async () => {
      const hashA = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(hashA, new Uint8Array([1, 2, 3, 4, 5])); // Not BEAST2

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([hashA]));

      // Object is reachable but treated as leaf (no children)
      assert.strictEqual(reachable.size, 1);
      assert.ok(reachable.has(hashA));
    });

    it('handles missing objects gracefully', async () => {
      const hashA = 'a'.repeat(64);
      const readObject = async (_hash: string) => null;
      const reachable = await markReachable(readObject, new Set([hashA]));

      // Root was not reachable because the object doesn't exist
      assert.strictEqual(reachable.size, 0);
    });

    it('handles DAG deduplication (shared objects)', async () => {
      // Two trees both reference the same value
      const sharedValueHash = 'c'.repeat(64);

      const treeType = makeTreeType(['data']);
      const treeEncoder = encodeBeast2For(treeType);

      const tree1Data = treeEncoder({ data: variant('value', sharedValueHash) });
      const tree1Hash = 'a'.repeat(64);

      const tree2Data = treeEncoder({ data: variant('value', sharedValueHash) });
      const tree2Hash = 'b'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(tree1Hash, tree1Data);
      objects.set(tree2Hash, tree2Data);

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([tree1Hash, tree2Hash]));

      assert.strictEqual(reachable.size, 3); // tree1, tree2, shared value
      assert.ok(reachable.has(sharedValueHash));
    });

    it('marks value leaves without reading them', async () => {
      const valueHash = 'b'.repeat(64);

      const treeType = makeTreeType(['data']);
      const treeEncoder = encodeBeast2For(treeType);
      const treeData = treeEncoder({ data: variant('value', valueHash) });
      const treeHash = 'a'.repeat(64);

      const readCalls: string[] = [];
      const objects = new Map<string, Uint8Array>();
      objects.set(treeHash, treeData);
      objects.set(valueHash, new Uint8Array([99])); // exists but should not be read

      const readObject = async (hash: string) => {
        readCalls.push(hash);
        return objects.get(hash) ?? null;
      };
      const reachable = await markReachable(readObject, new Set([treeHash]));

      assert.ok(reachable.has(valueHash), 'value should be reachable');
      assert.ok(!readCalls.includes(valueHash), 'value hash should NOT have been read');
      assert.ok(readCalls.includes(treeHash), 'tree hash should have been read');
    });
  });

  describe('sweepBatch', () => {
    it('marks unreachable old objects for deletion', () => {
      const objects: GcObjectEntry[] = [
        { hash: 'a'.repeat(64), lastModified: 0, size: 100 },
        { hash: 'b'.repeat(64), lastModified: 0, size: 200 },
      ];
      const reachable = new Set<string>();

      const result = sweepBatch(objects, reachable, 0);

      assert.strictEqual(result.toDelete.length, 2);
      assert.strictEqual(result.retained, 0);
      assert.strictEqual(result.bytesFreed, 300);
    });

    it('retains reachable objects', () => {
      const hashA = 'a'.repeat(64);
      const objects: GcObjectEntry[] = [
        { hash: hashA, lastModified: 0, size: 100 },
      ];
      const reachable = new Set([hashA]);

      const result = sweepBatch(objects, reachable, 0);

      assert.strictEqual(result.toDelete.length, 0);
      assert.strictEqual(result.retained, 1);
    });

    it('skips young objects', () => {
      const objects: GcObjectEntry[] = [
        { hash: 'a'.repeat(64), lastModified: Date.now(), size: 100 },
      ];
      const reachable = new Set<string>();

      const result = sweepBatch(objects, reachable, 60000);

      assert.strictEqual(result.toDelete.length, 0);
      assert.strictEqual(result.skippedYoung, 1);
    });
  });
});
