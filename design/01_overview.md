# East Exectution Engine Overview

The goal is to be able to run a single East function using multiple runtimes.
This will enable seemless usage of libraries and capabilities across NodeJS, Python and Julia.

## File and task based computation

The functionality will work using chains of tasks to represent larger computations, operating on data stored in your working directory.

Each task execution is an atomic program that reads a number of input files, performs some calculations, and writes out the results as files to disk.
A single task is run on a specific runtime.
With multiple tasks chained together, functionality available in different runtimes can be used in tandem.
It will be possible to arrange a simulation by Julia followed by some scikit-learn analysis by python.

## Low latency and local computing

The initial implementation will focus on low-latency execution on a single computer.

The dataflow is executed by a supervisor process, which spawns each task and martials the results.
The reesults can be computed as a once-off, like `make`.
This will reuse cached results to only run tasks on unseen input combinations, such that running it a second time would be nearly instant.
(Unlike `make`, we will cache historical computations and not just the most recent results).

This can also be done in "watch" mode, using `inotify` to watch for file changes and propagating changes downstream.
Whenever an input changes, depdendent tasks will be launched, which write outputs and trigger downstream jobs.
The process can track provenance to maintain internal consistency.

### Runners

Task executions are performed by runners.

The purpose of e3 is to execute East tasks, but e3 can also execute arbitrary commands.
In fact, each runner is defined by an arbitrary command (`exec` command and argument list).

### Tasks

Tasks have enough information to execute.
They define a runner, the IR to execute, the input and output types

### Executions

When a task is run on concrete inputs an execution is created.
The ID of the execution is a hash of its task definition, IR and inputs.
The logs and output of the task execution is are cached for later retrieval.

### Dataflows

A dataflow sets up automatic execution of tasks given a set of input files and locations to write one (or more) output file(s).
Multiple dataflows can be chained together (outputs to inputs) to create a larger dataflow DAG.
The dataflow DAG can either be executed as a once-off, or continually maintained in "watch" mode.

## Registry / Repository

We are proposing a lightweight, filesystem-based "registry" or "repository" to facilitate intermediate caching, registering entrypoints and output results.

### Result caching

Similarly by taking the SHA of the serialized IR plus all inputs, it is possible to cache (memoize) the results of any given execution.
This should speed up re-running of results drammatically, at the cost of having to serialize and store inputs and outputs to disk.
The ID of any given request or response can simply be the content hash.

### Registry

The simplest system I can think of roughly mirrors git (minus trees):

 - an `.e3/objects` directory with content-hashed (SHA256) filenames of (mostly .beast2) data files.
 - a `.e3/refs` directory with named "references" to entry points and their outputs (symlinks or hashes).
 - a CLI tool to interact with the registry, the working copy, tasks, dataflows, etc

