/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Package object and manifest types for e3.
 *
 * A package bundles everything needed to run computations:
 * tasks, dataset structure, initial data, and dataflow definitions.
 */

import { StructType, StringType, DictType, ValueTypeOf } from '@elaraai/east';
import { DatasetSchemaType } from './schema.js';
import { DataflowDefType } from './dataflow.js';

/**
 * Dataset configuration in a package.
 *
 * Defines the structure (schema) and initial values (root tree hash).
 *
 * @remarks
 * - `schema`: Defines which nodes are values vs trees (recursive)
 * - `value`: Hash of the root tree object in the object store
 *
 * @example
 * ```ts
 * const datasets: PackageDatasets = {
 *   schema: variant('struct', new Map([
 *     ['inputs', variant('struct', new Map([
 *       ['sales', variant('value', variant('Array', variant('Integer', null)))],
 *     ]))],
 *     ['outputs', variant('struct', new Map([
 *       ['result', variant('value', variant('Integer', null))],
 *     ]))],
 *   ])),
 *   value: 'abc123...',  // Hash of initial tree
 * };
 * ```
 */
export const PackageDatasetsType = StructType({
  /** Schema defining tree structure (what's a tree vs value) */
  schema: DatasetSchemaType,
  /** Hash of the root tree object containing initial/default values */
  value: StringType,
});
export type PackageDatasetsType = typeof PackageDatasetsType;

export type PackageDatasets = ValueTypeOf<typeof PackageDatasetsType>;

/**
 * Package object stored in the object store.
 *
 * Packages are the unit of distribution and deployment in e3.
 * They are immutable and content-addressed by their hash.
 *
 * @remarks
 * Package identity (name/version) is stored in the manifest, not here.
 * This allows the same package contents to be referenced under different names.
 *
 * @example
 * ```ts
 * const pkg: PackageObject = {
 *   tasks: new Map([['process', 'abc123...']]),
 *   datasets: { schema: ..., value: 'def456...' },
 *   dataflows: new Map([
 *     ['process-sales', variant('task', { task: 'process', inputs: [...], output: [...] })],
 *   ]),
 * };
 * ```
 */
export const PackageObjectType = StructType({
  /** Tasks defined in this package: name -> task object hash */
  tasks: DictType(StringType, StringType),
  /** Dataset structure and initial values */
  datasets: PackageDatasetsType,
  /** Named dataflow definitions for orchestration */
  dataflows: DictType(StringType, DataflowDefType),
});
export type PackageObjectType = typeof PackageObjectType;

export type PackageObject = ValueTypeOf<typeof PackageObjectType>;

/**
 * Package manifest stored in bundled .zip files.
 *
 * The manifest provides the human-readable identity (name/version)
 * and points to the package object by hash.
 *
 * @remarks
 * When deploying to a workspace, we look up by name/version and
 * diff the package contents for efficient updates.
 *
 * @example
 * ```ts
 * const manifest: PackageManifest = {
 *   name: 'acme-forecast',
 *   version: '0.21.1',
 *   root: 'abc123...',  // Hash of PackageObject
 * };
 * ```
 */
export const PackageManifestType = StructType({
  /** Package name (e.g., "acme-forecast") */
  name: StringType,
  /** Package version (e.g., "0.21.1") */
  version: StringType,
  /** Hash of the PackageObject in the bundle */
  root: StringType,
});
export type PackageManifestType = typeof PackageManifestType;

export type PackageManifest = ValueTypeOf<typeof PackageManifestType>;
