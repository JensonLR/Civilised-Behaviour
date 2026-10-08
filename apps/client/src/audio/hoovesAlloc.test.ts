import { describe, expect, it } from "vitest";
import { bytesPerCall } from "@cb/shared/bytesPerCall";
import { HoofCadence } from "./hooves.ts";

/**
 * `HoofCadence.step` runs every frame for every horse and allocates nothing (its state is a typed array). Measured HERE, in a file of its own, with the shared meter (`bytesPerCall`: the median
 * of many small windows from a forced GC). It lived in hooves.test.ts after the hostile-input test, which feeds `step` NaN and Infinity on purpose, and read the raw heap with no forced GC: a
 * loaded CI run read 11.5 B a frame over 200,000 frames (2.3 MB, over its 2 MB line) on code that allocates nothing. In a fresh module the step is monomorphic and what is left is the code's own.
 */
describe("hoofbeat allocation", () => {
  it("a step over a herd's speeds costs a few bytes at most (an object per step would read 16 B or more)", () => {
    const c = new HoofCadence();
    let sink = 0;
    expect(bytesPerCall((i) => { sink += c.step(1 / 60, 2 + (i % 90) / 10, true); })).toBeLessThan(4);
    expect(sink).toBeGreaterThan(0);
  });
});
