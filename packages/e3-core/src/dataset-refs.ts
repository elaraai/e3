/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataset ref utilities for reactive dataflow.
 *
 * Provides version vector operations, root hash computation from refs,
 * and input change detection for the reactive execution loop.
 */

import { variant, printIdentifier } from '@elaraai/east';
import { type DataRef, type Structure, type VersionVector, type DatasetRef } from '@elaraai/e3-types';
import { treeWrite } from './trees.js';
import type { StorageBackend } from './storage/interfaces.js';

// =============================================================================
// Version Vector Operations
// =============================================================================

/**
 * Check version vector consistency across a set of input vectors.
 *
 * All vectors must agree on shared keys (same root input path must have
 * the same hash in every vector that contains it). This ensures that
 * a task's inputs are all derived from the same snapshot of each root input.
 *
 * @param inputVectors - Version vectors from each task input
 * @returns Consistency result: either consistent (with merged vector) or inconsistent (with conflict path)
 */
export function checkVersionConsistency(
  inputVectors: VersionVector[]
): { consistent: true; merged: VersionVector } | { consistent: false; conflictPath: string } {
  const merged = new Map<string, string>();

  for (const vv of inputVectors) {
    for (const [path, hash] of vv) {
      const existing = merged.get(path);
      if (existing !== undefined && existing !== hash) {
        return { consistent: false, conflictPath: path };
      }
      merged.set(path, hash);
    }
  }

  return { consistent: true, merged };
}

/**
 * Merge consistent version vectors (union of all keys).
 *
 * Assumes all vectors are consistent (no conflicting hashes for shared keys).
 * Use checkVersionConsistency first if consistency is not guaranteed.
 *
 * @param vectors - Version vectors to merge
 * @returns Merged version vector
 */
export function mergeVersionVectors(vectors: VersionVector[]): VersionVector {
  const merged = new Map<string, string>();
  for (const vv of vectors) {
    for (const [path, hash] of vv) {
      merged.set(path, hash);
    }
  }
  return merged;
}

/**
 * Build a version vector for a root input dataset.
 *
 * Root inputs reference only themselves in their version vector.
 *
 * @param path - The keypath string of the input dataset (e.g., ".inputs.sales")
 * @param hash - The content hash of the input value
 * @returns A version vector with a single entry
 */
export function inputVersionVector(path: string, hash: string): VersionVector {
  return new Map([[path, hash]]);
}

/**
 * Convert a TreePath-style keypath (e.g., ".inputs.sales") to a filesystem-style
 * dataset ref path (e.g., "inputs/sales") for use with DatasetRefStore.
 */
export function keypathToRefPath(keypath: string): string {
  // Remove leading dot and convert dots to slashes
  // Handle backtick-quoted identifiers
  if (!keypath.startsWith('.')) {
    throw new Error(`Invalid keypath: expected leading '.', got '${keypath}'`);
  }

  const segments: string[] = [];
  let i = 1; // Skip leading dot
  while (i < keypath.length) {
    let fieldName: string;
    if (keypath[i] === '`') {
      const end = keypath.indexOf('`', i + 1);
      if (end === -1) throw new Error(`Unclosed backtick in keypath at ${i}`);
      fieldName = keypath.slice(i + 1, end);
      i = end + 1;
    } else {
      let end = keypath.indexOf('.', i);
      if (end === -1) end = keypath.length;
      fieldName = keypath.slice(i, end);
      i = end;
    }
    if (fieldName) segments.push(fieldName);
    if (i < keypath.length && keypath[i] === '.') i++;
  }

  return segments.join('/');
}

/**
 * Convert a filesystem-style dataset ref path (e.g., "inputs/sales") to a
 * TreePath-style keypath (e.g., ".inputs.sales").
 */
export function refPathToKeypath(refPath: string): string {
  const segments = refPath.split('/').filter(s => s);
  return segments.map(s => '.' + printIdentifier(s)).join('');
}

