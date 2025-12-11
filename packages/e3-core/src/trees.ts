/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Low-level tree and dataset operations for e3 repositories.
 *
 * Trees are persistent data structures with structural sharing (like git trees).
 * Each tree node contains DataRefs pointing to either other trees or dataset values.
 *
 * Tree operations require a Structure parameter which describes the shape of the
 * tree node. This enables proper encoding/decoding with the correct StructType
 * and supports future tree types (array, variant, etc.).
 *
 * Low-level operations work with hashes directly (by-hash).
 * High-level operations traverse paths from a root (by-path).
 */

import {
  decodeBeast2,
  decodeBeast2For,
  encodeBeast2For,
  StructType,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';
import { DataRefType, PackageObjectType, WorkspaceStateType, type DataRef, type Structure, type TreePath, type WorkspaceState } from '@elaraai/e3-types';
import { objectRead, objectWrite } from './objects.js';
import { packageRead } from './packages.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * A tree object: mapping of field names to data references.
 *
 * This is a plain object (not a Map) because tree objects are encoded as
 * StructTypes with known field names derived from the Structure.
 */
export type TreeObject = Record<string, DataRef>;

/**
 * Build the EastType for a tree object based on its structure.
 *
 * For struct trees, creates a StructType with DataRefType for each field.
 * Future: will handle array, variant, and other tree types.
 *
 * @param structure - The structure describing this tree node
 * @returns The EastType for encoding/decoding the tree object
 */
function treeTypeFromStructure(structure: Structure): EastType {
  if (structure.type === 'struct') {
    const fields: Record<string, typeof DataRefType> = {};
    for (const fieldName of structure.value.keys()) {
      fields[fieldName] = DataRefType;
    }
    return StructType(fields);
  } else if (structure.type === 'value') {
    throw new Error('Cannot create tree type for a value structure - this is a dataset, not a tree');
  } else {
    throw new Error(`Unsupported structure type: ${(structure as Structure).type}`);
  }
}

/**
 * Read and decode a tree object from the object store.
 *
 * @param repoPath - Path to .e3 repository
 * @param hash - Hash of the tree object
 * @param structure - The structure describing this tree node's shape
 * @returns The decoded tree object (field name -> DataRef)
 * @throws If object not found, structure is not a tree, or decoding fails
 */
export async function treeRead(
  repoPath: string,
  hash: string,
  structure: Structure
): Promise<TreeObject> {
  const treeType = treeTypeFromStructure(structure);
  const data = await objectRead(repoPath, hash);
  const decoder = decodeBeast2For(treeType);
  return decoder(Buffer.from(data)) as TreeObject;
}

/**
 * Encode and write a tree object to the object store.
 *
 * @param repoPath - Path to .e3 repository
 * @param fields - Object mapping field names to DataRefs
 * @param structure - The structure describing this tree node's shape
 * @returns Hash of the written tree object
 * @throws If structure is not a tree or encoding fails
 */
export async function treeWrite(
  repoPath: string,
  fields: TreeObject,
  structure: Structure
): Promise<string> {
  const treeType = treeTypeFromStructure(structure);
  const encoder = encodeBeast2For(treeType);
  const data = encoder(fields);
  return objectWrite(repoPath, data);
}

/**
 * Read and decode a dataset value from the object store.
 *
 * The .beast2 format includes type information in the header, so values
 * can be decoded without knowing the schema in advance.
 *
 * @param repoPath - Path to .e3 repository
 * @param hash - Hash of the dataset value
 * @returns The decoded value and its type
 * @throws If object not found or not a valid beast2 object
 */
export async function datasetRead(
  repoPath: string,
  hash: string
): Promise<{ type: EastType; value: unknown }> {
  const data = await objectRead(repoPath, hash);
  const result = decodeBeast2(Buffer.from(data));
  return { type: result.type as EastType, value: result.value };
}

/**
 * Encode and write a dataset value to the object store.
 *
 * @param repoPath - Path to .e3 repository
 * @param value - The value to encode
 * @param type - The East type for encoding (EastType or EastTypeValue)
 * @returns Hash of the written dataset value
 */
export async function datasetWrite(
  repoPath: string,
  value: unknown,
  type: EastType | EastTypeValue
): Promise<string> {
  // encodeBeast2For accepts both EastType and EastTypeValue, but TypeScript
  // overloads don't support union types directly. Cast to EastTypeValue since
  // that's the more general case and the runtime handles both.
  const encoder = encodeBeast2For(type as EastTypeValue);
  const data = encoder(value);
  return objectWrite(repoPath, data);
}

// =============================================================================
// High-level Operations (by path)
// =============================================================================

/**
 * Result of traversing to a path location.
 */
interface TraversalResult {
  /** The structure at the path location */
  structure: Structure;
  /** The DataRef at the path location */
  ref: DataRef;
}

/**
 * Traverse a tree from root to a path, co-walking structure and data.
 *
 * @param repoPath - Path to .e3 repository
 * @param rootHash - Hash of the root tree object
 * @param rootStructure - Structure of the root tree
 * @param path - Path to traverse
 * @returns The structure and DataRef at the path location
 * @throws If path is invalid or traversal fails
 */
async function traverse(
  repoPath: string,
  rootHash: string,
  rootStructure: Structure,
  path: TreePath
): Promise<TraversalResult> {
  let currentStructure = rootStructure;
  let currentHash = rootHash;

  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!;

    if (segment.type !== 'field') {
      throw new Error(`Unsupported path segment type: ${segment.type}`);
    }

    const fieldName = segment.value;

    // Current structure must be a struct tree to descend into
    if (currentStructure.type !== 'struct') {
      const pathSoFar = path.slice(0, i).map(s => s.value).join('.');
      throw new Error(`Cannot descend into non-struct at path '${pathSoFar}'`);
    }

    // Read the current tree object
    const treeObject = await treeRead(repoPath, currentHash, currentStructure);

    // Look up the child ref
    const childRef = treeObject[fieldName];
    if (!childRef) {
      const pathSoFar = path.slice(0, i).map(s => s.value).join('.');
      const available = Object.keys(treeObject).join(', ');
      throw new Error(`Field '${fieldName}' not found at '${pathSoFar}'. Available: ${available}`);
    }

    // Look up the child structure
    const childStructure = currentStructure.value.get(fieldName);
    if (!childStructure) {
      throw new Error(`Field '${fieldName}' not found in structure`);
    }

    // If this is the last segment, return the result
    if (i === path.length - 1) {
      return { structure: childStructure, ref: childRef };
    }

    // Otherwise, continue traversing (must be a tree ref)
    if (childRef.type !== 'tree') {
      const pathSoFar = path.slice(0, i + 1).map(s => s.value).join('.');
      throw new Error(`Expected tree ref at '${pathSoFar}', got '${childRef.type}'`);
    }

    currentStructure = childStructure;
    currentHash = childRef.value;
  }

  // Empty path - return root
  return {
    structure: rootStructure,
    ref: { type: 'tree', value: rootHash } as DataRef,
  };
}

