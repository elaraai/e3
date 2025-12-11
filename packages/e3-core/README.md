# @elaraai/e3-core

Core library for e3 repository operations, similar to libgit2 for git.

## Installation

```bash
npm install @elaraai/e3-core
```

## Overview

Pure business logic with no UI dependencies. Use this to build custom tools, integrations, or alternative interfaces on top of e3.

## API

### Repository

```typescript
import { initRepository, findRepository, getRepository } from '@elaraai/e3-core';

initRepository('/path/to/project');
const repoPath = findRepository();  // Searches cwd and parents
```

### Objects

```typescript
import { storeObject, loadObject, computeTaskId } from '@elaraai/e3-core';

const hash = await storeObject(repoPath, data, '.beast2');
const data = await loadObject(repoPath, hash, '.beast2');
const taskId = computeTaskId(irHash, argsHashes);
```

### Commits

```typescript
import { createNewTaskCommit, createTaskDoneCommit, loadCommit } from '@elaraai/e3-core';

const commitHash = await createNewTaskCommit(repoPath, taskId, irHash, argsHashes, 'node', null);
const commit = await loadCommit(repoPath, commitHash);
```

### Tasks

```typescript
import { updateTaskState, getTaskState, listTasks } from '@elaraai/e3-core';

await updateTaskState(repoPath, taskId, commitHash);
const commit = await getTaskState(repoPath, taskId);
const tasks = await listTasks(repoPath);
```

### Refs

```typescript
import { setTaskRef, deleteTaskRef, listTaskRefs, resolveToTaskId } from '@elaraai/e3-core';

await setTaskRef(repoPath, 'my-task', taskId);
const taskId = await resolveToTaskId(repoPath, 'my-task');
```

## Related Repos

- **[east](https://github.com/elaraai/east)** - East language core
- **[east-node](https://github.com/elaraai/east-node)** - Node.js runtime and platform functions
- **[east-py](https://github.com/elaraai/east-py)** - Python runtime and data science

## About Elara

e3 is developed by [Elara AI](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses. e3 powers the execution layer of Elara solutions, enabling durable and efficient execution of East programs across multiple runtimes.

## License

BSL 1.1. See [LICENSE.md](./LICENSE.md).
