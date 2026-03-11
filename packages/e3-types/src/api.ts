/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * API wire types for e3.
 *
 * These East types define the request/response schemas used by the e3 REST API.
 * They are shared between e3-api-client and e3-api-server.
 *
 * Types that also serve as domain types (PackageImportResultType, DataflowGraphType,
 * DataflowGraphTaskType) are defined in their respective modules and re-exported here.
 *
 * Two types are prefixed with "Api" to avoid name conflicts with domain types
 * that have the same name but different structure:
 * - ApiExecutionStatusType (vs ExecutionStatusType in execution.ts — on-disk task status)
 * - ApiDataflowExecutionStateType (vs DataflowExecutionStateType in dataflow.ts — persistent state)
 */

import {
  VariantType,
  StructType,
  ArrayType,
  OptionType,
  StringType,
  IntegerType,
  FloatType,
  BooleanType,
  NullType,
  EastTypeType,
  type EastType,
  type ValueTypeOf,
} from '@elaraai/east';

import { StructureType, TreePathType } from './structure.js';

// =============================================================================
// Error Types
// =============================================================================

export const WorkspaceNotFoundErrorType = StructType({ workspace: StringType });
export const WorkspaceNotDeployedErrorType = StructType({ workspace: StringType });
export const WorkspaceExistsErrorType = StructType({ workspace: StringType });
export const LockHolderType = StructType({
  pid: IntegerType,
  acquiredAt: StringType,
  bootId: OptionType(StringType),
  command: OptionType(StringType),
});
export const WorkspaceLockedErrorType = StructType({
  workspace: StringType,
  holder: VariantType({ unknown: NullType, known: LockHolderType }),
});
export const PackageNotFoundErrorType = StructType({
  packageName: StringType,
  version: OptionType(StringType),
});
export const PackageExistsErrorType = StructType({ packageName: StringType, version: StringType });
export const PackageInvalidErrorType = StructType({ reason: StringType });
export const DatasetNotFoundErrorType = StructType({ workspace: StringType, path: StringType });
export const TaskNotFoundErrorType = StructType({ task: StringType });
export const ExecutionNotFoundErrorType = StructType({ task: StringType });
export const ObjectNotFoundErrorType = StructType({ hash: StringType });
export const DataflowErrorType = StructType({ message: StringType });
export const PermissionDeniedErrorType = StructType({ path: StringType });
export const InternalErrorType = StructType({ message: StringType });
export const RepositoryNotFoundErrorType = StructType({ repo: StringType });

export const ErrorType = VariantType({
  repository_not_found: RepositoryNotFoundErrorType,
  workspace_not_found: WorkspaceNotFoundErrorType,
  workspace_not_deployed: WorkspaceNotDeployedErrorType,
  workspace_exists: WorkspaceExistsErrorType,
  workspace_locked: WorkspaceLockedErrorType,
  package_not_found: PackageNotFoundErrorType,
  package_exists: PackageExistsErrorType,
  package_invalid: PackageInvalidErrorType,
  dataset_not_found: DatasetNotFoundErrorType,
  task_not_found: TaskNotFoundErrorType,
  execution_not_found: ExecutionNotFoundErrorType,
  object_not_found: ObjectNotFoundErrorType,
  dataflow_error: DataflowErrorType,
  dataflow_aborted: NullType,
  permission_denied: PermissionDeniedErrorType,
  internal: InternalErrorType,
});

// =============================================================================
// Response Wrapper
// =============================================================================

export const ResponseType = <T extends EastType>(successType: T) => VariantType({
  success: successType,
  error: ErrorType,
});

// =============================================================================
// Repository Types
// =============================================================================

/**
 * Repository status information.
 *
 * @property path - Absolute path to the e3 repository directory
 * @property objectCount - Number of content-addressed objects stored
 * @property packageCount - Number of imported packages
 * @property workspaceCount - Number of workspaces
 */
