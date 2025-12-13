/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Task operations for e3 repositories.
 *
 * Tasks are computations with input/output dataset paths. They are stored
 * as TaskObjects in the object store and referenced by packages via their hash.
 *
 * This module provides APIs to:
 * - List tasks in packages and workspaces
 * - Get task details (runner, inputs, output paths)
 */

import { decodeBeast2For } from '@elaraai/east';
import {
  PackageObjectType,
  TaskObjectType,
  WorkspaceStateType,
  type TaskObject,
} from '@elaraai/e3-types';
import { objectRead } from './objects.js';
import { packageRead } from './packages.js';
import {
  TaskNotFoundError,
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  isNotFoundError,
} from './errors.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// =============================================================================
// Package Task Operations
// =============================================================================

/**
 * List task names in a package.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @param version - Package version
 * @returns Array of task names
 * @throws If package not found
 */
export async function packageListTasks(
  repoPath: string,
  name: string,
  version: string
): Promise<string[]> {
  const pkg = await packageRead(repoPath, name, version);
  return Array.from(pkg.tasks.keys());
}

/**
 * Get task details from a package.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @param version - Package version
 * @param taskName - Name of the task
 * @returns The TaskObject containing runner, inputs, and output
 * @throws {PackageNotFoundError} If package not found
 * @throws {TaskNotFoundError} If task not found in package
 */
export async function packageGetTask(
  repoPath: string,
  name: string,
  version: string,
  taskName: string
): Promise<TaskObject> {
  const pkg = await packageRead(repoPath, name, version);
  const taskHash = pkg.tasks.get(taskName);

  if (!taskHash) {
    throw new TaskNotFoundError(taskName);
  }

  const taskData = await objectRead(repoPath, taskHash);
  const decoder = decodeBeast2For(TaskObjectType);
  return decoder(Buffer.from(taskData));
}

// =============================================================================
// Workspace Task Operations
// =============================================================================

/**
 * Read workspace state from file.
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but not deployed
 */
async function readWorkspaceState(repoPath: string, ws: string) {
  const stateFile = path.join(repoPath, 'workspaces', `${ws}.beast2`);

  try {
    const data = await fs.readFile(stateFile);
    if (data.length === 0) {
      throw new WorkspaceNotDeployedError(ws);
    }
    const decoder = decodeBeast2For(WorkspaceStateType);
    return decoder(data);
  } catch (err) {
    if (err instanceof WorkspaceNotDeployedError) throw err;
    if (isNotFoundError(err)) {
      throw new WorkspaceNotFoundError(ws);
    }
    throw err;
  }
}

/**
 * Get the deployed package object for a workspace.
 */
async function getWorkspacePackageObject(repoPath: string, ws: string) {
  const state = await readWorkspaceState(repoPath, ws);
  const pkgData = await objectRead(repoPath, state.packageHash);
  const decoder = decodeBeast2For(PackageObjectType);
  return decoder(Buffer.from(pkgData));
}

/**
 * List task names in a workspace.
 *
 * Tasks are defined by the deployed package.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @returns Array of task names
 * @throws If workspace not found or not deployed
 */
export async function workspaceListTasks(
  repoPath: string,
  ws: string
): Promise<string[]> {
  const pkg = await getWorkspacePackageObject(repoPath, ws);
  return Array.from(pkg.tasks.keys());
}

/**
 * Get task hash from a workspace.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @param taskName - Name of the task
 * @returns The hash of the TaskObject
 * @throws {WorkspaceNotFoundError} If workspace not found
 * @throws {WorkspaceNotDeployedError} If workspace not deployed
 * @throws {TaskNotFoundError} If task not found
 */
export async function workspaceGetTaskHash(
  repoPath: string,
  ws: string,
  taskName: string
): Promise<string> {
  const pkg = await getWorkspacePackageObject(repoPath, ws);
  const taskHash = pkg.tasks.get(taskName);

  if (!taskHash) {
    throw new TaskNotFoundError(taskName);
  }

  return taskHash;
}

/**
 * Get task details from a workspace.
 *
 * Tasks are defined by the deployed package.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @param taskName - Name of the task
 * @returns The TaskObject containing runner, inputs, and output
 * @throws If workspace not deployed or task not found
 */
export async function workspaceGetTask(
  repoPath: string,
  ws: string,
  taskName: string
): Promise<TaskObject> {
  const taskHash = await workspaceGetTaskHash(repoPath, ws, taskName);
  const taskData = await objectRead(repoPath, taskHash);
  const decoder = decodeBeast2For(TaskObjectType);
  return decoder(Buffer.from(taskData));
}
