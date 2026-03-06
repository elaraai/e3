/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * East types for transfer backend stored state.
 *
 * These define the shape of records persisted by TransferBackend implementations
 * (in-memory Maps for local, DynamoDB for cloud).
 */

import {
  StructType,
  StringType,
  IntegerType,
  VariantType,
  NullType,
  DateTimeType,
  type ValueTypeOf,
} from '@elaraai/east';

// =============================================================================
// Dataset Upload
// =============================================================================

export const DatasetUploadType = StructType({
  repo: StringType,
  workspace: StringType,
  path: StringType,
  hash: StringType,
  size: IntegerType,
});

export type DatasetUpload = ValueTypeOf<typeof DatasetUploadType>;

// =============================================================================
// Package Import
// =============================================================================

export const PackageImportStatusType = VariantType({
  created: NullType,
  uploaded: NullType,
  processing: NullType,
  completed: StructType({
    name: StringType,
    version: StringType,
    packageHash: StringType,
    objectCount: IntegerType,
  }),
  failed: StructType({ message: StringType }),
});

export const PackageImportType = StructType({
  repo: StringType,
  size: IntegerType,
  status: PackageImportStatusType,
  createdAt: DateTimeType,
});

export type PackageImport = ValueTypeOf<typeof PackageImportType>;

// =============================================================================
// Package Export
// =============================================================================

export const PackageExportStatusType = VariantType({
  processing: NullType,
  completed: StructType({ size: IntegerType }),
  failed: StructType({ message: StringType }),
});

export const PackageExportType = StructType({
  repo: StringType,
  name: StringType,
  version: StringType,
  status: PackageExportStatusType,
  createdAt: DateTimeType,
});

export type PackageExport = ValueTypeOf<typeof PackageExportType>;
