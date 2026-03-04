# Reactive Dataflow with Per-Dataset Refs

## Motivation

Currently, workspace state is a single `WorkspaceState` object stored in
`workspaces/<name>.beast2`, containing one `rootHash` that points to a
content-addressed tree of tree objects. Updating any dataset requires **path
copying** from leaf to root (structural sharing), then atomically swapping the
`rootHash`. An `AsyncMutex` serializes these read-modify-write cycles within a
single dataflow run, and an `flock`-based exclusive lock prevents concurrent
operations across processes.

The `rootHash` is a single mutable pointer that every dataset write must
contend on, even when writing to completely unrelated datasets. This prevents:

- Concurrent modification of input datasets while a dataflow is executing
- Reactive re-execution: when an input changes during `e3 start`, downstream
  tasks should backtrack and re-run automatically
- Efficient change detection for future watch mode

## Design Overview

### Core Idea

Replace the single `rootHash` with **per-dataset ref files**. Each leaf dataset
in the workspace gets its own atomically-updatable ref file containing a value
hash and a **version vector** tracking provenance.

The version vector enables a reactive dataflow model: when an input changes
during `e3 start`, downstream tasks are invalidated and re-executed. Tasks only
execute when their inputs have **consistent** version vectors (all inputs agree
on shared upstream input versions). Execution reaches fixpoint when no more
tasks are dirty.

Note: there is no prohibition on datasets being temporarily inconsistent with
each other. We only enforce:

1. The dataflow **fixpoint** is a consistent state (all version vectors agree)
2. When reading 2+ datasets, the version vectors allow you to **determine** if
   they are consistent with each other

### Prior Art

This design draws on several systems:

- **ZFS**: Decouples logical writes (fine-grained per-block locks) from Merkle
  tree rebuilding (batched during sync phase). Our per-dataset refs are the
  fine-grained logical writes; tree snapshots are the batched materialization.

- **Clojure persistent data structures**: Immutable trees with CAS on root ref.
  We go further by eliminating root contention entirely -- each dataset is an
  independent CAS target.

- **ELARACore `full_versions`**: Each derived stream version carries a
  `Record<string, bigint>` mapping upstream source identifiers to version
  numbers. Tasks skip execution when inputs have inconsistent upstream versions.
  We adapt this using content hashes as versions.

- **Timely/Differential Dataflow**: Version lattice tracking input frontiers.
  Tasks only process data when all inputs have advanced past a consistent
  timestamp. Our version vector consistency check serves the same purpose.

## Locking Model

### Current: Single Exclusive Lock

Currently, one `flock`-based lock per workspace (`workspaces/<name>.lock`)
serializes all operations: dataflow, deployment, removal, and dataset writes.
This prevents `e3 set` from running during `e3 start`.

### Proposed: Structure Lock (shared/exclusive) + Dataflow Lock (exclusive)

Two independent locks per workspace, with the structure lock supporting
shared (reader) and exclusive (writer) modes:

- **Structure lock** (`<name>.lock`): guards workspace structure (the set of
  datasets and their types). Operations that only read/use the structure take a
  **shared** lock. Operations that change the structure take an **exclusive**
  lock.

- **Dataflow lock** (`<name>.dataflow.lock`): prevents concurrent dataflow runs.
  Only acquired by `start`.

Lock acquisition by operation:

| Operation   | Structure lock | Dataflow lock |
|-------------|---------------|---------------|
| `e3 set`    | shared        | --            |
| `e3 start`  | shared        | exclusive     |
| `e3 deploy` | exclusive     | --            |
| `e3 remove` | exclusive     | --            |

### Concurrency Matrix

| Concurrent?     | `set` | `start` | `deploy` | `remove` |
|-----------------|-------|---------|----------|----------|
| **`set`**       | YES   | YES     | no       | no       |
| **`start`**     | YES   | no      | no       | no       |
| **`deploy`**    | no    | no      | no       | no       |
| **`remove`**    | no    | no      | no       | no       |

Key properties:

- **`set` + `start` run concurrently**: both hold shared structure locks.
  Multiple `set` calls also run concurrently with each other. Per-dataset ref
  writes are atomic (tmp+rename), so no file-level contention.

