/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Integration test helpers
 *
 * Utilities for spawning CLI commands and managing test environments
 */

import { spawn, ChildProcess } from 'node:child_process';
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
 * Get the path to the e3 runner binary
 */
export function getE3RunnerPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const distDir = dirname(currentFile);
  const integrationTestsDir = dirname(distDir);
  const workspaceRoot = dirname(integrationTestsDir);
  const runnerPath = join(workspaceRoot, 'e3-runner-node', 'dist', 'src', 'runner.js');
  return runnerPath;
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

/**
 * Track active runner processes for cleanup
 */
const activeRunners = new Set<ChildProcess>();

/**
 * Start an E3 runner process in the background
 *
 * @param repoPath - Path to E3 repository (should point to directory containing .e3)
 * @returns Runner process (must be killed when done)
 */
export function startRunner(repoPath: string): ChildProcess {
  const runnerPath = getE3RunnerPath();

  // Runner expects path to .e3 directory, not parent
  const e3Path = join(repoPath, '.e3');

  const runner = spawn('node', [runnerPath, '--repo', e3Path], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture output for debugging (optional - can be enabled if needed)
  // runner.stdout.on('data', (data) => console.log('[runner stdout]', data.toString()));
  // runner.stderr.on('data', (data) => console.error('[runner stderr]', data.toString()));

  // Track for cleanup
  activeRunners.add(runner);

  // Auto-remove from tracking when it exits
  runner.on('exit', (code) => {
    activeRunners.delete(runner);
    // Uncomment for debugging: console.log(`[runner] exited with code ${code}`);
  });

  return runner;
}

/**
 * Stop a runner process
 */
export function stopRunner(runner: ChildProcess): void {
  if (!runner.killed) {
    runner.kill('SIGTERM');
    activeRunners.delete(runner);
  }
}

/**
 * Stop all active runners (for cleanup)
 */
export function stopAllRunners(): void {
  for (const runner of activeRunners) {
    stopRunner(runner);
  }
  activeRunners.clear();
}

/**
 * Wait for a condition with timeout
 *
 * @param condition - Function that returns true when condition is met
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param checkIntervalMs - How often to check the condition
 * @returns Promise that resolves when condition is met or rejects on timeout
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs: number = 5000,
  checkIntervalMs: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }

  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}
