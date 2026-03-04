/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem implementation of DatasetRefStore.
 *
 * Stores per-dataset refs as .ref files in the workspace data directory:
 *   workspaces/<ws>/data/<path>.ref
 *
 * Each .ref file contains a beast2-encoded DatasetRef variant.
 * Writes are atomic (write to .partial, then rename).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import { DatasetRefType, type DatasetRef } from '@elaraai/e3-types';
import type { DatasetRefStore } from '../interfaces.js';

const encodeRef = encodeBeast2For(DatasetRefType);
const decodeRef = decodeBeast2For(DatasetRefType);

export class LocalDatasetRefStore implements DatasetRefStore {
  /**
   * Get the filesystem path for a dataset ref file.
   */
  private refPath(repo: string, ws: string, datasetPath: string): string {
    return path.join(repo, 'workspaces', ws, 'data', `${datasetPath}.ref`);
  }

  async read(repo: string, ws: string, datasetPath: string): Promise<DatasetRef | null> {
    const filePath = this.refPath(repo, ws, datasetPath);
    try {
      const data = await fs.readFile(filePath);
      if (data.length === 0) return null;
      return decodeRef(data);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(repo: string, ws: string, datasetPath: string, ref: DatasetRef): Promise<void> {
    const filePath = this.refPath(repo, ws, datasetPath);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write: write to unique staging file, then rename
    // Use random suffix to avoid collisions with concurrent writes
    const randomSuffix = Math.random().toString(36).slice(2, 10);
    const stagingPath = `${filePath}.${Date.now()}.${randomSuffix}.partial`;
    const data = encodeRef(ref);
    await fs.writeFile(stagingPath, data);
    try {
      await fs.rename(stagingPath, filePath);
    } catch (err) {
      // Clean up staging file on failure
      try { await fs.unlink(stagingPath); } catch { /* ignore */ }
      throw err;
    }
  }

  async list(repo: string, ws: string): Promise<string[]> {
    const dataDir = path.join(repo, 'workspaces', ws, 'data');
    const paths: string[] = [];

    try {
      await this.walkDir(dataDir, dataDir, paths);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    return paths;
  }

  /**
   * Recursively walk a directory collecting .ref file paths.
   */
  private async walkDir(baseDir: string, currentDir: string, results: string[]): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(baseDir, fullPath, results);
      } else if (entry.name.endsWith('.ref') && !entry.name.includes('.partial')) {
        // Convert filesystem path back to dataset path
        // Remove base dir prefix, leading separator, and .ref suffix
        const relative = path.relative(baseDir, fullPath);
        const datasetPath = relative.slice(0, -4); // remove .ref
        results.push(datasetPath);
      }
    }
  }

  async remove(repo: string, ws: string, datasetPath: string): Promise<void> {
    const filePath = this.refPath(repo, ws, datasetPath);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return; // Already removed
      throw err;
    }
  }

  async removeAll(repo: string, ws: string): Promise<void> {
    const dataDir = path.join(repo, 'workspaces', ws, 'data');
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return; // Already removed
      throw err;
    }
  }
}
