# The `execute` platform function

## Warmup - `eval`

To explain how this works, first consider `eval`. This will take some `IR` and evaluate it
and return the result. The `eval` function is special because it performs compilation.

Note that it is a good idea to make `eval` a platform function and not a builtin of East
because some platforms and runtimes (notably statically compiled code) would have trouble
compiling code during execution, and we want it to be easy to create East evaluators. As a
platform function, even a statically compiled platform could call out to a C compiler if it
wanted to, or the platform could simply not support `eval`.

Take the following code transformation:

```ts
// To use it in typescript
$(eval(ir, args...));

// Creates a platform function IR like this
variant("builtin", {
    type: ir.value.type,
    name: "BlobDecodeBeast2",
    type_parameters: [ir.value.type],
    arguments: [variant("platform", {
        type: BlobType,
        name: "eval",
        arguments: [
            ir,
            variant("builtin", {
                type: BlobType,
                name: "BlobEncodeBeast2",
                type_parameters: [StructType(Object.fromEntries(args.entries().map(arg => arg.value.type)))],
                value: Object.fromEntries(args.entries())
            }),
        ]
    })]
})
```

Note how we've used beast2 encoding to give our `eval` function two things:

 * The code is completely sandboxed - there are no "pointers" to values in the outside code.
 * The builtin is statically typed as `(ir: IR, args: Blob) => Blob`.

The second is necessary because we don't have "generic" builtin functions, and the first is a nice security boundary.
It would be "obvious" to extend `eval` with the ability to define what platform functions are available to the executed IR.

## Execute

Next up is our `execute` platform function. This one is like `eval` but more powerful and flexible.

 * It is asynchronous in nature.
 * It can spawn other tasks, threads, processes, VMs, worker nodes, AWS lambda function calls, etc to perform the execution and return the result.
 * It can be implemented locally or in a RPC-style architecture.
 * You can request features of the runtime it executes on (e.g. JavaScript/Python/Julia runtime)

```ts
// To use it in typescript
$(execute("julia", ir, args...));

// Creates a platform function IR like this
variant("builtin", {
    type: ir.value.type,
    name: "BlobDecodeBeast2",
    type_parameters: [ir.value.type],
    arguments: [variant("platform", {
        type: BlobType,
        name: "execute",
        arguments: [
            variant("value", {
                type: StringType,
                value: "julia",
            }),
            variant("builtin", {
                type: BlobType,
                name: "BlobEncodeBeast2",
                type_parameters: [IR],
                value: ir,
            }),
            variant("builtin", {
                type: BlobType,
                name: "BlobEncodeBeast2",
                type_parameters: [StructType(Object.fromEntries(args.map(arg => arg.value.type).entries()))],
                value: Object.fromEntries(args.entries())
            }),
        ]
    })]
}).
```

We might impose some requirements on the function being called, like that it only calls certain platform functions or has no captures.

## Syntax sugar

Being able to define the evaluated code inline might be a better experience!

```ts
eval($ => {
    // ...
})

execute("julia", $ => {
    // ...
})
```

Beyond that, the `execute` statement itself might be "hidden" from the end user by TypeScript functions that call it automatically.
For example, an interface like the following should be easy to create:

```ts
// Define a pipeline function
const pipeline = East.function(
  [ArrayType(FloatType)],
  FloatType,
  ($, rawData) => {
    // Step 1: Preprocess in Python
    // The `numpy_preprocess` function will spawn a python RPC
    const processed = $(numpy_preprocess(rawData));

    // Step 2: Compute in Julia
    // Compiler sees julia_optimize.runtime = "julia"
    // If current runtime != julia, dispatch inserted automatically
    const result = $(julia_optimize(processed));

    $.return(result);
  }
);
```

## Operational semantics

The execute function would "enqueue" the task and await it's return.

This is part of a proposal to use ZeroMQ to communicate between NodeJS, Python and Julia running on a single computer.
Note that the same semantics could be extended to run across a cluster of computers instead (at the cost of increased latency).

## Going from functions to IR

It would be a convenient extension to be able to grab the IR (and captures) of a live function.
Currently the `.toIR()` method on `FunctionExpr` is only useful if the expression is the function
definition (and not a reference to a variable containing the function, for example).

We could support that at runtime by tagging the function value with its IR and even its captures.
For example in our TypeScript compiler:

```ts
} else if (ir.type === "Function") {
    // ...

    const capture_names = ir.value.captures.map(v => v.value.name);
    const parameter_names = ir.value.parameters.map(v => v.value.name)
    return (ctx: Record<string, any>) => {
        const ctx2: Record<string, any> = {};

        const f = (...args: any) => {
          const ctx3 = { ...ctx2 };
          parameter_names.forEach((name, i) => ctx3[name] = args[i]);
          return compiled_body(ctx3);
        };

        for (const name of capture_names) {
            ctx2[name] = ctx[name];
            f[`capture_${name}`] = ctx[name];
        }

        return f;
      }
    }
} else if (...) {
```

We could then make grabbing a function's IR and/or captures a builtin function that works on
any `FunctionExpr`, and we can serialize any function - even closures!
