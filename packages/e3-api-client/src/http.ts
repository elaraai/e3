/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import type { EastType, ValueTypeOf } from '@elaraai/east';
import { ResponseType, ErrorType } from './types.js';

/**
 * API response wrapper - success or typed error.
 *
 * This type mirrors the BEAST2 wire format (ResponseType from types.ts) used for
 * HTTP 200 responses. The server sends either { type: 'success', value } or
 * { type: 'error', value } as BEAST2-encoded payloads.
 *
 * Note: Client functions now throw ApiError instead of returning this type directly.
 * This type is still used internally for decoding responses and is exported for
 * cases where callers need to work with the wire format directly.
 */
export type Response<T> =
  | { type: 'success'; value: T }
  | { type: 'error'; value: ValueTypeOf<typeof ErrorType> };

/**
 * Request options for authenticated API calls.
 *
 * The token is mandatory to ensure callers explicitly handle authentication (or not).
 */
export interface RequestOptions {
  /** Bearer token for authentication (optional depending on server) */
  token: string | null;
}

/**
 * API error with typed error details.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(`API error: ${code}`);
    this.name = 'ApiError';
  }
}

/**
 * Authentication error (401 response).
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(`Authentication failed: ${message}`);
    this.name = 'AuthError';
  }
}

/**
 * JSON error response format from the server.
 */
interface ServerErrorResponse {
  success?: false;
  error?: { type: string; message?: string };
  message?: string; // Some endpoints return { message } directly
}

/**
 * Parse error details from response text.
 * Returns an ApiError with the error code from the body if available, otherwise uses fallback.
 */
function parseErrorBody(text: string, fallbackCode: string): ApiError {
  try {
    const json = JSON.parse(text) as ServerErrorResponse;
    if (json.error?.type) {
      return new ApiError(json.error.type, json.error.message);
    }
    if (json.message) {
      return new ApiError(fallbackCode, json.message);
    }
  } catch {
    // Not JSON
  }
  return new ApiError(fallbackCode, text || undefined);
}

/** HTTP status code to error code mapping */
const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  415: 'unsupported_media_type',
};

/**
 * Make a GET request and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function get<T extends EastType>(
  url: string,
  path: string,
  successType: T,
  options: RequestOptions
): Promise<ValueTypeOf<T>> {
  const response = await fetch(`${url}/api${path}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/beast2',
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  });

  return decodeResponse(response, successType);
}

/**
 * Make a POST request with BEAST2 body and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function post<Req extends EastType, Res extends EastType>(
  url: string,
  path: string,
  body: ValueTypeOf<Req>,
  requestType: Req,
  successType: Res,
  options: RequestOptions
): Promise<ValueTypeOf<Res>> {
  const encode = encodeBeast2For(requestType);
  const response = await fetch(`${url}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/beast2',
      'Accept': 'application/beast2',
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
    body: encode(body),
  });

  return decodeResponse(response, successType);
}

/**
 * Make a PUT request with BEAST2 body and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function put<Req extends EastType, Res extends EastType>(
  url: string,
  path: string,
  body: ValueTypeOf<Req>,
  requestType: Req,
  successType: Res,
  options: RequestOptions
): Promise<ValueTypeOf<Res>> {
  const encode = encodeBeast2For(requestType);
  const response = await fetch(`${url}/api${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/beast2',
      'Accept': 'application/beast2',
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
    body: encode(body),
  });

  return decodeResponse(response, successType);
}

/**
 * Make a DELETE request and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function del<T extends EastType>(
  url: string,
  path: string,
  successType: T,
  options: RequestOptions
): Promise<ValueTypeOf<T>> {
  const response = await fetch(`${url}/api${path}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/beast2',
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  });

  return decodeResponse(response, successType);
}

/**
 * Make a PUT request without body and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function putEmpty<T extends EastType>(
  url: string,
  path: string,
  successType: T,
  options: RequestOptions
): Promise<ValueTypeOf<T>> {
  const response = await fetch(`${url}/api${path}`, {
    method: 'PUT',
    headers: {
      'Accept': 'application/beast2',
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  });

  return decodeResponse(response, successType);
}

/**
 * Decode a BEAST2 response, throwing on errors.
 * @throws {ApiError} On application-level errors (including BEAST2 error responses)
 * @throws {AuthError} On 401 Unauthorized
 */
async function decodeResponse<T extends EastType>(
  response: globalThis.Response,
  successType: T
): Promise<ValueTypeOf<T>> {
  // Handle HTTP-level errors
  if (!response.ok) {
    const text = await response.text();
    const error = parseErrorBody(text, STATUS_CODES[response.status] ?? 'error');
    if (response.status === 401) {
      throw new AuthError(error.details as string ?? 'Authentication required');
    }
    throw error;
  }

  // Decode BEAST2 response
  const buffer = await response.arrayBuffer();
  const decode = decodeBeast2For(ResponseType(successType));
  const result = decode(new Uint8Array(buffer)) as Response<ValueTypeOf<T>>;

  // Handle application-level errors in BEAST2 response
  if (result.type === 'error') {
    throw new ApiError(result.value.type, result.value.value);
  }

  return result.value;
}

/**
 * Unwrap a response, throwing on error.
 * @deprecated Functions now throw ApiError on error; this function is no longer needed.
 */
export function unwrap<T>(response: Response<T>): T {
  if (response.type === 'error') {
    const err = response.value;
    throw new ApiError(err.type, err.value);
  }
  return response.value;
}
