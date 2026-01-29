/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API compatibility layer for dataflow execution.
 *
 * Maps e3-core internal event/status types to API-compatible types
 * used by e3-api-server and e3-api-client. This ensures consumers
 * of the API see a stable interface regardless of internal changes.
 *
 * Vocabulary mappings:
 * - e3-core 'cancelled' -> API 'aborted'
 * - e3-core 'task_started' -> API 'start'
 * - e3-core 'task_completed' (cached: false) -> API 'complete'
 * - e3-core 'task_completed' (cached: true) -> API 'cached'
 * - e3-core 'task_failed' -> API 'failed' or 'error'
 * - e3-core 'task_skipped' -> API 'input_unavailable'
 */

import type {
  ExecutionEvent,
  DataflowExecutionStatus,
  DataflowExecutionState,
} from './types.js';

// =============================================================================
// API Event Types (matching e3-api-server/src/types.ts)
// =============================================================================

/**
 * API-compatible event types for dataflow execution polling.
 * These match the DataflowEventType from e3-api-server/types.ts.
 */
export type ApiDataflowEventType =
  | 'start'
  | 'complete'
  | 'cached'
  | 'failed'
  | 'error'
  | 'input_unavailable';

/**
 * API-compatible event structure.
 */
export interface ApiDataflowEvent {
  type: ApiDataflowEventType;
  task: string;
  timestamp: string;
  duration?: number;
  exitCode?: bigint;
  message?: string;
  reason?: string;
}

/**
 * API-compatible execution status.
 */
export type ApiExecutionStatus = 'running' | 'completed' | 'failed' | 'aborted';

/**
 * API-compatible execution summary.
 */
export interface ApiExecutionSummary {
  executed: bigint;
  cached: bigint;
  failed: bigint;
  skipped: bigint;
  duration: number;
}

/**
 * API-compatible execution state (matches DataflowExecutionStateType).
 */
export interface ApiExecutionState {
  status: ApiExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  summary: ApiExecutionSummary | null;
  events: ApiDataflowEvent[];
  totalEvents: bigint;
}

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Convert e3-core execution event to API-compatible event.
 *
 * Returns null for events that don't have an API equivalent
 * (e.g., execution_started, task_ready, execution_completed, execution_cancelled).
 *
 * @param event - The e3-core execution event (variant format)
 * @returns API-compatible event or null if no mapping exists
 */
export function coreEventToApiEvent(event: ExecutionEvent): ApiDataflowEvent | null {
  switch (event.type) {
    case 'task_started':
      return {
        type: 'start',
        task: event.value.task,
        timestamp: event.value.timestamp.toISOString(),
      };

    case 'task_completed':
      if (event.value.cached) {
        return {
          type: 'cached',
          task: event.value.task,
          timestamp: event.value.timestamp.toISOString(),
        };
      }
      return {
        type: 'complete',
        task: event.value.task,
        timestamp: event.value.timestamp.toISOString(),
        duration: Number(event.value.duration),
      };

    case 'task_failed': {
      // If there's an exit code, treat as 'failed'; otherwise as 'error'
      const exitCode = event.value.exitCode.type === 'some' ? event.value.exitCode.value : undefined;
      const error = event.value.error.type === 'some' ? event.value.error.value : undefined;

      if (exitCode !== undefined) {
        return {
          type: 'failed',
          task: event.value.task,
          timestamp: event.value.timestamp.toISOString(),
          duration: Number(event.value.duration),
          exitCode,
        };
      }
      return {
        type: 'error',
        task: event.value.task,
        timestamp: event.value.timestamp.toISOString(),
        message: error ?? 'Unknown error',
      };
    }

    case 'task_skipped':
      return {
        type: 'input_unavailable',
        task: event.value.task,
        timestamp: event.value.timestamp.toISOString(),
        reason: `Upstream task '${event.value.cause}' failed`,
      };

    // Events without API equivalents
    case 'execution_started':
    case 'task_ready':
    case 'execution_completed':
    case 'execution_cancelled':
      return null;
  }
}

/**
 * Convert e3-core execution status to API status.
 *
 * @param status - The e3-core execution status
 * @returns API-compatible status string
 */
export function coreStatusToApiStatus(status: DataflowExecutionStatus): ApiExecutionStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'aborted';
  }
}

/**
 * Convert e3-core execution state to API-compatible state.
 *
 * @param state - The e3-core execution state
 * @param events - Events to include (already filtered by offset/limit)
 * @param totalEvents - Total number of events for pagination
 * @param duration - Total execution duration in milliseconds
 * @returns API-compatible execution state
 */
export function coreStateToApiState(
  state: DataflowExecutionState,
  events: ExecutionEvent[],
  totalEvents: number,
  duration: number
): ApiExecutionState {
  // Convert events, filtering out those without API equivalents
  const apiEvents: ApiDataflowEvent[] = [];
  for (const event of events) {
    const apiEvent = coreEventToApiEvent(event);
    if (apiEvent !== null) {
      apiEvents.push(apiEvent);
    }
  }

  // Build summary if execution is complete
  let summary: ApiExecutionSummary | null = null;
  if (state.status !== 'running') {
    summary = {
      executed: state.executed,
      cached: state.cached,
      failed: state.failed,
      skipped: state.skipped,
      duration,
    };
  }

  // Get completedAt value (handle Option type)
  const completedAtValue = state.completedAt.type === 'some'
    ? state.completedAt.value.toISOString()
    : null;

  return {
    status: coreStatusToApiStatus(state.status as DataflowExecutionStatus),
    startedAt: state.startedAt.toISOString(),
    completedAt: completedAtValue,
    summary,
    events: apiEvents,
    totalEvents: BigInt(totalEvents),
  };
}
