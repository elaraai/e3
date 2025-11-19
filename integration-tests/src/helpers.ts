/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Integration test helpers
 *
 * Utilities for spawning CLI commands and managing test environments
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/**
 * Track parent temp directories for cleanup
 */
const tempDirParents = new Map<string, string>();

/**
 * Get the path to the e3 CLI binary
 */
export function getE3CliPath(): string {
  // From integration-tests/dist/helpers.js we need to go to e3-cli/dist/src/cli.js
  // integration-tests/dist/helpers.js -> integration-tests/dist -> integration-tests -> workspace root
  const currentFile = fileURLToPath(import.meta.url);
  const distDir = dirname(currentFile); // integration-tests/dist
  const integrationTestsDir = dirname(distDir); // integration-tests
  const workspaceRoot = dirname(integrationTestsDir); // workspace root
  const cliPath = join(workspaceRoot, 'e3-cli', 'dist', 'src', 'cli.js');
  return cliPath;
}

/**
 * Create a temporary directory for integration testing
 */
export function createTestDir(): string {
  const parentDir = mkdtempSync(join(tmpdir(), 'e3-integration-'));
  const testDir = join(parentDir, 'test');
  tempDirParents.set(testDir, parentDir);
  return testDir;
}

/**
 * Remove a temporary test directory
 */
export function removeTestDir(testDir: string): void {
  const parentDir = tempDirParents.get(testDir);
  if (parentDir) {
    rmSync(parentDir, { recursive: true, force: true });
    tempDirParents.delete(testDir);
  }
}

/**
 * Result from running a CLI command
 */
export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run an e3 CLI command
 *
 * @param args - Command arguments (e.g., ['init'])
 * @param cwd - Working directory for the command
 * @param input - Optional stdin input
 * @returns Promise with exit code, stdout, and stderr
 */
export async function runE3Command(
  args: string[],
  cwd: string,
  input?: string
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const cliPath = getE3CliPath();

    const child = spawn('node', [cliPath, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    // Write input if provided
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}