/**
 * List field names at a tree path within a package's data tree.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @param version - Package version
 * @param path - Path to the tree node
 * @returns Array of field names at the path
 * @throws If package not found, path invalid, or path points to a dataset
 */
export async function packageListTree(
  repoPath: string,
  name: string,
  version: string,
  path: TreePath
): Promise<string[]> {
  // Read the package to get root structure and hash
  const pkg = await packageRead(repoPath, name, version);
  const rootStructure = pkg.data.structure;
  const rootHash = pkg.data.value;

  if (path.length === 0) {
    // Empty path - list root tree fields
    if (rootStructure.type !== 'struct') {
      throw new Error('Root is not a tree');
    }
    const treeObject = await treeRead(repoPath, rootHash, rootStructure);
    return Object.keys(treeObject);
  }

  // Traverse to the path
  const { structure, ref } = await traverse(repoPath, rootHash, rootStructure, path);

  // Must be a tree structure
  if (structure.type !== 'struct') {
    const pathStr = path.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a dataset, not a tree`);
  }

  // Must be a tree ref
  if (ref.type !== 'tree') {
    const pathStr = path.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' has ref type '${ref.type}', expected 'tree'`);
  }

  // Read the tree and return field names
  const treeObject = await treeRead(repoPath, ref.value, structure);
  return Object.keys(treeObject);
}

