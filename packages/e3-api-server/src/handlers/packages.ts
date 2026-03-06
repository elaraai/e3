/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType } from '@elaraai/east';
import {
  packageList,
  packageRemove,
  packageRead,
} from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { PackageObjectType } from '@elaraai/e3-types';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { PackageListItemType } from '../types.js';

/**
 * List all packages in the repository.
 */
export async function listPackages(
  storage: StorageBackend,
  repoPath: string
): Promise<Response> {
  try {
    const packages = await packageList(storage, repoPath);
    const result = packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
    }));
    return sendSuccess(ArrayType(PackageListItemType), result);
  } catch (err) {
    return sendError(ArrayType(PackageListItemType), errorToVariant(err));
  }
}

/**
 * Get package details.
 */
export async function getPackage(
  storage: StorageBackend,
  repoPath: string,
  name: string,
  version: string
): Promise<Response> {
  try {
    const pkg = await packageRead(storage, repoPath, name, version);
    return sendSuccess(PackageObjectType, pkg);
  } catch (err) {
    return sendError(PackageObjectType, errorToVariant(err));
  }
}

/**
 * Delete a package.
 */
export async function deletePackage(
  storage: StorageBackend,
  repoPath: string,
  name: string,
  version: string
): Promise<Response> {
  try {
    await packageRemove(storage, repoPath, name, version);
    return sendSuccess(NullType, null);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}
