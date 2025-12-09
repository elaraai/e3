/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task binding types for e3.
 *
 * Task bindings define how the executor runs tasks: which task to run,
 * where to read input datasets from, and where to write the output dataset.
 *
 * Terminology:
 * - **Task binding**: A rule that binds a task to specific dataset paths
 * - **Task object**: The computation definition (in task.ts)
 */

import { VariantType, StructType, StringType, ArrayType, ValueTypeOf } from '@elaraai/east';
import { TreePathType } from './schema.js';

/**
 * Task binding: runs a task with inputs from dataset paths.
 *
 * @remarks
 * - `task`: The task name (key in the package's tasks dictionary)
 * - `inputs`: Paths to input datasets in the data tree
 * - `output`: Path to the output dataset in the data tree
 *
 * @example
 * ```ts
 * const binding: TaskBinding = {
 *   task: 'process-sales',
 *   inputs: [treePath('inputs', 'sales'), treePath('inputs', 'config')],
 *   output: treePath('outputs', 'result'),
 * };
 * ```
 */
export const TaskBindingType = StructType({
  /** Task name (key in package's tasks dict) */
  task: StringType,
  /** Input paths: where to read each input dataset */
  inputs: ArrayType(TreePathType),
  /** Output path: where to write the output dataset */
  output: TreePathType,
});
export type TaskBindingType = typeof TaskBindingType;

export type TaskBinding = ValueTypeOf<typeof TaskBindingType>;

// Backwards compatibility alias
/** @deprecated Use TaskBindingType instead */
export const TaskDataflowType = TaskBindingType;
/** @deprecated Use TaskBinding instead */
export type TaskDataflowType = TaskBindingType;
/** @deprecated Use TaskBinding instead */
export type TaskDataflow = TaskBinding;

/**
 * Binding definition.
 *
 * MVP only supports task bindings.
 * Future: shuffle, source, sink, cron bindings.
 *
 * @example
 * ```ts
 * const binding: BindingDef = variant('task', {
 *   task: 'process-sales',
 *   inputs: [treePath('inputs', 'sales')],
 *   output: treePath('outputs', 'result'),
 * });
 * ```
 */
export const BindingDefType = VariantType({
  /** Execute a task with inputs/outputs from dataset paths */
  task: TaskBindingType,
});
export type BindingDefType = typeof BindingDefType;

export type BindingDef = ValueTypeOf<typeof BindingDefType>;

// Backwards compatibility alias
/** @deprecated Use BindingDefType instead */
export const DataflowDefType = BindingDefType;
/** @deprecated Use BindingDef instead */
export type DataflowDefType = BindingDefType;
/** @deprecated Use BindingDef instead */
export type DataflowDef = BindingDef;
