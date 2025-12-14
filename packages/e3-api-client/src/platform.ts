/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import {
  East,
  StringType,
  IntegerType,
  BlobType,
  NullType,
  ArrayType,
  StructType,
  type ValueTypeOf,
} from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';
import { EastError } from '@elaraai/east/internal';
import { TreePathType, WorkspaceStateType, PackageObjectType } from '@elaraai/e3-types';

import {
  RepositoryStatusType,
  GcRequestType,
  GcResultType,
  PackageListItemType,
  PackageImportResultType,
  WorkspaceInfoType,
  WorkspaceStatusResultType,
  TaskListItemType,
  TaskDetailsType,
  DataflowRequestType,
  DataflowGraphType,
  DataflowResultType,
  LogChunkType,
} from './types.js';
import {
  repoStatus,
  repoGc,
} from './repository.js';
import {
  packageList,
  packageGet,
  packageImport,
  packageExport,
  packageRemove,
} from './packages.js';
import {
  workspaceList,
  workspaceCreate,
  workspaceGet,
  workspaceStatus,
  workspaceRemove,
  workspaceDeploy,
  workspaceExport,
} from './workspaces.js';
import {
  datasetList,
  datasetListAt,
  datasetGet,
  datasetSet,
} from './datasets.js';
import {
  taskList,
  taskGet,
} from './tasks.js';
import {
  dataflowStart,
  dataflowExecute,
  dataflowGraph,
  taskLogs,
} from './executions.js';

// =============================================================================
// Repository Platform Functions
// =============================================================================

/**
 * Gets repository status information.
 *
 * Returns statistics about the e3 repository including object count, package count,
 * and workspace count. Use this to monitor repository health and size.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @returns Repository status including object, package, and workspace counts
 *
 * @throws {EastError} When request fails:
 * - Network error
 * - Server unavailable
 *
 * @example
 * ```ts
 * const getStatus = East.function([StringType], RepositoryStatusType, ($, url) => {
 *     return Platform.repoStatus(url);
 * });
 * ```
 */
export const platform_repo_status = East.asyncPlatform(
  'e3_repo_status',
  [StringType],
  RepositoryStatusType
);

/**
 * Runs garbage collection on the repository.
 *
 * Removes unreferenced objects from the object store to free disk space.
 * Use dryRun mode to preview what would be deleted without actually deleting.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param options - GC options (dryRun to preview, minAge for object age filter)
 * @returns GC result with counts and freed bytes
 *
 * @throws {EastError} When request fails:
 * - Network error
 * - Server unavailable
 *
 * @example
 * ```ts
 * const runGc = East.function([StringType, GcRequestType], GcResultType, ($, url, options) => {
 *     return Platform.repoGc(url, options);
 * });
 * ```
 */
export const platform_repo_gc = East.asyncPlatform(
  'e3_repo_gc',
  [StringType, GcRequestType],
  GcResultType
);

// =============================================================================
// Package Platform Functions
// =============================================================================

/**
 * Lists all packages in the repository.
 *
 * Returns an array of package summaries including name and version.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @returns Array of package info (name, version)
 *
 * @throws {EastError} When request fails:
 * - Network error
 * - Server unavailable
 *
 * @example
 * ```ts
 * const listPackages = East.function([StringType], ArrayType(PackageListItemType), ($, url) => {
 *     return Platform.packageList(url);
 * });
 * ```
 */
export const platform_package_list = East.asyncPlatform(
  'e3_package_list',
  [StringType],
  ArrayType(PackageListItemType)
);

/**
 * Gets a package object by name and version.
 *
 * Returns the complete package object including tasks, data structure, and metadata.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Package name
 * @param version - Package version
 * @returns Package object
 *
 * @throws {EastError} When request fails:
 * - Package not found
 * - Network error
 *
 * @example
 * ```ts
 * const getPackage = East.function([StringType, StringType, StringType], PackageObjectType, ($, url, name, version) => {
 *     return Platform.packageGet(url, name, version);
 * });
 * ```
 */
