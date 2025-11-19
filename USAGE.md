# E3 User Guide

Usage guide for the E3 (East Execution Engine) - a durable, content-addressable execution engine for East IR.

E3 provides git-like task management with cryptographic content addressing, allowing you to submit East functions for execution, track their progress, and retrieve results by hash.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [CLI Reference](#cli-reference)
- [Working with Tasks](#working-with-tasks)
- [Creating IR](#creating-ir)
- [File Formats](#file-formats)
- [Git-like Features](#git-like-features)
- [Running Workers](#running-workers)

---

## Quick Start

**Workflow:**
1. **Initialize a repository** using `e3 init`
2. **Submit tasks** with IR and arguments using `e3 run`
3. **Start a worker** to execute queued tasks using `e3-runner-node`
4. **Check status** and get results using `e3 status` and `e3 get`

### Basic Example

```typescript
// create-ir.mjs
import { East, IntegerType, printFor, IRType } from '@elaraai/east';
import fs from 'fs';

// Create a function that returns 42
const return42_expr = East.function([], IntegerType, () => 42n);

// Convert to IR and save
const return42_ir = return42_expr.toIR().ir;
const printer = printFor(IRType);
fs.writeFileSync('return42.east', printer(return42_ir));
```

```bash
# Generate the IR file
node create-ir.mjs

# Initialize an E3 repository
e3 init

# Submit the task
e3 run my-task return42.east

# Start a worker to execute it
e3-runner-node

# Check the result
e3 get my-task
# Output: 42
```

### Example with Arguments

```typescript
// create-ir.mjs
import { East, IntegerType, printFor, IRType } from '@elaraai/east';
import fs from 'fs';

// Create add1 function using expression builder
const add1_expr = East.function([IntegerType], IntegerType, ($, i) => i.add(1n));

// Convert to IR
const add1_eastir = add1_expr.toIR();
const add1_ir = add1_eastir.ir;

// Save as .east format
const printer = printFor(IRType);
const eastText = printer(add1_ir);
fs.writeFileSync('add1.east', eastText);

console.log('Created add1.east');
```

Then use it:

```bash
# Generate the IR file
node create-ir.mjs

# Create an argument file
echo "41" > arg.east

# Submit task with argument
e3 run add-task add1.east arg.east

# Execute and get result
e3-runner-node
e3 get add-task
# Output: 42
```

---

## Installation

### CLI Tool (e3cli)

```bash
cd javascript/e3cli
npm install
npm run build
npm link  # Makes 'e3' command available globally
```

### Node.js Worker (e3-runner-node)

```bash
cd javascript/e3-runner-node
npm install
npm run build
npm link  # Makes 'e3-runner-node' command available globally
```

---

## Core Concepts

### Content-Addressable Storage

E3 uses SHA256 hashing for all objects (IR, arguments, results, commits). Every object is stored once and referenced by its hash, ensuring:
- **Deduplication**: Identical content is stored only once
- **Integrity**: Content cannot be modified without changing its hash
- **Verifiability**: You can verify any object matches its hash

### Task Identity

A task is uniquely identified by:
```
task_id = SHA256(ir_hash + args_hashes + runtime)
```

This means:
- Same function + same arguments + same runtime = same task_id
- Tasks are naturally deduplicated
- You can reference tasks by their content, not arbitrary IDs

### Task Lifecycle

```
1. Submit    → .new_task commit created
2. Queue     → Task placed in queue/<runtime>/<task_id>
3. Claim     → Worker moves to claims/<runtime>/<task_id>.<worker_id>
4. Execute   → Worker compiles and runs the IR
5. Complete  → .task_done commit created with result hash
```

### Repository Structure

```
.e3/
├── objects/           # Content-addressable storage
│   ├── ab/
│   │   ├── cdef123....beast2   # Binary objects
│   │   └── 9876543....east     # Text objects
├── queue/             # Pending tasks
│   └── node/
├── claims/            # In-progress tasks (claimed by workers)
│   └── node/
├── refs/
│   └── tasks/         # Named task references
│       ├── my-task    # Points to task_id
│       └── another    # Points to task_id
├── tasks/             # Task state (task_id → latest commit)
│   └── bb11842c...    # Each file contains current commit hash
└── tmp/               # Temporary files for atomic operations
```

---

## CLI Reference

### `e3 init [path]`

Initialize a new E3 repository.

```bash
e3 init              # Initialize in current directory
e3 init /path/to/dir # Initialize in specific directory
```

Creates `.e3/` directory with the standard structure.

### `e3 run <name> <ir> [args...]`

Submit a task for execution.

```bash
e3 run task-name function.east              # No arguments
e3 run task-name function.east arg1.east    # One argument
e3 run add3 add.east 1.east 2.east 3.east  # Multiple arguments
```

**Arguments:**
- `<name>`: Friendly name for the task (creates a ref)
- `<ir>`: Path to IR file (.east, .json, or .beast2)
- `[args...]`: Paths to argument files (optional)

**Output:**
- Task ID (content hash)
- Commit hash
- IR hash
- Argument hashes (if any)

### `e3 status <name>`

Check the status of a task.

```bash
e3 status my-task
```

Shows:
- Task ID
- Current status (Pending, Completed, Failed)
- Execution time (if completed)
- Latest commit hash

### `e3 get <refOrHash>`

Retrieve task output or any object by hash.

```bash
# Get task output by name
e3 get my-task

# Get task output by task_id (full or partial hash)
e3 get bb11842c

# Get any object by hash
e3 get d689550b        # Might be IR
e3 get 8beea769        # Might be a result

# Specify output format
e3 get my-task --format east    # Human-readable (default)
e3 get my-task --format json    # JSON
e3 get my-task --format beast2  # Binary (for piping to file)

# Save binary output
e3 get my-task --format beast2 > result.beast2
```

### `e3 list`

List all task references.

```bash
e3 list
```

Shows all named tasks with their task_id prefixes (like `git branch`).

### `e3 log <refOrHash>`

Show commit history for a task.

```bash
e3 log my-task        # By name
e3 log bb11842c       # By task_id hash
```

Displays the commit chain from newest to oldest (like `git log`):
- Commit hashes
- Commit types (.new_task, .task_done, etc.)
- Timestamps
- Execution times
- IR and argument hashes

---

## Working with Tasks

### Task Names vs Task IDs

**Task Names** (refs):
- Human-readable aliases (e.g., "my-task")
- Stored in `.e3/refs/tasks/`
- Multiple names can point to the same task_id

**Task IDs**:
- Content-based hash: `SHA256(ir_hash + args_hashes + runtime)`
- 64 hex characters (e.g., `bb11842c543e876fccad...`)
- Unique identifier for the exact computation

### Partial Hashes

Like git, you can use partial hashes anywhere a hash is expected:

```bash
e3 get bb11842c              # Partial task_id
e3 get d689550b              # Partial object hash
e3 log bb11                  # Even shorter (if unambiguous)
```

E3 will resolve to the full hash if unambiguous, or error if multiple matches exist.

### Viewing Task History

```bash
# See the full execution history
e3 log my-task

# Example output:
# commit 68d080a23a4f
#   Type: Task completed
#   Result: 8beea7695fbb
#   Runtime: node
#   Execution time: 9.00ms
#   Timestamp: 2025-11-18T04:30:12.049Z
#
# commit 167b0f2c0473
#   Type: Task submission
#   Task ID: bb11842c543e
#   IR: d689550b203b
#   Args: [0 arguments]
#   Runtime: node
#   Timestamp: 2025-11-18T04:20:46.087Z
```

### Accessing Intermediate Objects

You can retrieve any object by its hash:

```bash
# Get the IR that was submitted
e3 get d689550b --format east

# Get an argument value
e3 get d5513cda

# Get a result
e3 get 8beea769
```

---

## Creating IR

### Using East Expression Builders (Recommended)

The best way to create IR is using East's TypeScript expression builders. This gives you:
- Type safety
- IDE autocomplete
- Compile-time error checking
- Clean, readable code

```typescript
import { East, IntegerType, ArrayType, printFor, IRType, encodeBeast2For } from '@elaraai/east';
import fs from 'fs';

// Simple function
const add1 = East.function([IntegerType], IntegerType, ($, x) =>
  x.add(1n)
);

// Function with multiple arguments
const add = East.function([IntegerType, IntegerType], IntegerType, ($, a, b) =>
  a.add(b)
);

// Working with arrays
const sumArray = East.function([ArrayType(IntegerType)], IntegerType, ($, arr) =>
  arr.reduce(0n, (sum, x) => sum.add(x))
);

// More complex logic
const factorial = East.function([IntegerType], IntegerType, ($, n) =>
  $.if(n.lte(1n))
    .then(() => 1n)
    .else(() => n.mul(factorial.call(n.sub(1n))))
);

// Convert to IR
const add1_ir = add1.toIR().ir;

// Save as .east (human-readable)
const printer = printFor(IRType);
fs.writeFileSync('add1.east', printer(add1_ir));

// Or save as .beast2 (binary)
const encoder = encodeBeast2For(IRType);
fs.writeFileSync('add1.beast2', encoder(add1_ir));

// Or save as .json
import { toJSONFor } from '@elaraai/east';
const toJSON = toJSONFor(IRType);
fs.writeFileSync('add1.json', JSON.stringify(toJSON(add1_ir), null, 2));
```

For more details on East expression builders, see the [East Developer Guide](../East/USAGE.md).

### Manual IR Creation

You can also write IR directly in .east format, though this is more error-prone:

```east
.Function (
    type=.Function (inputs=[.Integer], output=.Integer, platforms=[]),
    location=(filename="",line=0,column=0),
    captures=[],
    parameters=[.Variable(
        type=.Integer,
        location=(filename="",line=0,column=0),
        name="_1",
        mutable=false,
        captured=false,
    )],
    body=.Builtin(
        type=.Integer,
        location=(filename="",line=0,column=0),
        builtin="IntegerAdd",
        type_parameters=[],
        arguments=[
            .Variable(
                type=.Integer,
                location=(filename="",line=0,column=0),
                name="_1",
                mutable=false,
                captured=false,
            ),
            .Value(
                type=.Integer,
                location=(filename="",line=0,column=0),
                value=.Integer 1
            )
        ]
    )
)
```

---

## File Formats

E3 supports three file formats for IR, arguments, and results:

### .east Format (Human-Readable)

Text-based format for easy editing and reading.

**IR Example:**
```east
.Function (
    type=.Function (inputs=[.Integer], output=.Integer, platforms=[]),
    location=(filename="",line=0,column=0),
    captures=[],
    parameters=[.Variable(...)],
    body=.Builtin(...)
)
```

**Value Example:**
```east
42                    # Integer
"hello"              # String
[1, 2, 3]           # Array
```

### .json Format

Standard JSON with East type wrappers.

**Value Example:**
```json
{
  "type": "Integer",
  "value": "42"
}
```

### .beast2 Format (Binary)

Compact binary format with self-describing types.

```bash
# Create binary from text
cat value.east | e3-encode > value.beast2

# Extract binary to text
e3 get <hash> --format beast2 > value.beast2
e3 get <hash> --format east    # Human-readable
```

**When to use each:**
- `.east`: Human editing, debugging, version control
- `.json`: Integration with JSON APIs
- `.beast2`: Efficient storage and transmission

---

## Git-like Features

E3 borrows many concepts from git for familiar workflows:

### Content Addressing

Like git's object database, E3 stores everything by content hash:

```bash
# Objects are stored in .e3/objects/ab/cdef123...
# Just like git's .git/objects/
```

### References

Named pointers to task IDs:

```bash
e3 list                    # Like 'git branch'
# my-task → bb11842c543e
# another → abc123def456
```

### Commit History

Tasks have a commit chain:

```bash
e3 log my-task            # Like 'git log'
```

### Hash Prefixes

Abbreviated hashes work everywhere:

```bash
e3 get bb11842c           # Like 'git show bb11842c'
e3 log d689550            # Like 'git log d689550'
```

---

## Running Workers

### Node.js Worker

The Node.js worker executes tasks using the East JavaScript compiler.

```bash
# Run in current directory (looks for .e3/)
e3-runner-node

# Specify repository path
e3-runner-node --repo /path/to/repo/.e3

# The worker will:
# 1. Watch the queue/node/ directory
# 2. Claim tasks atomically
# 3. Compile and execute IR
# 4. Store results
# 5. Create task_done commits
```

**Worker Lifecycle:**
```
[Worker starts]
  ↓
[Scans queue/node/ for existing tasks]
  ↓
[Sets up inotify watcher for new tasks]
  ↓
[Main loop]
  ├─ Claims available task (atomic rename)
  ├─ Loads IR and arguments
  ├─ Compiles with EastIR
  ├─ Executes function
  ├─ Stores result
  ├─ Creates task_done commit
  └─ Updates task state
```

### Worker Safety

Workers use atomic operations to prevent conflicts:

1. **Atomic Claiming**: `rename(queue/task, claims/task.worker_id)`
2. **Worker IDs**: Unique per worker process
3. **Claim Files**: Include worker_id to track ownership
4. **Stale Detection**: Can identify abandoned claims (future feature)

### Multiple Workers

You can run multiple workers simultaneously:

```bash
# Terminal 1
e3-runner-node

# Terminal 2
e3-runner-node

# They will automatically distribute work
# Each worker has a unique ID
# Atomic claiming prevents double-execution
```

### Platform Functions

Future: Workers will support platform functions for external I/O:

```bash
# Not yet implemented
e3-runner-node --platform logging,database
```

---

## Environment Variables

- `E3_REPO`: Default repository path (if not using `--repo` flag)

```bash
export E3_REPO=/path/to/my/repo/.e3
e3 run my-task function.east
```

---

## Advanced Usage

### Inspecting the Repository

```bash
# List all objects
ls .e3/objects/

# View a commit directly
cat .e3/objects/ab/cdef123....east

# Check task state
cat .e3/tasks/bb11842c543e876fccad...

# See queued tasks
ls .e3/queue/node/

# See claimed tasks
ls .e3/claims/node/
```

### Manual Task Debugging

```bash
# Get full task information
e3 log my-task

# Extract IR for inspection
e3 get <ir-hash> --format east > ir.east

# Extract arguments
e3 get <arg-hash> --format east > arg.east

# Re-submit with modifications
e3 run my-task-v2 ir.east arg.east
```

### Deduplication Example

```bash
# Submit the same task twice
e3 run task1 function.east arg.east
e3 run task2 function.east arg.east

# They have the same task_id!
e3 list
# task1 → bb11842c543e
# task2 → bb11842c543e

# Only executed once
# Both refs point to same result
```

---

## Tips & Best Practices

1. **Use meaningful task names**: They're just pointers, so use descriptive names
2. **Check status before waiting**: `e3 status` tells you if a task is complete
3. **Use partial hashes**: Shorter is fine if unambiguous (like git)
4. **Inspect IR before submitting**: `cat function.east` to verify
5. **Keep workers running**: Use systemd or similar for production
6. **Back up .e3/objects/**: That's your content database
7. **Version control IR files**: Keep .east files in git for history

---

## Troubleshooting

### Task stuck in queue

```bash
# Check if worker is running
ps aux | grep e3-runner-node

# Start a worker if needed
e3-runner-node
```

### Task failed

```bash
# Check the log
e3 log my-task

# Look for task_error or task_fail commits
# (Future: more detailed error reporting)
```

### Worker crashed with claimed task

```bash
# Check claims directory
ls .e3/claims/node/

# Task files will include worker_id
# Future: automatic stale claim detection and recovery
```

### Object not found

```bash
# Verify hash is correct
e3 list  # Check task IDs

# Try full hash instead of partial
e3 get <full-64-char-hash>
```

---

## Future Features

- Platform function support
- Task cancellation
- Stale claim recovery
- Progress reporting for long tasks
- Task dependencies and workflows
- Web dashboard for monitoring

---

For more information about East IR and the language itself, see the [East repository](../East).
