/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * In-memory TransferBackend implementation.
 *
 * Stores transfer records in memory Maps. When `storage` and `getRepoPath`
 * are provided, `execute()` performs real background processing via the
 * shared handlers. Without them, falls back to mock behavior for tests.
 */

/* eslint-disable @typescript-eslint/require-await */
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { variant } from '@elaraai/east';

import type { StorageBackend } from '../storage/index.js';
import type {
  TransferBackend,
  DatasetUploadStore,
  DatasetDownloadStore,
  PackageImportStore,
  PackageExportStore,
} from './interfaces.js';
import type { DatasetUpload, PackageImport, PackageExport } from './types.js';
import { handleProcessExport } from './process.js';
import { handleProcessImport } from './process.js';

const STAGING_DIR = join(tmpdir(), 'e3-transfers');

// =============================================================================
// Dataset Upload
// =============================================================================

class InMemoryDatasetUploadStore implements DatasetUploadStore {
  private readonly records = new Map<string, DatasetUpload>();

  constructor(private readonly baseUrl: string) {}

  async create(id: string, record: DatasetUpload): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<DatasetUpload | null> {
    return this.records.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async getUploadUrl(id: string, _repo: string, _hash: string): Promise<string> {
    return `${this.baseUrl}/api/uploads/${id}`;
  }

  async commitObject(_repo: string, _hash: string, uploadId: string): Promise<void> {
    // Mock — just remove the record. Real verification happens in integration tests.
    this.records.delete(uploadId);
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Dataset Download
// =============================================================================

class InMemoryDatasetDownloadStore implements DatasetDownloadStore {
  private readonly records = new Map<string, { repo: string; hash: string }>();

  constructor(private readonly baseUrl: string) {}

  async getDownloadUrl(repo: string, hash: string): Promise<string> {
    const id = randomUUID();
    this.records.set(id, { repo, hash });
    return `${this.baseUrl}/api/downloads/${id}`;
  }

  async get(id: string): Promise<{ repo: string; hash: string } | null> {
    return this.records.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Package Import
// =============================================================================

class InMemoryPackageImportStore implements PackageImportStore {
  private readonly records = new Map<string, PackageImport>();

  constructor(
    private readonly baseUrl: string,
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
  ) {}

  async create(id: string, record: PackageImport): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<PackageImport | null> {
    return this.records.get(id) ?? null;
  }

  async updateStatus(id: string, status: PackageImport['status']): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package import ${id} not found`);
    this.records.set(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async getUploadUrl(id: string, _repo: string): Promise<string> {
    return `${this.baseUrl}/api/uploads/${id}`;
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package import ${id} not found`);

    if (!this.storage || !this.getRepoPath) {
      // Mock fallback for tests that don't provide storage
      await this.updateStatus(id, variant('completed', {
        name: 'mock',
        version: '0.0.0',
        packageHash: 'mock',
        objectCount: 0n,
      }));
      return;
    }

    const zipPath = join(STAGING_DIR, `${id}.zip.partial`);
    await mkdir(STAGING_DIR, { recursive: true });
    void handleProcessImport(
      { storage: this.storage, importStore: this },
      { id, repo: this.getRepoPath(repo), zipPath },
    ).catch(() => {}); // errors captured in status by handler
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Package Export
// =============================================================================

class InMemoryPackageExportStore implements PackageExportStore {
  private readonly records = new Map<string, PackageExport>();

  constructor(
    private readonly baseUrl: string,
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
  ) {}

  async create(id: string, record: PackageExport): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<PackageExport | null> {
    return this.records.get(id) ?? null;
  }

  async updateStatus(id: string, status: PackageExport['status']): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package export ${id} not found`);
    this.records.set(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async getDownloadUrl(id: string, _repo: string): Promise<string> {
    return `${this.baseUrl}/api/downloads/${id}`;
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package export ${id} not found`);

    if (!this.storage || !this.getRepoPath) {
      // Mock fallback for tests that don't provide storage
      await this.updateStatus(id, variant('completed', { size: 0n }));
      return;
    }

    const zipPath = join(STAGING_DIR, `${id}.zip`);
    await mkdir(STAGING_DIR, { recursive: true });
    void handleProcessExport(
      { storage: this.storage, exportStore: this },
      { id, repo: this.getRepoPath(repo), zipPath },
    ).catch(() => {}); // errors captured in status by handler
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Transfer Backend
// =============================================================================

export interface InMemoryTransferBackendOptions {
  baseUrl?: string;
  storage?: StorageBackend;
  getRepoPath?: (repo: string) => string;
}

export class InMemoryTransferBackend implements TransferBackend {
  readonly datasetUpload: InMemoryDatasetUploadStore;
  readonly datasetDownload: InMemoryDatasetDownloadStore;
  readonly packageImport: InMemoryPackageImportStore;
  readonly packageExport: InMemoryPackageExportStore;

  constructor(options: InMemoryTransferBackendOptions) {
    const baseUrl = options.baseUrl ?? '';
    this.datasetUpload = new InMemoryDatasetUploadStore(baseUrl);
    this.datasetDownload = new InMemoryDatasetDownloadStore(baseUrl);
    this.packageImport = new InMemoryPackageImportStore(baseUrl, options.storage, options.getRepoPath);
    this.packageExport = new InMemoryPackageExportStore(baseUrl, options.storage, options.getRepoPath);
  }

  clear(): void {
    this.datasetUpload.clear();
    this.datasetDownload.clear();
    this.packageImport.clear();
    this.packageExport.clear();
  }
}
