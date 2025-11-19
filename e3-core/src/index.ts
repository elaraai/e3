/**
 * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * E3 Core - Programmatic API for E3 repository operations
 *
 * This package provides the filesystem-based business logic for E3,
 * similar to libgit2 for git. It has no UI dependencies and can be
 * used programmatically.
 */

// Repository management
export {
  initRepository,
  isValidRepository,
  findRepository,
  getRepository,
  setTaskRef,
  deleteTaskRef,
  listTaskRefs,
  type InitRepositoryResult,
} from './repository.js';

// Object storage
export {
  computeHash,
  storeObject,
  loadObject,
  computeTaskId,
  storeObjectFromStream,
  computeHashFromStream,
} from './objects.js';

// Commits
export {
  createNewTaskCommit,
  createTaskDoneCommit,
  createTaskErrorCommit,
  createTaskFailCommit,
  loadCommit,
} from './commits.js';

// Task state
export {
  updateTaskState,
  getTaskState,
  listTasks,
} from './tasks.js';

// Resolution
export {
  resolveToTaskId,
  resolveToCommit,
  resolveObjectHash,
} from './resolve.js';

// Format utilities
export {
  loadIR,
  irToBeast2,
  loadValue,
  valueToBeast2,
  formatEast,
  parseEast,
  loadBeast2,
  writeStreamToFile,
} from './formats.js';
