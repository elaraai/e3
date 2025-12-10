/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Workspace operations for e3 repositories.
 *
 * Workspaces are mutable working copies of packages. They allow:
 * - Deploying a package to create a working environment
 * - Modifying data (inputs/outputs)
 * - Exporting changes back to a new package version
 *
 * State is stored in workspaces/<name>.beast2 as a single atomic file.
 * No state file means the workspace does not exist.
 */

import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';
import yazl from 'yazl';
import { decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import { PackageObjectType, WorkspaceStateType } from '@elaraai/e3-types';
import type { PackageObject, WorkspaceState } from '@elaraai/e3-types';
import { objectRead, objectWrite } from './objects.js';
import { packageResolve, packageRead } from './packages.js';

/**
 * Get the path to a workspace's state file.
 */
function statePath(repoPath: string, name: string): string {
  return path.join(repoPath, 'workspaces', `${name}.beast2`);
}

/**
 * Atomically write workspace state.
 */
async function writeState(repoPath: string, name: string, state: WorkspaceState): Promise<void> {
  const wsDir = path.join(repoPath, 'workspaces');
  const stateFile = statePath(repoPath, name);

  // Ensure workspaces directory exists
  await fs.mkdir(wsDir, { recursive: true });

  const encoder = encodeBeast2For(WorkspaceStateType);
  const data = encoder(state);

  // Write atomically: write to temp file, then rename
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const tempPath = path.join(wsDir, `.${name}.${Date.now()}.${randomSuffix}.tmp`);
  await fs.writeFile(tempPath, data);
  await fs.rename(tempPath, stateFile);
}

/**
 * Read workspace state, or null if workspace doesn't exist or is not deployed.
 * An empty file indicates an undeployed workspace.
 */
async function readState(repoPath: string, name: string): Promise<WorkspaceState | null> {
  const stateFile = statePath(repoPath, name);

  try {
    const data = await fs.readFile(stateFile);
    // Empty file means workspace exists but is not deployed
    if (data.length === 0) {
      return null;
    }
    const decoder = decodeBeast2For(WorkspaceStateType);
    return decoder(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Create an empty workspace.
 *
 * Creates an undeployed workspace (state file with null package info).
 * Use workspaceDeploy to deploy a package.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Workspace name
 */
export async function workspaceCreate(
  repoPath: string,
  name: string
): Promise<void> {
  const stateFile = statePath(repoPath, name);

  // Check if workspace already exists
  try {
    await fs.access(stateFile);
    throw new Error(`Workspace already exists: ${name}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  // Create workspaces directory if needed
  const wsDir = path.join(repoPath, 'workspaces');
  await fs.mkdir(wsDir, { recursive: true });

  // Create empty file to mark workspace as existing but not deployed
  // We use an empty file rather than a state file since there's no valid state yet
  await fs.writeFile(stateFile, '');
}

/**
 * Remove a workspace.
 *
 * Objects remain until repoGc is run.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Workspace name
 */
export async function workspaceRemove(
  repoPath: string,
  name: string
): Promise<void> {
  const stateFile = statePath(repoPath, name);
  await fs.unlink(stateFile);
}

/**
 * List workspace names.
 *
 * @param repoPath - Path to .e3 repository
 * @returns Array of workspace names
 */
export async function workspaceList(
  repoPath: string
): Promise<string[]> {
  const workspacesDir = path.join(repoPath, 'workspaces');
  const names: string[] = [];

  try {
    const entries = await fs.readdir(workspacesDir);
    for (const entry of entries) {
      if (entry.endsWith('.beast2')) {
        names.push(entry.slice(0, -7)); // Remove .beast2 extension
      }
    }
  } catch {
    // workspaces directory doesn't exist
  }

  return names;
}

/**
 * Get the full state for a workspace.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Workspace name
 * @returns Workspace state, or null if not deployed
 */
export async function workspaceGetState(
  repoPath: string,
  name: string
): Promise<WorkspaceState | null> {
  return readState(repoPath, name);
}

/**
 * Get the deployed package for a workspace.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Workspace name
 * @returns Package name, version, and hash
 * @throws If workspace is not deployed
 */
export async function workspaceGetPackage(
  repoPath: string,
  name: string
): Promise<{ name: string; version: string; hash: string }> {
  const state = await readState(repoPath, name);
  if (state === null) {
    throw new Error(`Workspace not deployed: ${name}`);
  }
  return {
    name: state.packageName,
    version: state.packageVersion,
    hash: state.packageHash,
  };
}

/**
 * Get the root tree hash for a workspace.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Workspace name
 * @returns Root tree object hash
 * @throws If workspace is not deployed
 */
export async function workspaceGetRoot(
  repoPath: string,
  name: string
): Promise<string> {
  const state = await readState(repoPath, name);
  if (state === null) {
    throw new Error(`Workspace not deployed: ${name}`);
  }
  return state.rootHash;
}

/**
 * Atomically update the root tree hash for a workspace.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Workspace name
 * @param hash - New root tree object hash
 * @throws If workspace is not deployed
 */
export async function workspaceSetRoot(
  repoPath: string,
  name: string,
  hash: string
): Promise<void> {
  const state = await readState(repoPath, name);
  if (state === null) {
    throw new Error(`Workspace not deployed: ${name}`);
  }

  const newState: WorkspaceState = {
    ...state,
    rootHash: hash,
    rootUpdatedAt: new Date(),
  };

  await writeState(repoPath, name, newState);
}

/**
 * Deploy a package to a workspace.
 *
 * Creates the workspace if it doesn't exist. Writes state file atomically
 * containing deployment info and root hash.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Workspace name
 * @param pkgName - Package name
 * @param pkgVersion - Package version
 */
export async function workspaceDeploy(
  repoPath: string,
  name: string,
  pkgName: string,
  pkgVersion: string
): Promise<void> {
  // Resolve package hash and read package object
  const packageHash = await packageResolve(repoPath, pkgName, pkgVersion);
  const pkg = await packageRead(repoPath, pkgName, pkgVersion);

  const now = new Date();
  const state: WorkspaceState = {
    packageName: pkgName,
    packageVersion: pkgVersion,
    packageHash,
    deployedAt: now,
    rootHash: pkg.data.value,
    rootUpdatedAt: now,
  };

  await writeState(repoPath, name, state);
}

/**
 * Result of exporting a workspace
 */
export interface WorkspaceExportResult {
  packageHash: string;
  objectCount: number;
  name: string;
  version: string;
}

/**
 * Fixed mtime for deterministic zip output (Unix epoch)
 */
const DETERMINISTIC_MTIME = new Date(0);

/**
 * Export a workspace as a package.
 *
 * 1. Read workspace state
 * 2. Read deployed package structure using stored packageHash
 * 3. Create new PackageObject with data.value set to current rootHash
 * 4. Collect all referenced objects
 * 5. Write to .zip
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Workspace name
 * @param zipPath - Path to write the .zip file
 * @param outputName - Package name (default: deployed package name)
 * @param version - Package version (default: <pkgVersion>-<rootHash[0..8]>)
 * @returns Export result with package info
 * @throws If workspace is not deployed
 */
export async function workspaceExport(
  repoPath: string,
  name: string,
  zipPath: string,
  outputName?: string,
  version?: string
): Promise<WorkspaceExportResult> {
  const partialPath = `${zipPath}.partial`;

  // Get workspace state
  const state = await readState(repoPath, name);
  if (state === null) {
    throw new Error(`Workspace not deployed: ${name}`);
  }

  // Read the deployed package object using the stored hash
  const deployedPkgData = await objectRead(repoPath, state.packageHash);
  const decoder = decodeBeast2For(PackageObjectType);
  const deployedPkgObject = decoder(Buffer.from(deployedPkgData));

  // Determine output name and version
  const finalName = outputName ?? state.packageName;
  const finalVersion = version ?? `${state.packageVersion}-${state.rootHash.slice(0, 8)}`;

  // Create new PackageObject with updated root
  const newPkgObject: PackageObject = {
    tasks: deployedPkgObject.tasks,
    data: {
      structure: deployedPkgObject.data.structure,
      value: state.rootHash,
    },
  };

  // Encode and store the new package object
  const encoder = encodeBeast2For(PackageObjectType);
  const pkgData = encoder(newPkgObject);
  const packageHash = await objectWrite(repoPath, pkgData);

  // Create zip file
  const zipfile = new yazl.ZipFile();

  // Track which objects we've added to avoid duplicates
  const addedObjects = new Set<string>();

  // Helper to add an object to the zip
  const addObject = async (hash: string): Promise<void> => {
    if (addedObjects.has(hash)) return;
    addedObjects.add(hash);

    const data = await objectRead(repoPath, hash);
    const objPath = `objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`;
    zipfile.addBuffer(Buffer.from(data), objPath, { mtime: DETERMINISTIC_MTIME });
  };

  // Helper to collect children from a tree object (same as packages.ts)
  const collectTreeChildren = async (treeData: Uint8Array): Promise<void> => {
    const dataStr = Buffer.from(treeData).toString('latin1');
    const hashPattern = /[a-f0-9]{64}/g;
    const matches = dataStr.matchAll(hashPattern);

    for (const match of matches) {
      const potentialHash = match[0];
      if (addedObjects.has(potentialHash)) continue;

      try {
        await addObject(potentialHash);
        const childData = await objectRead(repoPath, potentialHash);
        await collectTreeChildren(childData);
      } catch {
        addedObjects.delete(potentialHash);
      }
    }
  };

  // Add the package object
  await addObject(packageHash);

  // Collect all task objects
  for (const taskHash of newPkgObject.tasks.values()) {
    await addObject(taskHash);
  }

  // Collect the root tree and all its children
  await addObject(state.rootHash);
  const rootTreeData = await objectRead(repoPath, state.rootHash);
  await collectTreeChildren(rootTreeData);

  // Write the package ref
  const refPath = `packages/${finalName}/${finalVersion}`;
  zipfile.addBuffer(Buffer.from(packageHash + '\n'), refPath, { mtime: DETERMINISTIC_MTIME });

  // Finalize and write zip to disk
  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(partialPath);
    zipfile.outputStream.pipe(writeStream);
    zipfile.outputStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('close', resolve);
    zipfile.end();
  });

  // Atomic rename to final path
  await fs.rename(partialPath, zipPath);

  return {
    packageHash,
    objectCount: addedObjects.size,
    name: finalName,
    version: finalVersion,
  };
}
