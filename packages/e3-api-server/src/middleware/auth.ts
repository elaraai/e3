/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * JWT authentication configuration.
 */
export interface AuthConfig {
  /** Path to public key file (PEM format) for RS256 signature verification */
  publicKeyPath: string;
  /** Expected issuer claim (iss) */
  issuer: string;
  /** Expected audience claim (aud) */
  audience: string;
}

/**
 * JWT payload claims.
 */
interface JwtPayload {
  /** Subject - typically user ID */
  sub?: string;
  /** User email */
  email?: string;
  /** User roles */
  roles?: string[];
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string;
  /** Expiration time (Unix timestamp) */
  exp?: number;
  /** Not before time (Unix timestamp) */
  nbf?: number;
  /** Issued at time (Unix timestamp) */
  iat?: number;
}

/**
 * Identity information extracted from JWT and set on context.
 */
export interface Identity {
  /** Subject - typically user ID */
  sub: string;
  /** User email (if present in token) */
  email?: string;
  /** User roles (if present in token) */
  roles: string[];
}

/**
 * Create JWT authentication middleware.
 *
 * The middleware:
 * 1. Extracts Bearer token from Authorization header
 * 2. Verifies RS256 signature using the configured public key
 * 3. Validates exp, nbf, iss, and aud claims
 * 4. Sets identity on Hono context (accessible via c.get('identity'))
 *
 * @param config - Authentication configuration
 * @returns Hono middleware handler
 */
export async function createAuthMiddleware(config: AuthConfig): Promise<MiddlewareHandler> {
  // Load public key at startup
  const publicKeyPem = await fs.readFile(config.publicKeyPath, 'utf8');
  const publicKey = crypto.createPublicKey(publicKeyPem);

  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Unauthorized: Missing Bearer token', { status: 401 });
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifyJwt(token, publicKey, config.issuer, config.audience);

      // Set identity on context for handlers
      const identity: Identity = {
        sub: payload.sub ?? 'unknown',
        email: payload.email,
        roles: payload.roles ?? [],
      };
      c.set('identity', identity);

      await next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid token';
      return new Response(`Unauthorized: ${message}`, { status: 401 });
    }
  };
}

/**
 * Verify JWT token and return payload.
 *
 * @param token - Raw JWT string
 * @param publicKey - RSA public key for signature verification
 * @param expectedIssuer - Expected iss claim
 * @param expectedAudience - Expected aud claim
 * @returns Decoded JWT payload
 * @throws Error if verification fails
 */
function verifyJwt(
  token: string,
  publicKey: crypto.KeyObject,
  expectedIssuer: string,
  expectedAudience: string
): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT: expected 3 parts');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header and verify algorithm
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString()) as { alg?: string };
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Verify signature
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, 'base64url');
  if (!verify.verify(publicKey, signature)) {
    throw new Error('Invalid signature');
  }

  // Decode payload
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as JwtPayload;

  // Verify time-based claims
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) {
    throw new Error('Token expired');
  }
  if (payload.nbf !== undefined && payload.nbf > now) {
    throw new Error('Token not yet valid');
  }

  // Verify issuer
  if (payload.iss !== expectedIssuer) {
    throw new Error(`Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}`);
  }

  // Verify audience
  if (payload.aud !== expectedAudience) {
    throw new Error(`Invalid audience: expected ${expectedAudience}, got ${payload.aud}`);
  }

  return payload;
}
