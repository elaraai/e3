# Example

Example usage of e3, from zilch to live dataflow.

## Init

Create a e3 project at `~/proj`.

```bash
mdkir ~/proj
cd ~/proj
e3 init
```

This creates the `.e3` directory and installs the default `east-node` runner.
It also creates a local npm package for your development work.

(TODO dir structure + contents)

## Upstream registry

We add a remote registry so that we can download packages easily.
Suppose here that `epm` is our "East Package Manager" registry which is where we tend to publish our shared code and so-on.

```bash
e3 remote add https://github.com/elaraai/epm
```

This just adds an entry to `e3.east`.
(Perhaps we'll have a public, "default" upstream registry installed in `e3 init`).

(TODO contents)

## Download dependencies

Next we want to download packages to:

 1. Install our `east-python` runner and set up a venv at `~/proj/.e3/runners/east-python/venv` (or whatever `uv` calls these directories)
 2. Install our `east-python-ml` package with functions to interact with scikit-learn
 3. Install our `east-pretty-printing` library for working with various file formats
 
```bash
e3 add east-python
e3 add east-python-ml --version 3.1.2
e3 add east-pretty-printing --version 2
```

Note these use `uv` to install python, it's east runtime and runner, and scikit-learn (inside `~/proj/.e3/runners/east-python`).
It also uses `npm` to install `@elaraai/east-python-ml@3.1.2` and `@elaraai/east-python-ml@2` into our `~/proj/package.json`.
The config is modified to specify how to use the new runner.

(TODO dir structure + contents)

## Write our "local" East code in TypeScript

```ts
// ~/proj/src/main.ts
import { East, ArrayType, FloatType, StructType } from '@elaraai/east';
import { e3 } from '@elaraai/e3';
import { train, predict } from '@elaraai/east-python-ml';

// define some ML training / prediction logic
const FeatureType = StructType({ temperature: FloatType, ... })

const train_and_predict = East.function([ArrayType[FeatureType], ArrayType[FloatType], ArrayType[FeatureType]], ($, train_x, train_y, pred_x) => {
    const model = $.let(train(train_x, train_y));
    const pred_y = $.let(predict(model, pred_x));

    $.return(pred_y);
});

// make this into a runnable task
const train_and_predic_task = e3.task("train_and_predict", train_and_predict);

// Setup an e3 dataflow
const train_x_dataset = e3.input("inputs/train_x.beast2", ArrayType(FeatureType));
const train_y_dataset = e3.input("inputs/train_y.beast2", ArrayType(FloatType));
const pred_x_dataset = e3.input("inputs/pred_x.beast2", ArrayType(FeatureType));

const train_and_predict_dataflow = e3.dataflow(
    "train_and_predict",
    train_and_predict_task,
    [
        train_x_dataset,
        train_y_dataset,
        pred_x_dataset,
    ],
    "outputs/pred_y.beast2"
)

// if you want to use the output:
const pred_y_dataset = train_and_predict_dataflow.output;

export default e3.template(
    train_and_predict_dataflow, // automatically grabs dependencies
)
```

## Compile the project

```sh
e3 compile
```

Gets the output to main, adds the "local" task and dataflow.

(TODO dir structure + contents)

## Test the task

Use some data external to the project with the task and see what it produces:

```sh
e3 task run train_and_predict ~/data/testsets/train_x.beast2 ~/data/testsets/train_y.beast2 ~/data/testsets/pred_x.beast2 --stdout
```

This will spit out the logs to stderr, and then the output in East format to stdout.

## Add input data and run the dataflow

Now get some data into the `~/proj/inputs` directory.

```sh
cp ~/data/production/train_x.beast2 ~/proj/inputs
cp ~/data/production/train_y.beast2 ~/proj/inputs
cp ~/data/production/pred_x.beast2 ~/proj/inputs

e3 dataflow run
```

This will run the dataflow from end-to-end, ensuring all output datasets are "fresh".
This produces a file at `~/proj/outputs/pred_y.beast2`.
If the task execution has been cached (the data has been run with this task already) then execution will be skipped (and if needed, the output files will be copied from cache to working directory).
So running the above a second time should be nearly instant.

We can then look at the output data from the command line, too:

```sh
# to print to stdout as east format
e3 convert ~/proj/outputs/pred_y.beast2

# to view in a TUI
e3 view ~/proj/outputs/pred_y.beast2
```

And we can find the task logs:

```sh
e3 dataflow logs train_and_predict
```

(TODO dir structure + contents)

## Use watch mode and modify inputs

```sh
e3 dataflow watch
```

Now modify a file in `~/proj/inputs`, and it will re-execute the task.
