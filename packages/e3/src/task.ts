/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task definitions for e3 packages.
 */

import type { EastType, FunctionExpr } from '@elaraai/east';
import { Expr, variant } from '@elaraai/east';
import type { DatasetDef, DataTreeDef, TaskDef } from './types.js';

/**
 * Singleton tree definition for `.outputs`.
 *
 * All output datasets (task outputs) are children of this tree.
 */
export const outputsTree: DataTreeDef = {
  kind: 'datatree',
  name: 'outputs',
  path: [variant('field', 'outputs')],
  deps: new Set(),
};

/**
 * Collects all dependencies from input datasets.
 *
 * Walks the dependency graph to include:
 * - Parent trees (inputsTree, outputsTree)
 * - All input datasets
 * - Any tasks that produce those datasets (transitively)
 */
function collectDeps(inputs: DatasetDef[]): Set<DataTreeDef | DatasetDef | TaskDef> {
  const deps = new Set<DataTreeDef | DatasetDef | TaskDef>();

  for (const input of inputs) {
    for (const dep of input.deps) {
      deps.add(dep);
    }
    deps.add(input);
  }

  // Always include outputsTree since this task produces an output
  deps.add(outputsTree);

  return deps;
}

/**
 * Defines a task.
 *
 * Tasks read from input datasets and produce an output dataset.
 * When input datasets change, the task re-runs automatically.
 *
 * @typeParam TOutput - Output type
 * @param name - Task name (also used for output dataset at `.outputs.${name}`)
 * @param inputs - Input datasets to read from
 * @param fn - Implementation function
 * @returns A TaskDef with `.output` for chaining
 *
 * @example
 * ```ts
 * const input_name = e3.input('name', StringType, 'World');
 *
 * const say_hello = e3.task(
 *   'say_hello',
 *   [input_name],
 *   ($, name) => str`Hello, ${name}!`
 * );
 *
 * // Use output in another task
 * const use_greeting = e3.task(
 *   'use_greeting',
 *   [say_hello.output],
 *   ($, greeting) => ...
 * );
 * ```
 */
export function task<Name extends string, Inputs extends Array<DatasetDef>, Output extends EastType>(
  name: Name,
  inputs: Inputs,
  fn: FunctionExpr<{ [K in keyof Inputs]: NoInfer<Inputs>[K] extends DatasetDef<infer T> ? T : never }, Output>,
): TaskDef<Output, [ variant<"field", "outputs">, variant<"field", Name> ]> {
  const outputType = Expr.type(fn).output;

  const output: DatasetDef<Output, [variant<"field", "outputs">, variant<"field", Name>]> = {
    kind: 'dataset',
    name,
    path: [variant('field', 'outputs'), variant('field', name)],
    type: outputType,
    deps: new Set([...outputsTree.deps, outputsTree]),
  };

  return {
    kind: 'task',
    name,
    runner: 'east-node',
    inputs,
    output,
    deps: collectDeps(inputs),
    fn: fn.toIR().ir,
  };
}
