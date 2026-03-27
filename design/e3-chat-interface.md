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

### Option C: Claude Agent SDK

Use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, npm v0.2.71+) to build an autonomous agent with e3 tools. This is the same runtime that powers Claude Code — provides the agent loop, context management (compaction for long sessions), subagents for parallel work, MCP integration, and production reliability patterns. Best for complex multi-step workflows where the agent needs to plan, execute, observe results, and iterate.

### Option D: Custom Chat App with Programmatic Tool Calling

Claude's **Programmatic Tool Calling** (2025/2026) is particularly relevant for e3. Instead of one-at-a-time tool round-trips, Claude writes Python code that orchestrates multiple tool calls, processes results, and controls what enters its context window:

```
User: "Show me the top 5 categories by total sales"

Claude generates code (runs in sandboxed container):
┌──────────────────────────────────────────┐
│  txns = tool.dataset_get('transactions') │  ← calls e3 tool
│  cats = {}                               │
│  for t in txns:                          │
│      cats[t['category']] += t['amount']  │
│  top5 = sorted(cats, key=...)[:5]        │  ← filters locally
│  return top5                             │  ← only this enters context
└──────────────────────────────────────────┘
```

Key properties:
- Intermediate tool results do NOT enter Claude's context — only the final processed output
- Dramatically reduces tokens and latency for multi-tool workflows
- Tools marked `allowed_callers: ["code_execution_20260120"]` restrict to code-only invocation
- Runs in Anthropic-managed Firecracker containers (30-day lifetime, 4.5min idle timeout)

This is ideal for e3 because datasets can be large and multi-step analysis is common.

### Option E: Vercel AI SDK Web Interface

Use the **Vercel AI SDK 6** (`ai` package) for building a web-based chat UI:

- **`ToolLoopAgent`**: Production-ready agent class that handles the complete tool execution loop — calls LLM, executes tools, feeds results back, repeats until done
- **`useChat` hook**: Manages conversation state, streaming, tool approval flows
- **Generative UI**: Render React components inline from tool results (dataset tables, dataflow DAGs, execution progress bars)
- **Human-in-the-loop**: `needsApproval: true` on destructive tools (dataset writes, deploys)
- **Provider-agnostic**: Works with Claude, GPT, Gemini

### Recommendation

**Primary: Option B/D (Anthropic SDK + Programmatic Tool Calling)** — the best fit for e3:

- **Programmatic Tool Calling is the killer feature**: Claude writes code that queries multiple datasets, filters/aggregates large results, and only returns summaries to context. This is essential for a data execution engine where datasets can be large and multi-step analysis is common.
- **Direct integration** with e3-core or e3-api-client — no protocol overhead (MCP adds JSON-RPC statefulness, capability negotiation, transport layers that aren't needed here).
- **Full control** over UX, streaming, conversation state, and approval flows.
- **`strict: true`** guarantees Claude's tool inputs exactly match e3's typed schemas.
- **Tool runner** in the Anthropic SDK automates the tool call loop.

**Frontend**: Use **Option E (Vercel AI SDK 6)** for the web chat UI — `ToolLoopAgent`, `useChat`, Generative UI for inline rendering of dataset tables, dataflow DAGs, and execution progress.

**Optional**: An MCP server (Option A) can be added later as a thin adapter if third-party client compatibility is desired, but it is not the primary architecture.

## 3. Chat Server Design (`packages/e3-chat`)

### 3.1 Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    e3 Chat Server                         │
│                  (Hono + Anthropic SDK)                   │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ System      │  │ Tool         │  │ Conversation   │  │
│  │ Prompt      │  │ Definitions  │  │ Manager        │  │
│  │ (workspace  │  │ (JSON Schema │  │ (message       │  │
│  │  structure, │  │  from East   │  │  history,      │  │
│  │  types)     │  │  types)      │  │  streaming)    │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                │                   │           │
│         └────────────────┼───────────────────┘           │
│                          │                               │
│                  ┌───────▼────────┐                      │
│                  │  Anthropic API │                      │
│                  │  (Messages +   │                      │
│                  │   Tool Use +   │                      │
│                  │   Programmatic │                      │
│                  │   Tool Calling)│                      │
│                  └───────┬────────┘                      │
│                          │                               │
│              ┌───────────▼──────────┐                    │
│              │  Tool Executor       │                    │
│              │  (routes tool calls  │                    │
│              │   to e3 operations)  │                    │
│              └───────────┬──────────┘                    │
│                          │                               │
│         ┌────────────────┼────────────────┐              │
│         │                │                │              │
│    ┌────▼─────┐   ┌─────▼──────┐  ┌──────▼──────┐      │
│    │ e3-core  │   │ e3-api-    │  │ Ad-hoc      │      │
│    │ (local)  │   │ client     │  │ Executor    │      │
│    │          │   │ (remote)   │  │ (codegen +  │      │
│    │          │   │            │  │  e3 SDK)    │      │
│    └──────────┘   └────────────┘  └─────────────┘      │
└──────────────────────────────────────────────────────────┘
         │                │
         ▼                ▼
   ┌───────────┐   ┌────────────┐
   │ Local e3  │   │ Remote e3  │
   │ Repository│   │ API Server │
   └───────────┘   └────────────┘
```

### 3.2 Tool Definitions

Tools are defined as Anthropic tool use schemas (JSON Schema). They map directly to e3 operations.

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
| `dataset_get` | Read a dataset value (decoded from BEAST2 to JSON) | `datasetGet()` |
| `dataset_set` | Write a dataset value | `datasetSet()` |
| `dataset_status` | Get dataset staleness/version info | `datasetGetStatus()` |

#### Task & Execution

| Tool | Description | Maps to |
|------|-------------|---------|
| `task_list` | List tasks in a workspace | `taskList()` |
| `task_get` | Get task definition (inputs, output, command) | `taskGet()` |
| `dataflow_execute` | Run the dataflow (blocking with progress streaming) | `dataflowExecute()` |
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

#### Programmatic-Only Tools

These tools are restricted to `allowed_callers: ["code_execution_20260120"]` — Claude can only call them from generated code, not directly. This prevents large dataset contents from flooding the context window.

| Tool | Description | Why programmatic-only |
|------|-------------|----------------------|
| `dataset_get_raw` | Read full dataset as JSON | Large datasets stay in code sandbox |
| `dataset_query` | Read dataset with filter/limit/offset | Results processed in code before returning |

### 3.3 System Prompt Context

Instead of MCP resources, the **system prompt** is dynamically constructed with workspace context. This is more reliable than resources (no extra round-trip) and gives Claude the type information it needs for code generation:

```typescript
function buildSystemPrompt(repo: string, workspace: string): string {
  const status = await workspaceStatus(repo, workspace);
  const structure = await workspaceGetTree(repo, workspace);

  return `You are an AI assistant for the e3 execution engine.

## Current Workspace: ${workspace}
Package: ${status.packageName}@${status.packageVersion}

## Dataset Structure
${formatStructureAsTypescript(structure)}

## Dataset Status
${formatDatasetStatus(status.datasets)}

## Task Status
${formatTaskStatus(status.tasks)}

## Available Operations
You can read/write datasets, execute dataflows, inspect tasks,
and generate ad-hoc East functions for data analysis.
For ad-hoc functions, use the @elaraai/e3 SDK patterns shown below...
`;
}
```

The `formatStructureAsTypescript()` function converts East types to TypeScript-like notation that Claude can use directly in generated code:

```typescript
// Example output:
// inputs.transactions: Array<{ id: String, amount: Float, date: DateTime, category: String }>
// inputs.categories: Array<{ name: String, budget: Float }>
// tasks.daily_totals.output: Array<{ date: DateTime, total: Float }>
```

## 4. Ad-Hoc Function Generation & Execution

This is the core innovation. The flow:

```
User: "Calculate the average of the 'sales' field in the transactions dataset"
                    │
                    ▼
┌─────────────────────────────────────┐
│ 1. Claude reads workspace structure │  ← from system prompt context
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
packages/e3-chat/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point, HTTP server (Hono)
│   ├── chat.ts               # Conversation manager (Anthropic SDK messages loop)
│   ├── system-prompt.ts      # Dynamic system prompt builder (workspace context + types)
│   ├── tools/
│   │   ├── index.ts          # Tool registry and JSON Schema definitions
│   │   ├── workspace.ts      # Workspace management tool handlers
│   │   ├── dataset.ts        # Dataset read/write tool handlers
│   │   ├── task.ts           # Task inspection tool handlers
│   │   ├── execution.ts      # Dataflow execution tool handlers
│   │   ├── package.ts        # Package management tool handlers
│   │   └── adhoc.ts          # Ad-hoc function generation & execution
│   ├── backend/
│   │   ├── index.ts          # Backend interface (local or remote)
│   │   ├── local.ts          # e3-core direct backend
│   │   └── remote.ts         # e3-api-client backend
│   └── util/
│       ├── beast2.ts         # BEAST2 decode/encode for human-readable output
│       ├── types.ts          # East type → JSON Schema / human-readable string
│       └── codegen.ts        # Ad-hoc TypeScript code generation helpers
```

### Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^1.x",
    "@elaraai/e3-core": "*",
    "@elaraai/e3-api-client": "*",
    "@elaraai/e3-types": "*",
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0"
  },
  "peerDependencies": {
    "@elaraai/east": "beta"
  }
}
```

## 6. Connection Modes

The chat server supports two backends via a common interface:

### 6.1 Local Mode (e3-core directly)

```typescript
const chat = createE3Chat({
  mode: 'local',
  repoPath: '/path/to/e3/repo',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});
```

Best for: local development, single-user

### 6.2 Remote Mode (via e3-api-client)

```typescript
const chat = createE3Chat({
  mode: 'remote',
  apiUrl: 'https://e3.example.com',
  repo: 'my-repo',
  auth: { token: process.env.E3_API_TOKEN },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});
```

Best for: team/production use, multi-user web chat

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
| **MCP** (recommended) | Protocol-level tool integration | Works with any MCP client; Linux Foundation standard; adopted by OpenAI, Google, Microsoft; resources + tools + prompts; JSON-RPC 2.0; OAuth 2.1 for remote | Requires MCP-compatible client; stateful protocol adds complexity | Primary integration layer |
| **Claude Programmatic Tool Calling** | LLM writes code to orchestrate tools | Dramatically reduces tokens/latency; intermediate results stay out of context; ideal for large datasets | Requires Anthropic managed containers; not ZDR-eligible | Data-heavy analysis workflows |
| **Claude Tool Use** (Anthropic SDK) | Direct API with function calling | Full UX control; `strict: true` guarantees schema compliance; tool runner automates loop | Must build custom UI; manage conversation state | Custom web/mobile chat app |
| **Claude Agent SDK** (v0.2.71+) | Full agent runtime | Powers Claude Code in production; context compaction; subagents; MCP built-in; skills system | Heavy; pre-1.0; Anthropic-coupled | Complex multi-step workflows |
| **Vercel AI SDK 6** | React-based AI chat framework | `ToolLoopAgent`; `useChat` hook; Generative UI; human-in-the-loop approval; provider-agnostic; 20M+ monthly downloads | TypeScript only; frontend-focused; rapid version churn | Web dashboard/chat UI |
| **OpenAI Agents SDK** | Lightweight agent framework | Handoff pattern for multi-agent; automatic schema gen; built-in tracing; dual Python/TS | OpenAI ecosystem bias; less mature for long-running tasks | Multi-agent orchestration |
| **LangChain/LangGraph** | Graph-based agent orchestration | Model-agnostic; cyclic graphs for retry/self-correction; built-in persistence; LangGraph Studio for debugging | Heavy abstraction; steep learning curve; Python-centric | Complex branching workflows |
| **E2B** | Sandboxed code execution (Firecracker microVMs) | ~150ms startup; Apache-2.0; self-hostable; full filesystem + network | External dependency; cloud-hosted by default | Sandboxed ad-hoc execution |

## 10. Implementation Phases

### Phase 1: Chat Server with Core Tools
- Anthropic SDK integration with tool definitions
- Workspace, dataset, task, and execution tool handlers
- Dynamic system prompt with workspace structure and types
- Local mode (e3-core) backend
- Simple CLI or HTTP endpoint for testing

### Phase 2: Ad-Hoc Execution
- Code generation via SDK approach (Approach A)
- Scratch workspace management
- Type context from system prompt (East types → TypeScript notation)
- Code review/approval flow before execution
- Programmatic-only tools for large dataset access

### Phase 3: Remote Mode + Web UI
- e3-api-client backend
- Vercel AI SDK 6 web frontend (`ToolLoopAgent`, `useChat`)
- Generative UI for dataset tables, dataflow DAGs, execution progress
- SSE streaming for long-running dataflow execution
- Human-in-the-loop approval for destructive operations

### Phase 4: Programmatic Tool Calling + Advanced Features
- Enable Programmatic Tool Calling for data-heavy workflows
- Conversation memory (persist analysis history)
- Generated task promotion (ad-hoc → permanent package)
- Multi-workspace queries
- Visualization generation (charts/tables from results)

## 11. Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary integration | Anthropic SDK + Tool Use | Direct control; Programmatic Tool Calling for data-heavy workflows; `strict: true` schema validation |
| Server framework | Hono (same as e3-api-server) | Consistent with existing codebase; lightweight; supports streaming |
| Web frontend | Vercel AI SDK 6 | `ToolLoopAgent`; `useChat`; Generative UI; provider-agnostic |
| Ad-hoc code gen | TypeScript SDK generation (Approach A) | Best type safety, Claude is excellent at TypeScript, uses existing `@elaraai/e3` SDK |
| Ad-hoc workspace | Dedicated scratch workspace | Safety: doesn't mutate production state; input data copied by hash (cheap) |
| BEAST2 handling | Decode to JSON in MCP tools | Claude can't read binary; present human-readable data |
| Backend | e3-core (local) or e3-api-client (remote) | Flexibility for both local dev and team use |
| Schema exposure | East types → JSON Schema (auto-generated) | East's structural types map naturally to JSON Schema; `strict: true` for validation |
| Large dataset handling | Programmatic Tool Calling | Intermediate results don't enter context; Claude filters/aggregates in code |
| Web UI (if needed) | Vercel AI SDK 6 `ToolLoopAgent` + `useChat` | Best-in-class for React chat UIs; Generative UI for inline rendering |
| Sandboxing | e3's existing runner isolation + optional E2B | e3 already spawns isolated processes; E2B adds Firecracker microVMs if needed |

## 12. East Type System → JSON Schema Mapping

Auto-generating JSON Schema from East types is critical for giving Claude accurate type context. The mapping:

| East Type | JSON Schema | Example |
|-----------|-------------|---------|
| `StringType` | `{ "type": "string" }` | |
| `IntegerType` | `{ "type": "integer" }` | |
| `FloatType` | `{ "type": "number" }` | |
| `BooleanType` | `{ "type": "boolean" }` | |
| `DateTimeType` | `{ "type": "string", "format": "date-time" }` | |
| `ArrayType(T)` | `{ "type": "array", "items": <T> }` | `ArrayType(StringType)` → `{ "type": "array", "items": { "type": "string" } }` |
| `StructType({...})` | `{ "type": "object", "properties": {...} }` | `StructType({ name: StringType, age: IntegerType })` |
| `OptionType(T)` | `{ "oneOf": [<T>, { "type": "null" }] }` | |
| `DictType(K, V)` | `{ "type": "object", "additionalProperties": <V> }` | |
| `VariantType(...)` | `{ "oneOf": [...], "discriminator": "type" }` | |

This mapping should be implemented in `packages/e3-chat/src/util/types.ts` and used to:
1. Generate MCP tool input schemas for `dataset_set`
2. Generate MCP resource descriptions for workspace structure
3. Provide Claude with the full typed context needed for ad-hoc code generation

## 13. Best Practices from Research

### Schema Context for Code Generation
- Include **natural-language descriptions** alongside field names — models perform significantly better with semantic context, not just field names
- Treat schema metadata as code: version-control it alongside the application
- For tools called programmatically, provide detailed **output format descriptions** so Claude can process results in code

### Streaming During Long-Running Operations
- Do **not** stream tool call JSON (users can't parse it) — stream the final content generation
- Use a "gather-generate" pattern: collect tool results silently, then stream the synthesis
- Emit **custom progress events** during long-running tool executions (e.g., dataflow progress: "task 3/7 complete")

### Sandboxed Execution
- e3 already spawns isolated runner processes — extend this model for LLM-generated tasks
- Apply principle of least privilege: ad-hoc tasks should have no network access by default
- Container reuse across related requests reduces startup overhead
