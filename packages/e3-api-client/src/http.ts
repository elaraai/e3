/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import type { EastType, ValueTypeOf } from '@elaraai/east';
import { ResponseType, ErrorType } from './types.js';

export type Response<T> =
  | { type: 'success'; value: T }
  | { type: 'error'; value: ValueTypeOf<typeof ErrorType> };

/**
 * Make a GET request and decode BEAST2 response.
 */
export async function get<T extends EastType>(
  url: string,
  path: string,
  successType: T
): Promise<Response<ValueTypeOf<T>>> {
  const response = await fetch(`${url}${path}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/beast2',
    },
  });

  return decodeResponse(response, successType);
}

/**
 * Make a POST request with BEAST2 body and decode BEAST2 response.
 */
export async function post<Req extends EastType, Res extends EastType>(
  url: string,
  path: string,
  body: ValueTypeOf<Req>,
  requestType: Req,
  successType: Res
): Promise<Response<ValueTypeOf<Res>>> {
  const encode = encodeBeast2For(requestType);
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/beast2',
      'Accept': 'application/beast2',
    },
    body: encode(body),
  });

  return decodeResponse(response, successType);
}

/**
 * Make a PUT request with BEAST2 body and decode BEAST2 response.
 */
export async function put<Req extends EastType, Res extends EastType>(
  url: string,
  path: string,
  body: ValueTypeOf<Req>,
  requestType: Req,
  successType: Res
): Promise<Response<ValueTypeOf<Res>>> {
  const encode = encodeBeast2For(requestType);
  const response = await fetch(`${url}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/beast2',
      'Accept': 'application/beast2',
    },
    body: encode(body),
  });

  return decodeResponse(response, successType);
}

/**
 * Make a DELETE request and decode BEAST2 response.
 */
export async function del<T extends EastType>(
  url: string,
  path: string,
  successType: T
): Promise<Response<ValueTypeOf<T>>> {
  const response = await fetch(`${url}${path}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/beast2',
    },
  });

  return decodeResponse(response, successType);
}

/**
 * Decode a BEAST2 response with the Response wrapper type.
 */
async function decodeResponse<T extends EastType>(
  response: globalThis.Response,
  successType: T
): Promise<Response<ValueTypeOf<T>>> {
  if (response.status === 400) {
    throw new Error(`Bad request: ${await response.text()}`);
  }
  if (response.status === 415) {
    throw new Error(`Unsupported media type: expected application/beast2`);
  }

  const buffer = await response.arrayBuffer();
  const decode = decodeBeast2For(ResponseType(successType));
  return decode(new Uint8Array(buffer)) as Response<ValueTypeOf<T>>;
}

/**
 * Unwrap a response, throwing on error.
 */
export function unwrap<T>(response: Response<T>): T {
  if (response.type === 'error') {
    const err = response.value;
    throw new ApiError(err.type, err.value);
  }
  return response.value;
}

/**
 * API error with typed error details.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: unknown
  ) {
    super(`API error: ${code}`);
    this.name = 'ApiError';
  }
}
