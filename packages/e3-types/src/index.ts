/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-types: Shared type definitions for e3 (East Execution Engine)
 *
 * This package defines the East types used for serializing e3 objects:
 * - Data references and tree structures
 * - Task definitions
 * - Package manifests
 * - Data structure and paths
 * - Task bindings
 * - Repository configuration
 *
 * Terminology:
 * - **Dataset**: A location holding a value (leaf node)
 * - **Tree**: A location containing other locations (branch node)
 * - **Structure**: The shape of the data tree
 * - **Task**: A computation (reads datasets, produces a dataset)
 * - **Task binding**: Connects a task to specific dataset paths
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

// Task definitions
export {
  TaskInputType,
  type TaskInput,
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
  treePath,
  pathToString,
  parsePath,
  // Backwards compatibility
  DatasetSchemaType,
  type DatasetSchema,
} from './schema.js';

// Task bindings
export {
  TaskBindingType,
  type TaskBinding,
  BindingDefType,
  type BindingDef,
  // Backwards compatibility
  TaskDataflowType,
  type TaskDataflow,
  DataflowDefType,
  type DataflowDef,
} from './dataflow.js';

// Package objects
export {
  PackageDataType,
  type PackageData,
  PackageObjectType,
  type PackageObject,
  PackageManifestType,
  type PackageManifest,
  // Backwards compatibility
  PackageDatasetsType,
  type PackageDatasets,
} from './package.js';

// Configuration
export {
  InputPartType,
  type InputPart,
  CommandPartType,
  type CommandPart,
  RunnersConfigType,
  type RunnersConfig,
  ConfigType,
  type Config,
  emptyConfig,
} from './config.js';
