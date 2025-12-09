/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Configuration types for e3 repositories.
 *
 * The e3.east config file defines how runners are invoked.
 * Each runner maps to a command template that is expanded at execution time.
 */

import { VariantType, StructType, StringType, ArrayType, NullType, DictType, ValueTypeOf } from '@elaraai/east';

/**
 * Input expansion part for runner commands.
 *
 * Used within the `.inputs` variant to define a pattern that repeats
 * for each remaining input file.
 *
 * @remarks
 * - `literal`: A fixed string (e.g., "--input")
 * - `input_path`: Replaced with the path to the input file
 *
 * @example
 * ```ts
 * // Pattern: --input <path> for each remaining input
 * const pattern: InputPart[] = [
 *   inputLiteral('--input'),
 *   inputInputPath(),
 * ];
 * ```
 */
export const InputPartType = VariantType({
  /** Literal string (e.g., "--input") */
  literal: StringType,
  /** Path to the input file */
  input_path: NullType,
});

export type InputPart = ValueTypeOf<typeof InputPartType>;

/**
 * Command part for constructing runner commands.
 *
 * Runner commands are built by expanding these parts in order.
 * The e3 executor substitutes placeholders with actual file paths.
 *
 * @remarks
 * - `literal`: A fixed string passed through unchanged
 * - `input_path`: Replaced with the path to the next input file
 * - `inputs`: A pattern repeated for each remaining input
 * - `output_path`: Replaced with the path where output should be written
 *
 * @example
 * ```ts
 * // east-node <ir-path> [--input <path>]... <output-path>
 * const eastNodeCommand: CommandPart[] = [
 *   literal('east-node'),
 *   inputPath(),                              // IR file
 *   inputs(inputLiteral('--input'), inputInputPath()),  // Data inputs
 *   outputPath(),
 * ];
 * ```
 */
export const CommandPartType = VariantType({
  /** Literal string (e.g., "east-node", "run") */
  literal: StringType,
  /** Path to the next input (first unclaimed input) */
  input_path: NullType,
  /** Expand pattern for each remaining input */
  inputs: ArrayType(InputPartType),
  /** Path where output should be written */
  output_path: NullType,
});

export type CommandPart = ValueTypeOf<typeof CommandPartType>;

/**
 * Runner configuration mapping runner names to command templates.
 *
 * Each runner (e.g., "east-node", "east-py") maps to an array of
 * CommandParts that define how to invoke it.
 */
export const RunnersConfigType = DictType(StringType, ArrayType(CommandPartType));

export type RunnersConfig = ValueTypeOf<typeof RunnersConfigType>;

/**
 * Repository configuration stored in e3.east.
 *
 * Contains all repository-level settings, currently just runner definitions.
 *
 * @remarks
 * Future versions may include registry URLs, default settings, etc.
 *
 * @example
 * ```ts
 * const config: Config = {
 *   runners: new Map([
 *     ['east-node', [literal('east-node'), inputPath(), inputs(inputInputPath()), outputPath()]],
 *   ]),
 * };
 * ```
 */
export const ConfigType = StructType({
  /** Runner command templates */
  runners: RunnersConfigType,
});

export type Config = ValueTypeOf<typeof ConfigType>;

/**
 * Creates an empty configuration with no runners defined.
 *
 * @returns A Config with an empty runners map
 *
 * @remarks
 * Users must configure runners in e3.east before executing tasks.
 *
 * @example
 * ```ts
 * const config = emptyConfig();
 * config.runners.set('east-node', [
 *   literal('east-node'),
 *   inputPath(),
 *   outputPath(),
 * ]);
 * ```
 */
export function emptyConfig(): Config {
  return {
    runners: new Map(),
  };
}
