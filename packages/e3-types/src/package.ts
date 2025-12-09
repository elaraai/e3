/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Package object and manifest types for e3.
 *
 * A package bundles everything needed to run computations:
 * tasks, data structure, initial datasets, and task bindings.
 *
 * Terminology:
 * - **Package**: A deployable bundle of tasks and data structure
 * - **Structure**: The shape of the data tree
 * - **Task binding**: Rules for running tasks on datasets
 */

import { StructType, StringType, DictType, ValueTypeOf } from '@elaraai/east';
import { StructureType } from './schema.js';
import { BindingDefType } from './dataflow.js';

/**
 * Data configuration in a package.
 *
 * Defines the structure (which paths are datasets vs trees)
 * and initial values (root tree hash).
 *
 * @remarks
 * - `structure`: Defines which paths are datasets vs trees (recursive)
 * - `value`: Hash of the root tree object in the object store
 *
 * @example
 * ```ts
 * const data: PackageData = {
 *   structure: variant('struct', new Map([
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
export const PackageDataType = StructType({
  /** Structure defining tree shape (what's a group vs dataset) */
  structure: StructureType,
  /** Hash of the root tree object containing initial/default values */
  value: StringType,
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
 * Package identity (name/version) is stored in the manifest, not here.
 * This allows the same package contents to be referenced under different names.
 *
 * @example
 * ```ts
 * const pkg: PackageObject = {
 *   tasks: new Map([['process', 'abc123...']]),
 *   data: { structure: ..., value: 'def456...' },
 *   bindings: new Map([
 *     ['process-sales', variant('task', { task: 'process', inputs: [...], output: [...] })],
 *   ]),
 * };
 * ```
 */
export const PackageObjectType = StructType({
  /** Tasks defined in this package: name -> task object hash */
  tasks: DictType(StringType, StringType),
  /** Data structure and initial values */
  data: PackageDataType,
  /** Named task bindings for execution */
  bindings: DictType(StringType, BindingDefType),
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
