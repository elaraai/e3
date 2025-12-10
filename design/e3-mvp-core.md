# e3-core: Core Operations

This document specifies the fundamental operations on an e3 repository. These operations form the API that the CLI and other interfaces use.

## Repository

### `repoInit(path: string): InitResult`

Create a new e3 repository at `path`.

Creates:
- `e3.east` (empty config)
- `objects/`
- `packages/`
- `executions/`
- `workspaces/`

### `repoFind(startPath?: string): string | null`

Find an e3 repository by searching from `startPath` (or cwd) upward. Also checks `E3_REPO` environment variable.

### `repoGet(startPath?: string): string`

Like `repoFind`, but throws if not found.

### `repoGc(repo: string, options?: GcOptions): Promise<GcResult>`

Remove unreferenced objects. Traces from roots (packages, workspaces, executions) and deletes unreachable objects.

Options:
- `minAge`: Minimum file age in ms before deletion (default: 60000). Prevents race with concurrent writes.
- `dryRun`: If true, report what would be deleted without deleting.

Returns count of deleted objects, deleted partials, retained objects, skipped young files, and bytes reclaimed.

## Objects

All objects are content-addressed by SHA256 hash. Objects are stored as `.beast2` files in `objects/<hash[0..2]>/<hash[2..]>.beast2`.

### `objectWrite(repo: string, data: Uint8Array): Promise<string>`

Write bytes to objects/, returns hash. Idempotent - same content always produces same hash. Writes are atomic (stage + rename).

### `objectWriteStream(repo: string, stream: ReadableStream<Uint8Array>): Promise<string>`

Stream variant of `objectWrite`. Computes hash while reading, then writes atomically.

### `objectRead(repo: string, hash: string): Promise<Uint8Array>`

Read raw bytes of an object. Throws if not found.

### `objectExists(repo: string, hash: string): Promise<boolean>`

Check if object exists.

### `objectPath(repo: string, hash: string): string`

Return filesystem path: `objects/<hash[0..2]>/<hash[2..]>.beast2`

### `computeHash(data: Uint8Array): string`

Compute SHA256 hash of data without storing. Utility function.

### `objectAbbrev(repo: string, hash: string, minLength?: number): Promise<number>`

Get the minimum unambiguous prefix length for a hash. Scans objects sharing the same 2-char prefix directory to find the shortest unique prefix. Default `minLength` is 4.

Useful for displaying short hashes to users while ensuring uniqueness within the repository.

## Packages

### `packageImport(repo: string, zipPath: string): Promise<PackageImportResult>`

Import a package from a `.zip` file. Extracts objects to `objects/`, creates ref at `packages/<name>/<version>`.

Returns `{ name, version, packageHash, objectCount }`.

### `packageExport(repo: string, name: string, version: string, zipPath: string): Promise<PackageExportResult>`

Export a package to a `.zip` file. Collects the package object and all transitively referenced objects.

Returns `{ packageHash, objectCount }`.

### `packageRemove(repo: string, name: string, version: string): Promise<void>`

Remove package ref. Objects remain until `repoGc`.

### `packageList(repo: string): Promise<Array<{ name: string, version: string }>>`

List installed packages as `{ name, version }` objects.

### `packageResolve(repo: string, name: string, version: string): Promise<string>`

Resolve `packages/<name>/<version>` to PackageObject hash.

### `packageRead(repo: string, name: string, version: string): Promise<PackageObject>`

Read and parse a PackageObject.

## Workspaces

Workspaces are mutable working copies of packages. State is stored in a single `.beast2` file for atomic consistency.

### Workspace State

State is stored in `workspaces/<name>.beast2`:

```ts
type WorkspaceState = {
  packageName: string;      // Name of deployed package
  packageVersion: string;   // Version of deployed package
  packageHash: string;      // Hash of package object at deploy time (immutable)
  deployedAt: Date;         // UTC datetime of deployment
  rootHash: string;         // Current root data tree hash
  rootUpdatedAt: Date;      // UTC datetime of last root update
};
```

