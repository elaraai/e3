# e3 MVP Implementation Plan

This document tracks the implementation of e3 according to the MVP design in `design/e3-mvp.md`.

The existing code is a prototype that will be replaced piece-by-piece, starting with e3-types and working downstream.

---

## Overview

### Package Dependencies

```
east  →  e3-types  →  e3-core  →  e3-cli
  ↓                                  ↓
east-node-std  →  east-node-cli  →  integration-tests
```

(east, east-node-std and east-node-cli are external dependencies)

### Implementation Order

1. **e3-types** - Define all East types for objects and refs
2. **e3-core** - Implement repository operations
3. **e3-cli** - Wire up CLI commands
4. **integration-tests** - End-to-end workflow tests, including task runners

---

## Phase 1: e3-types

Define East types for all e3 objects. These types are used for beast2 serialization.

### Object Types

- [ ] **DataRef** - Reference to data in the object store
  ```ts
  DataRefType = VariantType<{
    unassigned: NullType,  // Pending task output
    null: NullType,        // Inline null value
    value: StringType,     // Hash of beast2 blob
    tree: StringType,      // Hash of tree object
  }>
  ```

- [ ] **TreeObject** - Persistent tree node (struct only for MVP)
  ```ts
  // For a struct with fields {a, b, c}, the tree object is:
  // StructType<{ a: DataRefType, b: DataRefType, c: DataRefType }>
  ```

- [ ] **TaskObject** - Computation definition
  ```ts
  TaskObjectType = StructType<{
    runner: StringType,
    inputs: ArrayType<StructType<{
      type: EastTypeType,  // Serialized East type
      value: OptionType<StringType>,  // Fixed value hash
    }>>,
    output: EastTypeType,
  }>
  ```

- [ ] **PackageObject** - Bundle manifest
  ```ts
  PackageObjectType = StructType<{
    name: StringType,
    version: StringType,
    tasks: DictType<StringType, StringType>,  // name → hash
    datasets: StructType<{
      schema: DatasetSchemaType,
      value: StringType,  // Root tree hash
    }>,
    dataflows: ArrayType<DataflowDefType>,
  }>
  ```

### Schema Types

- [ ] **DatasetSchema** - Defines tree structure
  ```ts
  DatasetSchemaType = VariantType<{
    obj: EastTypeType,   // Leaf (blob)
    tree: TreeSchemaType, // Branch
  }>

  TreeSchemaType = VariantType<{
    struct: DictType<StringType, DatasetSchemaType>,
  }>
  ```

- [ ] **TreePath** - Location in dataset tree
  ```ts
  PathComponentType = VariantType<{
    field: StringType,
  }>

  TreePathType = ArrayType<PathComponentType>
  ```

- [ ] **DataflowDef** - Task orchestration rule
  ```ts
  DataflowDefType = VariantType<{
    task: StructType<{
      task: StringType,
      inputs: ArrayType<TreePathType>,
      output: TreePathType,
    }>,
  }>
  ```

### Config Types

- [ ] **CommandPart** - Runner command template
  ```ts
  CommandPartType = VariantType<{
    literal: StringType,
    input_path: NullType,
    inputs: ArrayType<...>,
    output_path: NullType,
  }>
  ```

- [ ] **Config** - Repository configuration (e3.east)
  ```ts
  ConfigType = StructType<{
    runners: DictType<StringType, ArrayType<CommandPartType>>,
  }>
  ```

### Cleanup

- [ ] Remove old commit types (NewTaskCommit, TaskDoneCommit, etc.)

---

## Phase 2: e3-core

Implement repository operations per `design/e3-mvp-core.md`.

### Repository Module

- [ ] `initRepository(path)` - Create new repository
  - Creates: e3.east, objects/, packages/, executions/, workspaces/
  - Tests: directory structure, config file, idempotency

- [ ] `isValidRepository(path)` - Validate repository structure
  - Tests: valid repo, missing dirs, missing config

- [ ] `loadConfig(repo)` / `saveConfig(repo, config)` - Config management
  - Tests: load default, save custom runners

### Objects Module

- [ ] `objectWrite(repo, data)` - Store bytes, return hash
  - Atomic write (temp → rename)
  - Tests: round-trip, idempotency, concurrent writes

- [ ] `objectRead(repo, hash)` - Load bytes by hash
  - Tests: exists, not found error

- [ ] `objectExists(repo, hash)` - Check existence
  - Tests: exists true/false

- [ ] `objectPath(repo, hash)` - Compute filesystem path
  - Path: `objects/<hash[0..2]>/<hash[2..]>`

### Packages Module

- [ ] `packageImport(repo, zipPath)` - Import from .zip
  - Extract objects, create ref at packages/<name>/<version>
  - Tests: import, deduplication, invalid zip

- [ ] `packageExport(repo, name, version, zipPath)` - Export to .zip
  - Collect package + referenced objects
  - Tests: export, re-import matches

- [ ] `packageList(repo)` - List installed packages
  - Returns: Array<{name, version}>

- [ ] `packageRemove(repo, name, version)` - Remove package ref
  - Objects remain until GC

- [ ] `packageRead(repo, name, version)` - Load PackageObject

### Workspaces Module

- [ ] `workspaceCreate(repo, name)` - Create empty workspace
  - Creates: workspaces/<name>/

- [ ] `workspaceDeploy(repo, ws, pkgName, pkgVersion)` - Deploy package
  - Writes package ref, copies initial dataset tree
  - Tests: deploy, redeploy replaces

