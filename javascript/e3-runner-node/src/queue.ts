/**
 * Task queue management with inotify
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

/**
 * Generate a unique worker ID
 */
export function generateWorkerId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Queue manager for watching and claiming tasks
 */
export class QueueManager {
  private repoPath: string;
  private runtime: string;
  private workerId: string;
  private queueDir: string;
  private claimsDir: string;
  private watcher: fs.FSWatcher | null = null;
  private pendingTasks: string[] = [];

  constructor(repoPath: string, runtime: string = 'node') {
    this.repoPath = repoPath;
    this.runtime = runtime;
    this.workerId = generateWorkerId();
    this.queueDir = path.join(repoPath, 'queue', runtime);
    this.claimsDir = path.join(repoPath, 'claims', runtime);

    console.log(`Worker ID: ${this.workerId}`);
  }

  /**
   * Start watching the queue
   */
  start(): void {
    // Set up inotify watcher first (before reading directory)
    this.watcher = fs.watch(this.queueDir, (eventType, filename) => {
      if (filename && eventType === 'rename') {
        // File added or removed - check if it still exists (file added)
        const queueFile = path.join(this.queueDir, filename);
        if (fs.existsSync(queueFile)) {
          const taskId = filename;
          if (!this.pendingTasks.includes(taskId)) {
            this.pendingTasks.push(taskId);
            console.log(`Enqueued: ${taskId}`);
          }
        }
      }
    });

    // Then read existing files
    const existingFiles = fs.readdirSync(this.queueDir);
    for (const taskId of existingFiles) {
      if (!this.pendingTasks.includes(taskId)) {
        this.pendingTasks.push(taskId);
        console.log(`Found existing: ${taskId}`);
      }
    }

    console.log(`Watching queue: ${this.queueDir}`);
    console.log(`Pending tasks: ${this.pendingTasks.length}`);
  }

  /**
   * Try to claim a task atomically
   * Returns the task ID if claimed, null if already claimed
   */
  claimTask(taskId: string): string | null {
    const queueFile = path.join(this.queueDir, taskId);
    const claimFile = path.join(this.claimsDir, `${taskId}.${this.workerId}`);

    try {
      // Atomic rename from queue to claims
      fs.renameSync(queueFile, claimFile);
      console.log(`Claimed: ${taskId}`);
      return taskId;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - already claimed by another worker
        return null;
      }
      throw error;
    }
  }

  /**
   * Release a claimed task (delete claim file)
   */
  releaseClaim(taskId: string): void {
    const claimFile = path.join(this.claimsDir, `${taskId}.${this.workerId}`);

    try {
      fs.unlinkSync(claimFile);
      console.log(`Released claim: ${taskId}`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to release claim for ${taskId}:`, error);
      }
    }
  }

  /**
   * Get the next pending task ID
   */
  getNextTask(): string | null {
    return this.pendingTasks.shift() || null;
  }

  /**
   * Check if there are pending tasks
   */
  hasPendingTasks(): boolean {
    return this.pendingTasks.length > 0;
  }

  /**
   * Get the worker ID
   */
  getWorkerId(): string {
    return this.workerId;
  }

  /**
   * Stop watching the queue
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
