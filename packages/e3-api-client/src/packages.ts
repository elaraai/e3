/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, BlobType, NullType } from '@elaraai/east';
import { PackageObjectType, type PackageObject } from '@elaraai/e3-types';
import type { PackageListItem, PackageImportResult } from './types.js';
import { PackageListItemType, PackageImportResultType } from './types.js';
import { get, post, del, type RequestOptions } from './http.js';

/**
 * List all packages in the repository.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param options - Request options including auth token
 * @returns Array of package info (name, version)
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function packageList(url: string, repo: string, options: RequestOptions): Promise<PackageListItem[]> {
  return get(url, `/repos/${encodeURIComponent(repo)}/packages`, ArrayType(PackageListItemType), options);
}

/**
 * Get package object.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Package name
 * @param version - Package version
 * @param options - Request options including auth token
 * @returns Package object
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function packageGet(
  url: string,
  repo: string,
  name: string,
  version: string,
  options: RequestOptions
): Promise<PackageObject> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    PackageObjectType,
    options
  );
}

/**
 * Import a package from a zip archive.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param archive - Zip archive as bytes
 * @param options - Request options including auth token
 * @returns Imported package info
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function packageImport(
  url: string,
  repo: string,
  archive: Uint8Array,
  options: RequestOptions
): Promise<PackageImportResult> {
  return post(url, `/repos/${encodeURIComponent(repo)}/packages`, archive, BlobType, PackageImportResultType, options);
}

/**
 * Export a package as a zip archive.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Package name
 * @param version - Package version
 * @param options - Request options including auth token
 * @returns Zip archive as bytes
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function packageExport(
  url: string,
  repo: string,
  name: string,
  version: string,
  options: RequestOptions
): Promise<Uint8Array> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}/export`,
    BlobType,
    options
  );
}

/**
 * Remove a package from the repository.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Package name
 * @param version - Package version
 * @param options - Request options including auth token
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function packageRemove(
  url: string,
  repo: string,
  name: string,
  version: string,
  options: RequestOptions
): Promise<void> {
  await del(
    url,
    `/repos/${encodeURIComponent(repo)}/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    NullType,
    options
  );
}
