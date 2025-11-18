# Content Store and Registry

## Overview

The registry provides content-addressable storage for IR, arguments, results, and named references to entry points and outputs. The design mirrors git's object model (minus trees).

**Architecture**: The registry is a filesystem-based durable storage layer. Task queuing and worker coordination happen via inotify-watched directories. The registry handles:
- Content-addressable blobs (IR, args, results, commits)
- Execution history (commit DAG as East values)
- Task state tracking (tasks/ directory)
- Task queue (queue/julia/, queue/node/, queue/python/)
- Streaming logs (logs/)

## Directory Structure

```
$E3_REPO/                         # Repository root (e.g., ~/.e3 or ./my-project/.e3)
├── objects/                      # Content-addressable storage
│   ├── ab/
│   │   ├── cd1234...rest.beast2  # Value blobs (IR, args, results, commits)
│   │   └── ef5678...rest.beast2
│   └── ...
├── logs/                         # Task logs (task_id-addressed, streamable)
│   ├── abc123...def.eastl        # Log for task_id abc123...def
│   └── 456789...xyz.eastl
├── queue/                        # Tasks awaiting execution (workers watch via inotify)
│   ├── julia/
│   │   └── abc123...def          # Task file (contains task commit hash)
│   ├── node/
│   │   └── 456789...xyz
│   └── python/
├── refs/
│   └── tasks/                    # Named task references
│       ├── pipeline              # Points to task_id for named task
│       └── optimization
└── tasks/                        # Task state: task_id → latest commit hash
    ├── abc123...def              # Contains SHA256 of latest commit for task
    └── 456789...xyz
```

## Task Identity

### Task ID Computation

A task is uniquely identified by its IR and arguments (and optionally runtime):

```python
def compute_task_id(ir_hash: str, args_hashes: list[str], runtime: str = None) -> str:
    """
    Compute deterministic task identifier.

    Args:
        ir_hash: SHA256 hash of function IR blob
        args_hashes: List of SHA256 hashes of argument blobs
        runtime: Optional runtime constraint (e.g., "python", "julia")

    Returns:
        SHA256 hash serving as task identifier
    """
    components = [ir_hash] + args_hashes
    if runtime:
        components.append(runtime)

    # Concatenate and hash
    task_key = ":".join(components)
    return hashlib.sha256(task_key.encode()).hexdigest()
```

**Key insight**: The task_id is deterministic and captures everything needed for memoization:
- Same IR + same args + same runtime → same task_id → can reuse cached result
- Different IR or args or runtime → different task_id → must execute

### Task ID Usage

The task_id is used for:

1. **Log files**: `logs/<task_id>.log` - pre-allocated before execution, streamable
2. **Memoization lookup**: `refs/results/<task_id>` - points to execution commit if cached
3. **Fast cache checking**: Check if `refs/results/<task_id>` exists before executing

## Content-Addressable Storage

### Object Storage

All data is stored in `objects/` with content-based addressing:

```bash
# Store a value
hash = SHA256(beast2_encoded_data)
path = objects/{hash[0:2]}/{hash[2:]}.beast2

# Example
hash = "abcd1234567890..."
path = objects/ab/cd1234567890...rest.beast2
```

### Object Types (Content-Addressable)

All objects are stored as Beast2-encoded East values (`.beast2` extension):

1. **Value blobs**: Any Beast2-encoded East value
   - Function IR
   - Arguments (one blob per argument)
   - Results (function output values)
   - Error details (East error structs)
   - **Commits** (execution records as East variant structs)

2. **Future extensions**: Structured multi-output support
   - Tree values for multi-output functions
   - Dataset references

**All data is Beast2-encoded** for consistency, efficiency, and cross-language compatibility.

### Task-Addressable Storage

Log files are stored in `logs/` addressed by task_id (not content hash):

```bash
# Log file path
logs/<task_id>.eastl

# Example
logs/abc123def456...789.eastl
```

