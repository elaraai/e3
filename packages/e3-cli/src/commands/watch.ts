/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 watch command - Live development with auto-deploy on save
 *
 * Usage:
 *   e3 watch . dev ./src/my-package.ts
 *   e3 watch . dev ./src/my-package.ts --start
 *   e3 watch . dev ./src/my-package.ts --start --abort-on-change
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vm from 'vm';
import Module from 'node:module';
import ts from 'typescript';
import e3 from '@elaraai/e3';
import type { PackageDef } from '@elaraai/e3';
import {
  packageImport,
  workspaceCreate,
  workspaceGetState,
  workspaceDeploy,
  dataflowExecute,
  DataflowAbortedError,
  type TaskExecutionResult,
} from '@elaraai/e3-core';
import { resolveRepo, formatError } from '../utils.js';

interface WatchOptions {
  start?: boolean;
  concurrency?: string;
  abortOnChange?: boolean;
}

/**
 * Load compiler options from user's tsconfig.json
 */
function loadCompilerOptions(filePath: string): ts.CompilerOptions {
  const searchPath = path.dirname(filePath);

  // Find tsconfig.json starting from the source file's directory
  const configPath = ts.findConfigFile(searchPath, ts.sys.fileExists, 'tsconfig.json');

  if (configPath) {
    // Read and parse tsconfig.json (handles "extends" automatically)
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      console.log(`Warning: Error reading ${configPath}: ${configFile.error.messageText}`);
    } else {
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      );
      return {
        ...parsed.options,
        // Override module to CommonJS for vm execution
        module: ts.ModuleKind.CommonJS,
      };
    }
  }

  // Fallback defaults if no tsconfig found
  return {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    strict: true,
  };
}

/**
 * Load and execute a TypeScript file, returning its default export
 */
