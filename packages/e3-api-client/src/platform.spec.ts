/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 API platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * Note: These tests require an e3 API server running on localhost:3000.
 * Run `e3 serve` to start the server before running tests.
 */
import { East, none, some } from '@elaraai/east';
import { describeEast, Assert, Console, NodePlatform } from '@elaraai/east-node-std';
import {
  Platform,
  PlatformImpl,
  platform_repo_status,
  platform_workspace_list,
  platform_workspace_create,
  platform_workspace_remove,
  platform_package_list,
} from './platform.js';

// Test server configuration
const TEST_URL = 'http://localhost:3000';
const TEST_WORKSPACE = 'test-platform-spec';

await describeEast('e3 API platform functions', (test) => {
  // ==========================================================================
  // Repository Tests
  // ==========================================================================

  test('repoStatus returns repository information', ($) => {
    $(Console.log('repoStatus returns repository information'));

    const status = $.let(Platform.repoStatus(TEST_URL));

    // Counts should be non-negative
    $(Assert.greaterEqual(status.objectCount, East.value(0n)));
    $(Assert.greaterEqual(status.packageCount, East.value(0n)));
    $(Assert.greaterEqual(status.workspaceCount, East.value(0n)));
  });

  // ==========================================================================
  // Package Tests
  // ==========================================================================

  test('packageList returns array of packages', ($) => {
    $(Console.log('packageList returns array of packages'));

    const packages = $.let(Platform.packageList(TEST_URL));

    // Should return an array (possibly empty)
    $(Assert.greaterEqual(packages.size(), East.value(0n)));
  });

  // ==========================================================================
  // Workspace Tests
  // ==========================================================================

  test('workspaceList returns array of workspaces', ($) => {
    $(Console.log('workspaceList returns array of workspaces'));

    const workspaces = $.let(Platform.workspaceList(TEST_URL));

    // Should return an array (possibly empty)
    $(Assert.greaterEqual(workspaces.size(), East.value(0n)));
  });

  test('workspaceCreate creates a new workspace', ($) => {
    $(Console.log('workspaceCreate creates a new workspace'));

    // Create workspace
    const workspace = $.let(Platform.workspaceCreate(TEST_URL, TEST_WORKSPACE));

    // Verify name matches
    $(Assert.equal(workspace.name, East.value(TEST_WORKSPACE)));

    // Not deployed yet
    $(Assert.equal(workspace.deployed, East.value(false)));

    // Clean up - remove workspace
    $(Platform.workspaceRemove(TEST_URL, TEST_WORKSPACE));
  });

  test('workspaceStatus returns comprehensive status', ($) => {
    $(Console.log('workspaceStatus returns comprehensive status'));

    // Create workspace first
    $(Platform.workspaceCreate(TEST_URL, TEST_WORKSPACE));

    // Get status
    const status = $.let(Platform.workspaceStatus(TEST_URL, TEST_WORKSPACE));

    // Verify workspace name
    $(Assert.equal(status.workspace, East.value(TEST_WORKSPACE)));

    // Clean up
    $(Platform.workspaceRemove(TEST_URL, TEST_WORKSPACE));
  });

  test('workspaceRemove removes a workspace', ($) => {
    $(Console.log('workspaceRemove removes a workspace'));

    // Create workspace
    $(Platform.workspaceCreate(TEST_URL, TEST_WORKSPACE));

    // Get initial list
    const beforeList = $.let(Platform.workspaceList(TEST_URL));
    const beforeCount = $.let(beforeList.size());

    // Remove workspace
    $(Platform.workspaceRemove(TEST_URL, TEST_WORKSPACE));

    // Get final list
    const afterList = $.let(Platform.workspaceList(TEST_URL));
    const afterCount = $.let(afterList.size());

    // Count should decrease by 1
    $(Assert.equal(afterCount, beforeCount.subtract(East.value(1n))));
  });

  // ==========================================================================
  // Dataset Tests
  // ==========================================================================

  test('datasetList returns field names at root', ($) => {
    $(Console.log('datasetList returns field names at root'));

    // Create workspace
    $(Platform.workspaceCreate(TEST_URL, TEST_WORKSPACE));

    // List datasets at root (should be empty or have default fields)
    const fields = $.let(Platform.datasetList(TEST_URL, TEST_WORKSPACE));

    // Should return an array
    $(Assert.greaterEqual(fields.size(), East.value(0n)));

    // Clean up
    $(Platform.workspaceRemove(TEST_URL, TEST_WORKSPACE));
  });

  // ==========================================================================
  // Task Tests
  // ==========================================================================

  test('taskList returns empty array for undeployed workspace', ($) => {
    $(Console.log('taskList returns empty array for undeployed workspace'));

    // Create workspace (not deployed)
    $(Platform.workspaceCreate(TEST_URL, TEST_WORKSPACE));

    // List tasks (should be empty since not deployed)
    const tasks = $.let(Platform.taskList(TEST_URL, TEST_WORKSPACE));

    // Should be empty
    $(Assert.equal(tasks.size(), East.value(0n)));

    // Clean up
    $(Platform.workspaceRemove(TEST_URL, TEST_WORKSPACE));
  });

  // ==========================================================================
  // Execution Tests
  // ==========================================================================

  test('dataflowGraph returns empty graph for undeployed workspace', ($) => {
    $(Console.log('dataflowGraph returns empty graph for undeployed workspace'));

    // Create workspace (not deployed)
    $(Platform.workspaceCreate(TEST_URL, TEST_WORKSPACE));

    // Get graph (should be empty since not deployed)
    const graph = $.let(Platform.dataflowGraph(TEST_URL, TEST_WORKSPACE));

    // Should have no tasks
    $(Assert.equal(graph.tasks.size(), East.value(0n)));

    // Clean up
    $(Platform.workspaceRemove(TEST_URL, TEST_WORKSPACE));
  });

  test('dataflowExecute completes on empty workspace', ($) => {
    $(Console.log('dataflowExecute completes on empty workspace'));

    // Create workspace (not deployed)
    $(Platform.workspaceCreate(TEST_URL, TEST_WORKSPACE));

    // Execute (should complete immediately with no tasks)
    const result = $.let(
      Platform.dataflowExecute(TEST_URL, TEST_WORKSPACE, {
        concurrency: none,
        force: false,
        filter: none,
      })
    );

    // Should succeed
    $(Assert.equal(result.success, East.value(true)));

    // No tasks executed
    $(Assert.equal(result.executed, East.value(0n)));

    // Clean up
    $(Platform.workspaceRemove(TEST_URL, TEST_WORKSPACE));
  });
}, {
  platformFns: [...PlatformImpl, ...NodePlatform],
});
