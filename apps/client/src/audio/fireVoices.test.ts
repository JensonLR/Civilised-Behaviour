import { Rng } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { newFireVoices, stepFireVoices } from "./fireVoices.ts";
import { spectrum } from "./analyse.ts";
import { RATE, renderVariantOffline } from "./offlineRender.ts";
import { SOUNDS } from "./sounds.ts";

const run = (rain: number, seconds: number, seed = 5): { name: string; volume: number; dx: number }[] => {
  const s = newFireVoices();
  const rng = new Rng(seed);
  const out: { name: string; volume: number; dx: number }[] = [];
  for (let t = 0; t < seconds; t += 0.1) stepFireVoices(s, 0.1, rain, rng, (name, dx, _dz, volume) => out.push({ name, volume, dx }));
  return out;
};
const count = (xs: { name: string }[], n: string): number => xs.filter((x) => x.name === n).length;

describe("the camp fire's voices", () => {
  it("dry: it pops several times a second and snaps every few seconds, and never sizzles", () => {
    const e = run(0, 120);
    expect(count(e, "fire_pop") / 120).toBeGreaterThan(3);
    expect(count(e, "fire_snap") / 120).toBeGreaterThan(0.15);
    expect(count(e, "fire_snap") / 120).toBeLessThan(0.6);
    expect(count(e, "fire_sizzle")).toBe(0);
  });

  it("in a downpour the crackle thins out and quietens and the embers sizzle instead, about twice a second; a shower sizzles less", () => {
    const dry = run(0, 120);
    const wet = run(1, 120);
    const shower = run(0.3, 120);
    expect(count(wet, "fire_pop")).toBeLessThan(count(dry, "fire_pop") * 0.5);
    expect(count(wet, "fire_snap")).toBeLessThan(count(dry, "fire_snap"));
    const loud = (xs: { name: string; volume: number }[]): number => xs.filter((x) => x.name === "fire_pop").reduce((a, x) => a + x.volume, 0) / Math.max(1, count(xs, "fire_pop"));
    expect(loud(wet)).toBeLessThan(loud(dry) * 0.75);
    expect(count(wet, "fire_sizzle") / 120).toBeGreaterThan(1.2);
    expect(count(wet, "fire_sizzle") / 120).toBeLessThan(4);
    expect(count(shower, "fire_sizzle")).toBeLessThan(count(wet, "fire_sizzle") * 0.6);
    for (const x of wet) expect(Math.abs(x.dx)).toBeLessThanOrEqual(0.25); // (on the fire, not beside it)
  });

  it("hostile input emits nothing odd and never throws; a shower after a dry spell does not start with a backlog of sizzles", () => {
    const s = newFireVoices();
    const rng = new Rng(1);
    const vols: number[] = [];
    for (let i = 0; i < 40; i++) for (const [dt, rain] of [[NaN, 1], [-1, 1], [0.1, NaN], [0.1, Infinity], [0.1, -3]] as const) stepFireVoices(s, dt, rain, rng, (_n, dx, dz, v) => vols.push(dx, dz, v));
    expect(vols.length).toBeGreaterThan(0);
    expect(vols.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(s.popIn + s.snapIn + s.sizzleIn)).toBe(true);
    const d = newFireVoices();
    for (let i = 0; i < 600; i++) stepFireVoices(d, 0.1, 0, rng, () => undefined);
    let first = 0;
    stepFireVoices(d, 0.1, 1, rng, (n) => (first += n === "fire_sizzle" ? 1 : 0));
    expect(first).toBeLessThanOrEqual(1);
  });
});

describe("the sizzle itself (rendered offline, every variant)", () => {
  it("is a drop flashing to steam: short, bright (most of it above 4 kHz) and quieter than a pop", () => {
    const d = SOUNDS.fire_sizzle!;
    for (let v = 0; v < d.variants; v++) {
      const { data, stats } = renderVariantOffline("fire_sizzle", d, "", v);
      expect(stats.nonFinite).toBe(0);
      expect(stats.audibleSeconds, `variant ${v}`).toBeGreaterThan(0.1);
      expect(stats.audibleSeconds, `variant ${v}`).toBeLessThan(0.7);
      expect(spectrum(data, RATE).centroid, `variant ${v}`).toBeGreaterThan(4000);
    }
    expect(d.peakDb).toBeLessThanOrEqual(SOUNDS.fire_pop!.peakDb);
  });
});
