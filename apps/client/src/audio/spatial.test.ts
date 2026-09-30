import { describe, expect, it } from "vitest";
import { bearingWord, newSpatial, spatialise, type Listener } from "./spatial.ts";

const at = (yaw = 0): Listener => ({ x: 0, y: 0, z: 0, yaw });
const s = newSpatial();

describe("spatialisation", () => {
  it("yaw 0 faces -z: a sound to -x is on the left, +x on the right, -z ahead, +z behind", () => {
    expect(spatialise(at(), -10, 0, 0, 5, 100, s).pan).toBeLessThan(-0.8);
    expect(spatialise(at(), 10, 0, 0, 5, 100, s).pan).toBeGreaterThan(0.8);
    expect(Math.abs(spatialise(at(), 0, 0, -10, 5, 100, s).pan)).toBeLessThan(1e-9);
    const behind = spatialise(at(), 0, 0, 10, 5, 100, s);
    expect(Math.abs(behind.az)).toBeGreaterThan(3);
    expect(bearingWord(behind.az)).toBe("behind");
  });

  it("turning the head turns the world: after a quarter turn what was ahead is on the side", () => {
    // CameraRig: forward = (-sin yaw, -cos yaw). Yaw +PI/2 faces -x, so a sound at -x is now ahead and one at -z is to the right.
    expect(bearingWord(spatialise(at(Math.PI / 2), -10, 0, 0, 5, 100, s).az)).toBe("ahead");
    expect(bearingWord(spatialise(at(Math.PI / 2), 0, 0, -10, 5, 100, s).az)).toBe("right");
  });

  it("is at full level inside the reference distance, then falls like 1/d, and is silent at the maximum", () => {
    expect(spatialise(at(), 0, 0, -3, 5, 100, s).gain).toBe(1);
    expect(spatialise(at(), 0, 0, -10, 5, 100, s).gain).toBeCloseTo(0.5, 5);
    expect(spatialise(at(), 0, 0, -20, 5, 100, s).gain).toBeCloseTo(0.25, 5);
    expect(spatialise(at(), 0, 0, -100, 5, 100, s).gain).toBe(0);
    expect(spatialise(at(), 0, 0, -500, 5, 100, s).gain).toBe(0);
    // no sudden cut: the last 30% fades to nothing
    const near = spatialise(at(), 0, 0, -69, 5, 100, s).gain;
    const far = spatialise(at(), 0, 0, -95, 5, 100, s).gain;
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);
  });

  it("gain never rises with distance", () => {
    let prev = 2;
    for (let d = 0; d <= 130; d += 1) {
      const g = spatialise(at(), 0, 0, -d, 8, 120, s).gain;
      expect(g).toBeLessThanOrEqual(prev + 1e-12);
      prev = g;
    }
  });

  it("sounds from behind are duller than the same sound ahead, and far ones duller than near ones", () => {
    const ahead = spatialise(at(), 0, 0, -20, 5, 100, s).cutoff;
    const behind = spatialise(at(), 0, 0, 20, 5, 100, s).cutoff;
    const near = spatialise(at(), 0, 0, -3, 5, 100, s).cutoff;
    expect(behind).toBeLessThan(ahead * 0.5);
    expect(ahead).toBeLessThan(near);
    expect(behind).toBeGreaterThanOrEqual(600);
  });

  it("a sound on top of the listener does not flip sides, and pan stays inside [-1, 1]", () => {
    const p = spatialise(at(), 0.01, 0, 0.01, 2, 50, s);
    expect(Math.abs(p.pan)).toBeLessThan(0.05);
    for (const [x, z] of [[100, 0], [-100, 0], [0, 100], [3, 3]] as const) expect(Math.abs(spatialise(at(1), x, 0, z, 2, 500, s).pan)).toBeLessThanOrEqual(0.92);
  });

  it("distant sounds arrive late (capped), near ones at once, and far ones are wetter", () => {
    expect(spatialise(at(), 0, 0, -10, 5, 500, s).delay).toBe(0);
    expect(spatialise(at(), 0, 0, -200, 5, 500, s).delay).toBeGreaterThan(0.4);
    expect(spatialise(at(), 0, 0, -2000, 5, 5000, s).delay).toBeLessThanOrEqual(0.9);
    const wetNear = spatialise(at(), 0, 0, -5, 5, 500, s).wet;
    expect(spatialise(at(), 0, 0, -80, 5, 500, s).wet).toBeGreaterThan(wetNear);
  });
});
