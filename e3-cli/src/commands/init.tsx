/**
 * e3 init command - Initialize a new E3 repository
 */

import { render } from 'ink';
import { initRepository as initRepositoryCore, type InitRepositoryResult } from '@elaraai/e3-core';
import { Success, Error as ErrorComponent, Info } from '../ui/index.js';

// Display messages for the directory structure
const DIRECTORY_STRUCTURE = [
  `objects/          # Content-addressable storage`,
  `queue/`,
  `  node/           # Node.js task queue`,
  `claims/`,
  `  node/           # Node.js claimed tasks`,
  `refs/`,
  `  tasks/          # Named task references`,
  `tasks/            # Task state (task_id -> commit)`,
  `tmp/              # Temporary files for atomic operations`,
];

/**
 * CLI handler for the init command
 * This function handles the UI/presentation layer
 */
export async function initRepository(repoPath?: string): Promise<void> {
  const result: InitRepositoryResult = initRepositoryCore(repoPath ?? process.cwd());

  if (!result.success) {
    if (result.alreadyExists) {
      render(<ErrorComponent message={`E3 repository already exists at ${result.e3Dir}`} />);
    } else {
      render(<ErrorComponent message={`Failed to create E3 repository: ${result.error?.message}`} />);
    }
    process.exit(1);
  }

  render(<Info message={`Initializing E3 repository at ${result.e3Dir}...`} />);
  render(
    <Success
      message="E3 repository initialized successfully"
      details={DIRECTORY_STRUCTURE}
    />
  );
}
