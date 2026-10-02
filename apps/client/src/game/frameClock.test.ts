import { describe, expect, it } from "vitest";
import { MAX_STEP_S, frameDelta } from "./frameClock.ts";

describe("the frame clock (D-047)", () => {
  it("a slow frame is measured as slow and stepped as the clamp", () => {
    expect(frameDelta(1400, 1000)).toEqual({ raw: 0.4, step: MAX_STEP_S });
    expect(frameDelta(1016, 1000).raw).toBeCloseTo(0.016, 6);
    expect(frameDelta(1016, 1000).step).toBeCloseTo(0.016, 6);
    expect(frameDelta(900, 1000)).toEqual({ raw: 0, step: 0 });   // (a clock that steps back is no time at all)
  });
});
