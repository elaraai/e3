/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { StringType, NullType } from '@elaraai/east';
import type {
  RepositoryStatus,
  GcRequest,
  GcResult,
  GcStartResult,
  GcStatusResult,
} from './types.js';
import {
  RepositoryStatusType,
  GcRequestType,
  GcStartResultType,
  GcStatusResultType,
} from './types.js';
import { get, post, del, putEmpty, type RequestOptions } from './http.js';

/**
 * Get repository status.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param options - Request options including auth token
 * @returns Repository status including object, package, and workspace counts
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoStatus(url: string, repo: string, options: RequestOptions): Promise<RepositoryStatus> {
  return get(url, `/repos/${encodeURIComponent(repo)}/status`, RepositoryStatusType, options);
}

/**
 * Start garbage collection (async).
 *
 * Returns immediately with an executionId. Use repoGcStatus() to poll for completion.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param gcOptions - GC options (dryRun to preview without deleting)
 * @param options - Request options including auth token
 * @returns GC start result with executionId
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoGcStart(url: string, repo: string, gcOptions: GcRequest, options: RequestOptions): Promise<GcStartResult> {
  return post(url, `/repos/${encodeURIComponent(repo)}/gc`, gcOptions, GcRequestType, GcStartResultType, options);
}

/**
 * Get garbage collection status.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param executionId - Execution ID from repoGcStart()
 * @param options - Request options including auth token
 * @returns GC status with stats when complete
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoGcStatus(url: string, repo: string, executionId: string, options: RequestOptions): Promise<GcStatusResult> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/gc/${encodeURIComponent(executionId)}`,
    GcStatusResultType,
    options
  );
}

/**
 * Run garbage collection and wait for completion (convenience wrapper).
 *
 * Starts GC and polls until complete. Throws on error.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param gcOptions - GC options (dryRun to preview without deleting)
 * @param options - Request options including auth token
 * @param pollOptions - Polling options (interval in ms, default 500)
 * @returns GC result with counts and freed bytes
 */
export async function repoGc(
  url: string,
  repo: string,
  gcOptions: GcRequest,
  options: RequestOptions,
  pollOptions: { pollInterval?: number } = {}
): Promise<GcResult> {
  const pollInterval = pollOptions.pollInterval ?? 500;

  // Start GC
  const { executionId } = await repoGcStart(url, repo, gcOptions, options);

  // Poll until complete
  while (true) {
    const status = await repoGcStatus(url, repo, executionId, options);

    if (status.status.type === 'succeeded') {
      if (status.stats.type !== 'some') {
        throw new Error('GC succeeded but no stats returned');
      }
      return status.stats.value;
    }

    if (status.status.type === 'failed') {
      const errorMsg = status.error.type === 'some' ? status.error.value : 'Unknown error';
      throw new Error(`GC failed: ${errorMsg}`);
    }

    // Still running, wait and poll again
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/**
 * Create a new repository.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Name for the new repository
 * @param options - Request options including auth token
 * @returns The created repository name
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoCreate(url: string, name: string, options: RequestOptions): Promise<string> {
  return putEmpty(url, `/repos/${encodeURIComponent(name)}`, StringType, options);
}

/**
 * Remove a repository.
 *
 * Deletion is synchronous - refs are deleted immediately and orphaned objects
 * are cleaned up by GC later.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Repository name to remove
 * @param options - Request options including auth token
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoRemove(url: string, name: string, options: RequestOptions): Promise<void> {
  await del(url, `/repos/${encodeURIComponent(name)}`, NullType, options);
}