- **`set` + `set` run concurrently**: shared structure lock allows multiple
  holders. Per-dataset atomic writes mean concurrent writes to different
  datasets don't interfere. Concurrent writes to the same dataset: last writer
  wins (POSIX rename semantics).

- **`deploy` and `remove` block everything**: exclusive structure lock waits
  for all shared holders (`set`, `start`) to release before proceeding. No need
  for the dataflow lock -- the exclusive structure lock already prevents `start`
  from acquiring a shared lock.

### Implementation: `flock` Shared/Exclusive

Linux `flock` natively supports this:

- `flock --shared --nonblock <lockfile>` -- shared (reader) lock. Multiple
  processes can hold simultaneously.
- `flock --nonblock <lockfile>` -- exclusive (writer) lock. Blocks until all
  shared locks are released.

The existing `LocalLockService` uses `flock --nonblock <lockfile> cat` with
`LOCK_EX`. For shared locks, use `flock --shared --nonblock <lockfile> cat`.
Same subprocess pattern -- the lock is held while the child process lives.

### Dataflow Writing Task Outputs

The dataflow process holds a shared structure lock and the exclusive dataflow
lock. Task output writes go directly to per-dataset ref files (atomic
tmp+rename). This is safe because:

1. `deploy`/`remove` need the exclusive structure lock, which can't be acquired
   while the dataflow holds a shared lock -- no concurrent structural changes
2. `e3 set` also holds a shared structure lock -- concurrent `set` during
   dataflow is fine since they write to different ref files (`set` writes to
   writable inputs, dataflow writes to task outputs)
3. Per-file tmp+rename is POSIX-atomic -- reads see either the old or new
   value, never a torn write

### Deploy/Remove During Active Dataflow

Deploy and remove take an exclusive structure lock. If a dataflow (or any `set`)
holds a shared lock, the exclusive request blocks (or fails with `--nonblock`).

For v1, deploy/remove fail with a clear error if the structure lock is held.
Forcible acquire -- signaling shared lock holders to release -- is a future
enhancement.

### Lock File Layout

```
workspaces/
  <name>.lock                 # structure lock (shared: set/start, exclusive: deploy/remove)
  <name>.dataflow.lock        # dataflow lock (exclusive: start only)
```

Both use `flock` + beast2 `LockState`. The `LockOperationType` identifies
which operation holds the lock.

### Cloud Mapping

DynamoDB can implement both locks:
- Structure lock: atomic counter for reader count + exclusive flag.
  Shared = increment counter (conditional on no exclusive). Exclusive = set
  flag (conditional on counter=0).
- Dataflow lock: simple conditional write (same as current exclusive lock).

## Repository Layout

### Current

```
<repo>/
  objects/AB/CDEF...beast2
  packages/<name>/<version>           # text: package object hash
  workspaces/<name>.beast2            # beast2: WorkspaceState (includes rootHash)
  workspaces/<name>.lock              # flock + beast2: LockState
  executions/<taskHash>/<inputsHash>/<executionId>/...
  dataflows/<workspace>/<runId>.beast2
```

### Proposed

```
<repo>/
  objects/AB/CDEF...beast2            # UNCHANGED
  packages/<name>/<version>           # UNCHANGED
  workspaces/
    <name>/
      state.beast2                    # WorkspaceState (metadata only, no rootHash)
      data/                           # per-dataset ref files
        inputs/
          sales.ref                   # beast2: DatasetRef
          config.ref
        tasks/
          etl/
            function_ir.ref           # set at deploy time (not writable)
            output.ref                # written by task execution
          report/
            function_ir.ref
            output.ref
    <name>.lock                       # structure lock (shared/exclusive)
    <name>.dataflow.lock              # NEW: dataflow lock (exclusive, start only)
  executions/...                      # UNCHANGED
  dataflows/...                       # UNCHANGED
```

The directory nesting under `data/` mirrors the `Structure` tree: each `struct`
node becomes a directory, each `value` node becomes a `.ref` file. This gives:

- **Per-file atomic writes** via write-tmp + rename -- no cross-dataset
  contention
- **Directory-level inotify** -- `fs.watch` on `data/inputs/` detects input
  changes
- **Natural cloud mapping** -- DynamoDB `PK=ws, SK=inputs/sales` or
  S3 `s3://bucket/ws/data/inputs/sales.ref`

## Version Vectors

### Definition

