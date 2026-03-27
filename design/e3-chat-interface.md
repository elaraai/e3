# e3 Chat Interface Design

A Claude-powered conversational interface for interacting with e3 repositories, workspaces, and datasets — including ad-hoc function generation and execution.

## 1. Goals

1. **Conversational access** to e3 operations: list/inspect workspaces, read/write datasets, trigger dataflow execution, view logs
2. **Ad-hoc function generation**: user describes a transformation in natural language, Claude generates East IR, packages it, deploys it, and executes it against existing workspace data
3. **Exploratory data analysis**: inspect dataset values, types, and status through conversation
4. **Composability**: generated ad-hoc tasks can reference existing workspace datasets as inputs

## 2. Architecture Options

### Option A: MCP Server (Recommended)

**Model Context Protocol (MCP)** is Anthropic's open standard for connecting LLMs to external tools and data sources. It's the most natural fit because:

- e3 already has a well-defined API surface (e3-api-client / e3-api-server)
- MCP is natively supported by Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible client
- No need to build a custom chat UI — leverage existing clients
- Tools are strongly typed with JSON Schema, which maps well to e3's typed API

```
┌─────────────────┐     MCP Protocol      ┌──────────────────┐
│  Claude Client   │◄────(stdio/SSE)──────►│  e3 MCP Server   │
│  (Claude Code,   │                       │  (new package)   │
│   Claude Desktop,│                       │                  │
│   custom app)    │                       │  Uses e3-api-    │
└─────────────────┘                       │  client or       │
                                          │  e3-core directly │
                                          └────────┬─────────┘
                                                   │
                                          ┌────────▼─────────┐
                                          │  e3 Repository   │
                                          │  (local or       │
                                          │   remote via API) │
                                          └──────────────────┘
```

**New package: `packages/e3-mcp`**

### Option B: Claude Tool Use in Custom Chat App

Build a standalone chat application using the Anthropic SDK with Claude's native tool use (function calling). The app defines tools that map to e3 operations.

```
┌─────────────┐    Anthropic API     ┌──────────────────┐
│  Chat UI    │◄───────────────────►│  e3 Chat Server  │
│  (web/CLI)  │                     │  (Hono + Claude)  │
│             │                     │                   │
└─────────────┘                     │  tool definitions │
                                    │  → e3-api-client  │
                                    └────────┬──────────┘
                                             │
                                    ┌────────▼──────────┐
                                    │  e3 API Server    │
                                    └───────────────────┘
```

### Option C: Agent SDK

Use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to build an autonomous agent with e3 tools. Best for complex multi-step workflows where the agent needs to plan, execute, observe results, and iterate.

### Recommendation

**Start with Option A (MCP Server)** for maximum leverage:
- Instantly works with Claude Code, Claude Desktop, and other MCP clients
- No custom UI needed initially
- Can evolve to Options B/C later by reusing the same tool definitions
- MCP resources provide context (workspace structure, dataset schemas) without tool calls

Then **layer Option B** for a dedicated chat experience if needed, reusing tool definitions from the MCP server.

## 3. MCP Server Design (`packages/e3-mcp`)

### 3.1 Transport Modes

```typescript
// stdio mode (for Claude Desktop / Claude Code)
// SSE mode (for web clients)
// Streamable HTTP mode (for custom integrations)
```

### 3.2 MCP Tools

Tools map directly to e3 operations. Each tool has a JSON Schema for parameters and returns structured results.

#### Workspace Management

| Tool | Description | Maps to |
|------|-------------|---------|
| `workspace_list` | List all workspaces in a repo | `workspaceList()` |
| `workspace_status` | Get comprehensive status (datasets, tasks, staleness) | `workspaceStatus()` |
| `workspace_create` | Create a new workspace | `workspaceCreate()` |
| `workspace_deploy` | Deploy a package to a workspace | `workspaceDeploy()` |

#### Dataset Operations

| Tool | Description | Maps to |
|------|-------------|---------|
| `dataset_list` | List datasets at a path (recursive option) | `datasetListRecursive()` |
| `dataset_get` | Read a dataset value (decoded from BEAST2) | `datasetGet()` |
| `dataset_set` | Write a dataset value | `datasetSet()` |
| `dataset_status` | Get dataset staleness/version info | `datasetGetStatus()` |

#### Task & Execution

| Tool | Description | Maps to |
|------|-------------|---------|
| `task_list` | List tasks in a workspace | `taskList()` |
| `task_get` | Get task definition (inputs, output, command) | `taskGet()` |
| `dataflow_execute` | Run the dataflow (non-blocking with polling) | `dataflowExecute()` |
| `dataflow_status` | Poll execution progress | `dataflowExecutePoll()` |
| `dataflow_graph` | Get the dependency DAG | `dataflowGraph()` |
| `task_logs` | Read stdout/stderr from a task execution | `taskLogs()` |