export const RepositoryStatusType = StructType({
  path: StringType,
  objectCount: IntegerType,
  packageCount: IntegerType,
  workspaceCount: IntegerType,
});

/**
 * Garbage collection request options.
 *
 * @property dryRun - If true, report what would be deleted without deleting
 * @property minAge - Minimum age in milliseconds for objects to be considered for deletion
 */
export const GcRequestType = StructType({
  dryRun: BooleanType,
  minAge: OptionType(IntegerType),
});

/**
 * Garbage collection result.
 *
 * @property deletedObjects - Number of unreferenced objects deleted
 * @property deletedPartials - Number of incomplete uploads deleted
 * @property retainedObjects - Number of objects still referenced
 * @property skippedYoung - Number of objects skipped due to minAge
 * @property bytesFreed - Total bytes freed by deletion
 */
export const GcResultType = StructType({
  deletedObjects: IntegerType,
  deletedPartials: IntegerType,
  retainedObjects: IntegerType,
  skippedYoung: IntegerType,
  bytesFreed: IntegerType,
});

// =============================================================================
// Async Operation Types
// =============================================================================

/**
 * Status of an async operation.
 *
 * - `running`: Operation is in progress
 * - `succeeded`: Operation completed successfully
 * - `failed`: Operation failed with an error
 */
export const AsyncOperationStatusType = VariantType({
  running: NullType,
  succeeded: NullType,
  failed: NullType,
});

/**
 * Result of starting an async GC operation.
 *
 * @property executionId - Unique identifier for this GC execution (UUID locally, Step Function ARN in cloud)
 */
export const GcStartResultType = StructType({
  executionId: StringType,
});

/**
 * Status of an async GC operation.
 *
 * @property status - Current execution status
 * @property stats - GC statistics (available when succeeded)
 * @property error - Error message (available when failed)
 */
export const GcStatusResultType = StructType({
  status: AsyncOperationStatusType,
  stats: OptionType(GcResultType),
  error: OptionType(StringType),
});

// =============================================================================
// Package Types
// =============================================================================

/**
 * Package list item (summary info).
 *
 * @property name - Package name
 * @property version - Semantic version string
 */
export const PackageListItemType = StructType({
  name: StringType,
  version: StringType,
});

/**
 * Basic package info.
 *
 * @property name - Package name
 * @property version - Semantic version string
 * @property hash - SHA256 content hash
 */
export const PackageInfoType = StructType({
  name: StringType,
  version: StringType,
  hash: StringType,
});

/**
 * Detailed package information including structure.
 *
 * @property name - Package name
 * @property version - Semantic version string
 * @property hash - SHA256 content hash
 * @property tasks - List of task names defined in the package
 * @property dataStructure - East structure type describing the package's data schema
 */
export const PackageDetailsType = StructType({
  name: StringType,
  version: StringType,
  hash: StringType,
  tasks: ArrayType(StringType),
  dataStructure: StructureType,
});

// =============================================================================
// Workspace Types
// =============================================================================

/**
 * Request to create a new workspace.
 *
 * @property name - Unique workspace name
 */
export const WorkspaceCreateRequestType = StructType({
  name: StringType,
});

/**
 * Workspace summary information.
 *
 * @property name - Workspace name
 * @property deployed - Whether a package is deployed to this workspace
 * @property packageName - Name of deployed package (if deployed)
 * @property packageVersion - Version of deployed package (if deployed)
 */
export const WorkspaceInfoType = StructType({
  name: StringType,
  deployed: BooleanType,
  packageName: OptionType(StringType),
  packageVersion: OptionType(StringType),
});

/**
 * Request to deploy a package to a workspace.
 *
 * @property packageRef - Package reference in format "name" or "name@version"
 */
export const WorkspaceDeployRequestType = StructType({
  packageRef: StringType,
});

/**
 * Workspace export request body.
 *
 * @property name - Optional custom package name
 * @property version - Optional custom version
 */