A version vector maps root input dataset paths to their content hashes:

```
VersionVector = Map<path, hash>
```

Only **root input** datasets (those not written by any task) appear as keys.
These are the "clocks" in the system -- the independent sources of change.

### Construction Rules

**Input dataset** (user-writable, no upstream task):

```
.inputs.sales -> {
  hash: "a1b2c3",
  versions: { ".inputs.sales": "a1b2c3" }
}
```

The version vector is trivially `{ self: self_hash }`.

**Derived dataset** (task output): The output's version vector is the **union**
of all input version vectors (verified consistent first):

```
task_etl reads .inputs.sales and .inputs.config

.tasks.etl.output -> {
  hash: "d4e5f6",
  versions: { ".inputs.sales": "a1b2c3", ".inputs.config": "x7y8z9" }
}
```

**Second-level derived**: Version vectors propagate transitively:

```
task_report reads .tasks.etl.output and .inputs.template

.tasks.report.output -> {
  hash: "g1h2i3",
  versions: { ".inputs.sales": "a1b2c3", ".inputs.config": "x7y8z9", ".inputs.template": "q4r5s6" }
}
```

Every derived dataset knows exactly which root input versions produced it.

### Consistency Check

Before executing a task, collect version vectors from all inputs and verify
agreement on shared upstream paths:

```
task_C reads .derived.A and .derived.B

.derived.A.versions = { ".inputs.X": "h2" }
.derived.B.versions = { ".inputs.X": "h1" }    <-- still reflects old X

Shared key ".inputs.X": "h2" != "h1"  -->  INCONSISTENT, defer task_C
```

Later, after the upstream task re-executes and updates `.derived.B`:

```
.derived.B.versions = { ".inputs.X": "h2" }

Shared key ".inputs.X": "h2" == "h2"  -->  CONSISTENT, execute task_C
```

This prevents diamond dependency inconsistencies without explicit coordination.

### Content Hashes as Versions

Unlike ELARACore (which uses monotonic `bigint` version counters), e3 uses
content hashes as version identifiers. This is cleaner because:

- No separate version counter infrastructure needed
- Identical content at two points in time has the same "version" (natural
  deduplication)
- The execution cache already uses `inputsHash(contentHashes)` as cache key

If e3 ever supports impure tasks (external data sources, timestamps, randomness),
the task identity would need to be added to the version vector as a source, as
ELARACore does with its `t:<uuid>` entries. For now, tasks are pure functions of
their inputs, so root input paths are sufficient.

## Reactive Execution Within `e3 start`

### Semantics

`e3 start` executes the dataflow to fixpoint and terminates. If an input dataset
is modified concurrently (e.g., by `e3 set`), downstream tasks are invalidated
and re-executed. The command exits when all tasks are consistent with current
inputs.

No persistent watch mode is in scope for this work.

### Execution Loop

1. Acquire shared **structure lock** + exclusive **dataflow lock**
2. Build dependency graph from package
3. Snapshot initial version vectors from all input dataset refs
4. Execute ready tasks (parallel, respecting concurrency limit)
5. On task completion:
   a. Write output to dataset ref (with merged version vector)
   b. Check if any input datasets have changed since last snapshot
   c. If changed: emit `input_changed` event, invalidate downstream tasks,
      re-queue them
   d. If unchanged: notify dependents as normal
6. Before executing a task: check version vector consistency across inputs
   - Consistent: proceed with execution (check cache first)
   - Inconsistent: defer (emit `task_deferred` event, re-check after upstream
     converges)
7. Repeat until fixpoint: no dirty tasks, no deferred tasks, no in-progress tasks
8. Compute tree snapshot from refs (for DataflowRun record)
9. Release dataflow lock + structure lock

### Input Change Detection

For the initial implementation, use **check-after-completion**: after each task
completes (and before processing dependents), re-read all root input dataset
refs and compare to the last known hashes. If any differ, emit an
`input_changed` event and propagate invalidation.

This is simple and correct. `inotify`/`fs.watch` can be layered on later for
lower latency (and is the natural path to watch mode).

### Invalidation Propagation

When an input dataset changes:

1. Find all tasks that read this dataset (directly or transitively via the
   dependency graph)
2. For tasks that have already completed in this run: mark as dirty, clear
   their output version vectors, re-queue for execution
