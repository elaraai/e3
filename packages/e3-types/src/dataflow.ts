/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Dataflow definition types for e3.
 *
 * Dataflows define how the orchestrator marshals data between tasks.
 * Each dataflow specifies which task to run, where to read inputs,
 * and where to write outputs.
 */

import { VariantType, StructType, StringType, ArrayType, ValueTypeOf } from '@elaraai/east';
import { TreePathType } from './schema.js';

/**
 * Task dataflow: runs a task with inputs from dataset paths.
 *
 * @remarks
 * - `task`: The task name (key in the package's tasks dictionary)
 * - `inputs`: Paths in the dataset tree where each input value is read from
 * - `output`: Path in the dataset tree where the task's output is written
 *
 * @example
 * ```ts
 * const dataflow: TaskDataflow = {
 *   task: 'process-sales',
 *   inputs: [treePath('inputs', 'sales'), treePath('inputs', 'config')],
 *   output: treePath('outputs', 'result'),
 * };
 * ```
 */
export const TaskDataflowType = StructType({
  /** Task name (key in package's tasks dict) */
  task: StringType,
  /** Input paths: where to read each input from the dataset tree */
  inputs: ArrayType(TreePathType),
  /** Output path: where to write the task's output */
  output: TreePathType,
});
export type TaskDataflowType = typeof TaskDataflowType;

export type TaskDataflow = ValueTypeOf<typeof TaskDataflowType>;

/**
 * Dataflow definition.
 *
 * MVP only supports task dataflows.
 * Future: shuffle, source, sink, cron dataflows.
 *
 * @example
 * ```ts
 * const dataflow: DataflowDef = variant('task', {
 *   task: 'process-sales',
 *   inputs: [treePath('inputs', 'sales')],
 *   output: treePath('outputs', 'result'),
 * });
 * ```
 */
export const DataflowDefType = VariantType({
  /** Execute a task with inputs/outputs from dataset paths */
  task: TaskDataflowType,
});
export type DataflowDefType = typeof DataflowDefType;

export type DataflowDef = ValueTypeOf<typeof DataflowDefType>;