/**
 * Read and decode a dataset value at a path within a package's data tree.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @param version - Package version
 * @param path - Path to the dataset
 * @returns The decoded dataset value
 * @throws If package not found, path invalid, or path points to a tree
 */
export async function packageGetDataset(
  repoPath: string,
  name: string,
  version: string,
  path: TreePath
): Promise<unknown> {
  // Read the package to get root structure and hash
  const pkg = await packageRead(repoPath, name, version);
  const rootStructure = pkg.data.structure;
  const rootHash = pkg.data.value;

  if (path.length === 0) {
    throw new Error('Cannot get dataset at root path - root is always a tree');
  }

  // Traverse to the path
  const { structure, ref } = await traverse(repoPath, rootHash, rootStructure, path);

  // Must be a value structure
  if (structure.type !== 'value') {
    const pathStr = path.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a tree, not a dataset`);
  }

  // Handle different ref types
  if (ref.type === 'unassigned') {
    throw new Error(`Dataset at path is unassigned (pending task output)`);
  }

  if (ref.type === 'null') {
    return null;
  }

  if (ref.type === 'tree') {
    const pathStr = path.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' structure says value but ref is tree`);
  }

  // Read and return the dataset value
  const result = await datasetRead(repoPath, ref.value);
  return result.value;
}

