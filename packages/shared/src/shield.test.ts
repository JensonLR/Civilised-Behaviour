import { describe, expect, it } from "vitest";
import { SHIELD, shieldBetween } from "./shield.ts";

/** D-112: the human shield. When a comrade is in the way. */
describe("D-112: in the way", () => {
  it("between a shooter and the man holding him, on the line: yes; behind the holder, beside the line or behind the shooter: no", () => {
    // shooter at the origin, the holder 20 m north (-z)
    expect(shieldBetween(0, 0, 0, -19.4, 0, -20)).toBe(true);
    expect(shieldBetween(0, 0, 0.6, -19.4, 0, -20)).toBe(true); // (a little off the line is still in the way)
    expect(shieldBetween(0, 0, 2, -19.4, 0, -20)).toBe(false);
    expect(shieldBetween(0, 0, 0, -20.6, 0, -20)).toBe(false); // (held facing away: the shooter is behind the holder)
    expect(shieldBetween(0, 0, 0, 1, 0, -20)).toBe(false);
    expect(shieldBetween(0, 0, 0, 0, 0, 0)).toBe(false); // (no line at all)
    expect(SHIELD.held).not.toBe(1); // (1 is the lariat's)
  });
});
