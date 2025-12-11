/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dataflow execution for e3 workspaces.
 *
 * Executes tasks in a workspace based on their dependency graph. Tasks are
 * executed in parallel where possible, respecting a concurrency limit.
 *
 * The execution model is event-driven with a work queue:
 * 1. Build dependency graph from tasks (input paths -> task -> output path)
 * 2. Compute reverse dependencies (which tasks depend on each output)
 * 3. Initialize ready queue with tasks whose inputs are all assigned
 * 4. Execute tasks from ready queue, respecting concurrency limit
 * 5. On task completion, update workspace and check dependents for readiness
 * 6. On failure, stop launching new tasks but wait for running ones
 */

import { decodeBeast2For } from '@elaraai/east';
import {
  PackageObjectType,
  TaskObjectType,
  pathToString,
  type TaskObject,
  type TreePath,
} from '@elaraai/e3-types';
import { objectRead } from './objects.js';
import {
  taskExecute,
  executionGetOutput,
  inputsHash,
  type ExecuteOptions,
} from './executions.js';
import {
  workspaceGetDatasetHash,
  workspaceSetDatasetByHash,
} from './trees.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

/**
 * Information about a task in the dependency graph.
 */
interface TaskNode {
  /** Task name */
  name: string;
  /** Hash of the TaskObject in object store */
  hash: string;
  /** The decoded TaskObject */
  task: TaskObject;
  /** Input dataset paths */
  inputPaths: TreePath[];
  /** Output dataset path */
  outputPath: TreePath;
  /** Number of unresolved dependencies (inputs that are unassigned) */
  unresolvedCount: number;
}

/**
 * Result of executing a single task in the dataflow.
 */