Empty file = workspace exists but not yet deployed (no state file = workspace doesn't exist).

The `packageHash` stores the immutable hash of the package object at deploy time, not a ref-to-ref. This ensures workspace state is unaffected if package refs are modified.

**Future audit trail support:** When we implement full audit trail, this state will move to the object store (content-addressed) with a ref file pointing to current state hash. Additional fields:
- `previousStateHash: string | null` - null for initial deploy
- `message: string` - "deployed package X", "user Y wrote to dataset Z"

This gives a complete history of workspace changes, similar to git commits.

### `workspaceCreate(repo: string, name: string): Promise<void>`

Create an empty workspace. Creates an empty `workspaces/<name>.beast2` file (workspace exists but is not deployed).

### `workspaceRemove(repo: string, name: string): Promise<void>`

Remove a workspace. Objects remain until `repoGc`.

### `workspaceList(repo: string): Promise<Array<string>>`

List workspace names.

### `workspaceGetState(repo: string, ws: string): Promise<WorkspaceState | null>`

Get full workspace state, or null if not deployed.

### `workspaceDeploy(repo: string, ws: string, pkgName: string, pkgVersion: string): Promise<void>`

Deploy a package to a workspace. Creates workspace file if needed. Writes workspace state atomically with:
- Package info (name, version, hash)
- Root hash from package's `data.value`
- Timestamps for deployment and root update

### `workspaceExport(repo: string, ws: string, zipPath: string, name?: string, version?: string): Promise<WorkspaceExportResult>`

Export workspace as a package:
1. Read workspace state
2. Read deployed package structure using stored `packageHash`
3. Create new PackageObject with `data.value` set to current `rootHash`
4. Collect all referenced objects
5. Write to `.zip`

Default name: deployed package name. Default version: `<pkgVersion>-<rootHash[0..8]>`.

Returns `{ packageHash, objectCount, name, version }`.

### `workspaceGetPackage(repo: string, ws: string): Promise<{ name: string, version: string, hash: string }>`

Get deployed package info. Throws if workspace not deployed.

### `workspaceGetRoot(repo: string, ws: string): Promise<string>`

Get root data tree hash. Throws if workspace not deployed.

### `workspaceSetRoot(repo: string, ws: string, hash: string): Promise<void>`

Atomically update root data tree hash. Updates `rootUpdatedAt` timestamp. Throws if workspace not deployed.

## Tree Objects

Tree objects form persistent trees with structural sharing. See e3.md "Data Tree Objects" for the type definitions.

### `treeRead(repo: string, hash: string): Promise<TreeObject>`

Read and parse a tree object.

### `treeWriteStruct(repo: string, fields: Record<string, DataRef>): Promise<string>`

Write a struct tree (field name -> DataRef). Returns hash.

## Dataset Access

High-level operations on workspace data trees using TreePaths.

```ts
type TreePath = Array<PathComponent>;
type PathComponent = { field: string };  // .field "name"
```

### `datasetGet(repo: string, ws: string, path: TreePath): Promise<Uint8Array>`

Read a value at a specific path. Traverses the tree, returns blob bytes.

Example: `datasetGet(repo, "production", [{ field: "inputs" }, { field: "sales" }])`

### `datasetSet(repo: string, ws: string, path: TreePath, value: Uint8Array): Promise<void>`

Update a blob at a specific path. Creates new tree objects along the path (structural sharing), updates workspace root atomically.

### `datasetList(repo: string, ws: string, path: TreePath): Promise<Array<string>>`

List keys at a tree node (field names). The path should point to a struct tree.

### Atomic updates?

We need to consider whether a workspace-level write lock is required, or whether we have an API for "transactions" mutating multiple datasets at once.
(Read locks are not necessary given our git-like structure).

## Tasks

### `taskResolve(repo: string, pkgName: string, pkgVersion: string, taskName: string): Promise<string>`

Resolve a task to its TaskObject hash.

### `taskRead(repo: string, hash: string): Promise<TaskObject>`

Read and parse a TaskObject.

### `taskRun(repo: string, taskHash: string, inputs: Array<string>, outputPath: string): Promise<string>`

Execute a task:
1. Compute executionHash = hash(runner, ...inputHashes)
2. Check cache: `executions/<executionHash>/output`
3. If cached, return cached result hash
4. Marshal inputs to execution scratch dir
5. Construct and run task command, tee stdout/stderr to log files
6. Copy output from scratch dir to object store (if required), write output ref
7. Return result hash

## Task Execution

Tasks define computations with input/output dataset paths.

### `execStart(repo: string, ws: string, filter?: string): Promise<void>`

Execute tasks in a workspace:

1. Read package's tasks from PackageObject
2. Build dependency graph from input/output paths
3. Topologically sort tasks
4. For each task (respecting `filter` - support equality only in MVP):

**Task execution:**
 1. Resolve inputs from dataset paths
 2. Run task (cache key = hash(runner, ...inputHashes))
 3. Write output to dataset path

### `execWatch(repo: string, ws: string, filter?: string): Promise<void>`

Like `execStart`, but watches for input changes (via inotify) and re-runs affected tasks. Only re-executes tasks whose inputs have changed.
