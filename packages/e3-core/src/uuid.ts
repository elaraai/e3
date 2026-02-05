/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * UUIDv7 generation for execution IDs.
 *
 * UUIDv7 (RFC 9562) provides:
 * - Timestamp-sortable: First 48 bits are millisecond Unix timestamp
 * - Globally unique: No coordination required across machines/repos
 * - Lexicographically ordered: max(id) = latest
 *
 * Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 *   - x: timestamp + random
 *   - 7: version (7)
 *   - y: variant (8, 9, a, or b)
 */

import { randomBytes } from 'crypto';

/**
 * Generate a new UUIDv7.
 *
 * @returns A new UUIDv7 string
 */
export function uuidv7(): string {
  // Get current timestamp in milliseconds
  const timestamp = Date.now();

  // Create a 16-byte buffer
  const bytes = new Uint8Array(16);

  // Fill bytes 0-5 with timestamp (big-endian, 48 bits)
  bytes[0] = (timestamp / 0x10000000000) & 0xff;
  bytes[1] = (timestamp / 0x100000000) & 0xff;
  bytes[2] = (timestamp / 0x1000000) & 0xff;
  bytes[3] = (timestamp / 0x10000) & 0xff;
  bytes[4] = (timestamp / 0x100) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Fill remaining bytes with random data
  const random = randomBytes(10);
  for (let i = 0; i < 10; i++) {
    bytes[6 + i] = random[i]!;
  }

  // Set version (7) in byte 6: clear top 4 bits, set to 0111
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;

  // Set variant (10xx) in byte 8: clear top 2 bits, set to 10
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  // Convert to hex string with dashes
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Extract the timestamp from a UUIDv7.
 *
 * @param uuid - A UUIDv7 string
 * @returns The Date when the UUID was generated
 * @throws If the UUID is malformed
 */
export function uuidv7Timestamp(uuid: string): Date {
  // Remove dashes and validate format
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID format: ${uuid}`);
  }

  // Extract first 12 hex chars (48 bits = 6 bytes) as timestamp
  const timestampHex = hex.slice(0, 12);
  const timestamp = parseInt(timestampHex, 16);

  return new Date(timestamp);
}

/**
 * Validate that a string is a valid UUIDv7.
 *
 * @param uuid - String to validate
 * @returns True if the string is a valid UUIDv7
 */
export function isUuidv7(uuid: string): boolean {
  // Check format: 8-4-4-4-12 hex chars
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return pattern.test(uuid);
}
