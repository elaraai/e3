# E3 Development TODO

## Phase 1: Basic Single-Runtime Execution (NodeJS only)

**Goal**: Get the system working with just the NodeJS runner, no `execute` command for subtasks, no logging (stdout only).

### CLI Tool (`e3cli`)

- [x] **1. `e3 init` command** ✅
  - [x] Create `.e3/` directory structure
    - [x] `objects/` (content-addressable storage)
    - [x] `queue/node/`, `queue/python/`, `queue/julia/`
    - [x] `refs/tasks/` (named task references)
    - [x] `tasks/` (task_id → commit_hash mapping)
    - [x] `tmp/` (for atomic operations)
  - [x] Initialize empty repository
  - [x] Error handling for existing repository
  - [x] Support custom path argument

- [x] **2. Task submission (zero-argument tasks)** ✅
  - [x] Accept path to IR file (`.json`, `.east`, or `.beast2`)
  - [x] Parse/decode IR from file format (JSON supported)
  - [x] Convert IR to `.beast2` format (using JSON placeholder)
  - [x] Calculate SHA256 hash of IR
  - [x] Atomically emplace IR into `objects/` (via `tmp/`)
    - [x] Write to `tmp/<random>` first
    - [x] Rename to `objects/<hash[0:2]>/<hash[2:]>.beast2`
  - [x] Compute task_id from hash(ir_hash + args_hashes + runtime)
  - [x] Create `new_task` commit (`.east` formatted East value)
  - [x] Atomically emplace commit into `objects/` as `.east` file
  - [x] Write task_id to `refs/tasks/<name>`
  - [x] Write commit_hash to `tasks/<task_id>`
  - [x] Write commit_hash to `queue/node/<task_id>` to enqueue
  - [x] Support `--runtime` option

- [ ] **7. `e3 status <name>` - Get task status**
  - [ ] Resolve `refs/tasks/<name>` → task_id
  - [ ] Read `tasks/<task_id>` → commit_hash
  - [ ] Load and decode commit from `objects/`
  - [ ] Walk commit chain to find latest state
  - [ ] Display status: pending, running, completed, or failed

- [ ] **8. `e3 get <name>` - Retrieve task output**
  - [ ] Follow named ref → task_id → commit
  - [ ] Walk commit chain to find `task_done` commit
  - [ ] Load result blob from `objects/`
  - [ ] Decode Beast2 result
  - [ ] Output in requested format (`.east`, `.json`, or `.beast2`)

### NodeJS Runner (`e3-runner-node`)

- [ ] **3. Accept CLI argument for repository path**
  - [ ] Add `--repo <path>` argument (defaults to `E3_REPO` env or `~/.e3`)
  - [ ] Validate repository exists

- [ ] **4. Task queue management with inotify**
  - [ ] Maintain global `Set<string>` of enqueued task_ids
  - [ ] Set up inotify watcher on `queue/node/` directory
  - [ ] On inotify event: add task_id to set
  - [ ] On startup: read existing files in `queue/node/`, add to set
  - [ ] Main loop: iterate over set, launch tasks asynchronously
  - [ ] Remove from set when task claimed

- [ ] **Task claiming (atomic)**
  - [ ] Read `queue/node/<task_id>` (contains commit_hash)
  - [ ] Atomically claim by renaming to `queue/node/<task_id>.<worker_id>`
  - [ ] If rename fails (already claimed), skip
  - [ ] Delete claim file when task completes

- [ ] **5. Task execution**
  - [ ] Load commit from `objects/<commit_hash>.beast2`
  - [ ] Decode commit to get `ir_hash` and `args_hashes` (empty for zero-arg)
  - [ ] Load IR blob from `objects/<ir_hash>.beast2`
  - [ ] Decode IR
  - [ ] Compile IR with east-node platform functions
  - [ ] Execute compiled function (with `await` as necessary)
  - [ ] Capture result

- [ ] **6. Result commit and storage**
  - [ ] Encode result as Beast2
  - [ ] Calculate SHA256 of result
  - [ ] Atomically emplace result into `objects/` (via `tmp/`)
  - [ ] Create `task_done` commit (East value with parent, result_hash, execution_time, etc.)
  - [ ] Encode commit as Beast2, calculate hash
  - [ ] Atomically emplace commit into `objects/`
  - [ ] Update `tasks/<task_id>` to point to new commit_hash
  - [ ] Delete claim file from `queue/node/`

### Shared Core (`e3-core` or in each package)

- [ ] **Beast2 encoding/decoding helpers**
  - [ ] Encode East values to Beast2 format
  - [ ] Decode Beast2 to East values
  - [ ] (Can use existing implementations from `@elaraai/east`)

- [ ] **Object storage helpers**
  - [ ] `storeObject(data: Uint8Array): string` - atomically store, return hash
  - [ ] `loadObject(hash: string): Uint8Array` - load from objects/
  - [ ] `computeHash(data: Uint8Array): string` - SHA256 hex

- [ ] **Commit helpers**
  - [ ] Create `new_task` commit (East variant value)
  - [ ] Create `task_done` commit (East variant value)
  - [ ] Create `task_error` commit (East variant value)
  - [ ] Create `task_fail` commit (East variant value)

- [ ] **Task ID computation**
  - [ ] `computeTaskId(ir_hash, args_hashes[], runtime?): string`

### Testing & Validation

- [ ] **End-to-end test**
  - [ ] Create test IR (simple function returning a constant)
  - [ ] `e3 init` creates proper directory structure
  - [ ] `e3 run test-task ./test.ir.json` submits task
  - [ ] Start `e3-runner-node --repo ./.e3`
  - [ ] Runner picks up and executes task
  - [ ] `e3 status test-task` shows "completed"
  - [ ] `e3 get test-task` returns correct result

## Notes

- **No logging infrastructure yet** - let stdout/stderr go to terminal
- **No memoization checking yet** - always execute
- **No subtasks/execute platform function yet** - single-runtime only
- **No error handling UI** - basic error propagation for now
- **Atomic operations**: Always write to `tmp/`, then rename to final location

## Future Phases

- **Phase 2**: Add logging infrastructure (task-addressable log files)
- **Phase 3**: Add memoization (check `tasks/<task_id>` before executing)
- **Phase 4**: Add Python and Julia runners
- **Phase 5**: Add `execute` platform function for cross-runtime subtasks
- **Phase 6**: Add CLI commands for logs, history, gc, etc.
