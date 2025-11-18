# CLI Tool (`e3`)

The East Execution Engine CLI tool is called `e3`. It's built with Node.js and uses [ink](https://github.com/vadimdemedes/ink) for rich terminal UI.

## Technology Stack

- **Language**: TypeScript (Node.js runtime)
- **UI Framework**: [ink](https://github.com/vadimdemedes/ink) - React for CLIs
- **Argument Parsing**: [commander](https://github.com/tj/commander.js) or [yargs](https://github.com/yargs/yargs)
- **File Watching**: Native Node.js `fs.watch()` for log tailing
- **Data Formats**: Seamlessly handles `.east`, `.json`, and `.beast2` files

## Commands

### Repository Management

#### `e3 init [path]`

Create a new E3 repository.

```bash
$ e3 init
Created E3 repository at ./.e3

$ e3 init ~/my-project
Created E3 repository at ~/my-project/.e3
```

Creates directory structure:
```
.e3/
├── objects/
├── logs/
├── queue/
│   ├── julia/
│   ├── node/
│   └── python/
├── refs/
│   └── tasks/
└── tasks/
```

#### `e3 status`

Show repository status and runner health.

```bash
$ e3 status
Repository: /home/user/project/.e3
Runners:
  ✓ node    (running, idle)
  ✓ python  (running, busy - task abc123...)
  ✗ julia   (not running)

Tasks:
  pipeline     - completed (2.3s ago)
  optimization - running (45s elapsed)
  forecast     - pending
```

Uses ink to render live-updating status with color-coded indicators.

### Task Submission

#### `e3 run <name> <ir> [args...]`

Submit a task for execution.

```bash
# Run with .east files
$ e3 run pipeline ./pipeline.east ./sales_data.east ./config.east

# Run with .json files (auto-converted)
$ e3 run forecast ./forecast.east ./data.json

# Run with .beast2 files (direct)
$ e3 run optimize ./optimize.beast2 ./params.beast2
```

**Workflow:**
1. Parse command arguments
2. Load IR file (`.east`, `.json`, or `.beast2`)
3. Load argument files and convert to Beast2
4. Hash IR and arguments to compute task_id
5. Check for memoized result in `tasks/<task_id>`
6. If memoized: Display result immediately
7. If not memoized:
   - Create new_task commit
   - Write task_id to `refs/tasks/<name>`
   - Write commit hash to `queue/<runtime>/<task_id>`
   - Wait for completion or return immediately (depending on flags)

**Options:**
- `--runtime <python|julia|node>`: Explicit runtime selection
- `--wait`: Wait for completion before returning
- `--watch`: Watch logs in real-time (implies --wait)

#### `e3 submit` (alias for `e3 run`)

### Task Inspection

#### `e3 list` or `e3 ls`

List all named tasks.

```bash
$ e3 list
pipeline     - completed 5m ago
optimization - running (2m 34s)
forecast     - completed 1h ago
backtest     - failed 2d ago
```

Reads `refs/tasks/` directory and checks status of each task.

#### `e3 get <name> [--format east|json|beast2]`

Get the result of a completed task.

```bash
$ e3 get pipeline
# Outputs result in .east format by default
{forecast: [100.5, 102.3, 98.7], schedule: {...}}

$ e3 get pipeline --format json
# Outputs as JSON
{"forecast": [100.5, 102.3, 98.7], "schedule": {...}}

$ e3 get pipeline --format beast2 > result.beast2
# Outputs raw Beast2 bytes
```

**Workflow:**
1. Resolve task name to task_id via `refs/tasks/<name>`
2. Load latest commit from `tasks/<task_id>`
3. Walk commit chain to find task_done commit
4. Load result blob from objects/
5. Decode Beast2 and convert to requested format
6. Write to stdout

#### `e3 log <name> [--commits|--output]`

Show commit history or execution logs for a task.

**Show commits (default):**
```bash
$ e3 log pipeline
commit def456abc... (task_done, 12.3ms)
  result: 90abcdef...
  timestamp: 2025-01-15 10:35:05Z

commit abc123def... (new_task)
  task_id: xyz789...
  ir: abcd1234...
  args: [ef567890..., 12345678...]
  runtime: python
  timestamp: 2025-01-15 10:35:00Z
```

**Show output logs:**
```bash
$ e3 log pipeline --output
[2025-01-15 10:35:00.123] Starting computation
[2025-01-15 10:35:00.456] Processing 1000 records
[2025-01-15 10:35:01.000] Spawning child task def456...
[2025-01-15 10:35:01.100]   [child:def456] Computing in Julia
[2025-01-15 10:35:02.000] Child complete
[2025-01-15 10:35:05.789] Computation complete
```

#### `e3 logs <name> [--follow]`

Tail task execution logs (alias for `e3 log <name> --output`).

```bash
$ e3 logs pipeline
# Show logs and exit

$ e3 logs optimization --follow
# Follow logs in real-time (like tail -f)
```

Uses ink to render live-updating log output with:
- Color-coded log levels
- Indentation for child tasks
- Timestamps
- Auto-scroll

**Implementation:**
```typescript
import {Text, Box} from 'ink';
import fs from 'fs';

function LogsView({taskId, follow}: {taskId: string, follow: boolean}) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const logPath = path.join(REPO, 'logs', `${taskId}.eastl`);

    if (!follow) {
      // Read once
      setLines(fs.readFileSync(logPath, 'utf-8').split('\n'));
      return;
    }

    // Watch for changes
    const watcher = fs.watch(logPath, () => {
      setLines(fs.readFileSync(logPath, 'utf-8').split('\n'));
    });

    return () => watcher.close();
  }, [taskId, follow]);

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{formatLogLine(line)}</Text>
      ))}
    </Box>
  );
}
```

### Task Management

#### `e3 delete <name>`

Delete a named task reference (does not delete data).

```bash
$ e3 delete old-experiment
Deleted task 'old-experiment'
Run 'e3 gc' to remove unreferenced data
```

Removes `refs/tasks/<name>`. Data remains until GC.

#### `e3 gc [--aggressive]`

Garbage collect unreferenced data.

```bash
$ e3 gc
Scanning refs/tasks... 5 tasks
Marking reachable objects...
Sweeping unreferenced data...
Removed: 45 blobs, 12 logs, 8 task states
Freed: 123.4 MB
```

**Aggressive mode:**
```bash
$ e3 gc --aggressive
# Also removes tasks/ state for unnamed tasks
# (Clears memoization cache for unnamed tasks)
```

Uses ink to show progress bar during GC.

### Data Export/Import

#### `e3 export <name> <path>`

Export task result to a file.

```bash
$ e3 export pipeline ./pipeline-result.east
$ e3 export pipeline ./pipeline-result.json
$ e3 export pipeline ./pipeline-result.beast2
```

Automatically determines format from file extension.

#### `e3 import <path>`

Import data into objects store (returns hash).

```bash
$ e3 import ./mydata.east
Imported: abcd1234567890...

$ e3 import ./config.json
Converted and imported: ef567890123456...
```

Useful for pre-loading data before submitting tasks.

### Debugging

#### `e3 inspect <hash>`

Inspect an object by its hash.

```bash
$ e3 inspect abcd1234...
Type: Commit (new_task)
Size: 234 bytes
Content:
  .new_task (
    task_id="xyz789...",
    ir="def456...",
    args=["abc123...", "fed987..."],
    runtime="python",
    parent=null,
    timestamp=2025-01-15T10:35:00Z
  )
```

#### `e3 tree [<hash>]`

Show commit tree (like `git log --graph`).

```bash
$ e3 tree
* def456... (task_done) - pipeline - 5m ago
|
* abc123... (new_task) - pipeline - 5m ago

* 789fed... (task_error) - optimization - 1h ago
|
* 456abc... (new_task) - optimization - 1h ago
```

Uses ink to render fancy graph with colors.

## Format Conversion

E3 seamlessly converts between `.east`, `.json`, and `.beast2` formats.

### Reading

```typescript
function loadValue(filePath: string): any {
  const ext = path.extname(filePath);

  if (ext === '.beast2') {
    // Direct Beast2 decode
    const bytes = fs.readFileSync(filePath);
    return decodeBeast2(bytes);
  } else if (ext === '.east') {
    // Parse .east format
    const text = fs.readFileSync(filePath, 'utf-8');
    return parseEast(text);
  } else if (ext === '.json') {
    // Parse JSON and convert to East value
    const text = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(text);
    return jsonToEast(json);
  } else {
    throw new Error(`Unknown format: ${ext}`);
  }
}
```

### Writing

```typescript
function writeValue(value: any, filePath: string): void {
  const ext = path.extname(filePath);

  if (ext === '.beast2') {
    // Encode to Beast2
    const bytes = encodeBeast2(value);
    fs.writeFileSync(filePath, bytes);
  } else if (ext === '.east') {
    // Format as .east
    const text = formatEast(value);
    fs.writeFileSync(filePath, text, 'utf-8');
  } else if (ext === '.json') {
    // Convert to JSON
    const json = eastToJson(value);
    const text = JSON.stringify(json, null, 2);
    fs.writeFileSync(filePath, text, 'utf-8');
  } else {
    throw new Error(`Unknown format: ${ext}`);
  }
}
```

## Interactive Mode (Future)

```bash
$ e3
> list
pipeline     - completed 5m ago
optimization - running

> get pipeline
{forecast: [100.5, 102.3, 98.7]}

> logs optimization --follow
...
```

Uses ink to create an interactive REPL with command history, autocomplete, and syntax highlighting.

## Configuration

### Repository Detection

E3 searches for `.e3/` directory:
1. Current directory
2. Parent directories (like git)
3. `~/.e3` (global default)

Can be overridden with `E3_REPO` environment variable.

### CLI Configuration

Stored in `.e3/config`:

```json
{
  "default_runtime": "python",
  "log_format": "pretty",
  "output_format": "east",
  "runners": {
    "node": "/usr/local/bin/node",
    "python": "/usr/bin/python3",
    "julia": "/usr/local/bin/julia"
  }
}
```

## Example Workflows

### Submit and wait

```bash
$ e3 run pipeline ./pipeline.east ./data.east --watch
Creating task...
Task ID: abc123def456...
Queued for python runtime

[logs stream here in real-time]

Completed in 2.345s
Result: {forecast: [...]}
```

### Background execution

```bash
$ e3 run long-simulation ./sim.east ./params.east
Task ID: xyz789...
Queued for julia runtime

$ e3 logs long-simulation --follow
# Watch progress in another terminal

$ e3 get long-simulation
# Get result when done
```

### Pipeline with multiple tasks

```bash
# Step 1: Preprocess
$ e3 run preprocess ./preprocess.east ./raw_data.json
Result: {cleaned_data: [...]}

# Step 2: Train (using output of step 1)
$ e3 export preprocess ./cleaned.east
$ e3 run train ./train.east ./cleaned.east
Result: {model_params: [...]}

# Step 3: Evaluate
$ e3 export train ./model.east
$ e3 run evaluate ./evaluate.east ./model.east
Result: {metrics: {accuracy: 0.95}}
```

## Error Messages

E3 provides friendly, actionable error messages:

```bash
$ e3 get nonexistent
Error: Task 'nonexistent' not found

Did you mean:
  - experiment
  - measurement

$ e3 run pipeline ./missing.east
Error: File not found: ./missing.east

$ e3 get pipeline
Error: Task 'pipeline' is still running
Use 'e3 logs pipeline --follow' to watch progress
```

## Exit Codes

- `0`: Success
- `1`: General error
- `2`: Task not found
- `3`: Task failed
- `4`: Task still running (when --wait is not used)
- `5`: Invalid arguments

This allows shell scripting:

```bash
if e3 get pipeline > result.json; then
  echo "Success!"
else
  echo "Failed or not ready"
fi
```
