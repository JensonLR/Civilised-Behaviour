import { describe, expect, it } from "vitest";
import { spectrum } from "./analyse.ts";
import { RATE, renderVariantOffline } from "./offlineRender.ts";
import { SOUNDS } from "./sounds.ts";

/** D-073: the voices of chaos (a scream, a cry of panic), rendered offline beside the ordinary hurt cry they are measured against. */
const render = (name: string) =>
  Array.from({ length: SOUNDS[name]!.variants }, (_, v) => {
    const { data, stats } = renderVariantOffline(name, SOUNDS[name]!, SOUNDS[name]!.keys[0] ?? "", v);
    return { ...stats, ...spectrum(data, RATE) };
  });
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe("the voices of chaos (D-073)", () => {
  const hurt = render("hurt");
  const scream = render("scream");
  const panic = render("panic");

  it("render clean in every voice: finite, audible, never louder than -1 dBFS", () => {
    for (const r of [...scream, ...panic]) {
      expect(r.nonFinite).toBe(0);
      expect(r.peakDb).toBeLessThanOrEqual(-1);
      expect(r.audibleSeconds).toBeGreaterThan(0.2);
    }
  });

  it("are voices: their energy sits in the speech band, nothing below 200 Hz to speak of", () => {
    for (const r of [...scream, ...panic]) {
      expect(r.centroid).toBeGreaterThan(400);
      expect(r.centroid).toBeLessThan(3200);
      expect(r.bands[1] + r.bands[2]).toBeGreaterThan(0.85);
    }
  });

  it("a scream is a long cry that climbs above the hurt cry; a cry of panic is short and high", () => {
    expect(mean(scream.map((r) => r.audibleSeconds))).toBeGreaterThan(mean(hurt.map((r) => r.audibleSeconds)) * 1.8);
    expect(mean(scream.map((r) => r.centroid))).toBeGreaterThan(mean(hurt.map((r) => r.centroid)));
    expect(mean(panic.map((r) => r.audibleSeconds))).toBeLessThan(mean(scream.map((r) => r.audibleSeconds)));
    expect(mean(panic.map((r) => r.centroid))).toBeGreaterThan(mean(hurt.map((r) => r.centroid)));
    // (and each is a crowd of different people, not one voice: the pitch differs across the variants)
    expect(new Set(scream.map((r) => Math.round(r.centroid / 25))).size).toBeGreaterThan(3);
    expect(new Set(panic.map((r) => Math.round(r.centroid / 25))).size).toBeGreaterThan(3);
  });
});
