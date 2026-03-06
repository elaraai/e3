/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dataset transfer types for the staged upload protocol.
 *
 * Used by both the API server and client for large dataset uploads
 * that exceed inline body size limits.
 */

import { VariantType, StructType, StringType, IntegerType, NullType, type ValueTypeOf } from '@elaraai/east';

/**
 * Transfer upload init request.
 *
 * Workspace and dataset path are now encoded in the URL.
 *
 * @property hash - SHA-256 hex hash of the data (computed by client)
 * @property size - Size of the data in bytes
 */
export const TransferUploadRequestType = StructType({
  hash: StringType,
  size: IntegerType,
});
export type TransferUploadRequest = ValueTypeOf<typeof TransferUploadRequestType>;

/**
 * Transfer upload init response.
 *
 * - `completed`: Object already exists (dedup), dataset ref updated
 * - `upload`: Staging slot created, client should upload then call done
 */
export const TransferUploadResponseType = VariantType({
  completed: NullType,
  upload: StructType({
    id: StringType,
    uploadUrl: StringType,
  }),
});
export type TransferUploadResponse = ValueTypeOf<typeof TransferUploadResponseType>;

/**
 * Transfer done response.
 *
 * - `completed`: Hash verified, object stored, dataset ref updated
 * - `error`: Hash mismatch or other failure
 */
export const TransferDoneResponseType = VariantType({
  completed: NullType,
  error: StructType({
    message: StringType,
  }),
});
export type TransferDoneResponse = ValueTypeOf<typeof TransferDoneResponseType>;