**Key difference from content-addressable storage:**
- Log files are **writable** - task runners stream output to them during execution
- Path is determined by task identity (IR + args + runtime) before execution starts
- Users can `tail -f` the log file in real-time while the task runs
- Log files are **not** moved/renamed after creation

Each log file has this East type:

```ts
ArrayType(
    VariantType({
        log: StructType({
            timestamp: DateTime, // UTC
            type: VariantType({
                info: NullType,
                warn: NullType,
                error: NullType,
            }),
            message: StringType,
        }),
        subtask: StringType, // Task ID
    })
)
```

They are printed row-by-row as an .eastl (.jsonl for .east) format:

```
.log (timestamp=2025-01-02T12:34:56.023, type=.info, message="Task Started")
.log (timestamp=2025-01-02T12:34:57.365, type=.info, message="Computing something hard...")
.subtask "7gf93458hgbb41930vcs"
.log (timestamp=2025-01-02T12:35:25.944, type=.info, message="Task complete!")
```

## Commit Objects

Commits represent execution events and form a DAG (like git). **Commits are East values** stored as `.beast2` files.

### Commit Type Definition

```typescript
// East type definition
type Commit = VariantType({
  new_task: StructType({
    task_id: StringType,           // Computed from hash(ir + args + runtime)
    ir: StringType,                // Hash of function IR blob
    args: ArrayType(StringType),   // Array of hashes, one per argument
    runtime: StringType,           // Runtime: "python", "julia", "node"
    parent: NullableType(StringType), // Parent commit hash, or null
    timestamp: DateTimeType,       // UTC timestamp
  }),

  task_done: StructType({
    parent: StringType,            // Hash of new_task commit
    result: StringType,            // Hash of result blob
    runtime: StringType,
    execution_time_us: IntType,
    timestamp: DateTimeType,
  }),

  task_error: StructType({
    parent: StringType,            // Hash of new_task commit
    error_message: StringType,     // EastError message
    error_stack: ArrayType(StringType), // EastError stack
    runtime: StringType,
    execution_time_us: IntType,
    timestamp: DateTimeType,
  }),

  task_fail: StructType({
    parent: StringType,            // Hash of new_task commit
    error_message: StringType,     // Unknown error message
    runtime: StringType,
    execution_time_us: IntType,
    timestamp: DateTimeType,
  }),
})
```

### Commit Examples (in .east format)

1. **New Task**:
   ```
   .new_task (
     task_id="abc123def456...",
     ir="abcd1234...",
     args=["ef567890...", "12345678..."],
     runtime="python",
     parent=null,
     timestamp=2025-01-15T10:35:00Z
   )
   ```

2. **Task Done**:
   ```
   .task_done (
     parent="abc123...",
     result="90abcdef...",
     runtime="python",
     execution_time_us=12345,
     timestamp=2025-01-15T10:35:05Z
   )
   ```

3. **Task Error**:
   ```
   .task_error (
     parent="abc123...",
     error_message="Division by zero",
     error_stack=["compute.ts 42:31", "main.ts 10:24"],
     runtime="python",
     execution_time_us=5678,
     timestamp=2025-01-15T10:35:05Z
   )
   ```

**Note**: Memoized results are read synchronously by the requester (no new task is committed, but an appropriate entry is added to the log).

### Execution Chains

Each execution has exactly one parent:

```
Task Registration (commit 1)
    ↓
Execution (commit 2) → result blob

Or nested:

Task A Registration (commit 1)
    ↓
Execution A (commit 2)
    ↓ (spawns sub-task)
Task B Registration (commit 3, parent = commit 2)
    ↓
Execution B (commit 4) → result blob
```

### Commit Storage

Commits are stored as Beast2-encoded East values:

```bash
objects/ab/cd1234...rest.beast2
```

The commit hash is `SHA256(beast2_bytes)`, same as any other value blob.

