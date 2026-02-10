/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Shared garbage collection algorithm for e3 repositories.
 *
 * Uses mark-and-sweep:
 * 1. collectAllRoots: Collect root hashes from all root scan methods
 * 2. markReachable: DFS through object graph via BEAST2 schema-aware traversal
 * 3. sweepBatch: Pure decision function — identify unreachable objects to delete
 * 4. repoGc: Driver that calls all phases in sequence
 *
 * These functions work with any StorageBackend — no instanceof checks.
 * Cloud-specific concerns (S3 reachable set persistence, orphaned version cleanup)
 * are handled in the cloud Lambda handlers.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { decodeBeast2 } from '@elaraai/east';
import type { RepoStore, GcObjectEntry, GcRootScanResult, StorageBackend } from '../interfaces.js';

/**
 * Options for garbage collection
 */
export interface GcOptions {
  /**
   * Minimum age in milliseconds for files to be considered for deletion.
   * Files younger than this are skipped to avoid race conditions with concurrent writes.
   * Default: 60000 (1 minute)
   */
  minAge?: number;

  /**
   * If true, only report what would be deleted without actually deleting.
   * Default: false
   */
  dryRun?: boolean;
}

/**
 * Result of garbage collection
 */
export interface GcResult {
  /** Number of objects deleted */
  deletedObjects: number;
  /** Number of orphaned staging files deleted */
  deletedPartials: number;
  /** Number of objects retained */
  retainedObjects: number;
  /** Number of files skipped due to being too young */
  skippedYoung: number;
  /** Total bytes freed */
  bytesFreed: number;
}

/**
 * Result from sweepBatch — pure decision, no side effects.
 */
export interface SweepBatchResult {
  /** Hashes of objects to delete */
  toDelete: string[];
  /** Number of objects retained (reachable) */
  retained: number;
  /** Number of objects skipped due to being too young */
  skippedYoung: number;
  /** Total bytes that would be freed */
  bytesFreed: number;
}

// =============================================================================
// Shared Algorithm Functions
// =============================================================================

/**
 * Collect all root hashes from packages, workspaces, and executions.
 *
 * Calls each gcScan*Roots method with pagination support.
 * Adding a new root scan method to RepoStore requires updating this function.
 */
export async function collectAllRoots(store: RepoStore, repo: string): Promise<Set<string>> {
  const roots = new Set<string>();

  const scanAll = async (scan: (repo: string, cursor?: unknown) => Promise<GcRootScanResult>) => {
    let cursor: unknown;
    do {
      const result = await scan(repo, cursor);
      for (const hash of result.roots) {
        roots.add(hash);
      }
      cursor = result.cursor;
    } while (cursor !== undefined);
  };

  await scanAll(store.gcScanPackageRoots.bind(store));
  await scanAll(store.gcScanWorkspaceRoots.bind(store));
  await scanAll(store.gcScanExecutionRoots.bind(store));

  return roots;
}

/**
 * Trace the object graph from roots using iterative DFS with schema-aware traversal.
 *
 * Decodes each object using BEAST2 self-describing format and extracts child
 * hashes based on the detected object type (Package, Task, or Tree). Objects
 * known to be leaves (values, IR blobs) are marked reachable without reading.
 *
 * @param readObject - Function to read an object by hash (returns null if missing)
 * @param roots - Set of root hashes to start from
 * @returns Set of all reachable hashes
 */
export async function markReachable(
  readObject: (hash: string) => Promise<Uint8Array | null>,
  roots: Set<string>
): Promise<Set<string>> {
  const reachable = new Set<string>();
  const stack = [...roots];

  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (reachable.has(hash)) continue;

    const data = await readObject(hash);
    if (!data) continue;
    reachable.add(hash);

    // Schema-aware child extraction
    let children: { hash: string; isLeaf: boolean }[];
    try {
      const decoded = decodeBeast2(Buffer.from(data));
      children = extractChildren(decoded.type, decoded.value);
    } catch {
      continue; // Not valid BEAST2 or unknown format — treat as leaf
    }

    for (const child of children) {
      if (reachable.has(child.hash)) continue;
      if (child.isLeaf) {
        reachable.add(child.hash); // Mark without reading
      } else {
        stack.push(child.hash);
      }
    }
  }

  return reachable;
}

