/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { encodeBeast2For, decodeBeast2For, variant } from '@elaraai/east';
import type { EastType, ValueTypeOf } from '@elaraai/east';
import type { Context } from 'hono';
import { ResponseType, type Error } from './types.js';

/**
 * Decode BEAST2 request body.
 */
export async function decodeBody<T extends EastType>(
  c: Context,
  type: T
): Promise<ValueTypeOf<T>> {
  const contentType = c.req.header('content-type');
  if (contentType !== 'application/beast2') {
    throw new Error(`Expected Content-Type: application/beast2, got ${contentType}`);
  }

  const buffer = await c.req.arrayBuffer();
  const decode = decodeBeast2For(type);
  return decode(new Uint8Array(buffer));
}

/**
 * Send BEAST2 success response.
 */
export function sendSuccess<T extends EastType>(
  c: Context,
  type: T,
  value: ValueTypeOf<T>
): Response {
  const responseType = ResponseType(type);
  const encode = encodeBeast2For(responseType);
  const body = encode(variant('success', value) as ValueTypeOf<typeof responseType>);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/beast2',
    },
  });
}

/**
 * Send BEAST2 error response.
 */
export function sendError<T extends EastType>(
  c: Context,
  type: T,
  error: Error
): Response {
  const responseType = ResponseType(type);
  const encode = encodeBeast2For(responseType);
  const body = encode(variant('error', error) as ValueTypeOf<typeof responseType>);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/beast2',
    },
  });
}
