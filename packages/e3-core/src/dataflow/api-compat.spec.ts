/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { variant, some, none } from '@elaraai/east';
import type { ExecutionEvent, DataflowExecutionState } from './types.js';
import { coreEventToApiEvent, coreStateToApiState } from './api-compat.js';

const now = new Date('2025-01-15T12:00:00Z');

// =============================================================================
// Helper: build a minimal DataflowExecutionState
// =============================================================================

function makeState(overrides: Partial<DataflowExecutionState> = {}): DataflowExecutionState {
  return {
    id: '1',
    repo: 'test-repo',
    workspace: 'ws',
    startedAt: now,
    concurrency: 4n,
    force: false,
    filter: none,
    graph: none,
    graphHash: none,
    tasks: new Map(),
    executed: 0n,
    cached: 0n,
    failed: 0n,
    skipped: 0n,
    status: 'completed',
    completedAt: some(now),
    error: none,
    events: [],
    eventSeq: 0n,
    ...overrides,
  };
}

// =============================================================================
// coreEventToApiEvent
// =============================================================================

describe('coreEventToApiEvent', () => {
  it('maps task_started to start', () => {
    const event: ExecutionEvent = variant('task_started', {
      seq: 1n, timestamp: now, task: 'build',
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'start');
    assert.strictEqual(result?.task, 'build');
  });

  it('maps task_completed (not cached) to complete', () => {
    const event: ExecutionEvent = variant('task_completed', {
      seq: 2n, timestamp: now, task: 'build',
      cached: false, outputHash: 'abc', duration: 1000n,
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'complete');
    assert.strictEqual(result?.duration, 1000);
  });

  it('maps task_completed (cached) to cached', () => {
    const event: ExecutionEvent = variant('task_completed', {
      seq: 2n, timestamp: now, task: 'build',
      cached: true, outputHash: 'abc', duration: 0n,
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'cached');
  });

  it('maps task_failed with exitCode to failed', () => {
    const event: ExecutionEvent = variant('task_failed', {
      seq: 3n, timestamp: now, task: 'build',
      error: none, exitCode: some(1n), duration: 500n,
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'failed');
    assert.strictEqual(result?.exitCode, 1n);
  });

  it('maps task_failed without exitCode to error', () => {
    const event: ExecutionEvent = variant('task_failed', {
      seq: 3n, timestamp: now, task: 'build',
      error: some('OOM'), exitCode: none, duration: 500n,
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'error');
    assert.strictEqual(result?.message, 'OOM');
  });

  it('maps task_skipped to input_unavailable', () => {
    const event: ExecutionEvent = variant('task_skipped', {
      seq: 4n, timestamp: now, task: 'deploy', cause: 'build',
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'input_unavailable');
    assert.strictEqual(result?.reason, "Upstream task 'build' failed");
  });

  it('returns null for execution_started', () => {
    const event: ExecutionEvent = variant('execution_started', {
      seq: 0n, timestamp: now, executionId: '1', totalTasks: 3n,
    });
    assert.strictEqual(coreEventToApiEvent(event), null);
  });

  it('returns null for task_ready', () => {
    const event: ExecutionEvent = variant('task_ready', {
      seq: 1n, timestamp: now, task: 'build',
    });
    assert.strictEqual(coreEventToApiEvent(event), null);
  });

  it('returns null for execution_completed', () => {
    const event: ExecutionEvent = variant('execution_completed', {
      seq: 5n, timestamp: now, success: true,
      executed: 1n, cached: 0n, failed: 0n, skipped: 0n, duration: 1000n,
    });
    assert.strictEqual(coreEventToApiEvent(event), null);
  });

  it('returns null for execution_cancelled', () => {
    const event: ExecutionEvent = variant('execution_cancelled', {
      seq: 5n, timestamp: now, reason: none,
    });
    assert.strictEqual(coreEventToApiEvent(event), null);
  });
});

// =============================================================================
// coreStateToApiState — totalEvents
// =============================================================================

describe('coreStateToApiState', () => {
  it('totalEvents counts only API-visible events', () => {
    // 5 core events: execution_started, task_ready, task_started, task_completed, execution_completed
    // Only 2 are API-visible: task_started → start, task_completed → complete
    const events: ExecutionEvent[] = [
      variant('execution_started', {
        seq: 0n, timestamp: now, executionId: '1', totalTasks: 1n,
      }),
      variant('task_ready', {
        seq: 1n, timestamp: now, task: 'build',
      }),
      variant('task_started', {
        seq: 2n, timestamp: now, task: 'build',
      }),
      variant('task_completed', {
        seq: 3n, timestamp: now, task: 'build',
        cached: false, outputHash: 'abc', duration: 1000n,
      }),
      variant('execution_completed', {
        seq: 4n, timestamp: now, success: true,
        executed: 1n, cached: 0n, failed: 0n, skipped: 0n, duration: 1000n,
      }),
    ];

    const state = makeState({ executed: 1n, events });
    const result = coreStateToApiState(state, events, 2, 1000);

    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.totalEvents, 2n);
    assert.strictEqual(result.events[0]?.type, 'start');
    assert.strictEqual(result.events[1]?.type, 'complete');
  });

  it('totalEvents is 0 when all events are internal', () => {
    const events: ExecutionEvent[] = [
      variant('execution_started', {
        seq: 0n, timestamp: now, executionId: '1', totalTasks: 0n,
      }),
      variant('execution_completed', {
        seq: 1n, timestamp: now, success: true,
        executed: 0n, cached: 0n, failed: 0n, skipped: 0n, duration: 0n,
      }),
    ];

    const state = makeState({ events });
    const result = coreStateToApiState(state, events, 0, 0);

    assert.strictEqual(result.events.length, 0);
    assert.strictEqual(result.totalEvents, 0n);
  });

  it('includes summary only for non-running executions', () => {
    const state = makeState({ status: 'running', completedAt: none });
    const result = coreStateToApiState(state, [], 0, 500);

    assert.strictEqual(result.summary, null);
    assert.strictEqual(result.status, 'running');
  });

  it('maps cancelled status to aborted', () => {
    const state = makeState({ status: 'cancelled' });
    const result = coreStateToApiState(state, [], 0, 0);

    assert.strictEqual(result.status, 'aborted');
  });
});
