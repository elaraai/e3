/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-types: Shared type definitions for e3 (East Execution Engine)
 *
 * This package defines the East types used for serializing e3 objects:
 * - Data references and tree structures
 * - Task definitions (command IR, input/output paths)
 * - Package objects
 * - Data structure and paths
 * - Workspace state
 * - Execution status
 *
 * Terminology:
 * - **Dataset**: A location holding a value (leaf node)
 * - **Tree**: A location containing other locations (branch node)
 * - **Structure**: The shape of the data tree
 * - **Task**: A computation with command IR and input/output paths
 * - **Path**: An address in the data tree
 */

// Data references and trees
export {
  DataRefType,
  type DataRef,
  unassignedRef,
  nullRef,
  DataTreeType,
} from './dataset.js';

// Per-dataset refs and version vectors (reactive dataflow)
export {
  VersionVectorType,
  type VersionVector,
  DatasetRefType,
  type DatasetRef,
} from './dataset-ref.js';

// Task definitions
export {
  TaskObjectType,
  type TaskObject,
} from './task.js';

// Data structure and paths
export {
  StructureType,
  type Structure,
  PathSegmentType,
  type PathSegment,
  TreePathType,
  type TreePath,
  type ParsePathResult,
  type ParseDatasetPathResult,
  type ParsePackageRefResult,
  treePath,
  pathToString,
  parsePath,
  parseDatasetPath,
  parsePackageRef,
  urlPathToTreePath,
  // Backwards compatibility
  DatasetSchemaType,
  type DatasetSchema,
} from './structure.js';

// Package objects
export {
  PackageDataType,
  type PackageData,
  PackageObjectType,
  type PackageObject,
  // Backwards compatibility
  PackageDatasetsType,
  type PackageDatasets,
  // Package transfer types
  PackageTransferInitRequestType,
  type PackageTransferInitRequest,
  PackageTransferInitResponseType,
  type PackageTransferInitResponse,
  PackageJobResponseType,
  type PackageJobResponse,
  PackageImportResultType,
  type PackageImportResult,
  PackageExportResultType,
  type PackageExportResult,
  PackageImportProgressType,
  type PackageImportProgress,
  PackageImportStatusType,
  type PackageImportStatus,
  PackageExportProgressType,
  type PackageExportProgress,
  PackageExportStatusType,
  type PackageExportStatus,
} from './package.js';

// Workspace state
export {
  WorkspaceStateType,
  type WorkspaceState,
} from './workspace.js';

// Execution status
export {
  ExecutionStatusType,
  type ExecutionStatus,
} from './execution.js';

// Lock state
export {
  LockOperationType,
  type LockOperation,
  ProcessHolderType,
  type ProcessHolder,
  LockStateType,
  type LockState,
} from './lock.js';

// Dataset transfer types
export {
  TransferUploadRequestType,
  type TransferUploadRequest,
  TransferUploadResponseType,
  type TransferUploadResponse,
  TransferDoneResponseType,
  type TransferDoneResponse,
} from './transfer.js';

// Wire format constants
export { BEAST2_CONTENT_TYPE } from './constants.js';

// API wire types (shared between e3-api-client and e3-api-server)
export {
  // Error types
  WorkspaceNotFoundErrorType,
  WorkspaceNotDeployedErrorType,
  WorkspaceExistsErrorType,
  LockHolderType,
  WorkspaceLockedErrorType,
  PackageNotFoundErrorType,
  PackageExistsErrorType,
  PackageInvalidErrorType,
  DatasetNotFoundErrorType,
  TaskNotFoundErrorType,
  ExecutionNotFoundErrorType,
  ObjectNotFoundErrorType,
  DataflowErrorType,
  PermissionDeniedErrorType,
  InternalErrorType,
  RepositoryNotFoundErrorType,
  ErrorType,
  ResponseType,
  // Repository
  RepositoryStatusType,
  GcRequestType,
  GcResultType,
  AsyncOperationStatusType,
  GcStartResultType,
  GcStatusResultType,
  // Packages
  PackageListItemType,
  PackageInfoType,
  PackageDetailsType,
  // Workspaces
  WorkspaceCreateRequestType,
  WorkspaceInfoType,
  WorkspaceDeployRequestType,
  WorkspaceExportRequestType,
  // Workspace Status
  DatasetStatusType,
  TaskStatusUpToDateType,
  TaskStatusWaitingType,
  TaskStatusInProgressType,
  TaskStatusFailedType,
  TaskStatusErrorType,
  TaskStatusStaleRunningType,
  TaskStatusType,
  DatasetStatusInfoType,
  TaskStatusInfoType,
  WorkspaceStatusSummaryType,
  WorkspaceStatusResultType,
  // Tasks
  TaskListItemType,
  TaskDetailsType,
  // Execution
  DataflowRequestType,
  LogChunkType,
  TaskExecutionResultType,
  DataflowResultType,
  // Dataflow API polling
  DataflowEventType,
  ApiExecutionStatusType,
  DataflowExecutionSummaryType,
  ApiDataflowExecutionStateType,
  // Task Execution History
  ExecutionHistoryStatusType,
  ExecutionListItemType,
  // Dataset List
  TreeKindType,
  ListEntryType,
  // Dataset Status Detail
  DatasetStatusDetailType,
  // Type aliases
  type Error,
  type RepositoryStatus,
  type GcRequest,
  type GcResult,
  type AsyncOperationStatus,
  type GcStartResult,
  type GcStatusResult,
  type PackageListItem,
  type PackageInfo,
  type PackageDetails,
  type WorkspaceInfo,
  type WorkspaceCreateRequest,
  type WorkspaceDeployRequest,
  type DatasetStatus,
  type TaskStatus as ApiTaskStatus,
  type DatasetStatusInfo,
  type TaskStatusInfo,
  type WorkspaceStatusSummary,
  type WorkspaceStatusResult,
  type TaskListItem,
  type TaskDetails,
  type DataflowRequest,
  type LogChunk,
  type TaskExecutionResult,
  type DataflowResult,
  type DataflowEvent,
  type ApiExecutionStatus,
  type DataflowExecutionSummary,
  type ApiDataflowExecutionState,
  type ExecutionHistoryStatus,
  type ExecutionListItem,
  type TreeKind,
  type ListEntry,
  type DatasetStatusDetail,
} from './api.js';

// Dataflow execution state
export {
  type DataflowExecutionStatus,
  type TaskStatus,
  TaskStateType,
  type TaskState,
  DataflowGraphTaskType,
  type DataflowGraphTask,
  DataflowGraphType,
  type DataflowGraph,
  ExecutionEventType,
  type ExecutionEvent,
  DataflowExecutionStateType,
  type DataflowExecutionState,
  // Dataflow run history
  DataflowRunStatusType,
  type DataflowRunStatus,
  TaskExecutionRecordType,
  type TaskExecutionRecord,
  DataflowRunSummaryType,
  type DataflowRunSummary,
  DataflowRunType,
  type DataflowRun,
} from './dataflow.js';
