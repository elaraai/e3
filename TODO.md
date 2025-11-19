# E3 Development TODO

## Testing Strategy

### Overall Philosophy
E3 is fundamentally a data orchestration system with strong correctness requirements. The cost of bugs (corrupted repos, lost task state, incorrect memoization) is high. Focus on high-value tests that catch real bugs, not achieving 100% coverage for its own sake.

### Phase 1: Foundation (Week 1)
**Priority: HIGH - e3-core is the foundation everything builds on**

- [ ] Set up test infrastructure in e3-core
  - [ ] Configure test scripts in package.json
  - [ ] Create test helpers for temp directory setup/teardown
  - [ ] Add test dependencies if needed

- [ ] Write core tests for objects.ts (20-30 tests)
  - [ ] Test `storeObject()` and `loadObject()` round-trip
  - [ ] Test atomic write behavior (tmp → rename pattern)
  - [ ] Test concurrent writes to same hash (deduplication)
  - [ ] Test error mid-write scenarios
  - [ ] Test `computeHash()` correctness
  - [ ] Test `computeTaskId()` with various inputs

- [ ] Write tests for repository.ts
  - [ ] Test `initRepository()` creates correct structure
  - [ ] Test `findRepository()` walks parent directories
  - [ ] Test `isValidRepository()` validation
  - [ ] Test `setTaskRef()` and `deleteTaskRef()`
  - [ ] Test `getTaskRefs()` listing
  - [ ] Edge case: Empty repos, missing directories

- [ ] Write tests for commits.ts
  - [ ] Test `createNewTaskCommit()` structure
  - [ ] Test `createTaskDoneCommit()` with result
  - [ ] Test `createTaskErrorCommit()` with error
  - [ ] Test `loadCommit()` .east → .beast2 fallback
  - [ ] Test commit parent references
  - [ ] Test invalid commit data handling

### Phase 2: Critical Paths (Week 2)
**Priority: HIGH - Complex algorithms and critical functionality**

- [ ] Write tests for resolve.ts (high complexity)
  - [ ] Test `resolveToTaskId()` with full hash
  - [ ] Test `resolveToTaskId()` with partial hash (unique)
  - [ ] Test `resolveToTaskId()` with partial hash (ambiguous - should error)
  - [ ] Test `resolveToTaskId()` with task refs
  - [ ] Test `resolveToCommit()` resolution chain
  - [ ] Test `resolveObjectHash()` partial matching
  - [ ] Edge cases: Empty refs, non-existent tasks

- [ ] Write tests for formats.ts
  - [ ] Test `loadIR()` from .json, .east, .beast2
  - [ ] Test `loadValue()` format detection
  - [ ] Test `irToBeast2()` and `valueToBeast2()`
  - [ ] Test format fallback logic
  - [ ] Test error handling for invalid formats

- [ ] Write tests for tasks.ts
  - [ ] Test `updateTaskState()` atomicity
  - [ ] Test `getTaskState()` reads
  - [ ] Test `listTasks()` enumeration
  - [ ] Test concurrent task updates

- [ ] Write e3-runner-node integration tests (5-10 tests)
  - [ ] Test runner picks up queued tasks via inotify
  - [ ] Test claim atomicity (two runners, one task)
  - [ ] Test successful task execution end-to-end
  - [ ] Test error handling (task throws exception)
  - [ ] Test signal handling (SIGTERM cleanup)
  - [ ] Test subtask spawning (if implemented)

### Phase 3: Polish (Week 3+)
**Priority: MEDIUM - Smoke tests and CI setup**

- [ ] Write end-to-end integration tests (2-3 tests)
  - [ ] Happy path: init → run → execute → get result
  - [ ] Memoization: run same task twice, verify cache hit
  - [ ] Error propagation: run failing task, verify error commit
  - [ ] Ref management: create/resolve/delete named refs

- [ ] Set up CI (GitHub Actions)
  - [ ] Create .github/workflows/test.yml
  - [ ] Run build + test on push/PR
  - [ ] Verify filesystem tests work in CI environment

- [ ] Bug-driven testing
  - [ ] Add tests for any bugs found in the wild
  - [ ] Document failure scenarios

### Out of Scope (Low ROI)
**These provide limited value - skip unless recurring bugs appear**

- ❌ e3-cli command tests (thin presentation layer over e3-core)
- ❌ Ink UI rendering tests (cosmetic bugs, not worth complexity)
- ❌ Mock-heavy unit tests that don't reflect real behavior
- ❌ Tests for simple forwarding functions
- ❌ e3-types tests (type definitions only, no runtime behavior)

### Testing Approach Guidelines

**e3-core**:
- Use real filesystem operations in temporary directories
- Don't mock `fs` - interactions are too complex to mock accurately
- Sandbox: `fs.mkdtempSync()` for each test, `rmSync()` in afterEach
- Focus on atomic operations, edge cases, error conditions

**e3-runner-node**:
- Integration tests over unit tests (70% of complexity is coordination)
- Start runner in subprocess, queue tasks, verify completion
- Test race conditions (claim atomicity)
- Test daemon lifecycle (startup, signal handling, shutdown)

**Integration tests**:
- Use real `e3` CLI binary and runner
- Create temporary repos, clean up after
- Target critical user paths only (3-5 scenarios)

### Estimated Metrics
- **Total test count**: 90-130 tests
- **Implementation time**: 2-3 weeks for comprehensive coverage
- **Maintenance burden**: Low (filesystem tests are stable)
- **Coverage target**: Focus on critical paths, not 100% coverage

### CI Configuration Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install
      - run: npm run build
      - run: npm run test
```
