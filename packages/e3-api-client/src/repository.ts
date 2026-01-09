/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { RepositoryStatus, GcRequest, GcResult } from './types.js';
import { RepositoryStatusType, GcRequestType, GcResultType } from './types.js';
import { get, post, unwrap } from './http.js';

/**
 * Get repository status.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @returns Repository status including object, package, and workspace counts
 */
export async function repoStatus(url: string, repo: string): Promise<RepositoryStatus> {
  const response = await get(url, `/repos/${encodeURIComponent(repo)}/status`, RepositoryStatusType);
  return unwrap(response);
}

/**
 * Run garbage collection on the repository.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param options - GC options (dryRun to preview without deleting)
 * @returns GC result with counts and freed bytes
 */
export async function repoGc(url: string, repo: string, options: GcRequest): Promise<GcResult> {
  const response = await post(url, `/repos/${encodeURIComponent(repo)}/gc`, options, GcRequestType, GcResultType);
  return unwrap(response);
}
