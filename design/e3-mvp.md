# e3: MVP

A cut-down "version 1" plan for e3.


### Architecture

```
┌───────────────────────────────────────────────────────┐
│  . (your e3 repository directory)                     │
│  ├── e3.east           # Project configuration        │
│  ├── objects/          # Content-addressed storage    │
│  ├── packages/         # Installed packages (refs)    │
│  ├── executions/       # Execution state and results  │
│  └── workspaces/       # Stateful dataset namespaces  │
└───────────────────────────────────────────────────────┘
```

The e3 repository contains and runs your workspaces, while also acting as a cache, execution log and package store.

Workspaces are where you work with data and follow the "template" defined in the package deployed to that workspace. You can type `e3 start <workspace>` to execute the tasks to produce results.

Packages can serve different purposes, from support libraries to client project code. When a package is deployed to a workspace, so are all of its dependencies (meaning each workspace is associated with a given "root" or "main" package). Packages are immutable, and if you run the same package in a different workspace or e3 repository (even on a different computer), the same outputs will be reproduced.

e3 is agnostic to how code and packages are authored. You might create packages in TypeScript using the fluent API, extract them from another repository, or eventually code them in a native East syntax. East tasks execute compiled modules (IR), installed via packages.

### Key Concepts

**Workspaces** are namespaces of interactive datasets that you can read and write. Each workspace is initialized by deploying a package to the workspace, and contains the datasets and tasks (transformations producing datasets).

**Packages** are an immutable bundle of e3 objects - East IR, task objects, datasets and task bindings.

**Runner** are programs that can execute e3 tasks (e.g. our JavaScript interpretter or Julia compiler, or a completely custom program). They are defined by CLI commands.

**Task objects** are stored computations: a runner with inputs of given East types. Some of the inputs may have a fixed value (statically defined in the package that defines the task). For an East task, the first input is a (fixed) East function IR - which is itself an East value stored in e3. The remaining inputs are the function arguments.

**Executions** are task executions with specific inputs. A task object's identity is the hash of its runner plus its input hashes - same inputs always produce the same task ID, enabling memoization.

**Tasks** (user-facing) are transformations that read input datasets and produce output datasets. They consist of a task object (the computation) and a task binding (which dataset paths to read/write). `e3 start` executes all tasks in dependency order (like `make`).

### Example Workflow

```bash
# Initialize a repository for production data
$ cd ~/data/client-abc
$ e3 init .
Created e3 repository

# Install your team's package from a local .zip
$ e3 package import . ~/dev/acme-forecast/dist/acme-forecast-1.2.0.zip
Installing acme-forecast@1.2.0... done

# Run a task ad-hoc against data on your computer
$ e3 run . acme-forecast/train ./sales.beast2 -o ./model.beast2
Running acme-forecast/train... done (2.3s)

# Run again with same inputs - instant (cached)
$ e3 run . acme-forecast/train ./sales.beast2 -o ./model.beast2
Cached (0.01s)

# Create a workspace and deploy a package
$ e3 workspace create . production
Created production workspace

$ e3 workspace deploy . production acme-forecast@0.21.1
Deploying acme-forecast@0.21.1 to production... done

# Execute the full dataflow pipeline
$ e3 start . production
[1/3] preprocess... done (0.5s)
[2/3] train... done (38.1s)
[3/3] predict... done (1.2s)

# Get/set datasets
$ e3 dataset get . production outputs/predict
$ e3 dataset set . production inputs/sales ./new_sales.beast2

# Rerun - only affected dataflows execute
$ e3 start . production
[1/3] preprocess... cached
[2/3] train... cached
[3/3] predict... done (1.1s)

# Export workspace as a package (includes deployed package + current data)
$ e3 workspace export . production ./handoff.zip
Exporting acme-forecast-0.21.1-a3f8b2c1 to handoff.zip... done

# Colleague imports it
$ e3 package import . ./handoff.zip
Installing acme-forecast@0.21.1-a3f8b2c1... done

$ e3 workspace deploy . analysis acme-forecast@0.21.1-a3f8b2c1
# Now they have your exact data state
```

