# Execution History Design

This document extends the [Task Execution Design](./e3-execution.md) to support execution history, provenance tracking, and distributed operation.

## Motivation

The current execution model has limitations for production distributed systems:

1. **No history**: Re-running a task overwrites the previous execution
2. **No provenance**: Workspaces don't track which execution produced their outputs
3. **Import conflicts**: Importing executions from another repo overwrites local state
4. **No audit trail**: Can't answer "what ran when" or "why did this fail last Tuesday"

For e3-cloud with paying clients running continuous workloads (hourly logistics, daily rostering), we need:

- Full execution history for debugging and auditing
- Clear provenance from outputs to the execution that produced them
- Safe import/export without data loss
- Fault-tolerant distributed semantics

## Key Changes

| Aspect | Current | Proposed |
|--------|---------|----------|
| Execution identity | `(taskHash, inputsHash)` | `(taskHash, inputsHash, executionId)` |
| Execution ID format | N/A (implicit) | UUIDv7 |
| History | Overwritten | Preserved (append-only) |
| Cache lookup | Single entry | Latest by executionId |
| Workspace tracking | Just `rootHash` | `rootHash` + `currentRunId` |
| Dataflow runs | Not tracked | Full history with `runId` |

## Execution Identity

### UUIDv7 for Execution IDs

