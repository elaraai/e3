# Data

## Named datasets

`.e3/refs/data/x` - ref to an object (do we need the type?)

```bash
# Get a value
echo 42 | e3 set x
e3 set x x.beast2

# Set a value
e3 get x
e3 get x -o x.beast2
```

## Data flow

It would be nice to be able to define a "dataflow task" that watches a named input and reactively updates a named output.

```bash
# function package named f, existing dataset named x, new dataset named y
e3 dataflow add f x y
```

The syntax could likely be improved.

An obvious extension is to allow multiple outputs (particularly if the output is a struct, you should be able to )

### Internal consistency

For dataflows, we should record the "source versions" of the input data like we do in ELARACore's task manager.
That way we can make sure results retain consistency at all times.
We can use the content hash instead of version numbers, though.

### Pachyderm-style globbing

Pachyderm allows for some useful glob patterns in the dataflow:

```bash
# watch a whole "directory" of inputs, produce an output for each
e3 dataflow add f inputs/$1 outputs/$1

# multiple glob patterns, can be reordered (group by month instead of by state)
e3 dataflow add f state/$1/month/$2 month/$2/state/$1

# aggregate everything in inputs/ into... a dictionary?
e3 dataflow add f ...inputs/$1 output

# explode the output (dictionary?) into a whole set of named outputs
e3 dataflow add f input ...outputs/
```

Actually instead of having simple "directories", each structure would have to be an array, set, dict, variant or struct (the root is a struct).