export const WorkspaceExportRequestType = StructType({
  name: OptionType(StringType),
  version: OptionType(StringType),
});

// =============================================================================
// Workspace Status Types
// =============================================================================

/**
 * Dataset status variant.
 *
 * - `unset`: No value assigned to this dataset
 * - `stale`: Value exists but is outdated (upstream changed)
 * - `up-to-date`: Value is current
 */
export const DatasetStatusType = VariantType({
  unset: NullType,
  stale: NullType,
  'up-to-date': NullType,
});

/** Task completed successfully. @property cached - True if result was from cache */
export const TaskStatusUpToDateType = StructType({ cached: BooleanType });

/** Task waiting on dependencies. @property reason - Human-readable wait reason */
export const TaskStatusWaitingType = StructType({ reason: StringType });

/** Task currently executing. */
export const TaskStatusInProgressType = StructType({
  /** Process ID of the running task */
  pid: OptionType(IntegerType),
  /** ISO timestamp when execution started */
  startedAt: OptionType(StringType),
});

/** Task exited with non-zero code. */
export const TaskStatusFailedType = StructType({
  /** Process exit code */
  exitCode: IntegerType,
  /** ISO timestamp when task completed */
  completedAt: OptionType(StringType),
});

/** Task encountered an internal error. */
export const TaskStatusErrorType = StructType({
  /** Error message */
  message: StringType,
  /** ISO timestamp when error occurred */
  completedAt: OptionType(StringType),
});

/** Task was running but process is no longer alive. */
export const TaskStatusStaleRunningType = StructType({
  /** Last known process ID */
  pid: OptionType(IntegerType),
  /** ISO timestamp when execution started */
  startedAt: OptionType(StringType),
});

/**
 * Task execution status variant.
 *
 * - `up-to-date`: Task completed successfully (cached indicates if from cache)
 * - `ready`: Task is ready to run (all inputs available)
 * - `waiting`: Task waiting on upstream dependencies
 * - `in-progress`: Task currently executing
 * - `failed`: Task exited with non-zero exit code
 * - `error`: Internal error during task execution
 * - `stale-running`: Task was marked running but process died
 */
export const TaskStatusType = VariantType({
  'up-to-date': TaskStatusUpToDateType,
  ready: NullType,
  waiting: TaskStatusWaitingType,
  'in-progress': TaskStatusInProgressType,
  failed: TaskStatusFailedType,
  error: TaskStatusErrorType,
  'stale-running': TaskStatusStaleRunningType,
});

/**
 * Status information for a single dataset.
 *
 * @property path - Dataset path (e.g., ".inputs.config" or ".tasks.foo.output")
 * @property status - Current status (unset, stale, or up-to-date)
 * @property hash - SHA256 hash of current value (if set)
 * @property isTaskOutput - True if this dataset is produced by a task
 * @property producedBy - Name of task that produces this dataset (if isTaskOutput)
 */
export const DatasetStatusInfoType = StructType({
  path: StringType,
  status: DatasetStatusType,
  hash: OptionType(StringType),
  isTaskOutput: BooleanType,
  producedBy: OptionType(StringType),
});

/**
 * Status information for a single task.
 *
 * @property name - Task name
 * @property hash - Task definition hash (changes when task code changes)
 * @property status - Current execution status
 * @property inputs - Dataset paths this task reads from
 * @property output - Dataset path this task writes to
 * @property dependsOn - Names of tasks that must complete before this one
 */
export const TaskStatusInfoType = StructType({
  name: StringType,
  hash: StringType,
  status: TaskStatusType,
  inputs: ArrayType(StringType),
  output: StringType,
  dependsOn: ArrayType(StringType),
});

/**
 * Summary counts for workspace status.
 */
export const WorkspaceStatusSummaryType = StructType({
  /** Dataset status counts */
  datasets: StructType({
    total: IntegerType,
    unset: IntegerType,
    stale: IntegerType,
    upToDate: IntegerType,
  }),
  /** Task status counts */
  tasks: StructType({
    total: IntegerType,
    upToDate: IntegerType,
    ready: IntegerType,
    waiting: IntegerType,
    inProgress: IntegerType,
    failed: IntegerType,
    error: IntegerType,
    staleRunning: IntegerType,
  }),
});

