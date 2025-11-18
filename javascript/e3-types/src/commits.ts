/**
 * E3 Commit Type Definitions
 *
 * Defines the structure of commits in the E3 repository using East types.
 */

import { VariantType, StructType, StringType, ArrayType, IntegerType, NullType, ValueTypeOf } from '@elaraai/east';

export const NewTaskCommitType = StructType({
  task_id: StringType,
  ir: StringType,
  args: ArrayType(StringType),
  runtime: StringType,
  parent: VariantType({
    Some: StringType,
    None: NullType,
  }),
  timestamp: StringType,
});

export const TaskDoneCommitType = StructType({
  parent: StringType,
  result: StringType,
  runtime: StringType,
  execution_time_us: IntegerType,
  timestamp: StringType,
});

export const TaskErrorCommitType = StructType({
  parent: StringType,
  error_message: StringType,
  error_stack: ArrayType(StringType),
  runtime: StringType,
  execution_time_us: IntegerType,
  timestamp: StringType,
});

export const TaskFailCommitType = StructType({
  parent: StringType,
  error_message: StringType,
  runtime: StringType,
  execution_time_us: IntegerType,
  timestamp: StringType,
});

/**
 * Commit type - union of all commit types
 */
export const CommitType = VariantType({
  new_task: NewTaskCommitType,
  task_done: TaskDoneCommitType,
  task_error: TaskErrorCommitType,
  task_fail: TaskFailCommitType,
});

// TypeScript types derived from East types
export type NewTaskCommit = ValueTypeOf<typeof NewTaskCommitType>;
export type TaskDoneCommit = ValueTypeOf<typeof TaskDoneCommitType>;
export type TaskErrorCommit = ValueTypeOf<typeof TaskErrorCommitType>;
export type TaskFailCommit = ValueTypeOf<typeof TaskFailCommitType>;
export type Commit = ValueTypeOf<typeof CommitType>;
