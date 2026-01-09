/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { StringType, NullType } from '@elaraai/east';
import type { RepositoryStatus, GcRequest, GcResult } from './types.js';
import { RepositoryStatusType, GcRequestType, GcResultType } from './types.js';
import { get, post, del, putEmpty, unwrap, type RequestOptions } from './http.js';

/**
 * Get repository status.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param options - Request options including auth token
 * @returns Repository status including object, package, and workspace counts
 */
export async function repoStatus(url: string, repo: string, options: RequestOptions): Promise<RepositoryStatus> {
  const response = await get(url, `/repos/${encodeURIComponent(repo)}/status`, RepositoryStatusType, options);
  return unwrap(response);
}

/**
 * Run garbage collection on the repository.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param gcOptions - GC options (dryRun to preview without deleting)
 * @param options - Request options including auth token
 * @returns GC result with counts and freed bytes
 */
export async function repoGc(url: string, repo: string, gcOptions: GcRequest, options: RequestOptions): Promise<GcResult> {
  const response = await post(url, `/repos/${encodeURIComponent(repo)}/gc`, gcOptions, GcRequestType, GcResultType, options);
  return unwrap(response);
}

/**
 * Create a new repository.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Name for the new repository
 * @param options - Request options including auth token
 * @returns The created repository name
 */
export async function repoCreate(url: string, name: string, options: RequestOptions): Promise<string> {
  const response = await putEmpty(url, `/repos/${encodeURIComponent(name)}`, StringType, options);
  return unwrap(response);
}

/**
 * Remove a repository.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Repository name to remove
 * @param options - Request options including auth token
 */
export async function repoRemove(url: string, name: string, options: RequestOptions): Promise<void> {
  const response = await del(url, `/repos/${encodeURIComponent(name)}`, NullType, options);
  unwrap(response);
}