/**
 * Complete workspace status including all datasets, tasks, and summary.
 *
 * @property workspace - Workspace name
 * @property lock - Information about current lock holder (if locked)
 * @property datasets - Status of all datasets in the workspace
 * @property tasks - Status of all tasks in the workspace
 * @property summary - Aggregated counts by status
 */
export const WorkspaceStatusResultType = StructType({
  workspace: StringType,
  lock: OptionType(LockHolderType),
  datasets: ArrayType(DatasetStatusInfoType),
  tasks: ArrayType(TaskStatusInfoType),
  summary: WorkspaceStatusSummaryType,
});

// =============================================================================
// Task Types
// =============================================================================

/**
 * Task list item (summary info).
 *
 * @property name - Task name
 * @property hash - Task definition hash
 */
export const TaskListItemType = StructType({
  name: StringType,
  hash: StringType,
});

/**
 * Detailed task information.
 *
 * @property name - Task name
 * @property hash - Task definition hash
 * @property commandIr - East IR for the task's command
 * @property inputs - Tree paths for task inputs
 * @property output - Tree path for task output
 */
export const TaskDetailsType = StructType({
  name: StringType,
  hash: StringType,
  commandIr: StringType,
  inputs: ArrayType(TreePathType),
  output: TreePathType,
});

// =============================================================================
// Execution Types
// =============================================================================

/**
 * Request to start dataflow execution.
 *
 * @property concurrency - Maximum parallel tasks (default: 4)
 * @property force - Force re-execution of all tasks
 * @property filter - Filter to specific task names (glob pattern)
 */
export const DataflowRequestType = StructType({
  concurrency: OptionType(IntegerType),
  force: BooleanType,
  filter: OptionType(StringType),
});

/**
 * Chunk of log data from task execution.
 *
 * @property data - Log content (UTF-8 text)
 * @property offset - Byte offset from start of log
 * @property size - Size of this chunk in bytes
 * @property totalSize - Total size of the log file
 * @property complete - True if this chunk reaches end of file
 */
export const LogChunkType = StructType({
  data: StringType,
  offset: IntegerType,
  size: IntegerType,
  totalSize: IntegerType,
  complete: BooleanType,
});

/**
 * Result of executing a single task.
 *
 * @property name - Task name
 * @property cached - True if result was retrieved from cache
 * @property state - Execution outcome (success, failed, error, skipped)
 * @property duration - Execution time in seconds
 */
export const TaskExecutionResultType = StructType({
  name: StringType,
  cached: BooleanType,
  state: VariantType({
    success: NullType,
    failed: StructType({ exitCode: IntegerType }),
    error: StructType({ message: StringType }),
    skipped: NullType,
  }),
  duration: FloatType,
});

/**
 * Result of dataflow execution.
 *
 * @property success - True if all tasks completed successfully
 * @property executed - Number of tasks that were executed
 * @property cached - Number of tasks that used cached results
 * @property failed - Number of tasks that failed
 * @property skipped - Number of tasks that were skipped
 * @property tasks - Per-task execution results
 * @property duration - Total execution time in seconds
 */
export const DataflowResultType = StructType({
  success: BooleanType,
  executed: IntegerType,
  cached: IntegerType,
  failed: IntegerType,
  skipped: IntegerType,
  tasks: ArrayType(TaskExecutionResultType),
  duration: FloatType,
});

// =============================================================================
// Dataflow Execution State Types (for API polling)
// =============================================================================

/**
 * Dataflow event types for API polling.
 *
 * - `start`: Task started executing
 * - `complete`: Task executed and succeeded
 * - `cached`: Task result retrieved from cache (no execution)
 * - `failed`: Task exited with non-zero code
 * - `error`: Internal error during task execution
 * - `input_unavailable`: Task couldn't run because inputs not available
 */
