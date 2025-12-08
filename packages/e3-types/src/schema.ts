/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Dataset schema and tree path types for e3.
 *
 * Schemas define the structure of workspace data trees - which nodes are
 * branches (trees) vs leaves (values). Paths identify locations within trees.
 *
 * Tree paths use East's keypath syntax:
 * - `.field` for struct field access (backtick-quoted for special chars)
 * - `[N]` for array index access (future)
 * - `[key]` for dict key lookup (future)
 *
 * @see East serialization docs for keypath syntax details
 */

import { VariantType, StringType, ArrayType, DictType, RecursiveType, ValueTypeOf, printIdentifier, variant, EastTypeType } from '@elaraai/east';

/**
 * Dataset schema defines the structure of a data tree node.
 *
 * Schemas are recursive - a tree node contains child schemas.
 *
 * @remarks
 * - `value`: A leaf node holding a typed value. The type is an `EastTypeValue`.
 * - `struct`: A tree node with named fields, each with its own schema.
 *
 * MVP only supports struct trees. Future: array, dict trees.
 *
 * @example
 * ```ts
 * // A leaf node holding an Integer value
 * const leafSchema: DatasetSchema = variant('value', variant('Integer', null));
 *
 * // A tree node with struct fields
 * const treeSchema: DatasetSchema = variant('struct', new Map([
 *   ['count', variant('value', variant('Integer', null))],
 *   ['items', variant('value', variant('Array', variant('String', null)))],
 * ]));
 * ```
 */
export const DatasetSchemaType = RecursiveType(self => VariantType({
  /** Leaf node: East type of the value (homoiconic EastTypeValue) */
  value: EastTypeType,
  /** Struct tree: named fields mapping to child schemas */
  struct: DictType(StringType, self),
}));
export type DatasetSchemaType = typeof DatasetSchemaType;

export type DatasetSchema = ValueTypeOf<typeof DatasetSchemaType>;

/**
 * Path segment for navigating dataset trees.
 *
 * Uses East keypath syntax for consistency:
 * - `field`: Struct field access (rendered as `.field` or `` .`field` `` if quoted)
 * - `index`: Array element access (rendered as `[N]`) - future
 * - `key`: Dict key lookup (rendered as `[key]`) - future
 *
 * @example
 * ```ts
 * // Struct field access
 * const segment: PathSegment = variant('field', 'sales');
 *
 * // Array index (future)
 * const segment: PathSegment = variant('index', 0n);
 * ```
 */
export const PathSegmentType = VariantType({
  /** Struct field access by name */
  field: StringType,
  // Future: case: StringType for variant case identifiers
  // Future: index: IntegerType for array access
  // Future: key: StringType (or polymorphic) for dict access
});
export type PathSegmentType = typeof PathSegmentType;

export type PathSegment = ValueTypeOf<typeof PathSegmentType>;

/**
 * Tree path: sequence of segments identifying a location in a dataset tree.
 *
 * Paths are used by dataflows to specify where task inputs come from
 * and where outputs should be written.
 *
 * @example
 * ```ts
 * // Path to inputs.sales.data
 * const path: TreePath = [
 *   variant('field', 'inputs'),
 *   variant('field', 'sales'),
 *   variant('field', 'data'),
 * ];
 * ```
 */
export const TreePathType = ArrayType(PathSegmentType);
export type TreePathType = typeof TreePathType;

export type TreePath = ValueTypeOf<typeof TreePathType>;

/**
 * Converts a tree path to East keypath string representation.
 *
 * Uses East's keypath syntax: `.field` for simple identifiers,
 * `` .`field` `` for identifiers needing quoting.
 *
 * @param path - The tree path to convert
 * @returns A keypath string (e.g., ".inputs.sales" or ".inputs.`my/field`")
 *
 * @example
 * ```ts
 * const path = treePath('inputs', 'sales');
 * pathToString(path); // ".inputs.sales"
 *
 * const path2 = treePath('inputs', 'my/field');
 * pathToString(path2); // ".inputs.`my/field`"
 * ```
 */
export function pathToString(path: TreePath): string {
  return path.map(segment => {
    if (segment.type === 'field') {
      return '.' + printIdentifier(segment.value);
    } else {
      throw new Error(`pathToString: unsupported path segment type: ${segment.type}`);
    }
  }).join('');
}

