# Execution Runners

E3 uses runtime-specific runners (workers) that execute tasks. Each runtime (Node.js, Python, Julia) has its own runner process that watches for new tasks and executes them.

## Architecture

```
User submits task
      ↓
   e3 CLI
      ↓
Creates task commit + writes to queue/<runtime>/
      ↓
Runner watches queue/<runtime>/ via inotify
      ↓
Runner claims task (atomic file operation)
      ↓
Runner executes task
      ↓
Runner writes result commit + updates task state
```

## Runtime Workers

### Node.js Runner

- **Process**: Single Node.js process per repository
- **Concurrency**: Event loop + async/await
- **Task execution**: When subtask is needed, spawns new task and awaits promise
- **Location**: Watches `queue/node/` directory

```typescript
// Pseudocode
async function nodeRunner(repoPath: string) {
  const queueDir = path.join(repoPath, 'queue', 'node');
  const watcher = fs.watch(queueDir);

  // Process existing tasks
  for (const file of fs.readdirSync(queueDir)) {
    await claimAndExecute(path.join(queueDir, file));
  }

  // Watch for new tasks
  for await (const event of watcher) {
    if (event.eventType === 'rename' && event.filename) {
      await claimAndExecute(path.join(queueDir, event.filename));
    }
  }
}
```

### Python Runner

- **Process**: Single Python process per repository
- **Concurrency**: asyncio + threading (optional)
- **Task execution**: Uses async/await pattern similar to Node.js
- **Location**: Watches `queue/python/` directory

```python
# Pseudocode
import asyncio
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

async def python_runner(repo_path: str):
    queue_dir = os.path.join(repo_path, 'queue', 'python')

    # Use inotify via watchdog
    event_handler = TaskQueueHandler()
    observer = Observer()
    observer.schedule(event_handler, queue_dir, recursive=False)
    observer.start()

    # Process existing tasks
    for filename in os.listdir(queue_dir):
        await claim_and_execute(os.path.join(queue_dir, filename))

    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
```

### Julia Runner

- **Process**: Single Julia process with multiple threads
- **Concurrency**: `Threads.@spawn` with dedicated watcher thread
- **Task execution**: Each task spawned onto thread pool
- **Location**: Watches `queue/julia/` directory
- **Launch**: `julia +1.12 -t4,1` (4 worker threads, 1 interactive thread)

```julia
# Pseudocode
using FileWatching

function julia_runner(repo_path::String)
    queue_dir = joinpath(repo_path, "queue", "julia")

    # Process existing tasks
    for filename in readdir(queue_dir)
        Threads.@spawn claim_and_execute(joinpath(queue_dir, filename))
    end

    # Watch for new tasks
    while true
        event = watch_folder(queue_dir)
        if event.changed
            Threads.@spawn claim_and_execute(event.path)
        end
    end
end
```

## Task Claiming (Atomic)

Workers must atomically claim tasks to prevent multiple workers from executing the same task.

### Claim Protocol

1. **Task file created**: `queue/<runtime>/<task_id>` contains commit hash
2. **Worker discovers**: Via inotify or polling
3. **Atomic claim**: Rename task file to include worker ID
4. **Execute**: Load commit, execute task
5. **Complete**: Delete claim file, write result commit

```python
def claim_task(queue_file: Path, worker_id: str) -> Optional[str]:
    """
    Atomically claim a task file.

    Returns:
        Commit hash if claimed, None if another worker claimed it
    """
    task_id = queue_file.name
    claimed_file = queue_file.with_suffix(f'.{worker_id}')

    try:
        # Atomic rename - only one worker succeeds
        queue_file.rename(claimed_file)

        # Successfully claimed!
        commit_hash = claimed_file.read_text().strip()
        return commit_hash

    except FileNotFoundError:
        # Another worker claimed it
        return None
```

## Task Execution

### Execution Flow

1. **Load commit**: Read task commit from objects/
2. **Check memoization**: Look up result in tasks/<task_id>
3. **If cached**: Return immediately, log memoization
4. **If not cached**:
   - Load IR and arguments from objects/
   - Compile IR (or use cached compiled version)
   - Execute function
   - Stream logs to logs/<task_id>.eastl
   - Store result in objects/
   - Create task_done commit
   - Update tasks/<task_id>

```python
async def execute_task(commit_hash: str, task_id: str, worker_id: str):
    """Execute a task."""
    # Load task commit
    commit = load_object(commit_hash)

    # Check for memoized result
    existing_result = get_memoized_result(
        commit.value.ir,
        commit.value.args,
        commit.value.runtime
    )

    if existing_result:
        # Memoization hit - log it
        log_memoization(task_id, commit_hash)
        return

    # Load IR and args
    ir = load_object(commit.value.ir)
    args = [load_object(arg_hash) for arg_hash in commit.value.args]

    # Open log file for streaming
    log_file = open(f'logs/{task_id}.eastl', 'a')

    try:
        # Compile (or get from cache)
        compiled_fn = get_or_compile(ir, runtime=commit.value.runtime)

        # Execute with logging
        start_time = time.time_ns() // 1000
        result = await compiled_fn(*args, log_stream=log_file)
        end_time = time.time_ns() // 1000

        # Store result
        result_bytes = encode_beast2(result)
        result_hash = store_object(result_bytes)

        # Create task_done commit
        store_task_done(
            commit_hash,
            result_hash,
            end_time - start_time,
            commit.value.runtime,
            task_id
        )

    except EastError as e:
        # Create task_error commit
        store_task_error(commit_hash, e, task_id)

    except Exception as e:
        # Create task_fail commit
        store_task_fail(commit_hash, e, task_id)

    finally:
        log_file.close()
```

