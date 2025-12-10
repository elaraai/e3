/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task object types for e3.
 *
 * A task object defines a complete executable unit: which runner to use,
 * where to read inputs from, and where to write the output.
 *
 * Task objects are stored in the object store and referenced by packages.
 * They are content-addressed, enabling deduplication and memoization.
 *
 * Input and output types are inferred from the package's structure at the
 * specified paths - the task just references locations, not types.
 */

import { StructType, StringType, ArrayType, ValueTypeOf } from '@elaraai/east';
import { TreePathType } from './structure.js';

/**
 * Task object stored in the object store.
 *
 * A task is a complete executable unit that reads from input dataset paths
 * and writes to an output dataset path. The runner determines how to execute it.
 *
 * @remarks
 * - `runner`: Key into the repository's runner configuration (e.g., "east-node")
 * - `inputs`: Paths to input datasets in the data tree (first is typically function_ir)
 * - `output`: Path to the output dataset in the data tree
 *
 * Types are not stored in the task - they are inferred from the package's
 * structure at the specified paths. This keeps tasks simple and avoids
 * redundant type information.
 *
 * @example
 * ```ts
 * import { variant } from '@elaraai/east';
 *
 * const task: TaskObject = {
 *   runner: 'east-node',
 *   inputs: [
 *     [variant('field', 'tasks'), variant('field', 'train'), variant('field', 'function_ir')],
 *     [variant('field', 'inputs'), variant('field', 'sales')],
 *   ],
 *   output: [variant('field', 'tasks'), variant('field', 'train'), variant('field', 'output')],
 * };
 * ```
 */
export const TaskObjectType = StructType({
  /** Runner key (e.g., "east-node", "east-py") - maps to repo config */
  runner: StringType,
  /** Input paths: where to read each input dataset from the data tree */
  inputs: ArrayType(TreePathType),
  /** Output path: where to write the output dataset in the data tree */
  output: TreePathType,
});
export type TaskObjectType = typeof TaskObjectType;

export type TaskObject = ValueTypeOf<typeof TaskObjectType>;