function loadPackageFile(filePath: string): PackageDef<Record<string, unknown>> {
  const absolutePath = path.resolve(filePath);
  const tsCode = fs.readFileSync(absolutePath, 'utf-8');
  const compilerOptions = loadCompilerOptions(absolutePath);

  // Transpile TypeScript to JavaScript
  const result = ts.transpileModule(tsCode, {
    compilerOptions,
    fileName: absolutePath,
  });

  // Create require that resolves from user's project directory
  const userRequire = Module.createRequire(absolutePath);

  // Execute in VM context
  const moduleObj = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: userRequire,
    console,
    Buffer,
    process,
    __dirname: path.dirname(absolutePath),
    __filename: absolutePath,
  });

  try {
    vm.runInContext(result.outputText, context, { filename: absolutePath });
  } catch (err) {
    throw new Error(`Failed to execute ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Get default export
  const defaultExport = moduleObj.exports.default ?? moduleObj.exports;

  // Validate it's a PackageDef
  if (!defaultExport || (defaultExport as { kind?: string }).kind !== 'package') {
    throw new Error(
      `Default export must be a PackageDef (created with e3.package()).\n\n` +
      `Expected:\n` +
      `  const pkg = e3.package('name', '1.0.0', ...tasks);\n` +
      `  export default pkg;\n\n` +
      `Got: ${typeof defaultExport}${(defaultExport as { kind?: string }).kind ? ` with kind="${(defaultExport as { kind?: string }).kind}"` : ''}`
    );
  }

  return defaultExport as PackageDef<Record<string, unknown>>;
}

/**
 * Format timestamp for log output
 */
function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Watch a TypeScript file and auto-deploy on changes
 */
export async function watchCommand(
  repoArg: string,
  workspace: string,
  sourceFile: string,
  options: WatchOptions
): Promise<void> {
  const repoPath = resolveRepo(repoArg);
  const absoluteSourcePath = path.resolve(sourceFile);
  const concurrency = options.concurrency ? parseInt(options.concurrency, 10) : 4;

  // Validate source file exists
  if (!fs.existsSync(absoluteSourcePath)) {
    console.error(`Error: Source file not found: ${absoluteSourcePath}`);
    process.exit(1);
  }

  console.log(`Watching: ${sourceFile}`);
  console.log(`Repository: ${repoPath}`);
  console.log(`Target workspace: ${workspace}`);
  if (options.start) {
    console.log(`Auto-start: enabled (concurrency: ${concurrency})`);
    if (options.abortOnChange) {
      console.log(`Abort on change: enabled`);
    }
  }
  console.log('');

  // State for managing concurrent execution
  let isExecuting = false;
  let pendingReload = false;
  let currentAbortController: AbortController | null = null;

  /**
   * Load, export, import, and deploy the package
   */
  async function deployPackage(): Promise<{ name: string; version: string } | null> {
    // Load package from TypeScript file
    let pkg: PackageDef<Record<string, unknown>>;
    try {
      pkg = loadPackageFile(absoluteSourcePath);
      console.log(`[${timestamp()}] Loaded: ${pkg.name}@${pkg.version}`);
    } catch (err) {
      console.log(`[${timestamp()}] Error loading package:`);
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    // Export to temp zip
    const tempZip = path.join(os.tmpdir(), `e3-watch-${Date.now()}.zip`);
    try {
      await e3.export(pkg, tempZip);
    } catch (err) {
      console.log(`[${timestamp()}] Error exporting package:`);
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    // Import into repository
    try {
      await packageImport(repoPath, tempZip);
    } catch (err) {
      console.log(`[${timestamp()}] Error importing package:`);
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tempZip);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Ensure workspace exists
    try {
      await workspaceGetState(repoPath, workspace);
    } catch {
      // Workspace doesn't exist, create it
      try {
        await workspaceCreate(repoPath, workspace);
        console.log(`[${timestamp()}] Created workspace: ${workspace}`);
      } catch (err) {
        console.log(`[${timestamp()}] Error creating workspace:`);
        console.log(`  ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }

    // Deploy to workspace
    try {
      await workspaceDeploy(repoPath, workspace, pkg.name, pkg.version);
      console.log(`[${timestamp()}] Deployed to workspace: ${workspace}`);
    } catch (err) {
      console.log(`[${timestamp()}] Error deploying:`);
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    return { name: pkg.name, version: pkg.version };
  }

  /**
   * Execute the dataflow in the workspace
   */
  async function runDataflow(signal: AbortSignal): Promise<void> {
    console.log(`[${timestamp()}] Starting dataflow...`);

    try {
      const result = await dataflowExecute(repoPath, workspace, {
        concurrency,
        signal,
        onTaskStart: (name) => {
          console.log(`  [START] ${name}`);
        },
        onTaskComplete: (taskResult: TaskExecutionResult) => {
          const status = taskResult.state === 'success' ? 'DONE' :
                        taskResult.state === 'failed' ? 'FAIL' :
                        taskResult.state === 'skipped' ? 'SKIP' : 'ERR';
          const cached = taskResult.cached ? ' (cached)' : '';
          const duration = taskResult.duration > 0 ? ` [${taskResult.duration}ms]` : '';
          console.log(`  [${status}] ${taskResult.name}${cached}${duration}`);
        },
      });

      if (result.success) {
        console.log(`[${timestamp()}] Dataflow complete (${result.executed} executed, ${result.cached} cached)`);
      } else {
        console.log(`[${timestamp()}] Dataflow failed (${result.failed} failed)`);
      }
    } catch (err) {
      if (err instanceof DataflowAbortedError) {
        console.log(`[${timestamp()}] Dataflow aborted`);
      } else {
        console.log(`[${timestamp()}] Dataflow error:`);
        console.log(`  ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Handle a file change event
   */
  async function handleChange(): Promise<void> {
    if (isExecuting) {
      if (options.abortOnChange && currentAbortController) {
        console.log(`[${timestamp()}] File changed, aborting current execution...`);
        currentAbortController.abort();
      } else {
        console.log(`[${timestamp()}] File changed (queued, execution in progress)`);
        pendingReload = true;
      }
      return;
    }

    isExecuting = true;
    pendingReload = false;

    console.log(`[${timestamp()}] File changed, reloading...`);

    const deployed = await deployPackage();

    if (deployed && options.start) {
      currentAbortController = new AbortController();
      await runDataflow(currentAbortController.signal);
      currentAbortController = null;
    }

    isExecuting = false;

    // Process queued reload if any
    if (pendingReload) {
      console.log(`[${timestamp()}] Processing queued reload...`);
      await handleChange();
    } else {
      console.log(`[${timestamp()}] Waiting for changes...`);
    }
  }

  // Initial load
  console.log(`[${timestamp()}] Initial load...`);
  isExecuting = true;

  const deployed = await deployPackage();

  if (deployed && options.start) {
    currentAbortController = new AbortController();
    await runDataflow(currentAbortController.signal);
    currentAbortController = null;
  }

  isExecuting = false;
  console.log(`[${timestamp()}] Ready. Waiting for changes...`);
  console.log('');

  // Set up file watcher with debounce
  let debounceTimer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(absoluteSourcePath, () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      handleChange().catch(err => {
        console.log(`[${timestamp()}] Unexpected error:`);
        console.log(`  ${formatError(err)}`);
      });
    }, 100);
  });

  // Handle signals for graceful shutdown
  const cleanup = () => {
    console.log('');
    console.log('Stopping watch...');
    watcher.close();
    if (currentAbortController) {
      currentAbortController.abort();
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