3. For tasks currently in progress: let them finish, but their output will be
   stale (the version vector check will catch this on the next iteration)
4. For tasks not yet started: they'll pick up the new input naturally

The version vector consistency check prevents tasks from executing with a mix
of old and new upstream data. Tasks are only deferred, never given inconsistent
inputs.

## Step Function Architecture

The reactive dataflow logic is implemented as **composable step functions** in
`e3-core/src/dataflow/steps.ts`. These are the single codepath for both local
and cloud orchestration — `LocalOrchestrator` calls them in-process, and a
future cloud orchestrator (e.g., AWS Step Functions) would call the same
functions.

### Step Functions

**Lifecycle steps** (existing):

| Function | Purpose |
|----------|---------|
| `stepInitialize` | Build graph, initialize task states, snapshot input VVs |
| `stepGetReady` | Return tasks with all dependencies met (skips `deferred`) |
| `stepPrepareTask` | Resolve input hashes for a task |
| `stepTaskStarted` | Mark task as in-progress, emit event |
| `stepTaskCompleted` | Mark complete, merge input VVs to output, find newly ready |
| `stepTaskFailed` | Mark failed, emit event |
| `stepTasksSkipped` | Mark downstream tasks as skipped due to upstream failure |
| `stepIsComplete` | Check if execution has reached fixpoint |
| `stepFinalize` | Compute final result (executed, cached, failed, skipped, reexecuted) |
| `stepCancel` | Transition to cancelled state |

**Reactive steps** (new):

| Function | Purpose |
|----------|---------|
| `stepDetectInputChanges` | Re-read root input refs, compare to snapshot, emit events |
| `stepInvalidateTasks` | Reset completed/deferred tasks to pending for re-execution |
| `stepCheckVersionConsistency` | Verify a task's inputs have consistent VVs |
| `stepApplyTreeUpdate` | Write output dataset ref with merged version vector |

### Orchestrator Loop (Pseudocode)

```
state = stepInitialize(storage, repo, ws, options)

while true:
  ready = stepGetReady(state)

  if ready is empty and no tasks in_progress:
    break  // fixpoint reached (or consistency deadlock if deferred remain)

  for each task in ready (up to concurrency limit):
    vvCheck = stepCheckVersionConsistency(state, task)
    if not vvCheck.consistent:
      mark task as 'deferred'
      continue

    prepared = stepPrepareTask(storage, state, task)
    stepTaskStarted(state, task)
    launch task with runner

  wait for any task to complete

  if task succeeded:
    stepApplyTreeUpdate(storage, repo, ws, outputPath, outputHash, mergedVV)
    stepTaskCompleted(state, task, outputHash, cached, duration)
    changes = stepDetectInputChanges(storage, state)
    if changes found:
      stepInvalidateTasks(state, changes)

  if task failed:
    stepTaskFailed(state, task, error, exitCode, duration)
    stepTasksSkipped(state, dependentsToSkip)

result = stepFinalize(state)
```

### State Tracking

`DataflowExecutionState` carries all reactive tracking:

- **`versionVectors`**: `Map<string, Map<string, string>>` — dataset keypath
  → version vector (root input path → hash). Updated when tasks complete
  (merged from inputs) and when root inputs change.
- **`inputSnapshot`**: `Map<string, string>` — root input keypath → hash at
  last check. Used by `stepDetectInputChanges` to detect concurrent writes.
- **`taskOutputPaths`**: `string[]` — set of dataset keypaths that are task
  outputs (not root inputs). Used to distinguish root inputs from derived data.
- **`reexecuted`**: `bigint` — count of tasks re-executed due to input changes.

### Task Status Values

Tasks can be in one of: `pending`, `ready`, `in_progress`, `completed`,
`failed`, `skipped`, or `deferred`.

The `deferred` status is used when a task's inputs have inconsistent version
vectors (diamond dependency). Deferred tasks are reset to `pending` when
upstream tasks are invalidated and re-executed.

### Key Design Decisions

- **`findAffectedTasks`** is a shared utility (BFS graph traversal), not a step
  function. It's used by `stepInvalidateTasks` to find transitively affected
  tasks when an input changes.
- **`AsyncMutex` removed** from `LocalOrchestrator`. Per-dataset ref writes are
  atomic and independent, so concurrent writes to different ref files are safe.
