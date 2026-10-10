import { describe, expect, it } from "vitest";
import { MOUNT } from "./mount.ts";
import { TRAMPLE, trampleDamage, trampleDir, trampleLift } from "./trample.ts";

/** D-111: ridden down. What the hooves do at each pace, and which way a man goes. */
describe("D-111: the hooves", () => {
  it("nothing at a walk; a trot hurts; a gallop hurts most, capped", () => {
    expect(trampleDamage(MOUNT.walk)).toBe(0);
    expect(trampleDamage(TRAMPLE.minSpeed - 0.01)).toBe(0);
    expect(trampleDamage(MOUNT.trot)).toBeGreaterThan(TRAMPLE.base);
    expect(trampleDamage(MOUNT.gallop)).toBeGreaterThan(trampleDamage(MOUNT.trot));
    expect(trampleDamage(MOUNT.gallop)).toBeLessThanOrEqual(TRAMPLE.max);
    expect(trampleDamage(100)).toBe(TRAMPLE.max);
    expect(trampleDamage(Number.NaN)).toBe(0);
  });

  it("thrown ahead and off the line, to the side he stood on; dead ahead goes right; higher at a gallop", () => {
    const out = { x: 0, z: 0 };
    // heading north (-z): right is +x
    trampleDir(0, -1, 0.5, -0.8, out);
    expect(out.z).toBeLessThan(0);
    expect(out.x).toBeGreaterThan(0);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1, 9);
    trampleDir(0, -1, -0.5, -0.8, out);
    expect(out.x).toBeLessThan(0);
    trampleDir(0, -1, 0, -1, out);
    expect(out.x).toBeGreaterThan(0);
    // heading east (+x): right is +z
    trampleDir(1, 0, 0.9, 0.3, out);
    expect(out.x).toBeGreaterThan(0);
    expect(out.z).toBeGreaterThan(0);
    expect(trampleLift(TRAMPLE.minSpeed)).toBe(0);
    expect(trampleLift(MOUNT.gallop)).toBeCloseTo(TRAMPLE.lift, 9);
    expect(trampleLift(MOUNT.trot)).toBeGreaterThan(0);
    expect(trampleLift(MOUNT.trot)).toBeLessThan(TRAMPLE.lift);
  });
});
