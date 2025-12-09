/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Export functionality for e3 packages.
 */

import type { PackageDef } from './types.js';

/**
 * Exports a package to a .zip bundle.
 *
 * The bundle can be imported into an e3 repository using `e3 import`.
 *
 * @param pkg - The package to export
 * @param outputPath - Path to write the .zip file
 *
 * @example
 * ```ts
 * await e3.export(pkg, 'package.zip');
 * ```
 */
// Named export_ to avoid conflict with reserved word
export function export_(pkg: PackageDef<Record<string, unknown>>, outputPath: string): Promise<void> {
  // TODO: Implement package export
  // 1. Compile all tasks to IR
  // 2. Build dataset schema from inputs
  // 3. Build dataflow definitions
  // 4. Serialize PackageObject using beast2
  // 5. Create manifest
  // 6. Write to zip file
  return Promise.reject(new Error(`export not yet implemented: ${pkg.name} -> ${outputPath}`));
}
