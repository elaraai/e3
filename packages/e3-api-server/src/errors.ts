/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { variant, some, none } from '@elaraai/east';
import {
  RepoNotFoundError,
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  WorkspaceExistsError,
  WorkspaceLockError,
  PackageNotFoundError,
  PackageExistsError,
  PackageInvalidError,
  DatasetNotFoundError,
  TaskNotFoundError,
  ExecutionNotFoundError,
  ObjectNotFoundError,
  DataflowError,
  DataflowAbortedError,
  PermissionDeniedError,
} from '@elaraai/e3-core';
import type { Error } from './types.js';

/**
 * Map an e3-core error to an HTTP status code.
 */
export function errorToHttpStatus(err: unknown): number {
  if (err instanceof RepoNotFoundError) return 404;
  if (err instanceof WorkspaceNotFoundError) return 404;
  if (err instanceof WorkspaceNotDeployedError) return 409;
  if (err instanceof WorkspaceExistsError) return 409;
  if (err instanceof WorkspaceLockError) return 409;
  if (err instanceof PackageNotFoundError) return 404;
  if (err instanceof PackageExistsError) return 409;
  if (err instanceof PackageInvalidError) return 422;
  if (err instanceof DatasetNotFoundError) return 404;
  if (err instanceof TaskNotFoundError) return 404;
  if (err instanceof ExecutionNotFoundError) return 404;
  if (err instanceof ObjectNotFoundError) return 404;
  if (err instanceof DataflowError) return 500;
  if (err instanceof DataflowAbortedError) return 500;
  if (err instanceof PermissionDeniedError) return 403;
  return 500;
}

/**
 * Map an e3-core error to a JSON error type string.
 */
function errorToType(err: unknown): string {
  if (err instanceof RepoNotFoundError) return 'repository_not_found';
  if (err instanceof WorkspaceNotFoundError) return 'workspace_not_found';
  if (err instanceof WorkspaceNotDeployedError) return 'workspace_not_deployed';
  if (err instanceof WorkspaceExistsError) return 'workspace_exists';
  if (err instanceof WorkspaceLockError) return 'workspace_locked';
  if (err instanceof PackageNotFoundError) return 'package_not_found';
  if (err instanceof PackageExistsError) return 'package_exists';
  if (err instanceof PackageInvalidError) return 'package_invalid';
  if (err instanceof DatasetNotFoundError) return 'dataset_not_found';
  if (err instanceof TaskNotFoundError) return 'task_not_found';
  if (err instanceof ExecutionNotFoundError) return 'execution_not_found';
  if (err instanceof ObjectNotFoundError) return 'object_not_found';
  if (err instanceof DataflowError) return 'dataflow_error';
  if (err instanceof DataflowAbortedError) return 'dataflow_aborted';
  if (err instanceof PermissionDeniedError) return 'permission_denied';
  return 'internal';
}

/**
 * Send a JSON error response with an appropriate HTTP status code.
 *
 * Use this for routes that return raw data (not BEAST2-wrapped result types)
 * on success, so errors need a different content type and status code.
 */
export function sendJsonError(err: unknown): Response {
  const status = errorToHttpStatus(err);
  const type = errorToType(err);
  const message = err instanceof Error ? err.message : String(err);
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Convert an e3-core error to an API error variant.
 */
export function errorToVariant(err: unknown): Error {
  if (err instanceof RepoNotFoundError) {
    return variant('repository_not_found', { repo: err.repo });
  }
  if (err instanceof WorkspaceNotFoundError) {
    return variant('workspace_not_found', { workspace: err.workspace });
  }
  if (err instanceof WorkspaceNotDeployedError) {
    return variant('workspace_not_deployed', { workspace: err.workspace });
  }
  if (err instanceof WorkspaceExistsError) {
    return variant('workspace_exists', { workspace: err.workspace });
  }
  if (err instanceof WorkspaceLockError) {
    return variant('workspace_locked', {
      workspace: err.workspace,
      holder: err.holder && err.holder.pid !== undefined
        ? variant('known', {
            pid: BigInt(err.holder.pid),
            acquiredAt: err.holder.acquiredAt,
            bootId: err.holder.bootId ? some(err.holder.bootId) : none,
            command: err.holder.command ? some(err.holder.command) : none,
          })
        : variant('unknown', null),
    });
  }
  if (err instanceof PackageNotFoundError) {
    return variant('package_not_found', {
      packageName: err.packageName,
      version: err.version ? some(err.version) : none,
    });
  }
  if (err instanceof PackageExistsError) {
    return variant('package_exists', {
      packageName: err.packageName,
      version: err.version,
    });
  }
  if (err instanceof PackageInvalidError) {
    return variant('package_invalid', { reason: err.message });
  }
  if (err instanceof DatasetNotFoundError) {
    return variant('dataset_not_found', {
      workspace: err.workspace,
      path: err.path,
    });
  }
  if (err instanceof TaskNotFoundError) {
    return variant('task_not_found', { task: err.task });
  }
  if (err instanceof ExecutionNotFoundError) {
    return variant('execution_not_found', { task: err.task });
  }
  if (err instanceof ObjectNotFoundError) {
    return variant('object_not_found', { hash: err.hash });
  }
  if (err instanceof DataflowError) {
    return variant('dataflow_error', { message: err.message });
  }
  if (err instanceof DataflowAbortedError) {
    return variant('dataflow_aborted', null);
  }
  if (err instanceof PermissionDeniedError) {
    return variant('permission_denied', { path: err.path });
  }

  // Fallback for unknown errors
  const message = err instanceof Error ? err.message : String(err);
  return variant('internal', { message });
}
