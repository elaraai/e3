# Data and dataflow

Our priority is to get an excellent local-first system working now, that will work well as a hosted server and able be transformed into a distributed system as necessary.
The ideas below follow a unix-style philosophy for simplicity.

## Datasets are files

E3 is an execution engine, where the `.e3` directory stores metadata about tasks and executions (historical, current or potential).
Like `.git`, this directly isn't designed to be looked at directly by users.
Instead, people keep their "working copy" outside of `.git`, and use the `git` CLI to sync or commit their working copy to the repository.

Similarly, the current "working copy" of data in e3 will live outside the `.e3` directory.
The `e3` CLI tool will be the interface between the working copy and data stored inside `.e3`.
The `.e3` directory becomes more of a cache that helps out in the background.

### Example: ad-hoc executions

This means that running ad-hoc code simply involves files in your working copy.
You can run a command like the below interactively:

```sh
e3 run my_task ./input1.east ./input2.beast2 -o ./output.east
```

This would ingest the inputs as content-addresssed objects in `.e3/objects` and the system
can check if the task has already run. If so, it can write the cached result to the output path.
If not, the task will run with the logs streaming to `stderr`, and if successful the the result will be cached in `.e3` and written to the output path.
The `run` command would not "register" any named dataset (for input or output).

There would be a `e3 run --force` to make it ignore the cache, rerun the task, and overwrite the cached result if necessary.
This caching will fail if the underlying runtime changes (e.g. if a bug was fixed).

There would also be a `e3 run --detach`.
This would setup the task, write the `task_id` (a hash of task and inputs) to `stdout`.
It would the launch the task as a background process with the logs streaming to the path in `.e3` where they can be looked up later, e.g. by `edk logs task_id`.

I'd like to add a way to "destructure" a struct into multiple files.
For ad-hoc tasks, we'd need a way to specify this on the command line, maybe something like this to save the `x` and `y` fields using "keypath" syntax:

```sh
e3 run my_task ./input.beast2 --save .x x.east --save .y y.east
```

Eventually this could support destructuring collections (e.g. save the values in an array to separate files), as well as taking multiple input files to construct a single input argument (see discussion on globbing below).

### Git-like branching and versioning

While the `.e3` structure would allow for a git-like system of maintaining multiple versions (or branches) of datasets, config, etc, I think it makes sense to allow `git` itself to manage this regard.

As a part of this, it would perhaps be best if data designed to be reproduced across computers lived outside the `.e3` directory, while `.e3` was mostly a cache of historical executions and other metadata that could be reproduced from the working copy. Users could add `.e3` to their `.gitignore` file and the repository should be able to be reproduced in full.

For example, `e3` configuration should live as plain files outside the `.e3` directory. (Anything that needs to be "imported" into `.e3` can happen automatically upon `e3 init` in a directory already containing such configuration).

## Task executions are processes

In this model, each task execution gets its own process.
While a persistent process may be "hot" and have lower latency, separate processes are signficantly easier to manage.
(Getting e3 to farm out tasks to persistent workers is something that can be added later).

### Logging

This means it should be pretty easy to manage task logging.
It will look for logs at `.e3/logs/<task_id>`.
When starting a task it can pipe `stdout`/`stderr` to that location.
We can save the process's `pid` at `.e3/process/<task_id>` or else insert it into the top of the log file.
That way the CLI would be able to see if a task is still running, has produced data, etc, via the `task_id`.

### Processes are arbitrary

While e3 is designed as an "East Execution Engine", there is nothing stopping it from launching arbitrary processes as tasks.
It might be extremely useful to run an arbitrary tool locally, especially as one step of a larger dataflow.
In a deployed server, the process could be sandboxed in docker or firecracker.

### East runners are specific processes

Our East-based tasks will just be specific instances of arbitrary process-based tasks.
The NodeJS / Python / Julia East runtimes will be expected to exist on the machine hosting the e3 repository.

We'll create a CLI entrypoint for each runtime.
The first input is the path to the function IR to run, followed by arguments:

```sh
east-node my_func.ir.beast2 input1.east input2.beast2 -o output.beast2 > logs.stdout 2> logs.stderr
```

This starts, loads and compiles the IR, loads the inputs, runs the program, saves the output with the logs going to a separate file.

### Configuring runtimes

We should embrace file-based configuration (things like `package.json`) to manage the behavior of the runtimes.

We can copy the datetime token string to reconstuct command line arguments.

```
// e3-runners.east
[
    .east (
        name = "east-node",
        command = [
            .literal ".e3/runtimes/east-node/bin/east-node",
            .ir_path,
            .input_paths,
            .literal "-o",
            .output_path
        ],
    ),
    .east (
        name = "east-python",
        command = [
            .literal "./e3/runtimes/east-python/bin/east-python",
            .ir_path,
            .input_paths,
            .literal "-o",
            .output_path
        ],
    ),
    .generic (
        name = "zip",
        command = [
            .literal "zip",
            .output_path
            .input_paths
        ],
        result_is_stdout = false,
    ),
    .generic (
        name = "ls",
        command = [
            .literal "ls",
            .input 0, // the path to run `ls` in
        ],
        result_is_stdout = true,
    ),
]
```

