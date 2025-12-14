import { East, IntegerType, NullType, StringType } from "@elaraai/east";
import * as e3 from "@elaraai/e3";

const example = e3.customTask(
  "main",
  [],
  StringType,
  (inputs, output) => East.value(`Hello`)
);

export default e3.package('example', '1.1.1', example);

