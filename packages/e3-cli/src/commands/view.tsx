/**
 * e3 view command - Interactive data viewer for East values
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { decodeBeast2, parseInferred, printFor, toEastTypeValue, EastTypeValueType } from '@elaraai/east';
import { Error as ErrorMessage } from '../ui/index.js';

/**
 * Input format type
 */
type InputFormat = 'east' | 'json' | 'beast2';

/**
 * Tree node structure
 */
type TreeNode = {
  key: string;           // Field name, array index, or "root"
  value: any;            // Actual East value
  type: any;             // EastType
  expanded: boolean;     // Expansion state
  children?: TreeNode[]; // For composite types
  depth: number;         // Indentation level
  path: string[];        // Path from root
};

/**
 * Viewer state
 */
type ViewerState = {
  tree: TreeNode;
  cursorIndex: number;      // Index in flattened tree
  flatTree: TreeNode[];     // Flattened view of visible nodes
  detailMinimized: boolean;
};

/**
 * Flatten tree into navigable list (only visible nodes)
 */
function flattenTree(node: TreeNode, result: TreeNode[] = []): TreeNode[] {
  result.push(node);
  if (node.expanded && node.children) {
    for (const child of node.children) {
      flattenTree(child, result);
    }
  }
  return result;
}

/**
 * Load data from file or stdin
 */
async function loadData(
  inputPath: string | null,
  fromFormat?: InputFormat
): Promise<{ type: any; value: any }> {
  let inputData: Buffer;
  let detectedFormat: InputFormat;

  if (inputPath === null) {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    inputData = Buffer.concat(chunks);

    // Detect format if not specified
    if (fromFormat) {
      detectedFormat = fromFormat;
    } else {
      if (inputData.length > 0 && inputData[0] === 0x42) {
        detectedFormat = 'beast2';
      } else {
        // Default to .east for text input
        detectedFormat = 'east';
      }
    }
  } else {
    // Read from file
    inputData = await fs.readFile(inputPath);

    if (fromFormat) {
      detectedFormat = fromFormat;
    } else {
      // Detect from extension
      const ext = inputPath.slice(inputPath.lastIndexOf('.'));
      if (ext === '.east') {
        detectedFormat = 'east';
      } else if (ext === '.json') {
        detectedFormat = 'json';
      } else if (ext === '.beast2') {
        detectedFormat = 'beast2';
      } else {
        throw new Error(`Cannot detect format from extension: ${ext}`);
      }
    }
  }

  // Parse based on format
  if (detectedFormat === 'beast2') {
    const decoded = decodeBeast2(inputData);
    return { type: decoded.type, value: decoded.value };
  } else if (detectedFormat === 'east') {
    const content = inputData.toString('utf-8');
    const [eastType, value] = parseInferred(content);
    // Convert EastType to EastTypeValue for consistent handling
    const type = toEastTypeValue(eastType);
    return { type, value };
  } else {
    throw new Error('JSON format not yet supported in viewer');
  }
}

/**
 * Build tree structure from East value
 */
function buildTree(
  key: string,
  value: any,
  type: any,
  depth: number = 0,
  path: string[] = []
): TreeNode {
  const node: TreeNode = {
    key,
    value,
    type,
    expanded: depth === 0, // Root is expanded by default
    depth,
    path,
  };

  // Determine if this node has children
  const typeStr = type.type || '';

  if (typeStr === 'Struct' && value && typeof value === 'object' && !Array.isArray(value)) {
    // Struct: create child nodes for each field
    // EastTypeValue: type.value is an array of {name, type} objects
    const fieldTypes: Record<string, any> = {};
    if (Array.isArray(type.value)) {
      for (const field of type.value) {
        if (field.name && field.type) {
          fieldTypes[field.name] = field.type;
        }
      }
    }

    node.children = Object.entries(value).map(([fieldKey, fieldValue]) =>
      buildTree(
        fieldKey,
        fieldValue,
        fieldTypes[fieldKey] || { type: 'Unknown' },
        depth + 1,
        [...path, fieldKey]
      )
    );
  } else if (typeStr === 'Array' && Array.isArray(value)) {
    // Array: create child nodes for each element
    // EastTypeValue: type.value is the element type
    const elementType = type.value || { type: 'Unknown' };
    node.children = value.map((item, index) =>
      buildTree(
        `[${index}]`,
        item,
        elementType,
        depth + 1,
        [...path, String(index)]
      )
    );
  }
  // TODO: Add Dict support

  return node;
}

/**
 * Update tree to mark a node as expanded/collapsed
 */
function updateTreeExpansion(node: TreeNode, targetPath: string[], expand: boolean): TreeNode {
  if (node.path.join('.') === targetPath.join('.')) {
    return { ...node, expanded: expand };
  }

  if (node.children) {
    return {
      ...node,
      children: node.children.map(child => updateTreeExpansion(child, targetPath, expand))
    };
  }

  return node;
}

/**
 * Viewer component
 */
