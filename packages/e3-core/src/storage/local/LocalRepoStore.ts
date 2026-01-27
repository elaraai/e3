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
  GcMarkResult,
  GcSweepResult,
  StorageBackend,
} from '../interfaces.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';

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
   * In-memory cache for reachable sets during GC.
   * Key: reachableSetRef, Value: Set of reachable hashes
   */
  private gcReachableSets = new Map<string, Set<string>>();

  /**
   * Create a new LocalRepoStore.
   * @param reposDir - Parent directory containing repositories
   * @param storage - Storage backend (for GC that needs object access)
   */
  constructor(
    private readonly reposDir: string,
    private readonly storage: StorageBackend
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
  // GC Phases
  // ===========================================================================

  async gcMark(repo: string): Promise<GcMarkResult> {
    const repoPath = this.getRepoPath(repo);

    // Collect roots from packages, executions, workspaces
    const roots = await collectRoots(repoPath);

    // Mark all reachable objects
    const reachable = new Set<string>();
    for (const root of roots) {
      await this.markReachable(repo, root, reachable);
    }

    // Store reachable set in memory
    const refId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.gcReachableSets.set(refId, reachable);

    return {
      reachableCount: reachable.size,
      rootCount: roots.size,
      reachableSetRef: refId,
    };
  }

  async gcSweep(
    repo: string,
    reachableSetRef: string,
    options?: { minAge?: number; cursor?: string }
  ): Promise<GcSweepResult> {
    const reachable = this.gcReachableSets.get(reachableSetRef);
    if (!reachable) {
      throw new Error('Reachable set not found - call gcMark first');
    }

    const repoPath = this.getRepoPath(repo);
    const result = await sweep(repoPath, reachable, options?.minAge);

    return {
      status: 'done',
      deleted: result.deletedObjects + result.deletedPartials,
      bytesFreed: result.bytesFreed,
      skippedYoung: result.skippedYoung,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async gcCleanup(_repo: string, reachableSetRef: string): Promise<void> {
    this.gcReachableSets.delete(reachableSetRef);
  }

  /**
   * Mark all objects reachable from a root hash.
   */
  private async markReachable(
    repo: string,
    hash: string,
    reachable: Set<string>
  ): Promise<void> {
    if (reachable.has(hash)) {
      return;
    }

    try {
      const repoPath = this.getRepoPath(repo);
      const data = await this.storage.objects.read(repoPath, hash);
      reachable.add(hash);

      // Scan for hash patterns in the data
      const dataStr = Buffer.from(data).toString('latin1');
      const hashPattern = /[a-f0-9]{64}/g;
      const matches = dataStr.matchAll(hashPattern);

      for (const match of matches) {
        const potentialHash = match[0];
        if (!reachable.has(potentialHash)) {
          await this.markReachable(repo, potentialHash, reachable);
        }
      }
    } catch {
      // Object doesn't exist
    }
  }
}

// =============================================================================
// Helper Functions (extracted from gc.ts for reuse)
// =============================================================================

import { decodeBeast2For } from '@elaraai/east';
import { WorkspaceStateType } from '@elaraai/e3-types';

/**
 * Collect all root hashes from refs in packages, executions, and workspaces.
 */
export async function collectRoots(repoPath: string): Promise<Set<string>> {
  const roots = new Set<string>();

  // Collect from packages/<name>/<version> files
  const packagesDir = path.join(repoPath, 'packages');
  await collectRefsFromDir(packagesDir, roots, 2);

  // Collect from executions/<taskHash>/<inputsHash>/output files
  const executionsDir = path.join(repoPath, 'executions');
  await collectRefsFromDir(executionsDir, roots, 3);

  // Collect from workspaces/<name>.beast2 files
  const workspacesDir = path.join(repoPath, 'workspaces');
  await collectWorkspaceRoots(workspacesDir, roots);

  return roots;
}

/**
 * Collect root hashes from workspace state files.
 */
async function collectWorkspaceRoots(
  workspacesDir: string,
  roots: Set<string>
): Promise<void> {
  try {
    const entries = await fs.readdir(workspacesDir);
    for (const entry of entries) {
      if (!entry.endsWith('.beast2')) continue;

      const stateFile = path.join(workspacesDir, entry);
      try {
        const data = await fs.readFile(stateFile);
        if (data.length === 0) continue;

        const decoder = decodeBeast2For(WorkspaceStateType);
        const state = decoder(data);

        roots.add(state.packageHash);
        roots.add(state.rootHash);
      } catch {
        // State file can't be parsed - skip
      }
    }
  } catch {
    // Workspaces directory doesn't exist
  }
}

/**
 * Recursively collect hashes from ref files in a directory.
 */
async function collectRefsFromDir(
  dir: string,
  roots: Set<string>,
  maxDepth: number,
  currentDepth: number = 0
): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory() && currentDepth < maxDepth) {
        await collectRefsFromDir(entryPath, roots, maxDepth, currentDepth + 1);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(entryPath, 'utf-8');
          const hash = content.trim();
          if (/^[a-f0-9]{64}$/.test(hash)) {
            roots.add(hash);
          }
        } catch {
          // Skip files we can't read
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
}

/**
 * Result of a sweep operation.
 */
interface SweepResult {
  deletedObjects: number;
  deletedPartials: number;
  retainedObjects: number;
  skippedYoung: number;
  bytesFreed: number;
}

/**
 * Sweep unreachable objects and orphaned staging files.
 */
export async function sweep(
  repoPath: string,
  reachable: Set<string>,
  minAge: number = 60000
): Promise<SweepResult> {
  const objectsDir = path.join(repoPath, 'objects');
  const now = Date.now();
  const result: SweepResult = {
    deletedObjects: 0,
    deletedPartials: 0,
    retainedObjects: 0,
    skippedYoung: 0,
    bytesFreed: 0,
  };

  try {
    const subdirs = await fs.readdir(objectsDir);

    for (const subdir of subdirs) {
      if (!/^[a-f0-9]{2}$/.test(subdir)) {
        continue;
      }

      const subdirPath = path.join(objectsDir, subdir);
      const stat = await fs.stat(subdirPath);
      if (!stat.isDirectory()) {
        continue;
      }

      const files = await fs.readdir(subdirPath);

      for (const file of files) {
        const filePath = path.join(subdirPath, file);

        try {
          const fileStat = await fs.stat(filePath);
          const age = now - fileStat.mtimeMs;
          if (minAge > 0 && age < minAge) {
            result.skippedYoung++;
            continue;
          }

          if (file.endsWith('.partial')) {
            await fs.unlink(filePath);
            result.deletedPartials++;
            result.bytesFreed += fileStat.size;
            continue;
          }

          if (file.endsWith('.beast2')) {
            const hash = subdir + file.slice(0, -7);
            if (reachable.has(hash)) {
              result.retainedObjects++;
            } else {
              await fs.unlink(filePath);
              result.deletedObjects++;
              result.bytesFreed += fileStat.size;
            }
          }
        } catch {
          // Skip files we can't stat or delete
        }
      }

      // Try to remove empty subdirectory
      try {
        await fs.rmdir(subdirPath);
      } catch {
        // Directory not empty
      }
    }
  } catch {
    // Objects directory doesn't exist or can't be read
  }

  return result;
}