export const DataflowEventType = VariantType({
  start: StructType({
    task: StringType,
    timestamp: StringType,
  }),
  complete: StructType({
    task: StringType,
    timestamp: StringType,
    duration: FloatType,
  }),
  cached: StructType({
    task: StringType,
    timestamp: StringType,
  }),
  failed: StructType({
    task: StringType,
    timestamp: StringType,
    duration: FloatType,
    exitCode: IntegerType,
  }),
  error: StructType({
    task: StringType,
    timestamp: StringType,
    message: StringType,
  }),
  input_unavailable: StructType({
    task: StringType,
    timestamp: StringType,
    reason: StringType,
  }),
});

/**
 * Execution status for API polling responses.
 *
 * - `running`: Execution is in progress
 * - `completed`: Execution finished successfully
 * - `failed`: Execution finished with failures
 * - `aborted`: Execution was cancelled
 *
 * Note: Named "Api*" to distinguish from the on-disk ExecutionStatusType
 * in execution.ts which tracks individual task execution states.
 */
export const ApiExecutionStatusType = VariantType({
  running: NullType,
  completed: NullType,
  failed: NullType,
  aborted: NullType,
});

/**
 * Summary of dataflow execution results.
 */
export const DataflowExecutionSummaryType = StructType({
  executed: IntegerType,
  cached: IntegerType,
  failed: IntegerType,
  skipped: IntegerType,
  duration: FloatType,
});

/**
 * Dataflow execution state returned by API polling.
 *
 * A lightweight view of the execution state for client polling.
 *
 * Note: Named "Api*" to distinguish from the persistent
 * DataflowExecutionStateType in dataflow.ts which stores the full
 * execution state on disk.
 *
 * @property status - Current execution status
 * @property startedAt - ISO timestamp when execution started
 * @property completedAt - ISO timestamp when execution finished (if done)
 * @property summary - Execution summary (available when complete)
 * @property events - Task events (may be paginated via offset/limit)
 * @property totalEvents - Total number of events (for pagination)
 */
export const ApiDataflowExecutionStateType = StructType({
  status: ApiExecutionStatusType,
  startedAt: StringType,
  completedAt: OptionType(StringType),
  summary: OptionType(DataflowExecutionSummaryType),
  events: ArrayType(DataflowEventType),
  totalEvents: IntegerType,
});

// =============================================================================
// Task Execution History Types
// =============================================================================

/**
 * Execution status for history listing.
 */
export const ExecutionHistoryStatusType = VariantType({
  running: NullType,
  success: NullType,
  failed: NullType,
  error: NullType,
});

/**
 * A single execution in task history.
 *
 * @property inputsHash - Hash of concatenated inputs (execution identifier)
 * @property inputHashes - Individual input object hashes
 * @property status - Execution outcome
 * @property startedAt - ISO timestamp when execution started
 * @property completedAt - ISO timestamp when execution finished (if done)
 * @property duration - Execution duration in milliseconds (if done)
 * @property exitCode - Process exit code (if failed)
 */
export const ExecutionListItemType = StructType({
  inputsHash: StringType,
  inputHashes: ArrayType(StringType),
  status: ExecutionHistoryStatusType,
  startedAt: StringType,
  completedAt: OptionType(StringType),
  duration: OptionType(IntegerType),
  exitCode: OptionType(IntegerType),
});

// =============================================================================
// Dataset List Types (recursive)
// =============================================================================

/**
 * Tree branch kind variant.
 *
 * Currently only `struct` branches exist. Future: `dict`, `array`, `variant`.
 */
export const TreeKindType = VariantType({ struct: NullType });

/**
 * A list entry -- either a dataset leaf or a tree branch.
 *
 * Used by the `?list=true&status=true` endpoints to return both
 * tree structure entries and dataset leaves in a single flat list.
 */
