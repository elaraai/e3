/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 Core - Programmatic API for e3 repository operations
 *
 * This package provides the filesystem-based business logic for e3,
 * similar to libgit2 for git. It has no UI dependencies and can be
 * used programmatically.
 */

// =============================================================================
// Storage and Execution Abstractions
// =============================================================================
// These interfaces enable e3-core to work against different backends:
// - Local filesystem (default, CLI and local dev)
// - AWS EFS (Lambda/Fargate cloud deployment)
// - S3 + DynamoDB (future optimization)

export * from './storage/index.js';
export * from './execution/index.js';

// =============================================================================
// Repository Operations (filesystem-based)
// =============================================================================
// These functions use repoPath directly. Future versions will also accept
// a StorageBackend for backend-agnostic operation.

// Repository management (local filesystem)
export {
  repoInit,
  repoFind,
  repoGet,
  type InitRepositoryResult,
} from './storage/local/repository.js';

// Garbage collection (local filesystem)
export { repoGc, type GcOptions, type GcResult } from './storage/local/gc.js';

// Object storage
export { computeHash } from './objects.js';

// Local object storage functions (for backwards compatibility)
export {
  objectWrite,
  objectWriteStream,
  objectRead,
  objectExists,
} from './storage/local/LocalObjectStore.js';

export { objectPath, objectAbbrev } from './storage/local/localHelpers.js';

// Package operations
export {
  packageImport,
  packageExport,
  packageRemove,
  packageList,
  packageGetLatestVersion,
  packageResolve,
  packageRead,
  type PackageImportResult,
  type PackageExportResult,
} from './packages.js';

// Workspace operations
export {
  workspaceList,
  workspaceCreate,
  workspaceRemove,
  workspaceGetState,
  workspaceGetPackage,
  workspaceGetRoot,
  workspaceSetRoot,
  workspaceDeploy,
  workspaceExport,
  type WorkspaceExportResult,
  type WorkspaceRemoveOptions,
  type WorkspaceDeployOptions,
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
  workspaceGetTree,
  type WorkspaceSetDatasetOptions,
  type WorkspaceGetTreeOptions,
  type TreeNode,
  type TreeBranchNode,
  type TreeLeafNode,
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
  // Status
  executionGet,
  executionGetLatest,
  executionGetOutput,
  executionListIds,
  executionListForTask,
  executionList,
  // Find current execution for a task in workspace
  executionFindCurrent,
  type CurrentExecutionRef,
  // Logs
  executionReadLog,
  type LogReadOptions,
  // Note: LogChunk is exported from './storage/index.js' (aligned interface)
  // Command IR evaluation
  evaluateCommandIr,
} from './executions.js';

// UUID utilities (for execution history)
export { uuidv7, uuidv7Timestamp, isUuidv7 } from './uuid.js';

// Local process execution (in execution/ directory)
export {
  taskExecute,
  type ExecuteOptions,
  type ExecutionResult,
} from './execution/LocalTaskRunner.js';

// Process identification helpers (local execution support)
export {
  getBootId,
  getPidStartTime,
  isProcessAlive,
} from './execution/processHelpers.js';

// Dataflow execution
export {
  dataflowExecute,
  dataflowStart,
  dataflowGetGraph,
  dataflowGetReadyTasks,
  dataflowCheckCache,
  dataflowGetDependentsToSkip,
  dataflowResolveInputHashes,
  parsePathString,
  type DataflowGraph,
  type DataflowOptions,
  type DataflowResult,
  type TaskExecutionResult,
} from './dataflow.js';

// Resumable dataflow execution
export {
  // Types (re-exported from e3-types)
  type DataflowExecutionState,
  type DataflowExecutionStatus,
  type TaskState,
  type TaskStatus as DataflowTaskStatus,
  type ExecutionEvent,
  type DataflowGraph as DataflowGraphType,
  type DataflowGraphTask as DataflowGraphTaskType,
  // Result types (TypeScript-only)
  type InitializeResult,
  type PrepareTaskResult,
  type TaskExecuteResult,
  type TaskCompletedResult,
  type TaskFailedResult,
  type FinalizeResult,
  // Step functions
  stepInitialize,
  stepGetReady,
  stepPrepareTask,
  stepTaskStarted,
  stepTaskCompleted,
  stepTaskFailed,
  stepTasksSkipped,
  stepIsComplete,
  stepFinalize,
  stepCancel,
  type StepInitializeOptions,
  // State store
  type ExecutionStateStore,
  type TaskStatusDetails,
  type ExecutionStatusDetails,
  InMemoryStateStore,
  FileStateStore,
  // Orchestrator
  type DataflowOrchestrator,
  type ExecutionHandle,
  type ExecutionStatus as OrchestratorExecutionStatus,
  type OrchestratorStartOptions,
  type TaskCompletedCallback,
  LocalOrchestrator,
  stateToStatus,
  // API compatibility layer
  type ApiDataflowEventType,
  type ApiDataflowEvent,
  type ApiExecutionStatus,
  type ApiExecutionSummary,
  type ApiExecutionState,
  coreEventToApiEvent,
  coreStatusToApiStatus,
  coreStateToApiState,
} from './dataflow/index.js';

// Workspace locking (in storage/local/)
export {
  acquireWorkspaceLock,
  getWorkspaceLockState,
  getWorkspaceLockHolder,
  lockStateToHolderInfo,
  isLockHolderAlive,
  workspaceLockPath,
  type WorkspaceLockHandle,
  type AcquireLockOptions,
} from './storage/local/LocalLockService.js';

// Workspace status
export {
  workspaceStatus,
  type DatasetStatus,
  type TaskStatus,
  type DatasetStatusInfo,
  type TaskStatusInfo,
  type WorkspaceStatusResult,
} from './workspaceStatus.js';

// Errors
export {
  // Base
  E3Error,
  // Repository
  RepositoryNotFoundError,
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
  // Workspace
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  WorkspaceExistsError,
  WorkspaceLockError,
  type LockHolderInfo,
  // Package
  PackageNotFoundError,
  PackageInvalidError,
  PackageExistsError,
  // Dataset
  DatasetNotFoundError,
  // Task
  TaskNotFoundError,
  // Object
  ObjectNotFoundError,
  ObjectCorruptError,
  // Execution
  ExecutionCorruptError,
  ExecutionNotFoundError,
  // Dataflow
  DataflowError,
  DataflowAbortedError,
  // Generic
  PermissionDeniedError,
  // Helpers
  isNotFoundError,
  isPermissionError,
  isExistsError,
  wrapError,
} from './errors.js';
