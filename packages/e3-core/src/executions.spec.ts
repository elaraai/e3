/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for executions.ts - task execution operations
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { variant, StringType, encodeBeast2For } from '@elaraai/east';
import { TaskObjectType, type CommandPart } from '@elaraai/e3-types';
import {
  inputsHash,
  executionPath,
  executionGet,
  executionGetOutput,
  executionList,
  executionListForTask,
  executionReadLog,
  configRead,
  configWrite,
  taskExecute,
} from './executions.js';
import { objectWrite, computeHash } from './objects.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

describe('executions', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  describe('inputsHash', () => {
    it('computes consistent hash for same inputs', () => {
      const hash1 = inputsHash(['abc', 'def']);
      const hash2 = inputsHash(['abc', 'def']);
      assert.strictEqual(hash1, hash2);
    });

    it('computes different hash for different inputs', () => {
      const hash1 = inputsHash(['abc', 'def']);
      const hash2 = inputsHash(['abc', 'xyz']);
      assert.notStrictEqual(hash1, hash2);
    });

    it('order matters', () => {
      const hash1 = inputsHash(['abc', 'def']);
      const hash2 = inputsHash(['def', 'abc']);
      assert.notStrictEqual(hash1, hash2);
    });

    it('handles empty array', () => {
      const hash = inputsHash([]);
      assert.strictEqual(hash.length, 64); // SHA256 hex
    });

    it('handles single input', () => {
      const hash = inputsHash(['abc']);
      assert.strictEqual(hash.length, 64);
    });
  });

  describe('executionPath', () => {
    it('returns correct path structure', () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const path = executionPath(testRepo, taskHash, inHash);
      assert.ok(path.includes('executions'));
      assert.ok(path.includes(taskHash));
      assert.ok(path.includes(inHash));
    });
  });

  describe('executionGet', () => {
    it('returns null for non-existent execution', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const status = await executionGet(testRepo, taskHash, inHash);
      assert.strictEqual(status, null);
    });
  });

  describe('executionGetOutput', () => {
    it('returns null for non-existent execution', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const output = await executionGetOutput(testRepo, taskHash, inHash);
      assert.strictEqual(output, null);
    });

    it('returns hash from output ref file', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const outputHash = 'c'.repeat(64);

      // Create execution directory with output ref
      const execDir = join(testRepo, 'executions', taskHash, inHash);
      mkdirSync(execDir, { recursive: true });
      writeFileSync(join(execDir, 'output'), outputHash + '\n');

      const output = await executionGetOutput(testRepo, taskHash, inHash);
      assert.strictEqual(output, outputHash);
    });
  });

  describe('executionList', () => {
    it('returns empty array for no executions', async () => {
      const list = await executionList(testRepo);
      assert.deepStrictEqual(list, []);
    });

    it('lists all executions', async () => {
      const taskHash1 = 'a'.repeat(64);
      const taskHash2 = 'b'.repeat(64);
      const inHash1 = 'c'.repeat(64);
      const inHash2 = 'd'.repeat(64);

      // Create execution directories
      mkdirSync(join(testRepo, 'executions', taskHash1, inHash1), { recursive: true });
      mkdirSync(join(testRepo, 'executions', taskHash1, inHash2), { recursive: true });
      mkdirSync(join(testRepo, 'executions', taskHash2, inHash1), { recursive: true });

      const list = await executionList(testRepo);
      assert.strictEqual(list.length, 3);
    });
  });

  describe('executionListForTask', () => {
    it('returns empty array for non-existent task', async () => {
      const taskHash = 'a'.repeat(64);
      const list = await executionListForTask(testRepo, taskHash);
      assert.deepStrictEqual(list, []);
    });

    it('lists inputs for a task', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash1 = 'b'.repeat(64);
      const inHash2 = 'c'.repeat(64);

      mkdirSync(join(testRepo, 'executions', taskHash, inHash1), { recursive: true });
      mkdirSync(join(testRepo, 'executions', taskHash, inHash2), { recursive: true });

      const list = await executionListForTask(testRepo, taskHash);
      assert.strictEqual(list.length, 2);
      assert.ok(list.includes(inHash1));
      assert.ok(list.includes(inHash2));
    });
  });

  describe('executionReadLog', () => {
    it('returns empty chunk for non-existent log', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const chunk = await executionReadLog(testRepo, taskHash, inHash, 'stdout');
      assert.strictEqual(chunk.data, '');
      assert.strictEqual(chunk.size, 0);
      assert.strictEqual(chunk.complete, true);
    });

    it('reads log content', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const logContent = 'Hello, world!\nLine 2\n';

      const execDir = join(testRepo, 'executions', taskHash, inHash);
      mkdirSync(execDir, { recursive: true });
      writeFileSync(join(execDir, 'stdout.txt'), logContent);

      const chunk = await executionReadLog(testRepo, taskHash, inHash, 'stdout');
      assert.strictEqual(chunk.data, logContent);
      assert.strictEqual(chunk.size, logContent.length);
      assert.strictEqual(chunk.totalSize, logContent.length);
      assert.strictEqual(chunk.complete, true);
    });

    it('supports pagination', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const logContent = 'ABCDEFGHIJ';

      const execDir = join(testRepo, 'executions', taskHash, inHash);
      mkdirSync(execDir, { recursive: true });
      writeFileSync(join(execDir, 'stderr.txt'), logContent);

      // Read first 5 bytes
      const chunk1 = await executionReadLog(testRepo, taskHash, inHash, 'stderr', {
        offset: 0,
        limit: 5,
      });
      assert.strictEqual(chunk1.data, 'ABCDE');
      assert.strictEqual(chunk1.offset, 0);
      assert.strictEqual(chunk1.size, 5);
      assert.strictEqual(chunk1.complete, false);

      // Read next 5 bytes
      const chunk2 = await executionReadLog(testRepo, taskHash, inHash, 'stderr', {
        offset: 5,
        limit: 5,
      });
      assert.strictEqual(chunk2.data, 'FGHIJ');
      assert.strictEqual(chunk2.offset, 5);
      assert.strictEqual(chunk2.size, 5);
      assert.strictEqual(chunk2.complete, true);
    });
  });

  describe('configRead and configWrite', () => {
    it('reads empty config from empty file', async () => {
      const config = await configRead(testRepo);
      assert.ok(config.runners instanceof Map);
      assert.strictEqual(config.runners.size, 0);
    });

    it('round-trips config', async () => {
      const runners = new Map<string, CommandPart[]>();
      runners.set('test-runner', [
        variant('literal', 'echo'),
        variant('literal', 'hello'),
      ]);

      await configWrite(testRepo, { runners });
      const config = await configRead(testRepo);

      assert.strictEqual(config.runners.size, 1);
      assert.ok(config.runners.has('test-runner'));
      const parts = config.runners.get('test-runner')!;
      assert.strictEqual(parts.length, 2);
      assert.strictEqual(parts[0].type, 'literal');
      assert.strictEqual(parts[0].value, 'echo');
    });
  });

  describe('taskExecute', () => {
    it('returns error for missing runner', async () => {
      // Create a task object with unknown runner
      const task = {
        runner: 'nonexistent-runner',
        inputs: [],
        output: [],
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      const result = await taskExecute(testRepo, taskHash, []);

      assert.strictEqual(result.state, 'error');
      assert.ok(result.error?.includes('Runner not configured'));
    });

    it('executes simple cp runner successfully', async () => {
      // Configure a runner that copies input to output
      const runners = new Map<string, CommandPart[]>();
      runners.set('copy', [
        variant('literal', 'cp'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create a task object
      const task = {
        runner: 'copy',
        inputs: [[variant('field', 'test')]],
        output: [variant('field', 'output')],
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      // Create input data
      const inputEncoder = encodeBeast2For(StringType);
      const inputData = inputEncoder('hello world');
      const inputHash = await objectWrite(testRepo, inputData);

      // Execute
      const result = await taskExecute(testRepo, taskHash, [inputHash]);

      assert.strictEqual(result.state, 'success');
      assert.strictEqual(result.cached, false);
      assert.ok(result.outputHash);
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.duration >= 0);
    });

    it('caches successful executions', async () => {
      // Configure runner
      const runners = new Map<string, CommandPart[]>();
      runners.set('copy', [
        variant('literal', 'cp'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create task
      const task = {
        runner: 'copy',
        inputs: [[variant('field', 'test')]],
        output: [variant('field', 'output')],
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      // Create input
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('test data'));

      // First execution
      const result1 = await taskExecute(testRepo, taskHash, [inputHash]);
      assert.strictEqual(result1.cached, false);
      assert.strictEqual(result1.state, 'success');

      // Second execution should be cached
      const result2 = await taskExecute(testRepo, taskHash, [inputHash]);
      assert.strictEqual(result2.cached, true);
      assert.strictEqual(result2.state, 'success');
      assert.strictEqual(result2.outputHash, result1.outputHash);
      assert.strictEqual(result2.duration, 0);
    });

    it('force bypasses cache', async () => {
      // Configure runner
      const runners = new Map<string, CommandPart[]>();
      runners.set('copy', [
        variant('literal', 'cp'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create task
      const task = {
        runner: 'copy',
        inputs: [[variant('field', 'test')]],
        output: [variant('field', 'output')],
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      // Create input
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('test data'));

      // First execution
      const result1 = await taskExecute(testRepo, taskHash, [inputHash]);
      assert.strictEqual(result1.cached, false);

      // Force re-execution
      const result2 = await taskExecute(testRepo, taskHash, [inputHash], { force: true });
      assert.strictEqual(result2.cached, false);
      assert.strictEqual(result2.state, 'success');
    });

    it('captures stdout and stderr', async () => {
      // Configure a runner that echoes to both streams
      const runners = new Map<string, CommandPart[]>();
      runners.set('echo-both', [
        variant('literal', 'bash'),
        variant('literal', '-c'),
        variant('literal', 'echo stdout; echo stderr >&2; cp "$1" "$2"'),
        variant('literal', '--'),
        variant('input_path', null),
        variant('output_path', null),
      ]);
      await configWrite(testRepo, { runners });

      // Create task
      const task = {
        runner: 'echo-both',
        inputs: [[variant('field', 'test')]],
        output: [variant('field', 'output')],
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      // Create input
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('data'));

      // Capture callbacks
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const result = await taskExecute(testRepo, taskHash, [inputHash], {
        onStdout: (data) => stdoutChunks.push(data),
        onStderr: (data) => stderrChunks.push(data),
      });

      assert.strictEqual(result.state, 'success');

      // Check callbacks received data
      assert.ok(stdoutChunks.join('').includes('stdout'));
      assert.ok(stderrChunks.join('').includes('stderr'));

      // Check logs were written
      const inHash = result.inputsHash;
      const stdoutLog = await executionReadLog(testRepo, taskHash, inHash, 'stdout');
      const stderrLog = await executionReadLog(testRepo, taskHash, inHash, 'stderr');

      assert.ok(stdoutLog.data.includes('stdout'));
      assert.ok(stderrLog.data.includes('stderr'));
    });

    it('handles failed commands', async () => {
      // Configure a runner that fails
      const runners = new Map<string, CommandPart[]>();
      runners.set('fail', [
        variant('literal', 'bash'),
        variant('literal', '-c'),
        variant('literal', 'exit 42'),
      ]);
      await configWrite(testRepo, { runners });

      // Create task
      const task = {
        runner: 'fail',
        inputs: [],
        output: [variant('field', 'output')],
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      const result = await taskExecute(testRepo, taskHash, []);

      assert.strictEqual(result.state, 'failed');
      assert.strictEqual(result.exitCode, 42);
      assert.strictEqual(result.outputHash, null);

      // Check status was written
      const status = await executionGet(testRepo, taskHash, result.inputsHash);
      assert.ok(status);
      assert.strictEqual(status.type, 'failed');
    });
  });
});
