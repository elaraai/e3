# @elaraai/e3

SDK for authoring e3 packages.

## Installation

```bash
npm install @elaraai/e3
```

## Example

```typescript
import e3 from '@elaraai/e3';
import { StringType, East } from '@elaraai/east';

// Define input datasets with default values
const input_name = e3.input('name', StringType, 'World');
const input_prefix = e3.input('prefix', StringType, 'Hello');

// Define a task that combines inputs
const greet = e3.task(
  'greet',
  [input_prefix, input_name],
  East.function(
    [StringType, StringType],
    StringType,
    ($, prefix, name) => East.str`${prefix}, ${name}!`
  )
);

// Chain tasks - output of one feeds into the next
const shout = e3.task(
  'shout',
  [greet.output],  // reads from previous task's output
  East.function(
    [StringType],
    StringType,
    ($, greeting) => greeting.upperCase()
  )
);

// Create and export the package
const pkg = e3.package('greeting-pkg', '1.0.0', shout);
await e3.export(pkg, 'dist/greeting-pkg-1.0.0.zip');
```

This creates a package with:
- `.inputs.name` - String input (default: "World")
- `.inputs.prefix` - String input (default: "Hello")
- `.tasks.greet` - Combines inputs into greeting
- `.tasks.shout` - Transforms greeting to uppercase

## API

- `e3.input(name, type, default)` - Define an input dataset
- `e3.task(name, inputs, fn)` - Define a task with East function
- `e3.package(name, version, task)` - Create a package (dependencies collected automatically)
- `e3.export(pkg, path)` - Export package to zip file

## Related Repos

- **[east](https://github.com/elaraai/east)** - East language core
- **[east-node](https://github.com/elaraai/east-node)** - Node.js runtime and platform functions
- **[east-py](https://github.com/elaraai/east-py)** - Python runtime and data science

## About Elara

e3 is developed by [Elara AI](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses. e3 powers the execution layer of Elara solutions, enabling durable and efficient execution of East programs across multiple runtimes.

## License

Dual AGPL-3.0 / Commercial. See [LICENSE.md](./LICENSE.md).
