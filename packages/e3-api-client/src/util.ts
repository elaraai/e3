/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Calculate SHA256 hash of data for content-addressed transfers.
 *
 * This is a browser-safe version using the Web Crypto API (crypto.subtle),
 * which is available in both Node.js (>=15) and all modern browsers.
 *
 * The canonical sync implementation lives in @elaraai/e3-core (objects.ts)
 * but uses Node.js `crypto.createHash` which is not available in browser
 * environments. This async version produces identical SHA-256 output and
 * is used here because e3-api-client must be browser-compatible (used by
 * e3-ui-components in webview builds).
 *
 * @param data - Data to hash
 * @returns SHA256 hash as a hex string
 */
export async function computeHash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
