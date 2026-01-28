/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Process identification helpers for crash detection.
 *
 * These functions are used by LocalTaskRunner and LocalLockService
 * to detect stale processes and locks after crashes or reboots.
 */

import * as fs from 'fs/promises';

/**
 * Get the current system boot ID.
 * Used for detecting stale locks/processes after system reboot.
 */
export async function getBootId(): Promise<string> {
  try {
    const data = await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf-8');
    return data.trim();
  } catch {
    // Not on Linux, use a placeholder
    return 'unknown-boot-id';
  }
}

/**
 * Get process start time from /proc/<pid>/stat.
 * Returns the starttime field (field 22) which is jiffies since boot.
 * Used together with boot ID to uniquely identify a process (handles PID reuse).
 */
export async function getPidStartTime(pid: number): Promise<number> {
  try {
    const data = await fs.readFile(`/proc/${pid}/stat`, 'utf-8');
    // Fields are space-separated, but comm (field 2) can contain spaces and is in parens
    // Find the closing paren, then split the rest
    const closeParen = data.lastIndexOf(')');
    const fields = data.slice(closeParen + 2).split(' ');
    // After the closing paren, field index 0 is state (field 3), so starttime is at index 19
    // (field 22 - 3 = 19)
    return parseInt(fields[19], 10);
  } catch {
    return 0;
  }
}

/**
 * Check if a process is still alive based on stored identification
 */
export async function isProcessAlive(
  pid: number,
  pidStartTime: number,
  bootId: string
): Promise<boolean> {
  // Different boot? Process is dead
  const currentBootId = await getBootId();
  if (currentBootId !== bootId) return false;

  // Check if PID exists and has same start time
  const currentStartTime = await getPidStartTime(pid);
  if (currentStartTime === 0) return false; // PID doesn't exist
  if (currentStartTime !== pidStartTime) return false; // PID reused

  return true;
}
