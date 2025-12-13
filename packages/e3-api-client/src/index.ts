/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3-api-client: TypeScript client library for e3 API server
 *
 * Stateless functions for interacting with an e3 API server.
 * Uses BEAST2 serialization for request/response bodies.
 */

// Types
export { ApiTypes } from './types.js';
export type {
  RepositoryStatus,
  GcRequest,
  GcResult,
  PackageListItem,
  PackageImportResult,
  WorkspaceInfo,
  WorkspaceStatusResult,
  DatasetStatus,
  DatasetStatusInfo,
  TaskStatus,
  TaskStatusInfo,
  WorkspaceStatusSummary,
  TaskListItem,
  TaskDetails,
  DataflowGraph,
  GraphTask,
  LogChunk,
  TaskExecutionResult,
  DataflowResult,
} from './types.js';

// Repository
export { repoStatus, repoGc } from './repository.js';

// Packages
export {
  packageList,
  packageGet,
  packageImport,
  packageExport,
  packageRemove,
} from './packages.js';

// Workspaces
export {
  workspaceList,
  workspaceCreate,
  workspaceGet,
  workspaceStatus,
  workspaceRemove,
  workspaceDeploy,
  workspaceExport,
} from './workspaces.js';

// Datasets
export {
  datasetList,
  datasetListAt,
  datasetGet,
  datasetSet,
} from './datasets.js';

// Tasks
export { taskList, taskGet } from './tasks.js';

// Executions
export {
  dataflowStart,
  dataflowExecute,
  dataflowGraph,
  taskLogs,
  type DataflowOptions,
  type LogOptions,
} from './executions.js';