- **Version vectors are mandatory**. `workspaceSetDatasetByHash` requires a
  `VersionVector` parameter — there is no optional/defaulting behavior.

## Type Changes (e3-types)

### Modified: StructureType

The `value` variant gains a `writable` flag indicating whether the dataset can
be written to directly by users (via `e3 set` or the API). Non-writable datasets
are set at deploy time (e.g., `function_ir`) and can only be updated by
redeployment.

```typescript
// structure.ts

export const StructureType = RecursiveType(self => VariantType({
  value: StructType({
    type: EastTypeType,
    /** Whether users can write to this dataset directly */
    writable: BooleanType,
  }),
  struct: DictType(StringType, self),
}));
```

The `writable` flag does **not** affect version vectors -- all datasets
(writable or not) participate in version vectors. The flag controls write
authorization only.

### New: DatasetRefType and VersionVectorType

```typescript
// New file: dataset-ref.ts (or added to dataset.ts)

import {
  VariantType, StructType, DictType, StringType, NullType, ValueTypeOf,
} from '@elaraai/east';

/**
 * Version vector tracking which root input versions produced a value.
 *
 * Keys are root input dataset paths (e.g., ".inputs.sales").
 * Values are content hashes of those inputs at the time of derivation.
 */
export const VersionVectorType = DictType(StringType, StringType);
export type VersionVector = ValueTypeOf<typeof VersionVectorType>;

/**
 * Per-dataset reference in a workspace.
 *
 * Stored at: workspaces/<ws>/data/<path-as-dirs>.ref
 *
 * Unlike DataRef (used in tree objects), DatasetRef does not have a 'tree'
 * variant -- workspace dataset refs always point to leaf values.
 */
export const DatasetRefType = VariantType({
  /** Not yet computed (e.g., task output before first execution) */
  unassigned: NullType,
  /** Null value with provenance tracking */
  null: StructType({ versions: VersionVectorType }),
  /** Value hash with provenance tracking */
  value: StructType({ hash: StringType, versions: VersionVectorType }),
});
export type DatasetRef = ValueTypeOf<typeof DatasetRefType>;
```

### Modified: WorkspaceStateType

```typescript
// workspace.ts

export const WorkspaceStateType = StructType({
  packageName: StringType,
  packageVersion: StringType,
  packageHash: StringType,
  deployedAt: DateTimeType,
  // rootHash: REMOVED - now derived from per-dataset refs on demand
  // rootUpdatedAt: REMOVED - each ref tracks its own update
  currentRunId: OptionType(StringType),
});
```

### Unchanged: LockOperationType

```typescript
// lock.ts -- no changes needed

export const LockOperationType = VariantType({
  dataflow: NullType,
  deployment: NullType,
  removal: NullType,
  dataset_write: NullType,
});
```

All four operations remain. `dataflow` is used when acquiring the dataflow
lock. `dataset_write` is used when acquiring the shared structure lock for
`e3 set`. `deployment` and `removal` are used when acquiring the exclusive
structure lock.

### New: Event Types

Added to `ExecutionEventType`:

```typescript
/** An input dataset was modified during execution */
input_changed: StructType({
  seq: IntegerType,
  timestamp: DateTimeType,
  /** Dataset path that changed (keypath string) */
  path: StringType,
  /** Previous hash (none if was unassigned) */
  previousHash: OptionType(StringType),
  /** New hash */
  newHash: StringType,
}),

/** A task was invalidated and will be re-executed */
task_invalidated: StructType({
  seq: IntegerType,
  timestamp: DateTimeType,
  /** Task name */
  task: StringType,
  /** The input path change that triggered invalidation */
  trigger: StringType,
}),

/** Task deferred due to inconsistent input versions */
task_deferred: StructType({
  seq: IntegerType,
  timestamp: DateTimeType,
  /** Task name */
  task: StringType,
  /** Upstream path with conflicting versions across inputs */
  conflictPath: StringType,
}),
```

### Modified: DataflowRunType

