/**
 * e3 init command - Initialize a new E3 repository
 */

import React from 'react';
import { render } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { Success, Error, Info } from '../ui/index.js';

/**
 * Initialize a new E3 repository at the specified path
 */
export async function initRepository(repoPath?: string): Promise<void> {
  const targetPath = repoPath ? path.resolve(repoPath) : process.cwd();
  const e3Dir = path.join(targetPath, '.e3');

  // Check if .e3 already exists
  if (fs.existsSync(e3Dir)) {
    render(<Error message={`E3 repository already exists at ${e3Dir}`} />);
    process.exit(1);
  }

  render(<Info message={`Initializing E3 repository at ${e3Dir}...`} />);

  try {
    // Create main .e3 directory
    fs.mkdirSync(e3Dir, { recursive: true });

    // Create objects directory (with subdirectories for first 2 chars of hash)
    fs.mkdirSync(path.join(e3Dir, 'objects'), { recursive: true });

    // Create queue directories for each runtime
    fs.mkdirSync(path.join(e3Dir, 'queue', 'node'), { recursive: true });
    fs.mkdirSync(path.join(e3Dir, 'queue', 'python'), { recursive: true });
    fs.mkdirSync(path.join(e3Dir, 'queue', 'julia'), { recursive: true });

    // Create refs directory for named task references
    fs.mkdirSync(path.join(e3Dir, 'refs', 'tasks'), { recursive: true });

    // Create tasks directory (task_id -> commit_hash mapping)
    fs.mkdirSync(path.join(e3Dir, 'tasks'), { recursive: true });

    // Create tmp directory for atomic operations
    fs.mkdirSync(path.join(e3Dir, 'tmp'), { recursive: true });

    render(
      <Success
        message="E3 repository initialized successfully"
        details={[
          `objects/          # Content-addressable storage`,
          `queue/`,
          `  node/           # Node.js task queue`,
          `  python/         # Python task queue`,
          `  julia/          # Julia task queue`,
          `refs/`,
          `  tasks/          # Named task references`,
          `tasks/            # Task state (task_id -> commit)`,
          `tmp/              # Temporary files for atomic operations`,
        ]}
      />
    );
  } catch (error) {
    render(<Error message={`Failed to create E3 repository: ${error}`} />);
    process.exit(1);
  }
}
