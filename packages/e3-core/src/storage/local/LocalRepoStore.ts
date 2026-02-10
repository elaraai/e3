/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  RepoStore,
  RepoStatus,
  RepoMetadata,
  BatchResult,
  GcObjectEntry,
  GcObjectScanResult,
  GcRootScanResult,
} from '../interfaces.js';
import type { RefStore } from '../interfaces.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';
import { decodeBeast2For } from '@elaraai/east';
import { WorkspaceStateType } from '@elaraai/e3-types';

/**
 * Metadata file format stored in each repository.
 */
interface MetadataFile {
  name: string;
  status: RepoStatus;
  createdAt: string;
  statusChangedAt: string;
}

const METADATA_FILENAME = '.e3-metadata.json';

/**
 * Local filesystem implementation of RepoStore.
 *
 * Manages repository lifecycle for local e3 repositories stored
 * as subdirectories within a parent directory.
 */
export class LocalRepoStore implements RepoStore {
  /**
   * Create a new LocalRepoStore.
   * @param reposDir - Parent directory containing repositories
   * @param refs - RefStore for reading package/workspace/execution refs
   */
  constructor(
    private readonly reposDir: string,
    private readonly refs: RefStore
  ) {}

  /**
   * Get the path to a repository directory.
   */
  private getRepoPath(repo: string): string {
    return path.join(this.reposDir, repo);
  }

  /**
   * Get the path to a repository's metadata file.
   */
  private getMetadataPath(repo: string): string {
    return path.join(this.getRepoPath(repo), METADATA_FILENAME);
  }

