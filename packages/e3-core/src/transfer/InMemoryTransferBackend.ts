/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * In-memory TransferBackend implementation.
 *
 * Pure in-memory — no filesystem access. Package import/export execute as
 * simplified mocks (trust hash, return placeholder results). Real transfer
 * flows are tested via integration tests against the actual server.
 */

import { randomUUID } from 'node:crypto';
import { variant } from '@elaraai/east';

import type {
  TransferBackend,
  DatasetUploadStore,
  DatasetDownloadStore,
  PackageImportStore,
  PackageExportStore,
} from './interfaces.js';
import type { DatasetUpload, PackageImport, PackageExport } from './types.js';

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

  async getUploadUrl(id: string, repo: string, hash: string): Promise<string> {
    return `${this.baseUrl}/api/uploads/${id}`;
  }

  async commitObject(repo: string, hash: string, uploadId: string): Promise<void> {
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

  constructor(private readonly baseUrl: string) {}

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

  async getUploadUrl(id: string, repo: string): Promise<string> {
    return `${this.baseUrl}/api/uploads/${id}`;
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package import ${id} not found`);

    await this.updateStatus(id, variant('completed', {
      name: 'mock',
      version: '0.0.0',
      packageHash: 'mock',
      objectCount: 0n,
    }));
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

  constructor(private readonly baseUrl: string) {}

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

  async getDownloadUrl(id: string, repo: string): Promise<string> {
    return `${this.baseUrl}/api/downloads/${id}`;
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package export ${id} not found`);

    await this.updateStatus(id, variant('completed', { size: 0n }));
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
    this.packageImport = new InMemoryPackageImportStore(baseUrl);
    this.packageExport = new InMemoryPackageExportStore(baseUrl);
  }

  clear(): void {
    this.datasetUpload.clear();
    this.datasetDownload.clear();
    this.packageImport.clear();
    this.packageExport.clear();
  }
}
