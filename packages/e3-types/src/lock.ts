/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lock state type definitions.
 *
 * A lock provides exclusive access to a workspace. The state tracks:
 * - What operation acquired the lock (dataflow, deployment, etc.)
 * - Who holds the lock (process identification)
 * - When it was acquired
 * - Optional expiry (for cloud TTL-based locks)
 *
 * Lock file location: workspaces/<name>.lock
 *
 * Cloud implementations (e.g., e3-aws) can extend the holder variant type
 * with additional tags like `aws_lambda` or `aws_fargate` without breaking
 * compatibility with open-source e3.
 */

import {
  VariantType,
  StructType,
  StringType,
  IntegerType,
  DateTimeType,
  OptionType,
  NullType,
  ValueTypeOf,
} from '@elaraai/east';

/**
 * Lock operation - what acquired the lock.
 *
 * Cloud implementations can extend this variant with additional
 * operation types without breaking compatibility.
 */
export const LockOperationType = VariantType({
  /** Running a dataflow */
  dataflow: NullType,
  /** Deploying a package to the workspace */
  deployment: NullType,
  /** Removing the workspace */
  removal: NullType,
  /** Writing to a dataset */
  dataset_write: NullType,
});

export type LockOperation = ValueTypeOf<typeof LockOperationType>;

/**
 * Lock holder identification.
 *
 * Cloud implementations (e.g., e3-aws) can extend this variant with
 * additional holder types like `aws_lambda` or `aws_fargate`.
 */
export const LockHolderType = VariantType({
  /** Local process holding the lock */
  process: StructType({
    /** Process ID */
    pid: IntegerType,
    /** System boot ID (from /proc/sys/kernel/random/boot_id) */
    bootId: StringType,
    /** Process start time in jiffies since boot */
    startTime: IntegerType,
    /** Command that acquired the lock (for debugging) */
    command: StringType,
  }),
});

export type LockHolder = ValueTypeOf<typeof LockHolderType>;

/**
 * Lock state stored in workspaces/<name>.lock
 *
 * Represents an advisory lock on a workspace. The actual locking mechanism
 * is platform-specific (flock on Linux, DynamoDB conditional writes in cloud),
 * but the lock content follows this schema.
 */
export const LockStateType = StructType({
  /** What operation acquired the lock */
  operation: LockOperationType,
  /** Who holds the lock */
  holder: LockHolderType,
  /** When the lock was acquired */
  acquiredAt: DateTimeType,
  /** When the lock expires (for cloud TTL-based locks) */
  expiresAt: OptionType(DateTimeType),
});

export type LockState = ValueTypeOf<typeof LockStateType>;
