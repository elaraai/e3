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
import { get, post, del, unwrap } from './http.js';

/**
 * List all workspaces in the repository.
 *
 * @param url - Base URL of the e3 API server
 * @returns Array of workspace info
 */
export async function workspaceList(url: string): Promise<WorkspaceInfo[]> {
  const response = await get(url, '/api/workspaces', ArrayType(WorkspaceInfoType));
  return unwrap(response);
}

/**
 * Create a new empty workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns Created workspace info
 */
export async function workspaceCreate(url: string, name: string): Promise<WorkspaceInfo> {
  const response = await post(
    url,
    '/api/workspaces',
    { name },
    WorkspaceCreateRequestType,
    WorkspaceInfoType
  );
  return unwrap(response);
}

/**
 * Get workspace state (deployed package info and current root hash).
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns Workspace state
 */
export async function workspaceGet(url: string, name: string): Promise<WorkspaceState> {
  const response = await get(
    url,
    `/api/workspaces/${encodeURIComponent(name)}`,
    WorkspaceStateType
  );
  return unwrap(response);
}

/**
 * Get comprehensive workspace status including datasets, tasks, and lock info.
 *
 * Use this to poll for execution progress after calling dataflowStart().
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns Workspace status with datasets, tasks, and summary
 */
export async function workspaceStatus(url: string, name: string): Promise<WorkspaceStatusResult> {
  const response = await get(
    url,
    `/api/workspaces/${encodeURIComponent(name)}/status`,
    WorkspaceStatusResultType
  );
  return unwrap(response);
}

/**
 * Remove a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 */
export async function workspaceRemove(url: string, name: string): Promise<void> {
  const response = await del(
    url,
    `/api/workspaces/${encodeURIComponent(name)}`,
    NullType
  );
  unwrap(response);
}

/**
 * Deploy a package to a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @param packageRef - Package reference (name or name@version)
 */
export async function workspaceDeploy(
  url: string,
  name: string,
  packageRef: string
): Promise<void> {
  const response = await post(
    url,
    `/api/workspaces/${encodeURIComponent(name)}/deploy`,
    { packageRef },
    WorkspaceDeployRequestType,
    NullType
  );
  unwrap(response);
}

/**
 * Export workspace as a package zip archive.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns Zip archive as bytes
 */
export async function workspaceExport(url: string, name: string): Promise<Uint8Array> {
  const response = await get(
    url,
    `/api/workspaces/${encodeURIComponent(name)}/export`,
    BlobType
  );
  return unwrap(response);
}
