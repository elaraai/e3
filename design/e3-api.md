# e3-api: Remote API Server and Client

e3-api-server exposes e3-core operations over HTTP, enabling remote CLI commands and programmatic access. e3-api-client provides a TypeScript client library that mirrors e3-core's API.

## Overview

Two packages:
- **`@elaraai/e3-api-server`** - HTTP server wrapping e3-core
- **`@elaraai/e3-api-client`** - Client library for remote e3 operations

### Architecture

```
┌─────────────────────┐         HTTP/SSE          ┌─────────────────────┐
│   e3-api-client     │ ◄────────────────────────► │   e3-api-server     │
│                     │                            │                     │
│  - start()          │   POST /api/start          │  - HTTP server      │
│  - status()         │   GET  /api/status         │  - SSE broadcaster  │
│  - packages.*       │   GET  /api/executions/... │  - Execution mgr    │
│  - workspaces.*     │                            │                     │
│  - datasets.*       │                            │                     │
└─────────────────────┘                            └─────────────────────┘
                                                            │
                                                            ▼
                                                   ┌─────────────────────┐
                                                   │      e3-core        │
                                                   │   (filesystem ops)  │
                                                   └─────────────────────┘
```

### Design Goals

1. **Mirror e3-core's API** - Client should feel identical to using e3-core directly
2. **SSE for streaming** - Long-running operations push events to clients
3. **Stateless server** - Server doesn't hold state beyond filesystem + active executions
4. **Reconnection support** - Clients can reconnect and catch up on missed events
5. **Future-proof for auth** - Design assumes authentication/authorization will be added

## Protocol

### REST Endpoints

#### Repository

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Repository status |
| `POST` | `/api/gc` | Run garbage collection |

#### Packages

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/packages` | List packages |
| `GET` | `/api/packages/:name` | Get package details |
| `POST` | `/api/packages/import` | Import package from archive |
| `GET` | `/api/packages/:name/export` | Export package as archive |
| `DELETE` | `/api/packages/:name` | Remove package |

#### Workspaces

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces` | List workspaces |
| `POST` | `/api/workspaces` | Create workspace |
| `GET` | `/api/workspaces/:name` | Get workspace state |
| `DELETE` | `/api/workspaces/:name` | Remove workspace |
| `POST` | `/api/workspaces/:name/deploy` | Deploy package to workspace |
| `GET` | `/api/workspaces/:name/export` | Export workspace data |