/**
 * Snapshot all root input version vectors from refs.
 *
 * Root inputs are datasets not produced by any task (i.e., their path
 * is NOT in the taskOutputPaths set).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param structure - The workspace's data structure
 * @param taskOutputPaths - Set of keypath strings that are task outputs
 * @returns Map of keypath -> content hash for all assigned root input datasets
 */
export async function snapshotInputVersions(
  storage: StorageBackend,
  repo: string,
  ws: string,
  structure: Structure,
  taskOutputPaths: Set<string>
): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  // Walk the structure to find all value leaves
  const leafPaths = collectLeafPaths(structure);

  for (const keypath of leafPaths) {
    // Skip task outputs
    if (taskOutputPaths.has(keypath)) continue;

    const refPath = keypathToRefPath(keypath);
    const ref = await storage.datasets.read(repo, ws, refPath);
    if (ref && ref.type === 'value') {
      snapshot.set(keypath, ref.value.hash);
    }
  }

  return snapshot;
}

/**
 * Detect which inputs changed since a previous snapshot.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param previousSnapshot - Previous snapshot from snapshotInputVersions
 * @param structure - The workspace's data structure
 * @param taskOutputPaths - Set of keypath strings that are task outputs
 * @returns Array of changed inputs with previous and new hashes
 */
export async function detectInputChanges(
  storage: StorageBackend,
  repo: string,
  ws: string,
  previousSnapshot: Map<string, string>,
  structure: Structure,
  taskOutputPaths: Set<string>
): Promise<Array<{ path: string; previousHash: string | null; newHash: string }>> {
  const changes: Array<{ path: string; previousHash: string | null; newHash: string }> = [];
  const currentSnapshot = await snapshotInputVersions(storage, repo, ws, structure, taskOutputPaths);

  // Check for changes in current snapshot vs previous
  for (const [path, newHash] of currentSnapshot) {
    const prevHash = previousSnapshot.get(path) ?? null;
    if (prevHash !== newHash) {
      changes.push({ path, previousHash: prevHash, newHash });
    }
  }

  // Check for inputs that were removed (in previous but not in current)
  // This shouldn't normally happen (structure doesn't change during execution)
  // but handle it for completeness

  return changes;
}

/**
 * Build tree objects from per-dataset refs on demand, returning the root hash.
 *
 * This reconstructs the traditional tree object hierarchy from the flat
 * per-dataset ref files. Used for compatibility with existing code that
 * expects a root hash (e.g., DataflowRun snapshots, workspace export).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param structure - The workspace's data structure
 * @returns The root tree hash
 */
export async function computeRootHash(
  storage: StorageBackend,
  repo: string,
  ws: string,
  structure: Structure
): Promise<string> {
  return buildTreeFromRefs(storage, repo, ws, structure, '');
}

/**
 * Recursively build tree objects from refs.
 */
