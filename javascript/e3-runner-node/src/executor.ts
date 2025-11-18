/**
 * Task execution - compile and run IR
 */

import * as path from 'path';
import { type IR, IntegerType, EastIR } from '@elaraai/east';
import {
  loadCommit,
  loadIR,
  loadArg,
  readCommitHashFromFile,
  storeResult,
  createTaskDoneCommit,
  updateTaskState,
} from './storage.js';

/**
 * Execute a claimed task
 */
export async function executeTask(
  repoPath: string,
  runtime: string,
  taskId: string,
  workerId: string
): Promise<void> {
  const startTime = Date.now();

  console.log(`[${taskId.slice(0, 8)}] Starting execution`);

  try {
    // 1. Read commit hash from claim file
    const claimFile = path.join(repoPath, 'claims', runtime, `${taskId}.${workerId}`);
    const commitHash = await readCommitHashFromFile(claimFile);

    console.log(`[${taskId.slice(0, 8)}] Commit: ${commitHash.slice(0, 8)}`);

    // 2. Load and decode commit
    const commit = await loadCommit(repoPath, commitHash);

    if (commit.type !== 'new_task') {
      throw new Error(`Expected new_task commit, got ${commit.type}`);
    }

    const { ir: irHash, args: argsHashes } = commit.value;

    console.log(`[${taskId.slice(0, 8)}] IR: ${irHash.slice(0, 8)}`);
    console.log(`[${taskId.slice(0, 8)}] Args: ${argsHashes.length}`);

    // 3. Load IR
    const ir = await loadIR(repoPath, irHash);

    console.log(`[${taskId.slice(0, 8)}] IR loaded`);

    // 4. Get parameter types from IR
    if (ir.type !== 'Function') {
      throw new Error('IR must be a Function');
    }

    const paramTypes = (ir.value as any).parameters.map((p: any) => p.value.type);

    // 5. Load arguments using their parameter types
    const args: any[] = [];
    for (let i = 0; i < argsHashes.length; i++) {
      const argHash = argsHashes[i];
      const argType = paramTypes[i];
      const argValue = await loadArg(repoPath, argHash, argType);
      args.push(argValue);
      console.log(`[${taskId.slice(0, 8)}] Loaded arg[${i}]: ${argHash.slice(0, 8)}`);
    }

    // 6. Compile IR using EastIR
    console.log(`[${taskId.slice(0, 8)}] Compiling IR...`);
    const eastIR = new EastIR(ir);
    const compiledFn = eastIR.compile([]); // No platform functions for now

    console.log(`[${taskId.slice(0, 8)}] Compiled successfully`);

    // 7. Execute
    console.log(`[${taskId.slice(0, 8)}] Executing...`);
    const result = compiledFn(...args);

    const endTime = Date.now();
    const executionTimeUs = (endTime - startTime) * 1000;

    console.log(`[${taskId.slice(0, 8)}] Result: ${result}`);
    console.log(`[${taskId.slice(0, 8)}] Execution time: ${executionTimeUs / 1000}ms`);

    // 8. Store result
    // Get the output type from the function type
    const functionType = (ir.value as any).type; // Function type with inputs/output
    const resultType = functionType.value.output; // Output type

    // Convert JavaScript number to BigInt for Integer type
    let resultValue = result;
    if (resultType.type === 'Integer' && typeof result === 'number') {
      resultValue = BigInt(result);
    }

    const resultHash = await storeResult(repoPath, resultValue, resultType);

    console.log(`[${taskId.slice(0, 8)}] Stored result: ${resultHash.slice(0, 8)}`);

    // 9. Create task_done commit
    const taskDoneHash = await createTaskDoneCommit(
      repoPath,
      commitHash,
      resultHash,
      runtime,
      executionTimeUs
    );

    console.log(`[${taskId.slice(0, 8)}] Created task_done: ${taskDoneHash.slice(0, 8)}`);

    // 10. Update task state
    await updateTaskState(repoPath, taskId, taskDoneHash);

    console.log(`[${taskId.slice(0, 8)}] ✓ Complete`);
  } catch (error) {
    const endTime = Date.now();
    const executionTimeUs = (endTime - startTime) * 1000;

    console.error(`[${taskId.slice(0, 8)}] ✗ Error:`, error);

    // TODO: Create task_error or task_fail commit
    throw error;
  }
}