#### Package Management

| Tool | Description | Maps to |
|------|-------------|---------|
| `package_list` | List installed packages | `packageList()` |
| `package_import` | Import a package from zip | `packageImport()` |

#### Ad-Hoc Execution (the key differentiator)

| Tool | Description |
|------|-------------|
| `adhoc_execute` | Generate, package, deploy, and execute an ad-hoc East function against workspace data |

### 3.3 MCP Resources

Resources expose contextual data that Claude can read to understand the current state without tool calls.

| Resource URI | Description |
|---|---|
| `e3://repos` | List of repositories |
| `e3://repos/{repo}/workspaces` | List of workspaces |
| `e3://repos/{repo}/workspaces/{ws}/structure` | Dataset tree structure with types |
| `e3://repos/{repo}/workspaces/{ws}/status` | Current workspace status |
| `e3://repos/{repo}/workspaces/{ws}/dataflow-graph` | Task dependency DAG |

The **structure resource** is critical — it gives Claude the full typed schema of the workspace so it can generate correct East IR referencing the right dataset paths and types.

### 3.4 MCP Prompts

Pre-built prompt templates for common workflows:

| Prompt | Description |
|---|---|
| `explore_workspace` | "Show me what's in workspace X" |
| `run_analysis` | "Run an ad-hoc analysis on dataset X" |
| `debug_failure` | "Why did task X fail?" |

## 4. Ad-Hoc Function Generation & Execution

This is the core innovation. The flow:

```
User: "Calculate the average of the 'sales' field in the transactions dataset"
                    │
                    ▼
┌─────────────────────────────────────┐
│ 1. Claude reads workspace structure │  ← MCP resource: structure + types
│    to understand available datasets │
│    and their East types             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 2. Claude generates East function   │  ← Using e3 SDK patterns
│    as TypeScript code:              │
│                                     │
│    const input = e3.input(          │
│      'transactions',                │
│      TransactionsType               │
│    );                               │
│    const calc = e3.task(            │
│      'avg_sales',                   │
│      [input],                       │
│      ($, txns) => txns              │
│        .map(t => t.get('sales'))    │
│        .mean()                      │
│    );                               │
│    const pkg = e3.package(          │
│      'adhoc', '1.0.0', calc         │
│    );                               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 3. Compile, package, deploy, run    │
│    - e3.export(pkg, tmpZip)         │
│    - packageImport(tmpZip)          │
│    - workspaceDeploy('adhoc@1.0.0') │
│      OR inject into existing ws     │
│    - dataflowExecute()              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 4. Read result & present to user    │
│    - datasetGet('tasks/avg_sales/   │
│      output')                       │
│    - Format and explain result      │
└─────────────────────────────────────┘
```

### 4.1 Implementation Approaches for Ad-Hoc Execution

#### Approach A: Code Generation + Dynamic Import (Recommended)

Claude generates a complete TypeScript file using the `@elaraai/e3` SDK, which is written to a temp directory and executed via `tsx` or `node --import`.

```typescript
// Generated by Claude → /tmp/e3-adhoc-<uuid>/adhoc.ts
import * as e3 from '@elaraai/e3';
import { East, FloatType, ArrayType, StructType, StringType } from '@elaraai/east';

const transactions = e3.input('transactions', ArrayType(StructType({
  id: StringType,
  sales: FloatType,
})));

const avg_sales = e3.task('avg_sales', [transactions], ($, txns) =>
  txns.map(($, t) => t.get('sales')).mean()
);

const pkg = e3.package('adhoc-avg-sales', '1.0.0', avg_sales);
await e3.export(pkg, '/tmp/e3-adhoc-<uuid>/adhoc.zip');
```

Then the MCP server:
1. Writes the file
2. Executes it to produce the `.zip`
3. Imports the package: `packageImport(repoPath, zipPath)`
4. Creates/reuses a scratch workspace
5. Copies the relevant input data from the source workspace
6. Deploys the ad-hoc package
7. Runs the dataflow
8. Reads the output dataset
9. Returns the result to Claude

**Pros**: Full type safety, uses existing SDK, Claude is good at generating TypeScript
**Cons**: Requires `@elaraai/e3` and `@elaraai/east` available at runtime

#### Approach B: Direct IR Construction

Build East IR programmatically within the MCP server, skipping the SDK export step. This avoids spawning a subprocess but requires the MCP server to understand IR construction intimately.

