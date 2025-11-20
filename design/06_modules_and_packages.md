# Modules and Packages

First we discuss the neat and tidy world of modules.
Then, we'll see how to replace East "platforms" with runtime-provided modules.
Finally, we'll start working with packages and how packages and modules work with e3.

## Modules

A module is a unit of code.
Each programming language has a slightly different definition, but generally a module can depend on, or "import", other modules.
A module is "modular" in that consumers need only be aware of the interfaces presented by the module, not its implementation.

Depending on semantics, the graph of modules may have to be a DAG.
A "program" is generally defined by some a kind of root module (a "script" might be considered a root module, or the language expect a `main` function or module).
All language compilers/runtimes detect when a module is imported twice (say in a "diamond dependency") and deduplicate the code / use a shared reference to the same module - this is a key part of the "modularity".
This effectively makes modules either completely immutable, or having global shared state.

### Examples

Here eare some examples of modules in various languages, of various complexity:

 * **JavaScript**: Modern JS modules are just scripts with `import` and `export` statements. The script is executed eagerly the first time it is `import`ed, and the exports are memoized. Some features (like having both `export` and `export default`) exist only for backward compatiblity with concepts that existed in CJS modules (which were messier).
 * **Python**: Python modules are `.py` files and work similarly to modern JS modules (they are script that are executed the first time they are imported). Everything inside a module is public / exported.
 * **Rust**: Inside a package (crate), the modules may have circular dependencies and are compiled as a single unit. The compiler works in two passes - it first examines the toplevel declarations (e.g. types, function signatures), then analyses the body of functions with this information.
 * **Zig**: Zig compiles entire programs as one unit, and modules can have circular dependencies. Any given file can have `@import` statements and one file is the "root" statement statements. Each module exports a "struct" of the declarations marked `pub`. The compiler works in two passes - the first pass just identifies the names of things at toplevel scope, and then compiler only analyses code that is reachable from the root module.
 * **Julia**: Modules are first-class values, decoupled entirely from files. They behave like a "dynamic struct" where new fields can be added at runtime, and each module has a "parent" module (which can be itself). Since Julia is a dynamic language, you can construct circular references between modules, and the compiler just treats them as namespaces (not separate units of compilation).
 * **C**: In C, each unit of compilation (each call to `cc`) is a module. Modules can be "linked" into bigger modules - though they share a global namespace! The `.h` header files provide _just_ enough information to perform typechecking across (statically or dynamically) linked modules, without using an import system. A module can either be a root module (with `main`) or a non-root module.

### Modules in East

For East, I think we just want the simplest thing known to work well (no two-pass compilation, no linking, no first-class modules, no "public everything", and no shared global namespace).
I propose the following:

 1. A user-defined module is a script that runs the first time it is imported, and returns (or exports) a single value.
 2. A user-defined module can be represented by some IR for that code.
 3. There can also be platform- or runtime-provided modules, used to inject capabilities (native functions) from the host.
 4. The language has an `Import` IR node.
 5. An `Export` IR node is unnecessary - the value returned by the module's IR is the export. (A module writer would typically provide a struct of functions and constants).
 6. On `Import`, it is the job of the compiler/runtime to "resolve" the imported module, run it, and memoize it as necessary.
 7. No "global" variables - even the stdlib gets imported.

Semantically, East behaves like a scripting language such as JS or Python, but with a sound type system.

### Module resolution

When you type `import foo from './foo.js'`, `import fs from 'node:fs'` or `import bar from '@foo/bar'` in JavaScript, the runtime needs to resolve what that string _means_, then find and provide the correct module to the JS engine. In practice we see three kinds of modules:

 1. A user-defined module in a local file.
 2. A platform module, like `node:fs`.
 3. A package from an external package manager.

With the third we can see the line between "self-contained programming language" and the tooling _around_ the language (the external package manager) gets blurred.

In East, we can at the least use variants to declare the resolution mechanism - `import(.file "./foo.east")` vs `import(.platform "fs")`.
Probably a generic `.package "string"` format would be sufficient for the third option, and let the runtime deal with that as necessary?

### IR modules

Now, we don't currently _have_ East source code files.
That's OK - even if we did, it would make sense for a front-end compiler to compile the root module _and_ any modules it imports to IR.
It is not the job of the runtime (in Julia or Python, say) to create IR - it consumes IR.