- [ ] `workspaceExport(repo, ws, zipPath)` - Export as package
  - Snapshots current data state

- [ ] `workspaceList(repo)` - List workspaces

- [ ] `workspaceRemove(repo, ws)` - Remove workspace

### Dataset Module

- [ ] `datasetGet(repo, ws, path)` - Read value at path
  - Traverses tree, returns blob bytes
  - Tests: read leaf, read through tree

- [ ] `datasetSet(repo, ws, path, value)` - Write value at path
  - Creates new tree objects (structural sharing)
  - Tests: set leaf, atomic root update

- [ ] `datasetList(repo, ws, path)` - List keys at tree node

### Tree Module (internal)

- [ ] `treeRead(repo, hash)` - Load tree object
- [ ] `treeWriteStruct(repo, fields)` - Write struct tree
- [ ] `treePath(tree, path)` - Navigate to path in tree

### Tasks Module

- [ ] `taskResolve(repo, pkgName, pkgVersion, taskName)` - Get TaskObject hash
- [ ] `taskRead(repo, hash)` - Load TaskObject

### Execution Module

- [ ] `executionRun(repo, taskHash, inputs, outputPath)` - Execute task
  - Compute input hash, check cache
  - Marshal inputs to scratch dir
  - Exec runner command
  - Store output, write ref
  - Tests: execution, caching, stdout/stderr capture

- [ ] `executionGetOutput(repo, inputHash)` - Get cached output

### Dataflow Module

- [ ] `dataflowStart(repo, ws, filter?)` - Run dataflows
  - Build dependency graph
  - Topological sort
  - Execute in order (respecting cache)
  - Tests: sequential execution, caching, partial runs

- [ ] `dataflowStartWatch(repo, ws, filter?)` - Watch mode
  - inotify on workspace root
  - Re-run affected dataflows

### GC Module

- [ ] `gc(repo)` - Remove unreferenced objects
  - Trace from roots (packages, workspaces, executions)
  - Delete unreachable objects
  - Tests: gc removes orphans, preserves referenced

### Cleanup

- [ ] Remove old modules: commits.ts, tasks.ts (old), resolve.ts, formats.ts
- [ ] Update index.ts exports

---

## Phase 3: e3-cli

Wire up CLI commands per `design/e3-mvp-cli.md`.

### Repository Commands

- [ ] `e3 init <repo>` - Initialize repository
- [ ] `e3 status <repo>` - Show packages, workspaces
- [ ] `e3 gc <repo>` - Garbage collect

### Package Commands

- [ ] `e3 package import <repo> <zip>` - Import package
- [ ] `e3 package export <repo> <pkg>[@<ver>] <zip>` - Export package
- [ ] `e3 package list <repo>` - List packages
- [ ] `e3 package remove <repo> <pkg>[@<ver>]` - Remove package

### Workspace Commands

- [ ] `e3 workspace create <repo> <name>` - Create workspace
- [ ] `e3 workspace deploy <repo> <ws> <pkg>[@<ver>]` - Deploy package
- [ ] `e3 workspace export <repo> <ws> <zip>` - Export workspace
- [ ] `e3 workspace list <repo>` - List workspaces
- [ ] `e3 workspace remove <repo> <ws>` - Remove workspace

### Dataset Commands

- [ ] `e3 dataset get <repo> <ws> <path>` - Print value
- [ ] `e3 dataset set <repo> <ws> <path> <file>` - Set from file
- [ ] `e3 dataset list <repo> <ws>` - List datasets

### Execution Commands

- [ ] `e3 run <repo> <task> <inputs...> -o <out>` - Ad-hoc run
- [ ] `e3 start <repo> <ws>` - Run dataflows
- [ ] `e3 start <repo> <ws> --watch` - Watch mode

### Utility Commands

- [ ] `e3 logs <repo> [task]` - View execution logs
- [ ] `e3 convert <path> --format <fmt>` - Format conversion

### Cleanup

- [ ] Remove old command implementations
- [ ] Update CLI entry point

---

## Phase 4: Integration Tests

End-to-end tests using the CLI.

### Core Workflows

- [ ] **Init and status** - Create repo, verify structure
- [ ] **Package lifecycle** - Import, list, export, remove
- [ ] **Workspace lifecycle** - Create, deploy, list, remove
- [ ] **Dataset operations** - Set, get, list
- [ ] **Runner configuration** - Configure and use our east-node runner
- [ ] **Task execution** - Run, verify output, verify caching
- [ ] **Dataflow execution** - Start, verify order, verify caching
- [ ] **Workspace export/import** - Round-trip with data

### Edge Cases

- [ ] **Concurrent operations** - Multiple runs same task
- [ ] **Error handling** - Invalid paths, missing packages
- [ ] **Large files** - Streaming behavior

---

## Testing Guidelines

Per STANDARDS.md:

- Use real filesystem operations (no mocking fs)
- Create temp directories per test, clean up in afterEach
- Test categories: happy path, edge cases, errors, atomicity, round-trip
- Co-locate tests: `src/objects.ts` → `src/objects.spec.ts`

---

## Notes

- The MVP design excludes: package dependencies, array/dict trees, variant trees, registry integration and upcoming East modules (backend code linking)
- Runner integration depends on east-node CLI being available
- Config format uses East syntax (e3.east), parsed with @elaraai/east