### Storing Objects

```python
def store_object(data: bytes, extension: str = ".beast2") -> str:
    """
    Store data in content-addressable storage.
    
    Args:
        data: Raw bytes to store
        extension: File extension (.beast2, .error, .log)
    
    Returns:
        SHA256 hash of the data
    """
    hash = hashlib.sha256(data).hexdigest()
    
    # Split hash: first 2 chars as directory
    dir_name = hash[:2]
    file_name = hash[2:] + extension
    
    path = STORE_DIR / "objects" / dir_name / file_name
    path.parent.mkdir(parents=True, exist_ok=True)
    
    # Write atomically (temp file + rename)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_bytes(data)
    temp_path.rename(path)
    
    return hash
```

### Loading Objects

```python
def load_object(hash: str, extension: str = ".beast2") -> bytes:
    """
    Load data from content-addressable storage.
    
    Args:
        hash: SHA256 hash of the object
        extension: File extension
    
    Returns:
        Raw bytes
    """
    dir_name = hash[:2]
    file_name = hash[2:] + extension
    
    path = STORE_DIR / "objects" / dir_name / file_name
    
    if not path.exists():
        raise FileNotFoundError(f"Object not found: {hash}")
    
    return path.read_bytes()
```

## Named References and Task State

The registry uses two levels of naming:

### 1. Named Task References (refs/tasks/)

Human-readable names point to task_ids:

```bash
# refs/tasks/<name> contains the task_id
refs/tasks/pipeline → abc123def456...  # task_id
```

**Workflow:**
1. User submits named task "pipeline" with IR + args
2. Compute task_id from hash(ir + args + runtime)
3. Write `refs/tasks/pipeline` with task_id

**Implementation:**
```bash
echo "abc123def456..." > refs/tasks/pipeline
```

### 2. Task State (tasks/)

Task IDs map to their latest commit hash:

```bash
# tasks/<task_id> contains hash of latest commit
tasks/abc123def456... → xyz789abc...  # commit hash
```

**Workflow:**
1. Create new_task commit → write `tasks/<task_id>` with commit hash
2. Worker completes → create task_done commit → update `tasks/<task_id>` with new commit hash
3. For memoization: check if `tasks/<task_id>` exists and load the commit chain

**Memoization check (O(1)):**
```bash
# Check if we've seen this task before
if [ -f "tasks/$task_id" ]; then
    commit_hash=$(cat "tasks/$task_id")
    # Load commit and walk back to find result
fi
```

### Reference Operations

```python
def set_task_ref(task_name: str, task_id: str):
    """
    Create/update named task reference.

    Args:
        task_name: Human-readable task name
        task_id: Task identifier (hash of IR + args + runtime)
    """
    ref_path = REPO / "refs" / "tasks" / task_name
    ref_path.parent.mkdir(parents=True, exist_ok=True)

    # Write task_id to file
    ref_path.write_text(task_id)

def resolve_task_ref(task_name: str) -> str:
    """
    Resolve named task to its task_id.

    Args:
        task_name: Human-readable task name

    Returns:
        Task ID (SHA256 hash)
    """
    ref_path = REPO / "refs" / "tasks" / task_name

    if not ref_path.exists():
        raise FileNotFoundError(f"Task not found: {task_name}")

    return ref_path.read_text().strip()

def list_tasks() -> list[str]:
    """List all named tasks."""
    tasks_dir = REPO / "refs" / "tasks"

    if not tasks_dir.exists():
        return []

    return [f.name for f in tasks_dir.iterdir() if f.is_file()]

def set_task_state(task_id: str, commit_hash: str):
    """
    Update task state to point to latest commit.

    Args:
        task_id: Task identifier
        commit_hash: SHA256 hash of commit (new_task, task_done, etc.)
    """
    state_path = REPO / "tasks" / task_id
    state_path.parent.mkdir(parents=True, exist_ok=True)

    # Write commit hash to file
    state_path.write_text(commit_hash)

def get_task_state(task_id: str) -> Optional[str]:
    """
    Get latest commit for a task.

    Args:
        task_id: Task identifier

    Returns:
        SHA256 hash of latest commit, or None if task not found
    """
    state_path = REPO / "tasks" / task_id

    if not state_path.exists():
        return None

    return state_path.read_text().strip()
```

