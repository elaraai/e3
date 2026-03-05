/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for CLI utility functions.
 *
 * formatError is the single point where all CLI error messages are produced.
 * It must handle every error shape the API client and core library can throw,
 * and always produce a clear, actionable message — never a bare "Error".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@elaraai/e3-api-client';
import { formatError } from './utils.js';

describe('formatError', () => {
  // ---------------------------------------------------------------------------
  // ApiError — code humanization
  // ---------------------------------------------------------------------------

  describe('ApiError code humanization', () => {
    it('humanizes a single-word code', () => {
      const err = new ApiError('unauthorized');
      assert.strictEqual(formatError(err), 'Unauthorized');
    });

    it('humanizes a multi-word snake_case code', () => {
      const err = new ApiError('execution_not_found');
      assert.strictEqual(formatError(err), 'Execution not found');
    });

    it('humanizes the internal_server_error code', () => {
      const err = new ApiError('internal_server_error');
      assert.strictEqual(formatError(err), 'Internal server error');
    });

    it('humanizes an http status fallback code', () => {
      const err = new ApiError('http_502');
      assert.strictEqual(formatError(err), 'Http 502');
    });
  });

  // ---------------------------------------------------------------------------
  // ApiError — details inclusion
  // ---------------------------------------------------------------------------

  describe('ApiError with details', () => {
    it('appends string details after the humanized code', () => {
      const err = new ApiError('package_invalid', 'zip archive is corrupt');
      assert.strictEqual(formatError(err), 'Package invalid: zip archive is corrupt');
    });

    it('appends object details as JSON', () => {
      const err = new ApiError('package_not_found', { packageName: 'acme', version: '1.0.0' });
      const result = formatError(err);
      assert.match(result, /^Package not found: /);
      assert.ok(result.includes('"packageName":"acme"'));
      assert.ok(result.includes('"version":"1.0.0"'));
    });

    it('appends structured error details from BEAST2 error variants', () => {
      // Simulates the { message: '...' } shape from InternalErrorType
      const err = new ApiError('internal', { message: 'unexpected null in tree' });
      const result = formatError(err);
      assert.strictEqual(result, 'Internal: {"message":"unexpected null in tree"}');
    });

    it('omits details section when details is undefined', () => {
      const err = new ApiError('bad_request', undefined);
      assert.strictEqual(formatError(err), 'Bad request');
    });

    it('omits details section when details is null', () => {
      const err = new ApiError('dataflow_aborted', null);
      assert.strictEqual(formatError(err), 'Dataflow aborted');
    });

    it('includes empty string details', () => {
      // Empty string is falsy but not null/undefined — should still show the colon
      const err = new ApiError('bad_request', '');
      assert.strictEqual(formatError(err), 'Bad request: ');
    });
  });

  // ---------------------------------------------------------------------------
  // Standard Error
  // ---------------------------------------------------------------------------

  describe('standard Error', () => {
    it('returns the error message', () => {
      const err = new Error('ENOENT: no such file or directory');
      assert.strictEqual(formatError(err), 'ENOENT: no such file or directory');
    });

    it('handles TypeError', () => {
      const err = new TypeError('fetch failed');
      assert.strictEqual(formatError(err), 'fetch failed');
    });

    it('handles Error subclasses', () => {
      class CustomError extends Error {
        constructor() { super('custom problem'); this.name = 'CustomError'; }
      }
      assert.strictEqual(formatError(new CustomError()), 'custom problem');
    });
  });

  // ---------------------------------------------------------------------------
  // Non-Error values
  // ---------------------------------------------------------------------------

  describe('non-Error values', () => {
    it('converts a string to itself', () => {
      assert.strictEqual(formatError('something went wrong'), 'something went wrong');
    });

    it('converts a number to string', () => {
      assert.strictEqual(formatError(42), '42');
    });

    it('converts undefined to string', () => {
      assert.strictEqual(formatError(undefined), 'undefined');
    });

    it('converts null to string', () => {
      assert.strictEqual(formatError(null), 'null');
    });

    it('converts an object to string', () => {
      assert.strictEqual(formatError({ code: 'oops' }), '[object Object]');
    });
  });
});
