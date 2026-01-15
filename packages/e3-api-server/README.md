# @elaraai/e3-api-server

HTTP server for e3 repositories.

## Installation

```bash
npm install @elaraai/e3-api-server
```

## Overview

REST API server exposing e3-core operations over HTTP. Uses BEAST2 binary serialization for efficient request/response encoding.

## CLI Usage

```bash
# Start server on default port 3000
e3-api-server /path/to/repo

# Custom port and host
e3-api-server /path/to/repo --port 8080 --host 0.0.0.0
```

## Programmatic Usage

```typescript
import { createServer } from '@elaraai/e3-api-server';

const server = createServer({
  repo: '/path/to/repo',
  port: 3000,
  host: 'localhost',
});

await server.start();
console.log(`Server listening on port ${server.port}`);

// Graceful shutdown
await server.stop();
```

## API Endpoints

### Repository

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Repository status (path, object/package/workspace counts) |
| POST | `/api/gc` | Garbage collection |

### Packages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/packages` | List all packages |
| GET | `/api/packages/:name/:version` | Get package details |
| POST | `/api/packages` | Import package (zip body) |
| GET | `/api/packages/:name/:version/export` | Export package as zip |
| DELETE | `/api/packages/:name/:version` | Remove package |

### Workspaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workspaces` | List all workspaces |
| POST | `/api/workspaces` | Create workspace |
| GET | `/api/workspaces/:ws` | Get workspace info |
| GET | `/api/workspaces/:ws/status` | Get workspace status (datasets, tasks, summary) |
| POST | `/api/workspaces/:ws/deploy` | Deploy package to workspace |
| DELETE | `/api/workspaces/:ws` | Remove workspace |

### Datasets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workspaces/:ws/list` | List root dataset fields |
| GET | `/api/workspaces/:ws/list/*path` | List nested dataset fields |
| GET | `/api/workspaces/:ws/get/*path` | Get dataset value (BEAST2) |
| PUT | `/api/workspaces/:ws/set/*path` | Set dataset value (BEAST2) |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workspaces/:ws/tasks` | List tasks |
| GET | `/api/workspaces/:ws/tasks/:task` | Get task details |

### Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/workspaces/:ws/start` | Start dataflow (non-blocking) |
| POST | `/api/workspaces/:ws/execute` | Execute dataflow (blocking, returns result) |
| GET | `/api/workspaces/:ws/graph` | Get dependency graph |
| GET | `/api/workspaces/:ws/logs/:task` | Read task logs |

## Request/Response Format

All requests and responses use BEAST2 binary encoding with `Content-Type: application/beast2`.

Response bodies are wrapped in a variant type:
- `{ type: 'success', value: <result> }` - Operation succeeded
- `{ type: 'error', value: <error> }` - Operation failed

Error variants include:
- `workspace_not_found` - Workspace doesn't exist
- `workspace_not_deployed` - No package deployed to workspace
- `workspace_locked` - Workspace is locked by another process
- `package_not_found` - Package doesn't exist
- `package_exists` - Package already exists
- `dataset_not_found` - Dataset path doesn't exist
- `task_not_found` - Task doesn't exist
- `internal` - Internal server error

## License

BSL 1.1. See [LICENSE.md](./LICENSE.md).

### Ecosystem

- **[East Node](https://github.com/elaraai/east-node)**: Node.js platform functions for I/O, databases, and system operations. Connect East programs to filesystems, SQL/NoSQL databases, cloud storage, and network services.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Filesystem, console, HTTP fetch, crypto, random distributions, timestamps
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, S3, FTP, SFTP
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East Python](https://github.com/elaraai/east-py)**: Python runtime and platform functions for data science and machine learning. Execute East programs with access to optimization solvers, gradient boosting, neural networks, and model explainability.
  - [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience): TypeScript types for optimization, gradient boosting, neural networks, explainability

- **[East UI](https://github.com/elaraai/east-ui)**: East types and expressions for building dashboards and interactive layouts. Define UIs as data structures that render consistently across React, web, and other environments.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI styling

- **[e3 - East Execution Engine](https://github.com/elaraai/e3)**: Durable execution engine for running East pipelines at scale. Features Git-like content-addressable storage, automatic memoization, task queuing, and real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Git-like object store, task queue, result caching
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 init`, `e3 run`, `e3 logs` commands for managing and monitoring tasks
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 servers
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories

## Links

- [East Language](https://github.com/elaraai/east)
- [East Python Runtime](https://github.com/elaraai/east-py)
- [Elara AI](https://elaraai.com/)
- [Issues](https://github.com/elaraai/e3/issues)
- support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
