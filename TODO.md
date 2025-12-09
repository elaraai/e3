# e3 MVP Implementation Plan

This document tracks the implementation of e3 according to the MVP design in `design/e3-mvp.md`.

The existing code is a prototype that will be replaced piece-by-piece, starting with e3-types and working downstream.

---

## Overview

### Package Dependencies

```
east  →  e3-types  →  e3  →  e3-core  →  e3-cli
                             ↓
                       yauzl/yazl (zip handling)
                             ↓
east-node-std  →  east-node-cli  →  integration-tests
```

(east, east-node-std and east-node-cli are external dependencies)

Note: e3-core depends on e3 (SDK) so that CLI/web UI can programmatically create packages using the SDK APIs.

### Implementation Order

1. **e3-types** - Define all East types for objects and refs
2. **e3** - TypeScript SDK for authoring packages
3. **e3-core** - Implement repository operations
4. **e3-cli** - Wire up CLI commands
5. **integration-tests** - End-to-end workflow tests, including task runners

---

## Phase 1: e3-types ✓

Define East types for all e3 objects. These types are used for beast2 serialization.

- [x] **DataRef** - Reference to data in the object store
- [x] **DataTreeType** - Persistent tree node type constructor
- [x] **TaskObject** - Computation definition
- [x] **PackageObject** - Bundle manifest
- [x] **Structure** - Defines tree structure (recursive)
- [x] **TreePath** - Location in data tree (East keypath syntax)
- [x] **TaskBinding** - Binds task to dataset paths
- [x] **CommandPart** - Runner command template
- [x] **Config** - Repository configuration (e3.east)

---

## Phase 2: e3 (SDK)

TypeScript SDK for authoring e3 packages. Users write package definitions in TypeScript and export to `.zip` bundles.

### Core API

- [x] **e3.input(name, type, default?)** - Define input dataset
  - Returns DatasetDef with name, path, type, optional default value
  - Used to declare leaf nodes in the data tree

- [x] **e3.task(name, inputs, fn)** - Define a task
  - Infers output type from function return
  - Compiles East function to IR at export time
  - Returns TaskDef with `.output` accessor for chaining
  - Collects dependencies automatically

- [x] **e3.package(name, version, ...items)** - Bundle into package
  - Collects all dependencies from items automatically
  - Builds data structure from inputs/outputs
  - Returns PackageDef with discoverable access to contents

- [ ] **e3.export(pkg, path)** - Export to .zip bundle
  - Compiles all tasks to IR
  - Serializes objects using beast2
  - Creates manifest.east
  - Writes to zip file using yazl

### Type Inference

- [ ] Infer output types from East function definitions
- [ ] Type-safe task chaining (output of one → input of another)
- [ ] Validation of input/output type compatibility

### Testing

- [ ] Unit tests for each API function
- [ ] Integration test: define package → export → verify contents
- [ ] Round-trip test: export → import into repo → verify structure

---

## Phase 3: e3-core

Implement repository operations per `design/e3-mvp-core.md`.

### Repository Module

- [ ] `initRepository(path)` - Create new repository
- [ ] `isValidRepository(path)` - Validate repository structure
- [ ] `loadConfig(repo)` / `saveConfig(repo, config)` - Config management

### Objects Module

- [ ] `objectWrite(repo, data)` - Store bytes, return hash
- [ ] `objectRead(repo, hash)` - Load bytes by hash
- [ ] `objectExists(repo, hash)` - Check existence
- [ ] `objectPath(repo, hash)` - Compute filesystem path

### Packages Module

- [ ] `packageImport(repo, zipPath)` - Import from .zip
- [ ] `packageExport(repo, name, version, zipPath)` - Export to .zip
- [ ] `packageList(repo)` - List installed packages
- [ ] `packageRemove(repo, name, version)` - Remove package ref
- [ ] `packageRead(repo, name, version)` - Load PackageObject

### Workspaces Module

- [ ] `workspaceCreate(repo, name)` - Create empty workspace
- [ ] `workspaceDeploy(repo, ws, pkgName, pkgVersion)` - Deploy package
- [ ] `workspaceExport(repo, ws, zipPath)` - Export as package
- [ ] `workspaceList(repo)` - List workspaces
- [ ] `workspaceRemove(repo, ws)` - Remove workspace

### Dataset Module

- [ ] `datasetGet(repo, ws, path)` - Read value at path
- [ ] `datasetSet(repo, ws, path, value)` - Write value at path
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
- [ ] `executionGetOutput(repo, inputHash)` - Get cached output

### Task Execution Module

- [ ] `taskStart(repo, ws, filter?)` - Run tasks in dependency order
- [ ] `taskStartWatch(repo, ws, filter?)` - Watch mode

### GC Module

- [ ] `gc(repo)` - Remove unreferenced objects

### Cleanup

- [ ] Remove old modules: commits.ts, tasks.ts (old), resolve.ts, formats.ts
- [ ] Update index.ts exports

---

## Phase 4: e3-cli

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
- [ ] `e3 start <repo> <ws>` - Run tasks
- [ ] `e3 start <repo> <ws> --watch` - Watch mode

### Utility Commands

- [ ] `e3 logs <repo> [task]` - View execution logs
- [ ] `e3 convert <path> --format <fmt>` - Format conversion

### Cleanup

- [ ] Remove old command implementations
- [ ] Update CLI entry point

---

## Phase 5: Integration Tests

End-to-end tests using the CLI.

### Core Workflows

- [ ] **Init and status** - Create repo, verify structure
- [ ] **Package lifecycle** - Import, list, export, remove
- [ ] **Workspace lifecycle** - Create, deploy, list, remove
- [ ] **Dataset operations** - Set, get, list
- [ ] **Runner configuration** - Configure and use our east-node runner
- [ ] **Task execution** - Run ad-hoc, verify output, verify caching
- [ ] **Task orchestration** - Start, verify dependency order, verify caching
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