So the `Import` IR node with the `.file "path"` variant would be defined to load IR from a file.
I'd suggest it accepts relative paths, and decodes `IR` based on the extensions such as `.beast2`, `.east` and `.json`.
The file for module `foo` might be named `foo.ir.beast2`, or something.
In future there is nothing stopping us having `.file "https://example.com/foo.ir.beast2"` working in runtimes that support that.

### Expression builders and user-defined modules

How do we define a module with our TypeScript `Expr` builders that we can import later?
Easy - don't!

A module is just an expression.
So, we create an `East.import` function that accepts any `Expr` and creates an `Import` AST (and wraps in `ExprType<T>` for the imported type `T`).
The AST created holds an in-memory reference to the `Expr`.

When it comes time to convert AST to IR, we now have different compilation options:

 1. We return a single IR. We detect each unique import (using `===` on the imported `Expr`s) and sort them in topologic order to get the dependencies right. We return a `Block` IR that defines each in turn, and replace the `Import` AST nodes with references to these variables.
 2. We return a separate IR for each module. As a part of this, we need to give a filename to each - for example by returning a `Map<string, IR>` and using the map's key in the `.file "key"` import filename. These could just be placeholders for now - intended to be overwritten upon saving the IR to disk.
 3. We extend 2 above and save directly to disk in a form compatible with e3 - save each IR as .beast2, name it via its SHA256 hash, use that name where it is imported,  

Option 1 is actually kinda fine if the user can access the source code of all the modules they want to import, but won't work where we want to link it with unknown code by the runtime. I actually think it is best if the language front-end "inlines" (and deduplicate) local imports eagerly.

That leaves runtime and package modules in the IR, for the runtimes to handle.

## Platform modules

Each platform provided module has an associated `.ts` we maintain (even for Python or Julia platform-provided modules).
It exports the appropriate `Import` AST which imports from `.platform "foo"` and has the appropriate type.
(That type is likely to be a struct of functions - the set of functions provided by that module).

We need typescript definitions to help the runtime.


## Package management

**New rules: the frontend resolves local modules, the runtime is responsible for loading packages.**

Two types of packages

 1. East packages
 2. Platform packages

### Packages and e3

While modules are an East concept, packages will be coupled to e3.
The e3 repository is a good place for storing and finding package contents.

### Package registries

We should support easy installing of packages from the internet, via a package registry.
This should also be flexible:

 1. Easy to mirror behind a filewall, cache for CI, etc.
 2. Simple to have private registries.

The core idea is that one e3 repository can copy from another.
Each repository would be configured with an ordered list of registries.
You can add one and use it like:

```bash
# Add registries
e3 registry add epm git+https://github.com/elaraai/epm  # Elara Package Manager
e3 registry add epm ~/my_registry

# Update a registry
e3 registry update
e3 registry update epm

# Add a package
e3 package add python-ml  # platform package
e3 package add foo        # east package

# Upgrade a package
e3 package upgrade python-ml

# Remove a pakcage
e3 package remove python-ml
```

The lowest development effort possibility is hosting a git repository at `github.com/elaraai/epm`.
It will work well but get slower as it fills up.

You can of course just create a package + metadata and add them directly, without a registry.

### Platform packages

Platform packages depend on a runtime.
Each runtime uses its own package manager to obtain dependencies (`npm`, `uv`, `Pkg`).
Each platform package targets exactly one runtime (though we might copy the same interface for multiple runtimes, like `node-logging`, `python-logging`, `julia-logging`).

For example we might have metadata for a `python-ml` package like this:

```
.platform (
    name = "python-ml",
    version = (major=2, minor=3, patch=1), // v2.3.1
    runtime = "python",
    metadata = {
        // fields for uv.sources
        "git": "https://github.com/elaraai/east-python-ml",
        "rev": "5dfa455554e7c225a59c865d706c4293ca2c132e", // or git tag
    },
    export_type = StructType([
        // ...list of exported functions
    ])
)
```

You can install it directly into an e3 repository (without going through a registry) using `e3 package install`:

```bash
e3 package install ./python_ml_metadata.east
e3 package install ./python_ml_metadata.east --version 2.3.1
```

Since this is a platform package, it will install it in our runner's virtual env for python using `uv`.
The above file will be hashed and inserted as an object.
A ref at `.e3/refs/packages/platform/python/python_ml` will be created or updated to point at the object.

This `install` command could be performed on an upstream registry repository.
Then, users downstream can simply type `e3 package add python-ml`.

### East package