```typescript
export const DataflowRunType = StructType({
  runId: StringType,
  workspaceName: StringType,
  packageRef: StringType,
  startedAt: DateTimeType,
  completedAt: OptionType(DateTimeType),
  status: DataflowRunStatusType,

  // NEW: version vector snapshots for reactive provenance
  /** Version vector (root inputs -> hashes) at start of run */
  inputVersions: VersionVectorType,
  /** Version vector at end of run (none if still running) */
  outputVersions: OptionType(VersionVectorType),

  // KEPT: root hash snapshots for export/import compatibility
  // Computed from refs at snapshot time
  inputSnapshot: StringType,
  outputSnapshot: OptionType(StringType),

  taskExecutions: DictType(StringType, TaskExecutionRecordType),
  summary: DataflowRunSummaryType,
});
```

### Modified: DataflowRunSummaryType

```typescript
export const DataflowRunSummaryType = StructType({
  total: IntegerType,
  completed: IntegerType,
  cached: IntegerType,
  failed: IntegerType,
  skipped: IntegerType,
  /** NEW: number of task re-executions due to input changes */
  reexecuted: IntegerType,
});
```

### Modified: TaskExecutionRecordType

```typescript
export const TaskExecutionRecordType = StructType({
  executionId: StringType,
  cached: BooleanType,
  /** NEW: version vector of the output produced */
  outputVersions: VersionVectorType,
  /** NEW: times this task executed in this run (>1 = re-executed) */
  executionCount: IntegerType,
});
```

## Storage Interface Changes

### New: DatasetRefStore

```typescript
// storage/interfaces.ts

export interface DatasetRefStore {
  /**
   * Read a dataset ref.
   * @returns DatasetRef, or null if ref file doesn't exist
   */
  read(repo: string, ws: string, path: TreePath): Promise<DatasetRef | null>;

  /**
   * Write a dataset ref atomically (write tmp + rename).
   * Creates parent directories as needed.
   */
  write(repo: string, ws: string, path: TreePath, ref: DatasetRef): Promise<void>;

  /**
   * List all dataset refs in a workspace.
   * Walks the data/ directory tree recursively.
   */
  list(repo: string, ws: string): Promise<Array<{ path: TreePath; ref: DatasetRef }>>;

  /**
   * Remove a single dataset ref.
   */
  remove(repo: string, ws: string, path: TreePath): Promise<void>;

  /**
   * Remove all dataset refs for a workspace.
   * Used during workspace removal and redeployment.
   */
  removeAll(repo: string, ws: string): Promise<void>;
}
```

### Modified: StorageBackend

```typescript
export interface StorageBackend {
  readonly objects: ObjectStore;
  readonly refs: RefStore;
  readonly locks: LockService;
  readonly logs: LogStore;
  readonly repos: RepoStore;
  readonly datasets: DatasetRefStore;   // NEW
  validateRepository(repo: string): Promise<void>;
}
```

## Package Format

Packages (`.zip` objects in the object store) mirror the repository layout.
With per-dataset refs, packages no longer need root tree objects. Instead:

### Current package layout (in zip)

```
objects/AB/CDEF...beast2     # tree objects + value objects
package.beast2               # PackageObject (structure, data.value = root hash)
```

The `data.value` field in `PackageObject` holds a root tree hash. Export builds
tree objects bottom-up from the leaf values.

### Proposed package layout (in zip)

```
objects/AB/CDEF...beast2     # value objects only (no tree objects)
data/                        # per-dataset ref files mirroring workspace layout
  inputs/
    sales.ref                # beast2: DatasetRef (hash + version vector)
    config.ref
  tasks/
    etl/
      function_ir.ref
      output.ref
package.beast2               # PackageObject (structure, no root hash)
```

Packages directly contain the dataset ref files. Deploying a package to a
workspace means copying the `data/` directory into `workspaces/<name>/data/`.
Snapshotting a workspace to a package means copying the ref files out.

This removes tree object creation from both the SDK export path and the
workspace snapshot path. Tree objects are only built on demand (e.g., for GC
or compatibility).

### PackageDataType change

```typescript
// Current:
export const PackageDataType = StructType({
  structure: StructureType,
  value: StringType,           // root tree hash
});

// Proposed:
export const PackageDataType = StructType({
  structure: StructureType,
  // No root hash -- data is stored as per-dataset refs in the package zip
});
```

## Execution Cache Compatibility

The execution cache is keyed by `(taskHash, inputsHash)` where:

```
inputsHash = SHA256(inputHashes.join('\0'))
```

