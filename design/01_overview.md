# East Exectution Engine Overview

The goal is to be able to run a single East function using multiple runtimes.
This will enable seemless usage of libraries and capabilities across NodeJS, Python and Julia.

## Seemless RPC-style calling

The functionality will work using a platform-provided RPC-style calling capability.
It will not be possible to get, say, a function "pointer" from one language executing natively in another.
But it will be possible to request a simulation by Julia followed by some scikit-learn analysis by python.

## Low latency and local computing

The initial implementation will focus on low-latency execution on a single computer.
RPC requests and responses will be brokered by `inotify`, and IR and arguments encoded in our beast2 binary format.
The IR and arguments will be stored on disk and enqueued messages would contain the relevant filenames in requests and repsonses.

To begin with we consider a single worker for each process.
Each worker will use a ROUTER-DEALER pattern with internal concurrency for request handling.

### NodeJS

A single process subscribes to a repository by watching for messages in the `<repo>/queue/node/*` directory.

When a subtask is required, it spawns a new request and a promise awaits for a response.
We wait and keep state in memory, but can asynchronously perform other tasks.

### Julia

A single process subscribes to a repository by watching for messages in the `<repo>/queue/julia/*` directory.

Each request can be `Threads.@spawn`ed onto a thread and Julia will be started with a command like `julia +1.12 -t4,1` for 4 worker threads and 1 interactive thread (to watch for messages and place on channels).
Each request works in its own memory (no mutable objects alias between requests) so we do not need to worry about atomics, etc.

When a subtask is required, it spawns a new request and `Channel`, and waits for a response.
We wait and keep state in memory, but can asynchronously perform other tasks.

### Python

Follows a similar pattern, using python's async (and possibly multithreading?) interfaces.

### Failures

The returned message could either be successful or an error.

We want to be able to proagate EastError up the chain to callers.
Furthermore, there are timeouts and crashes to consider.

### Memoization

If a request IR has been seen before, the already compiled function can be reused.

If a request IR and arguments have been seen before, and no error occurred, memoized results can be returned.
However, we need to be careful that we aren't performing externally visible and non-idempotent side-effects for this to be correct.

## Registry

We are proposing a lightweight, filesystem-based "registry" to facilitate intermediate caching, registering entrypoints and output results.

### Compilation caching

By taking the SHA256 of serialized IR, it is possible to cache any compiled functions.

### Result caching

Similarly by taking the SHA of the serialized IR plus all inputs, it is possible to cache (memoize) the results of any given execution.
This should speed up re-running of results drammatically, at the cost of having to serialize and store inputs and outputs to disk.
The ID of any given request or response can simply be the content hash.

### Registry

The simplest system I can think of roughly mirrors git (minus trees):

 - a directory with content-hashed (SHA256) filenames of .beast2 data files.
 - a directory with named "references" to entry points and their outputs (symlinks or hashes?).
 - a CLI tool that will copy in an entry point (and put a message on ZeroMQ to run it), can fetch outputs, clear the cache, etc.
 - workers receieve messages on ZeroMQ, read inputs and write results.

The initial message might need the user-facing "name" of the entrypoint in it, so it can symlink the results when done.
The ELARACore system supports multiple-output functions, and it might be possible to support multiple named outputs per entrypoint here too.
We'll probably need a story around persisting logs and error results too.
