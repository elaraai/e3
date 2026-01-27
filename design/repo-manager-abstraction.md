# RepoManager Abstraction

## Problem

The e3-api-server manages repositories using ad-hoc filesystem operations scattered throughout the codebase:

```typescript
// Current: direct filesystem calls in handlers
const repos = await fs.readdir(reposDir);
await fs.mkdir(repoPath, { recursive: true });
await fs.rm(repoPath, { recursive: true });
const stats = await fs.stat(repoPath);
```

This creates several issues:

1. **No abstraction boundary** - Repository lifecycle operations (list, create, delete, check existence) are implemented inline wherever needed, not through a defined interface.

2. **Untestable** - Cannot unit test API handlers without filesystem access. Tests require creating real directories, slowing down test execution and complicating CI.

3. **Non-portable** - Cloud deployments need different implementations (DynamoDB, CosmosDB) but there's no interface to implement against.

4. **Inconsistent error handling** - Each callsite handles filesystem errors differently. No standard `RepoNotFoundError` or `RepoAlreadyExistsError`.

5. **Missing metadata** - No standard way to track repo status (active, deleting, gc-in-progress) or creation timestamps.

## Solution

Define a `RepoManager` interface in e3-core that abstracts repository lifecycle operations:

```typescript
// e3-core/src/storage/interfaces.ts

export type RepoStatus = 'creating' | 'active' | 'gc' | 'deleting';

export interface RepoMetadata {
  name: string;
  status: RepoStatus;
  createdAt: string;
  statusChangedAt: string;
}

export interface RepoManager {
  /** List all repository names */
  list(): Promise<string[]>;

  /** Check if a repository exists */
  exists(repo: string): Promise<boolean>;

  /** Create a new repository */
  create(repo: string): Promise<void>;

  /** Delete a repository and all its data */
  delete(repo: string): Promise<void>;

  /** Get repository metadata */
  getMetadata(repo: string): Promise<RepoMetadata | null>;

  /** Update repository status */
  setStatus(repo: string, status: RepoStatus): Promise<void>;
}
```

Implement three versions:

| Implementation | Location | Use Case |
|----------------|----------|----------|
| `LocalRepoManager` | e3-core | e3-api-server, local development |
| `InMemoryRepoManager` | e3-core | Unit tests |
| Cloud-based implementation | external | AWS/Azure/GCP cloud deployment |

## Benefits

1. **Testability** - Unit test handlers with `InMemoryRepoManager`, no filesystem needed
2. **Portability** - Cloud implementations provide the same contract
3. **Consistency** - Standard error types and status tracking across all implementations
4. **Separation of concerns** - Handlers focus on business logic, not storage details

## Implementation Plan

### Phase 1: Define Interface (e3-core)

1. Add `RepoManager` interface to `e3-core/src/storage/interfaces.ts`
2. Add `RepoStatus`, `RepoMetadata` types
3. Add standard error classes: `RepoNotFoundError`, `RepoAlreadyExistsError`
4. Export from `e3-core/src/index.ts`

### Phase 2: Implement LocalRepoManager (e3-core)

1. Create `e3-core/src/storage/local/LocalRepoManager.ts`
2. Implement using filesystem operations:
   - `list()` → `fs.readdir(reposDir)`
   - `exists()` → `fs.stat()` on required subdirs
   - `create()` → `repoInit()` (existing function)
   - `delete()` → `fs.rm(recursive: true)`
   - `getMetadata()` → Read `.e3/metadata.json` (new file)
   - `setStatus()` → Write `.e3/metadata.json`
3. Add unit tests with temporary directories

### Phase 3: Implement InMemoryRepoManager (e3-core)

1. Create `e3-core/src/storage/in-memory/InMemoryRepoManager.ts`
2. Store state in `Map<string, RepoMetadata>`
3. No I/O - instant operations for fast tests

### Phase 4: Integrate into e3-api-server

1. Add `RepoManager` to server configuration
2. Refactor handlers to use `repoManager.list()`, `repoManager.create()`, etc.
3. Update e3-api-tests to validate the contract
4. Remove direct filesystem operations from handlers

## Testing Strategy

```
e3-core unit tests (InMemoryRepoManager)
    ↓ validates interface contract
e3-api-server integration tests (LocalRepoManager)
    ↓ validates filesystem behavior
e3-api-tests (HTTP level)
    ↓ validates API contract (backend-agnostic)
external integration tests
    → validates any future cloud implementation
```

The key insight: e3-api-tests already validates the HTTP API contract. By ensuring both `LocalRepoManager` and cloud-based repo managers implement the same interface, we get confidence that cloud reimplementations of e3 behave correctly without duplicating test logic.
