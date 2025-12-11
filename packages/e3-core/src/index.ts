/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 Core - Programmatic API for e3 repository operations
 *
 * This package provides the filesystem-based business logic for e3,
 * similar to libgit2 for git. It has no UI dependencies and can be
 * used programmatically.
 */

// Repository management
export {
  repoInit,
  repoFind,
  repoGet,
  type InitRepositoryResult,
} from './repository.js';

// Garbage collection
export { repoGc, type GcOptions, type GcResult } from './gc.js';

// Object storage
export {
  computeHash,
  objectWrite,
  objectWriteStream,
  objectRead,
  objectExists,
  objectPath,
  objectAbbrev,
} from './objects.js';

// Package operations
export {
  packageImport,
  packageExport,
  packageRemove,
  packageList,
  packageResolve,
  packageRead,
  type PackageImportResult,
  type PackageExportResult,
} from './packages.js';

// Workspace operations
export {
  workspaceCreate,
  workspaceRemove,
  workspaceList,
  workspaceGetState,
  workspaceGetPackage,
  workspaceGetRoot,
  workspaceSetRoot,
  workspaceDeploy,
  workspaceExport,
  type WorkspaceExportResult,
} from './workspaces.js';

// Tree and dataset operations (low-level, by hash)
export {
  treeRead,
  treeWrite,
  datasetRead,
  datasetWrite,
  type TreeObject,
} from './trees.js';

// Tree and dataset operations (high-level, by path)
export {
  packageListTree,
  packageGetDataset,
  workspaceListTree,
  workspaceGetDataset,
  workspaceGetDatasetHash,
  workspaceSetDataset,
  workspaceSetDatasetByHash,
} from './trees.js';

// Task operations
export {
  packageListTasks,
  packageGetTask,
  workspaceListTasks,
  workspaceGetTask,
  workspaceGetTaskHash,
} from './tasks.js';

// Execution operations
export {
  // Identity
  inputsHash,
  executionPath,
  // Status
  executionGet,
  executionGetOutput,
  executionListForTask,
  executionList,
  // Logs
  executionReadLog,
  type LogReadOptions,
  type LogChunk,
  // Command IR evaluation
  evaluateCommandIr,
  // Process detection
  isProcessAlive,
  // Execution
  taskExecute,
  type ExecuteOptions,
  type ExecutionResult,
} from './executions.js';

// Dataflow execution
export {
  dataflowExecute,
  dataflowGetGraph,
  type DataflowOptions,
  type DataflowResult,
  type TaskExecutionResult,
} from './dataflow.js';
