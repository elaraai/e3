# TaskRunner Implementation

## Problem

e3-core defines a `TaskRunner` interface but has no implementations:

```typescript
// e3-core/src/execution/interfaces.ts (exists but unused)
export interface TaskRunner {
  execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult>;
}
```

Meanwhile, task execution logic exists in two places:

1. **`taskExecute()` in e3-core** - Full implementation that spawns processes, captures output, writes logs, and caches results. Used by `dataflowExecute()` for local execution.

2. **`execute-task.ts` in e3-aws** - Reimplements similar logic for Lambda execution with direct S3/DynamoDB access.

This creates problems:

1. **Interface without implementation** - The `TaskRunner` interface exists but nothing implements it, making it dead code.

2. **Duplicated logic** - e3-aws reimplements task execution instead of reusing e3-core's `taskExecute()`.

3. **Untestable orchestration** - `dataflowExecute()` directly calls `taskExecute()` instead of using an injected `TaskRunner`, making it impossible to test dataflow logic without actually running tasks.

4. **Tight coupling** - The dataflow executor is coupled to local process execution. Cannot swap in a mock runner for testing or a remote runner for distributed execution.

## Solution

Implement `LocalTaskRunner` that wraps the existing `taskExecute()` function, then refactor `dataflowExecute()` to accept a `TaskRunner` parameter.

```typescript
// e3-core/src/execution/LocalTaskRunner.ts

export class LocalTaskRunner implements TaskRunner {
  constructor(private repo: string) {}

  async execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    // Delegate to existing taskExecute()
    return taskExecute(storage, this.repo, taskHash, inputHashes, {
      force: options?.force,
      signal: options?.signal,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });
  }
}
```

Update dataflow execution to use dependency injection:

```typescript
// Before: tightly coupled
export async function dataflowExecute(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  options?: DataflowOptions
): Promise<DataflowResult> {
  // ... directly calls taskExecute()
  const result = await taskExecute(storage, repo, node.hash, inputHashes, execOptions);
}

// After: injectable runner
export async function dataflowExecute(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  options?: DataflowOptions & { runner?: TaskRunner }
): Promise<DataflowResult> {
  const runner = options?.runner ?? new LocalTaskRunner(repo);
  // ... uses runner.execute()
  const result = await runner.execute(storage, node.hash, inputHashes, execOptions);
}
```

## Benefits

1. **Testable dataflow logic** - Inject a mock `TaskRunner` that returns canned results to test orchestration without spawning processes.

2. **Single source of truth** - `taskExecute()` remains the canonical implementation. `LocalTaskRunner` is just a thin wrapper.

3. **Extensibility** - Future runners (Lambda, Fargate, Kubernetes) implement the same interface.

4. **Cleaner separation** - Dataflow orchestration is decoupled from task execution mechanics.

## Implementation Plan

### Phase 1: Implement LocalTaskRunner (e3-core)

1. Create `e3-core/src/execution/LocalTaskRunner.ts`
2. Implement `TaskRunner` interface by delegating to `taskExecute()`
3. Export from `e3-core/src/execution/index.ts` and `e3-core/src/index.ts`
4. Add unit tests

### Phase 2: Create MockTaskRunner for Testing (e3-core)

1. Create `e3-core/src/execution/MockTaskRunner.ts`
2. Configurable responses: success with hash, failure with exit code, error
3. Records calls for assertions (task hash, input hashes, options)
4. Used by dataflow tests to verify orchestration logic

### Phase 3: Refactor dataflowExecute() (e3-core)

1. Add optional `runner` parameter to `DataflowOptions`
2. Default to `new LocalTaskRunner(repo)` if not provided
3. Replace direct `taskExecute()` calls with `runner.execute()`
4. Existing tests continue to pass (default behavior unchanged)

### Phase 4: Add Dataflow Orchestration Tests (e3-core)

1. Test with `MockTaskRunner` to verify:
   - Tasks execute in correct dependency order
   - Cached tasks are skipped (when runner returns cached: true)
   - Failed tasks cause dependents to be skipped
   - Concurrent execution respects concurrency limit
   - Cancellation stops pending tasks
2. These tests are fast (no process spawning) and deterministic

### Phase 5: e3-aws Alignment (future)

Once the interface is proven in e3-core:
1. Refactor `execute-task.ts` to use e3-core's `taskExecute()` via storage interfaces
2. Or document why Lambda execution needs a separate path (if there's a legitimate reason)

## Testing Strategy

```
MockTaskRunner (canned responses)
    ↓ tests dataflow orchestration logic
LocalTaskRunner (wraps taskExecute)
    ↓ tests real task execution
Integration tests
    ↓ tests end-to-end with filesystem
```

The key insight: dataflow orchestration (dependency resolution, parallelism, failure handling) is complex logic that deserves dedicated tests. By injecting `TaskRunner`, we can test this logic in isolation from the mechanics of spawning processes and managing I/O.

## Interface Reference

```typescript
// Already defined in e3-core/src/execution/interfaces.ts

export interface TaskExecuteOptions {
  force?: boolean;
  signal?: AbortSignal;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface TaskResult {
  state: 'success' | 'failed' | 'error';
  cached: boolean;
  outputHash?: string;
  exitCode?: number;
  error?: string;
}

export interface TaskRunner {
  execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult>;
}
```

No interface changes needed - just implementations.
