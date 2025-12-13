/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 init command - Initialize a new e3 repository
 */

import { resolve } from 'path';
import { repoInit } from '@elaraai/e3-core';
import { formatError, exitError } from '../utils.js';

/**
 * Initialize a new e3 repository.
 */
export function initCommand(repoArg: string): void {
  const absolutePath = resolve(repoArg);

  const result = repoInit(absolutePath);

  if (!result.success) {
    if (result.alreadyExists) {
      exitError(`e3 repository already exists at ${result.e3Dir}`);
    } else {
      exitError(`Failed to create repository: ${formatError(result.error)}`);
    }
  }

  console.log(`Initialized e3 repository at ${result.e3Dir}`);
  console.log('');
  console.log('Created:');
  console.log('  objects/      Content-addressable storage');
  console.log('  packages/     Package references');
  console.log('  workspaces/   Workspace state');
  console.log('  executions/   Task execution cache');
}
