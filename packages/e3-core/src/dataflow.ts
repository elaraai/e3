/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataflow execution for e3 workspaces.
 *
 * Provides the high-level `dataflowExecute` entry point (which delegates
 * to `LocalOrchestrator`) and shared graph-building utilities used by
 * both local and cloud execution paths.
 *
 * The reactive execution logic (input change detection, task invalidation,
 * version vector consistency) lives in `dataflow/steps.ts` and is orchestrated
 * by `dataflow/orchestrator/LocalOrchestrator.ts`.
 */

import { decodeBeast2For, variant } from '@elaraai/east';
import {
  PackageObjectType,
  TaskObjectType,
  WorkspaceStateType,
  pathToString,
  type TaskObject,
  type TreePath,
} from '@elaraai/e3-types';
import {
  executionGetOutput,
  inputsHash,
} from './executions.js';
import type { TaskRunner } from './execution/interfaces.js';
import {
  workspaceGetDatasetHash,
} from './trees.js';
import {
  E3Error,
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  DataflowError,
} from './errors.js';
import type { StorageBackend, LockHandle } from './storage/interfaces.js';

// =============================================================================
// Path Parsing Helper
// =============================================================================

/**
 * Parse a keypath string (from pathToString) back to TreePath.
 *
 * The keypath format is: .field1.field2 (dot-separated field names)
 * Quoted identifiers use backticks: .field1.`complex/name`
 *
 * @param pathStr - The path string in keypath format
 * @returns TreePath array of path segments
 */
export function parsePathString(pathStr: string): TreePath {
  if (!pathStr.startsWith('.')) {
    throw new Error(`Invalid path string: expected '.' prefix, got '${pathStr}'`);
  }

  const segments: TreePath = [];
  let i = 1; // Skip the leading '.'

  while (i < pathStr.length) {
    let fieldName: string;

    if (pathStr[i] === '`') {
      // Quoted identifier: find closing backtick
      const endQuote = pathStr.indexOf('`', i + 1);
      if (endQuote === -1) {
        throw new Error(`Invalid path string: unclosed backtick at position ${i}`);
      }
      fieldName = pathStr.slice(i + 1, endQuote);
      i = endQuote + 1;
    } else {
      // Unquoted identifier: read until '.' or end
      let end = pathStr.indexOf('.', i);
      if (end === -1) end = pathStr.length;
      fieldName = pathStr.slice(i, end);
      i = end;
    }

    if (fieldName) {
      segments.push(variant('field', fieldName));
    }

    // Skip the '.' separator
    if (i < pathStr.length && pathStr[i] === '.') {
      i++;
    }
  }

  return segments;
}

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
  /** Execution ID (UUIDv7) - present for executed or cached tasks */
  executionId?: string;
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
  /** Dataflow run ID (UUIDv7) */
  runId: string;
  /** Number of tasks executed (not from cache) */
  executed: number;
  /** Number of tasks served from cache */
  cached: number;
  /** Number of tasks that failed */
  failed: number;
  /** Number of tasks skipped due to upstream failure */
  skipped: number;
  /** Number of tasks re-executed due to input changes */
  reexecuted: number;
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
  /** External workspace lock to use. */
  lock?: LockHandle;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Task runner for executing individual tasks. */
  runner?: TaskRunner;
  /** Callback when a task starts */
  onTaskStart?: (name: string) => void;
  /** Callback when a task completes */
  onTaskComplete?: (result: TaskExecutionResult) => void;
  /** Callback for task stdout */
  onStdout?: (taskName: string, data: string) => void;
  /** Callback for task stderr */
  onStderr?: (taskName: string, data: string) => void;
  /** Callback when an input dataset changes during execution (reactive dataflow) */
  onInputChanged?: (path: string, previousHash: string, newHash: string) => void;
  /** Callback when a task is invalidated due to input change */
  onTaskInvalidated?: (taskName: string, reason: string) => void;
  /** Callback when a task is deferred due to inconsistent input versions */
  onTaskDeferred?: (taskName: string, conflictPath: string) => void;
}

// =============================================================================
// Workspace State Reader
// =============================================================================

/**
 * Read workspace state.
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 */
async function readWorkspaceState(storage: StorageBackend, repo: string, ws: string) {
  const data = await storage.refs.workspaceRead(repo, ws);
  if (data === null) {
    throw new WorkspaceNotFoundError(ws);
  }
  if (data.length === 0) {
    throw new WorkspaceNotDeployedError(ws);
  }
  const decoder = decodeBeast2For(WorkspaceStateType);
  return decoder(Buffer.from(data));
}

// =============================================================================
// Dependency Graph Building
// =============================================================================

/**
 * Build the dependency graph for a workspace.
 */
