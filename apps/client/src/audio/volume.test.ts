import { describe, expect, it } from "vitest";
import { DEFAULT_VOLUMES, clamp01, dbToGain, gainToDb, gainToVolume, volumeToGain } from "./volume.ts";

describe("volume curve", () => {
  it("maps the ends exactly and is strictly increasing between them", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const g = volumeToGain(i / 100);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });

  it("is a square: halfway is -12 dB, a quarter is -24 dB, and the steps get finer toward the top", () => {
    expect(gainToDb(volumeToGain(0.5))).toBeCloseTo(-12.04, 1);
    expect(gainToDb(volumeToGain(0.25))).toBeCloseTo(-24.08, 1);
    const step = (a: number, b: number): number => gainToDb(volumeToGain(b)) - gainToDb(volumeToGain(a));
    expect(step(0.9, 1)).toBeCloseTo(1.83, 1);
    expect(step(0.1, 0.2)).toBeCloseTo(12.04, 1);
    expect(step(0.1, 0.2)).toBeGreaterThan(step(0.5, 0.6));
    expect(step(0.5, 0.6)).toBeGreaterThan(step(0.9, 1));
  });

  it("clamps junk to the range instead of exploding", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });

  it("round-trips through the inverse", () => {
    for (const v of [0, 0.1, 0.33, 0.5, 0.9, 1]) expect(gainToVolume(volumeToGain(v))).toBeCloseTo(v, 6);
    expect(dbToGain(gainToDb(0.37))).toBeCloseTo(0.37, 6);
    expect(gainToDb(0)).toBe(-120);
  });

  it("the default mix leaves the master with headroom and the band behind the effects", () => {
    expect(DEFAULT_VOLUMES.master).toBeLessThan(1);
    expect(DEFAULT_VOLUMES.music).toBeLessThan(DEFAULT_VOLUMES.sfx);
  });
});