## Compilation Caching

Function IR is hashed and compiled versions are cached in-memory.

### Function Hash Computation

```python
def compute_function_hash(ir: dict) -> str:
    """
    Compute deterministic hash of function IR.
    
    Args:
        ir: East FunctionIR value (dict)
    
    Returns:
        SHA256 hash (hex string)
    """
    # Encode to Beast2 (deterministic)
    ir_bytes = encode_beast2_for(IRType)(ir)
    
    # Hash the bytes
    return hashlib.sha256(ir_bytes).hexdigest()
```

### In-Memory Cache

Each worker maintains an in-memory cache:

```python
# Python worker
function_cache: Dict[str, CompiledFunction] = {}

def get_or_compile(ir: dict, platform: list) -> CompiledFunction:
    """Get compiled function or compile if not cached."""
    fn_hash = compute_function_hash(ir)
    
    if fn_hash not in function_cache:
        compiled = compile_function(ir, platform)
        function_cache[fn_hash] = compiled
    
    return function_cache[fn_hash]
```

**Note**: Function cache is per-process, not persistent across restarts.

## Result Caching (Memoization)

Memoization uses `tasks/<task_id>` for O(1) cache lookups.

### Finding Cached Results

```python
def get_memoized_result(ir_hash: str, args_hashes: list[str], runtime: str) -> Optional[bytes]:
    """
    Get memoized result if available.

    Args:
        ir_hash: Hash of function IR
        args_hashes: List of argument blob hashes
        runtime: Runtime ("python", "julia", "node")

    Returns:
        Beast2-encoded result bytes, or None if not cached
    """
    # Compute task_id
    task_id = compute_task_id(ir_hash, args_hashes, runtime)

    # O(1) lookup: check if tasks/<task_id> exists
    commit_hash = get_task_state(task_id)

    if not commit_hash:
        return None  # Cache miss - never seen this task

    # Load latest commit and walk back to find result
    commit = load_object(commit_hash)  # Beast2-decoded Commit value

    # Walk commit chain backwards to find task_done
    while True:
        if commit.tag == "task_done":
            # Found successful result
            result_hash = commit.value.result
            return load_object(result_hash)
        elif commit.tag == "task_error" or commit.tag == "task_fail":
            # Task failed, no memoization
            return None
        elif commit.tag == "new_task":
            # Still pending/running
            return None

        # Walk to parent
        if commit.value.parent:
            commit = load_object(commit.value.parent)
        else:
            return None
```

### Storing Results

After successful execution:

```python
def store_task_done(task_commit_hash: str, result_hash: str, execution_time_us: int, runtime: str, task_id: str) -> str:
    """
    Create task_done commit and update task state.

    Returns:
        Hash of task_done commit
    """
    # Create task_done commit (East value)
    commit_value = {
        "tag": "task_done",
        "value": {
            "parent": task_commit_hash,
            "result": result_hash,
            "runtime": runtime,
            "execution_time_us": execution_time_us,
            "timestamp": datetime.utcnow()
        }
    }

    # Encode and store
    commit_bytes = encode_beast2_for(CommitType)(commit_value)
    commit_hash = store_object(commit_bytes)

    # Update task state: tasks/<task_id> → commit_hash
    set_task_state(task_id, commit_hash)

    return commit_hash
```

### Purity Checking

The system should only memoize pure functions. This can be:
1. Tracked in commit metadata (add `pure: true` field)
2. Inferred from platform function analysis
3. Enforced by policy (e.g., only memoize if explicitly marked)

