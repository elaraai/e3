/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType, encodeBeast2For, decodeBeast2For, some, none } from '@elaraai/east';
import {
  WorkspaceStateType,
  type WorkspaceState,
  PackageJobResponseType,
  PackageExportStatusType,
  type PackageExportProgress,
  type PackageExportStatus,
} from '@elaraai/e3-types';
import type { WorkspaceInfo, WorkspaceStatusResult } from './types.js';
import {
  WorkspaceInfoType,
  WorkspaceCreateRequestType,
  WorkspaceDeployRequestType,
  WorkspaceStatusResultType,
  WorkspaceExportRequestType,
  ResponseType,
} from './types.js';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-core';
import { get, post, del, fetchWithAuth, ApiError, type RequestOptions } from './http.js';

/**
 * List all workspaces in the repository.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param options - Request options including auth token
 * @returns Array of workspace info
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceList(url: string, repo: string, options: RequestOptions): Promise<WorkspaceInfo[]> {
  return get(url, `/repos/${encodeURIComponent(repo)}/workspaces`, ArrayType(WorkspaceInfoType), options);
}

/**
 * Create a new empty workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @returns Created workspace info
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceCreate(url: string, repo: string, name: string, options: RequestOptions): Promise<WorkspaceInfo> {
  return post(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces`,
    { name },
    WorkspaceCreateRequestType,
    WorkspaceInfoType,
    options
  );
}

/**
 * Get workspace state (deployed package info and current root hash).
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @returns Workspace state
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceGet(url: string, repo: string, name: string, options: RequestOptions): Promise<WorkspaceState> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}`,
    WorkspaceStateType,
    options
  );
}

/**
 * Get comprehensive workspace status including datasets, tasks, and lock info.
 *
 * Use this to poll for execution progress after calling dataflowStart().
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @returns Workspace status with datasets, tasks, and summary
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceStatus(url: string, repo: string, name: string, options: RequestOptions): Promise<WorkspaceStatusResult> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}/status`,
    WorkspaceStatusResultType,
    options
  );
}

/**
 * Remove a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceRemove(url: string, repo: string, name: string, options: RequestOptions): Promise<void> {
  await del(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}`,
    NullType,
    options
  );
}

/**
 * Deploy a package to a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param packageRef - Package reference (name or name@version)
 * @param options - Request options including auth token
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceDeploy(
  url: string,
  repo: string,
  name: string,
  packageRef: string,
  options: RequestOptions
): Promise<void> {
  await post(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}/deploy`,
    { packageRef },
    WorkspaceDeployRequestType,
    NullType,
    options
  );
}

/**
 * Options for workspace export progress reporting.
 */
export interface WorkspaceExportOptions {
  name?: string;
  version?: string;
  onProgress?: (progress: PackageExportProgress) => void;
  onDownloadProgress?: (downloaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Export workspace as a package zip archive.
 *
 * Uses the async transfer protocol: POST to trigger → poll for progress → download.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options including auth token
 * @param exportOptions - Optional progress callbacks
 * @returns Zip archive as bytes
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceExport(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions,
  exportOptions?: WorkspaceExportOptions,
): Promise<Uint8Array> {
  const repoEncoded = encodeURIComponent(repo);
  const wsEncoded = encodeURIComponent(workspace);
  const signal = exportOptions?.signal;

  // 1. Trigger workspace export
  const encodeReq = encodeBeast2For(WorkspaceExportRequestType);
  const body = encodeReq({
    name: exportOptions?.name ? some(exportOptions.name) : none,
    version: exportOptions?.version ? some(exportOptions.version) : none,
  });
  const triggerRes = await fetchWithAuth(`${url}/api/repos/${repoEncoded}/workspaces/${wsEncoded}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
    },
    body,
    signal,
  }, options);

  if (!triggerRes.ok) throw new Error(`Workspace export failed: ${triggerRes.status} ${triggerRes.statusText}`);

  const triggerBuffer = new Uint8Array(await triggerRes.arrayBuffer());
  const decodeTrigger = decodeBeast2For(ResponseType(PackageJobResponseType));
  const triggerResult = decodeTrigger(triggerBuffer) as { type: 'success'; value: { id: string } } | { type: 'error'; value: { type: string; value: string } };
  if (triggerResult.type === 'error') throw new ApiError(triggerResult.value.type, triggerResult.value.value);

  // 2. Poll for result
  const status = await pollExportStatus(url, repoEncoded, triggerResult.value.id, options, exportOptions?.onProgress, signal);

  if (status.type === 'failed') {
    throw new Error(`Workspace export failed: ${status.value.message}`);
  }
  if (status.type !== 'completed') {
    throw new Error('Unexpected job status');
  }

  const { downloadUrl } = status.value;

  // 3. Download zip (no auth — URL may be a presigned S3 URL)
  const downloadRes = await fetch(downloadUrl, { method: 'GET', signal });
  if (!downloadRes.ok) throw new Error(`Download failed: ${downloadRes.status} ${downloadRes.statusText}`);

  return new Uint8Array(await downloadRes.arrayBuffer());
}

/**
 * Poll a workspace/package export job until it completes or fails.
 */
async function pollExportStatus(
  url: string,
  repoEncoded: string,
  id: string,
  options: RequestOptions,
  onProgress?: (progress: PackageExportProgress) => void,
  signal?: AbortSignal,
  intervalMs = 1000,
): Promise<PackageExportStatus> {
  while (true) {
    signal?.throwIfAborted();
    const res = await fetchWithAuth(`${url}/api/repos/${repoEncoded}/export/${id}`, {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
      signal,
    }, options);

    if (!res.ok) throw new Error(`Export poll failed: ${res.status} ${res.statusText}`);

    const buffer = new Uint8Array(await res.arrayBuffer());
    const decode = decodeBeast2For(ResponseType(PackageExportStatusType));
    const result = decode(buffer) as { type: 'success'; value: PackageExportStatus } | { type: 'error'; value: { type: string; value: string } };
    if (result.type === 'error') throw new ApiError(result.value.type, result.value.value);

    if (result.value.type === 'processing') {
      onProgress?.(result.value.value);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    return result.value;
  }
}
