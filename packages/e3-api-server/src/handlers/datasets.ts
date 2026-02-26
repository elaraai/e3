/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, ArrayType, StringType, decodeBeast2, some, none, variant, toEastTypeValue, isVariant, type EastTypeValue } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import {
  workspaceListTree,
  workspaceGetDatasetHash,
  workspaceGetDatasetStatus,
  workspaceSetDataset,
  workspaceGetTree,
  type TreeNode,
} from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { DatasetStatusDetailType, ListEntryType, type ListEntry, type DatasetStatusDetail } from '../types.js';

/**
 * List dataset fields at the given path.
 */
export async function listDatasets(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    const fields = await workspaceListTree(storage, repoPath, workspace, treePath);
    return sendSuccess(ArrayType(StringType), fields);
  } catch (err) {
    return sendError(ArrayType(StringType), errorToVariant(err));
  }
}

/**
 * Get dataset value as raw BEAST2 bytes.
 */
export async function getDataset(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    if (treePath.length === 0) {
      return sendError(NullType, errorToVariant(new Error('Path required for get')));
    }

    const { refType, hash } = await workspaceGetDatasetHash(storage, repoPath, workspace, treePath);

    if (refType === 'unassigned') {
      return sendError(NullType, errorToVariant(new Error('Dataset is unassigned (pending task output)')));
    }

    if (refType === 'null' || !hash) {
      return sendError(NullType, errorToVariant(new Error('Dataset is null')));
    }

    // Return raw BEAST2 bytes directly from object store
    const data = await storage.objects.read(repoPath, hash);
    return new Response(data, {
      status: 200,
      headers: { 'Content-Type': 'application/beast2' },
    });
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}

/**
 * Set dataset value from raw BEAST2 bytes.
 */
export async function setDataset(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  body: Uint8Array
): Promise<Response> {
  try {
    if (treePath.length === 0) {
      return sendError(NullType, errorToVariant(new Error('Path required for set')));
    }

    // Body is raw BEAST2 - decode to get type and value
    const { type, value } = decodeBeast2(body);

    await workspaceSetDataset(storage, repoPath, workspace, treePath, value, type);
    return sendSuccess(NullType, null);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}

/**
 * Flatten a tree of nodes into a list of ListEntry variants (dataset + tree entries).
 */
function flattenTreeEntries(
  nodes: TreeNode[],
  pathPrefix: string,
  result: ListEntry[],
  recursive: boolean
): void {
  for (const node of nodes) {
    const path = pathPrefix ? `${pathPrefix}.${node.name}` : `.${node.name}`;

    if (node.kind === 'dataset') {
      const datasetType = node.datasetType;
      if (datasetType) {
        const typeValue: EastTypeValue = isVariant(datasetType)
          ? datasetType as EastTypeValue
          : toEastTypeValue(datasetType);

        result.push(variant('dataset', {
          path,
          type: typeValue,
          hash: node.hash ? some(node.hash) : none,
          size: node.size !== undefined ? some(BigInt(node.size)) : none,
        }));
      }
    } else if (node.kind === 'tree') {
      result.push(variant('tree', { path, kind: variant('struct', null) }));
      if (recursive) {
        flattenTreeEntries(node.children, path, result, recursive);
      }
    }
  }
}

/**
 * Get status detail for a single dataset.
 */
export async function getDatasetStatus(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    if (treePath.length === 0) {
      return sendError(DatasetStatusDetailType, errorToVariant(new Error('Path required for status')));
    }

    const result = await workspaceGetDatasetStatus(storage, repoPath, workspace, treePath);

    // Build path string from treePath
    const pathStr = '.' + treePath.map(s => s.value).join('.');

    // Convert EastType to EastTypeValue if needed
    const typeValue: EastTypeValue = isVariant(result.datasetType)
      ? result.datasetType as EastTypeValue
      : toEastTypeValue(result.datasetType);

    const detail: DatasetStatusDetail = {
      path: pathStr,
      type: typeValue,
      refType: result.refType,
      hash: result.hash ? some(result.hash) : none,
      size: result.size !== null ? some(BigInt(result.size)) : none,
    };

    return sendSuccess(DatasetStatusDetailType, detail);
  } catch (err) {
    return sendError(DatasetStatusDetailType, errorToVariant(err));
  }
}

/**
 * List datasets recursively (flat list with paths, types, and status).
 */
export async function listDatasetsRecursive(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    // Get tree with types and status included
    const nodes = await workspaceGetTree(storage, repoPath, workspace, treePath, {
      includeTypes: true,
      includeStatus: true,
    });

    // Build path prefix from treePath
    const pathPrefix = treePath.map(seg => seg.value).join('.');

    // Flatten to list (includes tree entries)
    const result: ListEntry[] = [];
    flattenTreeEntries(nodes, pathPrefix ? `.${pathPrefix}` : '', result, true);

    return sendSuccess(ArrayType(ListEntryType), result);
  } catch (err) {
    return sendError(ArrayType(ListEntryType), errorToVariant(err));
  }
}

/**
 * Flatten tree nodes into a list of dataset paths (no types/status).
 */
function flattenTreePaths(
  nodes: TreeNode[],
  pathPrefix: string,
  result: string[]
): void {
  for (const node of nodes) {
    const path = pathPrefix ? `${pathPrefix}.${node.name}` : `.${node.name}`;
    if (node.kind === 'dataset') {
      result.push(path);
    } else if (node.kind === 'tree') {
      flattenTreePaths(node.children, path, result);
    }
  }
}

/**
 * List all descendant dataset paths (string[]).
 */
export async function listDatasetsRecursivePaths(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    const nodes = await workspaceGetTree(storage, repoPath, workspace, treePath, {
      includeTypes: false,
      includeStatus: false,
    });

    const pathPrefix = treePath.map(seg => seg.value).join('.');
    const result: string[] = [];
    flattenTreePaths(nodes, pathPrefix ? `.${pathPrefix}` : '', result);

    return sendSuccess(ArrayType(StringType), result);
  } catch (err) {
    return sendError(ArrayType(StringType), errorToVariant(err));
  }
}

/**
 * List immediate children with types and status (ListEntry[]).
 */
export async function listDatasetsWithStatus(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    const nodes = await workspaceGetTree(storage, repoPath, workspace, treePath, {
      maxDepth: 0,
      includeTypes: true,
      includeStatus: true,
    });

    const pathPrefix = treePath.map(seg => seg.value).join('.');
    const result: ListEntry[] = [];
    flattenTreeEntries(nodes, pathPrefix ? `.${pathPrefix}` : '', result, false);

    return sendSuccess(ArrayType(ListEntryType), result);
  } catch (err) {
    return sendError(ArrayType(ListEntryType), errorToVariant(err));
  }
}