#### Datasets

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces/:ws/datasets` | List datasets (tree structure) |
| `GET` | `/api/workspaces/:ws/datasets/*path` | Get dataset value |
| `PUT` | `/api/workspaces/:ws/datasets/*path` | Set dataset value |

#### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces/:ws/tasks` | List tasks in workspace |
| `GET` | `/api/workspaces/:ws/tasks/:name` | Get task details |

#### Executions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workspaces/:ws/start` | Start dataflow execution |
| `GET` | `/api/executions` | List active/recent executions |
| `GET` | `/api/executions/:id` | Get execution state |
| `GET` | `/api/executions/:id/events` | **SSE stream** - execution events |
| `GET` | `/api/executions/:id/tasks/:task/logs` | Get task logs (paginated) |

### Request/Response Format

All requests and responses use JSON. Binary data (datasets) uses base64 encoding with a wrapper:

```typescript
// Dataset value wrapper
interface DatasetValue {
  type: "beast2";           // Encoding format
  data: string;             // Base64-encoded BEAST2
  schema?: string;          // Optional East type hash for validation
}
```

### Error Response

```typescript
interface ErrorResponse {
  error: {
    code: string;           // Machine-readable code, e.g., "WORKSPACE_NOT_FOUND"
    message: string;        // Human-readable message
    details?: unknown;      // Additional context
  };
}
```

Standard HTTP status codes:
- `400` - Bad request (validation error)
- `404` - Resource not found
- `409` - Conflict (e.g., workspace already exists)
- `500` - Internal server error

## Execution Events

Long-running operations (dataflow execution) use Server-Sent Events for real-time updates.

### Starting an Execution

```
POST /api/workspaces/production/start
Content-Type: application/json

{
  "filter": "train-*",
  "concurrency": 4,
  "force": false
}
```

Response:
```json
{
  "executionId": "exec_a1b2c3d4",
  "status": "running",
  "eventsUrl": "/api/executions/exec_a1b2c3d4/events"
}
```

### Event Stream

```
GET /api/executions/exec_a1b2c3d4/events
Accept: text/event-stream
```

The server sends events as they occur:

```
event: execution_started
data: {"executionId":"exec_a1b2c3d4","workspace":"production","startedAt":1702300000000}

event: task_started
data: {"task":"load-data","startedAt":1702300001000}

event: task_stdout
data: {"task":"load-data","data":"Loading 1000 records...\n","offset":0}

event: task_completed
data: {"task":"load-data","result":{"cached":false,"state":"success","duration":1523}}

event: task_started
data: {"task":"train-model","startedAt":1702300003000}

event: task_stderr
data: {"task":"train-model","data":"Warning: low memory\n","offset":0}

event: task_completed
data: {"task":"train-model","result":{"cached":false,"state":"success","duration":45230},"changedDatasets":["outputs/model"]}

event: execution_completed
data: {"result":{"success":true,"executed":2,"cached":0,"failed":0,"skipped":0,"duration":46753,"changedDatasets":["outputs/predictions","outputs/model"]}}
```

### Event Types

```typescript
type ExecutionEvent =
  | {
      type: "execution_started";
      executionId: string;
      workspace: string;
      startedAt: number;
      filter?: string;
    }
  | {
      type: "task_started";
      task: string;
      startedAt: number;
    }
  | {
      type: "task_stdout";
      task: string;
      data: string;
      offset: number;        // Byte offset for log continuity
    }
  | {
      type: "task_stderr";
      task: string;
      data: string;
      offset: number;
    }
  | {
      type: "task_completed";
      task: string;
      result: TaskExecutionResult;
      changedDatasets: string[];   // Datasets written by this task
    }
  | {
      type: "execution_completed";
      result: DataflowResult;
    }
  | {
      type: "execution_error";
      message: string;
    };

interface TaskExecutionResult {
  cached: boolean;
  state: "success" | "failed" | "error" | "skipped";
  error?: string;
  exitCode?: number;
  duration: number;
}

interface DataflowResult {
  success: boolean;
  executed: number;
  cached: number;
  failed: number;
  skipped: number;
  tasks: TaskExecutionResult[];
  duration: number;
  changedDatasets: string[];    // Paths that were written during execution
}
```

### Reconnection and Catch-Up

Clients may disconnect during long-running executions. The server supports reconnection with state recovery.

#### Query Parameters

```
GET /api/executions/:id/events?since=<event_sequence>
```

- `since` - Resume from this event sequence number (0-indexed)

#### Reconnection Flow

1. Client connects to `/api/executions/:id/events`
2. Server sends current state snapshot first:
   ```
   event: state_snapshot
   data: {"status":"running","startedAt":1702300000000,"completedTasks":["load-data"],"activeTasks":["train-model"],"sequence":5}
   ```
3. Server replays any buffered events since `since` parameter (if provided)
4. Server continues with live events

#### Event Buffering

The server buffers events for active executions. Buffer is cleared when:
- Execution completes and all clients disconnect
- Buffer exceeds size limit (oldest events dropped)
- Configurable TTL expires after completion

```typescript
interface ExecutionBuffer {
  events: Array<{ sequence: number; event: ExecutionEvent }>;
  maxSize: number;          // Default: 1000 events
  completedTTL: number;     // Default: 5 minutes after completion
}
```

## e3-api-client

### Installation

```bash
npm install @elaraai/e3-api-client
```

### Basic Usage

```typescript
import { createClient } from "@elaraai/e3-api-client";

const client = createClient({ url: "http://localhost:3000" });

// Simple operations
const packages = await client.packages.list();
const workspaces = await client.workspaces.list();

// Get/set datasets
const data = await client.datasets.get("production", ["inputs", "config"]);
await client.datasets.set("production", ["inputs", "config"], newValue);
```

### Execution with Events

```typescript
// Start execution
const execution = await client.start("production", {
  filter: "train-*",
  concurrency: 4,
});

// Option 1: Async iterator
for await (const event of execution.events()) {
  switch (event.type) {
    case "task_started":
      console.log(`Starting: ${event.task}`);
      break;
    case "task_stdout":
      process.stdout.write(event.data);
      break;
    case "task_completed":
      console.log(`Completed: ${event.task} (${event.result.duration}ms)`);
      break;
    case "execution_completed":
      console.log(`Done: ${event.result.executed} executed, ${event.result.cached} cached`);
      break;
  }
}

// Option 2: Event emitter style
execution.on("task_started", (e) => console.log(`Starting: ${e.task}`));
execution.on("task_completed", (e) => console.log(`Done: ${e.task}`));
execution.on("execution_completed", (result) => console.log("Finished", result));

// Wait for completion
const result = await execution.wait();

// Option 3: Just wait, ignore events
const result = await client.startAndWait("production", { filter: "train-*" });
```

### Reconnection

```typescript
// Execution handle persists execution ID
const execution = await client.start("production");
const executionId = execution.id;

// ... client disconnects ...

// Reconnect later
const execution = client.attach(executionId);
for await (const event of execution.events()) {
  // Receives state snapshot + missed events + live events
}
```

### Client API Reference

```typescript
interface E3Client {
  // Repository
  status(): Promise<RepositoryStatus>;
  gc(): Promise<GCResult>;

  // Packages
  packages: {
    list(): Promise<PackageInfo[]>;
    get(name: string): Promise<PackageDetails>;
    import(archive: Buffer | ReadableStream): Promise<PackageInfo>;
    export(name: string): Promise<ReadableStream>;
    remove(name: string): Promise<void>;
  };

  // Workspaces
  workspaces: {
    list(): Promise<WorkspaceInfo[]>;
    create(name: string): Promise<WorkspaceInfo>;
    get(name: string): Promise<WorkspaceState>;
    remove(name: string): Promise<void>;
    deploy(name: string, packageName: string): Promise<void>;
    export(name: string): Promise<ReadableStream>;
  };

  // Datasets
  datasets: {
    list(workspace: string): Promise<DatasetTree>;
    get(workspace: string, path: string[]): Promise<DatasetValue>;
    set(workspace: string, path: string[], value: DatasetValue): Promise<void>;
  };

  // Tasks
  tasks: {
    list(workspace: string): Promise<TaskInfo[]>;
    get(workspace: string, name: string): Promise<TaskDetails>;
  };

  // Executions
  start(workspace: string, options?: StartOptions): Promise<Execution>;
  startAndWait(workspace: string, options?: StartOptions): Promise<DataflowResult>;
  attach(executionId: string): Execution;
  executions: {
    list(): Promise<ExecutionInfo[]>;
    get(id: string): Promise<ExecutionState>;
    logs(id: string, task: string, options?: LogOptions): Promise<LogChunk>;
  };
}

interface Execution {
  id: string;
  events(): AsyncIterable<ExecutionEvent>;
  on<T extends ExecutionEvent["type"]>(
    type: T,
    handler: (event: Extract<ExecutionEvent, { type: T }>) => void
  ): void;
  off(type: string, handler: Function): void;
  wait(): Promise<DataflowResult>;
  abort(): Promise<void>;
}

interface StartOptions {
  filter?: string;
  concurrency?: number;
  force?: boolean;
}

interface LogOptions {
  stream: "stdout" | "stderr";
  offset?: number;
  limit?: number;
}
```

## e3-api-server

### Installation

```bash
npm install @elaraai/e3-api-server
```

### CLI Usage

```bash
# Start server for a repository
e3-api-server --repo ./my-repo --port 3000

# With custom host binding
e3-api-server --repo ./my-repo --host 0.0.0.0 --port 8080
```

### Programmatic Usage

```typescript
import { createServer } from "@elaraai/e3-api-server";

const server = await createServer({
  repo: "./my-repo",
  port: 3000,
  host: "localhost",
});

await server.start();

// Graceful shutdown
process.on("SIGTERM", () => server.stop());
```

### Configuration

```typescript
interface ServerConfig {
  repo: string;              // Path to e3 repository (required)
  port?: number;             // HTTP port (default: 3000)
  host?: string;             // Bind address (default: "localhost")

  // Execution settings
  execution?: {
    bufferSize?: number;     // Max events to buffer per execution (default: 1000)
    completedTTL?: number;   // Ms to keep completed execution buffers (default: 300000)
    maxConcurrent?: number;  // Max concurrent executions (default: 10)
  };

  // Future: Authentication
  // auth?: {
  //   type: "bearer" | "basic" | "custom";
  //   validate: (credentials: unknown) => Promise<AuthContext>;
  // };
}
```

## Package Structure

### e3-api-server

```
packages/e3-api-server/
├── src/
│   ├── index.ts              # createServer() export
│   ├── server.ts             # HTTP server setup (Express/Fastify)
│   ├── routes/
│   │   ├── status.ts         # GET /api/status, POST /api/gc
│   │   ├── packages.ts       # /api/packages/*
│   │   ├── workspaces.ts     # /api/workspaces/*
│   │   ├── datasets.ts       # /api/workspaces/:ws/datasets/*
│   │   ├── tasks.ts          # /api/workspaces/:ws/tasks/*
│   │   └── executions.ts     # /api/executions/*, POST /api/workspaces/:ws/start
│   ├── execution-manager.ts  # Tracks active executions, event buffering
│   ├── sse.ts                # SSE response helpers
│   ├── errors.ts             # Error types and formatting
│   └── cli.ts                # CLI entry point
├── package.json
└── tsconfig.json
```

### e3-api-client

```
packages/e3-api-client/
├── src/
│   ├── index.ts              # createClient() export
│   ├── client.ts             # E3Client implementation
│   ├── execution.ts          # Execution handle with SSE subscription
│   ├── sse.ts                # SSE parsing, reconnection logic
│   ├── errors.ts             # Error types
│   └── types.ts              # Shared types (re-exported)
├── package.json
└── tsconfig.json
```

## Implementation Notes

### Server: Execution Manager

The execution manager tracks active executions and handles event broadcasting:

```typescript
class ExecutionManager {
  private executions = new Map<string, ExecutionState>();

  async start(workspace: string, options: StartOptions): Promise<string> {
    const id = `exec_${crypto.randomUUID().slice(0, 8)}`;

    const state: ExecutionState = {
      id,
      workspace,
      status: "running",
      startedAt: Date.now(),
      events: [],
      clients: new Set(),
    };
    this.executions.set(id, state);

    // Run dataflow with callbacks
    dataflowExecute(this.repo, workspace, {
      ...options,
      onTaskStart: (task) => this.emit(id, {
        type: "task_started",
        task,
        startedAt: Date.now(),
      }),
      onTaskComplete: (task, result) => this.emit(id, {
        type: "task_completed",
        task,
        result,
      }),
      onStdout: (task, data, offset) => this.emit(id, {
        type: "task_stdout",
        task,
        data,
        offset,
      }),
      onStderr: (task, data, offset) => this.emit(id, {
        type: "task_stderr",
        task,
        data,
        offset,
      }),
    }).then((result) => {
      state.status = "completed";
      state.result = result;
      this.emit(id, { type: "execution_completed", result });
      this.scheduleCleanup(id);
    }).catch((error) => {
      state.status = "error";
      state.error = error.message;
      this.emit(id, { type: "execution_error", message: error.message });
      this.scheduleCleanup(id);
    });

    return id;
  }

  subscribe(id: string, res: Response, since?: number): void {
    const state = this.executions.get(id);
    if (!state) throw new NotFoundError("Execution not found");

    // Send state snapshot
    this.sendSSE(res, "state_snapshot", {
      status: state.status,
      startedAt: state.startedAt,
      completedTasks: state.completedTasks,
      activeTasks: state.activeTasks,
      sequence: state.events.length,
    });

    // Replay buffered events if requested
    if (since !== undefined) {
      for (const { sequence, event } of state.events) {
        if (sequence >= since) {
          this.sendSSE(res, event.type, event);
        }
      }
    }

    // Subscribe to live events
    state.clients.add(res);
    res.on("close", () => state.clients.delete(res));
  }

  private emit(id: string, event: ExecutionEvent): void {
    const state = this.executions.get(id);
    if (!state) return;

    const sequence = state.events.length;
    state.events.push({ sequence, event });

    // Trim buffer if needed
    if (state.events.length > this.config.bufferSize) {
      state.events.shift();
    }

    // Broadcast to connected clients
    for (const client of state.clients) {
      this.sendSSE(client, event.type, { ...event, sequence });
    }
  }

  private sendSSE(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
```

### Client: SSE with Reconnection

```typescript
class Execution {
  constructor(
    private client: E3Client,
    public readonly id: string,
  ) {}

  async *events(): AsyncIterable<ExecutionEvent> {
    let lastSequence = 0;
    let retries = 0;

    while (true) {
      try {
        const url = `${this.client.baseUrl}/api/executions/${this.id}/events?since=${lastSequence}`;
        const response = await fetch(url, {
          headers: { Accept: "text/event-stream" },
        });

        retries = 0; // Reset on successful connection

        for await (const event of parseSSE(response.body)) {
          if (event.sequence !== undefined) {
            lastSequence = event.sequence + 1;
          }

          yield event;

          if (event.type === "execution_completed" || event.type === "execution_error") {
            return;
          }
        }
      } catch (error) {
        if (retries >= this.client.maxRetries) throw error;
        retries++;
        await sleep(Math.min(1000 * Math.pow(2, retries), 30000));
      }
    }
  }

  async wait(): Promise<DataflowResult> {
    for await (const event of this.events()) {
      if (event.type === "execution_completed") {
        return event.result;
      }
      if (event.type === "execution_error") {
        throw new Error(event.message);
      }
    }
    throw new Error("Execution stream ended unexpectedly");
  }
}
```

## React Integration

The client package includes React hooks for building reactive UIs that automatically update when dataflow completes.

### Installation

```bash
npm install @elaraai/e3-api-client
```

### Provider Setup

```tsx
import { E3Provider } from "@elaraai/e3-api-client/react";

function App() {
  return (
    <E3Provider url="http://localhost:3000" workspace="production">
      <Dashboard />
    </E3Provider>
  );
}
```

### Core Hooks

#### useDataset

Fetches a dataset and automatically refetches when dataflow completes.

```tsx
import { useDataset } from "@elaraai/e3-api-client/react";

function SalesChart() {
  const { data, isLoading, error } = useDataset<SalesData[]>(["outputs", "predictions"]);

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return <LineChart data={data} />;
}
```

#### useDatasetMutation

Returns a mutation function to update a dataset.

```tsx
import { useDatasetMutation } from "@elaraai/e3-api-client/react";

function ConfigEditor() {
  const [config, setConfig] = useState({ threshold: 0.5 });
  const { mutate, isPending } = useDatasetMutation(["inputs", "config"]);

  const handleSave = () => {
    mutate(config);  // Updates dataset on server
  };

  return (
    <div>
      <Slider
        value={config.threshold}
        onChange={(v) => setConfig({ ...config, threshold: v })}
      />
      <Button onClick={handleSave} disabled={isPending}>
        Save
      </Button>
    </div>
  );
}
```

#### useExecution

Starts a dataflow execution and provides reactive status.

```tsx
import { useExecution } from "@elaraai/e3-api-client/react";

function RunButton() {
  const { start, status, progress, error } = useExecution();

  return (
    <div>
      <Button
        onClick={() => start()}
        disabled={status === "running"}
      >
        {status === "running" ? "Running..." : "Run Dataflow"}
      </Button>

      {status === "running" && (
        <Progress
          value={progress.completed}
          max={progress.total}
          label={`${progress.currentTask}...`}
        />
      )}

      {status === "completed" && (
        <Success>Completed in {progress.duration}ms</Success>
      )}

      {error && <Error>{error.message}</Error>}
    </div>
  );
}
```

#### useExecutionEvents

Subscribe to execution events for custom handling.

```tsx
import { useExecutionEvents } from "@elaraai/e3-api-client/react";

function ExecutionLog() {
  const [logs, setLogs] = useState<string[]>([]);

  useExecutionEvents({
    onTaskStarted: (e) => setLogs((l) => [...l, `Starting ${e.task}`]),
    onTaskCompleted: (e) => setLogs((l) => [...l, `Done: ${e.task} (${e.result.duration}ms)`]),
    onStdout: (e) => setLogs((l) => [...l, e.data]),
  });

  return (
    <pre>
      {logs.join("\n")}
    </pre>
  );
}
```

### Complete Example: Edit → Run → View

```tsx
import {
  E3Provider,
  useDataset,
  useDatasetMutation,
  useExecution,
} from "@elaraai/e3-api-client/react";

function App() {
  return (
    <E3Provider url="http://localhost:3000" workspace="production">
      <Dashboard />
    </E3Provider>
  );
}

function Dashboard() {
  return (
    <div className="dashboard">
      <ConfigPanel />
      <ResultsPanel />
    </div>
  );
}

function ConfigPanel() {
  // Load current config
  const { data: config, isLoading } = useDataset<Config>(["inputs", "config"]);

  // Mutation to save config
  const { mutate: saveConfig, isPending: isSaving } = useDatasetMutation(["inputs", "config"]);

  // Execution control
  const { start, status, progress } = useExecution();

  // Local form state
  const [form, setForm] = useState<Config | null>(null);

  // Initialize form when data loads
  useEffect(() => {
    if (config && !form) setForm(config);
  }, [config]);

  if (isLoading || !form) return <Spinner />;

  const handleRun = async () => {
    // 1. Save the config
    await saveConfig(form);
    // 2. Start the dataflow
    start();
  };

  const isRunning = status === "running";

  return (
    <Card>
      <h2>Configuration</h2>

      <FormField label="Threshold">
        <Slider
          value={form.threshold}
          onChange={(v) => setForm({ ...form, threshold: v })}
          disabled={isRunning}
        />
      </FormField>

      <FormField label="Model Type">
        <Select
          value={form.modelType}
          onChange={(v) => setForm({ ...form, modelType: v })}
          options={["linear", "neural", "ensemble"]}
          disabled={isRunning}
        />
      </FormField>

      <Button onClick={handleRun} disabled={isRunning || isSaving}>
        {isRunning ? `Running: ${progress.currentTask}...` : "Save & Run"}
      </Button>

      {isRunning && (
        <Progress value={progress.completed} max={progress.total} />
      )}
    </Card>
  );
}

function ResultsPanel() {
  // This automatically refetches when dataflow completes
  const { data: predictions, isLoading, updatedAt } = useDataset<Prediction[]>(
    ["outputs", "predictions"]
  );

  if (isLoading) return <Spinner />;

  return (
    <Card>
      <h2>Predictions</h2>
      <small>Last updated: {updatedAt.toLocaleTimeString()}</small>

      <LineChart
        data={predictions}
        xKey="date"
        yKey="value"
      />

      <Table
        columns={[
          { key: "date", header: "Date" },
          { key: "value", header: "Predicted Value" },
          { key: "confidence", header: "Confidence" },
        ]}
        rows={predictions}
      />
    </Card>
  );
}
```

### How Auto-Refresh Works

The server tracks which datasets are written during execution and includes them in the `execution_completed` event. Only those datasets are invalidated.

1. **useExecution** subscribes to execution events via SSE
2. When `execution_completed` fires, it includes `changedDatasets: ["outputs/predictions", "outputs/model"]`
3. Context calls `invalidateDatasets(changedDatasets)`
4. Only **useDataset** hooks watching those paths refetch
5. React re-renders with new data

```
┌─────────────────────────────────────────────────────────────────────┐
│ React App                                                           │
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │ ConfigPanel │    │ RunButton   │    │ ResultsPanel            │ │
│  │             │    │             │    │                         │ │
│  │ useDataset  │    │ useExecution│    │ useDataset(outputs/pred)│ │
│  │ (inputs/*)  │    │             │    │                         │ │
│  │ NOT refetch │    │             │    │ ✓ REFETCHES             │ │
│  └─────────────┘    └──────┬──────┘    └───────────┬─────────────┘ │
│                            │                       │               │
│                            │  onCompleted(result)  │               │
│                            │  changedDatasets:     │               │
│                            │  ["outputs/pred"]     │               │
│                            │ ──────────────────────┼───────────┐   │
│                            │                       │           │   │
│                            ▼                       ▼           │   │
│  ┌──────────────────────────────────────────────────────────┐ │   │
│  │                    E3Provider Context                    │◄┘   │
│  │  - client: E3Client                                      │     │
│  │  - workspace: "production"                               │     │
│  │  - invalidateDatasets(paths): selective refetch          │     │
│  │  - subscriptions: Map<path, Set<callback>>               │     │
│  └──────────────────────────────────────────────────────────┘     │
│                              │                                     │
└──────────────────────────────┼─────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   e3-api-server     │
                    └─────────────────────┘
```

The context maintains a subscription map. Each `useDataset` hook registers its path on mount. When `invalidateDatasets(paths)` is called, only hooks whose paths match (or are prefixes of) the changed paths are notified to refetch.

### Hook API Reference

```typescript
// Provider
interface E3ProviderProps {
  url: string;                    // Server URL
  workspace: string;              // Default workspace
  children: React.ReactNode;
}

// useDataset
interface UseDatasetOptions {
  workspace?: string;             // Override default workspace
  enabled?: boolean;              // Conditionally fetch
  refetchOn?: "task_completed" | "execution_completed" | "none";  // Default: "execution_completed"
}

interface UseDatasetResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;            // True during refetch
  error: Error | null;
  updatedAt: Date | null;
  refetch: () => Promise<void>;
}

function useDataset<T>(
  path: string[],
  options?: UseDatasetOptions
): UseDatasetResult<T>;

// useDatasetMutation
interface UseDatasetMutationOptions {
  workspace?: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface UseDatasetMutationResult<T> {
  mutate: (value: T) => Promise<void>;
  mutateAsync: (value: T) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

function useDatasetMutation<T>(
  path: string[],
  options?: UseDatasetMutationOptions
): UseDatasetMutationResult<T>;

// useExecution
interface UseExecutionOptions {
  workspace?: string;
  filter?: string;
  concurrency?: number;
  force?: boolean;
  onTaskStarted?: (event: TaskStartedEvent) => void;
  onTaskCompleted?: (event: TaskCompletedEvent) => void;
  onCompleted?: (result: DataflowResult) => void;
  onError?: (error: Error) => void;
}

interface ExecutionProgress {
  total: number;
  completed: number;
  cached: number;
  failed: number;
  currentTask: string | null;
  duration: number;
}

interface UseExecutionResult {
  start: (options?: Partial<UseExecutionOptions>) => void;
  status: "idle" | "running" | "completed" | "error";
  progress: ExecutionProgress;
  result: DataflowResult | null;
  error: Error | null;
  reset: () => void;
}

function useExecution(options?: UseExecutionOptions): UseExecutionResult;

// useExecutionEvents - for custom event handling
interface UseExecutionEventsOptions {
  executionId?: string;           // Attach to specific execution
  onTaskStarted?: (event: TaskStartedEvent) => void;
  onTaskCompleted?: (event: TaskCompletedEvent) => void;
  onStdout?: (event: StdoutEvent) => void;
  onStderr?: (event: StderrEvent) => void;
  onCompleted?: (result: DataflowResult) => void;
  onError?: (error: Error) => void;
}

function useExecutionEvents(options: UseExecutionEventsOptions): void;

// useClient - escape hatch for direct client access
function useClient(): E3Client;

// useWorkspace - get/set current workspace
function useWorkspace(): {
  workspace: string;
  setWorkspace: (ws: string) => void;
};
```

### Integration with React Query / SWR

The hooks are designed to work standalone, but can also integrate with existing data fetching libraries:

```tsx
// With React Query
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@elaraai/e3-api-client/react";

function useDatasetWithQuery<T>(path: string[]) {
  const client = useClient();
  const workspace = "production";

  return useQuery({
    queryKey: ["dataset", workspace, ...path],
    queryFn: () => client.datasets.get(workspace, path),
  });
}

// Invalidate on execution complete
function useExecutionWithQuery() {
  const client = useClient();
  const queryClient = useQueryClient();

  const startExecution = async () => {
    const execution = await client.start("production");

    for await (const event of execution.events()) {
      if (event.type === "execution_completed") {
        // Invalidate all dataset queries
        queryClient.invalidateQueries({ queryKey: ["dataset"] });
      }
    }
  };

  return { startExecution };
}
```

### Package Structure Update

```
packages/e3-api-client/
├── src/
│   ├── index.ts              # createClient() export
│   ├── client.ts             # E3Client implementation
│   ├── execution.ts          # Execution handle
│   ├── sse.ts                # SSE parsing
│   ├── errors.ts             # Error types
│   └── types.ts              # Shared types
├── react/
│   ├── index.ts              # React exports
│   ├── provider.tsx          # E3Provider
│   ├── context.ts            # Internal context
│   ├── useDataset.ts         # useDataset hook
│   ├── useDatasetMutation.ts # useDatasetMutation hook
│   ├── useExecution.ts       # useExecution hook
│   └── useExecutionEvents.ts # useExecutionEvents hook
├── package.json
└── tsconfig.json
```

## Future Considerations

### Multiple Repositories

Current design binds server to one repository. Future options:

1. **Path-based routing**: `/api/repos/:repo/workspaces/...`
2. **Subdomain routing**: `repo1.api.example.com/api/workspaces/...`
3. **Header-based**: `X-E3-Repository: repo1`

### Authentication & Authorization

Hooks for future auth:

```typescript
interface AuthContext {
  userId: string;
  permissions: string[];
}

interface ServerConfig {
  auth?: {
    validate(request: Request): Promise<AuthContext>;
    authorize(context: AuthContext, action: string, resource: string): boolean;
  };
}
```

### WebSocket Alternative

SSE is simpler and sufficient for server→client streaming. If bidirectional streaming is needed (e.g., stdin to running tasks), WebSocket could be added:

```
GET /api/executions/:id/ws → WebSocket upgrade
```

### Abort/Cancel Execution

```
POST /api/executions/:id/abort
```

Would require e3-core support for graceful task cancellation.