## Logs

Logs are stored as **separate files** (`.log`) referenced by the task commit.

### Log File Creation

When a task commit is created, a log file is pre-allocated with a deterministic path:

```python
def create_task_commit(ir_hash: str, args_hashes: list[str], runtime: str = None,
                      task_name: str = None, parent: str = None) -> tuple[str, str]:
    """
    Create task commit and log file.

    Returns:
        (commit_hash, task_id)
    """
    # Compute task_id deterministically from IR + args + runtime
    task_id = compute_task_id(ir_hash, args_hashes, runtime)

    # Create empty log file at logs/<task_id>.log
    log_path = STORE_DIR / "logs" / f"{task_id}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.touch()  # Create empty file for streaming

    # Create task commit
    commit = {
        "type": "task",
        "task_id": task_id,
        "ir": ir_hash,
        "args": args_hashes,
        "runtime": runtime,
        "parent": parent,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "task_name": task_name
    }

    commit_hash = store_commit(commit)
    return commit_hash, task_id
```

### Log Storage Format

Logs are stored as **newline-delimited JSON** with interleaved parent/child task messages:

```json
{"type":"own","message":"Starting computation","timestamp":"2025-01-15T10:35:00.123Z"}
{"type":"own","message":"Processing 1000 records","timestamp":"2025-01-15T10:35:00.456Z"}
{"type":"child_start","task_id":"def456...","timestamp":"2025-01-15T10:35:01.000Z"}
{"type":"child","task_id":"def456...","message":"Child task executing","timestamp":"2025-01-15T10:35:01.100Z"}
{"type":"child_end","task_id":"def456...","result":"success","timestamp":"2025-01-15T10:35:02.000Z"}
{"type":"own","message":"Computation complete","timestamp":"2025-01-15T10:35:05.789Z"}
```