Execution IDs use [UUIDv7](https://www.rfc-editor.org/rfc/rfc9562.html) (RFC 9562):

- **Timestamp-sortable**: First 48 bits are millisecond Unix timestamp
- **Globally unique**: No coordination required across machines/repos
- **Lexicographically ordered**: `max(id)` = latest (natural DynamoDB SK ordering)

```
Example: 018f3b4c-9a2d-7def-8abc-123456789012
         ^^^^^^^^
         timestamp (ms since epoch)
```

Benefits:
- Generate IDs on any machine without coordination
- Import executions keep their original IDs
- "Latest" = lexicographically greatest ID
- Human-readable timestamps extractable for display

### Storage Schema

```
executions/
└── <taskHash>/
    └── <inputsHash>/
        └── <executionId>/           # NEW: executionId subdirectory
            ├── status.beast2
            ├── output                # Hash of output dataset (on success)
            ├── stdout.txt
            └── stderr.txt
```

DynamoDB equivalent:
```
PK: EXECUTION/{repo}/{taskHash}/{inputsHash}
SK: {executionId}
```

### Updated ExecutionStatus

```typescript
const ExecutionStatusType = VariantType({
  running: StructType({
    executionId: StringType,        // NEW: UUIDv7
    inputHashes: ArrayType(StringType),
    startedAt: DateTimeType,
    pid: IntegerType,
    pidStartTime: IntegerType,
    bootId: StringType,
  }),
  success: StructType({
    executionId: StringType,        // NEW: UUIDv7
    inputHashes: ArrayType(StringType),
    outputHash: StringType,
    startedAt: DateTimeType,
    completedAt: DateTimeType,
  }),
  failed: StructType({
    executionId: StringType,        // NEW: UUIDv7
    inputHashes: ArrayType(StringType),
    exitCode: IntegerType,
    startedAt: DateTimeType,
    completedAt: DateTimeType,
  }),
  error: StructType({
    executionId: StringType,        // NEW: UUIDv7
    inputHashes: ArrayType(StringType),
    message: StringType,
    startedAt: DateTimeType,
    completedAt: DateTimeType,
  }),
});
```

### Import Provenance

Imported executions include source tracking:

```typescript
const ExecutionMetadata = StructType({
  executionId: StringType,          // Original UUIDv7 (preserved on import)
  importedFrom: OptionalType(StructType({
    sourceRepo: StringType,         // Where this was imported from
    importedAt: DateTimeType,
  })),
});
```

## Cache Lookup

### Latest Execution

"Cache hit" means finding the latest successful execution for `(taskHash, inputsHash)`:

```typescript
async function getLatestExecution(
  repo: string,
  taskHash: string,
  inputsHash: string
): Promise<ExecutionStatus | null> {
  // List all executionIds for this (taskHash, inputsHash)
  // Return the one with lexicographically greatest executionId
  // (which is also chronologically latest due to UUIDv7)
}

async function getLatestSuccessfulOutput(
  repo: string,
  taskHash: string,
  inputsHash: string
): Promise<string | null> {
  // Iterate from latest executionId backwards
  // Return first success.outputHash found
  // Returns null if no successful execution exists
}
```

### Cache Policy

| Execution Status | Cache Behavior |
|------------------|----------------|
| `success` | Cache hit - return outputHash |
| `failed` | Cache miss - re-run (failures are not cached) |
| `error` | Cache miss - re-run |
| `running` | Wait or skip (existing behavior) |

This means:
- Successful executions are trusted (same inputs = same output)
- Failed executions don't block re-runs
- Force re-run always appends a new execution

## Dataflow Run History

### DataflowRun Type

```typescript
const DataflowRunType = StructType({
  runId: StringType,                // UUIDv7
  workspaceName: StringType,
  packageRef: StringType,           // package@version at run time

  // Timing
  startedAt: DateTimeType,
  completedAt: OptionalType(DateTimeType),

  // Status
  status: VariantType({
    running: NullType,
    completed: NullType,
    failed: StructType({
      failedTask: StringType,
      error: StringType,
    }),
    cancelled: NullType,
  }),

  // Snapshots for reproducibility
  inputSnapshot: StringType,        // rootHash at start (inputs only)
  outputSnapshot: OptionalType(StringType),  // rootHash at end (full tree)

  // Task execution mapping
  taskExecutions: MapType(StringType, StructType({
    executionId: StringType,        // Which execution was used
    cached: BooleanType,            // Was this a cache hit?
  })),

  // Summary stats
  summary: StructType({
    total: IntegerType,
    completed: IntegerType,
    cached: IntegerType,
    failed: IntegerType,
    skipped: IntegerType,
  }),
});

type DataflowRun = ValueTypeOf<typeof DataflowRunType>;
```

### Storage Schema

```
dataflows/
└── <workspace>/
    └── <runId>.beast2              # DataflowRun record
```

DynamoDB equivalent:
```
PK: DATAFLOW/{repo}/{workspace}
SK: {runId}
```

### Dataflow APIs

```typescript
// Start a new dataflow run
async function dataflowStart(
  repo: string,
  ws: string,
  options?: DataflowOptions
): Promise<DataflowRun>;

// Low-level storage methods (via storage.refs):
interface RefStore {
  dataflowRunGet(repo: string, workspace: string, runId: string): Promise<DataflowRun | null>;
  dataflowRunWrite(repo: string, workspace: string, run: DataflowRun): Promise<void>;
  dataflowRunList(repo: string, workspace: string): Promise<string[]>;
  dataflowRunGetLatest(repo: string, workspace: string): Promise<DataflowRun | null>;
  dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void>;
}
```

### Run Cleanup

Dataflow runs are mutable records with a lifecycle - they are cleaned up, not garbage collected like immutable objects.

**Cleanup on start:** When a new dataflow run starts (while holding the workspace lock), all previous runs are deleted. This ensures at most one run exists per workspace at any time.

```typescript
// In dataflowExecuteWithLock(), after building dependency graph:
const allRunIds = await storage.refs.dataflowRunList(repo, ws);
for (const oldRunId of allRunIds) {
  await storage.refs.dataflowRunDelete(repo, ws, oldRunId);
}
```

**Rationale:**
- We hold the workspace lock at start, guaranteeing no concurrent runs
- Previous run might be stale (crashed process left "running" status)
- Simpler than tracking run completion states or implementing TTL

## Updated Workspace State

```typescript
const WorkspaceStateType = StructType({
  // Existing fields
  packageName: StringType,
  packageVersion: StringType,
  packageHash: StringType,
  deployedAt: DateTimeType,
  rootHash: StringType,
  rootUpdatedAt: DateTimeType,

  // NEW: Reference to current dataflow run
  currentRunId: OptionalType(StringType),  // runId of latest completed run
});
```

The `taskExecutions` mapping lives in the `DataflowRun`, not workspace state. This keeps workspace state simple while allowing full history via the run record.

## Export/Import Semantics

### What Gets Exported

When exporting a workspace, we include only the executions from the current dataflow run - not the entire execution cache:

1. **Package data** (existing): objects, tasks, IR, data tree
2. **Current dataflow run** (new): the `DataflowRun` for `currentRunId`
3. **Task executions** (new): only the executions referenced by `currentRunId`
4. **Logs** (new): stdout/stderr for those specific executions

This keeps exports focused and bounded - you get the executions that produced the current workspace state, not historical runs or executions from other workspaces.

```
export.zip
├── objects/...                     # Content-addressed objects
├── packages/<name>/<version>       # Package ref
├── dataflows/<workspace>/<runId>.beast2  # Dataflow run record
└── executions/
    └── <taskHash>/
        └── <inputsHash>/
            └── <executionId>/
                ├── status.beast2
                ├── output
                ├── stdout.txt
                └── stderr.txt
```

### Import Behavior

When importing:

1. **Objects**: Added to object store (content-addressed, no conflicts)
2. **Package**: Registered with name@version
3. **Dataflow run**: Preserved with original runId
4. **Executions**: Appended with original executionId, marked with `importedFrom`

```typescript
// Import marks executions with provenance
execution.importedFrom = {
  sourceRepo: "user@remote-machine:/path/to/repo",
  importedAt: new Date(),
};
```

### No Conflicts

Because executionIds are globally unique UUIDv7s:
- Import never overwrites local executions
- Local executions never overwrite imports
- Both coexist, "latest" is determined by timestamp in UUIDv7

## Garbage Collection

### Object GC

The GC traces reachable objects from three root sources:

1. **Package refs**: `packages/<name>/<version>` → package hash → tree/task objects
2. **Execution outputs**: `executions/<taskHash>/<inputsHash>/*/output` → output dataset hashes
3. **Workspace state**: `workspaces/<name>.beast2` → packageHash, rootHash

All execution outputs are retained, regardless of whether they're referenced by the current dataflow run. This is intentional - executions are the cache, and keeping them allows cache hits across runs.

```typescript
async function collectRoots(repoPath: string): Promise<Set<string>> {
  const roots = new Set<string>();

  // Package objects
  await collectRefsFromDir(packagesDir, roots, 2);

  // All execution outputs (the cache)
  await collectRefsFromDir(executionsDir, roots, 3);

  // Workspace package and root hashes
  await collectWorkspaceRoots(workspacesDir, roots);

  return roots;
}
```

### Dataflow Run Cleanup

Dataflow run files (`dataflows/<workspace>/<runId>.beast2`) are **not** garbage collected - they're cleaned up directly at the start of each new run (see "Run Cleanup" above). This is because:

- Runs are mutable records with a lifecycle, not immutable objects
- At most one run exists per workspace at any time
- The run file itself doesn't contain object hashes (just executionIds as strings)

## Migration

No migration needed. Existing execution caches can be deleted - all tasks can be re-run from package definitions. The new schema is used for all new executions.

## API Summary

### Execution APIs (Updated)

```typescript
// Generate new execution ID
function newExecutionId(): string;  // Returns UUIDv7

// Get specific execution
function executionGet(repo, taskHash, inputsHash, executionId): Promise<ExecutionStatus | null>;

// Get latest execution (for cache lookup)
function executionGetLatest(repo, taskHash, inputsHash): Promise<ExecutionStatus | null>;

// Get latest successful output (cache hit)
function executionGetLatestOutput(repo, taskHash, inputsHash): Promise<string | null>;

// List all executions for (taskHash, inputsHash)
function executionList(repo, taskHash, inputsHash): Promise<ExecutionStatus[]>;

// Read logs for specific execution
function executionReadLog(repo, taskHash, inputsHash, executionId, stream): Promise<LogChunk>;
```

### Dataflow APIs (New)

```typescript
// High-level execution
function dataflowExecute(storage, repo, ws, options?): Promise<DataflowResult>;
function dataflowStart(storage, repo, ws, options): Promise<DataflowResult>;

// Low-level storage (via storage.refs)
interface RefStore {
  dataflowRunGet(repo, ws, runId): Promise<DataflowRun | null>;
  dataflowRunWrite(repo, ws, run): Promise<void>;
  dataflowRunList(repo, ws): Promise<string[]>;
  dataflowRunGetLatest(repo, ws): Promise<DataflowRun | null>;
  dataflowRunDelete(repo, ws, runId): Promise<void>;
}

// Workspace state includes currentRunId
function workspaceGetState(storage, repo, ws): Promise<WorkspaceState>;
```

### Export/Import (Updated)

```typescript
// Export includes executions for current run
function workspaceExport(repo, ws, zipPath, options?): Promise<ExportResult>;

// Import preserves execution provenance
function packageImport(repo, zipPath): Promise<ImportResult>;
```

## Example Session

```bash
# Run dataflow
$ e3 start . prod
Run 018f3b4c-9a2d-7def started
  [cached] preprocess
  [start]  train
  [done]   train (12.3s)
  [cached] evaluate
Run 018f3b4c-9a2d-7def completed (2 cached, 1 executed)

# View current run (only one run exists per workspace - old runs are cleaned up)
$ e3 run . prod
Run 018f3b4c-9a2d-7def-8abc-123456789012
  Status:    completed
  Started:   2024-01-15 10:30:42
  Completed: 2024-01-15 10:31:15

  Tasks:
    preprocess  cached   12ms
    train       success  12.3s
    evaluate    cached   8ms

# View logs from the current run's execution
$ e3 logs . prod.train
[execution 018f3b4c-task-train-7890]
Loading model...
Training epoch 1/10...
...

# Export workspace with executions
$ e3 workspace export . prod prod-backup.zip
Exported workspace prod
  Package: forecast-model@1.0.0
  Run: 018f3b4c-9a2d-7def
  Executions: 3
  Total size: 45.2 MB

# Import on another machine
$ e3 package import . prod-backup.zip
Imported forecast-model@1.0.0
  Executions: 3 (marked as imported from user@machine-a)
```

## Import Collision Handling

If an imported execution has the same `executionId` as an existing local execution:

- **Success importing over failure**: Overwrite (failure recovery)
- **Failure importing over success**: Skip (don't regress)
- **Same status**: Skip (already have it)

This allows re-importing a fixed execution to recover from failures while protecting successful local results.

## Crash Handling

When a running execution is detected as crashed (stale heartbeat, dead process):

1. **Record as `error` status** with diagnostic message
2. **Do NOT silently delete** - preserves audit trail
3. **Cache lookup will skip it** (error = cache miss)
4. **User can investigate** via logs

This approach prioritizes observability over convenience. The error record provides:
- Timestamp of when the crash was detected
- The input hashes that were being processed
- A clear indication that something went wrong
- Access to any partial logs that were captured

Example error status:
```typescript
{
  type: 'error',
  value: {
    executionId: '018f3b4c-9a2d-7def-8abc-123456789012',
    inputHashes: ['abc123...', 'def456...'],
    message: 'Process 12345 no longer running (stale execution)',
    startedAt: new Date('2024-01-15T10:30:42Z'),
    completedAt: new Date('2024-01-15T11:00:00Z'),  // When crash detected
  }
}
```

Re-running the task will create a new execution with a new executionId, leaving the crashed execution's record and logs available for debugging.
