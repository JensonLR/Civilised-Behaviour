import { describe, expect, it } from "vitest";
import { HOLDUP, findCovered, yieldsAtGunpoint } from "./holdup.ts";

/** D-113: the hold-up. Whose nerve gives at gunpoint, and who is in the sights. */
describe("D-113: at gunpoint", () => {
  it("the broken and the wavering give in; the shaken only alone or hurt; the steady and the stubborn never", () => {
    expect(yieldsAtGunpoint("broken", false, 100, 50)).toBe(true);
    expect(yieldsAtGunpoint("wavering", false, 100, 50)).toBe(true);
    expect(yieldsAtGunpoint("shaken", false, 100, 50)).toBe(false);
    expect(yieldsAtGunpoint("shaken", true, 100, 50)).toBe(true);
    expect(yieldsAtGunpoint("shaken", false, HOLDUP.hurtBelow - 1, 50)).toBe(true);
    expect(yieldsAtGunpoint("steady", true, 10, 50)).toBe(false);
    expect(yieldsAtGunpoint("broken", true, 10, HOLDUP.stubborn)).toBe(false);
  });

  it("the man in the sights: in range, inside the narrow cone, the line open, the nearest", () => {
    const me = { x: 0, z: 0, facing: 0 }; // (yaw 0 looks down -z)
    const rows: [string, { x: number; z: number }][] = [["ahead", { x: 0.4, z: -10 }], ["nearer", { x: -0.2, z: -6 }], ["wide", { x: 4, z: -6 }], ["far", { x: 0, z: -20 }], ["behind", { x: 0, z: 6 }]];
    const each = (cb: (id: string, o: { x: number; z: number }) => void): void => rows.forEach(([k, o]) => cb(k, o));
    expect(findCovered(me, each)).toBe("nearer");
    expect(findCovered(me, each, (o) => o.z !== -6)).toBe("ahead"); // (a wall in front of the nearer man)
    expect(findCovered({ x: 0, z: 0, facing: Math.PI }, each)).toBe("behind");
    expect(findCovered({ x: 0, z: 0, facing: 1.2 }, each)).toBeUndefined();
  });
});
