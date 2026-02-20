/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataflow execution test suite.
 *
 * Tests: start, execute (blocking), poll for completion, logs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceStatus,
  dataflowStart,
  dataflowExecute,
  dataflowExecution,
  dataflowCancel,
  dataflowGraph,
  taskLogs,
  ApiError,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import {
  createPackageZip,
  createDiamondPackageZip,
  createFailingPackageZip,
  createSlowPackageZip,
  createParallelMixedPackageZip,
  createFailingDiamondPackageZip,
  createWideParallelPackageZip,
} from '../fixtures.js';

/** Helper: import package, create workspace, deploy */
function withDeployed(
  setup: TestSetup<TestContext>,
  createZip: (tempDir: string, name: string, version: string, ...args: never[]) => Promise<string>,
  pkgName: string,
  wsName: string,
): TestSetup<TestContext> {
  return async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();

    const zipPath = await createZip(ctx.tempDir, pkgName, '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, wsName, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, wsName, `${pkgName}@1.0.0`, opts);

    return ctx;
  };
}

/**
 * Register dataflow execution tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function dataflowTests(setup: TestSetup<TestContext>): void {
  const withSimpleExec = withDeployed(setup, createPackageZip, 'exec-pkg', 'exec-ws');
  const withDiamond = withDeployed(setup, createDiamondPackageZip, 'diamond-pkg', 'diamond-ws');
  const withFailing = withDeployed(setup, createFailingPackageZip, 'fail-pkg', 'fail-ws');
  const withMixed = withDeployed(setup, createParallelMixedPackageZip, 'mixed-pkg', 'mixed-ws');
  const withFailingDiamond = withDeployed(setup, createFailingDiamondPackageZip, 'fdiamond-pkg', 'fdiamond-ws');
  const withWideParallel: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createWideParallelPackageZip(ctx.tempDir, 'wide-pkg', '1.0.0', 6);
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'wide-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'wide-ws', 'wide-pkg@1.0.0', opts);
    return ctx;
  };
  const withSlow: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createSlowPackageZip(ctx.tempDir, 'slow-pkg', '1.0.0', 30);
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'slow-ws', 'slow-pkg@1.0.0', opts);
    return ctx;
  };
  const withNoExec = withDeployed(setup, createPackageZip, 'noexec-pkg', 'noexec-ws');
  const withCache = withDeployed(setup, createPackageZip, 'cache-pkg', 'cache-ws');
  const withFilter = withDeployed(setup, createDiamondPackageZip, 'filter-pkg', 'filter-ws');
  const withGraph = withDeployed(setup, createDiamondPackageZip, 'graph-pkg', 'graph-ws');
  const withLogPag = withDeployed(setup, createPackageZip, 'logpag-pkg', 'logpag-ws');
  const withEvtPag = withDeployed(setup, createDiamondPackageZip, 'evtpag-pkg', 'evtpag-ws');

  describe('dataflow', { concurrency: true }, () => {
    describe('simple execution', { concurrency: true }, () => {
      it('dataflowExecute runs tasks and returns result (blocking)', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts);

        // Verify execution result
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.executed, 1n);
        assert.strictEqual(result.failed, 0n);
        assert.strictEqual(result.tasks.length, 1);
        assert.strictEqual(result.tasks[0].name, 'compute');
        assert.strictEqual(result.tasks[0].state.type, 'success');

        // Verify workspace status reflects completion
        const status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'exec-ws', opts);
        const task = status.tasks[0];
        assert.strictEqual(task.name, 'compute');
        assert.strictEqual(task.status.type, 'up-to-date');

        const outputDataset = status.datasets.find(d => d.path === '.tasks.compute.output');
        assert.ok(outputDataset, 'Output dataset .tasks.compute.output should exist');
        assert.strictEqual(outputDataset.status.type, 'up-to-date');
      });

      it('dataflowStart triggers execution (non-blocking)', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();

        // Should return immediately
        await dataflowStart(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts);

        // Poll until execution completes
        const maxWait = 10000;
        const startTime = Date.now();
        let status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'exec-ws', opts);

        while (Date.now() - startTime < maxWait) {
          status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'exec-ws', opts);
          const { upToDate } = status.summary.tasks;
          // Done when task is up-to-date
          if (upToDate === 1n) {
            break;
          }
          await new Promise(r => setTimeout(r, 100));
        }

        // Verify execution completed
        assert.strictEqual(status.tasks[0].status.type, 'up-to-date');
      });

      it('dataflowExecution returns execution state', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();

        // Start execution
        await dataflowStart(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts);

        // Poll execution state until complete
        const maxWait = 10000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const state = await dataflowExecution(ctx.config.baseUrl, ctx.repoName, 'exec-ws', {}, opts);

          if (state.status.type === 'completed') {
            assert.ok(state.summary, 'completed execution should have summary');
            assert.strictEqual(state.summary.type, 'some');
            if (state.summary.type === 'some') {
              assert.strictEqual(state.summary.value.executed, 1n);
              assert.strictEqual(state.summary.value.failed, 0n);
            }
            return; // Test passed
          }

          if (state.status.type === 'failed') {
            assert.fail('Execution should not have failed');
          }

          await new Promise(r => setTimeout(r, 100));
        }

        assert.fail('Execution did not complete in time');
      });

      it('taskLogs returns logs after execution', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();

        // Execute first
        await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts);

        // Get logs
        const logs = await taskLogs(ctx.config.baseUrl, ctx.repoName, 'exec-ws', 'compute', { stream: 'stdout' }, opts);

        // Logs should be returned (may be empty for simple tasks)
        assert.ok(typeof logs.data === 'string');
        assert.ok(typeof logs.offset === 'bigint');
        assert.ok(typeof logs.size === 'bigint');
        assert.ok(typeof logs.totalSize === 'bigint');
        assert.ok(typeof logs.complete === 'boolean');
      });
    });

    describe('diamond dependency execution', { concurrency: true }, () => {
      it('executes diamond dependency graph correctly', async (t) => {
        const ctx = await withDiamond(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'diamond-ws', { force: true }, opts);

        // Should execute all three tasks
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.executed, 3n);
        assert.strictEqual(result.failed, 0n);
        assert.strictEqual(result.tasks.length, 3);

        // Verify all tasks succeeded
        for (const task of result.tasks) {
          assert.strictEqual(task.state.type, 'success', `Task ${task.name} should succeed`);
        }
      });

      it('tracks events during execution', async (t) => {
        const ctx = await withDiamond(t);
        const opts = await ctx.opts();

        // Start execution
        await dataflowStart(ctx.config.baseUrl, ctx.repoName, 'diamond-ws', { force: true }, opts);

        // Poll and collect events
        const events: unknown[] = [];
        const maxWait = 10000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const state = await dataflowExecution(
            ctx.config.baseUrl,
            ctx.repoName,
            'diamond-ws',
            { offset: events.length },
            opts
          );

          // Collect new events
          events.push(...state.events);

          if (state.status.type === 'completed' || state.status.type === 'failed') {
            break;
          }

          await new Promise(r => setTimeout(r, 100));
        }

        // Should have events for all tasks (start + complete for each)
        // Diamond has 3 tasks: left, right, merge
        // Expect at least 3 complete events
        const completeEvents = events.filter((e: unknown) =>
          typeof e === 'object' && e !== null && 'type' in e && (e as { type: string }).type === 'complete'
        );
        assert.ok(completeEvents.length >= 3, `Expected at least 3 complete events, got ${completeEvents.length}`);
      });
    });

    describe('failed execution', { concurrency: true }, () => {
      it('dataflowExecute returns failure result when task fails', async (t) => {
        const ctx = await withFailing(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fail-ws', { force: true }, opts);

        // Execution should report failure
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.failed, 1n);
        assert.strictEqual(result.executed, 0n);
        assert.strictEqual(result.tasks.length, 1);
        assert.strictEqual(result.tasks[0].name, 'failing');
        assert.strictEqual(result.tasks[0].state.type, 'failed');
      });

      it('dataflowExecution shows failed status after task failure', async (t) => {
        const ctx = await withFailing(t);
        const opts = await ctx.opts();

        // Start execution
        await dataflowStart(ctx.config.baseUrl, ctx.repoName, 'fail-ws', { force: true }, opts);

        // Poll until execution completes
        const maxWait = 10000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const state = await dataflowExecution(ctx.config.baseUrl, ctx.repoName, 'fail-ws', {}, opts);

          if (state.status.type === 'failed') {
            // Verify we have summary with failure count
            assert.strictEqual(state.summary.type, 'some');
            if (state.summary.type === 'some') {
              assert.strictEqual(state.summary.value.failed, 1n);
            }
            return; // Test passed
          }

          if (state.status.type === 'completed') {
            assert.fail('Execution should have failed, not completed');
          }

          await new Promise(r => setTimeout(r, 100));
        }

        assert.fail('Execution did not complete in time');
      });

      it('can restart execution after failure', async (t) => {
        const ctx = await withFailing(t);
        const opts = await ctx.opts();

        // First execution - should fail
        const result1 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fail-ws', { force: true }, opts);
        assert.strictEqual(result1.success, false);

        // Second execution - should also run (not blocked by previous failure)
        const result2 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fail-ws', { force: true }, opts);
        assert.strictEqual(result2.success, false);
        assert.strictEqual(result2.failed, 1n);
      });
    });

    describe('parallel task failures', { concurrency: true }, () => {
      describe('mixed success/failure', { concurrency: true }, () => {
        it('parallel tasks with mixed success/failure complete without stalling', async (t) => {
          const ctx = await withMixed(t);
          const opts = await ctx.opts();

          const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', { force: true }, opts);

          // Dataflow should complete (not stall) and report failure
          assert.strictEqual(result.success, false);
          assert.strictEqual(result.failed, 1n);

          // The failing task must be reported
          const failC = result.tasks.find(t => t.name === 'fail_c');
          assert.ok(failC, 'fail_c task should be in results');
          assert.strictEqual(failC.state.type, 'failed');

          // Tasks that did execute should have succeeded
          for (const task of result.tasks) {
            if (task.name !== 'fail_c') {
              assert.strictEqual(task.state.type, 'success', `Task ${task.name} should succeed`);
            }
          }
        });

        it('failed task logs are accessible', async (t) => {
          const ctx = await withMixed(t);
          const opts = await ctx.opts();

          // Execute first to generate logs
          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', { force: true }, opts);

          // taskLogs for failed task should NOT throw
          const logs = await taskLogs(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', 'fail_c', { stream: 'stderr' }, opts);

          assert.ok(typeof logs.data === 'string', 'logs.data should be a string');
          assert.ok(typeof logs.complete === 'boolean', 'logs.complete should be a boolean');
        });

        it('workspace status reflects failed tasks correctly', async (t) => {
          const ctx = await withMixed(t);
          const opts = await ctx.opts();

          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', { force: true }, opts);

          const status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', opts);

          // Failed task should show 'failed' status, not stuck as 'in-progress'
          const failedTask = status.tasks.find(t => t.name === 'fail_c');
          assert.ok(failedTask, 'fail_c task should be in workspace status');
          assert.strictEqual(failedTask.status.type, 'failed', 'Failed task should have failed status');

          // No task should be stuck as 'in-progress'
          for (const task of status.tasks) {
            assert.notStrictEqual(task.status.type, 'in-progress', `Task ${task.name} should not be stuck in-progress`);
          }
        });
      });

      describe('diamond with upstream failure', { concurrency: true }, () => {
        it('diamond with upstream failure skips dependents', async (t) => {
          const ctx = await withFailingDiamond(t);
          const opts = await ctx.opts();

          const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fdiamond-ws', { force: true }, opts);

          assert.strictEqual(result.success, false);
          assert.strictEqual(result.failed, 1n);
          assert.ok(result.skipped >= 1n, `Expected at least 1 skipped task, got ${result.skipped}`);

          // Verify individual task states
          const leftTask = result.tasks.find(t => t.name === 'left');
          const rightTask = result.tasks.find(t => t.name === 'right');
          const mergeTask = result.tasks.find(t => t.name === 'merge');

          assert.ok(leftTask, 'left task should be in results');
          assert.ok(rightTask, 'right task should be in results');
          assert.ok(mergeTask, 'merge task should be in results');

          assert.strictEqual(leftTask.state.type, 'success');
          assert.strictEqual(rightTask.state.type, 'failed');
          assert.strictEqual(mergeTask.state.type, 'skipped');
        });

        it('taskLogs returns execution_not_found for skipped task', async (t) => {
          const ctx = await withFailingDiamond(t);
          const opts = await ctx.opts();

          // Execute — merge will be skipped because right fails
          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fdiamond-ws', { force: true }, opts);

          try {
            await taskLogs(ctx.config.baseUrl, ctx.repoName, 'fdiamond-ws', 'merge', { stream: 'stdout' }, opts);
            assert.fail('Should have thrown an ApiError');
          } catch (err) {
            assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
            assert.strictEqual(err.code, 'execution_not_found');
          }
        });
      });

      describe('wide parallel execution', { concurrency: true }, () => {
        it('wide parallel execution completes correctly', async (t) => {
          const ctx = await withWideParallel(t);
          const opts = await ctx.opts();

          const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'wide-ws', { force: true }, opts);

          assert.strictEqual(result.success, true);
          assert.strictEqual(result.executed, 6n);
          assert.strictEqual(result.failed, 0n);

          // All tasks should succeed
          for (const task of result.tasks) {
            assert.strictEqual(task.state.type, 'success', `Task ${task.name} should succeed`);
          }
        });
      });
    });

    // Concurrent execution tests must remain serial within their describe
    // because they test locking behavior with timing-sensitive operations
    describe('concurrent execution', () => {
      it('rejects second dataflowStart while execution is running', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Start first execution (non-blocking)
        await dataflowStart(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);

        // Wait a moment for execution to start
        await new Promise(r => setTimeout(r, 500));

        // Try to start second execution - should fail with lock error
        try {
          await dataflowStart(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);
          assert.fail('Second dataflowStart should have thrown an error');
        } catch (err) {
          // Should get a lock error
          assert.ok(err instanceof Error);
          const message = err.message.toLowerCase();
          assert.ok(
            message.includes('lock') || message.includes('running') || message.includes('busy'),
            `Expected lock-related error, got: ${err.message}`
          );
        }
      });

      it('rejects dataflowExecute while execution is running', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Start first execution (non-blocking)
        await dataflowStart(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);

        // Wait a moment for execution to start
        await new Promise(r => setTimeout(r, 500));

        // Try blocking execute - should fail with lock error
        try {
          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);
          assert.fail('dataflowExecute should have thrown an error');
        } catch (err) {
          assert.ok(err instanceof Error);
          const message = err.message.toLowerCase();
          assert.ok(
            message.includes('lock') || message.includes('running') || message.includes('busy'),
            `Expected lock-related error, got: ${err.message}`
          );
        }
      });

      it('dataflowCancel stops a running execution', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Start slow execution
        await dataflowStart(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);

        // Wait for it to start
        await new Promise(r => setTimeout(r, 500));

        // Cancel it
        await dataflowCancel(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);

        // Verify execution state is aborted
        const state = await dataflowExecution(ctx.config.baseUrl, ctx.repoName, 'slow-ws', {}, opts);
        assert.strictEqual(state.status.type, 'aborted');
      });

      it('dataflowCancel returns error when no execution is running', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Try to cancel when nothing is running
        try {
          await dataflowCancel(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);
          assert.fail('Should have thrown an error');
        } catch (err) {
          assert.ok(err instanceof Error);
          // Expect error about no active execution
        }
      });
    });

    describe('execution not found', { concurrency: true }, () => {
      it('taskLogs returns execution_not_found for never-executed task', async (t) => {
        const ctx = await withNoExec(t);
        const opts = await ctx.opts();

        try {
          await taskLogs(ctx.config.baseUrl, ctx.repoName, 'noexec-ws', 'compute', { stream: 'stdout' }, opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.strictEqual(err.code, 'execution_not_found');
        }
      });

      it('taskLogs returns task_not_found for non-existent task', async (t) => {
        const ctx = await withNoExec(t);
        const opts = await ctx.opts();

        try {
          await taskLogs(ctx.config.baseUrl, ctx.repoName, 'noexec-ws', 'no_such_task', { stream: 'stdout' }, opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.strictEqual(err.code, 'task_not_found');
        }
      });

      it('taskLogs returns workspace_not_found for non-existent workspace', async (t) => {
        const ctx = await withNoExec(t);
        const opts = await ctx.opts();

        try {
          await taskLogs(ctx.config.baseUrl, ctx.repoName, 'no_such_ws', 'compute', { stream: 'stdout' }, opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.strictEqual(err.code, 'workspace_not_found');
        }
      });
    });

    describe('workspace error handling', { concurrency: true }, () => {
      it('dataflowExecute returns error for non-existent workspace', async (t) => {
        const ctx = await setup(t);
        const opts = await ctx.opts();

        try {
          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'no_such_ws', { force: true }, opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.ok(
            err.code === 'workspace_not_found' || err.code === 'workspace_not_deployed',
            `Expected workspace_not_found or workspace_not_deployed, got ${err.code}`
          );
        }
      });

      it('dataflowGraph returns error for non-existent workspace', async (t) => {
        const ctx = await setup(t);
        const opts = await ctx.opts();

        try {
          await dataflowGraph(ctx.config.baseUrl, ctx.repoName, 'no_such_ws', opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.ok(
            err.code === 'workspace_not_found' || err.code === 'workspace_not_deployed',
            `Expected workspace_not_found or workspace_not_deployed, got ${err.code}`
          );
        }
      });

      it('workspaceStatus returns error for non-existent workspace', async (t) => {
        const ctx = await setup(t);
        const opts = await ctx.opts();

        try {
          await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'no_such_ws', opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.ok(
            err.code === 'workspace_not_found' || err.code === 'workspace_not_deployed',
            `Expected workspace_not_found or workspace_not_deployed, got ${err.code}`
          );
        }
      });
    });

    describe('cache behavior', { concurrency: true }, () => {
      it('second execution uses cached results', async (t) => {
        const ctx = await withCache(t);
        const opts = await ctx.opts();

        // First execution - should execute the task
        const result1 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cache-ws', { force: false }, opts);
        assert.strictEqual(result1.success, true);
        assert.strictEqual(result1.executed, 1n);

        // Second execution without force - should use cache
        const result2 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cache-ws', { force: false }, opts);
        assert.strictEqual(result2.success, true);
        assert.ok(result2.cached > 0n, `Expected cached > 0, got ${result2.cached}`);
        assert.strictEqual(result2.executed, 0n);
      });

      it('force bypasses cache', async (t) => {
        const ctx = await withCache(t);
        const opts = await ctx.opts();

        // First execution
        await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cache-ws', { force: false }, opts);

        // Force execution - should re-execute despite cache
        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cache-ws', { force: true }, opts);
        assert.strictEqual(result.success, true);
        assert.ok(result.executed > 0n, `Expected executed > 0, got ${result.executed}`);
      });
    });

    describe('task filter', { concurrency: true }, () => {
      it('filter runs only the specified task', async (t) => {
        const ctx = await withFilter(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(
          ctx.config.baseUrl, ctx.repoName, 'filter-ws',
          { force: true, filter: 'left' },
          opts
        );

        assert.strictEqual(result.success, true);

        // Only the filtered task should have executed
        const executedTasks = result.tasks.filter(t => t.state.type === 'success' && !t.cached);
        assert.strictEqual(executedTasks.length, 1, `Expected 1 executed task, got ${executedTasks.length}`);
        assert.strictEqual(executedTasks[0].name, 'left');
      });

      it('filter with non-existent task returns error', async (t) => {
        const ctx = await withFilter(t);
        const opts = await ctx.opts();

        try {
          await dataflowExecute(
            ctx.config.baseUrl, ctx.repoName, 'filter-ws',
            { force: true, filter: 'no_such_task' },
            opts
          );
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.strictEqual(err.code, 'task_not_found');
        }
      });
    });

    describe('dependency graph', { concurrency: true }, () => {
      it('dataflowGraph returns correct structure', async (t) => {
        const ctx = await withGraph(t);
        const opts = await ctx.opts();

        const graph = await dataflowGraph(ctx.config.baseUrl, ctx.repoName, 'graph-ws', opts);

        // Should have 3 tasks: left, right, merge
        assert.strictEqual(graph.tasks.length, 3);

        const left = graph.tasks.find(t => t.name === 'left');
        const right = graph.tasks.find(t => t.name === 'right');
        const merge = graph.tasks.find(t => t.name === 'merge');

        assert.ok(left, 'left task should be in graph');
        assert.ok(right, 'right task should be in graph');
        assert.ok(merge, 'merge task should be in graph');

        // left and right have no dependencies
        assert.deepStrictEqual(left.dependsOn, []);
        assert.deepStrictEqual(right.dependsOn, []);

        // merge depends on both left and right
        assert.ok(merge.dependsOn.includes('left'), 'merge should depend on left');
        assert.ok(merge.dependsOn.includes('right'), 'merge should depend on right');
        assert.strictEqual(merge.dependsOn.length, 2);
      });
    });

    describe('log pagination', { concurrency: true }, () => {
      it('taskLogs supports offset and limit', async (t) => {
        const ctx = await withLogPag(t);
        const opts = await ctx.opts();

        // Execute to generate logs
        await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', { force: true }, opts);

        // Get full logs
        const full = await taskLogs(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', 'compute', { stream: 'stdout' }, opts);

        // Skip test if log is too short for meaningful pagination
        if (full.totalSize < 5n) {
          return;
        }

        // Get first 5 bytes
        const chunk1 = await taskLogs(
          ctx.config.baseUrl, ctx.repoName, 'logpag-ws', 'compute',
          { stream: 'stdout', offset: 0, limit: 5 },
          opts
        );
        assert.strictEqual(chunk1.data, full.data.slice(0, 5));
        assert.strictEqual(chunk1.offset, 0n);

        // Get from byte 5 onwards
        const chunk2 = await taskLogs(
          ctx.config.baseUrl, ctx.repoName, 'logpag-ws', 'compute',
          { stream: 'stdout', offset: 5 },
          opts
        );
        assert.strictEqual(chunk2.offset, 5n);
        assert.strictEqual(chunk2.data, full.data.slice(5));
      });
    });

    describe('event pagination', { concurrency: true }, () => {
      it('dataflowExecution supports event offset and limit', async (t) => {
        const ctx = await withEvtPag(t);
        const opts = await ctx.opts();

        // Execute and wait for completion
        await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'evtpag-ws', { force: true }, opts);

        // Get first event only
        const page1 = await dataflowExecution(
          ctx.config.baseUrl, ctx.repoName, 'evtpag-ws',
          { offset: 0, limit: 1 },
          opts
        );
        assert.strictEqual(page1.events.length, 1, 'Should return exactly 1 event');
        assert.ok(page1.totalEvents >= 3n, `Expected at least 3 total events, got ${page1.totalEvents}`);

        // Get second event
        const page2 = await dataflowExecution(
          ctx.config.baseUrl, ctx.repoName, 'evtpag-ws',
          { offset: 1, limit: 1 },
          opts
        );
        assert.strictEqual(page2.events.length, 1, 'Should return exactly 1 event');

        // Events should be different
        const event1 = page1.events[0];
        const event2 = page2.events[0];
        const event1Key = `${event1.type}:${'value' in event1 ? (event1.value as { task: string }).task : ''}`;
        const event2Key = `${event2.type}:${'value' in event2 ? (event2.value as { task: string }).task : ''}`;
        assert.notStrictEqual(event1Key, event2Key, 'Paginated events should be different');
      });
    });
  });
}