/**
 * Result of parsing a path with schema validation.
 */
export interface ParsePathResult {
  /** The parsed path segments */
  path: TreePath;
  /** The schema at the path location */
  schema: DatasetSchema;
}

/**
 * Parses an East keypath string into a TreePath, validating against the schema.
 *
 * Supports `.field` syntax for struct field access.
 * Backtick-quoted identifiers (`` .`field` ``) are supported for special chars.
 *
 * @param pathStr - A keypath string (e.g., ".inputs.sales")
 * @param schema - The root schema to validate against
 * @returns The parsed path and the schema at that location
 *
 * @throws {Error} If a field doesn't exist in the schema or path descends into a value
 *
 * @remarks
 * - Empty string returns empty path (root) with the root schema
 * - Path must start with `.` (no leading slash)
 * - Backtick escaping: `` \` `` for literal backtick, `\\` for backslash
 * - Future: will disambiguate variant cases from struct fields using schema
 * - Future: will use schema to parse dict keys with correct type
 *
 * @example
 * ```ts
 * const schema = variant('struct', new Map([
 *   ['inputs', variant('struct', new Map([
 *     ['sales', variant('value', variant('Integer', null))],
 *   ]))],
 * ]));
 *
 * const { path, schema: leafSchema } = parsePath('.inputs.sales', schema);
 * // path = [field('inputs'), field('sales')]
 * // leafSchema = variant('value', variant('Integer', null))
 * ```
 */
export function parsePath(pathStr: string, schema: DatasetSchema): ParsePathResult {
  if (pathStr === '') return { path: [], schema };

  const segments: TreePath = [];
  let currentSchema = schema;
  let pos = 0;

  while (pos < pathStr.length) {
    if (pathStr[pos] === '.') {
      pos++;

      // Parse identifier (TODO: export parseIdentifier from east package)
      let fieldName: string;

      // Check for backtick-quoted identifier
      if (pos < pathStr.length && pathStr[pos] === '`') {
        pos++;
        fieldName = '';
        while (pos < pathStr.length && pathStr[pos] !== '`') {
          if (pathStr[pos] === '\\' && pos + 1 < pathStr.length) {
            // Escape sequence
            pos++;
            fieldName += pathStr[pos];
          } else {
            fieldName += pathStr[pos];
          }
          pos++;
        }
        if (pos < pathStr.length && pathStr[pos] === '`') {
          pos++; // consume closing backtick
        }
      } else {
        // Simple identifier: [a-zA-Z_][a-zA-Z0-9_]*
        fieldName = '';
        while (pos < pathStr.length && /[a-zA-Z0-9_]/.test(pathStr[pos]!)) {
          fieldName += pathStr[pos];
          pos++;
        }
      }

      if (fieldName.length === 0) {
        throw new Error(`parsePath: expected identifier after '.' at position ${pos}`);
      }

      // Validate against schema
      if (currentSchema.type === 'value') {
        throw new Error(`parsePath: cannot descend into value at '${pathToString(segments)}'`);
      }

      // currentSchema.type === 'struct' (only other option after 'value' check)
      const fields = currentSchema.value;
      const childSchema = fields.get(fieldName);
      if (childSchema === undefined) {
        const available = [...fields.keys()].map(k => printIdentifier(k)).join(', ');
        throw new Error(`parsePath: field '${fieldName}' not found at '${pathToString(segments)}'. Available: ${available}`);
      }
      segments.push(variant('field', fieldName));
      currentSchema = childSchema;
    } else {
      throw new Error(`parsePath: unexpected character at position ${pos}: '${pathStr[pos]}'`);
    }
  }

  return { path: segments, schema: currentSchema };
}

/**
 * Creates a tree path from field names, validating against the schema.
 *
 * Convenience function for the common case of navigating through struct fields.
 *
 * @param schema - The root schema to validate against
 * @param fields - Field names to include in the path
 * @returns The parsed path and the schema at that location
 *
 * @throws {Error} If a field doesn't exist in the schema
 *
 * @example
 * ```ts
 * const { path, schema: leafSchema } = treePath(rootSchema, 'inputs', 'sales');
 * ```
 */
export function treePath(schema: DatasetSchema, ...fields: string[]): ParsePathResult {
  return parsePath('.' + fields.map(printIdentifier).join('.'), schema);
}
