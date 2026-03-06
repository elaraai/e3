/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Package object types for e3.
 *
 * A package bundles everything needed to run computations:
 * tasks and data structure with initial values.
 *
 * Terminology:
 * - **Package**: A deployable bundle of tasks and data structure
 * - **Structure**: The shape of the data tree
 * - **Task**: A computation with input/output paths (stored separately)
 */

import { StructType, StringType, IntegerType, VariantType, NullType, DictType, ValueTypeOf } from '@elaraai/east';
import { DatasetRefType } from './dataset-ref.js';
import { StructureType } from './structure.js';

/**
 * Data configuration in a package.
 *
 * Defines the structure (which paths are datasets vs trees)
 * and initial values (root tree hash).
 *
 * @remarks
 * - `structure`: Defines which paths are datasets vs trees (recursive)
 * - `refs`: Per-dataset refs mapping refPath to DatasetRef (replaces old root tree hash)
 */
export const PackageDataType = StructType({
  /** Structure defining tree shape (what's a group vs dataset) */
  structure: StructureType,
  /** Per-dataset refs: refPath (e.g. "inputs/greeting") -> DatasetRef */
  refs: DictType(StringType, DatasetRefType),
});
export type PackageDataType = typeof PackageDataType;

export type PackageData = ValueTypeOf<typeof PackageDataType>;

// Backwards compatibility alias
/** @deprecated Use PackageDataType instead */
export const PackageDatasetsType = PackageDataType;
/** @deprecated Use PackageData instead */
export type PackageDatasetsType = PackageDataType;
/** @deprecated Use PackageData instead */
export type PackageDatasets = PackageData;

/**
 * Package object stored in the object store.
 *
 * Packages are the unit of distribution and deployment in e3.
 * They are immutable and content-addressed by their hash.
 *
 * @remarks
 * - `tasks`: Maps task names to task object hashes. Each task object
 *   contains runner, input paths, and output path.
 * - `data`: The structure and initial values for the data tree.
 *
 * Package identity (name/version) is determined by the path in the
 * bundle's `packages/<name>/<version>` directory structure.
 *
 * @example
 * ```ts
 * const pkg: PackageObject = {
 *   tasks: new Map([['process', 'abc123...']]),  // hash of TaskObject
 *   data: {
 *     structure: variant('struct', new Map([...])),
 *     refs: new Map([['inputs/sales', variant('value', { hash: 'def456...', versions: new Map() })]]),
 *   },
 * };
 * ```
 */
export const PackageObjectType = StructType({
  /** Tasks defined in this package: name -> task object hash */
  tasks: DictType(StringType, StringType),
  /** Data structure and initial values */
  data: PackageDataType,
});
export type PackageObjectType = typeof PackageObjectType;

export type PackageObject = ValueTypeOf<typeof PackageObjectType>;

// =============================================================================
// Package Transfer Types
// =============================================================================

export const PackageTransferInitRequestType = StructType({
  size: IntegerType,
});
export type PackageTransferInitRequest = ValueTypeOf<typeof PackageTransferInitRequestType>;

export const PackageTransferInitResponseType = StructType({
  transferId: StringType,
  uploadUrl: StringType,
});
export type PackageTransferInitResponse = ValueTypeOf<typeof PackageTransferInitResponseType>;

export const PackageExportRequestType = StructType({
  name: StringType,
  version: StringType,
});
export type PackageExportRequest = ValueTypeOf<typeof PackageExportRequestType>;

export const PackageJobResponseType = StructType({
  jobId: StringType,
});
export type PackageJobResponse = ValueTypeOf<typeof PackageJobResponseType>;

export const PackageImportResultType = StructType({
  name: StringType,
  version: StringType,
  packageHash: StringType,
  objectCount: IntegerType,
});
export type PackageImportResult = ValueTypeOf<typeof PackageImportResultType>;

export const PackageExportResultType = StructType({
  downloadUrl: StringType,
  size: IntegerType,
});
export type PackageExportResult = ValueTypeOf<typeof PackageExportResultType>;

export const PackageJobStatusType = VariantType({
  processing: NullType,
  completed: VariantType({
    import: PackageImportResultType,
    export: PackageExportResultType,
  }),
  failed: StructType({
    message: StringType,
  }),
});
export type PackageJobStatus = ValueTypeOf<typeof PackageJobStatusType>;
