/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 list command - List workspaces or tree contents
 *
 * Usage:
 *   e3 list .                    # List all workspaces
 *   e3 list . ws                 # List root tree of workspace
 *   e3 list . ws -r              # All descendant dataset paths
 *   e3 list . ws -l              # Immediate children with type/status/size
 *   e3 list . ws -r -l           # All descendants with type/status/size
 */

import {
  workspaceList,
  workspaceListTree,
  workspaceGetState,
  workspaceGetTree,
  LocalStorage,
  type TreeNode,
  type TreeLeafNode,
} from '@elaraai/e3-core';
import {
  workspaceList as workspaceListRemote,
  datasetList as datasetListRemote,
  datasetListAt as datasetListAtRemote,
  datasetListRecursive as datasetListRecursiveRemote,
  datasetListRecursivePaths as datasetListRecursivePathsRemote,
  datasetListWithStatus as datasetListWithStatusRemote,
  type ListEntry,
} from '@elaraai/e3-api-client';
import { printFor, EastTypeType } from '@elaraai/east';
import { parseRepoLocation, parseDatasetPath, formatError, exitError } from '../utils.js';
import { formatSize } from '../format.js';

const printTypeValue = printFor(EastTypeType);

interface ListOptions {
  recursive?: boolean;
  long?: boolean;
}

/** Flatten tree nodes to collect leaf paths. */
function collectPaths(nodes: TreeNode[], prefix: string, result: string[]): void {
  for (const node of nodes) {
    const path = prefix ? `${prefix}.${node.name}` : `.${node.name}`;
    if (node.kind === 'dataset') {
      result.push(path);
    } else if (node.kind === 'tree') {
      collectPaths(node.children, path, result);
    }
  }
}

/** Info for tabular display. */
interface TableRow {
  name: string;
  type: string;
  status: string;
  size: string;
}

/** Derive status string from a tree leaf node. */
function leafStatus(node: TreeLeafNode): string {
  if (node.refType === undefined) return '-';
  if (node.refType === 'unassigned') return 'unset';
  if (node.refType === 'null') return 'null';
  return 'set';
}

/** Derive size string from a tree leaf node. */
function leafSize(node: TreeLeafNode): string {
  if (node.refType === 'unassigned') return '-';
  if (node.refType === 'null') return '0 B';
  if (node.size !== undefined) return formatSize(node.size);
  return '-';
}

/** Format type from a tree leaf node. */
function leafType(node: TreeLeafNode): string {
  if (!node.datasetType) return '-';
  try {
    return printTypeValue(node.datasetType);
  } catch {
    return '?';
  }
}

/** Flatten tree to table rows (recursive), including tree entries. */
function collectRows(nodes: TreeNode[], prefix: string, result: TableRow[]): void {
  for (const node of nodes) {
    const path = prefix ? `${prefix}.${node.name}` : `.${node.name}`;
    if (node.kind === 'dataset') {
      result.push({
        name: path,
        type: leafType(node),
        status: leafStatus(node),
        size: leafSize(node),
      });
    } else if (node.kind === 'tree') {
      result.push({ name: path, type: '(tree)', status: '-', size: '-' });
      collectRows(node.children, path, result);
    }
  }
}

/** Collect immediate children as rows (both datasets and trees). */
function collectImmediateRows(nodes: TreeNode[], prefix: string, result: TableRow[]): void {
  for (const node of nodes) {
    if (node.kind === 'dataset') {
      result.push({
        name: node.name,
        type: leafType(node),
        status: leafStatus(node),
        size: leafSize(node),
      });
    } else if (node.kind === 'tree') {
      result.push({ name: node.name, type: '(tree)', status: '-', size: '-' });
    }
  }
}

/** Convert a ListEntry variant to a table row. */
function entryToRow(entry: ListEntry, usePath: boolean): TableRow {
  if (entry.type === 'tree') {
    const name = usePath ? entry.value.path : entry.value.path.split('.').pop()!;
    return { name, type: '(tree)', status: '-', size: '-' };
  }

  // entry.type === 'dataset'
  const item = entry.value;
  let typeStr: string;
  try {
    typeStr = printTypeValue(item.type);
  } catch {
    typeStr = '?';
  }

  let status: string;
  let size: string;
  if (item.hash.type === 'none' && item.size.type === 'none') {
    status = 'unset';
    size = '-';
  } else if (item.size.type === 'some' && item.size.value === 0n) {
    status = 'null';
    size = '0 B';
  } else {
    status = 'set';
    size = item.size.type === 'some' ? formatSize(Number(item.size.value)) : '-';
  }

  return {
    name: usePath ? item.path : item.path.split('.').pop()!,
    type: typeStr,
    status,
    size,
  };
}

