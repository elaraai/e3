/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Shared processing handlers for package import/export.
 *
 * These are cloud-agnostic handlers that perform the actual import/export work.
 * Used by both the local InMemoryTransferBackend and cloud backends
 * (e.g. AWS Lambda/Step Functions).
 */

import { stat, unlink } from 'node:fs/promises';
import { variant } from '@elaraai/east';

import { packageExport } from '../packages.js';
import { workspaceExport } from '../workspaces.js';
import { packageImport } from '../packages.js';
import type { StorageBackend } from '../storage/index.js';
import type { PackageExportStore, PackageImportStore } from './interfaces.js';

// =============================================================================
// Throttled progress callback
// =============================================================================

/**
 * Creates a progress callback that throttles updates to at most once per interval.
 *
 * @param fn - The function to call with throttled updates
 * @param intervalMs - Minimum interval between calls in milliseconds
 * @returns A throttled version of the progress callback
 */
function throttledProgress(
  fn: (progress: { objectsProcessed: number }) => Promise<void>,
  intervalMs = 1000,
) {
  let lastCall = 0;
  let pending: { objectsProcessed: number } | null = null;

  const throttled = async (progress: { objectsProcessed: number }) => {
    const now = Date.now();
    if (now - lastCall >= intervalMs) {
      lastCall = now;
      pending = null;
      await fn(progress);
    } else {
      pending = progress;
    }
  };

  throttled.flush = async () => {
    if (pending) {
      await fn(pending);
      pending = null;
    }
  };

  return throttled;
}

// =============================================================================
// Process Export
// =============================================================================

/** Dependencies for handleProcessExport. */
export interface ProcessExportDeps {
  storage: StorageBackend;
  exportStore: PackageExportStore;
}

/** Input for handleProcessExport. */
export interface ProcessExportInput {
  id: string;
  repo: string;
  zipPath: string;
}

/**
 * Processes a package or workspace export job.
 *
 * Gets the export record, determines whether this is a package or workspace
 * export (based on the `workspace` field), runs the appropriate export
 * function, and updates the status to completed or failed.
 *
 * @param deps - Storage backend and export store
 * @param input - Job ID, repository path, and output zip path
 *
 * @throws Re-throws errors after updating status to failed and cleaning up
 */
export async function handleProcessExport(
  deps: ProcessExportDeps,
  input: ProcessExportInput,
): Promise<void> {
  const { storage, exportStore } = deps;
  const { id, repo, zipPath } = input;

  const record = await exportStore.get(id);
  if (!record) throw new Error(`Export record ${id} not found`);

  const onProgress = throttledProgress(async ({ objectsProcessed }) => {
    await exportStore.updateStatus(id,
      variant('processing', variant('exporting', { objectsProcessed: BigInt(objectsProcessed) })));
  });

  try {
    if (record.workspace.type === 'some') {
      await workspaceExport(storage, repo, record.workspace.value, zipPath, record.name, record.version, {
        onProgress,
      });
    } else {
      await packageExport(storage, repo, record.name, record.version, zipPath, {
        onProgress,
      });
    }
    await onProgress.flush();
    const fileStat = await stat(zipPath);
    await exportStore.updateStatus(id, variant('completed', {
      size: BigInt(fileStat.size),
    }));
  } catch (err) {
    await unlink(zipPath).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    await exportStore.updateStatus(id, variant('failed', { message }));
    throw err;
  }
}

// =============================================================================
// Process Import
// =============================================================================

/** Dependencies for handleProcessImport. */
export interface ProcessImportDeps {
  storage: StorageBackend;
  importStore: PackageImportStore;
}

/** Input for handleProcessImport. */
export interface ProcessImportInput {
  id: string;
  repo: string;
  zipPath: string;
}

/**
 * Processes a package import job.
 *
 * Gets the import record, verifies the file size matches, runs packageImport,
 * and updates the status to completed or failed. Cleans up the staging zip
 * file in all cases.
 *
 * @param deps - Storage backend and import store
 * @param input - Job ID, repository path, and staging zip path
 *
 * @throws Re-throws errors after updating status to failed
 */
export async function handleProcessImport(
  deps: ProcessImportDeps,
  input: ProcessImportInput,
): Promise<void> {
  const { storage, importStore } = deps;
  const { id, repo, zipPath } = input;

  const record = await importStore.get(id);
  if (!record) throw new Error(`Import record ${id} not found`);

  // Verify file size matches
  const fileStat = await stat(zipPath);
  if (BigInt(fileStat.size) !== record.size) {
    const message = `size mismatch: expected ${record.size}, got ${fileStat.size}`;
    await importStore.updateStatus(id, variant('failed', { message }));
    await unlink(zipPath).catch(() => {});
    throw new Error(message);
  }

  try {
    const onProgress = throttledProgress(async ({ objectsProcessed }) => {
      await importStore.updateStatus(id,
        variant('processing', variant('importing', { objectsProcessed: BigInt(objectsProcessed) })));
    });

    const result = await packageImport(storage, repo, zipPath, {
      onProgress,
    });

    await onProgress.flush();
    await importStore.updateStatus(id, variant('completed', {
      name: result.name,
      version: result.version,
      packageHash: result.packageHash,
      objectCount: BigInt(result.objectCount),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await importStore.updateStatus(id, variant('failed', { message }));
    throw err;
  } finally {
    await unlink(zipPath).catch(() => {});
  }
}