export const platform_package_get = East.asyncPlatform(
  'e3_package_get',
  [StringType, StringType, StringType],
  PackageObjectType
);

/**
 * Imports a package from a zip archive.
 *
 * Takes a zip archive containing a package and imports it into the repository.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param archive - Zip archive as bytes
 * @returns Import result with package info and object count
 *
 * @throws {EastError} When request fails:
 * - Invalid package format
 * - Package already exists
 * - Network error
 *
 * @example
 * ```ts
 * const importPackage = East.function([StringType, BlobType], PackageImportResultType, ($, url, archive) => {
 *     return Platform.packageImport(url, archive);
 * });
 * ```
 */
export const platform_package_import = East.asyncPlatform(
  'e3_package_import',
  [StringType, BlobType],
  PackageImportResultType
);

/**
 * Exports a package as a zip archive.
 *
 * Returns a zip archive containing the package that can be transferred or stored.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Package name
 * @param version - Package version
 * @returns Zip archive as bytes
 *
 * @throws {EastError} When request fails:
 * - Package not found
 * - Network error
 *
 * @example
 * ```ts
 * const exportPackage = East.function([StringType, StringType, StringType], BlobType, ($, url, name, version) => {
 *     return Platform.packageExport(url, name, version);
 * });
 * ```
 */
export const platform_package_export = East.asyncPlatform(
  'e3_package_export',
  [StringType, StringType, StringType],
  BlobType
);

/**
 * Removes a package from the repository.
 *
 * Deletes a package by name and version. Does not affect objects referenced by other packages.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Package name
 * @param version - Package version
 * @returns null on success
 *
 * @throws {EastError} When request fails:
 * - Package not found
 * - Network error
 *
 * @example
 * ```ts
 * const removePackage = East.function([StringType, StringType, StringType], NullType, ($, url, name, version) => {
 *     return Platform.packageRemove(url, name, version);
 * });
 * ```
 */
export const platform_package_remove = East.asyncPlatform(
  'e3_package_remove',
  [StringType, StringType, StringType],
  NullType
);

// =============================================================================
// Workspace Platform Functions
// =============================================================================

/**
 * Lists all workspaces in the repository.
 *
 * Returns an array of workspace summaries including deployment status.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @returns Array of workspace info
 *
 * @throws {EastError} When request fails:
 * - Network error
 * - Server unavailable
 *
 * @example
 * ```ts
 * const listWorkspaces = East.function([StringType], ArrayType(WorkspaceInfoType), ($, url) => {
 *     return Platform.workspaceList(url);
 * });
 * ```
 */
export const platform_workspace_list = East.asyncPlatform(
  'e3_workspace_list',
  [StringType],
  ArrayType(WorkspaceInfoType)
);

/**
 * Creates a new empty workspace.
 *
 * Creates a workspace with the given name that can be used to deploy packages.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns Created workspace info
 *
 * @throws {EastError} When request fails:
 * - Workspace already exists
 * - Network error
 *
 * @example
 * ```ts
 * const createWorkspace = East.function([StringType, StringType], WorkspaceInfoType, ($, url, name) => {
 *     return Platform.workspaceCreate(url, name);
 * });
 * ```
 */
export const platform_workspace_create = East.asyncPlatform(
  'e3_workspace_create',
  [StringType, StringType],
  WorkspaceInfoType
);

/**
 * Gets workspace state including deployed package info.
 *
 * Returns the full workspace state including the deployed package and current root hash.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns Workspace state
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Network error
 *
 * @example
 * ```ts
 * const getWorkspace = East.function([StringType, StringType], WorkspaceStateType, ($, url, name) => {
 *     return Platform.workspaceGet(url, name);
 * });
 * ```
 */
export const platform_workspace_get = East.asyncPlatform(
  'e3_workspace_get',
  [StringType, StringType],
  WorkspaceStateType
);

/**
 * Gets comprehensive workspace status.
 *
 * Returns detailed status including all datasets, tasks, lock info, and summary counts.
 * Use this to monitor execution progress after calling dataflowStart.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns Workspace status with datasets, tasks, and summary
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Network error
 *
 * @example
 * ```ts
 * const getStatus = East.function([StringType, StringType], WorkspaceStatusResultType, ($, url, name) => {
 *     return Platform.workspaceStatus(url, name);
 * });
 * ```
 */