An East package is IR plus metadata, provided in the form:

```
// Foo-1.1.0-package.east
.east (
    name = "Foo",
    version = (major=1, minor=1, patch=0), // v1.1.0
    runtime = .None, // meaning "any" - could also be `.Some "python"`
    dependencies = {
        "Bar": (major=2, minor=0, patch=1), // v2.0.1
    },
    ir = "123abc...789", // SHA256 of Foo's ir.beast2 file
    export_type = ...,
)
```

Then there might be a neighboring `Foo.1.1.0-ir.beast2` file for the IR.
We can probably have TypeScript helpers work along the lines of this:

```ts
import East from '@elaraai/East';
import e3 from '@elaraai/e3-sdk';
import bar_pkg from 'awesome-bar';

// Define our package module (note that a "module" is more like a block than a function)
const foo_expr = East.block($ => {
    const bar = $.import(bar_pkg); // includes types, etc

    // .. define our package contents here
});

// Create a package from the Expr with a name and version
const foo_pkg = e3.package(foo_expr, "Foo", 1, 1, 0);

// Save to disk in e3-compatible format
foo_pkg.save("./Foo-1.1.0-package.east", "./Foo-1.1.0-ir.beast2");
```

This creates both files and keeps them consistent with each other.
(In the above, the dependencies and their versions were automatically determined from the import of `bar_pkg`).

An alternative interface that might be better is:

```ts
import East from '@elaraai/East';
import e3 from '@elaraai/e3-sdk';
import bar_pkg from 'awesome-bar';

// Define our package code (note that a "module" is more like a block than a function)
const foo_pkg = e3.package([bar_pkg], ($, bar) => {
    // .. define our package contents here
});

// Save to disk in e3-compatible format
foo_pkg.save("./Foo", 1, 1, 0);
```

If this package is not intended to be run directly, you can now install it in a e3 repository so it may be imported later:

```bash
e3 package install Foo-1.1.0-package.east Foo-1.1.0-ir.beast2
```

or programmatically in typescript:

```ts
// Or programmatically add to my local repository
foo_pkg.install("./Foo", 1, 1, 0, "~/.e3")
```

These add the package description and IR as a content-addressed object to the repository.
Finally, a ref at `.e3/refs/packages/east/foo/1/1/0` will be created or updated to point at the description object.

### Resolving dependencies

The "resolved" package is a lockfile or manifest.
We use semver - when "resolving" the greatest available version with the same major version number is used.
We can have an `e3` low-level utility for resolving a package description with respect to the locally installed packages and possible packages that could be installed from other registries.

```bash
e3 package resolve ./Foo-1.1.0-package.east
```

The resolved package has the form:

```
// Foo-1.1.0-lock.east
.east (
    name = "Foo",
    version = (major=1, minor=1, patch=0), // v1.1.0

    // Dependencies' platform packages depend on python
    runtime = .Some "python",

    // Bar depends on Frob, so Foo depends on both
    dependencies = [
        // Topologically sorted in dependenxy order
        (name="Frob", major=0, minor=1, patch=0), // v0.1.0
        (name="Bar", major=2, minor=0, patch=1), // v2.0.1
    ],

    // Dependencies use the platform packages
    platforms = {
        "python-console": (major=1, minor=0, patch=0), // v1.0.0
        "python-ml": (major=2, minor=3, patch=1), // v2.3.1
    },

    // These IRs need to be loaded to run this package
    irs: [
        // Topologically sorted in load order
        "e662f9...a1f", // SHA256 of Frob's ir.beast2 file
        "f298a1...062", // SHA256 of Bar's ir.beast2 file
        "123abc...789", // SHA256 of Foo's ir.beast2 file
    ],
)
```

Everything about this package is now locked down and defined.

You can install a resolved East package locally via commands like:

```bash
e3 package install --resolved Foo-1.1.0-lock.east Foo-1.1.0-ir.beast2
e3 package install --resolve Foo-1.1.0-package.east Foo-1.1.0-ir.beast2
```

These will first add any missing dependencies using registries, starting with platform packages followed by the list of East packages.
When all requirements exist in the local .e3 directory, we'll then add the package and package-lock definitions as a content-addressed object to the repository.
Finally, a ref at `.e3/refs/packages/east/foo/1/1/0` will be created or updated to point at the object.

### Using packages

Here's an example of using a closed-source platform module:

```ts
import ml_pkg from '@elaraai/east-python-ml';

const FeatureType = Struct({ /* features */ });
const OutputType = StringType;

// Train a ML model and make some predictions
export default East.function([Array{FeatureType}, ArrayType{OutputType}, ArrayType{FeatureType}], ($, train_x, train_y, pred_x) => {
    const ml = $.const(ml_module);

    const trained_model = $.const(ml.train(train_x, train_y));

    $.return(ml.predict(trained_model, pred_x));
})
```

### Task packages

Any package that returns a `FunctionType` can be a task.

While "running" any package returns a well-defined result, the only way to provide "inputs" is if we are calling a function and providing arguments.

### Running tasks

When a task package is to be executed by a runtime:

 1. It reads the resolved package description.
 2. It verifies the runtime matches.
 3. It verifies the loaded platform versions are match _or_ are compatible with what the package requires (same major version, same or higher minor.patch version).
 4. It gets all the package IRs from e3 and compiles them (or uses precompile cache for hash).
 5. It executes the IR by running them in the provided order, and dealing with imports appropriately.
 6. It returns the final result.

We could make it a requirement to install or add a task package, rather than directly from IR?

### Upgrade chains

Note that sometimes it may be necessary to upgrade your dependencies several levels deep.
We don't want to invest too much time dealing with version resolution (it is a tricky area).

We should be able to upgrade the dependencies of a currently locked package via CLI:

```bash
# Get latest upstream versions
e3 registry update

# Unlock Foo@1.1.0 and resolve the dependency tree with the latest compatible versions
e3 package upgrade-deps Foo@1.1.0
```

### Effects, async and platform function

Our "effect tracking" system currently tracks the names of platform functions called in `Platform` IR nodes.
However, I don't think this will work with e3 packages.
The only `Platform` IR node that an `e3` runner needs to provide is the one to import packages.
The platform packages will then present themselves as `FunctionType` values to be `Call`ed.

A better system would be to attach a set of "effects" to each function, decoupled from the `PlatformIR` names.
These can then be runtime-specific.
For example, `node-console` won't need effects but `node-fetch` functions may have the `"async"` effect.
These can propagate in the usual way and the compiler can directly check for `"async"` when deciding how to compile an IR node.

### Generic functions

The package and module system described here highlights one weakness of East.
We do not have any ability to define generic functions - for example, functions with type parameters.

#### The problem

Currently East uses a form of metaprogramming that has access to the types as it goes.
This is a form of compile-time dependent typing, similar in power to Zig's generics or Julia's `@generated` functions.
It means we can create easy-to-use interfaces in TypeScript that are flexible in their input types.

The language builtins are parameterizable by types, but every user-defined East function needs to have a concrete input and output type.

#### Call-site specialization

Generic functions require what is known as "call site specialization".
When the function is called with concrete types, we can then infer the output type (and effects performed).

#### Type parameters

We need a way to declare how a function is typed given some inputs.
One possibility is that the output type could be an arbitrary function of the argument types.
A more popular choice is to use type parameters to constrain the relationship in a reasonable way.

Given this is how the builtins work, it would make sense for our user-defined functions to also use type parameters.
It is an open question if we can get TypeScript to apply the type parameters to generic user-defined functions appropriately or not.
(This should only affect `call`).

One difficulty might be with the type parameter to builtins like `Parse`, which govern the output type but is not inferrable from the input.
We'd have to give users access to type parameters, and then have the system populate them downstream.

#### Front-end or back-end?

Does call-site specialization occur at the front end or the back end?

For example, does AST support generics / type parameters but IR not? It would make implementing runtimes easier. The logic could all live in the `ast_to_ir` transformation.

Unfortunately this defeats the purpose of exporting generic functions as IR from "library packages" and not linking them together until runtime.
So the type parameters **must** propagate through the IR.
We may need to add an IR node to denote specialization.

#### Precise effect tracking

One advantage of call-site specialization is that the effects like `async` would be able to be tracked precisely in all circumstances.

## Dev plan

Zero to package proof-of-concept:

 1. Add types for package descriptions.
 2. Update `e3 init` to create the package dirs.
 2. Add the `e3 install` command for East packages.
 3. Add the `e3 resolve` command, `e3 install --resolve`.
 4. Allow `e3 run` to target function packages.
 5. Test e2e
 6. Allow `e3 install` to work for node runtime/platform packages, set up `.e3/node/node_modules` dir or similar.
 7. Test an installed platform function.