// =============================================================================
// Type Detection Helpers
// =============================================================================

// EastTypeValue is a variant object: { type: string, value: any }
// For Struct: type.type === "Struct", type.value is Array<{ name: string, type: EastTypeValue }>
// For Variant: type.type === "Variant", type.value is Array<{ name: string, type: EastTypeValue }>

/**
 * Check if a decoded EastTypeValue represents a PackageObject.
 * PackageObject is a Struct with fields: tasks (Dict<String,String>), data (Struct)
 */
function isPackageObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const fields = type.value as { name: string; type: any }[];
  const names = new Set(fields.map(f => f.name));
  return names.has('tasks') && names.has('data');
}

/**
 * Check if a decoded EastTypeValue represents a TaskObject.
 * TaskObject is a Struct with fields: commandIr, inputs, output
 */
function isTaskObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const fields = type.value as { name: string; type: any }[];
  const names = new Set(fields.map(f => f.name));
  return names.has('commandIr') && names.has('inputs') && names.has('output');
}

/**
 * Check if a field type is a DataRef (Variant with cases: unassigned, null, value, tree).
 */
function isDataRefFieldType(fieldType: any): boolean {
  if (fieldType.type !== 'Variant') return false;
  const cases = fieldType.value as { name: string; type: any }[];
  const names = new Set(cases.map(c => c.name));
  return names.has('tree') && names.has('value') && names.has('unassigned') && names.has('null');
}

/**
 * Check if a decoded EastTypeValue represents a TreeObject.
 * A tree is a Struct where every field is a DataRef variant.
 */
function isTreeObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const fields = type.value as { name: string; type: any }[];
  return fields.length > 0 && fields.every(f => isDataRefFieldType(f.type));
}

/**
 * Extract child hashes from a decoded BEAST2 object based on its type.
 * Returns children with isLeaf flag to avoid reading leaf objects.
 */
function extractChildren(
  type: unknown,
  value: unknown
): { hash: string; isLeaf: boolean }[] {
  const t = type as any;
  const children: { hash: string; isLeaf: boolean }[] = [];

  if (isPackageObjectShape(t)) {
    const pkg = value as { tasks: Map<string, string>; data: { value: string } };
    for (const taskHash of pkg.tasks.values()) {
      children.push({ hash: taskHash, isLeaf: false });
    }
    children.push({ hash: pkg.data.value, isLeaf: false }); // root tree
    return children;
  }

  if (isTaskObjectShape(t)) {
    const task = value as { commandIr: string };
    children.push({ hash: task.commandIr, isLeaf: true }); // IR is a leaf
    return children;
  }

  if (isTreeObjectShape(t)) {
    const tree = value as Record<string, { type: string; value: any }>;
    for (const ref of Object.values(tree)) {
      if (ref.type === 'tree') {
        children.push({ hash: ref.value as string, isLeaf: false }); // subtree needs traversal
      } else if (ref.type === 'value') {
        children.push({ hash: ref.value as string, isLeaf: true }); // value is a leaf
      }
      // 'unassigned' and 'null': no hash to follow
    }
    return children;
  }

  return []; // Unknown type: leaf, no children
}

/**
 * Pure decision function: determine which objects to delete.
 *
 * No side effects — trivially testable. Caller decides whether to
 * actually delete (supports dry-run by skipping gcDeleteObjects).
 *
 * @param objects - Object entries from gcScanObjects
 * @param reachable - Set of reachable hashes from markReachable
 * @param minAge - Minimum age in ms; objects younger than this are skipped
 * @returns Decision result with toDelete list and stats
 */
