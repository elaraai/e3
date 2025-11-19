/**
 * Repository discovery and validation
 */

import { render } from 'ink';
import { findRepository as findRepositoryCore } from '@elaraai/e3-core';
import { Error } from './ui/index.js';

/**
 * Get the E3 repository, or error if not found
 */
export function getRepository(repoPath?: string): string {
  const repo = findRepositoryCore(repoPath);

  if (!repo) {
    render(
      <Error
        message="Not in an E3 repository"
        details={[
          'Run `e3 init` to create a new repository, or',
          'Set E3_REPO environment variable to point to an existing repository',
        ]}
      />
    );
    process.exit(1);
  }

  return repo;
}