```typescript
// Inside the MCP server tool handler
import { East, IRType } from '@elaraai/east';
import { encodeBeast2For } from '@elaraai/east';

function buildAdhocIR(userDescription: string, inputTypes: Map<string, EastType>) {
  // Claude provides the function body as a structured description
  // The server constructs the IR directly
  const fn = East.function([inputType], outputType, ($, input) => {
    // ... generated logic
  });
  return fn.toIR().ir;
}
```

**Pros**: Faster, no subprocess, no temp files
**Cons**: More complex, harder for Claude to express arbitrary logic

#### Approach C: Hybrid — SDK for Complex, Direct for Simple

- Simple operations (filter, map, reduce, aggregate): build IR directly with templates
- Complex operations: generate full SDK TypeScript and execute

### 4.2 Workspace Strategy for Ad-Hoc Tasks

Two options:

**Option 1: Dedicated scratch workspace** (recommended for safety)
- Create `__adhoc__` workspace per session
- Copy input data by hash (cheap — content-addressed)
- Deploy ad-hoc package
- Execute
- Read results
- Clean up on session end

**Option 2: Inject into existing workspace**
- Add ad-hoc tasks alongside existing tasks
- Risk: modifies production workspace state
- Benefit: direct access to all datasets, no copying

Recommend Option 1 for safety, with Option 2 as an explicit "I know what I'm doing" mode.

### 4.3 Providing Type Context to Claude

The key to good code generation is giving Claude the workspace's type information. The MCP resource `e3://repos/{repo}/workspaces/{ws}/structure` should return:

```json
{
  "inputs": {
    "transactions": {
      "type": "Array<Struct<{ id: String, amount: Float, date: DateTime, category: String }>>",
      "writable": true,
      "status": "up-to-date",
      "rowCount": 15000
    },
    "config": {
      "type": "Struct<{ threshold: Float, enabled: Boolean }>",
      "writable": true,
      "status": "up-to-date"
    }
  },
  "tasks": {
    "daily_totals": {
      "output": {
        "type": "Array<Struct<{ date: DateTime, total: Float }>>",
        "status": "up-to-date"
      }
    }
  }
}
```

This gives Claude everything it needs to generate correctly-typed East functions.

## 5. Package Structure

```
packages/e3-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point, MCP server setup
│   ├── server.ts             # MCP server configuration
│   ├── tools/
│   │   ├── workspace.ts      # Workspace management tools
│   │   ├── dataset.ts        # Dataset read/write tools
│   │   ├── task.ts           # Task inspection tools
│   │   ├── execution.ts      # Dataflow execution tools
│   │   ├── package.ts        # Package management tools
│   │   └── adhoc.ts          # Ad-hoc function generation & execution
│   ├── resources/
│   │   ├── workspaces.ts     # Workspace list resource
│   │   ├── structure.ts      # Typed workspace structure resource
│   │   └── status.ts         # Workspace status resource
│   ├── prompts/
│   │   ├── explore.ts        # Workspace exploration prompt
│   │   └── analyze.ts        # Ad-hoc analysis prompt
│   └── util/
│       ├── beast2.ts         # BEAST2 decode/encode for human-readable output
│       ├── types.ts          # East type → human-readable string
│       └── codegen.ts        # Ad-hoc TypeScript code generation helpers
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "@elaraai/e3-core": "*",
    "@elaraai/e3-api-client": "*",
    "@elaraai/e3-types": "*"
  },
  "peerDependencies": {
    "@elaraai/east": "beta"
  }
}
```

## 6. Connection Modes

The MCP server should support two backends:

### 6.1 Local Mode (e3-core directly)

```typescript
// Use e3-core functions directly against a local repository
const server = createE3McpServer({
  mode: 'local',
  repoPath: '/path/to/e3/repo',
});
```

Best for: Claude Code, Claude Desktop, local development

### 6.2 Remote Mode (via e3-api-client)

```typescript
// Use e3-api-client to connect to a remote e3-api-server
const server = createE3McpServer({
  mode: 'remote',
  apiUrl: 'https://e3.example.com',
  repo: 'my-repo',
  auth: { token: process.env.E3_API_TOKEN },
});
```

Best for: team/production use, web-based chat interfaces

## 7. Example Conversation Flows

### Flow 1: Explore and Analyze