On `e3 init` the `east-node` runner would be configured automatically (pehaps simply as `east`?).

### Runtime packages and `e3 pkg add`

I think we should make the packages be a little more general than discussed so far.
A package should be able to run an ad-hoc task (processes, i.e. shell commands) when installed or uninstalled.
For example, an `npm` or `uv` command to install.

They will also be able to define entries in `runners.east`, so we can install the base runner as a package too!

That way the system dependency to install `east-node` is `npm`, the system dependency to install `east-python` is `uv`, and for `east-julia` it is `juliaup`.
The user would need access to both the package definition and the resources required for installation.
For example, if `https://github.com/elaraai/east-py` is a private repository, then you need sufficient permissions to install it.

The commands would always be executed with a CWD of that containing the `.e3` directory.
So we can for example place our `node_modules` at `./e3/runtimes/east_node/node_modules`, etc.

When a user adds more e3 packages later, such as `east-python-ml` after `east-python`, they might add `uv` packages in that same directory.
Another thing a package definition will need to define are "extensions" - some way to pipe information about the existance of `east-python-ml` to `east-python` so it knows to load the extension (there are lots of ways to approach this).

### Package metadata

The installed package definitions could live at `./e3-packages`.
For a package named `foo`, there would be a file at `./e3-packages/foo.east` with the package metadata.

Running `e3 init` on a directory containing `./e3-packages` would result in those packages getting installed (downloaded, post-execution scripts run, etc).

### Modules

If the package is an East module then we'd expect a file containing IR at `./e3-modules/foo.ir.beast2`.
In fact, we might allow a given package to install any number of modules, at `./e3-modules/foo/*`.

### Tasks

We may need

### Running tasks from modules

If a module is an East function, then it can be ran with `e3 run <module_name>`.

## Data flow tasks

Finally, we can add the ability to define "dataflow tasks" that watch a named input and reactively updates a named output.
Like ELARACore, we can simply call these "tasks".

```bash
# function module named f, existing dataset at ./x.east, new dataset at ./y.beast2
e3 dataflow add my_task f x.east -o y.east
```

This will add a config file at `./tasks/my_task.east` containing the metadata to define:

 * The input file locations
 * The output file locations
 * The execution (runner, function module, etc)

An obvious extension is to allow multiple outputs (particularly if the output is a struct, you should be able to save a file for each field).

### Executing dataflow

To run the dataflow to completion, simply type:

```sh
e3 go
```

This will work somewhat like `make`.
The tasks in `./tasks/*` will be read in and topologically sorted.
They will then be executed in order.

Any task whose input is changed will be ran, showing the logs in real time.
Tasks whose inputs have been seen before will not not need to execute (though the working copy will be kept in sync with the cached outputs).

We can support a variety of switches here

```sh
# only run some dataflow tasks
e3 go --filter foo*

# run up to 4 tasks in parallel
e3 go -j 4

# run everything ignoring cached values
e3 go --clean
```

#### Internal consistency

From this, we get internal consistency for free.
Any time `e3 dataflow go` runs (and does not error or stop prematurely), every output is derived from an input.
Out-of-date tasks are reran (if the East IR changes, as it is content hashed, but not necessarily the if the runtimes change).

### Real-time dataflow

In future we could spin up a `e3 dataflow watch` command to propagate the dataflow in real-time, like an ephemaral task manager.
This can work reasonably easily via inotify, etc.

For real time dataflows, we should ensure the "source versions" of the input data are consistent like we do in ELARACore.
These could simply be stored in RAM, and reconstructed whenever `e3 dataflow watch` is ran again.
That way we can make sure no task is executed with inconsistent inputs (creating errors or incorrect results).

### Pachyderm-style globbing

Pachyderm allows for some useful glob patterns in the dataflow:
```bash
# watch a whole "directory" of inputs, produce an output for each
e3 dataflow add f inputs/$1 outputs/$1

# multiple glob patterns, can be reordered (group by month instead of by state)
e3 dataflow add f state/$1/month/$2 month/$2/state/$1

# aggregate everything in inputs/ into... a dictionary?
e3 dataflow add f ...inputs/ output

# explode the output (dictionary?) into a whole set of named outputs
e3 dataflow add f input ...outputs/
```

#### Untyped directories

One way of managing this is simply taking each "directory" as a `Dict<String, T>` with the string being the component of the string (minus file extensions for `.beast2` etc).

#### Typed directories

Instead of having simple "directories", each structure would have to be an array, set, dict, variant or struct (the root is a struct).
Each directory name would correspond to the index/key/case name/field name (via an `East.print` and escaping slashes).
We'd need to define the "type" of directory up front in the dataflow config.

#### Destructuring

An import part of this will be destructring a single output into multiple files.

We'll need to take care for example that variant cases could be named to different file locations.
If we do that then the dataflow can do different things in different cases - essentially allowing for arbitrary "control flow".

#### Loopy tasks

I think with variant destructuring, you could implement "loopy" or recursive tasks.