/**
 * Update a dataset at a path within a workspace.
 *
 * This creates new tree objects along the path with structural sharing,
 * then atomically updates the workspace root.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param value - The new value to write
 * @param type - The East type for encoding the value (EastType or EastTypeValue)
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceSetDataset(
  repoPath: string,
  ws: string,
  treePath: TreePath,
  value: unknown,
  type: EastType | EastTypeValue
): Promise<void> {
  if (treePath.length === 0) {
    throw new Error('Cannot set dataset at root path - root is always a tree');
  }

  const state = await readWorkspaceState(repoPath, ws);

  // Read the deployed package object to get the structure
  const pkgData = await objectRead(repoPath, state.packageHash);
  const decoder = decodeBeast2For(PackageObjectType);
  const pkgObject = decoder(Buffer.from(pkgData));
  const rootStructure = pkgObject.data.structure;

  // Validate that the path leads to a value structure
  let currentStructure = rootStructure;
  for (let i = 0; i < treePath.length; i++) {
    const segment = treePath[i]!;
    if (segment.type !== 'field') {
      throw new Error(`Unsupported path segment type: ${segment.type}`);
    }

    if (currentStructure.type !== 'struct') {
      const pathSoFar = treePath.slice(0, i).map(s => s.value).join('.');
      throw new Error(`Cannot descend into non-struct at path '${pathSoFar}'`);
    }

    const childStructure = currentStructure.value.get(segment.value);
    if (!childStructure) {
      const pathSoFar = treePath.slice(0, i).map(s => s.value).join('.');
      const available = Array.from(currentStructure.value.keys()).join(', ');
      throw new Error(`Field '${segment.value}' not found at '${pathSoFar}'. Available: ${available}`);
    }

    currentStructure = childStructure;
  }

  // Final structure must be a value
  if (currentStructure.type !== 'value') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a tree, not a dataset`);
  }

  // Write the new dataset value
  const newValueHash = await datasetWrite(repoPath, value, type);

  // Now rebuild the tree path from leaf to root (structural sharing)
  // We need to read each tree along the path, modify it, and write a new version

  // Collect all tree hashes and structures along the path
  const treeInfos: Array<{
    hash: string;
    structure: Structure;
  }> = [];

  let currentHash = state.rootHash;
  currentStructure = rootStructure;

  // Read all trees along the path (except the last segment which is the dataset)
  for (let i = 0; i < treePath.length - 1; i++) {
    treeInfos.push({ hash: currentHash, structure: currentStructure });

    const segment = treePath[i]!;
    const treeObject = await treeRead(repoPath, currentHash, currentStructure);
    const childRef = treeObject[segment.value];

    if (!childRef || childRef.type !== 'tree') {
      throw new Error(`Expected tree ref at path segment ${i}`);
    }

    currentHash = childRef.value;
    currentStructure = (currentStructure as { type: 'struct'; value: Map<string, Structure> }).value.get(segment.value)!;
  }

  // Add the final tree that contains the dataset
  treeInfos.push({ hash: currentHash, structure: currentStructure });

  // Now rebuild from leaf to root
  // Start with the new value hash as the new ref
  let newRef: DataRef = { type: 'value', value: newValueHash } as DataRef;

  for (let i = treeInfos.length - 1; i >= 0; i--) {
    const { hash, structure } = treeInfos[i]!;
    const fieldName = treePath[i]!.value;

    // Read the current tree
    const treeObject = await treeRead(repoPath, hash, structure);

    // Create modified tree with the new ref
    const newTreeObject: TreeObject = {
      ...treeObject,
      [fieldName]: newRef,
    };

    // Write the new tree
    const newTreeHash = await treeWrite(repoPath, newTreeObject, structure);

    // This becomes the new ref for the parent
    newRef = { type: 'tree', value: newTreeHash } as DataRef;
  }

  // The final newRef is always a tree ref pointing to the new root
  // (because we start with a value ref and wrap it in tree refs bottom-up)
  if (newRef.type !== 'tree' || newRef.value === null) {
    throw new Error('Internal error: expected tree ref after rebuilding path');
  }
  const newRootHash = newRef.value;

  // Update workspace state atomically
  await writeWorkspaceState(repoPath, ws, {
    ...state,
    rootHash: newRootHash,
    rootUpdatedAt: new Date(),
  });
}

// =============================================================================
// Workspace Helper Functions
// =============================================================================

/**
 * Write workspace state to file atomically.
 */
async function writeWorkspaceState(repoPath: string, ws: string, state: WorkspaceState): Promise<void> {
  const wsDir = path.join(repoPath, 'workspaces');
  const stateFile = path.join(wsDir, `${ws}.beast2`);

  // Ensure workspaces directory exists
  await fs.mkdir(wsDir, { recursive: true });

  const encoder = encodeBeast2For(WorkspaceStateType);
  const data = encoder(state);

  // Write atomically: write to temp file, then rename
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const tempPath = path.join(wsDir, `.${ws}.${Date.now()}.${randomSuffix}.tmp`);
  await fs.writeFile(tempPath, data);
  await fs.rename(tempPath, stateFile);
}

/**
 * Read workspace state from file.
 * @throws If workspace doesn't exist or is not deployed
 */