**Log message types:**
- `"own"`: Parent task's own logs
- `"child_start"`: Parent spawned a child task (includes child task_id)
- `"child"`: Log message from child task (proxied into parent's log)
- `"child_end"`: Child task completed (result: "success" or "error")

**Alternative**: Plain text with prefixes:
```
[parent] Starting computation
[parent] Processing 1000 records
[child:def456] Child task executing
[parent] Computation complete
```

This allows a single `tail -f` to see the entire execution tree's logs in chronological order.

### Real-time Log Tailing

Workers append to log files during execution:

```python
def execute_with_logging(fn: Callable, task_id: str, *args):
    """Execute function and stream logs to file."""
    log_path = STORE_DIR / "logs" / f"{task_id}.log"

    with open(log_path, 'a') as log_file:
        # Redirect stdout to log file
        with redirect_stdout(log_file):
            result = fn(*args)

    return result
```

Users can tail logs in real-time:

```bash
# Get log file for task
$ east logs pipeline --follow

# Or manually tail the log file (if you know the task_id)
$ tail -f ~/.east/store/logs/abc123def456...789.log
```

### Viewing Logs

```python
def get_task_logs(task_name: str) -> str:
    """Get logs from latest execution."""
    commit_hash = resolve_task_ref(task_name)
    commit = load_commit(commit_hash)

    # Walk back to find task commit (has task_id)
    while commit["type"] == "execution":
        commit = load_commit(commit["parent"])

    # Load log file (includes interleaved child logs)
    task_id = commit["task_id"]
    log_path = STORE_DIR / "logs" / f"{task_id}.log"

    if log_path.exists():
        return log_path.read_text()
    else:
        return ""
```

### Discovering Child Tasks

Child tasks are discoverable from the commit DAG by their `parent` field:

```python
def find_child_tasks(parent_commit_hash: str) -> list[str]:
    """
    Find all task commits that have this commit as parent.

    This requires scanning commits, but child relationships are typically
    discovered during execution and logged via child_start/child_end messages.
    """
    children = []

    # Scan all commits (could be optimized with an index)
    for commit_hash in iter_all_commits():
        commit = load_commit(commit_hash)

        if commit.get("parent") == parent_commit_hash:
            children.append(commit_hash)

    return children
```

**Note**: In practice, child task execution is tracked via log messages (`child_start`, `child_end`), so you don't need to scan commits to view child logs - they're already interleaved in the parent's log file.

## Garbage Collection

Clean up unreferenced commits and blobs.

### Mark and Sweep

```python
def garbage_collect():
    """Remove objects not referenced by any named tasks."""
    referenced_commits = set()
    referenced_blobs = set()
    referenced_task_ids = set()

    # Mark: Start from all named tasks in refs/tasks/
    for task_name in list_tasks():
        task_id = resolve_task_ref(task_name)
        referenced_task_ids.add(task_id)

        # Get latest commit for this task
        commit_hash = get_task_state(task_id)
        if commit_hash:
            mark_commit(commit_hash, referenced_commits, referenced_blobs, referenced_task_ids)

    # Sweep: Remove unreferenced objects
    objects_dir = REPO / "objects"
    removed_blobs = 0

    for subdir in objects_dir.iterdir():
        for obj_file in subdir.iterdir():
            obj_hash = subdir.name + obj_file.stem

            # All objects are .beast2 now (including commits)
            if obj_file.suffix == ".beast2":
                if obj_hash not in referenced_commits and obj_hash not in referenced_blobs:
                    obj_file.unlink()
                    removed_blobs += 1

    # Sweep logs
    logs_dir = REPO / "logs"
    removed_logs = 0
    if logs_dir.exists():
        for log_file in logs_dir.iterdir():
            task_id = log_file.stem  # abc123.eastl -> abc123
            if task_id not in referenced_task_ids:
                log_file.unlink()
                removed_logs += 1

    # Sweep task state files
    tasks_dir = REPO / "tasks"
    removed_tasks = 0
    if tasks_dir.exists():
        for task_file in tasks_dir.iterdir():
            task_id = task_file.name
            if task_id not in referenced_task_ids:
                task_file.unlink()
                removed_tasks += 1

    print(f"GC: removed {removed_blobs} blobs, {removed_logs} logs, {removed_tasks} task states")

def mark_commit(commit_hash: str, commits: set, blobs: set, task_ids: set):
    """Recursively mark commit and all its referenced objects."""
    # Already visited
    if commit_hash in commits:
        return

    commits.add(commit_hash)

    # Load commit (Beast2-encoded East value)
    commit = load_object(commit_hash)  # Returns decoded East value

    # Mark blobs referenced by this commit (depends on commit type)
    if commit.tag == "new_task":
        blobs.add(commit.value.ir)
        for arg_hash in commit.value.args:
            blobs.add(arg_hash)
        task_ids.add(commit.value.task_id)

    elif commit.tag == "task_done":
        blobs.add(commit.value.result)

    # Recursively mark parent
    if commit.value.parent:
        mark_commit(commit.value.parent, commits, blobs, task_ids)
```

## CLI Integration

The registry is accessed via CLI commands.

### Submit Task

```bash
# east submit <name> <ir_file> [args_file]
$ east submit pipeline ./pipeline.ir.json ./sales_data.json

# Creates:
# 1. IR blob: objects/{ir_hash}.beast2
# 2. Args blob: objects/{args_hash}.beast2
# 3. Task commit: objects/{task_hash}.commit
# 4. Sends ZeroMQ message to worker
```

### Get Result

```bash
# east get <entrypoint>
$ east get pipeline

# Resolves:
# 1. refs/entrypoints/pipeline -> {exec_commit_hash}
# 2. Load execution commit
# 3. Load result blob from commit
# 4. Decode and print
{
  "forecast": [100.5, 102.3, 98.7, ...]
}
```

### List Tasks

```bash
# east list
$ east list
pipeline
optimization
forecast
```

### Show Commit History

```bash
# east log <task>
$ east log pipeline

# Shows commit chain:
commit abc123... (execution, success, memoized)
  cached_from: xyz789...
  timestamp: 2025-01-15 10:40:00

commit def456... (execution, success)
  runtime: python
  execution_time: 12.3ms
  timestamp: 2025-01-15 10:35:05

commit ghi789... (task)
  task_name: pipeline
  timestamp: 2025-01-15 10:35:00
```

### Show Logs

```bash
# east logs <task>
$ east logs pipeline

[2025-01-15 10:35:00.123] INFO: Starting computation
[2025-01-15 10:35:00.456] INFO: Processing 1000 records
[2025-01-15 10:35:05.789] INFO: Computation complete
```

### Garbage Collection

```bash
# east gc
$ east gc
Scanning refs/tasks... 3 entries
Marking commits and blobs...
GC: removed 12 commits, 45 blobs
```

## Configuration

```bash
# Environment variables
EAST_STORE_DIR=~/.east/store        # Storage location
EAST_CACHE_MAX_SIZE=10GB            # Max cache size before GC
EAST_GC_AUTO=true                   # Auto-run GC when cache full
EAST_LOG_RETENTION_DAYS=30          # Keep logs for N days
```

## Example Workflow

```bash
# 1. Submit task
$ east submit pipeline pipeline.ir.json sales_data.json metadata.json
Stored IR blob: abcd1234...
Stored arg blobs: [ef567890..., 12345678...]
Created log file: log987654...
Created task commit: task123...
Dispatching to python worker...

# 2. Tail logs in real-time (in another terminal)
$ east logs pipeline --follow
Starting computation
Loading data...
Processing 1000 records

# 3. Worker executes (async)
# - Loads IR blob from objects/ab/cd1234...
# - Loads arg blobs from objects/ef/567890... and objects/12/345678...
# - Compiles (or uses cached)
# - Executes with logging to objects/lo/g987654...
# - Stores result blob in objects/90/abcdef...
# - Creates execution commit: exec456...
# - Updates ref: refs/tasks/pipeline -> exec456...

# 4. Get result
$ east get pipeline
{
  "forecast": [100.5, 102.3, 98.7, ...],
  "schedule": {...}
}

# 5. Show history
$ east log pipeline
commit exec456... (execution, success)
  runtime: python
  execution_time: 12.3ms
  result: 90abcdef...

commit task123... (task)
  ir: abcd1234...
  args: [ef567890..., 12345678...]
  log: log987654...

# 6. View logs
$ east logs pipeline
Starting computation
Loading data...
Processing 1000 records
Computation complete

# 7. Re-run with same data (instant - memoized)
$ east submit pipeline pipeline.ir.json sales_data.json metadata.json
Stored IR blob: abcd1234... (same)
Stored arg blobs: [ef567890..., 12345678...] (same)
Created log file: newlog111...
Created task commit: task789...
Searching for cached execution...
Cache hit! Found execution commit: exec456...
Created memoized execution commit: memo999...
Updated ref: refs/tasks/pipeline -> memo999...
Result available immediately (no execution needed).

# 8. View logs (shows new task's log, which is empty for memoized)
$ east logs pipeline
# Empty - memoized execution didn't run

# To see logs from original execution:
$ east log pipeline
commit memo999... (execution, success, memoized)
  cached_from: exec456...
  timestamp: 2025-01-15 10:40:00

commit task789... (task)
  ir: abcd1234...
  args: [ef567890..., 12345678...]
  log: newlog111...  # Empty log for memoized task

commit exec456... (execution, success)
  runtime: python
  execution_time: 12.3ms

commit task123... (task)
  ir: abcd1234...
  args: [ef567890..., 12345678...]
  log: log987654...  # Original execution log
```
