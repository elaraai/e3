/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType, encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import { PackageObjectType, type PackageObject } from '@elaraai/e3-types';
import {
  PackageTransferInitRequestType,
  PackageTransferInitResponseType,
  PackageJobResponseType,
  PackageImportStatusType,
  PackageExportStatusType,
  type PackageImportProgress,
  type PackageImportResult,
  type PackageImportStatus,
  type PackageExportStatus,
} from '@elaraai/e3-types';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-core';
import type { PackageListItem } from './types.js';
import { PackageListItemType } from './types.js';
import { ResponseType } from './types.js';
import { get, del, fetchWithAuth, ApiError, type RequestOptions, type Response } from './http.js';

/**
 * List all packages in the repository.
 */
export async function packageList(url: string, repo: string, options: RequestOptions): Promise<PackageListItem[]> {
  return get(url, `/repos/${encodeURIComponent(repo)}/packages`, ArrayType(PackageListItemType), options);
}

/**
 * Get package object.
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
 * Options for package import progress reporting.
 */
export interface PackageImportOptions {
  onProgress?: (progress: PackageImportProgress) => void;
  onUploadProgress?: (uploaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Import a package from a zip archive using the transfer protocol.
 *
 * Flow: init upload → upload zip → trigger import → poll for result
 */
export async function packageImport(
  url: string,
  repo: string,
  archive: Uint8Array,
  options: RequestOptions,
  importOptions?: PackageImportOptions,
): Promise<PackageImportResult> {
  const repoEncoded = encodeURIComponent(repo);
  const signal = importOptions?.signal;

  // 1. Init transfer
  const encodeInit = encodeBeast2For(PackageTransferInitRequestType);
  const initRes = await fetchWithAuth(`${url}/api/repos/${repoEncoded}/import`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
    },
    body: encodeInit({ size: BigInt(archive.byteLength) }),
    signal,
  }, options);

  if (!initRes.ok) throw new Error(`Transfer init failed: ${initRes.status} ${initRes.statusText}`);

  const initBuffer = new Uint8Array(await initRes.arrayBuffer());
  const decodeInit = decodeBeast2For(ResponseType(PackageTransferInitResponseType));
  const initResult = decodeInit(initBuffer) as Response<{ id: string; uploadUrl: string }>;
  if (initResult.type === 'error') throw new ApiError(initResult.value.type, initResult.value.value);

  const { id, uploadUrl } = initResult.value;

  // 2. Upload zip bytes (no auth — URL may be a presigned S3 URL)
  const onUploadProgress = importOptions?.onUploadProgress;
  const uploadBody = onUploadProgress
    ? createProgressStream(archive, onUploadProgress)
    : archive;
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(archive.byteLength),
    },
    body: uploadBody,
    signal,
    duplex: onUploadProgress ? 'half' as const : undefined,
  });

  if (!uploadRes.ok) throw new Error(`Transfer upload failed: ${uploadRes.status} ${uploadRes.statusText}`);

  // 3. Trigger import
  const importRes = await fetchWithAuth(`${url}/api/repos/${repoEncoded}/import/${id}`, {
    method: 'POST',
    headers: { 'Accept': BEAST2_CONTENT_TYPE },
    signal,
  }, options);

  if (!importRes.ok) throw new Error(`Transfer import failed: ${importRes.status} ${importRes.statusText}`);

  const importBuffer = new Uint8Array(await importRes.arrayBuffer());
  const decodeImport = decodeBeast2For(ResponseType(PackageJobResponseType));
  const importResult = decodeImport(importBuffer) as Response<{ id: string }>;
  if (importResult.type === 'error') throw new ApiError(importResult.value.type, importResult.value.value);

  // 4. Poll for result
  const status = await pollImport(url, repoEncoded, importResult.value.id, options, importOptions?.onProgress, signal);

  if (status.type === 'failed') {
    throw new Error(`Package import failed: ${status.value.message}`);
  }
  if (status.type === 'completed') {
    return status.value;
  }
  throw new Error('Unexpected job status');
}

/**
 * Export a package as a zip archive using the transfer protocol.
 *
 * Flow: trigger export → poll for result → download zip
 */
export async function packageExport(
  url: string,
  repo: string,
  name: string,
  version: string,
  options: RequestOptions
): Promise<Uint8Array> {
  const repoEncoded = encodeURIComponent(repo);

  // 1. Trigger export (name/version in URL, no body)
  const exportRes = await fetchWithAuth(
    `${url}/api/repos/${repoEncoded}/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}/export`, {
    method: 'POST',
    headers: { 'Accept': BEAST2_CONTENT_TYPE },
  }, options);

  if (!exportRes.ok) throw new Error(`Transfer export failed: ${exportRes.status} ${exportRes.statusText}`);

  const exportBuffer = new Uint8Array(await exportRes.arrayBuffer());
  const decodeExport = decodeBeast2For(ResponseType(PackageJobResponseType));
  const exportResult = decodeExport(exportBuffer) as Response<{ id: string }>;
  if (exportResult.type === 'error') throw new ApiError(exportResult.value.type, exportResult.value.value);

  // 2. Poll for result
  const status = await pollExport(url, repoEncoded, exportResult.value.id, options);

  if (status.type === 'failed') {
    throw new Error(`Package export failed: ${status.value.message}`);
  }
  if (status.type !== 'completed') {
    throw new Error('Unexpected job status');
  }

  const { downloadUrl } = status.value;

  // 3. Download zip (no auth — URL may be a presigned S3 URL)
  const downloadRes = await fetch(downloadUrl, { method: 'GET' });

  if (!downloadRes.ok) throw new Error(`Download failed: ${downloadRes.status} ${downloadRes.statusText}`);

  return new Uint8Array(await downloadRes.arrayBuffer());
}

/**
 * Remove a package from the repository.
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

/**
 * Wrap a Uint8Array in a ReadableStream that reports upload progress.
 */
function createProgressStream(
  data: Uint8Array,
  onProgress: (uploaded: number, total: number) => void,
  chunkSize = 64 * 1024,
): ReadableStream<Uint8Array> {
  const total = data.byteLength;
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= total) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, total);
      controller.enqueue(data.subarray(offset, end));
      offset = end;
      onProgress(offset, total);
    },
  });
}

/**
 * Poll a package import job until it completes or fails.
 */
async function pollImport(
  url: string,
  repoEncoded: string,
  id: string,
  options: RequestOptions,
  onProgress?: (progress: PackageImportProgress) => void,
  signal?: AbortSignal,
  intervalMs = 1000,
): Promise<PackageImportStatus> {
  while (true) {
    signal?.throwIfAborted();
    const res = await fetchWithAuth(`${url}/api/repos/${repoEncoded}/import/${id}`, {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
      signal,
    }, options);

    if (!res.ok) throw new Error(`Import poll failed: ${res.status} ${res.statusText}`);

    const buffer = new Uint8Array(await res.arrayBuffer());
    const decode = decodeBeast2For(ResponseType(PackageImportStatusType));
    const result = decode(buffer) as Response<PackageImportStatus>;
    if (result.type === 'error') throw new ApiError(result.value.type, result.value.value);

    if (result.value.type === 'processing') {
      onProgress?.(result.value.value);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    return result.value;
  }
}

/**
 * Poll a package export job until it completes or fails.
 */
async function pollExport(
  url: string,
  repoEncoded: string,
  id: string,
  options: RequestOptions,
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
    const result = decode(buffer) as Response<PackageExportStatus>;
    if (result.type === 'error') throw new ApiError(result.value.type, result.value.value);

    if (result.value.type !== 'processing') {
      return result.value;
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
