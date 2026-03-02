/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Per-dataset reference types for reactive dataflow.
 *
 * Each dataset in a workspace has its own `.ref` file instead of being
 * part of a single root tree. This enables concurrent writes and
 * reactive re-execution.
 *
 * A DatasetRef tracks:
 * - The current value hash (or unassigned/null state)
 * - A version vector mapping root input paths to their content hashes,
 *   enabling consistency checking across task inputs.
 */

import { VariantType, StructType, DictType, StringType, NullType, type ValueTypeOf } from '@elaraai/east';

/**
 * Version vector: maps root input dataset path -> content hash.
 *
 * Used to track which version of each root input contributed to a
 * dataset's current value. When a task executes, its output's version
 * vector is the union of all input version vectors (which must agree
 * on shared keys for consistency).
 *
 * @example
 * ```ts
 * // Root input version vector (self-referencing)
 * const inputVV: VersionVector = new Map([
 *   ['.inputs.sales', 'abc123...'],
 * ]);
 *
 * // Derived dataset version vector (union of inputs)
 * const derivedVV: VersionVector = new Map([
 *   ['.inputs.sales', 'abc123...'],
 *   ['.inputs.config', 'def456...'],
 * ]);
 * ```
 */
export const VersionVectorType = DictType(StringType, StringType);
export type VersionVectorType = typeof VersionVectorType;

export type VersionVector = ValueTypeOf<typeof VersionVectorType>;

/**
 * Per-dataset reference stored in workspace data files.
 *
 * Each dataset has a `.ref` file at `workspaces/<ws>/data/<path>.ref`.
 * The ref tracks the dataset's current state and version provenance.
 *
 * Variants:
 * - `unassigned`: Dataset has no value yet (e.g., pending task output)
 * - `null`: Dataset has been explicitly set to null, with version tracking
 * - `value`: Dataset has a value hash in the object store, with version tracking
 *
 * @example
 * ```ts
 * // Unassigned (initial state for task outputs)
 * const ref: DatasetRef = variant('unassigned', null);
 *
 * // Null value with version tracking
 * const ref: DatasetRef = variant('null', {
 *   versions: new Map([['.inputs.sales', 'abc123...']]),
 * });
 *
 * // Value with version tracking
 * const ref: DatasetRef = variant('value', {
 *   hash: 'def456...',
 *   versions: new Map([['.inputs.sales', 'abc123...']]),
 * });
 * ```
 */
export const DatasetRefType = VariantType({
  /** Dataset has no value assigned */
  unassigned: NullType,
  /** Dataset value is null, with version provenance */
  null: StructType({
    versions: VersionVectorType,
  }),
  /** Dataset has a value in the object store, with version provenance */
  value: StructType({
    hash: StringType,
    versions: VersionVectorType,
  }),
});
export type DatasetRefType = typeof DatasetRefType;

export type DatasetRef = ValueTypeOf<typeof DatasetRefType>;
