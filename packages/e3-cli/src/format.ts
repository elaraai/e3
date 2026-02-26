/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Shared formatting utilities for CLI commands.
 */

/**
 * Format a byte count as a human-readable string.
 *
 * @param bytes - Size in bytes
 * @returns Formatted string like "42 B", "1.5 KB", "1 MB"
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  for (const unit of units) {
    value /= 1024;
    if (value < 1024 || unit === 'TB') {
      const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
      return `${formatted} ${unit}`;
    }
  }
  // unreachable, but TypeScript needs it
  return `${bytes} B`;
}
