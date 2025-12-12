/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * CLI utilities for path parsing and resolution
 */

import { resolve } from 'path';
import { repoGet } from '@elaraai/e3-core';
import { parseDatasetPath, parsePackageRef } from '@elaraai/e3-types';

// Re-export for convenience
export { parseDatasetPath, parsePackageRef };

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
  const { name, version } = parsePackageRef(spec);
  return { name, version: version ?? 'latest' };
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
