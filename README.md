# East Execution Engine (e3)

e3 is an automated, durable execution engine for [East](https://github.com/elaraai/east) programs with cross-language runtime support.

## Packages

| Package | Description | npm | License |
|---------|-------------|-----|---------|
| [`@elaraai/e3`](packages/e3/) | SDK for authoring e3 packages | [![npm](https://img.shields.io/npm/v/@elaraai/e3)](https://www.npmjs.com/package/@elaraai/e3) | [![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](packages/e3/LICENSE.md) |
| [`@elaraai/e3-types`](packages/e3-types/) | Shared type definitions | [![npm](https://img.shields.io/npm/v/@elaraai/e3-types)](https://www.npmjs.com/package/@elaraai/e3-types) | [![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](packages/e3-types/LICENSE.md) |
| [`@elaraai/e3-core`](packages/e3-core/) | Core library (like libgit2 for git) | [![npm](https://img.shields.io/npm/v/@elaraai/e3-core)](https://www.npmjs.com/package/@elaraai/e3-core) | [![License](https://img.shields.io/badge/license-BSL--1.1-orange.svg)](packages/e3-core/LICENSE.md) |
| [`@elaraai/e3-cli`](packages/e3-cli/) | Command-line interface | [![npm](https://img.shields.io/npm/v/@elaraai/e3-cli)](https://www.npmjs.com/package/@elaraai/e3-cli) | [![License](https://img.shields.io/badge/license-BSL--1.1-orange.svg)](packages/e3-cli/LICENSE.md) |

## Features

- **Content-Addressable Storage** - Git-like object store with automatic deduplication
- **Automatic Memoization** - Cache results based on function IR and arguments
- **Durable Execution** - Tasks are queued and executed to completion
- **Real-time Monitoring** - Stream logs from running tasks
- **Type-Safe RPC** - Beast2 binary encoding for efficient data transfer

## Quick Start

```bash
# Initialize repository
e3 init

# Submit a task
e3 run pipeline ./pipeline.east ./data.east

# Watch logs in real-time
e3 logs pipeline --follow

# Get result
e3 get pipeline

# List all tasks
e3 list
```

## Repository Structure

```
.e3/                          # e3 repository (like .git/)
├── objects/                  # Content-addressable storage
│   └── ab/cd1234...beast2    # IR, args, results, commits
├── logs/                     # Streaming task logs
│   └── abc123...eastl        # One log per task_id
├── queue/                    # Task queues (watched by runners)
│   └── node/
├── refs/tasks/               # Named task references
└── tasks/                    # Task state (task_id → commit_hash)
```

## License

This project uses multiple licenses:

| Package | License |
|---------|---------|
| `@elaraai/e3` | Dual AGPL-3.0 / Commercial |
| `@elaraai/e3-types` | Dual AGPL-3.0 / Commercial |
| `@elaraai/e3-core` | BSL 1.1 |
| `@elaraai/e3-cli` | BSL 1.1 |

**BSL 1.1 (Business Source License):**
- Non-production use (evaluation, testing, development) is free
- Production use by or on behalf of for-profit entities requires a commercial license
- Code becomes AGPL-3.0 four years after each release

See [LICENSE.md](LICENSE.md) for full details.

**Commercial licensing:** support@elara.ai

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

Contributors must sign our [CLA](CLA.md) before we can accept pull requests.

## Links

- [East Language](https://github.com/elaraai/east)
- [East Python Runtime](https://github.com/elaraai/east-py)
- [Elara AI](https://elaraai.com/)
- [Issues](https://github.com/elaraai/e3/issues)
- support@elara.ai