async function readWorkspaceState(repoPath: string, ws: string): Promise<WorkspaceState> {
  const stateFile = path.join(repoPath, 'workspaces', `${ws}.beast2`);

  try {
    const data = await fs.readFile(stateFile);
    if (data.length === 0) {
      throw new Error(`Workspace not deployed: ${ws}`);
    }
    const decoder = decodeBeast2For(WorkspaceStateType);
    return decoder(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Workspace not found: ${ws}`);
    }
    throw err;
  }
}

/**
 * Get root structure and hash for a workspace.
 * Reads the deployed package object to get the structure.
 */
async function getWorkspaceRootInfo(
  repoPath: string,
  ws: string
): Promise<{ rootHash: string; rootStructure: Structure }> {
  const state = await readWorkspaceState(repoPath, ws);

  // Read the deployed package object using the stored hash
  const pkgData = await objectRead(repoPath, state.packageHash);
  const decoder = decodeBeast2For(PackageObjectType);
  const pkgObject = decoder(Buffer.from(pkgData));

  return {
    rootHash: state.rootHash,
    rootStructure: pkgObject.data.structure,
  };
}

// =============================================================================
// Workspace High-level Operations (by path)
// =============================================================================

/**
 * List field names at a tree path within a workspace's data tree.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @param path - Path to the tree node
 * @returns Array of field names at the path
 * @throws If workspace not deployed, path invalid, or path points to a dataset
 */
export async function workspaceListTree(
  repoPath: string,
  ws: string,
  treePath: TreePath
): Promise<string[]> {
  const { rootHash, rootStructure } = await getWorkspaceRootInfo(repoPath, ws);

  if (treePath.length === 0) {
    // Empty path - list root tree fields
    if (rootStructure.type !== 'struct') {
      throw new Error('Root is not a tree');
    }
    const treeObject = await treeRead(repoPath, rootHash, rootStructure);
    return Object.keys(treeObject);
  }

  // Traverse to the path
  const { structure, ref } = await traverse(repoPath, rootHash, rootStructure, treePath);

  // Must be a tree structure
  if (structure.type !== 'struct') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a dataset, not a tree`);
  }

  // Must be a tree ref
  if (ref.type !== 'tree') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' has ref type '${ref.type}', expected 'tree'`);
  }

  // Read the tree and return field names
  const treeObject = await treeRead(repoPath, ref.value, structure);
  return Object.keys(treeObject);
}