```
User: What workspaces do I have?

Claude: [calls workspace_list]
You have 3 workspaces:
- **production** (deployed: analytics@2.1.0) — 12 datasets, all up-to-date
- **staging** (deployed: analytics@2.2.0-beta) — 12 datasets, 3 stale
- **dev** (not deployed)

User: Show me the structure of production

Claude: [reads e3://repos/main/workspaces/production/structure]
The production workspace has:

**Inputs:**
- `inputs.transactions` — Array<{id: String, amount: Float, date: DateTime, category: String}> (15,420 rows)
- `inputs.categories` — Array<{name: String, budget: Float}> (8 rows)

**Task Outputs:**
- `tasks.daily_totals.output` — Array<{date: DateTime, total: Float}>
- `tasks.category_breakdown.output` — Array<{category: String, total: Float, pct: Float}>
- `tasks.anomaly_detection.output` — Array<{date: DateTime, amount: Float, zscore: Float}>

User: What's the average transaction amount by category?

Claude: [calls adhoc_execute with generated East code]
I've run an analysis on `inputs.transactions`. Results:

| Category | Avg Amount | Count |
|----------|-----------|-------|
| Food     | $23.45    | 4,521 |
| Transport| $15.80    | 3,200 |
| ...      | ...       | ...   |
```

### Flow 2: Debug a Failed Execution

```
User: Why is staging stale?

Claude: [calls workspace_status for staging]
3 tasks have stale outputs because `inputs.transactions` was updated
2 hours ago but the dataflow hasn't been re-run.

Stale tasks: daily_totals, category_breakdown, anomaly_detection

User: Run it

Claude: [calls dataflow_execute, polls until done]
Dataflow completed in 12.3s:
- ✓ daily_totals (2.1s)
- ✓ category_breakdown (1.8s)
- ✗ anomaly_detection — FAILED (exit code 1)

User: What went wrong with anomaly detection?

Claude: [calls task_logs for anomaly_detection, stderr]
The task failed with: `ValueError: Column 'zscore' contains NaN values`
This looks like a division by zero when the standard deviation is 0 —
likely a category with only one transaction.
```

## 8. Security Considerations

1. **Code execution sandboxing**: Ad-hoc generated code runs through the e3 task execution pipeline, which already spawns isolated processes. Consider additional sandboxing (e.g., resource limits, no network access for ad-hoc tasks).

2. **Workspace isolation**: Ad-hoc tasks run in scratch workspaces by default, not production workspaces. Input data is copied by hash reference (cheap, immutable).

3. **Authentication**: Remote mode uses the same auth as e3-api-server. MCP server inherits the user's permissions.

4. **Code review**: For ad-hoc execution, Claude should show the generated code to the user before executing, with an option to approve/modify.

5. **Resource limits**: Ad-hoc tasks should have configurable timeouts and memory limits to prevent runaway computations.

## 9. Framework Comparison

| Framework | Approach | Pros | Cons | Best For |
|-----------|----------|------|------|----------|
| **MCP** (recommended) | Protocol-level tool integration | Works with any MCP client (Claude Desktop, Code, etc); strongly typed; standard protocol; resources + tools + prompts | Requires MCP-compatible client | Primary integration layer |
| **Claude Tool Use** (Anthropic SDK) | Direct API with function calling | Full control over UX; custom streaming; works in any app | Must build custom UI; manage conversation state | Custom web/mobile chat app |
| **Claude Agent SDK** | Multi-step autonomous agent | Complex multi-step workflows; built-in tool loop | Heavier runtime; less interactive | Batch operations, CI/CD |
| **Vercel AI SDK** | React-based AI chat framework | Great for web UIs; built-in streaming; tool support | Tied to React/Next.js ecosystem | Web dashboard integration |
| **LangChain/LangGraph** | Agent orchestration framework | Flexible; model-agnostic; graph-based workflows | Heavy abstraction; Python-centric | Complex agent pipelines |

## 10. Implementation Phases

### Phase 1: MCP Server with Core Tools
- Workspace, dataset, task, and execution tools
- MCP resources for structure and status
- Local mode (e3-core) only
- Test with Claude Code / Claude Desktop

### Phase 2: Ad-Hoc Execution
- Code generation via SDK approach (Approach A)
- Scratch workspace management
- Type context via structure resource
- Code review/approval flow

### Phase 3: Remote Mode + Custom UI
- e3-api-client backend
- SSE/Streamable HTTP transport
- Optional: custom chat UI using Anthropic SDK + tool use
- Streaming execution progress

### Phase 4: Advanced Features
- Conversation memory (persist analysis history)
- Generated task promotion (ad-hoc → permanent package)
- Multi-workspace queries
- Visualization generation (charts/tables from results)

## 11. Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary protocol | MCP | Industry standard, works with existing Claude clients |
| Ad-hoc code gen | TypeScript SDK generation (Approach A) | Best type safety, Claude is excellent at TypeScript |
| Ad-hoc workspace | Dedicated scratch workspace | Safety: doesn't mutate production state |
| BEAST2 handling | Decode to JSON in MCP tools | Claude can't read binary; present human-readable data |
| Transport | stdio (local) + SSE (remote) | stdio for desktop tools, SSE for web |
| Backend | e3-core (local) or e3-api-client (remote) | Flexibility for both local dev and team use |
