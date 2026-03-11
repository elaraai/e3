/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API types for e3-api-client.
 *
 * Re-exports all API wire types from @elaraai/e3-types (the single source of truth).
 * Types with "Api" prefix in e3-types are re-exported here with shorter names
 * since API consumers don't see the conflicting domain types.
 */

// API wire types — re-export from @elaraai/e3-types
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
  PackageImportResultType,
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
  ApiExecutionStatusType as ExecutionStatusType,
  DataflowExecutionSummaryType,
  ApiDataflowExecutionStateType as DataflowExecutionStateType,
  // Task Execution History
  ExecutionHistoryStatusType,
  ExecutionListItemType,
  // Dataset List
  TreeKindType,
  ListEntryType,
  // Dataset Status Detail
  DatasetStatusDetailType,
  // Transfer types
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferDoneResponseType,
  PackageImportStatusType,
  PackageExportStatusType,
  // Graph types (from dataflow.ts, structurally identical to old API GraphTaskType)
  DataflowGraphType,
  DataflowGraphTaskType,
} from '@elaraai/e3-types';

// Value type aliases — re-export from @elaraai/e3-types
export type {
  Error,
  RepositoryStatus,
  GcRequest,
  GcResult,
  AsyncOperationStatus,
  GcStartResult,
  GcStatusResult,
  PackageListItem,
  PackageImportResult,
  PackageInfo,
  PackageDetails,
  WorkspaceInfo,
  WorkspaceCreateRequest,
  WorkspaceDeployRequest,
  DatasetStatus,
  ApiTaskStatus as TaskStatus,
  DatasetStatusInfo,
  TaskStatusInfo,
  WorkspaceStatusSummary,
  WorkspaceStatusResult,
  TaskListItem,
  TaskDetails,
  DataflowRequest,
  LogChunk,
  TaskExecutionResult,
  DataflowResult,
  DataflowEvent,
  ApiExecutionStatus as ExecutionStatus,
  DataflowExecutionSummary,
  ApiDataflowExecutionState as DataflowExecutionState,
  ExecutionHistoryStatus,
  ExecutionListItem,
  TreeKind,
  ListEntry,
  DatasetStatusDetail,
  TransferUploadRequest,
  TransferUploadResponse,
  TransferDoneResponse,
  PackageImportStatus,
  PackageExportStatus,
  DataflowGraph,
  DataflowGraphTask,
} from '@elaraai/e3-types';

// =============================================================================
// Namespace export for convenience
// =============================================================================

import {
  ErrorType,
  RepositoryNotFoundErrorType,
  WorkspaceNotFoundErrorType,
  WorkspaceNotDeployedErrorType,
  WorkspaceExistsErrorType,
  WorkspaceLockedErrorType,
  LockHolderType,
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
  ResponseType,
  RepositoryStatusType,
  GcRequestType,
  GcResultType,
  AsyncOperationStatusType,
  GcStartResultType,
  GcStatusResultType,
  PackageListItemType,
  PackageImportResultType,
  PackageInfoType,
  PackageDetailsType,
  WorkspaceCreateRequestType,
  WorkspaceInfoType,
  WorkspaceDeployRequestType,
  WorkspaceExportRequestType,
  DatasetStatusType,
  TaskStatusType,
  TaskStatusUpToDateType,
  TaskStatusWaitingType,
  TaskStatusInProgressType,
  TaskStatusFailedType,
  TaskStatusErrorType,
  TaskStatusStaleRunningType,
  DatasetStatusInfoType,
  TaskStatusInfoType,
  WorkspaceStatusSummaryType,
  WorkspaceStatusResultType,
  TaskListItemType,
  TaskDetailsType,
  DataflowRequestType,
  DataflowGraphType,
  DataflowGraphTaskType,
  LogChunkType,
  TaskExecutionResultType,
  DataflowResultType,
  DataflowEventType,
  ApiExecutionStatusType,
  DataflowExecutionSummaryType,
  ApiDataflowExecutionStateType,
  ExecutionHistoryStatusType,
  ExecutionListItemType,
  TreeKindType,
  ListEntryType,
  DatasetStatusDetailType,
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferDoneResponseType,
  PackageImportStatusType,
  PackageExportStatusType,
} from '@elaraai/e3-types';

export const ApiTypes = {
  // Errors
  ErrorType,
  RepositoryNotFoundErrorType,
  WorkspaceNotFoundErrorType,
  WorkspaceNotDeployedErrorType,
  WorkspaceExistsErrorType,
  WorkspaceLockedErrorType,
  LockHolderType,
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

  // Response
  ResponseType,

  // Repository
  RepositoryStatusType,
  GcRequestType,
  GcResultType,

  // Async Operations
  AsyncOperationStatusType,
  GcStartResultType,
  GcStatusResultType,

  // Packages
  PackageListItemType,
  PackageImportResultType,
  PackageInfoType,
  PackageDetailsType,

  // Workspaces
  WorkspaceCreateRequestType,
  WorkspaceInfoType,
  WorkspaceDeployRequestType,
  WorkspaceExportRequestType,

  // Workspace Status
  DatasetStatusType,
  TaskStatusType,
  TaskStatusUpToDateType,
  TaskStatusWaitingType,
  TaskStatusInProgressType,
  TaskStatusFailedType,
  TaskStatusErrorType,
  TaskStatusStaleRunningType,
  DatasetStatusInfoType,
  TaskStatusInfoType,
  WorkspaceStatusSummaryType,
  WorkspaceStatusResultType,

  // Tasks
  TaskListItemType,
  TaskDetailsType,

  // Execution
  DataflowRequestType,
  DataflowGraphType,
  DataflowGraphTaskType,
  LogChunkType,
  TaskExecutionResultType,
  DataflowResultType,

  // Execution State (polling)
  DataflowEventType,
  ExecutionStatusType: ApiExecutionStatusType,
  DataflowExecutionSummaryType,
  DataflowExecutionStateType: ApiDataflowExecutionStateType,

  // Task Execution History
  ExecutionHistoryStatusType,
  ExecutionListItemType,

  // Dataset List (recursive)
  TreeKindType,
  ListEntryType,

  // Dataset Status Detail (single dataset)
  DatasetStatusDetailType,

  // Transfer
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferDoneResponseType,
  PackageImportStatusType,
  PackageExportStatusType,
} as const;
