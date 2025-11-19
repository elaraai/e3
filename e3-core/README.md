# @elaraai/e3-core

Programmatic API for E3 (East Execution Engine) repository operations.

## Overview

`e3-core` is the filesystem-based business logic layer for E3, similar to `libgit2` for git. It provides a clean programmatic API with no UI dependencies (no commander, no ink), making it suitable for:

- Building custom CLI tools
- Integration with other Node.js applications
- Testing and automation
- Alternative interfaces (web, desktop, etc.)

## Installation

```bash
npm install @elaraai/e3-core
```

## API

### Repository Management

```typescript
import {
  initRepository,
  findRepository,
  getRepository,
  isValidRepository,
  setTaskRef,
  deleteTaskRef,
  listTaskRefs,
} from '@elaraai/e3-core';

// Initialize a new repository
const result = initRepository('/path/to/project');
if (!result.success) {
  console.error(result.error);
}

// Find existing repository
const repoPath = findRepository();  // Searches cwd and parents

// Get repository or throw
const repoPath = getRepository();  // Throws if not found

// Manage task refs
await setTaskRef(repoPath, 'my-task', taskId);
await deleteTaskRef(repoPath, 'my-task');
const refs = await listTaskRefs(repoPath);
```

### Object Storage

```typescript
import {
  storeObject,
  loadObject,
  computeHash,
  computeTaskId,
} from '@elaraai/e3-core';

// Store data
const data = new TextEncoder().encode('hello world');
const hash = await storeObject(repoPath, data, '.txt');

// Load data
const loadedData = await loadObject(repoPath, hash, '.txt');

// Compute task ID from IR and args
const taskId = computeTaskId(irHash, [arg1Hash, arg2Hash]);
```

### Commits

```typescript
import {
  createNewTaskCommit,
  createTaskDoneCommit,
  createTaskErrorCommit,
  loadCommit,
} from '@elaraai/e3-core';

// Create commits
const commitHash = await createNewTaskCommit(
  repoPath,
  taskId,
  irHash,
  argsHashes,
  'node',
  null  // parent commit
);

const doneCommit = await createTaskDoneCommit(
  repoPath,
  parentHash,
  resultHash,
  'node',
  executionTimeUs
);

// Load commit
const commit = await loadCommit(repoPath, commitHash);
```

### Task State

```typescript
import {
  updateTaskState,
  getTaskState,
  listTasks,
} from '@elaraai/e3-core';

// Update task to point to latest commit
await updateTaskState(repoPath, taskId, commitHash);

// Get current commit for task
const currentCommit = await getTaskState(repoPath, taskId);

// List all tasks
const taskIds = await listTasks(repoPath);
```

### Resolution

```typescript
import {
  resolveToTaskId,
  resolveToCommit,
  resolveObjectHash,
} from '@elaraai/e3-core';

// Resolve ref or partial hash to task ID
const taskId = await resolveToTaskId(repoPath, 'my-task');
const taskId = await resolveToTaskId(repoPath, 'abc123');  // partial hash

// Resolve to latest commit
const commitHash = await resolveToCommit(repoPath, 'my-task');

// Resolve partial object hash
const fullHash = await resolveObjectHash(repoPath, 'ab12');
```

### Format Utilities

```typescript
import {
  loadIR,
  loadValue,
  irToBeast2,
  valueToBeast2,
  formatEast,
  parseEast,
} from '@elaraai/e3-core';

// Load IR from .east, .json, or .beast2 file
const ir = await loadIR('./function.east');

// Convert IR to Beast2
const beast2Data = irToBeast2(ir);

// Load/encode values
const value = await loadValue('./arg.east', IntegerType);
const encoded = valueToBeast2(value, IntegerType);
```

## Architecture

`e3-core` contains pure business logic with minimal dependencies:

- `@elaraai/east` - East IR and encoding/decoding
- `@elaraai/e3-types` - Shared type definitions
- Node.js built-ins (`fs`, `crypto`, `path`)

It does **not** depend on:
- `commander` (CLI framework)
- `ink` (terminal UI)
- Any UI/presentation libraries

This makes it suitable as a library for building tools on top of E3.

## License

UNLICENSED
