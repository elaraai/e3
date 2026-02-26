/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, StringType } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { get, type RequestOptions } from './http.js';
import { DatasetListItemType, DatasetStatusDetailType, type DatasetListItem, type DatasetStatusDetail } from './types.js';

function datasetEndpoint(repo: string, workspace: string, path: TreePath): string {
  let endpoint = `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets`;
  if (path.length > 0) {
    const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
    endpoint = `${endpoint}/${pathStr}`;
  }
  return endpoint;
}

/**
 * List field names at root of workspace dataset tree.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options including auth token
 * @returns Array of field names at root
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetList(url: string, repo: string, workspace: string, options: RequestOptions): Promise<string[]> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets`,
    ArrayType(StringType),
    options
  );
}

/**
 * List field names at a path in workspace dataset tree.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'config'])
 * @param options - Request options including auth token
 * @returns Array of field names at path
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetListAt(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<string[]> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}?list=true`,
    ArrayType(StringType),
    options
  );
}

/**
 * Get a dataset value as raw BEAST2 bytes.
 *
 * The returned bytes are raw BEAST2 encoded data from the object store.
 * Use decodeBeast2 or decodeBeast2For to decode with the appropriate type.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'config'])
 * @param options - Request options including auth token
 * @returns Raw BEAST2 bytes
 */
export async function datasetGet(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<Uint8Array> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const response = await fetch(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/beast2',
        'Authorization': `Bearer ${options.token}`,
      },
    }
  );

  if (response.status === 401) {
    throw new Error(`Authentication failed: ${await response.text()}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to get dataset: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Set a dataset value from raw BEAST2 bytes.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'config'])
 * @param data - Raw BEAST2 encoded value
 * @param options - Request options including auth token
 */
export async function datasetSet(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  data: Uint8Array,
  options: RequestOptions
): Promise<void> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const response = await fetch(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/beast2',
        'Authorization': `Bearer ${options.token}`,
      },
      body: data,
    }
  );

  if (response.status === 401) {
    throw new Error(`Authentication failed: ${await response.text()}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to set dataset: ${response.status} ${response.statusText}`);
  }
}

/**
 * List all datasets recursively under a path (flat list).
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Starting path (empty for root)
 * @param options - Request options including auth token
 * @returns Array of dataset items with path, type, hash, and size
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetListRecursive(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<DatasetListItem[]> {
  const endpoint = `${datasetEndpoint(repo, workspace, path)}?list=true&recursive=true&status=true`;
  return get(url, endpoint, ArrayType(DatasetListItemType), options);
}

/**
 * List all descendant dataset paths recursively (paths only, no types/status).
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Starting path (empty for root)
 * @param options - Request options including auth token
 * @returns Array of dataset path strings
 */
export async function datasetListRecursivePaths(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<string[]> {
  const endpoint = `${datasetEndpoint(repo, workspace, path)}?list=true&recursive=true`;
  return get(url, endpoint, ArrayType(StringType), options);
}

/**
 * List immediate children with type, hash, and size details.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to list (empty for root)
 * @param options - Request options including auth token
 * @returns Array of dataset items with path, type, hash, and size
 */
export async function datasetListWithStatus(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<DatasetListItem[]> {
  const endpoint = `${datasetEndpoint(repo, workspace, path)}?list=true&status=true`;
  return get(url, endpoint, ArrayType(DatasetListItemType), options);
}

/**
 * Get status detail for a single dataset.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset
 * @param options - Request options including auth token
 * @returns Dataset status detail including path, type, refType, hash, and size
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetGetStatus(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<DatasetStatusDetail> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}?status=true`,
    DatasetStatusDetailType,
    options
  );
}