## Child Task Spawning

When a task spawns a child task (e.g., Python task calls Julia function):

1. **Parent creates child task commit**
2. **Parent writes to appropriate queue**: `queue/<runtime>/<child_task_id>`
3. **Parent logs child start**: `.subtask "<child_task_id>"` in log file
4. **Parent awaits child**: Polls `tasks/<child_task_id>` for completion
5. **Child runner picks up task**: Same claiming protocol
6. **Child logs are proxied**: Child writes to parent's log file (interleaved)
7. **Child completes**: Updates `tasks/<child_task_id>`
8. **Parent resumes**: Reads child result, continues execution

```python
async def spawn_child_task(ir_hash: str, args_hashes: list[str], runtime: str, parent_task_id: str):
    """Spawn a child task from a parent task."""
    # Compute child task_id
    child_task_id = compute_task_id(ir_hash, args_hashes, runtime)

    # Create child task commit (with parent reference)
    child_commit = create_new_task_commit(
        ir_hash,
        args_hashes,
        runtime,
        parent=current_commit_hash,
        task_id=child_task_id
    )

    # Write to queue
    queue_file = REPO / 'queue' / runtime / child_task_id
    queue_file.write_text(child_commit_hash)

    # Log child start in parent's log
    parent_log = open(f'logs/{parent_task_id}.eastl', 'a')
    parent_log.write(f'.subtask "{child_task_id}"\n')
    parent_log.close()

    # Await child completion
    while True:
        commit_hash = get_task_state(child_task_id)
        if commit_hash:
            commit = load_object(commit_hash)
            if commit.tag in ['task_done', 'task_error', 'task_fail']:
                return commit  # Child completed
        await asyncio.sleep(0.1)  # Poll interval
```

## Multiple Repositories

**Open question**: One set of runners per repository or per computer?

### Option 1: Per-Repository Runners

- Each repository (`.e3/`) has its own set of runners
- Runners watch that specific repository's queue
- Isolation between projects
- Higher resource usage (3 processes per repo)

### Option 2: Global Runners

- Single set of runners per computer watches multiple repositories
- Runners need to track which repo each task belongs to
- Lower resource usage
- More complex coordination

**Recommendation**: Start with per-repository runners for simplicity. Can optimize later.

## Systemd Integration

E3 provides systemd units for automatic runner management.

### Unit Files

```ini
# /etc/systemd/user/e3-runner@.service
[Unit]
Description=E3 Runner for %i runtime
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/e3-runner-%i
Restart=always
RestartSec=5s
Environment="E3_REPO=%h/.e3"

[Install]
WantedBy=default.target
```

### Usage

```bash
# Enable all runners for user
systemctl --user enable e3-runner@node
systemctl --user enable e3-runner@python
systemctl --user enable e3-runner@julia

# Start runners
systemctl --user start e3-runner@node
systemctl --user start e3-runner@python
systemctl --user start e3-runner@julia

# View logs
journalctl --user -u e3-runner@python -f
```

## Worker Heartbeats (Future)

For monitoring and timeouts, workers could write heartbeat files:

```
workers/
├── node-12345/
│   ├── heartbeat        # Timestamp updated every 10s
│   ├── status           # "idle" | "busy"
│   └── current_task     # task_id or empty
```

This enables:
- Monitoring which workers are alive
- Detecting stuck tasks (no heartbeat)
- Reaping stale tasks back to queue

## Error Handling

### Worker Crashes

If a worker crashes while executing a task:

1. **Claim file remains**: `queue/<runtime>/<task_id>.<worker_id>`
2. **No commit is written**: `tasks/<task_id>` points to new_task commit
3. **Recovery**: Watchdog process or next startup detects stale claim files
4. **Requeue**: Move claim file back to queue for retry

```python
def reap_stale_claims(queue_dir: Path, timeout_seconds: int = 300):
    """Find and requeue tasks from crashed workers."""
    for claim_file in queue_dir.glob('*.*'):  # Files with extension
        age = time.time() - claim_file.stat().st_mtime

        if age > timeout_seconds:
            # Stale claim - move back to queue
            task_id = claim_file.stem
            queue_file = queue_dir / task_id
            claim_file.rename(queue_file)
```

### Infinite Loops

Tasks that run forever need timeout mechanisms:

- Set execution timeout in runner
- Kill task after timeout expires
- Create task_fail commit with timeout error

## Performance Considerations

### Compilation Caching

- Each runner maintains in-memory cache of compiled functions
- Key: SHA256(IR)
- Persistent cache could be added later (serialize compiled functions)

### Memoization Polling

- Current design polls `tasks/<task_id>` for child completion
- Could be optimized with inotify on tasks/ directory
- Or use explicit notification file

### Queue Polling vs. inotify

- inotify is preferred for instant notification
- Fallback to polling (100ms interval) if inotify unavailable