async function buildDependencyGraph(
  storage: StorageBackend,
  repo: string,
  ws: string
): Promise<{
  taskNodes: Map<string, TaskNode>;
  outputToTask: Map<string, string>;
  taskDependents: Map<string, Set<string>>;
}> {
  const state = await readWorkspaceState(storage, repo, ws);

  const pkgData = await storage.objects.read(repo, state.packageHash);
  const pkgDecoder = decodeBeast2For(PackageObjectType);
  const pkgObject = pkgDecoder(Buffer.from(pkgData));

  const taskNodes = new Map<string, TaskNode>();
  const outputToTask = new Map<string, string>();

  const taskDecoder = decodeBeast2For(TaskObjectType);
  for (const [taskName, taskHash] of pkgObject.tasks) {
    const taskData = await storage.objects.read(repo, taskHash);
    const task = taskDecoder(Buffer.from(taskData));

    const outputPathStr = pathToString(task.output);
    outputToTask.set(outputPathStr, taskName);

    taskNodes.set(taskName, {
      name: taskName,
      hash: taskHash,
      task,
      inputPaths: task.inputs,
      outputPath: task.output,
      unresolvedCount: 0,
    });
  }

  const taskDependents = new Map<string, Set<string>>();
  for (const taskName of taskNodes.keys()) {
    taskDependents.set(taskName, new Set());
  }

  for (const [taskName, node] of taskNodes) {
    for (const inputPath of node.inputPaths) {
      const inputPathStr = pathToString(inputPath);
      const producerTask = outputToTask.get(inputPathStr);

      if (producerTask) {
        taskDependents.get(producerTask)!.add(taskName);
        node.unresolvedCount++;
      } else {
        const { refType } = await workspaceGetDatasetHash(storage, repo, ws, inputPath);
        if (refType === 'unassigned') {
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
 * Delegates to `LocalOrchestrator` which implements reactive fixpoint
 * execution using step functions. After each task completes, input changes
 * are detected and affected tasks are invalidated and re-executed.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param options - Execution options
 * @returns Result of the dataflow execution
 *
 * @throws {WorkspaceLockError} If workspace is locked by another process
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 * @throws {TaskNotFoundError} If filter specifies a task that doesn't exist
 * @throws {DataflowError} If execution fails for other reasons
 */
export async function dataflowExecute(
  storage: StorageBackend,
  repo: string,
  ws: string,
  options: DataflowOptions = {}
): Promise<DataflowResult> {
  const { LocalOrchestrator } = await import('./dataflow/orchestrator/LocalOrchestrator.js');
  const orchestrator = new LocalOrchestrator();

  const taskResults: TaskExecutionResult[] = [];

  const handle = await orchestrator.start(storage, repo, ws, {
    concurrency: options.concurrency,
    force: options.force,
    filter: options.filter,
    signal: options.signal,
    lock: options.lock,
    runner: options.runner,
    onTaskStart: options.onTaskStart,
    onTaskComplete: (result) => {
      taskResults.push({
        name: result.name,
        cached: result.cached,
        state: result.state,
        error: result.error,
        exitCode: result.exitCode,
        duration: result.duration,
      });
      options.onTaskComplete?.({
        name: result.name,
        cached: result.cached,
        state: result.state,
        error: result.error,
        exitCode: result.exitCode,
        duration: result.duration,
      });
    },
    onStdout: options.onStdout,
    onStderr: options.onStderr,
    onInputChanged: options.onInputChanged,
    onTaskInvalidated: options.onTaskInvalidated,
    onTaskDeferred: options.onTaskDeferred,
  });

  const result = await orchestrator.wait(handle);

  return {
    success: result.success,
    runId: result.runId,
    executed: result.executed,
    cached: result.cached,
    failed: result.failed,
    skipped: result.skipped,
    reexecuted: result.reexecuted,
    tasks: taskResults,
    duration: result.duration,
  };
}

/**
 * Execute dataflow with an externally-held lock.
 * The lock is released automatically when execution completes or fails.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param options - Execution options (lock must be provided)
 * @returns Promise that resolves when execution completes
 */
export async function dataflowStart(
  storage: StorageBackend,
  repo: string,
  ws: string,
  options: DataflowOptions & { lock: LockHandle }
): Promise<DataflowResult> {
  try {
    return await dataflowExecute(storage, repo, ws, options);
  } finally {
    await options.lock.release();
  }
}

// =============================================================================
// Graph Queries (shared between local and cloud execution)
// =============================================================================

/**
 * Get the dependency graph for a workspace (for visualization/debugging).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @returns Graph information
 *
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 * @throws {DataflowError} If graph building fails for other reasons
 */
export async function dataflowGetGraph(
  storage: StorageBackend,
  repo: string,
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
  let taskNodes: Map<string, TaskNode>;
  let outputToTask: Map<string, string>;

  try {
    const graph = await buildDependencyGraph(storage, repo, ws);
    taskNodes = graph.taskNodes;
    outputToTask = graph.outputToTask;
  } catch (err) {
    if (err instanceof E3Error) throw err;
    throw new DataflowError(`Failed to build dependency graph: ${err instanceof Error ? err.message : err}`);
  }

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

// =============================================================================
// Graph Traversal Helpers (for distributed execution)
// =============================================================================

/**
 * Graph structure returned by dataflowGetGraph.
 */
export interface DataflowGraph {
  tasks: Array<{
    name: string;
    hash: string;
    inputs: string[];
    output: string;
    dependsOn: string[];
  }>;
}

/**
 * Find all tasks affected by input changes (transitive dependents).
 * An affected task is one whose output could change due to the input change.
 *
 * @param graph - The dependency graph
 * @param changes - Array of changed input paths
 * @returns Array of affected task names
 */
export function findAffectedTasks(
  graph: DataflowGraph,
  changes: Array<{ path: string }>,
): string[] {
  const changedPaths = new Set(changes.map(c => c.path));
  const affected = new Set<string>();
  const queue: string[] = [];

  // Build forward dep map: task name → tasks that depend on its output
  const taskToDependents = new Map<string, string[]>();
  for (const task of graph.tasks) {
    for (const dep of task.dependsOn) {
      if (!taskToDependents.has(dep)) taskToDependents.set(dep, []);
      taskToDependents.get(dep)!.push(task.name);
    }
  }

  // Seed: tasks that directly read a changed input
  for (const task of graph.tasks) {
    if (task.inputs.some(inp => changedPaths.has(inp))) {
      queue.push(task.name);
    }
  }

  // BFS through dependency graph
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (affected.has(name)) continue;
    affected.add(name);
    for (const dep of taskToDependents.get(name) ?? []) {
      queue.push(dep);
    }
  }

  return Array.from(affected);
}

/**
 * Get tasks that are ready to execute given the set of completed tasks.
 *
 * A task is ready when all tasks it depends on have completed.
 *
 * @param graph - The dependency graph from dataflowGetGraph
 * @param completedTasks - Set of task names that have completed
 * @returns Array of task names that are ready to execute
 */
export function dataflowGetReadyTasks(
  graph: DataflowGraph,
  completedTasks: Set<string>
): string[] {
  const ready: string[] = [];

  for (const task of graph.tasks) {
    if (completedTasks.has(task.name)) {
      continue;
    }

    const allDepsCompleted = task.dependsOn.every(dep => completedTasks.has(dep));
    if (allDepsCompleted) {
      ready.push(task.name);
    }
  }

  return ready;
}

/**
 * Check if a task execution is cached for the given inputs.
 *
 * @param storage - Storage backend
 * @param repo - Repository path
 * @param taskHash - Hash of the TaskObject
 * @param inputHashes - Array of input dataset hashes (in order)
 * @returns Output hash if cached, null if execution needed
 */
export async function dataflowCheckCache(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inputHashes: string[]
): Promise<string | null> {
  const inHash = inputsHash(inputHashes);
  return executionGetOutput(storage, repo, taskHash, inHash);
}

/**
 * Find tasks that should be skipped when a task fails.
 *
 * Returns all tasks that transitively depend on the failed task,
 * excluding already completed or already skipped tasks.
 *
 * @param graph - The dependency graph from dataflowGetGraph
 * @param failedTask - Name of the task that failed
 * @param completedTasks - Set of task names already completed
 * @param skippedTasks - Set of task names already skipped
 * @returns Array of task names that should be skipped
 */
export function dataflowGetDependentsToSkip(
  graph: DataflowGraph,
  failedTask: string,
  completedTasks: Set<string>,
  skippedTasks: Set<string>
): string[] {
  const dependents = new Map<string, string[]>();
  for (const task of graph.tasks) {
    dependents.set(task.name, []);
  }
  for (const task of graph.tasks) {
    for (const dep of task.dependsOn) {
      dependents.get(dep)?.push(task.name);
    }
  }

  const toSkip: string[] = [];
  const visited = new Set<string>();
  const queue = [failedTask];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = dependents.get(current) ?? [];

    for (const dep of deps) {
      if (visited.has(dep)) continue;
      visited.add(dep);

      if (completedTasks.has(dep)) continue;

      if (skippedTasks.has(dep)) {
        queue.push(dep);
        continue;
      }

      toSkip.push(dep);
      queue.push(dep);
    }
  }

  return toSkip;
}

/**
 * Resolve input hashes for a task from current workspace state.
 *
 * @param storage - Storage backend
 * @param repo - Repository path
 * @param ws - Workspace name
 * @param task - Task info from the graph
 * @returns Array of hashes (null if input is unassigned)
 */
export async function dataflowResolveInputHashes(
  storage: StorageBackend,
  repo: string,
  ws: string,
  task: DataflowGraph['tasks'][0]
): Promise<Array<string | null>> {
  const hashes: Array<string | null> = [];

  for (const inputPathStr of task.inputs) {
    const inputPath = parsePathString(inputPathStr);
    const { refType, hash } = await workspaceGetDatasetHash(storage, repo, ws, inputPath);

    if (refType === 'value' && hash !== null) {
      hashes.push(hash);
    } else {
      hashes.push(null);
    }
  }

  return hashes;
}
