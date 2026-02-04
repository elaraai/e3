/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, BlobType, NullType } from '@elaraai/east';
import { WorkspaceStateType, type WorkspaceState } from '@elaraai/e3-types';
import type { WorkspaceInfo, WorkspaceStatusResult } from './types.js';
import {
  WorkspaceInfoType,
  WorkspaceCreateRequestType,
  WorkspaceDeployRequestType,
  WorkspaceStatusResultType,
} from './types.js';
import { get, post, del, type RequestOptions } from './http.js';

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
 * Export workspace as a package zip archive.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @returns Zip archive as bytes
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceExport(url: string, repo: string, name: string, options: RequestOptions): Promise<Uint8Array> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}/export`,
    BlobType,
    options
  );
}