function Viewer({ initialTree, fullscreen, sourcePath }: { initialTree: TreeNode; fullscreen?: boolean; sourcePath: string }) {
  const { exit } = useApp();
  const [tree, setTree] = useState(initialTree);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [detailMinimized, setDetailMinimized] = useState(false);

  // Flatten tree for navigation
  const flatTree = flattenTree(tree);
  const selectedNode = flatTree[cursorIndex] || tree;

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
    } else if (input === 'd') {
      setDetailMinimized(!detailMinimized);
    } else if (key.upArrow || input === 'k') {
      // Move cursor up
      setCursorIndex(Math.max(0, cursorIndex - 1));
    } else if (key.downArrow || input === 'j') {
      // Move cursor down
      setCursorIndex(Math.min(flatTree.length - 1, cursorIndex + 1));
    } else if (key.rightArrow || key.return || input === ' ') {
      // Expand current node
      const node = flatTree[cursorIndex];
      if (node && node.children && node.children.length > 0) {
        setTree(updateTreeExpansion(tree, node.path, true));
      }
    } else if (key.leftArrow || key.delete) {
      // Collapse current node
      const node = flatTree[cursorIndex];
      if (node && node.children && node.children.length > 0) {
        setTree(updateTreeExpansion(tree, node.path, false));
      }
    }
  });

  return (
    <Box flexDirection="column" minHeight={fullscreen ? process.stdout.rows - 1 : undefined}>
      {/* Title bar */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">{sourcePath}</Text>
      </Box>

      {/* Main content area */}
      <Box flexGrow={1} flexDirection="row">
        {/* Tree pane */}
        <Box
          flexDirection="column"
          width={detailMinimized ? '100%' : '40%'}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold color="cyan">Tree Navigator</Text>
          <Text dimColor>─────────────</Text>
          <TreeView node={tree} selectedPath={selectedNode.path} />
        </Box>

        {/* Detail pane */}
        {!detailMinimized && (
          <Box
            flexDirection="column"
            flexGrow={1}
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
          >
            <Text bold color="cyan">Detail View</Text>
            <Text dimColor>─────────────</Text>
            <DetailView node={selectedNode} />
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          ↑/↓ or j/k: Navigate | →/Enter: Expand | ←: Collapse | d: Toggle detail | q: Quit
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Tree view component - renders the tree structure
 */
function TreeView({ node, selectedPath }: { node: TreeNode; selectedPath: string[] }) {
  return (
    <Box flexDirection="column">
      <TreeNodeView node={node} selectedPath={selectedPath} />
    </Box>
  );
}

/**
 * Single tree node view
 */
function TreeNodeView({ node, selectedPath }: { node: TreeNode; selectedPath: string[] }) {
  const indent = '  '.repeat(node.depth);
  const hasChildren = node.children && node.children.length > 0;
  const icon = hasChildren ? (node.expanded ? '▼' : '▶') : '•';
  const isSelected = node.path.join('.') === selectedPath.join('.');

  // Get type string
  let typeStr = 'Unknown';
  try {
    if (node.type.type && node.type.type !== 'Unknown') {
      typeStr = node.type.type;
    }
  } catch (error) {
    typeStr = 'Unknown';
  }

  let label = `${node.key}`;

  if (hasChildren) {
    const count = node.children!.length;
    const unit = typeStr === 'Array' ? 'items' : 'fields';
    label += ` [${typeStr}, ${count} ${unit}]`;
  } else {
    // Show value for primitives
    let valuePreview = String(node.value);
    if (valuePreview.length > 30) {
      valuePreview = valuePreview.slice(0, 27) + '...';
    }
    if (typeStr === 'String') {
      valuePreview = `"${valuePreview}"`;
    }
    label += `: ${valuePreview} (${typeStr})`;
  }

  return (
    <Box flexDirection="column">
      <Text backgroundColor={isSelected ? 'blue' : undefined} inverse={isSelected}>
        {indent}{isSelected ? '→ ' : ''}{icon} {label}
      </Text>
      {node.expanded && node.children && (
        <Box flexDirection="column">
          {node.children.map((child) => (
            <TreeNodeView key={child.path.join('.')} node={child} selectedPath={selectedPath} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Detail view component - shows details of selected node
 */
function DetailView({ node }: { node: TreeNode }) {
  // Print EastTypeValue using printFor(EastTypeValueType)
  let typeString: string;
  try {
    if (node.type.type === 'Unknown') {
      typeString = 'Unknown';
    } else {
      const typePrinter = printFor(EastTypeValueType);
      typeString = typePrinter(node.type);
    }
  } catch (error) {
    typeString = 'Unknown';
  }

  // Print value using printFor(type)
  let valueString: string;
  try {
    if (node.type.type === 'Unknown') {
      valueString = String(node.value);
    } else {
      const valuePrinter = printFor(node.type);
      valueString = valuePrinter(node.value);
    }
  } catch (error) {
    valueString = String(node.value);
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Type: </Text>
        <Text color="yellow">{typeString}</Text>
      </Text>
      <Text> </Text>
      <Text bold>Content:</Text>
      <Text>{valueString}</Text>
    </Box>
  );
}

/**
 * CLI handler for the view command
 */
export async function viewData(
  inputPath: string | undefined,
  fromFormat?: InputFormat,
  fullscreen?: boolean
): Promise<void> {
  try {
    // Load data
    const actualInputPath = inputPath === undefined || inputPath === '-' ? null : inputPath;
    const { type, value } = await loadData(actualInputPath, fromFormat);

    // Build tree
    const tree = buildTree('root', value, type);

    // Determine source path for display
    const sourcePath = actualInputPath === null ? '<stdin>' : path.resolve(actualInputPath);

    // Render viewer
    render(<Viewer initialTree={tree} fullscreen={fullscreen} sourcePath={sourcePath} />);
  } catch (error: any) {
    render(
      <ErrorMessage
        message={`Failed to view data: ${error.message}`}
      />
    );
    process.exit(1);
  }
}