/** Print rows as a padded table. */
function printTable(rows: TableRow[], nameHeader: string): void {
  if (rows.length === 0) {
    console.log('(empty)');
    return;
  }

  // Calculate column widths
  const nameWidth = Math.max(nameHeader.length, ...rows.map(r => r.name.length));
  const typeWidth = Math.max(4, ...rows.map(r => r.type.length));
  const statusWidth = Math.max(6, ...rows.map(r => r.status.length));
  const sizeWidth = Math.max(4, ...rows.map(r => r.size.length));

  // Print header
  console.log(
    `${nameHeader.padEnd(nameWidth)}  ${('TYPE').padEnd(typeWidth)}  ${('STATUS').padEnd(statusWidth)}  ${('SIZE').padEnd(sizeWidth)}`
  );

  // Print rows
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(nameWidth)}  ${row.type.padEnd(typeWidth)}  ${row.status.padEnd(statusWidth)}  ${row.size.padEnd(sizeWidth)}`
    );
  }
}

/**
 * List workspaces or tree contents at a path.
 */
export async function listCommand(repoArg: string, pathSpec: string | undefined, options: ListOptions): Promise<void> {
  try {
    const location = await parseRepoLocation(repoArg);
    const recursive = options.recursive ?? false;
    const long = options.long ?? false;

    // If no path, list workspaces
    if (!pathSpec) {
      if (location.type === 'local') {
        const storage = new LocalStorage();
        const workspaces = await workspaceList(storage, location.path);

        if (workspaces.length === 0) {
          console.log('No workspaces');
          return;
        }

        for (const ws of workspaces) {
          const state = await workspaceGetState(storage, location.path, ws);
          if (state) {
            console.log(`${ws}  (${state.packageName}@${state.packageVersion})`);
          } else {
            console.log(`${ws}  (not deployed)`);
          }
        }
      } else {
        // Remote: list workspaces
        const workspaces = await workspaceListRemote(
          location.baseUrl,
          location.repo,
          { token: location.token }
        );

        if (workspaces.length === 0) {
          console.log('No workspaces');
          return;
        }

        for (const ws of workspaces) {
          if (ws.deployed && ws.packageName.type === 'some' && ws.packageVersion.type === 'some') {
            console.log(`${ws.name}  (${ws.packageName.value}@${ws.packageVersion.value})`);
          } else {
            console.log(`${ws.name}  (not deployed)`);
          }
        }
      }
      return;
    }

    // Parse path
    const { ws, path } = parseDatasetPath(pathSpec);

    // -r -l: recursive with details
    if (recursive && long) {
      if (location.type === 'local') {
        const storage = new LocalStorage();
        const nodes = await workspaceGetTree(storage, location.path, ws, path, {
          includeTypes: true,
          includeStatus: true,
        });
        const rows: TableRow[] = [];
        const prefix = path.length > 0 ? '.' + path.map(s => s.value).join('.') : '';
        collectRows(nodes, prefix, rows);
        printTable(rows, 'PATH');
      } else {
        const items = await datasetListRecursiveRemote(
          location.baseUrl, location.repo, ws, path,
          { token: location.token }
        );
        const rows = items.map(item => entryToRow(item, true));
        printTable(rows, 'PATH');
      }
      return;
    }

    // -r: recursive paths only
    if (recursive) {
      if (location.type === 'local') {
        const storage = new LocalStorage();
        const nodes = await workspaceGetTree(storage, location.path, ws, path, {
          includeTypes: false,
          includeStatus: false,
        });
        const paths: string[] = [];
        const prefix = path.length > 0 ? '.' + path.map(s => s.value).join('.') : '';
        collectPaths(nodes, prefix, paths);
        if (paths.length === 0) {
          console.log('(empty)');
          return;
        }
        for (const p of paths) {
          console.log(p);
        }
      } else {
        const paths = await datasetListRecursivePathsRemote(
          location.baseUrl, location.repo, ws, path,
          { token: location.token }
        );
        if (paths.length === 0) {
          console.log('(empty)');
          return;
        }
        for (const p of paths) {
          console.log(p);
        }
      }
      return;
    }

    // -l: immediate children with details
    if (long) {
      if (location.type === 'local') {
        const storage = new LocalStorage();
        const nodes = await workspaceGetTree(storage, location.path, ws, path, {
          maxDepth: 0,
          includeTypes: true,
          includeStatus: true,
        });
        const rows: TableRow[] = [];
        collectImmediateRows(nodes, '', rows);
        printTable(rows, 'NAME');
      } else {
        const items = await datasetListWithStatusRemote(
          location.baseUrl, location.repo, ws, path,
          { token: location.token }
        );
        const rows = items.map(item => entryToRow(item, false));
        printTable(rows, 'NAME');
      }
      return;
    }

    // Default: list field names (unchanged)
    let fields: string[];
    if (location.type === 'local') {
      const storage = new LocalStorage();
      fields = await workspaceListTree(storage, location.path, ws, path);
    } else {
      if (path.length === 0) {
        fields = await datasetListRemote(
          location.baseUrl, location.repo, ws,
          { token: location.token }
        );
      } else {
        fields = await datasetListAtRemote(
          location.baseUrl, location.repo, ws, path,
          { token: location.token }
        );
      }
    }

    if (fields.length === 0) {
      console.log('(empty)');
      return;
    }

    for (const field of fields) {
      console.log(field);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