export const platform_workspace_status = East.asyncPlatform(
  'e3_workspace_status',
  [StringType, StringType],
  WorkspaceStatusResultType
);

/**
 * Removes a workspace.
 *
 * Deletes a workspace and all its data. Cannot be undone.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns null on success
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Network error
 *
 * @example
 * ```ts
 * const removeWorkspace = East.function([StringType, StringType], NullType, ($, url, name) => {
 *     return Platform.workspaceRemove(url, name);
 * });
 * ```
 */
export const platform_workspace_remove = East.asyncPlatform(
  'e3_workspace_remove',
  [StringType, StringType],
  NullType
);

/**
 * Deploys a package to a workspace.
 *
 * Sets up the workspace with the specified package's data structure and tasks.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @param packageRef - Package reference (name or name@version)
 * @returns null on success
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Package not found
 * - Network error
 *
 * @example
 * ```ts
 * const deploy = East.function([StringType, StringType, StringType], NullType, ($, url, workspace, packageRef) => {
 *     return Platform.workspaceDeploy(url, workspace, packageRef);
 * });
 * ```
 */
export const platform_workspace_deploy = East.asyncPlatform(
  'e3_workspace_deploy',
  [StringType, StringType, StringType],
  NullType
);

/**
 * Exports workspace as a package zip archive.
 *
 * Creates a zip archive of the workspace that can be imported elsewhere.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Workspace name
 * @returns Zip archive as bytes
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Network error
 *
 * @example
 * ```ts
 * const exportWorkspace = East.function([StringType, StringType], BlobType, ($, url, name) => {
 *     return Platform.workspaceExport(url, name);
 * });
 * ```
 */
export const platform_workspace_export = East.asyncPlatform(
  'e3_workspace_export',
  [StringType, StringType],
  BlobType
);

// =============================================================================
// Dataset Platform Functions
// =============================================================================

/**
 * Lists field names at root of workspace dataset tree.
 *
 * Returns the top-level field names in the workspace's data tree.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @returns Array of field names at root
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Network error
 *
 * @example
 * ```ts
 * const listDatasets = East.function([StringType, StringType], ArrayType(StringType), ($, url, workspace) => {
 *     return Platform.datasetList(url, workspace);
 * });
 * ```
 */
export const platform_dataset_list = East.asyncPlatform(
  'e3_dataset_list',
  [StringType, StringType],
  ArrayType(StringType)
);

/**
 * Lists field names at a path in workspace dataset tree.
 *
 * Returns field names at the specified path in the workspace's data tree.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @param path - Path to the dataset
 * @returns Array of field names at path
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Path not found
 * - Network error
 *
 * @example
 * ```ts
 * const listAt = East.function([StringType, StringType, TreePathType], ArrayType(StringType), ($, url, workspace, path) => {
 *     return Platform.datasetListAt(url, workspace, path);
 * });
 * ```
 */
export const platform_dataset_list_at = East.asyncPlatform(
  'e3_dataset_list_at',
  [StringType, StringType, TreePathType],
  ArrayType(StringType)
);

/**
 * Gets a dataset value as raw BEAST2 bytes.
 *
 * Returns the raw BEAST2 encoded data for a dataset.
 * Use decodeBeast2 or decodeBeast2For to decode with the appropriate type.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @param path - Path to the dataset
 * @returns Raw BEAST2 bytes
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Dataset not found
 * - Network error
 *
 * @example
 * ```ts
 * const getData = East.function([StringType, StringType, TreePathType], BlobType, ($, url, workspace, path) => {
 *     return Platform.datasetGet(url, workspace, path);
 * });
 * ```
 */
export const platform_dataset_get = East.asyncPlatform(
  'e3_dataset_get',
  [StringType, StringType, TreePathType],
  BlobType
);