Each `inputHash` is the content hash of the value object for that input dataset.
This scheme is **fully compatible** with per-dataset refs because:

1. Content hashes are the same whether retrieved from tree traversal (current)
   or from a ref file (proposed)
2. `inputsHash` does not depend on `rootHash` or tree objects
3. The only change is how `workspaceGetDatasetHash` is implemented (read ref
   file instead of tree traversal)

No changes needed to `inputsHash()`, `executionGetOutput()`, or the cache
lookup in `LocalTaskRunner`. The cache naturally deduplicates: if an input
changes and then changes back, the original `inputsHash` hits the cache.

## Changes by Package

### e3-types

- Modified `StructureType` (add `writable` flag to `value` variant)
- New `DatasetRefType`, `VersionVectorType` types
- Modified `WorkspaceStateType` (remove `rootHash`, `rootUpdatedAt`)
- Modified `PackageDataType` (remove root hash `value` field)
- Unchanged `LockOperationType` (all four variants kept, used across both lock files)
- New event variants in `ExecutionEventType`
- Modified `DataflowRunType` (add `inputVersions`, `outputVersions`)
- Modified `DataflowRunSummaryType` (add `reexecuted`)
- Modified `TaskExecutionRecordType` (add `outputVersions`, `executionCount`)

### e3-core

- **New**: `DatasetRefStore` interface in `storage/interfaces.ts`
- **New**: `LocalDatasetRefStore` implementation (filesystem ref files)
- **New**: `InMemoryDatasetRefStore` for tests
- **New**: `computeRootHash(storage, repo, ws)` -- builds tree snapshot from
  refs on demand (for export, DataflowRun snapshots, GC)
- **New**: `checkVersionConsistency(inputVersionVectors)` -- version vector
  merge/consistency check
- **Rewrite**: `workspaceSetDataset` / `workspaceSetDatasetByHash` -- update
  single ref file, no tree path-copy
- **Rewrite**: `workspaceGetDatasetHash` -- read single ref file, no tree
  traversal
- **Rewrite**: `workspaceDeploy` -- copy per-dataset ref files from package
  `data/` directory into `workspaces/<name>/data/`
- **Rewrite**: `workspaceExport` -- copy per-dataset ref files into package
  `data/` directory (no tree object construction needed)
- **Rewrite**: `workspaceGetTree` / `workspaceListTree` -- read from refs +
  structure instead of tree objects
- **Rewrite**: `dataflowExecute` -- delegates to `LocalOrchestrator` (single
  codepath). `dataflowExecuteWithLock` deleted.
- **Rewrite**: `dataflow/steps.ts` -- reactive step functions
  (`stepDetectInputChanges`, `stepInvalidateTasks`,
  `stepCheckVersionConsistency`, `stepApplyTreeUpdate`). Version vectors
  initialized in `stepInitialize`, merged in `stepTaskCompleted`, checked
  before task launch.
- **Modify**: GC root scanning -- scan dataset ref files for live object hashes
  (each `.ref` file with a `value` variant holds a hash that must be kept)
- **Modify**: `LocalLockService` -- support shared/exclusive modes via
  `flock --shared`. New dataflow lock file (`<ws>.dataflow.lock`)
- **Modify**: `workspaceSetDataset` -- acquires shared structure lock,
  enforces `writable` flag
- **Modify**: `workspaceDeploy` / `workspaceRemove` -- acquire exclusive
  structure lock (blocks while any shared holder exists)
- **Remove**: `AsyncMutex` in `LocalOrchestrator` (no longer needed --
  per-dataset ref writes are atomic and independent)
- **Remove**: `dataflowExecuteWithLock` (~600 lines) -- replaced by step
  function architecture called through `LocalOrchestrator`
- **Remove**: tree path-copy rebuild logic from `workspaceSetDatasetUnlocked`

### e3 (SDK)

- **Rewrite**: `export.ts` -- emit per-dataset ref files in `data/` directory
  instead of building tree objects. Walk the Structure, write one `.ref` file
  per leaf dataset.
- **Modify**: `input.ts` / `types.ts` -- `DatasetDef` gains a `writable`
  property. `input()` creates datasets with `writable: true`. Task outputs
  and `function_ir` are `writable: false`.

### e3-cli

- `e3 set` acquires **shared structure lock** -- concurrent with other `set`
  and `start`, blocked during deploy/remove
