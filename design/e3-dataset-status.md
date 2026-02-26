# Dataset Status

Enriching dataset metadata visibility across the tree view, listing, and a new per-dataset status command.

## Motivation

Currently, dataset metadata is scattered across multiple commands:
- `e3 list` shows field names only
- `e3 tree --types` shows names and types
- `e3 workspace status` shows assignment status, hash, and producer — but not type or size
- `e3 get` downloads the full value

There is no way to answer "is this dataset set and how big is it?" without downloading the entire value. The `DatasetListItem` type already has `hash` and `size` fields but they are stubbed out as `none`.

## Design

### Principle: the tree walk is the natural place

The tree walk co-traverses Structure (schema) and DataRef (data) simultaneously. At every leaf node, we already have in hand:

- **Type** — from `childStructure.value` (the East type in the Structure)
- **Assignment** — from `childRef.type` (`unassigned` / `null` / `value`)
- **Hash** — from `childRef.value` (the object hash, if assigned)

The only additional I/O is **size**, which requires a lightweight stat call per assigned dataset.

Rather than building separate metadata pathways, we enrich the tree walk and derive everything from it.

### 1. `ObjectStore.stat()` method

Add a `stat` method to the `ObjectStore` interface:

```ts
stat(repo: string, hash: string): Promise<{ size: number }>;
```

For local storage: `fs.stat()` on the object file.
For S3: `HeadObject`.

This avoids reading the entire blob just to get its byte count.

### 2. Enrich `TreeLeafNode`

Add metadata fields to the tree walk's leaf node:

```ts
export interface TreeLeafNode {
  name: string;
  kind: 'dataset';
  datasetType?: EastTypeValue;  // existing (opt-in via includeTypes)
  hash?: string;                // new: object hash (if assigned)
  refType?: string;             // new: 'unassigned' | 'null' | 'value'
  size?: number;                // new: byte count (if assigned)
}
```

The `walkTree` function already has the `DataRef` in scope — it just needs to keep it instead of discarding it. Size requires an `ObjectStore.stat()` call, gated behind a new option flag.

```ts
export interface WorkspaceGetTreeOptions {
  maxDepth?: number;
  includeTypes?: boolean;
  includeStatus?: boolean;   // new: include hash, refType, size
}
```

### 3. Enrich `e3 tree` output

With `includeStatus` (or perhaps by default), the tree view shows assignment and size:

```
dev
├── inputs
│   ├── config (Integer, 42 B)
│   └── model (Float, unset)
├── tasks
│   └── predict (Float, 1.2 KB)
└── outputs
    └── result (String, unset)
```

Types could be shown by default or remain behind `--types`. Assignment status and size are always useful and not verbose, so they should probably be shown by default.

### 4. Enrich `DatasetListItem` (fix existing TODOs)

The recursive list API (`?recursive=true`) already defines `DatasetListItem` with `hash` and `size` fields. Fix the TODOs in `flattenTree` to populate them from the enriched `TreeNode`. When the dataset is unset the bytes can be `.none` and when the dataset is null the bytes can be `.some(0)` (and the hash `.none`).

### 5. `e3 status <repo> <ws.path>` command

Single-dataset status query. Uses the same tree traversal but stops at the target path.

```
$ e3 status . dev.inputs.config
Path:   .inputs.config
Type:   Integer
Status: set
Hash:   a3f8c2d1...
Size:   42 bytes
```

For unset datasets:
```
$ e3 status . dev.inputs.model
Path:   .inputs.model
Type:   Float
Status: unset
```

#### Interaction with existing `e3 status <repo>`

`e3 status .` already shows repository-level status (object count, package count, workspace count). The dataset status command extends this naturally:

- `e3 status .` — repository status (existing)
- `e3 status . dev` — same as `e3 workspace status . dev` (existing workspace status, which could be aliased)
- `e3 status . dev.inputs.config` — dataset status (new)

Alternatively, the dataset-level command could live under `e3 dataset status` or similar if overloading `e3 status` is too much. TBD.

### 6. API endpoint

The dataset status query is served by adding a `?status=true` query parameter to the existing dataset GET endpoint:

```
GET /api/repos/:repo/workspaces/:ws/datasets/:path?status=true
```

Response (BEAST2):
```ts
DatasetStatusDetailType = StructType({
  path: StringType,
  type: EastTypeType,
  status: VariantType({
    unset: NullType,
    null: NullType,
    set: NullType,
  }),
  hash: OptionType(StringType),
  size: OptionType(IntegerType),
});
```

This avoids a new route — the existing dataset endpoint either returns the value (default) or its metadata (`?status=true`).

### 7. `e3 list --long` / `-l`

Tabular view using the enriched recursive listing:

```
$ e3 list . dev.inputs -l
NAME    TYPE     STATUS  SIZE
config  Integer  set     42 B
model   Float    unset   -
```

Uses the recursive list API underneath, formatted as a table at the current tree level.

## Implementation Order

1. ~~Fix `DatasetListItem` TODOs — `ObjectStore.stat()`, enrich `TreeLeafNode`/`walkTree`, populate hash/size~~ **done**
2. ~~`e3 tree` output enrichment — display the new data~~ **done** — status/size always shown on name line, types on continuation line with `--types`
3. ~~`e3 status . ws.path` command + API — single-dataset query~~ **done** — `workspaceGetDatasetStatus` core function, `?status=true` API endpoint, `datasetGetStatus` client, `e3 status <repo> <path>` CLI command
4. ~~Consolidate `e3 list` + `e3 tree` — orthogonal API params~~ **done** — `e3 tree` removed, `e3 list -r` (recursive paths), `e3 list -l` (tabular), `e3 list -r -l` (recursive tabular). API params: `?list=true`, `?recursive=true`, `?status=true` as composable modifiers.

## Resolved Questions

- `e3 tree` was removed; its functionality is now `e3 list -r` (paths) and `e3 list -r -l` (detailed table)
- Dataset status lives under `e3 status . ws.path` (decided in step 3)
- The status variant uses `set`/`null`/`unset` in the tabular output (`-l` flag)