/**
 * Read and decode a dataset value at a path within a workspace's data tree.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @param path - Path to the dataset
 * @returns The decoded dataset value
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceGetDataset(
  repoPath: string,
  ws: string,
  treePath: TreePath
): Promise<unknown> {
  const { rootHash, rootStructure } = await getWorkspaceRootInfo(repoPath, ws);

  if (treePath.length === 0) {
    throw new Error('Cannot get dataset at root path - root is always a tree');
  }

  // Traverse to the path
  const { structure, ref } = await traverse(repoPath, rootHash, rootStructure, treePath);

  // Must be a value structure
  if (structure.type !== 'value') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a tree, not a dataset`);
  }

  // Handle different ref types
  if (ref.type === 'unassigned') {
    throw new Error(`Dataset at path is unassigned (pending task output)`);
  }

  if (ref.type === 'null') {
    return null;
  }

  if (ref.type === 'tree') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' structure says value but ref is tree`);
  }

  // Read and return the dataset value
  const result = await datasetRead(repoPath, ref.value);
  return result.value;
}

/**
 * Get the hash of a dataset at a path within a workspace's data tree.
 *
 * Unlike workspaceGetDataset which decodes the value, this returns the raw
 * hash reference. Useful for dataflow execution which operates on hashes.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @returns Object with ref type and hash (null for unassigned/null refs)
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceGetDatasetHash(
  repoPath: string,
  ws: string,
  treePath: TreePath
): Promise<{ refType: DataRef['type']; hash: string | null }> {
  const { rootHash, rootStructure } = await getWorkspaceRootInfo(repoPath, ws);

  if (treePath.length === 0) {
    throw new Error('Cannot get dataset at root path - root is always a tree');
  }

  // Traverse to the path
  const { structure, ref } = await traverse(repoPath, rootHash, rootStructure, treePath);

  // Must be a value structure
  if (structure.type !== 'value') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a tree, not a dataset`);
  }

  // Return ref type and hash
  if (ref.type === 'unassigned' || ref.type === 'null') {
    return { refType: ref.type, hash: null };
  }

  if (ref.type === 'tree') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' structure says value but ref is tree`);
  }

  return { refType: ref.type, hash: ref.value };
}

/**
 * Set a dataset at a path within a workspace using a pre-computed hash.
 *
 * Unlike workspaceSetDataset which encodes a value, this takes a hash
 * directly. Useful for dataflow execution which already has the output hash.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param valueHash - Hash of the dataset value already in the object store
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceSetDatasetByHash(
  repoPath: string,
  ws: string,
  treePath: TreePath,
  valueHash: string
): Promise<void> {
  if (treePath.length === 0) {
    throw new Error('Cannot set dataset at root path - root is always a tree');
  }

  const state = await readWorkspaceState(repoPath, ws);

  // Read the deployed package object to get the structure
  const pkgData = await objectRead(repoPath, state.packageHash);
  const decoder = decodeBeast2For(PackageObjectType);
  const pkgObject = decoder(Buffer.from(pkgData));
  const rootStructure = pkgObject.data.structure;

  // Validate that the path leads to a value structure
  let currentStructure = rootStructure;
  for (let i = 0; i < treePath.length; i++) {
    const segment = treePath[i]!;
    if (segment.type !== 'field') {
      throw new Error(`Unsupported path segment type: ${segment.type}`);
    }

    if (currentStructure.type !== 'struct') {
      const pathSoFar = treePath.slice(0, i).map(s => s.value).join('.');
      throw new Error(`Cannot descend into non-struct at path '${pathSoFar}'`);
    }

    const childStructure = currentStructure.value.get(segment.value);
    if (!childStructure) {
      const pathSoFar = treePath.slice(0, i).map(s => s.value).join('.');
      const available = Array.from(currentStructure.value.keys()).join(', ');
      throw new Error(`Field '${segment.value}' not found at '${pathSoFar}'. Available: ${available}`);
    }

    currentStructure = childStructure;
  }

  // Final structure must be a value
  if (currentStructure.type !== 'value') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a tree, not a dataset`);
  }

  // Rebuild the tree path from leaf to root (structural sharing)
  // Collect all tree hashes and structures along the path
  const treeInfos: Array<{
    hash: string;
    structure: Structure;
  }> = [];

  let currentHash = state.rootHash;
  currentStructure = rootStructure;

  // Read all trees along the path (except the last segment which is the dataset)
  for (let i = 0; i < treePath.length - 1; i++) {
    treeInfos.push({ hash: currentHash, structure: currentStructure });

    const segment = treePath[i]!;
    const treeObject = await treeRead(repoPath, currentHash, currentStructure);
    const childRef = treeObject[segment.value];

    if (!childRef || childRef.type !== 'tree') {
      throw new Error(`Expected tree ref at path segment ${i}`);
    }

    currentHash = childRef.value;
    currentStructure = (currentStructure as { type: 'struct'; value: Map<string, Structure> }).value.get(segment.value)!;
  }

  // Add the final tree that contains the dataset
  treeInfos.push({ hash: currentHash, structure: currentStructure });

  // Now rebuild from leaf to root
  // Start with the provided value hash as the new ref
  let newRef: DataRef = { type: 'value', value: valueHash } as DataRef;

  for (let i = treeInfos.length - 1; i >= 0; i--) {
    const { hash, structure } = treeInfos[i]!;
    const fieldName = treePath[i]!.value;

    // Read the current tree
    const treeObject = await treeRead(repoPath, hash, structure);

    // Create modified tree with the new ref
    const newTreeObject: TreeObject = {
      ...treeObject,
      [fieldName]: newRef,
    };

    // Write the new tree
    const newTreeHash = await treeWrite(repoPath, newTreeObject, structure);

    // This becomes the new ref for the parent
    newRef = { type: 'tree', value: newTreeHash } as DataRef;
  }

  // The final newRef is always a tree ref pointing to the new root
  if (newRef.type !== 'tree' || newRef.value === null) {
    throw new Error('Internal error: expected tree ref after rebuilding path');
  }
  const newRootHash = newRef.value;

  // Update workspace state atomically
  await writeWorkspaceState(repoPath, ws, {
    ...state,
    rootHash: newRootHash,
    rootUpdatedAt: new Date(),
  });
}
