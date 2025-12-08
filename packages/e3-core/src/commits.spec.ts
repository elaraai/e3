/**
 * Tests for commits.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  createNewTaskCommit,
  createTaskDoneCommit,
  createTaskErrorCommit,
  createTaskFailCommit,
  loadCommit,
} from './commits.js';
import { loadObject } from './objects.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

describe('commits', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  describe('createNewTaskCommit', () => {
    it('creates commit and returns hash', async () => {
      const taskId = 'task123';
      const irHash = 'a'.repeat(64);
      const argsHashes = ['b'.repeat(64)];
      const runtime = 'node';

      const commitHash = await createNewTaskCommit(
        testRepo,
        taskId,
        irHash,
        argsHashes,
        runtime
      );

      assert.strictEqual(typeof commitHash, 'string');
      assert.strictEqual(commitHash.length, 64);
    });

    it('stores commit as .east file', async () => {
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        'a'.repeat(64),
        ['b'.repeat(64)],
        'node'
      );

      const data = await loadObject(testRepo, commitHash, '.east');
      const text = new TextDecoder().decode(data);

      assert.strictEqual(text.includes('new_task'), true);
    });

    it('includes task_id in commit', async () => {
      const taskId = 'my-unique-task-id';
      const commitHash = await createNewTaskCommit(
        testRepo,
        taskId,
        'a'.repeat(64),
        ['b'.repeat(64)],
        'node'
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        assert.strictEqual(commit.value.task_id, taskId);
      }
    });

    it('includes ir hash in commit', async () => {
      const irHash = 'a'.repeat(64);
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        irHash,
        ['b'.repeat(64)],
        'node'
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        assert.strictEqual(commit.value.ir, irHash);
      }
    });

    it('includes args hashes in commit', async () => {
      const argsHashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        'd'.repeat(64),
        argsHashes,
        'node'
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        assert.deepStrictEqual(commit.value.args, argsHashes);
      }
    });

    it('includes runtime in commit', async () => {
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        'a'.repeat(64),
        ['b'.repeat(64)],
        'python'
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        assert.strictEqual(commit.value.runtime, 'python');
      }
    });

    it('includes timestamp in commit', async () => {
      const before = new Date();
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        'a'.repeat(64),
        ['b'.repeat(64)],
        'node'
      );
      const after = new Date();

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        const timestamp = new Date(commit.value.timestamp);
        assert.strictEqual(timestamp >= before, true);
        assert.strictEqual(timestamp <= after, true);
      }
    });

    it('sets parent to None when null', async () => {
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        'a'.repeat(64),
        ['b'.repeat(64)],
        'node',
        null
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        assert.strictEqual(commit.value.parent.type, 'None');
      }
    });

    it('sets parent to Some when provided', async () => {
      const parentHash = 'p'.repeat(64);
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        'a'.repeat(64),
        ['b'.repeat(64)],
        'node',
        parentHash
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        assert.strictEqual(commit.value.parent.type, 'Some');
        if (commit.value.parent.type === 'Some') {
          assert.strictEqual(commit.value.parent.value, parentHash);
        }
      }
    });

    it('handles empty args array', async () => {
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        'a'.repeat(64),
        [],
        'node'
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        assert.deepStrictEqual(commit.value.args, []);
      }
    });
  });

  describe('createTaskDoneCommit', () => {
    it('creates commit and returns hash', async () => {
      const parentHash = 'p'.repeat(64);
      const resultHash = 'r'.repeat(64);

      const commitHash = await createTaskDoneCommit(
        testRepo,
        parentHash,
        resultHash,
        'node',
        1000000
      );

      assert.strictEqual(typeof commitHash, 'string');
      assert.strictEqual(commitHash.length, 64);
    });

    it('stores commit as .east file', async () => {
      const commitHash = await createTaskDoneCommit(
        testRepo,
        'p'.repeat(64),
        'r'.repeat(64),
        'node',
        1000000
      );

      const data = await loadObject(testRepo, commitHash, '.east');
      const text = new TextDecoder().decode(data);

      assert.strictEqual(text.includes('task_done'), true);
    });

    it('includes parent hash', async () => {
      const parentHash = 'p'.repeat(64);
      const commitHash = await createTaskDoneCommit(
        testRepo,
        parentHash,
        'r'.repeat(64),
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_done');
      if (commit.type === 'task_done') {
        assert.strictEqual(commit.value.parent, parentHash);
      }
    });

    it('includes result hash', async () => {
      const resultHash = 'r'.repeat(64);
      const commitHash = await createTaskDoneCommit(
        testRepo,
        'p'.repeat(64),
        resultHash,
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_done');
      if (commit.type === 'task_done') {
        assert.strictEqual(commit.value.result, resultHash);
      }
    });

    it('includes execution time', async () => {
      const executionTimeUs = 5000000; // 5 seconds
      const commitHash = await createTaskDoneCommit(
        testRepo,
        'p'.repeat(64),
        'r'.repeat(64),
        'node',
        executionTimeUs
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_done');
      if (commit.type === 'task_done') {
        assert.strictEqual(commit.value.execution_time_us, BigInt(executionTimeUs));
      }
    });

    it('includes runtime', async () => {
      const commitHash = await createTaskDoneCommit(
        testRepo,
        'p'.repeat(64),
        'r'.repeat(64),
        'julia',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_done');
      if (commit.type === 'task_done') {
        assert.strictEqual(commit.value.runtime, 'julia');
      }
    });
  });

  describe('createTaskErrorCommit', () => {
    it('creates commit and returns hash', async () => {
      const commitHash = await createTaskErrorCommit(
        testRepo,
        'p'.repeat(64),
        'Something went wrong',
        ['at line 1', 'at line 2'],
        'node',
        1000000
      );

      assert.strictEqual(typeof commitHash, 'string');
      assert.strictEqual(commitHash.length, 64);
    });

    it('stores commit as .east file', async () => {
      const commitHash = await createTaskErrorCommit(
        testRepo,
        'p'.repeat(64),
        'Error message',
        ['stack trace'],
        'node',
        1000000
      );

      const data = await loadObject(testRepo, commitHash, '.east');
      const text = new TextDecoder().decode(data);

      assert.strictEqual(text.includes('task_error'), true);
    });

    it('includes error message', async () => {
      const errorMessage = 'Division by zero';
      const commitHash = await createTaskErrorCommit(
        testRepo,
        'p'.repeat(64),
        errorMessage,
        ['stack trace'],
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_error');
      if (commit.type === 'task_error') {
        assert.strictEqual(commit.value.error_message, errorMessage);
      }
    });

    it('includes error stack', async () => {
      const errorStack = ['at foo()', 'at bar()', 'at main()'];
      const commitHash = await createTaskErrorCommit(
        testRepo,
        'p'.repeat(64),
        'Error',
        errorStack,
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_error');
      if (commit.type === 'task_error') {
        assert.deepStrictEqual(commit.value.error_stack, errorStack);
      }
    });

    it('includes parent hash', async () => {
      const parentHash = 'p'.repeat(64);
      const commitHash = await createTaskErrorCommit(
        testRepo,
        parentHash,
        'Error',
        ['stack'],
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_error');
      if (commit.type === 'task_error') {
        assert.strictEqual(commit.value.parent, parentHash);
      }
    });
  });

  describe('createTaskFailCommit', () => {
    it('creates commit and returns hash', async () => {
      const commitHash = await createTaskFailCommit(
        testRepo,
        'p'.repeat(64),
        'System failure',
        'node',
        1000000
      );

      assert.strictEqual(typeof commitHash, 'string');
      assert.strictEqual(commitHash.length, 64);
    });

    it('stores commit as .east file', async () => {
      const commitHash = await createTaskFailCommit(
        testRepo,
        'p'.repeat(64),
        'Failure message',
        'node',
        1000000
      );

      const data = await loadObject(testRepo, commitHash, '.east');
      const text = new TextDecoder().decode(data);

      assert.strictEqual(text.includes('task_fail'), true);
    });

    it('includes error message', async () => {
      const errorMessage = 'Out of memory';
      const commitHash = await createTaskFailCommit(
        testRepo,
        'p'.repeat(64),
        errorMessage,
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_fail');
      if (commit.type === 'task_fail') {
        assert.strictEqual(commit.value.error_message, errorMessage);
      }
    });

    it('includes parent hash', async () => {
      const parentHash = 'p'.repeat(64);
      const commitHash = await createTaskFailCommit(
        testRepo,
        parentHash,
        'Error',
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_fail');
      if (commit.type === 'task_fail') {
        assert.strictEqual(commit.value.parent, parentHash);
      }
    });
  });

  describe('loadCommit', () => {
    it('loads new_task commit', async () => {
      const commitHash = await createNewTaskCommit(
        testRepo,
        'task123',
        'a'.repeat(64),
        ['b'.repeat(64)],
        'node'
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
    });

    it('loads task_done commit', async () => {
      const commitHash = await createTaskDoneCommit(
        testRepo,
        'p'.repeat(64),
        'r'.repeat(64),
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_done');
    });

    it('loads task_error commit', async () => {
      const commitHash = await createTaskErrorCommit(
        testRepo,
        'p'.repeat(64),
        'Error',
        ['stack'],
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_error');
    });

    it('loads task_fail commit', async () => {
      const commitHash = await createTaskFailCommit(
        testRepo,
        'p'.repeat(64),
        'Failure',
        'node',
        1000000
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_fail');
    });

    it('throws on non-existent commit', async () => {
      const fakeHash = 'f'.repeat(64);

      await assert.rejects(
        async () => await loadCommit(testRepo, fakeHash),
        /Failed to load commit/
      );
    });

    it('round-trips new_task commit correctly', async () => {
      const taskId = 'task123';
      const irHash = 'a'.repeat(64);
      const argsHashes = ['b'.repeat(64), 'c'.repeat(64)];
      const runtime = 'node';
      const parentHash = 'p'.repeat(64);

      const commitHash = await createNewTaskCommit(
        testRepo,
        taskId,
        irHash,
        argsHashes,
        runtime,
        parentHash
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'new_task');
      if (commit.type === 'new_task') {
        assert.strictEqual(commit.value.task_id, taskId);
        assert.strictEqual(commit.value.ir, irHash);
        assert.deepStrictEqual(commit.value.args, argsHashes);
        assert.strictEqual(commit.value.runtime, runtime);
        assert.strictEqual(commit.value.parent.type, 'Some');
      }
    });

    it('round-trips task_done commit correctly', async () => {
      const parentHash = 'p'.repeat(64);
      const resultHash = 'r'.repeat(64);
      const runtime = 'julia';
      const executionTimeUs = 12345678;

      const commitHash = await createTaskDoneCommit(
        testRepo,
        parentHash,
        resultHash,
        runtime,
        executionTimeUs
      );

      const commit = await loadCommit(testRepo, commitHash);

      assert.strictEqual(commit.type, 'task_done');
      if (commit.type === 'task_done') {
        assert.strictEqual(commit.value.parent, parentHash);
        assert.strictEqual(commit.value.result, resultHash);
        assert.strictEqual(commit.value.runtime, runtime);
        assert.strictEqual(commit.value.execution_time_us, BigInt(executionTimeUs));
      }
    });
  });
});
