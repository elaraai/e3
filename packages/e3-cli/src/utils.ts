/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * CLI utilities for path parsing and resolution
 */

import { resolve } from 'path';
import { repoGet } from '@elaraai/e3-core';
import { variant } from '@elaraai/east';
import { type TreePath, type PathSegment } from '@elaraai/e3-types';

/**
 * Resolve repository path from CLI argument.
 * Supports `.` for current directory and relative/absolute paths.
 */
export function resolveRepo(repoArg: string): string {
  const absolutePath = resolve(repoArg);
  return repoGet(absolutePath);
}

/**
 * Parse package specification: name[@version]
 * Returns { name, version } where version defaults to 'latest' if not specified.
 */
export function parsePackageSpec(spec: string): { name: string; version: string } {
  const atIndex = spec.lastIndexOf('@');
  if (atIndex > 0) {
    return {
      name: spec.slice(0, atIndex),
      version: spec.slice(atIndex + 1),
    };
  }
  return { name: spec, version: 'latest' };
}

/**
 * Parse workspace.path.to.dataset syntax into workspace name and TreePath.
 *
 * Examples:
 *   "production" -> { ws: "production", path: [] }
 *   "production.inputs" -> { ws: "production", path: [field("inputs")] }
 *   "production.inputs.sales" -> { ws: "production", path: [field("inputs"), field("sales")] }
 *
 * For field names with special characters, use backticks:
 *   "production.`my field`" -> { ws: "production", path: [field("my field")] }
 */
export function parseDatasetPath(pathSpec: string): { ws: string; path: TreePath } {
  const segments = parsePathSegments(pathSpec);

  if (segments.length === 0) {
    throw new Error('Path cannot be empty');
  }

  const ws = segments[0];
  const path: TreePath = segments.slice(1).map((s) => variant('field', s) as PathSegment);

  return { ws, path };
}

/**
 * Parse dot-separated path into segments, handling backtick-quoted identifiers.
 */
function parsePathSegments(pathSpec: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inBackticks = false;

  for (let i = 0; i < pathSpec.length; i++) {
    const char = pathSpec[i];

    if (char === '`') {
      inBackticks = !inBackticks;
    } else if (char === '.' && !inBackticks) {
      if (current.length > 0) {
        segments.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }

  if (inBackticks) {
    throw new Error('Unclosed backtick in path');
  }

  return segments;
}

/**
 * Format error for CLI output.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Exit with error message.
 */
export function exitError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