export const ListEntryType = VariantType({
  dataset: StructType({
    path: StringType,
    type: EastTypeType,
    hash: OptionType(StringType),
    size: OptionType(IntegerType),
  }),
  tree: StructType({
    path: StringType,
    kind: TreeKindType,
  }),
});

// =============================================================================
// Dataset Status Detail Types (single dataset query)
// =============================================================================

/**
 * Detailed status of a single dataset.
 *
 * @property path - Dataset path (e.g., ".inputs.config")
 * @property type - East type of the dataset
 * @property refType - Ref type: "unassigned", "null", or "value"
 * @property hash - Object hash (None if unassigned/null)
 * @property size - Size in bytes (None if unassigned)
 */
export const DatasetStatusDetailType = StructType({
  path: StringType,
  type: EastTypeType,
  refType: StringType,
  hash: OptionType(StringType),
  size: OptionType(IntegerType),
});

// =============================================================================
// Value type aliases
// =============================================================================

export type Error = ValueTypeOf<typeof ErrorType>;
export type RepositoryStatus = ValueTypeOf<typeof RepositoryStatusType>;
export type GcRequest = ValueTypeOf<typeof GcRequestType>;
export type GcResult = ValueTypeOf<typeof GcResultType>;
export type AsyncOperationStatus = ValueTypeOf<typeof AsyncOperationStatusType>;
export type GcStartResult = ValueTypeOf<typeof GcStartResultType>;
export type GcStatusResult = ValueTypeOf<typeof GcStatusResultType>;
export type PackageListItem = ValueTypeOf<typeof PackageListItemType>;
export type PackageInfo = ValueTypeOf<typeof PackageInfoType>;
export type PackageDetails = ValueTypeOf<typeof PackageDetailsType>;
export type WorkspaceInfo = ValueTypeOf<typeof WorkspaceInfoType>;
export type WorkspaceCreateRequest = ValueTypeOf<typeof WorkspaceCreateRequestType>;
export type WorkspaceDeployRequest = ValueTypeOf<typeof WorkspaceDeployRequestType>;
export type DatasetStatus = ValueTypeOf<typeof DatasetStatusType>;
export type TaskStatus = ValueTypeOf<typeof TaskStatusType>;
export type DatasetStatusInfo = ValueTypeOf<typeof DatasetStatusInfoType>;
export type TaskStatusInfo = ValueTypeOf<typeof TaskStatusInfoType>;
export type WorkspaceStatusSummary = ValueTypeOf<typeof WorkspaceStatusSummaryType>;
export type WorkspaceStatusResult = ValueTypeOf<typeof WorkspaceStatusResultType>;
export type TaskListItem = ValueTypeOf<typeof TaskListItemType>;
export type TaskDetails = ValueTypeOf<typeof TaskDetailsType>;
export type DataflowRequest = ValueTypeOf<typeof DataflowRequestType>;
export type LogChunk = ValueTypeOf<typeof LogChunkType>;
export type TaskExecutionResult = ValueTypeOf<typeof TaskExecutionResultType>;
export type DataflowResult = ValueTypeOf<typeof DataflowResultType>;
export type DataflowEvent = ValueTypeOf<typeof DataflowEventType>;
export type ApiExecutionStatus = ValueTypeOf<typeof ApiExecutionStatusType>;
export type DataflowExecutionSummary = ValueTypeOf<typeof DataflowExecutionSummaryType>;
export type ApiDataflowExecutionState = ValueTypeOf<typeof ApiDataflowExecutionStateType>;
export type ExecutionHistoryStatus = ValueTypeOf<typeof ExecutionHistoryStatusType>;
export type ExecutionListItem = ValueTypeOf<typeof ExecutionListItemType>;
export type TreeKind = ValueTypeOf<typeof TreeKindType>;
export type ListEntry = ValueTypeOf<typeof ListEntryType>;
export type DatasetStatusDetail = ValueTypeOf<typeof DatasetStatusDetailType>;
