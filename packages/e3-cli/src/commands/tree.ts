/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 tree command - Show full tree structure of a workspace
 *
 * Usage:
 *   e3 tree . dev                 # Full tree for workspace
 *   e3 tree . dev.tasks           # Tree from subtree
 *   e3 tree . dev --depth 2       # Limit depth
 *   e3 tree . dev --types         # Show dataset types
 */

import { workspaceGetTree, type TreeNode, LocalStorage } from '@elaraai/e3-core';
import { printFor, EastTypeType } from '@elaraai/east';
import { resolveRepo, parseDatasetPath, formatError, exitError } from '../utils.js';

// Printer for type values (decoded types are EastTypeValue, not EastType)
const printTypeValue = printFor(EastTypeType);

interface TreeOptions {
  depth?: string;
  types?: boolean;
}

/**
 * Render tree nodes with box-drawing characters.
 */
function renderTree(nodes: TreeNode[], prefix: string = '', showTypes: boolean = false): string[] {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    // Format node name with optional type
    let nodeName = node.name;
    if (showTypes && node.kind === 'dataset' && node.datasetType) {
      try {
        nodeName += ` (${printTypeValue(node.datasetType)})`;
      } catch {
        nodeName += ' (?)';
      }
    }

    lines.push(prefix + connector + nodeName);

    // Recurse into children (only tree nodes have children)
    if (node.kind === 'tree' && node.children.length > 0) {
      const childLines = renderTree(node.children, prefix + childPrefix, showTypes);
      lines.push(...childLines);
    }
  }

  return lines;
}

/**
 * Show full tree structure of a workspace.
 */
export async function treeCommand(
  repoArg: string,
  pathSpec: string,
  options: TreeOptions
): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);
    const storage = new LocalStorage();
    const { ws, path } = parseDatasetPath(pathSpec);

    const maxDepth = options.depth !== undefined ? parseInt(options.depth, 10) : undefined;
    const includeTypes = options.types ?? false;

    const nodes = await workspaceGetTree(storage, repoPath, ws, path, {
      maxDepth,
      includeTypes,
    });

    if (nodes.length === 0) {
      console.log('(empty)');
      return;
    }

    // Print root path
    console.log(pathSpec);

    // Render and print tree
    const lines = renderTree(nodes, '', includeTypes);
    for (const line of lines) {
      console.log(line);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
