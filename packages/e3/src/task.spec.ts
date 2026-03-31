/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { East, StringType, IntegerType, FloatType, StructType, EastModuleType, EastIR, variant } from '@elaraai/east';
import { task } from './task.js';
import { input } from './input.js';

describe('task', () => {
  describe('type inference', () => {
    it('accepts single input dataset', () => {
      const name_input = input('name', StringType, 'World');

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(East.str`Hello, ${name}!`)
        )
      );

      assert.strictEqual(greet.kind, 'task');
      assert.strictEqual(greet.name, 'greet');
      assert.strictEqual(greet.output.kind, 'dataset');
    });

    it('accepts multiple input datasets with different types', () => {
      const name_input = input('name', StringType, 'World');
      const count_input = input('count', IntegerType, 1n);

      const repeat_greet = task(
        'repeat_greet',
        [name_input, count_input],
        East.function(
          [StringType, IntegerType],
          StringType,
          ($, name, _count) => $.return(East.str`Hello, ${name}!`)
        )
      );

      assert.strictEqual(repeat_greet.kind, 'task');
      assert.strictEqual(repeat_greet.name, 'repeat_greet');
    });

    it('accepts three input datasets', () => {
      const a_input = input('a', StringType, 'a');
      const b_input = input('b', IntegerType, 1n);
      const c_input = input('c', FloatType, 1.0);

      const combine = task(
        'combine',
        [a_input, b_input, c_input],
        East.function(
          [StringType, IntegerType, FloatType],
          StringType,
          ($, a, _b, _c) => $.return(a)
        )
      );

      assert.strictEqual(combine.kind, 'task');
      assert.strictEqual(combine.inputs.length, 4); // 3 inputs + function_ir
    });

    it('accepts four input datasets (tuple type preservation)', () => {
      const a_input = input('a', StringType, 'a');
      const b_input = input('b', IntegerType, 1n);
      const c_input = input('c', FloatType, 1.0);
      const d_input = input('d', StringType, 'd');

      const combine_four = task(
        'combine_four',
        [a_input, b_input, c_input, d_input],
        East.function(
          [StringType, IntegerType, FloatType, StringType],
          StringType,
          ($, a, _b, _c, _d) => $.return(a)
        )
      );

      assert.strictEqual(combine_four.kind, 'task');
      assert.strictEqual(combine_four.inputs.length, 5); // 4 inputs + function_ir
    });

    it('accepts struct type inputs', () => {
      const PersonType = StructType({
        name: StringType,
        age: IntegerType,
      });

      const person_input = input('person', PersonType, { name: 'Alice', age: 30n });

      const describe_person = task(
        'describe_person',
        [person_input],
        East.function(
          [PersonType],
          StringType,
          ($, person) => $.return(East.str`${person.name} is ${person.age} years old`)
        )
      );

      assert.strictEqual(describe_person.kind, 'task');
    });
  });

  describe('task chaining', () => {
    it('allows using task output as input to another task', () => {
      const name_input = input('name', StringType, 'World');

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(East.str`Hello, ${name}!`)
        )
      );

      const shout = task(
        'shout',
        [greet.output],
        East.function(
          [StringType],
          StringType,
          ($, greeting) => $.return(East.str`${greeting}!!!`)
        )
      );

      assert.strictEqual(shout.kind, 'task');
      assert.strictEqual(shout.name, 'shout');
      // shout depends on greet's output
      assert.ok(shout.deps.has(greet.output));
    });

    it('allows mixing inputs and task outputs', () => {
      const name_input = input('name', StringType, 'World');
      const suffix_input = input('suffix', StringType, '!');

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(East.str`Hello, ${name}`)
        )
      );

      const add_suffix = task(
        'add_suffix',
        [greet.output, suffix_input],
        East.function(
          [StringType, StringType],
          StringType,
          ($, greeting, suffix) => $.return(East.str`${greeting}${suffix}`)
        )
      );

      assert.strictEqual(add_suffix.kind, 'task');
      assert.strictEqual(add_suffix.inputs.length, 3); // function_ir + 2 inputs
    });
  });

  describe('async functions', () => {
    it('accepts an async function', () => {
      const name_input = input('name', StringType, 'World');

      const greet = task(
        'greet',
        [name_input],
        East.asyncFunction(
          [StringType],
          StringType,
          ($, name) => $.return(East.str`Hello, ${name}!`)
        )
      );

      assert.strictEqual(greet.kind, 'task');
      assert.strictEqual(greet.name, 'greet');
      assert.strictEqual(greet.output.kind, 'dataset');
      assert.strictEqual(greet.output.type, StringType);
    });

    it('accepts async function with multiple inputs', () => {
      const name_input = input('name', StringType, 'World');
      const count_input = input('count', IntegerType, 1n);

      const repeat_greet = task(
        'repeat_greet',
        [name_input, count_input],
        East.asyncFunction(
          [StringType, IntegerType],
          StringType,
          ($, name, _count) => $.return(East.str`Hello, ${name}!`)
        )
      );

      assert.strictEqual(repeat_greet.kind, 'task');
      assert.strictEqual(repeat_greet.inputs.length, 3); // function_ir + 2 inputs
    });
  });

  describe('task structure', () => {
    it('creates correct output path', () => {
      const name_input = input('name', StringType, 'World');

      const greet = task(
        'my_task',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(name)
        )
      );

      assert.deepStrictEqual(greet.output.path, [
        variant('field', 'tasks'),
        variant('field', 'my_task'),
        variant('field', 'output'),
      ]);
    });

    it('includes function_ir as first input', () => {
      const name_input = input('name', StringType, 'World');

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(name)
        )
      );

      // First input should be the function_ir dataset
      assert.strictEqual(greet.inputs[0].name, 'function_ir');
    });

    it('preserves custom runner config', () => {
      const name_input = input('name', StringType, 'World');

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(name)
        ),
        {
          runner: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std']
        }
      );

      assert.strictEqual(greet.kind, 'task');
      // The runner is encoded in the command, we just verify the task was created
    });
  });

  describe('module linking', () => {
    it('task without modules has no module dataset', () => {
      const name_input = input('name', StringType, 'World');

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(name)
        )
      );

      // inputs: [function_ir, name_input] — no module dataset
      assert.strictEqual(greet.inputs.length, 2);
      assert.strictEqual(greet.inputs[0].name, 'function_ir');
    });

    it('task with module dependencies includes module dataset', () => {
      const add = East.export("add",
        East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b)));
      const mathModule = East.module("math", add);

      const x_input = input('x', IntegerType, 5n);

      const compute = task(
        'compute',
        [x_input],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => mathModule.add(x, 1n)
        )
      );

      // inputs: [function_ir, module, x_input]
      assert.strictEqual(compute.inputs.length, 3);
      assert.strictEqual(compute.inputs[0].name, 'function_ir');
      assert.strictEqual(compute.inputs[1].name, 'module');
      assert.strictEqual(compute.inputs[1].type, EastModuleType);
    });

    it('module dataset is at correct path', () => {
      const pi = East.export("pi", 42n);
      const mathModule = East.module("math", pi);

      const x_input = input('x', IntegerType, 0n);

      const compute = task(
        'my_task',
        [x_input],
        East.function(
          [IntegerType],
          IntegerType,
          (_$, _x) => {
            const externPi = East.extern("math", "pi", IntegerType);
            return externPi;
          }
        )
      );

      // Task without module usage should have no module dataset
      assert.strictEqual(compute.inputs.length, 2);

      // Now create a task that actually uses the module via property access
      const compute2 = task(
        'my_task2',
        [x_input],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.add(mathModule.pi)
        )
      );

      // Module dataset should be present
      assert.strictEqual(compute2.inputs[1].name, 'module');
      assert.deepStrictEqual(compute2.inputs[1].path, [
        variant('field', 'tasks'),
        variant('field', 'my_task2'),
        variant('field', 'module'),
      ]);
    });

    it('command IR generates -l flag for module', () => {
      const pi = East.export("pi", 42n);
      const mathModule = East.module("math", pi);

      const x_input = input('x', IntegerType, 5n);

      const compute = task(
        'compute',
        [x_input],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.add(mathModule.pi)
        )
      );

      // Compile and evaluate the command IR with test paths
      const commandIr = new EastIR(compute.command);
      const commandFn = commandIr.compile(new Map(), new Map(), []);

      // inputs: [function_ir_path, module_path, x_input_path]
      const args = commandFn(
        ['/tmp/input-0.beast2', '/tmp/input-1.beast2', '/tmp/input-2.beast2'],
        '/tmp/output.beast2'
      );

      // Should include -l for module (input-1) and -i for user input (input-2)
      assert.ok(Array.isArray(args));
      const argsStr = args as string[];

      const lIndex = argsStr.indexOf('-l');
      assert.ok(lIndex >= 0, 'command should include -l flag');
      assert.strictEqual(argsStr[lIndex + 1], '/tmp/input-1.beast2');

      const iIndex = argsStr.indexOf('-i');
      assert.ok(iIndex >= 0, 'command should include -i flag');
      assert.strictEqual(argsStr[iIndex + 1], '/tmp/input-2.beast2');

      // Function IR should be last positional arg
      assert.strictEqual(argsStr[argsStr.length - 1], '/tmp/input-0.beast2');
    });
  });
});
