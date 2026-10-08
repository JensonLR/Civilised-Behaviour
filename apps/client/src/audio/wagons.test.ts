import { describe, expect, it } from "vitest";
import { MAX_KNOCKS, ROLL_MIN_SPEED, WagonRoll, creakGap, knockGap, wagonSeed } from "./wagons.ts";

/** Rolls a wagon at a steady speed for `seconds` of frames; returns the knocks and creaks heard and the distance covered. */
function roll(speed: number, seconds: number, seed = 7, dt = 1 / 60): { knocks: number; creaks: number; metres: number; times: number[] } {
  const w = new WagonRoll(seed);
  let knocks = 0;
  let creaks = 0;
  const times: number[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const n = w.step(dt, speed);
    knocks += n;
    if (n > 0) times.push(i * dt);
    if (w.creak) creaks++;
  }
  return { knocks, creaks, metres: w.rolled, times };
}

describe("the wagon's wheels: locked to the distance rolled", () => {
  it("about a knock a metre at every speed a team pulls (the mean gap is 0.95 m), and a creak every few metres", () => {
    for (const v of [1, 2.4, 4, 6.4, 9]) {
      const r = roll(v, 200 / v);
      expect(r.metres).toBeCloseTo(200, 0);
      expect(r.knocks / r.metres, `v=${v}`).toBeGreaterThan(0.95);
      expect(r.knocks / r.metres, `v=${v}`).toBeLessThan(1.16);
      expect(r.metres / r.creaks, `v=${v}`).toBeGreaterThan(3.5);
      expect(r.metres / r.creaks, `v=${v}`).toBeLessThan(7.5);
    }
  });

  it("the gaps are uneven (a road, not a metronome), within 0.7 .. 1.2 m, and the same wagon rolls the same way every time", () => {
    const gaps = new Set<number>();
    for (let n = 0; n < 200; n++) {
      const g = knockGap(11, n);
      expect(g).toBeGreaterThanOrEqual(0.7);
      expect(g).toBeLessThan(1.2);
      gaps.add(Math.round(g * 20));
      expect(creakGap(11, n)).toBeGreaterThanOrEqual(3.5);
      expect(creakGap(11, n)).toBeLessThan(7.5);
    }
    expect(gaps.size).toBeGreaterThan(6);
    expect(roll(4, 20, 3).times).toEqual(roll(4, 20, 3).times);
    expect(roll(4, 20, 3).times).not.toEqual(roll(4, 20, 4).times);
    expect(wagonSeed("w1")).toBe(wagonSeed("w1"));
    expect(wagonSeed("w1")).not.toBe(wagonSeed("w2"));
  });

  it("a standing wagon is silent (a horse shifting its feet does not rattle the load); hostile input is silent; a long frame is a couple of knocks, not a drum roll", () => {
    expect(roll(0, 10).knocks).toBe(0);
    expect(roll(ROLL_MIN_SPEED * 0.9, 30).knocks).toBe(0);
    for (const [dt, v] of [[NaN, 5], [1 / 60, NaN], [-1, 5], [1 / 60, Infinity], [0, 5]] as const) {
      const w = new WagonRoll(1);
      expect(w.step(dt, v), `${dt},${v}`).toBe(0);
      expect(w.creak).toBe(false);
    }
    const w = new WagonRoll(1);
    expect(w.step(5, 12)).toBeLessThanOrEqual(MAX_KNOCKS);
    // and the next frame does not pay back the skipped knocks
    expect(w.step(1 / 60, 12)).toBeLessThanOrEqual(1);
  });

  it("a faster wagon hits harder", () => {
    const slow = new WagonRoll(1);
    slow.step(1 / 60, 1);
    const fast = new WagonRoll(1);
    fast.step(1 / 60, 8);
    expect(fast.loud).toBeGreaterThan(slow.loud);
    expect(fast.loud).toBeLessThanOrEqual(1);
  });
});
