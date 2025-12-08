/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * e3-types: Shared type definitions for e3 (East Execution Engine)
 *
 * This package defines the East types used for serializing e3 objects:
 * - Data references and tree structures
 * - Task definitions
 * - Package manifests
 * - Dataset schemas and paths
 * - Dataflow definitions
 * - Repository configuration
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

// Dataset schemas and paths
export {
  DatasetSchemaType,
  type DatasetSchema,
  PathSegmentType,
  type PathSegment,
  TreePathType,
  type TreePath,
  type ParsePathResult,
  treePath,
  pathToString,
  parsePath,
} from './schema.js';

// Dataflow definitions
export {
  TaskDataflowType,
  type TaskDataflow,
  DataflowDefType,
  type DataflowDef,
} from './dataflow.js';

// Package objects
export {
  PackageDatasetsType,
  type PackageDatasets,
  PackageObjectType,
  type PackageObject,
  PackageManifestType,
  type PackageManifest,
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