/**
 * Sets a dataset value from raw BEAST2 bytes.
 *
 * Stores the BEAST2 encoded data at the specified dataset path.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @param path - Path to the dataset
 * @param data - Raw BEAST2 encoded value
 * @returns null on success
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Invalid path
 * - Network error
 *
 * @example
 * ```ts
 * const setData = East.function([StringType, StringType, TreePathType, BlobType], NullType, ($, url, workspace, path, data) => {
 *     return Platform.datasetSet(url, workspace, path, data);
 * });
 * ```
 */
export const platform_dataset_set = East.asyncPlatform(
  'e3_dataset_set',
  [StringType, StringType, TreePathType, BlobType],
  NullType
);

// =============================================================================
// Task Platform Functions
// =============================================================================

/**
 * Lists tasks in a workspace.
 *
 * Returns an array of task summaries including name and hash.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @returns Array of task info (name, hash)
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Workspace not deployed
 * - Network error
 *
 * @example
 * ```ts
 * const listTasks = East.function([StringType, StringType], ArrayType(TaskListItemType), ($, url, workspace) => {
 *     return Platform.taskList(url, workspace);
 * });
 * ```
 */
export const platform_task_list = East.asyncPlatform(
  'e3_task_list',
  [StringType, StringType],
  ArrayType(TaskListItemType)
);

/**
 * Gets task details including runner and typed inputs/outputs.
 *
 * Returns the complete task definition including command IR and input/output paths.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @param name - Task name
 * @returns Task details
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Task not found
 * - Network error
 *
 * @example
 * ```ts
 * const getTask = East.function([StringType, StringType, StringType], TaskDetailsType, ($, url, workspace, name) => {
 *     return Platform.taskGet(url, workspace, name);
 * });
 * ```
 */
export const platform_task_get = East.asyncPlatform(
  'e3_task_get',
  [StringType, StringType, StringType],
  TaskDetailsType
);

// =============================================================================
// Execution Platform Functions
// =============================================================================

/**
 * Starts dataflow execution on a workspace (non-blocking).
 *
 * Returns immediately after spawning execution in background.
 * Use workspaceStatus to poll for progress.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @param options - Execution options (concurrency, force, filter)
 * @returns null on success
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Workspace locked
 * - Network error
 *
 * @example
 * ```ts
 * const start = East.function([StringType, StringType, DataflowRequestType], NullType, ($, url, workspace, options) => {
 *     return Platform.dataflowStart(url, workspace, options);
 * });
 * ```
 */
export const platform_dataflow_start = East.asyncPlatform(
  'e3_dataflow_start',
  [StringType, StringType, DataflowRequestType],
  NullType
);

/**
 * Executes dataflow on a workspace (blocking).
 *
 * Waits for execution to complete and returns the result with per-task outcomes.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @param options - Execution options (concurrency, force, filter)
 * @returns Dataflow execution result
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Workspace locked
 * - Network error
 *
 * @example
 * ```ts
 * const execute = East.function([StringType, StringType, DataflowRequestType], DataflowResultType, ($, url, workspace, options) => {
 *     return Platform.dataflowExecute(url, workspace, options);
 * });
 * ```
 */
export const platform_dataflow_execute = East.asyncPlatform(
  'e3_dataflow_execute',
  [StringType, StringType, DataflowRequestType],
  DataflowResultType
);

/**
 * Gets the dependency graph for a workspace.
 *
 * Returns the task dependency graph showing which tasks depend on which others.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @returns Dataflow graph with tasks and dependencies
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Network error
 *
 * @example
 * ```ts
 * const getGraph = East.function([StringType, StringType], DataflowGraphType, ($, url, workspace) => {
 *     return Platform.dataflowGraph(url, workspace);
 * });
 * ```
 */
export const platform_dataflow_graph = East.asyncPlatform(
  'e3_dataflow_graph',
  [StringType, StringType],
  DataflowGraphType
);

/**
 * Log request options type.
 */
export const LogOptionsType = StructType({
  stream: StringType,
  offset: IntegerType,
  limit: IntegerType,
});

