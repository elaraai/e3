/**
 * e3 run command - Submit a task for execution
 */

import React from 'react';
import { render } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepository } from '../repo.js';
import { storeObject, computeTaskId } from '../storage/objects.js';
import { createNewTaskCommit } from '../storage/commits.js';
import { loadIR, irToBeast2, loadValue, valueToBeast2 } from '../storage/formats.js';
import { Success, Error as ErrorMessage, Info } from '../ui/index.js';

/**
 * Submit a task for execution
 */
export async function runTask(
  taskName: string,
  irPath: string,
  argPaths: string[] = [],
  runtime: string = 'node'
): Promise<void> {
  const repoPath = getRepository();

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

    const details = [
      `Task ID: ${taskId}`,
      `Commit: ${commitHash}`,
      `IR Hash: ${irHash}`,
    ];

    if (argsHashes.length > 0) {
      details.push(`Argument Hashes:`);
      argsHashes.forEach((hash, i) => {
        details.push(`  [${i}]: ${hash}`);
      });
    }

    details.push(``);
    details.push(`Run a ${runtime} worker to execute it.`);

    render(
      <Success
        message={`Task '${taskName}' queued successfully`}
        details={details}
      />
    );
  } catch (error) {
    render(<ErrorMessage message={`Failed to submit task: ${error}`} />);
    process.exit(1);
  }
}