- `e3 set` enforces `writable` flag -- rejects writes to non-writable datasets
- `e3 start` acquires **shared structure lock** + **exclusive dataflow lock**
- `e3 deploy` / `e3 workspace remove` acquire **exclusive structure lock** --
  for v1, fail if structure lock is held by `set` or `start`
- `e3 start` output includes new event types (`input_changed`,
  `task_invalidated`, `task_deferred`)
- `e3 status` can show per-dataset dirty/current status via version vectors

### e3-api-server / e3-api-client

- Dataset write endpoints acquire shared structure lock -- concurrent with
  each other and with active dataflow
- Dataset write enforces `writable` flag
- Deploy/remove endpoints acquire exclusive structure lock
- Potentially new endpoint for version vector / consistency status query

## Open Design Decisions

### 1. Ref file encoding ~~beast2 or JSON?~~

**DECIDED**: beast2 with EastType. Consistent with all other ref/object data in
e3. Debug tooling (`e3 get --raw`) can decode.

### 2. Input change detection mechanism

Three options:

- **Poll after task completion**: re-read all root input refs after each task
  completes. Simple, correct, but only detects changes at task boundaries.
- **inotify/fs.watch**: event-driven detection on `data/inputs/`. Lower
  latency, but adds platform-specific complexity.
- **Hybrid**: poll for initial implementation, add inotify later.

**Leaning**: poll after task completion for v1. This is the minimum viable
implementation. inotify is the path to watch mode (out of scope).

### 3. Root hash computation for snapshots

`computeRootHash` reads all dataset refs, rebuilds tree objects, and returns a
root hash. Called at dataflow start/end for DataflowRun records and during
export.

**Question**: Should this also write the intermediate tree objects to the object
store? Yes -- they're needed for export/import and GC already handles them.

### 4. Migration of existing repositories

Existing repos have `workspaces/<name>.beast2` with `rootHash`. Options:

- **Auto-migration on first access**: detect old format (single file vs
  directory), convert by walking the tree and writing ref files
- **Explicit migration command**: `e3 repo migrate`
- **Repo format version**: add version field to repo metadata, reject old format
  with helpful error

**TBD**: decision deferred. Will revisit whether migration is needed.

### 5. Version vectors for immutable datasets

**DECIDED**: `function_ir` datasets are included in version vectors as normal
writable inputs. No special "immutable dataset" system. The `writable` flag
on each dataset in the Structure type controls which datasets users can write
to directly, but all datasets (including `function_ir`) participate in version
vectors.

### 6. Failure during re-execution

If a task completed successfully, then an input changes, and re-execution
fails: the old output is stale and the new execution failed.

**Decision**: treat as failure. The DataflowRun records the latest state. The
stale output ref is overwritten with `unassigned` or left as-is with an
outdated version vector (which marks it dirty). Either way, `e3 start` exits
with failure status.

### 7. Wasted work from concurrent `e3 set`

A task reads inputs, starts executing, then `e3 set` changes an input. The task
runs to completion with stale data. The version vector on the output won't match
the new input, so the task will be re-queued on the next iteration.

**Decision**: accept the wasted work for v1. The check-after-completion approach
catches this one iteration later. Aborting in-flight tasks on input change is a
future optimization (requires inotify + AbortSignal plumbing).

### 8. Concurrent dataflow runs

**DECIDED**: mutual exclusion via the dedicated dataflow lock. One `e3 start` at
a time per workspace. The shared structure lock allows concurrent `e3 set`
during a running dataflow, while the exclusive dataflow lock prevents
concurrent `e3 start` runs.

### 9. Forcible lock acquisition for deploy/remove

`deploy` and `remove` need an exclusive structure lock. If `set` or `start`
holds a shared lock, the exclusive request blocks/fails. Options for future
enhancement:

- **Signal abort**: write a sentinel file that shared lock holders check,
  causing them to release gracefully
- **Forcible takeover**: kill the lock-holding processes (using PIDs from lock
  state) and take the exclusive lock
- **Timeout with wait**: `flock --timeout <seconds>` to wait for shared locks
  to drain naturally

**Deferred**: for v1, deploy/remove fail with a clear error if the structure
lock is held. Users must wait for `set`/`start` to finish first.
