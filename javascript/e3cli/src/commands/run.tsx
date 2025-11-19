/**
 * e3 run command - Submit a task for execution
 */

import { render } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { storeObject, computeTaskId } from '../storage/objects.js';
import { createNewTaskCommit } from '../storage/commits.js';
import { loadIR, irToBeast2, loadValue, valueToBeast2 } from '../storage/formats.js';
import { Success, Error as ErrorMessage, Info } from '../ui/index.js';

/**
 * Details about a submitted task
 */
export interface SubmittedTask {
  taskId: string;
  taskName: string;
  commitHash: string;
  irHash: string;
  argHashes: string[];
  runtime: string;
}

/**
 * Result of submitting a task
 */
export interface RunTaskResult {
  success: boolean;
  task?: SubmittedTask;
  error?: Error;
}

/**
 * Core logic for submitting a task for execution
 * This function is decoupled from CLI/UI concerns and can be used programmatically
 */
export async function runTaskCore(
  repoPath: string,
  taskName: string,
  irPath: string,
  argPaths: string[] = [],
  runtime: string = 'node'
): Promise<RunTaskResult> {
  try {
    // 1. Load IR from file (supports .json, .east, .beast2)
    const ir = await loadIR(irPath);

    // 2. Convert IR to Beast2
    const irBeast2 = irToBeast2(ir);

    // 3. Store IR and get hash
    const irHash = await storeObject(repoPath, irBeast2, '.beast2');

    // 4. Load and store arguments
    const argsHashes: string[] = [];

    // Get parameter types from IR
    if (ir.type !== 'Function') {
      throw new Error('IR must be a Function');
    }

    const paramTypes = ir.value.parameters.map((p: any) => p.value.type);

    if (argPaths.length !== paramTypes.length) {
      throw new Error(
        `Expected ${paramTypes.length} arguments, got ${argPaths.length}`
      );
    }

    // Load each argument using its corresponding parameter type
    for (let i = 0; i < argPaths.length; i++) {
      const argValue = await loadValue(argPaths[i], paramTypes[i]);
      const argBeast2 = valueToBeast2(argValue, paramTypes[i]);
      const argHash = await storeObject(repoPath, argBeast2, '.beast2');
      argsHashes.push(argHash);
    }

    // 5. Compute task ID
    const taskId = computeTaskId(irHash, argsHashes, runtime);

    // 6. Create new_task commit
    const commitHash = await createNewTaskCommit(
      repoPath,
      taskId,
      irHash,
      argsHashes,
      runtime
    );

    // 7. Write task_id to refs/tasks/<name>
    const refPath = path.join(repoPath, 'refs', 'tasks', taskName);
    await fs.writeFile(refPath, taskId);

    // 8. Write commit_hash to tasks/<task_id>
    const taskStatePath = path.join(repoPath, 'tasks', taskId);
    await fs.writeFile(taskStatePath, commitHash);

    // 9. Enqueue task: write commit_hash to queue/<runtime>/<task_id>
    const queuePath = path.join(repoPath, 'queue', runtime, taskId);
    await fs.writeFile(queuePath, commitHash);

    return {
      success: true,
      task: {
        taskId,
        taskName,
        commitHash,
        irHash,
        argHashes: argsHashes,
        runtime,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * CLI handler for the run command
 * This function handles the UI/presentation layer
 */
export async function runTask(
  repoPath: string,
  taskName: string,
  irPath: string,
  argPaths: string[] = [],
  runtime: string = 'node'
): Promise<void> {
  render(
    <Info
      message={`Submitting task '${taskName}'`}
      details={[
        `IR: ${irPath}`,
        `Arguments: ${argPaths.length}`,
        `Runtime: ${runtime}`,
      ]}
    />
  );

  const result = await runTaskCore(repoPath,taskName, irPath, argPaths, runtime);

  if (!result.success) {
    render(<ErrorMessage message={`Failed to submit task: ${result.error?.message}`} />);
    process.exit(1);
  }

  const task = result.task!;
  const details = [
    `Task ID: ${task.taskId}`,
    `Commit: ${task.commitHash}`,
    `IR Hash: ${task.irHash}`,
  ];

  if (task.argHashes.length > 0) {
    details.push(`Argument Hashes:`);
    task.argHashes.forEach((hash, i) => {
      details.push(`  [${i}]: ${hash}`);
    });
  }

  details.push(``);
  details.push(`Run a ${task.runtime} worker to execute it.`);

  render(
    <Success
      message={`Task '${task.taskName}' queued successfully`}
      details={details}
    />
  );
}