export function sweepBatch(
  objects: GcObjectEntry[],
  reachable: Set<string>,
  minAge: number
): SweepBatchResult {
  const now = Date.now();
  const toDelete: string[] = [];
  let retained = 0;
  let skippedYoung = 0;
  let bytesFreed = 0;

  for (const obj of objects) {
    if (reachable.has(obj.hash)) {
      retained++;
      continue;
    }
    const age = now - obj.lastModified;
    if (minAge > 0 && age < minAge) {
      skippedYoung++;
      continue;
    }
    toDelete.push(obj.hash);
    bytesFreed += obj.size;
  }

  return { toDelete, retained, skippedYoung, bytesFreed };
}

// =============================================================================
// Local Driver
// =============================================================================

/**
 * Run garbage collection on an e3 repository.
 *
 * Works with any StorageBackend — no instanceof checks.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - GC options
 * @returns GC result with statistics
 */
export async function repoGc(
  storage: StorageBackend,
  repo: string,
  options: GcOptions = {}
): Promise<GcResult> {
  const minAge = options.minAge ?? 60000;
  const dryRun = options.dryRun ?? false;

  // Step 1: Collect all root hashes
  const roots = await collectAllRoots(storage.repos, repo);

  // Step 2: Mark all reachable objects
  const readObject = async (hash: string): Promise<Uint8Array | null> => {
    try {
      return await storage.objects.read(repo, hash);
    } catch {
      return null;
    }
  };
  const reachable = await markReachable(readObject, roots);

  // Step 3: Scan and sweep objects
  let totalDeleted = 0;
  let totalRetained = 0;
  let totalSkippedYoung = 0;
  let totalBytesFreed = 0;
  let cursor: unknown;

  do {
    const scan = await storage.repos.gcScanObjects(repo, cursor);
    const result = sweepBatch(scan.objects, reachable, minAge);

    totalRetained += result.retained;
    totalSkippedYoung += result.skippedYoung;
    totalBytesFreed += result.bytesFreed;

    if (!dryRun && result.toDelete.length > 0) {
      await storage.repos.gcDeleteObjects(repo, result.toDelete);
    }
    totalDeleted += result.toDelete.length;

    cursor = scan.cursor;
  } while (cursor !== undefined);

  // Step 4: Clean up orphaned .partial files (local-only concern)
  let deletedPartials = 0;
  let partialSkippedYoung = 0;
  try {
    const partialResult = await cleanupPartials(repo, minAge, dryRun);
    deletedPartials = partialResult.deleted;
    partialSkippedYoung = partialResult.skippedYoung;
  } catch {
    // Not a fatal error
  }

  return {
    deletedObjects: totalDeleted,
    deletedPartials,
    retainedObjects: totalRetained,
    skippedYoung: totalSkippedYoung + partialSkippedYoung,
    bytesFreed: totalBytesFreed,
  };
}

/**
 * Clean up orphaned .partial staging files in the objects directory.
 * This is a local-only concern — cloud storage doesn't use .partial files.
 */
async function cleanupPartials(
  repoPath: string,
  minAge: number,
  dryRun: boolean
): Promise<{ deleted: number; skippedYoung: number }> {
  const objectsDir = path.join(repoPath, 'objects');
  const now = Date.now();
  let deleted = 0;
  let skippedYoung = 0;

  try {
    const subdirs = await fs.readdir(objectsDir);
    for (const subdir of subdirs) {
      if (!/^[a-f0-9]{2}$/.test(subdir)) continue;
      const subdirPath = path.join(objectsDir, subdir);
      try {
        const stat = await fs.stat(subdirPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const files = await fs.readdir(subdirPath);
      for (const file of files) {
        if (!file.endsWith('.partial')) continue;
        const filePath = path.join(subdirPath, file);
        try {
          const fileStat = await fs.stat(filePath);
          const age = now - fileStat.mtimeMs;
          if (minAge > 0 && age < minAge) {
            skippedYoung++;
            continue;
          }
          if (!dryRun) {
            await fs.unlink(filePath);
          }
          deleted++;
        } catch {
          // Skip files we can't stat or delete
        }
      }
    }
  } catch {
    // Objects directory doesn't exist
  }

  return { deleted, skippedYoung };
}