async function buildTreeFromRefs(
  storage: StorageBackend,
  repo: string,
  ws: string,
  structure: Structure,
  pathPrefix: string
): Promise<string> {
  if (structure.type !== 'struct') {
    throw new Error(`Expected struct structure at '${pathPrefix}', got '${structure.type}'`);
  }

  const fields: Record<string, DataRef> = {};

  for (const [fieldName, childStructure] of structure.value) {
    const childPrefix = pathPrefix
      ? `${pathPrefix}/${fieldName}`
      : fieldName;

    if (childStructure.type === 'value') {
      // Leaf dataset: read the ref file
      const ref = await storage.datasets.read(repo, ws, childPrefix);
      if (!ref) {
        fields[fieldName] = variant('unassigned', null);
      } else if (ref.type === 'unassigned') {
        fields[fieldName] = variant('unassigned', null);
      } else if (ref.type === 'null') {
        fields[fieldName] = variant('null', null);
      } else {
        // ref.type === 'value'
        fields[fieldName] = variant('value', ref.value.hash);
      }
    } else {
      // Nested tree: recurse
      const childHash = await buildTreeFromRefs(
        storage, repo, ws, childStructure, childPrefix
      );
      fields[fieldName] = variant('tree', childHash);
    }
  }

  // Write the tree object and return its hash
  return treeWrite(storage, repo, fields, structure);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Collect all leaf (value) keypaths from a structure.
 */
function collectLeafPaths(structure: Structure, prefix: string = ''): string[] {
  const paths: string[] = [];

  if (structure.type === 'value') {
    paths.push(prefix);
  } else if (structure.type === 'struct') {
    for (const [fieldName, childStructure] of structure.value) {
      const childPrefix = prefix
        ? `${prefix}.${printIdentifier(fieldName)}`
        : `.${printIdentifier(fieldName)}`;
      paths.push(...collectLeafPaths(childStructure, childPrefix));
    }
  }

  return paths;
}

/**
 * Walk a structure and write DatasetRef files for each leaf dataset.
 *
 * Used during deploy to initialize refs from a package's tree objects.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param structure - The structure to walk
 * @param rootHash - The root tree hash from the package
 */
export async function writeRefsFromTree(
  storage: StorageBackend,
  repo: string,
  ws: string,
  structure: Structure,
  rootHash: string
): Promise<void> {
  const { treeRead } = await import('./trees.js');
  await writeRefsFromTreeRecursive(storage, repo, ws, structure, rootHash, '', treeRead);
}

async function writeRefsFromTreeRecursive(
  storage: StorageBackend,
  repo: string,
  ws: string,
  structure: Structure,
  treeHash: string,
  pathPrefix: string,
  treeRead: (storage: StorageBackend, repo: string, hash: string, structure: Structure) => Promise<Record<string, DataRef>>
): Promise<void> {
  if (structure.type !== 'struct') return;

  const treeObject = await treeRead(storage, repo, treeHash, structure);

  for (const [fieldName, childStructure] of structure.value) {
    const childRef = treeObject[fieldName];
    const refPath = pathPrefix ? `${pathPrefix}/${fieldName}` : fieldName;

    if (childStructure.type === 'value') {
      // Leaf dataset: write a DatasetRef
      let datasetRef: DatasetRef;
      if (!childRef || childRef.type === 'unassigned') {
        datasetRef = variant('unassigned', null);
      } else if (childRef.type === 'null') {
        datasetRef = variant('null', { versions: new Map() });
      } else if (childRef.type === 'value') {
        datasetRef = variant('value', { hash: childRef.value, versions: new Map() });
      } else {
        datasetRef = variant('unassigned', null);
      }
      await storage.datasets.write(repo, ws, refPath, datasetRef);
    } else if (childStructure.type === 'struct' && childRef?.type === 'tree') {
      // Nested tree: recurse
      await writeRefsFromTreeRecursive(
        storage, repo, ws, childStructure, childRef.value, refPath, treeRead
      );
    }
  }
}

/**
 * Initialize per-dataset ref files from a package's inline refs map.
 *
 * Used during deploy to copy per-dataset refs from the package into
 * the workspace. Walks the structure and writes refs from the package's
 * refs map, falling back to unassigned for any missing entries.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param structure - The package's data structure
 * @param refs - Map of refPath to DatasetRef from the package
 */
export async function writeRefsFromPackage(
  storage: StorageBackend,
  repo: string,
  ws: string,
  structure: Structure,
  refs: Map<string, DatasetRef>
): Promise<void> {
  await writeRefsFromPackageRecursive(storage, repo, ws, structure, '', refs);
}

async function writeRefsFromPackageRecursive(
  storage: StorageBackend,
  repo: string,
  ws: string,
  structure: Structure,
  pathPrefix: string,
  refs: Map<string, DatasetRef>
): Promise<void> {
  if (structure.type !== 'struct') return;

  for (const [fieldName, childStructure] of structure.value) {
    const refPath = pathPrefix ? `${pathPrefix}/${fieldName}` : fieldName;

    if (childStructure.type === 'value') {
      // Leaf dataset: use ref from package, or unassigned if not present
      const datasetRef = refs.get(refPath) ?? variant('unassigned', null);
      await storage.datasets.write(repo, ws, refPath, datasetRef);
    } else if (childStructure.type === 'struct') {
      // Nested tree: recurse
      await writeRefsFromPackageRecursive(storage, repo, ws, childStructure, refPath, refs);
    }
  }
}
