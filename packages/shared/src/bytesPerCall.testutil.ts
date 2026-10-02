import v8 from "node:v8";
import vm from "node:vm";

/**
 * Bytes allocated per call, as a median over windows, measured from a forced GC.
 * CAUTION: this counts what the ENGINE allocates, not only what the code does. A double passed to or returned from a call the engine did not inline is boxed (16 B), and whether it inlines
 * a call depends on every other shape that has already gone through the same call site in this process (a stub world, then a real one). So a step that runs on a real world measures a few
 * hundred bytes whatever it does (the walker's step measures the same), and the same code reads 0 in a file of its own and 64 after other tests have used it. Two honest uses: compare two
 * steps that ran on the same world in the same state (the walker's step is the yardstick), or measure ONE function alone in a test file of its own on a world that costs nothing
 * (`mountAlloc.test.ts`), where anything above a few bytes is the function's own.
 */
export function bytesPerCall(call: (i: number) => void): number {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as () => void;
  for (let i = 0; i < 20000; i++) call(i);
  const deltas: number[] = [];
  for (let k = 0; k < 5; k++) {
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) call(i);
    deltas.push((process.memoryUsage().heapUsed - before) / 20000);
  }
  return deltas.sort((a, b) => a - b)[2]!;
}
