# East Execution Engine (E3)

E3 is an automated, durable execution engine for East programs with cross-language runtime support.

## What is East?

East is a statically and structurally typed embedded language designed for speed, simplicity and ease of use. The East spec is small and has multiple runtimes implemented in different languages. Each runtime can provide a different set of platform capabilities for programs to leverage.

## What is E3?

E3 provides a git-like environment for your data and tasks, and executes tasks to completion. It enables execution of East programs using the Node.js runtime.

### Key Features

- **Node.js Execution**: Execute East functions in the Node.js runtime
- **Content-Addressable Storage**: Git-like object store for IR, arguments, and results with automatic deduplication
- **Automatic Memoization**: Cache results based on function IR and arguments for instant re-execution
- **Durable Execution**: Tasks are queued and executed to completion with comprehensive logging
- **Real-time Monitoring**: Stream logs from running tasks with support for nested subtasks
- **Type-Safe RPC**: Cross-language function calls use Beast2 binary encoding for efficient, type-safe data transfer

## Architecture

E3 consists of three main components:

### 1. CLI Tool (`e3`)
- Built with TypeScript/Node.js and [ink](https://github.com/vadimdemedes/ink) for rich terminal UI
- Submit tasks, view results, tail logs, manage the repository
- Seamlessly works with `.east`, `.json`, and `.beast2` file formats

### 2. Content Store and Registry
- **Content-addressable storage**: All data (IR, arguments, results) stored by SHA256 hash
- **Commit DAG**: Execution history tracked as East values forming a directed acyclic graph
- **Task state tracking**: Fast O(1) memoization lookups via task identity
- **Streaming logs**: Real-time log files with interleaved parent/child task output

### 3. Runtime Runner
- **Node.js runner**: Uses async/await with event loop concurrency
- Workers watch queue directories via `inotify` for low-latency task pickup

## How It Works

```
User submits task with IR + arguments
         ↓
    CLI creates commit and queues task
         ↓
  Runtime worker picks up task (inotify)
         ↓
    Check for memoized result (O(1))
         ↓
   Execute function (or spawn subtasks)
         ↓
  Store result + create completion commit
```

## Repository Structure

```
.e3/                          # E3 repository (like .git/)
├── objects/                  # Content-addressable storage
│   ├── ab/
│   │   └── cd1234...beast2   # IR, args, results, commits
├── logs/                     # Streaming task logs
│   └── abc123...eastl        # One log per task_id
├── queue/                    # Task queues (watched by runners)
│   └── node/
├── refs/
│   └── tasks/                # Named task references
│       └── pipeline          # task_id
└── tasks/                    # Task state (task_id → commit_hash)
    └── abc123...             # Latest commit for task
```

## Quick Start

```bash
# Initialize repository
e3 init

# Submit a task (with .east files)
e3 run pipeline ./pipeline.east ./data.east

# Watch logs in real-time
e3 logs pipeline --follow

# Get result
e3 get pipeline

# List all tasks
e3 list

# View commit history
e3 log pipeline
```

## Example

```typescript
// Define a pipeline using East
const pipeline = East.function(
  [ArrayType(FloatType)],
  FloatType,
  ($, rawData) => {
    // Process data
    const processed = $(preprocessData(rawData));

    // Aggregate results
    const result = $(aggregateResults(processed));

    $.return(result);
  }
);
```

When executed, E3 automatically:
1. Executes functions using the Node.js runtime
2. Serializes data using Beast2 format
3. Tracks execution history
4. Returns final result with full execution logs

## Components in this Repository

This is an npm workspace containing:

- **e3-cli**: TypeScript/Node.js/ink CLI tool
- **e3-core**: Core business logic library (like libgit2)
- **e3-runner-node**: Node.js runtime worker
- **e3-types**: Shared TypeScript type definitions

## Design Documents

See `design/` directory for detailed design documentation:

- `01_overview.md`: System architecture and goals
- `02_execute.md`: Cross-language execution platform function
- `03_registry.md`: Content store and registry design
- `04_runners.md`: Runtime worker implementations
- `05_cli.md`: CLI tool specification

## Development Status

This project is in active development. The initial implementation will focus on:
1. Single-computer, low-latency execution
2. File-based queue using inotify
3. Beast2 binary encoding for data transfer
4. Per-repository runner processes

Future enhancements may include:
- Distributed execution across multiple computers
- Persistent compilation caching
- Worker heartbeat monitoring
- Interactive REPL mode

## License

TBD
