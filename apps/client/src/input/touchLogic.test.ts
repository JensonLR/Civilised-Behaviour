import { describe, expect, it } from "vitest";
import { TOUCH, anchorWithin, stickFrom, stickRuns } from "./touchLogic.ts";

describe("touch stick (D-049)", () => {
  it("reads the thumb's offset over the radius: nothing inside the deadzone, 1 at the rim and beyond, the direction kept, y down", () => {
    const o = { x: 9, y: 9 };
    expect(stickFrom(100, 100, 100 + TOUCH.stickRadiusPx * TOUCH.dead * 0.9, 100, TOUCH.stickRadiusPx, o)).toEqual({ x: 0, y: 0 });
    stickFrom(100, 100, 100 + TOUCH.stickRadiusPx, 100, TOUCH.stickRadiusPx, o);
    expect(o.x).toBeCloseTo(1, 6);
    expect(o.y).toBe(0);
    stickFrom(100, 100, 100, 100 - 3 * TOUCH.stickRadiusPx, TOUCH.stickRadiusPx, o);   // far past the rim, up the screen
    expect(o.y).toBeCloseTo(-1, 6);
    expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(1 + 1e-9);
    // half way out (past the deadzone) is less than half: the deadzone is taken out and the rest rescaled, so the stick is smooth from the edge of it
    stickFrom(0, 0, TOUCH.stickRadiusPx * 0.5, 0, TOUCH.stickRadiusPx, o);
    expect(o.x).toBeCloseTo((0.5 - TOUCH.dead) / (1 - TOUCH.dead), 6);
    expect(stickFrom(0, 0, Number.NaN, 0, TOUCH.stickRadiusPx, o)).toEqual({ x: 0, y: 0 });
  });

  it("runs only at the rim and forward; the ring is kept whole on a small screen", () => {
    expect(stickRuns({ x: 0, y: -1 })).toBe(true);
    expect(stickRuns({ x: 0, y: -0.8 })).toBe(false);
    expect(stickRuns({ x: 1, y: 0 })).toBe(false);   // to the side: a strafe, not a run
    expect(stickRuns({ x: 0, y: 1 })).toBe(false);   // backwards
    expect(anchorWithin(5, 395, 56, 800, 400)).toEqual({ x: 56, y: 344 });
    expect(anchorWithin(300, 200, 56, 800, 400)).toEqual({ x: 300, y: 200 });
  });
});
