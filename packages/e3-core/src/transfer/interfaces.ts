/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Transfer backend interfaces for presigned URL object transfer.
 *
 * TransferBackend is a separate top-level interface (not part of StorageBackend).
 * It provides cloud-agnostic abstractions for uploading/downloading datasets and
 * packages via presigned URLs. Implementations:
 * - InMemoryTransferBackend (local server, tests)
 * - S3DynamoTransferBackend (AWS cloud, future)
 */

import type { DatasetUpload, PackageImport, PackageExport } from './types.js';

// =============================================================================
// Dataset Upload Store
// =============================================================================

/**
 * Manages staged dataset uploads.
 *
 * Flow: create → getUploadUrl → (client uploads) → commitObject → delete
 */
export interface DatasetUploadStore {
  create(id: string, record: DatasetUpload): Promise<void>;
  get(id: string): Promise<DatasetUpload | null>;
  delete(id: string): Promise<void>;

  /**
   * URL the client PUTs bytes to. The upload ID is embedded in the URL
   * so concurrent uploads to the same hash are unambiguous.
   */
  getUploadUrl(id: string, repo: string, hash: string): Promise<string>;

  /**
   * Verify the upload and make the object visible in the catalogue.
   * On success, the object is queryable via storage.objects.read(repo, hash).
   * On failure, throws — caller should clean up the transfer record.
   */
  commitObject(repo: string, hash: string, uploadId: string): Promise<void>;
}

// =============================================================================
// Dataset Download Store
// =============================================================================

/**
 * Generates download URLs for dataset objects.
 *
 * Local: creates temporary records so `/api/downloads/:id` can look up the object.
 * Cloud: returns presigned S3 URLs directly; `get`/`delete` are never called.
 */
export interface DatasetDownloadStore {
  /** Create a temporary download record and return the URL. */
  getDownloadUrl(repo: string, hash: string): Promise<string>;
  /** Look up a download record by ID (for local server data handlers). */
  get(id: string): Promise<{ repo: string; hash: string } | null>;
  /** Clean up after serving. */
  delete(id: string): Promise<void>;
}

// =============================================================================
// Package Import Store
// =============================================================================

/**
 * Manages package import lifecycle: upload zip → process → poll completion.
 *
 * Flow: create → getUploadUrl → (client uploads) → execute → poll get → delete
 */
export interface PackageImportStore {
  create(id: string, record: PackageImport): Promise<void>;
  get(id: string): Promise<PackageImport | null>;
  updateStatus(id: string, status: PackageImport['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /** URL the client PUTs zip bytes to. */
  getUploadUrl(id: string, repo: string): Promise<string>;

  /**
   * Dispatch processing.
   * Local: calls packageImport() inline, updates status to completed/failed.
   * Cloud: invokes background processor asynchronously.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Package Export Store
// =============================================================================

/**
 * Manages package export lifecycle: trigger → process → poll → download.
 *
 * Flow: create → execute → poll get → getDownloadUrl → delete
 */
export interface PackageExportStore {
  create(id: string, record: PackageExport): Promise<void>;
  get(id: string): Promise<PackageExport | null>;
  updateStatus(id: string, status: PackageExport['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /** URL the client GETs zip bytes from. */
  getDownloadUrl(id: string, repo: string): Promise<string>;

  /**
   * Dispatch processing.
   * Local: calls packageExport() inline, updates status to completed/failed.
   * Cloud: invokes background processor asynchronously.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Transfer Backend
// =============================================================================

/**
 * Cloud-agnostic transfer backend for presigned URL object transfer.
 *
 * Separate from StorageBackend — depends on it for actual object/ref operations
 * but has its own lifecycle (staging, jobs, URLs).
 */
export interface TransferBackend {
  readonly datasetUpload: DatasetUploadStore;
  readonly datasetDownload: DatasetDownloadStore;
  readonly packageImport: PackageImportStore;
  readonly packageExport: PackageExportStore;
}
