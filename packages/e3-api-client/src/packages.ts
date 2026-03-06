/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType, encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import { PackageObjectType, type PackageObject } from '@elaraai/e3-types';
import {
  PackageTransferInitRequestType,
  PackageTransferInitResponseType,
  PackageExportRequestType,
  PackageJobResponseType,
  PackageJobStatusType,
  type PackageImportResult,
  type PackageJobStatus,
} from '@elaraai/e3-types';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-core';
import type { PackageListItem } from './types.js';
import { PackageListItemType } from './types.js';
import { ResponseType } from './types.js';
import { get, del, ApiError, AuthError, type RequestOptions, type Response } from './http.js';

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
 * Import a package from a zip archive using the transfer protocol.
 *
 * Flow: init upload → upload zip → trigger import → poll for result
 */
export async function packageImport(
  url: string,
  repo: string,
  archive: Uint8Array,
  options: RequestOptions
): Promise<PackageImportResult> {
  const repoEncoded = encodeURIComponent(repo);
  const authHeaders: Record<string, string> = {};
  if (options.token) {
    authHeaders['Authorization'] = `Bearer ${options.token}`;
  }

  // 1. Init transfer
  const encodeInit = encodeBeast2For(PackageTransferInitRequestType);
  const initRes = await fetch(`${url}/api/repos/${repoEncoded}/packages/transfer/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
      ...authHeaders,
    },
    body: encodeInit({ size: BigInt(archive.byteLength) }),
  });

  if (initRes.status === 401) throw new AuthError(await initRes.text());
  if (!initRes.ok) throw new Error(`Transfer init failed: ${initRes.status} ${initRes.statusText}`);

  const initBuffer = new Uint8Array(await initRes.arrayBuffer());
  const decodeInit = decodeBeast2For(ResponseType(PackageTransferInitResponseType));
  const initResult = decodeInit(initBuffer) as Response<{ transferId: string; uploadUrl: string }>;
  if (initResult.type === 'error') throw new ApiError(initResult.value.type, initResult.value.value);

  const { transferId, uploadUrl } = initResult.value;

  // 2. Upload zip bytes
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/zip',
      ...authHeaders,
    },
    body: archive,
  });

  if (!uploadRes.ok) throw new Error(`Transfer upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
  // Consume body to check for errors
  const uploadBuffer = new Uint8Array(await uploadRes.arrayBuffer());
  const decodeUpload = decodeBeast2For(ResponseType(NullType));
  const uploadResult = decodeUpload(uploadBuffer) as Response<null>;
  if (uploadResult.type === 'error') throw new ApiError(uploadResult.value.type, uploadResult.value.value);

  // 3. Trigger import
  const importRes = await fetch(`${url}/api/repos/${repoEncoded}/packages/transfer/${transferId}/import`, {
    method: 'POST',
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...authHeaders,
    },
  });

  if (!importRes.ok) throw new Error(`Transfer import failed: ${importRes.status} ${importRes.statusText}`);

  const importBuffer = new Uint8Array(await importRes.arrayBuffer());
  const decodeImport = decodeBeast2For(ResponseType(PackageJobResponseType));
  const importResult = decodeImport(importBuffer) as Response<{ jobId: string }>;
  if (importResult.type === 'error') throw new ApiError(importResult.value.type, importResult.value.value);

  const { jobId } = importResult.value;

  // 4. Poll for result
  const status = await pollJob(url, repoEncoded, jobId, authHeaders);

  if (status.type === 'failed') {
    throw new Error(`Package import failed: ${status.value.message}`);
  }
  if (status.type === 'completed' && status.value.type === 'import') {
    return status.value.value;
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
  const authHeaders: Record<string, string> = {};
  if (options.token) {
    authHeaders['Authorization'] = `Bearer ${options.token}`;
  }

  // 1. Trigger export
  const encodeExport = encodeBeast2For(PackageExportRequestType);
  const exportRes = await fetch(`${url}/api/repos/${repoEncoded}/packages/transfer/export`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
      ...authHeaders,
    },
    body: encodeExport({ name, version }),
  });

  if (exportRes.status === 401) throw new AuthError(await exportRes.text());
  if (!exportRes.ok) throw new Error(`Transfer export failed: ${exportRes.status} ${exportRes.statusText}`);

  const exportBuffer = new Uint8Array(await exportRes.arrayBuffer());
  const decodeExport = decodeBeast2For(ResponseType(PackageJobResponseType));
  const exportResult = decodeExport(exportBuffer) as Response<{ jobId: string }>;
  if (exportResult.type === 'error') throw new ApiError(exportResult.value.type, exportResult.value.value);

  const { jobId } = exportResult.value;

  // 2. Poll for result
  const status = await pollJob(url, repoEncoded, jobId, authHeaders);

  if (status.type === 'failed') {
    throw new Error(`Package export failed: ${status.value.message}`);
  }
  if (status.type !== 'completed' || status.value.type !== 'export') {
    throw new Error('Unexpected job status');
  }

  const { downloadUrl } = status.value.value;

  // 3. Download zip
  const downloadRes = await fetch(downloadUrl, {
    method: 'GET',
    headers: authHeaders,
  });

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
 * Poll a package job until it completes or fails.
 */
async function pollJob(
  url: string,
  repoEncoded: string,
  jobId: string,
  authHeaders: Record<string, string>,
  maxAttempts = 120,
  intervalMs = 500
): Promise<PackageJobStatus> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${url}/api/repos/${repoEncoded}/packages/transfer/jobs/${jobId}`, {
      method: 'GET',
      headers: {
        'Accept': BEAST2_CONTENT_TYPE,
        ...authHeaders,
      },
    });

    if (!res.ok) throw new Error(`Job poll failed: ${res.status} ${res.statusText}`);

    const buffer = new Uint8Array(await res.arrayBuffer());
    const decode = decodeBeast2For(ResponseType(PackageJobStatusType));
    const result = decode(buffer) as Response<PackageJobStatus>;
    if (result.type === 'error') throw new ApiError(result.value.type, result.value.value);

    if (result.value.type !== 'processing') {
      return result.value;
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('Package job timed out');
}