## Repository Structure

An e3 repository is a directory containing configuration, content-addressed storage, and refs. Most files outside `objects/` are **refs** - small text files containing a SHA256 hash pointing to an object.

### Example Repository

```
~/data/client-abc/                    # Your e3 repository
├── e3.east                           # Config (registries, settings)
│
├── objects/                          # Content-addressed storage (all data lives here)
│   ├── 3a/
│   │   └── 8f2b...                   # A package object
│   ├── 7c/
│   │   └── 91d4...                   # A module IR blob
│   ├── a1/
│   │   └── bc56...                   # A dataset value
│   └── f2/
│       └── e847...                   # An execution result
│
├── packages/                         # Installed packages (refs)
│   ├── east-python/
│   │   └── 1.2.0                     # Contains: 3a8f2b... → objects/3a/8f2b...
│   └── acme-forecast/
│       ├── 0.20.0                    # Contains: 7d3e1a...
│       └── 0.21.1                    # Contains: 9b4c2f...
│
├── executions/                       # Execution history for tasks
│   └── c4f9a2.../                    # Input hash (hash of all input values)
│       ├── stdout.txt                # Captured stdout (streamed during run)
│       ├── stderr.txt                # Captured stderr (streamed during run)
│       └── output                    # Contains: f2e847... → objects/f2/e847...
│
└── workspaces/                       # Stateful dataset namespaces
    └── production/
        ├── package                   # Contains: acme-forecast/0.21.1
        └── root                      # Contains: d4e5f6... → DataObject (struct)
```

### Directory Reference

#### `e3.east`

Configuration files consist of arrays of semicolon-separated values.
Generally these are variants allowing optional configuration of different settings and forward-compatibility as new options are added.
The complete configuration struct is formed by merging these with the "default" config struct.

The `.runners` option lets you configure how any given runner is executed in your environment.
It turns a list of "tokens" into a list of `exec` arguments (command followed by command-line arguments).

```east
[
    .runners {
        "east-node": [.literal "east-node", .input_paths, .output_path],
        "east-py": [.literal "east-py", .literal "run", .literal "--std", .literal "--io", .inputs [.literal "--input", .input_path], .output_path],
        "custom-ml": [.literal "uv", .literal "run", .literal "/home/user/dev/ml/script.py", .input_paths, .output_path],
    },

    // can add this later:

    // .registries = {
    //     "default": "https://packages.east-lang.org",
    //     "acme": "https://packages.acme.internal",
    //     "staging": "file:../staging,
    // },
]
```

Note that e3 will martial the inputs into a scratch space for the task

#### `objects/`

Content-addressed storage for all immutable data. Objects are stored by SHA256 hash, split into subdirectories by first two hex characters (like git). Everything ends up here: module IR, task definitions, dataset values, execution results, package manifests.

#### `packages/`

Installed packages. Each `<name>/<version>` file is a ref pointing to a package object in `objects/`. Package objects contain refs to their modules, tasks, dataflows, and datasets.

When you `e3 package add . acme-forecast`:
1. Package object and all referenced objects stored in `objects/`
2. Ref created at `packages/acme-forecast/0.21.1`

#### `executions`

Task execution logs and (memoized) outputs. Organized by execution hash (the SHA256 of the task object plus inputs).

- `stdout.txt`, `stderr.txt` - Captured output (streamed live during execution)
- `output` - Ref to the result object

Execution identity = hash(task_hash, input_hashes...). Same inputs → same execution directory → cache hit.

#### `workspaces/`

Stateful namespaces where you work with data. Each workspace has:

- `package` - Ref to the deployed package (e.g., `acme-forecast/0.21.1`)
- `root` - Ref to the root DataObject (a struct matching package's dataset schema)

Workspaces follow the "template" defined by their package: the dataflows determine what tasks run and how datasets connect. But the actual data values can differ between workspaces.

The workspace root is a tree structure (like a git commit's root tree) enabling:
- **Atomic updates**: Swap one ref to update entire workspace
- **Structural sharing**: Unchanged subtrees keep the same hash
- **Fast cloning**: Duplicate a workspace by copying two refs

### Refs Pattern

Most files outside `objects/` are refs - text files containing a SHA256 hash:

```bash
$ cat packages/acme-forecast/0.21.1
3a8f2b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a

$ cat workspaces/production/root
d4e5f6789abc0123456789abcdef0123456789abcdef0123456789abcdef0123
```

This indirection enables:
- **Deduplication**: Same data referenced from multiple places
- **Atomic updates**: Write new object, then update ref
- **Easy diffing**: Compare ref values to detect changes

The exceptions are:
- `e3.east` - Configuration, not a ref
- `executions/<hash>/*.txt` - Log files streamed during execution

### Object Types

All data in `objects/` is one of these types:

| Object | Description | Defined in |
|--------|-------------|------------|
| **Package** | Bundle of modules, tasks, dataflows, datasets | Packages section |
| **Module** | East IR + imports | Packages section |
| **Task** | How to run a computation (init + run commands) | Tasks & Execution section |
| **Data** | East values as trees or blobs | Data Objects section |

Objects reference each other by hash. A package contains hashes pointing to its modules and tasks. A task contains hashes pointing to module IR and init files.

### Data Tree Objects

Data tree objects store East values as persistent trees with structural sharing (like git trees). Each tree object is a `.beast2` file containing an East variant:

```ts
type DataRefType = VariantType<{
    unassigned: NullType, // leaf for unassigned value (e.g. result of a pending task)
    null: NullType,       // leaf for inline null value (optimization for NullType)
    value: StringType,   // leaf for value in object store (hash of .beast2 object)
    tree: StringType,     // tree of data refs (hash of .beast2 object)
}>

type TreeObjectType<T extends EastType> =
  T extends StructType<infer Fields> ? StructType<{ [K in keyof Fields]: DataRefType }> :
//   T extends ArrayType<infer U> ? ArrayType<DataRefType> :
//   T extends DictType<infer K, infer V> ? Dict<K, DataRefType> :
//   T extends VariantType<infer Cases> ? StructType<{ case: StringType /* keyof Cases */, value: DataRefType }> :
  never
```

The MVP will only contain "struct" trees - the names of datasets are static.
The more dynamic types will allow for data partitioning and dataflow patterns like scatter-gather later.

**Example: Workspace root (struct)**

```east
(
    inputs = .tree "a1bc56...",
    outputs = .tree "d4e5f6...",
)
```

**Example: inputs struct**

```east
(
    sales = .object "7c91d4...",
    features = .object "8d2e7f...",
)
```

**Example: outputs struct**

```east
(
    model = .unassigned,
    predictions = .unassigned,
)
```

**Type inference:** Data references don't include East types. The type can be inferred by traversing the package's dataset schema in parallel with the object tree. The variant tag (value/tree) tells the decoder how to interpret the object's structure; the schema tells it what the values mean. Note each .beast2 object has a self-describing header - this means the tree object do include struct field names inside the referred object.

**Structural sharing:** When updating a single field, only the path from root to that field needs new objects. Unchanged subtrees keep their hashes, enabling fast atomic updates and cheap workspace cloning.

### Garbage Collection

`e3 gc` removes unreferenced objects. The object graph is traced from roots:

**Roots:**
- `packages/<name>/<version>` → PackageObject hash
- `workspaces/<ws>/package` → `<name>/<version>` (resolved via packages/)
- `workspaces/<ws>/root` → DataObject hash (workspace data tree)
- `executions/<hash>/output` → DataObject hash

**Object references:**

| Object | References |
|--------|------------|
| PackageObject | `tasks` → TaskObject hashes |
| | `datasets.root` → TreeObject hash (root of data tree) |
| TaskObject | Any fixed input DataObject hashes |
| TreeObject | `.value` refs → DataObject hashes (blobs) |
| | `.tree` refs → TreeObject hashes (subtrees) |
| | `.null` / `.unassigned` → None (terminal) |

### Bundled vs Installed

**Bundled** (`.zip` for distribution):
```
acme-forecast-0.21.1.zip
├── manifest.east     # Package name, version, root object hash
└── objects/
    ├── 3a/8f2b...
    ├── 7c/91d4...
    └── ...
```
- All objects inline in a zip file
- Self-contained, can be copied anywhere
- Produced by TypeScript build, `e3 package export`, or `e3 workspace export`
- Streaming I/O via `yauzl`/`yazl` (no need to load into RAM)

**Installed** (in repository):
- Objects extracted to `objects/`
- Ref created at `packages/<name>/<version>`
- Deduped with other packages
- Ready to deploy to workspaces

## Packages

A **package** bundles everything needed to run computations: modules, tasks, dataflows, and datasets. Packages are:
- **Defined in TypeScript** using the e3 SDK
- **Distributed as `.zip`** files (bundled form)
- **Installed as refs** to objects in the repository

### Package Object

A package object is stored in `objects/` and contains refs (hashes) to other objects:

```ts
type PackageObject = StructType<{
    name: StringType,
    version: StringType,

    // Refs to other objects (hash strings)
    tasks: DictType<StringType, StringType>,      // name → task object hash

    // Dataset structure and values
    datasets: StructType<{
        schema: DatasetSchema,   // Defines tree vs blob structure (root is always .tree .struct)
        value: StringType,       // Hash of root TreeObject
    }>,
    dataflows: ArrayType<DataflowDef>,            // Orchestration rules

    // Future package dependencies:
    // dependencies: DictType<StringType, StringType>,  // pkg name → version
}>;

// Dataset schema defines the workspace tree structure (what's a tree vs blob)
type DatasetSchema = VariantType<{
    obj: EastTypeValue,              // Leaf: task-managed, opaque to orchestrator
    tree: TreeSchema,                 // Branch: orchestrator-managed, supports iteration
}>;

type TreeSchema = VariantType<{
    struct: DictType<StringType, DatasetSchema>,  // Fixed fields
    // Future variants
    // - array values
    // - dict entries
    // - variant cases
    // - recursive trees
}>;

// TreePath identifies a location in the dataset tree
type TreePath = ArrayType<PathComponent>;

type PathComponent = VariantType<{
    field: StringType,  // .field "name" - struct tree field
    // Future variants:
    //  - glob (iterate over array/dict tree entries)
    //  - variant cases (conditional execution)
    //  - access multiple struct fields
    //  - array index / dict key selection
    //  - recursive trees + loopy tasks
}>;

// Dataflow defines how orchestrator marshals inputs/outputs
type DataflowDef = VariantType<{
    task: StructType<{
        task: StringType,             // Task name in this package
        inputs: ArrayType<TreePath>,  // TreePath for each input
        output: TreePath,             // TreePath of output
    }>,
    // Future variants:
    // - shuffle: rearrange nested dynamic datasets to enable partitioned group-by (split-apply-combine) dataflows
    // - source: External data source (polling, webhooks)
    // - sink: External data sink (APIs, databases)
    // - cron: Time-triggered execution
}>;
```

**Example package object:**

```east
(
    name = "acme-forecast",
    version = "0.21.1",
    tasks = {
        "train": "5e7a3b...",
        "predict": "c4d5e6...",
    },

    // Dataset structure and initial values
    datasets = (
        schema = .tree .struct {
            "inputs": .tree .struct {
                "sales": .value SalesRecordType,
                "features": .value FeaturesType,
            },
            "outputs": .tree .struct {
                "model": .value ModelType,
                "predictions": .value PredictionType,
            },
        },
        root = "f4a7c2...",  // Hash of root TreeObject (initial/current state)
    ),

    // Dataflows: how tasks are orchestrated
    dataflows = [
        .task (
            task = "train",
            inputs = [
                [.field "inputs", .field "sales", .glob],
                [.field "inputs", .field "features"],
            ],
            output = [.field "outputs", .field "model"],
        ),
        .task (
            task = "predict",
            inputs = [
                [.field "outputs", .field "model"],
                [.field "inputs", .field "sales", .glob],
            ],
            output = [.field "outputs", .field "predictions", .glob],
        ),
    ],
)
```

### Bundled vs Installed

**Bundled** (`.zip` for distribution):
- All content inline in a zip file
- Self-contained, can be copied anywhere
- Produced by TypeScript build or `e3 workspace export`

**Installed** (in repository):
- Content stored in `objects/`
- Ref at `packages/<name>/<version>` points to package object
- Dependencies resolved to specific versions

```bash
# Import from local .zip
$ e3 package import . ~/dev/acme-forecast/dist/acme-forecast-0.21.0.zip

# Add from registry (fetches + imports)
$ e3 package add . acme-forecast@0.21.0

# Export an installed package to .zip
$ e3 package export . acme-forecast@0.21.0 ./acme-forecast-0.21.0.zip
```

### Package Namespacing

Package names provide namespaces for their contents:

```bash
# Run a task from a package
$ e3 run . acme-forecast/train inputs/sales.east -o model.beast2

# Reference a module from another package (in East code)
const ml = $.import("east-python/ml");
```

### Creating Packages

Packages are defined in TypeScript using the e3 SDK:

```typescript
import { East } from '@elaraai/east';
import { e3 } from '@elaraai/e3-sdk';

// input dataset - loaded from ./inputs/sales.* (user can provide .beast2, .east or .json)
const sales = e3.input("sales", ArrayType(...), /* default value goes here */)

// Define a dataflow step from a function
const trainFunction = East.function([ArrayType(...)], output_type, ($) => {
    // ... East code
});
const pipeline = e3.dataflow("train", [sales], trainFunction); 

// Or define it inline
const pipeline = e3.dataflow("train", [sales], $ => { ... }); 

// Construct the package bundle
const pkg = e3.package(
    {
        name: "acme-forecast",
        version: "0.21.0",
    },
    pipeline, // automatically infers any dependencies (input datasets, upstream dataflows, etc)
    // ... can add more
);

await pkg.save(/* defaults to save at ./acme-forecast-0.21.0.zip */);
```

There is a lot of freedom to import and bundle "pure" East modules defined in other npm packages, dynamically link with e3 packages, define logic inline, or more.

Simply run the script to produce the `acme-forecast-0.21.0.zip` bundle.

## Tasks & Execution

A **task** is an object that defines how to run a computation. Tasks are stored in `objects/` and referenced by packages.

### Task Object

```ts
type TaskObject = StructType<{
    runner: StringType,
    inputs: ArrayType<StructType<{
        type: EastType,
        value: OptionType<StringType>, // object hash for "fixed" values
    }>,
    output: EastType,
}>;
```

### Example: Node.js Task

```east
(
    runner = "east-node",
    inputs = [
        ( type = IRValueType, value = .some pipelineFunction.to_ir().ir ),
        ( type = ArrayType(...), value = .none ),
    ],
    output = ...
)
```

### Runner command configuration

These construct the components to `exec` when executing a runner, defined in the e3.east configuration file.

```ts
type CommandPart = VariantType<{
    literal: StringType,     // Literal string: "east-py", "run", "--std"
    input_path: NullType,    // Path to "next" input (e.g. first)
    inputs: ArrayType<VariantType<{ // For each remaining input
        literal: StringType, // Literal string: "--input"
        input_path: NullType // Path to inputs
    }>>,
    output_path: NullType, // Path where output should be written
}>;
```

### The East CLI

The `east-node` CLI (from `@elaraai/east-node`) runs East IR:

```bash
east-node run \
  --runtime @elaraai/east-node-fs \
  acme-forecast/train \
  --input ./inputs/sales.beast2 \
  --output ./outputs/model.beast2
```

- `--runtime <pkg>` - npm packages providing runtime modules (self-register their module names)
- `<name>` - the IR to execute
- `--input <path>` - input data files
- `--output <path>` - where to write result

Runtime module packages export a record keyed by module name:

```typescript
// @elaraai/east-node-fs
export default {
    "east-node/fs": { 
        readFile: (path: EastString) => /* ... */,
        writeFile: (path: EastString, data: EastBytes) => /* ... */,
    },
};
```

### Execution

An **execution** is a task invoked with specific inputs. Execution identity:

```
input_hash = hash(runner, ...input_hashes)
```

Same runner + same inputs (fixed or otherwise) = same execution directory = cache hit.

### Running Tasks

```bash
# Ad-hoc run (specify I/O explicitly)
$ e3 run . acme-forecast/train inputs/sales.east -o outputs/model.beast2
Running acme-forecast/train... done (2.3s)

# Run again - cache hit
$ e3 run . acme-forecast/train inputs/sales.east -o outputs/model.beast2
Cached (0.01s)

# Run from a different package
$ e3 run . other-pkg/preprocess inputs/raw.json -o inputs/clean.east
```

### Execution Process

Each task execution runs as a **separate process**:

1. e3 looks up the task object from `objects/`
2. Run the runner's command, substituting:
   - `.input_path` → path to "next" input (starting with first)
   - `.inputs` → repeat a pattern for all remaining inputs
   - `.output` → output path
4. Store result in `objects/`, write ref to `executions/<hash>/output`
5. Stdout/stderr streamed to `executions/<hash>/*.txt`

### Memoization

Executions are cached by their ID (hash of task + inputs). When you run a task:

1. Compute input hash from input content hashes
2. Check if `tasks/<task_hash>/executions/<input_hash>/output` exists
3. If cached: return result immediately (read ref, fetch from objects/)
4. If not: execute, store result, write ref
5. If dir exists but without output, it is either a failed or concurrent execution (prompt user to check logs and use `--force` to rerun if necessary)

This means:
- Changing inputs → new execution (cache miss)
- Changing module code → new task hash → new execution
- Re-running unchanged computation → instant cache hit
- User can handle failures manually

Note e3 MPV has no capability for the user to concurrently launch multiple tasks or dataflow (use `e3 start` to get it to handle this in a single process).
Possibly we should use a repository-wide lock file to handle this.

## Dataflows

A **dataflow** connects a task to dataset paths. Dataflows are defined inline in the package object (not separate objects).

```east
dataflows = {
    "train": (task = "train", inputs = ["inputs/sales"], output = "model"),
    "predict": (task = "predict", inputs = ["outputs/train/model"], output = "forecast"),
}
```

- `task` - name of a task in this package
- `inputs` - dataset paths to read
- `output` - name of output dataset (stored at `outputs/<dataflow>/output`)

In TypeScript:

```typescript
e3.dataflow("train", [sales], trainTask);
```

In future, we'll add the ability to destructure outputs to allow multiple named outputs.
We can similarly generalize inputs to enable different patterns, including scatter-gather tasks, etc.

### Running Dataflows

```bash
# Run all dataflows in a workspace (like `make`)
$ e3 start . production
[1/3] preprocess... done (0.5s)
[2/3] train... cached
[3/3] predict... done (1.2s)

# Watch for changes and re-run affected dataflows
$ e3 start . production --watch
Watching inputs/... (Ctrl+C to stop)
```

The full dataflow DAG is implicit - all dataflows in the package, connected by their input/output paths.

`e3 start` topologically sorts dataflows by their input/output dependencies and executes them in order. Cached results are used when inputs haven't changed.
With the `--watch` flag it will use inotify to watch for changed values (when an external process changes the workspace root dataset) and propagate them.

### Selective Execution

```bash
# Run a specific dataflow
$ e3 start . production train
```

### Project structure

This git repository is an npm workspace with the following packages:

 - **e3-types** - TypeScript types for e3 object and ref content (shared)
 - **e3-core** - Programmatic TypeScript API for interacting with e3 repositories (NodeJS)
 - **e3-cli** - CLI tool wrapping the above 
 - **integration-tests** - runs end-to-end tests using the CLI tool in a temp dir