/**
 * Reads task logs from a workspace.
 *
 * Returns a chunk of log data from the specified task's stdout or stderr.
 *
 * This is a platform function for the East language, enabling e3 API operations
 * in East programs running on Node.js.
 *
 * @param url - Base URL of the e3 API server
 * @param workspace - Workspace name
 * @param task - Task name
 * @param options - Log options (stream, offset, limit)
 * @returns Log chunk with data and metadata
 *
 * @throws {EastError} When request fails:
 * - Workspace not found
 * - Task not found
 * - Network error
 *
 * @example
 * ```ts
 * const getLogs = East.function([StringType, StringType, StringType, LogOptionsType], LogChunkType, ($, url, workspace, task, options) => {
 *     return Platform.taskLogs(url, workspace, task, options);
 * });
 * ```
 */
export const platform_task_logs = East.asyncPlatform(
  'e3_task_logs',
  [StringType, StringType, StringType, LogOptionsType],
  LogChunkType
);

// =============================================================================
// Platform Implementation
// =============================================================================

/**
 * Node.js implementation of e3 API platform functions.
 *
 * Pass this array to {@link East.compileAsync} to enable e3 API operations.
 */
const PlatformImpl: PlatformFunction[] = [
  // Repository
  platform_repo_status.implement(async (url: string) => {
    try {
      return await repoStatus(url);
    } catch (err: any) {
      throw new EastError(`Failed to get repository status: ${err.message}`, {
        location: { filename: 'e3_repo_status', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_repo_gc.implement(async (url: string, options: ValueTypeOf<typeof GcRequestType>) => {
    try {
      return await repoGc(url, options);
    } catch (err: any) {
      throw new EastError(`Failed to run garbage collection: ${err.message}`, {
        location: { filename: 'e3_repo_gc', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  // Packages
  platform_package_list.implement(async (url: string) => {
    try {
      return await packageList(url);
    } catch (err: any) {
      throw new EastError(`Failed to list packages: ${err.message}`, {
        location: { filename: 'e3_package_list', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_package_get.implement(async (url: string, name: string, version: string) => {
    try {
      return await packageGet(url, name, version);
    } catch (err: any) {
      throw new EastError(`Failed to get package ${name}@${version}: ${err.message}`, {
        location: { filename: 'e3_package_get', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_package_import.implement(async (url: string, archive: Uint8Array) => {
    try {
      return await packageImport(url, archive);
    } catch (err: any) {
      throw new EastError(`Failed to import package: ${err.message}`, {
        location: { filename: 'e3_package_import', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_package_export.implement(async (url: string, name: string, version: string) => {
    try {
      return await packageExport(url, name, version);
    } catch (err: any) {
      throw new EastError(`Failed to export package ${name}@${version}: ${err.message}`, {
        location: { filename: 'e3_package_export', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_package_remove.implement(async (url: string, name: string, version: string) => {
    try {
      await packageRemove(url, name, version);
      return null;
    } catch (err: any) {
      throw new EastError(`Failed to remove package ${name}@${version}: ${err.message}`, {
        location: { filename: 'e3_package_remove', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  // Workspaces
  platform_workspace_list.implement(async (url: string) => {
    try {
      return await workspaceList(url);
    } catch (err: any) {
      throw new EastError(`Failed to list workspaces: ${err.message}`, {
        location: { filename: 'e3_workspace_list', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_workspace_create.implement(async (url: string, name: string) => {
    try {
      return await workspaceCreate(url, name);
    } catch (err: any) {
      throw new EastError(`Failed to create workspace ${name}: ${err.message}`, {
        location: { filename: 'e3_workspace_create', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_workspace_get.implement(async (url: string, name: string) => {
    try {
      return await workspaceGet(url, name);
    } catch (err: any) {
      throw new EastError(`Failed to get workspace ${name}: ${err.message}`, {
        location: { filename: 'e3_workspace_get', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_workspace_status.implement(async (url: string, name: string) => {
    try {
      return await workspaceStatus(url, name);
    } catch (err: any) {
      throw new EastError(`Failed to get workspace status ${name}: ${err.message}`, {
        location: { filename: 'e3_workspace_status', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_workspace_remove.implement(async (url: string, name: string) => {
    try {
      await workspaceRemove(url, name);
      return null;
    } catch (err: any) {
      throw new EastError(`Failed to remove workspace ${name}: ${err.message}`, {
        location: { filename: 'e3_workspace_remove', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_workspace_deploy.implement(async (url: string, name: string, packageRef: string) => {
    try {
      await workspaceDeploy(url, name, packageRef);
      return null;
    } catch (err: any) {
      throw new EastError(`Failed to deploy ${packageRef} to workspace ${name}: ${err.message}`, {
        location: { filename: 'e3_workspace_deploy', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_workspace_export.implement(async (url: string, name: string) => {
    try {
      return await workspaceExport(url, name);
    } catch (err: any) {
      throw new EastError(`Failed to export workspace ${name}: ${err.message}`, {
        location: { filename: 'e3_workspace_export', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  // Datasets
  platform_dataset_list.implement(async (url: string, workspace: string) => {
    try {
      return await datasetList(url, workspace);
    } catch (err: any) {
      throw new EastError(`Failed to list datasets in ${workspace}: ${err.message}`, {
        location: { filename: 'e3_dataset_list', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_dataset_list_at.implement(
    async (url: string, workspace: string, path: ValueTypeOf<typeof TreePathType>) => {
      try {
        return await datasetListAt(url, workspace, path);
      } catch (err: any) {
        throw new EastError(`Failed to list datasets at path in ${workspace}: ${err.message}`, {
          location: { filename: 'e3_dataset_list_at', line: 0n, column: 0n },
          cause: err,
        });
      }
    }
  ),

  platform_dataset_get.implement(
    async (url: string, workspace: string, path: ValueTypeOf<typeof TreePathType>) => {
      try {
        return await datasetGet(url, workspace, path);
      } catch (err: any) {
        throw new EastError(`Failed to get dataset in ${workspace}: ${err.message}`, {
          location: { filename: 'e3_dataset_get', line: 0n, column: 0n },
          cause: err,
        });
      }
    }
  ),

  platform_dataset_set.implement(
    async (
      url: string,
      workspace: string,
      path: ValueTypeOf<typeof TreePathType>,
      data: Uint8Array
    ) => {
      try {
        await datasetSet(url, workspace, path, data);
        return null;
      } catch (err: any) {
        throw new EastError(`Failed to set dataset in ${workspace}: ${err.message}`, {
          location: { filename: 'e3_dataset_set', line: 0n, column: 0n },
          cause: err,
        });
      }
    }
  ),

  // Tasks
  platform_task_list.implement(async (url: string, workspace: string) => {
    try {
      return await taskList(url, workspace);
    } catch (err: any) {
      throw new EastError(`Failed to list tasks in ${workspace}: ${err.message}`, {
        location: { filename: 'e3_task_list', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_task_get.implement(async (url: string, workspace: string, name: string) => {
    try {
      return await taskGet(url, workspace, name);
    } catch (err: any) {
      throw new EastError(`Failed to get task ${name} in ${workspace}: ${err.message}`, {
        location: { filename: 'e3_task_get', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  // Executions
  platform_dataflow_start.implement(
    async (url: string, workspace: string, options: ValueTypeOf<typeof DataflowRequestType>) => {
      try {
        await dataflowStart(url, workspace, {
          concurrency: options.concurrency.value != null ? Number(options.concurrency.value) : undefined,
          force: options.force,
          filter: options.filter.value ?? undefined,
        });
        return null;
      } catch (err: any) {
        throw new EastError(`Failed to start dataflow in ${workspace}: ${err.message}`, {
          location: { filename: 'e3_dataflow_start', line: 0n, column: 0n },
          cause: err,
        });
      }
    }
  ),

  platform_dataflow_execute.implement(
    async (url: string, workspace: string, options: ValueTypeOf<typeof DataflowRequestType>) => {
      try {
        return await dataflowExecute(url, workspace, {
          concurrency: options.concurrency.value != null ? Number(options.concurrency.value) : undefined,
          force: options.force,
          filter: options.filter.value ?? undefined,
        });
      } catch (err: any) {
        throw new EastError(`Failed to execute dataflow in ${workspace}: ${err.message}`, {
          location: { filename: 'e3_dataflow_execute', line: 0n, column: 0n },
          cause: err,
        });
      }
    }
  ),

  platform_dataflow_graph.implement(async (url: string, workspace: string) => {
    try {
      return await dataflowGraph(url, workspace);
    } catch (err: any) {
      throw new EastError(`Failed to get dataflow graph for ${workspace}: ${err.message}`, {
        location: { filename: 'e3_dataflow_graph', line: 0n, column: 0n },
        cause: err,
      });
    }
  }),

  platform_task_logs.implement(
    async (
      url: string,
      workspace: string,
      task: string,
      options: ValueTypeOf<typeof LogOptionsType>
    ) => {
      try {
        return await taskLogs(url, workspace, task, {
          stream: options.stream as 'stdout' | 'stderr',
          offset: Number(options.offset),
          limit: Number(options.limit),
        });
      } catch (err: any) {
        throw new EastError(`Failed to get logs for task ${task} in ${workspace}: ${err.message}`, {
          location: { filename: 'e3_task_logs', line: 0n, column: 0n },
          cause: err,
        });
      }
    }
  ),
];

// =============================================================================
// Grouped Export
// =============================================================================

/**
 * Grouped e3 API platform functions.
 *
 * Provides e3 repository, package, workspace, dataset, task, and execution operations
 * for East programs running on Node.js.
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Platform, RepositoryStatusType } from "@elaraai/e3-api-client";
 *
 * const getStatus = East.function([StringType], RepositoryStatusType, ($, url) => {
 *     return Platform.repoStatus(url);
 * });
 *
 * const compiled = await East.compileAsync(getStatus.toIR(), Platform.Implementation);
 * const status = await compiled("http://localhost:3000");
 * console.log(status.objectCount);
 * ```
 */
export const Platform = {
  // Repository
  /**
   * Gets repository status information.
   *
   * Returns statistics about the e3 repository including object count, package count,
   * and workspace count.
   *
   * @param url - Base URL of the e3 API server
   * @returns Repository status
   *
   * @example
   * ```ts
   * const getStatus = East.function([StringType], RepositoryStatusType, ($, url) => {
   *     return Platform.repoStatus(url);
   * });
   *
   * const compiled = await East.compileAsync(getStatus.toIR(), Platform.Implementation);
   * await compiled("http://localhost:3000");
   * ```
   */
  repoStatus: platform_repo_status,

  /**
   * Runs garbage collection on the repository.
   *
   * Removes unreferenced objects from the object store to free disk space.
   *
   * @param url - Base URL of the e3 API server
   * @param options - GC options
   * @returns GC result with counts and freed bytes
   *
   * @example
   * ```ts
   * const runGc = East.function([StringType, GcRequestType], GcResultType, ($, url, options) => {
   *     return Platform.repoGc(url, options);
   * });
   *
   * const compiled = await East.compileAsync(runGc.toIR(), Platform.Implementation);
   * await compiled("http://localhost:3000", { dryRun: true, minAge: { type: "none", value: null } });
   * ```
   */
  repoGc: platform_repo_gc,

  // Packages
  /**
   * Lists all packages in the repository.
   *
   * @param url - Base URL of the e3 API server
   * @returns Array of package info
   */
  packageList: platform_package_list,

  /**
   * Gets a package object by name and version.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Package name
   * @param version - Package version
   * @returns Package object
   */
  packageGet: platform_package_get,

  /**
   * Imports a package from a zip archive.
   *
   * @param url - Base URL of the e3 API server
   * @param archive - Zip archive as bytes
   * @returns Import result
   */
  packageImport: platform_package_import,

  /**
   * Exports a package as a zip archive.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Package name
   * @param version - Package version
   * @returns Zip archive as bytes
   */
  packageExport: platform_package_export,

  /**
   * Removes a package from the repository.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Package name
   * @param version - Package version
   * @returns null on success
   */
  packageRemove: platform_package_remove,

  // Workspaces
  /**
   * Lists all workspaces in the repository.
   *
   * @param url - Base URL of the e3 API server
   * @returns Array of workspace info
   */
  workspaceList: platform_workspace_list,

  /**
   * Creates a new empty workspace.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Workspace name
   * @returns Created workspace info
   */
  workspaceCreate: platform_workspace_create,

  /**
   * Gets workspace state including deployed package info.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Workspace name
   * @returns Workspace state
   */
  workspaceGet: platform_workspace_get,

  /**
   * Gets comprehensive workspace status.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Workspace name
   * @returns Workspace status with datasets, tasks, and summary
   */
  workspaceStatus: platform_workspace_status,

  /**
   * Removes a workspace.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Workspace name
   * @returns null on success
   */
  workspaceRemove: platform_workspace_remove,

  /**
   * Deploys a package to a workspace.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Workspace name
   * @param packageRef - Package reference
   * @returns null on success
   */
  workspaceDeploy: platform_workspace_deploy,

  /**
   * Exports workspace as a package zip archive.
   *
   * @param url - Base URL of the e3 API server
   * @param name - Workspace name
   * @returns Zip archive as bytes
   */
  workspaceExport: platform_workspace_export,

  // Datasets
  /**
   * Lists field names at root of workspace dataset tree.
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @returns Array of field names
   */
  datasetList: platform_dataset_list,

  /**
   * Lists field names at a path in workspace dataset tree.
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @param path - Path to the dataset
   * @returns Array of field names
   */
  datasetListAt: platform_dataset_list_at,

  /**
   * Gets a dataset value as raw BEAST2 bytes.
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @param path - Path to the dataset
   * @returns Raw BEAST2 bytes
   */
  datasetGet: platform_dataset_get,

  /**
   * Sets a dataset value from raw BEAST2 bytes.
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @param path - Path to the dataset
   * @param data - Raw BEAST2 encoded value
   * @returns null on success
   */
  datasetSet: platform_dataset_set,

  // Tasks
  /**
   * Lists tasks in a workspace.
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @returns Array of task info
   */
  taskList: platform_task_list,

  /**
   * Gets task details.
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @param name - Task name
   * @returns Task details
   */
  taskGet: platform_task_get,

  // Executions
  /**
   * Starts dataflow execution (non-blocking).
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @param options - Execution options
   * @returns null on success
   */
  dataflowStart: platform_dataflow_start,

  /**
   * Executes dataflow (blocking).
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @param options - Execution options
   * @returns Dataflow execution result
   */
  dataflowExecute: platform_dataflow_execute,

  /**
   * Gets the dependency graph for a workspace.
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @returns Dataflow graph
   */
  dataflowGraph: platform_dataflow_graph,

  /**
   * Reads task logs from a workspace.
   *
   * @param url - Base URL of the e3 API server
   * @param workspace - Workspace name
   * @param task - Task name
   * @param options - Log options
   * @returns Log chunk
   */
  taskLogs: platform_task_logs,

  /**
   * Node.js implementation of e3 API platform functions.
   *
   * Pass this to {@link East.compileAsync} to enable e3 API operations.
   */
  Implementation: PlatformImpl,

  /**
   * Type definitions for platform operations.
   */
  Types: {
    RepositoryStatus: RepositoryStatusType,
    GcRequest: GcRequestType,
    GcResult: GcResultType,
    PackageListItem: PackageListItemType,
    PackageImportResult: PackageImportResultType,
    WorkspaceInfo: WorkspaceInfoType,
    WorkspaceStatusResult: WorkspaceStatusResultType,
    TaskListItem: TaskListItemType,
    TaskDetails: TaskDetailsType,
    DataflowRequest: DataflowRequestType,
    DataflowGraph: DataflowGraphType,
    DataflowResult: DataflowResultType,
    LogChunk: LogChunkType,
    LogOptions: LogOptionsType,
  },
} as const;

// Export for backwards compatibility
export { PlatformImpl };
