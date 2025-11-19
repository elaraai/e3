/**
 * e3 init command - Initialize a new E3 repository
 */

import { render } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { Success, Error as ErrorComponent, Info } from '../ui/index.js';

/**
 * Result of initializing an E3 repository
 */
export interface InitRepositoryResult {
  success: boolean;
  e3Dir: string;
  error?: Error;
  alreadyExists?: boolean;
  directoryStructure?: string[];
}

/**
 * Core logic for initializing an E3 repository
 * This function is decoupled from CLI/UI concerns and can be used programmatically
 */
export function initRepositoryCore(repoPath: string): InitRepositoryResult {
  const targetPath = path.resolve(repoPath);
  const e3Dir = path.join(targetPath, '.e3');

  // Check if .e3 already exists
  if (fs.existsSync(e3Dir)) {
    return {
      success: false,
      e3Dir,
      alreadyExists: true,
      error: new Error(`E3 repository already exists at ${e3Dir}`),
    };
  }

  try {
    // Create main .e3 directory
    fs.mkdirSync(e3Dir, { recursive: true });

    // Create objects directory (with subdirectories for first 2 chars of hash)
    fs.mkdirSync(path.join(e3Dir, 'objects'), { recursive: true });

    // Create queue directories for each runtime
    fs.mkdirSync(path.join(e3Dir, 'queue', 'node'), { recursive: true });
    fs.mkdirSync(path.join(e3Dir, 'queue', 'python'), { recursive: true });
    fs.mkdirSync(path.join(e3Dir, 'queue', 'julia'), { recursive: true });

    // Create claims directories for each runtime
    fs.mkdirSync(path.join(e3Dir, 'claims', 'node'), { recursive: true });
    fs.mkdirSync(path.join(e3Dir, 'claims', 'python'), { recursive: true });
    fs.mkdirSync(path.join(e3Dir, 'claims', 'julia'), { recursive: true });

    // Create refs directory for named task references
    fs.mkdirSync(path.join(e3Dir, 'refs', 'tasks'), { recursive: true });

    // Create tasks directory (task_id -> commit_hash mapping)
    fs.mkdirSync(path.join(e3Dir, 'tasks'), { recursive: true });

    // Create tmp directory for atomic operations
    fs.mkdirSync(path.join(e3Dir, 'tmp'), { recursive: true });

    return {
      success: true,
      e3Dir,
      directoryStructure: [
        `objects/          # Content-addressable storage`,
        `queue/`,
        `  node/           # Node.js task queue`,
        `  python/         # Python task queue`,
        `  julia/          # Julia task queue`,
        `claims/`,
        `  node/           # Node.js claimed tasks`,
        `  python/         # Python claimed tasks`,
        `  julia/          # Julia claimed tasks`,
        `refs/`,
        `  tasks/          # Named task references`,
        `tasks/            # Task state (task_id -> commit)`,
        `tmp/              # Temporary files for atomic operations`,
      ],
    };
  } catch (error) {
    return {
      success: false,
      e3Dir,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * CLI handler for the init command
 * This function handles the UI/presentation layer
 */
export async function initRepository(repoPath?: string): Promise<void> {
  const result = initRepositoryCore(repoPath ?? process.cwd());

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
      details={result.directoryStructure}
    />
  );
}
