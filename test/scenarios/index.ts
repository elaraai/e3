/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Re-export ScenarioResult from helpers
export type { ScenarioResult } from '../helpers.js';

// Export scenario functions
export { testPackageLifecycle, type PackageLifecycleConfig } from './package-lifecycle.js';
export { testTaskExecution, testTaskCaching, type TaskExecutionConfig } from './task-execution.js';
export { testInputMutation } from './input-mutation.js';
export {
  testDivisionByZero,
  testArrayOutOfBounds,
  testCustomTaskFailure,
  testNaNHandling,
  testInfinityHandling,
  testEmptyStringHandling,
  testEmptyArrayHandling,
} from './error-handling.js';
export {
  testConcurrentWritesDuringExecution,
  testMultipleSimultaneousStarts,
  testRapidSetStartCycles,
  testInterleavedMultiWorkspace,
} from './concurrent-ops.js';
