/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType, StringType, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { computeHash } from './util.js';
import { ApiError, fetchWithAuth, get, type RequestOptions, type Response } from './http.js';
import {
  ResponseType,
  DatasetStatusDetailType,
  ListEntryType,
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferDoneResponseType,
  type ListEntry,
  type DatasetStatusDetail,
  type TransferUploadResponse,
  type TransferDoneResponse,
} from './types.js';

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
): Promise<{ data: Uint8Array; hash: string; size: number }> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const response = await fetchWithAuth(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}`,
    {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
      redirect: 'manual',
    },
    options
  );

  // Handle 307 redirect — follow WITHOUT auth headers (target is a no-auth data endpoint)
  if (response.status === 307) {
    const location = response.headers.get('Location');
    if (!location) throw new Error('307 redirect missing Location header');
    // Resolve relative URLs against the request origin
    const redirectUrl = location.startsWith('/') ? `${url}${location}` : location;
    const redirectResponse = await fetch(redirectUrl, {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
    });
    if (!redirectResponse.ok) {
      throw new Error(`Failed to get dataset (redirect): ${redirectResponse.status} ${redirectResponse.statusText}`);
    }
    const buffer = await redirectResponse.arrayBuffer();
    const data = new Uint8Array(buffer);
    const hash = redirectResponse.headers.get('X-Content-SHA256') ?? response.headers.get('X-Content-SHA256') ?? '';
    const size = parseInt(redirectResponse.headers.get('Content-Length') ?? response.headers.get('X-Content-Length') ?? '0', 10);
    return { data, hash, size };
  }

  if (!response.ok) {
    throw new Error(`Failed to get dataset: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);
  const hash = response.headers.get('X-Content-SHA256') ?? '';
  const size = parseInt(response.headers.get('Content-Length') ?? '0', 10);
  return { data, hash, size };
}

const SIZE_THRESHOLD = 1 * 1024 * 1024; // 1 MB

/**
 * Set a dataset value from raw BEAST2 bytes.
 *
 * For payloads > 1MB, uses a transfer flow (init → upload → complete) to
 * avoid inline body size limits. For smaller payloads, uses inline PUT.
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
  if (data.byteLength > SIZE_THRESHOLD) {
    return datasetSetTransfer(url, repo, workspace, path, data, options);
  }

  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const response = await fetchWithAuth(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': BEAST2_CONTENT_TYPE,
        'Accept': BEAST2_CONTENT_TYPE,
      },
      body: data,
    },
    options
  );

  if (!response.ok) {
    throw new Error(`Failed to set dataset: ${response.status} ${response.statusText}`);
  }

  // Decode BEAST2 response to check for application-level errors
  const buffer = await response.arrayBuffer();
  const decode = decodeBeast2For(ResponseType(NullType));
  const result = decode(new Uint8Array(buffer)) as Response<null>;

  if (result.type === 'error') {
    throw new ApiError(result.value.type, result.value.value);
  }
}

/**
 * Set a large dataset using the transfer flow (init → upload → complete).
 */
async function datasetSetTransfer(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  data: Uint8Array,
  options: RequestOptions
): Promise<void> {
  const hash = await computeHash(data);
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const repoEncoded = encodeURIComponent(repo);
  const wsEncoded = encodeURIComponent(workspace);

  // 1. Init transfer (BEAST2 request/response)
  const encodeInit = encodeBeast2For(TransferUploadRequestType);
  const initRes = await fetchWithAuth(
    `${url}/api/repos/${repoEncoded}/workspaces/${wsEncoded}/datasets/${pathStr}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
    },
    body: encodeInit({ hash, size: BigInt(data.byteLength) }),
  }, options);

  if (!initRes.ok) {
    throw new Error(`Transfer init failed: ${initRes.status} ${initRes.statusText}`);
  }

  const initBuffer = new Uint8Array(await initRes.arrayBuffer());
  const decodeInit = decodeBeast2For(ResponseType(TransferUploadResponseType));
  const initResult = decodeInit(initBuffer) as Response<TransferUploadResponse>;
  if (initResult.type === 'error') {
    throw new ApiError(initResult.value.type, initResult.value.value);
  }

  const init = initResult.value;

  // Dedup — object already exists, ref updated
  if (init.type === 'completed') return;

  // 2. Upload to staging (no auth — URL may be a presigned S3 URL)
  const uploadRes = await fetch(init.value.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
    },
    body: data,
  });

  if (!uploadRes.ok) {
    throw new Error(`Transfer upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
  }

  // 3. Commit — server verifies hash + updates ref (BEAST2 response)
  const commitRes = await fetchWithAuth(
    `${url}/api/repos/${repoEncoded}/workspaces/${wsEncoded}/datasets/${pathStr}/upload/${init.value.id}`, {
    method: 'POST',
    headers: { 'Accept': BEAST2_CONTENT_TYPE },
  }, options);

  if (!commitRes.ok) {
    throw new Error(`Transfer commit failed: ${commitRes.status} ${commitRes.statusText}`);
  }

  const commitBuffer = new Uint8Array(await commitRes.arrayBuffer());
  const decodeDone = decodeBeast2For(ResponseType(TransferDoneResponseType));
  const commitResult = decodeDone(commitBuffer) as Response<TransferDoneResponse>;
  if (commitResult.type === 'error') {
    throw new ApiError(commitResult.value.type, commitResult.value.value);
  }

  if (commitResult.value.type === 'error') {
    throw new Error(`Transfer failed: ${commitResult.value.value.message}`);
  }
}

/**
 * List all entries recursively under a path (flat list of datasets and trees).
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Starting path (empty for root)
 * @param options - Request options including auth token
 * @returns Array of list entries (dataset or tree variants) with path, type, hash, and size
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetListRecursive(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<ListEntry[]> {
  const endpoint = `${datasetEndpoint(repo, workspace, path)}?list=true&recursive=true&status=true`;
  return get(url, endpoint, ArrayType(ListEntryType), options);
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
 * @returns Array of list entries (dataset or tree variants) with path, type, hash, and size
 */
export async function datasetListWithStatus(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<ListEntry[]> {
  const endpoint = `${datasetEndpoint(repo, workspace, path)}?list=true&status=true`;
  return get(url, endpoint, ArrayType(ListEntryType), options);
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