export interface TaskExecutionResult {
  /** Task name */
  name: string;
  /** Whether the task was cached */
  cached: boolean;
  /** Final state */
  state: 'success' | 'failed' | 'error' | 'skipped';
  /** Error message if state is 'error' */
  error?: string;
  /** Exit code if state is 'failed' */
  exitCode?: number;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Result of a dataflow execution.
 */
export interface DataflowResult {
  /** Overall success - true if all tasks completed successfully */
  success: boolean;
  /** Number of tasks executed (not from cache) */
  executed: number;
  /** Number of tasks served from cache */
  cached: number;
  /** Number of tasks that failed */
  failed: number;
  /** Number of tasks skipped due to upstream failure */
  skipped: number;
  /** Per-task results */
  tasks: TaskExecutionResult[];
  /** Total duration in milliseconds */
  duration: number;
}

/**
 * Options for dataflow execution.
 */
export interface DataflowOptions {
  /** Maximum concurrent task executions (default: 4) */
  concurrency?: number;
  /** Force re-execution even if cached (default: false) */
  force?: boolean;
  /** Filter to run only specific task(s) by exact name */
  filter?: string;
  /** Callback when a task starts */
  onTaskStart?: (name: string) => void;
  /** Callback when a task completes */
  onTaskComplete?: (result: TaskExecutionResult) => void;
  /** Callback for task stdout */
  onStdout?: (taskName: string, data: string) => void;
  /** Callback for task stderr */
  onStderr?: (taskName: string, data: string) => void;
}

// =============================================================================
// Workspace State Reader
// =============================================================================

/**
 * Read workspace state from file.
 */
async function readWorkspaceState(repoPath: string, ws: string) {
  const { decodeBeast2For } = await import('@elaraai/east');
  const { WorkspaceStateType } = await import('@elaraai/e3-types');

  const stateFile = path.join(repoPath, 'workspaces', `${ws}.beast2`);
  const data = await fs.readFile(stateFile);
  if (data.length === 0) {
    throw new Error(`Workspace not deployed: ${ws}`);
  }
  const decoder = decodeBeast2For(WorkspaceStateType);
  return decoder(data);
}

// =============================================================================
// Dependency Graph Building
// =============================================================================

/**
 * Build the dependency graph for a workspace.
 *
 * Returns:
 * - taskNodes: Map of task name -> TaskNode
 * - outputToTask: Map of output path string -> task name
 * - taskDependents: Map of task name -> set of dependent task names
 */
async function buildDependencyGraph(
  repoPath: string,
  ws: string
): Promise<{
  taskNodes: Map<string, TaskNode>;
  outputToTask: Map<string, string>;
  taskDependents: Map<string, Set<string>>;
}> {
  // Read workspace state to get package hash
  const state = await readWorkspaceState(repoPath, ws);

  // Read package object to get tasks map
  const pkgData = await objectRead(repoPath, state.packageHash);
  const pkgDecoder = decodeBeast2For(PackageObjectType);
  const pkgObject = pkgDecoder(Buffer.from(pkgData));

  const taskNodes = new Map<string, TaskNode>();
  const outputToTask = new Map<string, string>(); // output path -> task name

  // First pass: load all tasks and build output->task map
  const taskDecoder = decodeBeast2For(TaskObjectType);
  for (const [taskName, taskHash] of pkgObject.tasks) {
    const taskData = await objectRead(repoPath, taskHash);
    const task = taskDecoder(Buffer.from(taskData));

    const outputPathStr = pathToString(task.output);
    outputToTask.set(outputPathStr, taskName);

    taskNodes.set(taskName, {
      name: taskName,
      hash: taskHash,
      task,
      inputPaths: task.inputs,
      outputPath: task.output,
      unresolvedCount: 0, // Will be computed below
    });
  }

  // Build reverse dependency map: task -> tasks that depend on it
  const taskDependents = new Map<string, Set<string>>();
  for (const taskName of taskNodes.keys()) {
    taskDependents.set(taskName, new Set());
  }

  // Second pass: compute dependencies and unresolved counts
  for (const [taskName, node] of taskNodes) {
    for (const inputPath of node.inputPaths) {
      const inputPathStr = pathToString(inputPath);
      const producerTask = outputToTask.get(inputPathStr);

      if (producerTask) {
        // This input comes from another task's output
        taskDependents.get(producerTask)!.add(taskName);

        // Check if the input is currently unassigned
        const { refType } = await workspaceGetDatasetHash(repoPath, ws, inputPath);
        if (refType === 'unassigned') {
          node.unresolvedCount++;
        }
      }
      // If not produced by a task, it's an external input - check if assigned
      else {
        const { refType } = await workspaceGetDatasetHash(repoPath, ws, inputPath);
        if (refType === 'unassigned') {
          // External input that is unassigned - this task can never run
          node.unresolvedCount++;
        }
      }
    }
  }

  return { taskNodes, outputToTask, taskDependents };
}

// =============================================================================
// Dataflow Execution
// =============================================================================

/**
 * Execute all tasks in a workspace according to the dependency graph.
 *
 * Tasks are executed in parallel where dependencies allow, respecting
 * the concurrency limit. On failure, no new tasks are launched but
 * running tasks are allowed to complete.
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @param options - Execution options
 * @returns Result of the dataflow execution
 */
export async function dataflowExecute(
  repoPath: string,
  ws: string,
  options: DataflowOptions = {}
): Promise<DataflowResult> {
  const startTime = Date.now();
  const concurrency = options.concurrency ?? 4;

  // Build dependency graph
  const { taskNodes, taskDependents } = await buildDependencyGraph(repoPath, ws);

  // Apply filter if specified
  const filteredTaskNames = options.filter
    ? new Set([options.filter])
    : null;

  // Validate filter
  if (filteredTaskNames && options.filter && !taskNodes.has(options.filter)) {
    const available = Array.from(taskNodes.keys()).join(', ');
    throw new Error(
      `Task '${options.filter}' not found in workspace. Available: ${available || '(none)'}`
    );
  }

  // Track execution state
  const results: TaskExecutionResult[] = [];
  let executed = 0;
  let cached = 0;
  let failed = 0;
  let skipped = 0;
  let hasFailure = false;

  // Ready queue: tasks with all dependencies resolved
  const readyQueue: string[] = [];
  const completed = new Set<string>();
  const inProgress = new Set<string>();

  // Initialize ready queue with tasks that have no unresolved dependencies
  // and pass the filter (if any)
  for (const [taskName, node] of taskNodes) {
    if (node.unresolvedCount === 0) {
      if (!filteredTaskNames || filteredTaskNames.has(taskName)) {
        readyQueue.push(taskName);
      }
    }
  }

  // Check if the task has a valid cached execution for current inputs
  // Returns the output hash if cached, null if re-execution is needed
  async function getCachedOutput(taskName: string): Promise<string | null> {
    const node = taskNodes.get(taskName)!;

    // Gather current input hashes
    const currentInputHashes: string[] = [];
    for (const inputPath of node.inputPaths) {
      const { refType, hash } = await workspaceGetDatasetHash(repoPath, ws, inputPath);
      if (refType !== 'value' || hash === null) {
        // Input not assigned, can't be cached
        return null;
      }
      currentInputHashes.push(hash);
    }

    // Check if there's a cached execution for these inputs
    const inHash = inputsHash(currentInputHashes);
    const cachedOutputHash = await executionGetOutput(repoPath, node.hash, inHash);

    if (cachedOutputHash === null) {
      // No cached execution for current inputs
      return null;
    }

    // Also verify the workspace output matches the cached output
    // (in case the workspace was modified outside of execution)
    const { refType, hash: wsOutputHash } = await workspaceGetDatasetHash(repoPath, ws, node.outputPath);
    if (refType !== 'value' || wsOutputHash !== cachedOutputHash) {
      // Workspace output doesn't match cached output, need to re-execute
      // (or update workspace with cached value)
      return null;
    }

    return cachedOutputHash;
  }

  // Execute a single task
  async function executeTask(taskName: string): Promise<TaskExecutionResult> {
    const node = taskNodes.get(taskName)!;
    const taskStartTime = Date.now();

    options.onTaskStart?.(taskName);

    // Gather input hashes
    const inputHashes: string[] = [];
    for (const inputPath of node.inputPaths) {
      const { refType, hash } = await workspaceGetDatasetHash(repoPath, ws, inputPath);
      if (refType !== 'value' || hash === null) {
        // Input not available - should not happen if dependency tracking is correct
        return {
          name: taskName,
          cached: false,
          state: 'error',
          error: `Input at ${pathToString(inputPath)} is not assigned (refType: ${refType})`,
          duration: Date.now() - taskStartTime,
        };
      }
      inputHashes.push(hash);
    }

    // Execute the task
    const execOptions: ExecuteOptions = {
      force: options.force,
      onStdout: options.onStdout ? (data) => options.onStdout!(taskName, data) : undefined,
      onStderr: options.onStderr ? (data) => options.onStderr!(taskName, data) : undefined,
    };

    const result = await taskExecute(repoPath, node.hash, inputHashes, execOptions);

    // Build task result
    const taskResult: TaskExecutionResult = {
      name: taskName,
      cached: result.cached,
      state: result.state,
      duration: Date.now() - taskStartTime,
    };

    if (result.state === 'error') {
      taskResult.error = result.error ?? undefined;
    } else if (result.state === 'failed') {
      taskResult.exitCode = result.exitCode ?? undefined;
    }

    // On success, update the workspace with the output
    if (result.state === 'success' && result.outputHash) {
      await workspaceSetDatasetByHash(repoPath, ws, node.outputPath, result.outputHash);
    }

    return taskResult;
  }

  // Process dependents when a task completes
  function notifyDependents(taskName: string) {
    const dependents = taskDependents.get(taskName) ?? new Set();
    for (const depName of dependents) {
      if (completed.has(depName) || inProgress.has(depName)) continue;

      // Skip dependents not in the filter
      if (filteredTaskNames && !filteredTaskNames.has(depName)) continue;

      const depNode = taskNodes.get(depName)!;
      depNode.unresolvedCount--;

      if (depNode.unresolvedCount === 0 && !readyQueue.includes(depName)) {
        readyQueue.push(depName);
      }
    }
  }

  // Mark dependents as skipped when a task fails
  function skipDependents(taskName: string) {
    const dependents = taskDependents.get(taskName) ?? new Set();
    for (const depName of dependents) {
      if (completed.has(depName) || inProgress.has(depName)) continue;

      // Skip dependents not in the filter
      if (filteredTaskNames && !filteredTaskNames.has(depName)) continue;

      // Recursively skip
      completed.add(depName);
      skipped++;
      results.push({
        name: depName,
        cached: false,
        state: 'skipped',
        duration: 0,
      });
      options.onTaskComplete?.({
        name: depName,
        cached: false,
        state: 'skipped',
        duration: 0,
      });

      skipDependents(depName);
    }
  }

  // Main execution loop using a work-stealing approach
  const runningPromises = new Map<string, Promise<void>>();

  async function processQueue(): Promise<void> {
    while (true) {
      // Check if we're done
      if (readyQueue.length === 0 && runningPromises.size === 0) {
        break;
      }

      // Launch tasks up to concurrency limit if no failure
      while (!hasFailure && readyQueue.length > 0 && runningPromises.size < concurrency) {
        const taskName = readyQueue.shift()!;

        if (completed.has(taskName) || inProgress.has(taskName)) continue;

        // Check if there's a valid cached execution for current inputs
        const cachedOutputHash = await getCachedOutput(taskName);
        if (cachedOutputHash !== null && !options.force) {
          // Valid cached execution exists for current inputs
          completed.add(taskName);
          cached++;
          const result: TaskExecutionResult = {
            name: taskName,
            cached: true,
            state: 'success',
            duration: 0,
          };
          results.push(result);
          options.onTaskComplete?.(result);
          notifyDependents(taskName);
          continue;
        }

        inProgress.add(taskName);

        const promise = (async () => {
          try {
            const result = await executeTask(taskName);

            inProgress.delete(taskName);
            completed.add(taskName);
            results.push(result);
            options.onTaskComplete?.(result);

            if (result.state === 'success') {
              if (result.cached) {
                cached++;
              } else {
                executed++;
              }
              notifyDependents(taskName);
            } else {
              failed++;
              hasFailure = true;
              skipDependents(taskName);
            }
          } finally {
            runningPromises.delete(taskName);
          }
        })();

        runningPromises.set(taskName, promise);
      }

      // Wait for at least one task to complete if we can't launch more
      if (runningPromises.size > 0) {
        await Promise.race(runningPromises.values());
      } else if (readyQueue.length === 0) {
        // No running tasks and no ready tasks - we might have unresolvable dependencies
        break;
      }
    }
  }

  await processQueue();

  // Wait for any remaining tasks
  if (runningPromises.size > 0) {
    await Promise.all(runningPromises.values());
  }

  return {
    success: !hasFailure,
    executed,
    cached,
    failed,
    skipped,
    tasks: results,
    duration: Date.now() - startTime,
  };
}

/**
 * Get the dependency graph for a workspace (for visualization/debugging).
 *
 * @param repoPath - Path to .e3 repository
 * @param ws - Workspace name
 * @returns Graph information
 */
export async function dataflowGetGraph(
  repoPath: string,
  ws: string
): Promise<{
  tasks: Array<{
    name: string;
    hash: string;
    inputs: string[];
    output: string;
    dependsOn: string[];
  }>;
}> {
  const { taskNodes, outputToTask } = await buildDependencyGraph(repoPath, ws);

  const tasks: Array<{
    name: string;
    hash: string;
    inputs: string[];
    output: string;
    dependsOn: string[];
  }> = [];

  for (const [taskName, node] of taskNodes) {
    const dependsOn: string[] = [];

    for (const inputPath of node.inputPaths) {
      const inputPathStr = pathToString(inputPath);
      const producerTask = outputToTask.get(inputPathStr);
      if (producerTask) {
        dependsOn.push(producerTask);
      }
    }

    tasks.push({
      name: taskName,
      hash: node.hash,
      inputs: node.inputPaths.map(pathToString),
      output: pathToString(node.outputPath),
      dependsOn,
    });
  }

  return { tasks };
}
