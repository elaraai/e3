/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Generic object utilities for e3.
 *
 * This module contains only storage-agnostic utilities.
 * Local filesystem operations are in storage/local/LocalObjectStore.ts
 */

import * as crypto from 'crypto';

/**
 * MIME type for BEAST2 binary encoding.
 */
export const BEAST2_CONTENT_TYPE = 'application/vnd.elara.beast2';

/**
 * Calculate SHA256 hash of data.
 *
 * This is the core hashing function used throughout e3 for content addressing.
 * It's storage-agnostic and can be used with any backend.
 *
 * @param data - Data to hash
 * @returns SHA256 hash as a hex string
 */
export function computeHash(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