  /**
   * Check if a directory is a valid e3 repository.
   */
  private async isValidRepository(repoPath: string): Promise<boolean> {
    const requiredDirs = ['objects', 'packages', 'executions', 'workspaces'];
    for (const dir of requiredDirs) {
      try {
        const stat = await fs.stat(path.join(repoPath, dir));
        if (!stat.isDirectory()) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  async list(): Promise<string[]> {
    const repos: string[] = [];
    try {
      const entries = await fs.readdir(this.reposDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const repoPath = path.join(this.reposDir, entry.name);
          if (await this.isValidRepository(repoPath)) {
            repos.push(entry.name);
          }
        }
      }
    } catch {
      // reposDir doesn't exist or can't be read
    }
    return repos;
  }

  async exists(repo: string): Promise<boolean> {
    const repoPath = this.getRepoPath(repo);
    return this.isValidRepository(repoPath);
  }

  async getMetadata(repo: string): Promise<RepoMetadata | null> {
    const repoPath = this.getRepoPath(repo);

    // Check if repo exists
    if (!(await this.isValidRepository(repoPath))) {
      return null;
    }

    const metadataPath = this.getMetadataPath(repo);
    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(content) as MetadataFile;
      return {
        name: metadata.name,
        status: metadata.status,
        createdAt: metadata.createdAt,
        statusChangedAt: metadata.statusChangedAt,
      };
    } catch {
      // No metadata file - synthesize for legacy repos
      // Get mtime from repo directory for createdAt
      try {
        const stat = await fs.stat(repoPath);
        const createdAt = stat.birthtime.toISOString();
        return {
          name: repo,
          status: 'active',
          createdAt,
          statusChangedAt: createdAt,
        };
      } catch {
        return null;
      }
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async create(repo: string): Promise<void> {
    const repoPath = this.getRepoPath(repo);

    // Check if already exists
    if (await this.isValidRepository(repoPath)) {
      throw new RepoAlreadyExistsError(repo);
    }

    // Create directory structure
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(path.join(repoPath, 'objects'), { recursive: true });
    await fs.mkdir(path.join(repoPath, 'packages'), { recursive: true });
    await fs.mkdir(path.join(repoPath, 'executions'), { recursive: true });
    await fs.mkdir(path.join(repoPath, 'workspaces'), { recursive: true });

    // Write metadata file
    const now = new Date().toISOString();
    const metadata: MetadataFile = {
      name: repo,
      status: 'active',
      createdAt: now,
      statusChangedAt: now,
    };
    await fs.writeFile(
      this.getMetadataPath(repo),
      JSON.stringify(metadata, null, 2)
    );
  }

  async setStatus(
    repo: string,
    status: RepoStatus,
    expected?: RepoStatus | RepoStatus[]
  ): Promise<void> {
    const current = await this.getMetadata(repo);
    if (!current) {
      throw new RepoNotFoundError(repo);
    }

    // Check expected status (CAS)
    if (expected !== undefined) {
      const expectedArray = Array.isArray(expected) ? expected : [expected];
      if (!expectedArray.includes(current.status)) {
        throw new RepoStatusConflictError(repo, expected, current.status);
      }
    }

    // Update metadata
    const now = new Date().toISOString();
    const metadata: MetadataFile = {
      name: current.name,
      status,
      createdAt: current.createdAt,
      statusChangedAt: now,
    };

    // Atomic write using rename
    const metadataPath = this.getMetadataPath(repo);
    const tempPath = `${metadataPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2));
    await fs.rename(tempPath, metadataPath);
  }

  async remove(repo: string): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    try {
      // Remove the entire repository directory
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch {
      // Ignore errors if directory doesn't exist
    }
  }

  // ===========================================================================
  // Batched Deletion
  // ===========================================================================

  async deleteRefsBatch(repo: string, _cursor?: string): Promise<BatchResult> {
    const repoPath = this.getRepoPath(repo);
    let deleted = 0;

    // For local storage, we delete all refs in one pass
    // (packages/, workspaces/, executions/, locks/)
    const refDirs = ['packages', 'workspaces', 'executions', 'locks'];

    for (const dir of refDirs) {
      const dirPath = path.join(repoPath, dir);
      try {
        deleted += await this.deleteDirectoryContents(dirPath);
      } catch {
        // Directory doesn't exist
      }
    }

    return { status: 'done', deleted };
  }

  async deleteObjectsBatch(repo: string, _cursor?: string): Promise<BatchResult> {
    const repoPath = this.getRepoPath(repo);
    const objectsDir = path.join(repoPath, 'objects');
    let deleted = 0;

    try {
      deleted = await this.deleteDirectoryContents(objectsDir);
    } catch {
      // objects dir doesn't exist
    }

    return { status: 'done', deleted };
  }

  /**
   * Recursively delete all contents of a directory.
   * Returns count of files deleted.
   */
  private async deleteDirectoryContents(dir: string): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          count += await this.deleteDirectoryContents(entryPath);
          await fs.rmdir(entryPath);
        } else {
          await fs.unlink(entryPath);
          count++;
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return count;
  }

  // ===========================================================================
  // GC Primitives
  // ===========================================================================

  // Note: GC primitives receive `repo` as a full path (same as ObjectStore/RefStore),
  // NOT as a repo name relative to reposDir. This is consistent with how all
  // storage interfaces work in the local implementation.

  async gcScanPackageRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];
    const packages = await this.refs.packageList(repo);
    for (const { name, version } of packages) {
      const hash = await this.refs.packageResolve(repo, name, version);
      if (hash) {
        roots.push(hash);
      }
    }
    return { roots };
  }

  async gcScanWorkspaceRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];
    const decoder = decodeBeast2For(WorkspaceStateType);
    const names = await this.refs.workspaceList(repo);
    for (const name of names) {
      const data = await this.refs.workspaceRead(repo, name);
      if (!data || data.length === 0) continue;
      try {
        const state = decoder(data);
        roots.push(state.packageHash);
        roots.push(state.rootHash);
      } catch {
        // Corrupt workspace state - skip
      }
    }
    return { roots };
  }

  async gcScanExecutionRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];
    const entries = await this.refs.executionList(repo);
    for (const { taskHash, inputsHash } of entries) {
      const ids = await this.refs.executionListIds(repo, taskHash, inputsHash);
      for (const executionId of ids) {
        const status = await this.refs.executionGet(repo, taskHash, inputsHash, executionId);
        if (!status) continue;
        // ExecutionStatus is a variant; extract outputHash from success
        const raw = status as unknown as { type: string; value: { outputHash?: string } };
        if (raw.type === 'success' && raw.value.outputHash && /^[a-f0-9]{64}$/.test(raw.value.outputHash)) {
          roots.push(raw.value.outputHash);
        }
      }
    }
    return { roots };
  }

  async gcScanObjects(repo: string, _cursor?: unknown): Promise<GcObjectScanResult> {
    const objectsDir = path.join(repo, 'objects');
    const objects: GcObjectEntry[] = [];

    try {
      const subdirs = await fs.readdir(objectsDir);
      for (const subdir of subdirs) {
        if (!/^[a-f0-9]{2}$/.test(subdir)) continue;
        const subdirPath = path.join(objectsDir, subdir);
        try {
          const stat = await fs.stat(subdirPath);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }
        const files = await fs.readdir(subdirPath);
        for (const file of files) {
          if (file.endsWith('.partial')) continue;
          if (!file.endsWith('.beast2')) continue;
          const hash = subdir + file.slice(0, -7); // remove .beast2
          try {
            const fileStat = await fs.stat(path.join(subdirPath, file));
            objects.push({ hash, lastModified: fileStat.mtimeMs, size: fileStat.size });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Objects directory doesn't exist
    }

    // Local returns all in one batch (no cursor)
    return { objects };
  }

  async gcDeleteObjects(repo: string, hashes: string[]): Promise<void> {
    const objectsDir = path.join(repo, 'objects');

    for (const hash of hashes) {
      const subdir = hash.slice(0, 2);
      const rest = hash.slice(2);
      const filePath = path.join(objectsDir, subdir, `${rest}.beast2`);
      try {
        await fs.unlink(filePath);
      } catch {
        // File doesn't exist
      }
      // Try to remove empty subdirectory
      try {
        await fs.rmdir(path.join(objectsDir, subdir));
      } catch {
        // Directory not empty or doesn't exist
      }
    }
  }
}
