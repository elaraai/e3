/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Task object types for e3.
 *
 * A task defines how to run a computation: which runner to use,
 * what inputs it expects (with optional fixed values), and what output type it produces.
 */

import { StructType, StringType, ArrayType, ValueTypeOf, OptionType } from '@elaraai/east';

/**
 * Specification for a single task input.
 *
 * Each input has an East type (serialized as a string) and optionally
 * a fixed value (hash of the value object in the store).
 *
 * @remarks
 * - `type`: The East type printed as a string (e.g., "Integer", "Array Integer")
 * - `value`: Either `some(hash)` for fixed values or `none` for runtime inputs
 *
 * Uses East's standard `OptionType(StringType)` for optional values.
 * Import `some` and `none` from `@elaraai/east` to construct values.
 *
 * @example
 * ```ts
 * import { some, none } from '@elaraai/east';
 *
 * // Fixed IR input (first argument to East functions)
 * const irInput: TaskInput = { type: 'IR', value: some('abc123...') };
 *
 * // Runtime data input
 * const dataInput: TaskInput = { type: 'Array Integer', value: none };
 * ```
 */
export const TaskInputType = StructType({
  /** Serialized East type (printed form) */
  type: StringType,
  /** Object hash if this input has a fixed value, none if provided at runtime */
  value: OptionType(StringType),
});
export type TaskInputType = typeof TaskInputType;

export type TaskInput = ValueTypeOf<typeof TaskInputType>;

/**
 * Task object stored in the object store.
 *
 * Tasks are referenced by packages and define how computations run.
 * The task identity (hash) is determined by the runner, input types/values,
 * and output type, enabling memoization of executions.
 *
 * @remarks
 * - `runner`: Key into the repository's runner configuration (e.g., "east-node")
 * - `inputs`: Array of input specifications; fixed values are baked in
 * - `output`: The East type of the task's return value
 *
 * @example
 * ```ts
 * import { some, none } from '@elaraai/east';
 *
 * const task: TaskObject = {
 *   runner: 'east-node',
 *   inputs: [
 *     { type: 'IR', value: some('abc123...') },  // Fixed: the function IR
 *     { type: 'Integer', value: none },          // Runtime: first argument
 *   ],
 *   output: 'Integer',
 * };
 * ```
 */
export const TaskObjectType = StructType({
  /** Runner key (e.g., "east-node", "east-py") - maps to config */
  runner: StringType,
  /** Input specifications */
  inputs: ArrayType(TaskInputType),
  /** Serialized East type of the output */
  output: StringType,
});
export type TaskObjectType = typeof TaskObjectType;

export type TaskObject = ValueTypeOf<typeof TaskObjectType>;
