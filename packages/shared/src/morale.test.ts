import { describe, expect, it } from "vitest";
import { MORALE, moraleBand, moraleGoal, moraleStep, newMorale, type MoraleInput } from "./morale.ts";

const calm = (o: Partial<MoraleInput> = {}): MoraleInput => ({ dt: 0.1, leader: 0, allies: 0, alliesDown: 0, hpLack: 0, underFire: 0, fear: 0, paid: true, provisions: false, ...o });

describe("morale", () => {
  it("bands: steady >= 70, shaken >= 50, wavering >= 30, broken below", () => {
    expect([100, 70, 69.9, 50, 49.9, 30, 29.9, 0].map(moraleBand)).toEqual(["steady", "steady", "shaken", "shaken", "wavering", "wavering", "broken", "broken"]);
  });

  it("the goal follows the documented formula", () => {
    const m = newMorale(50);
    // 25 + 0.6*bravery + 6*min(allies,4) + 12*leader - 0.5*hpLack - 20*underFire - 0.25*fear - 8*alliesDown
    expect(moraleGoal(m, calm({ allies: 3, leader: 1, hpLack: 20, underFire: 0.5, fear: 40, alliesDown: 1 }), 60)).toBeCloseTo(25 + 36 + 18 + 12 - 10 - 10 - 10 - 8, 6);
    expect(moraleGoal(m, calm({ allies: 9 }), 0)).toBe(25 + 24);
    expect(moraleGoal(m, calm(), 1000)).toBeLessThanOrEqual(100);
  });

  it("rises at most 6/s and falls at most 25/s", () => {
    const up = newMorale(10);
    moraleStep(up, calm({ dt: 0.5 }), 100);
    expect(up.v).toBeCloseTo(13, 6);
    const down = newMorale(90);
    moraleStep(down, calm({ dt: 0.5, hpLack: 100, underFire: 1, alliesDown: 4, fear: 100 }), 0);
    expect(down.v).toBeCloseTo(90 - 12.5, 6);
  });

  it("a fear impulse (shock) lowers the goal and decays 10 per second", () => {
    const m = newMorale(70);
    m.shock = 40;
    const before = moraleGoal(m, calm(), 50);
    moraleStep(m, calm({ dt: 0.5 }), 50);
    expect(m.shock).toBeCloseTo(35, 6);
    expect(moraleGoal(m, calm(), 50)).toBeGreaterThan(before);
    for (let i = 0; i < 100; i++) moraleStep(m, calm(), 50);
    expect(m.shock).toBe(0);
  });

  it("company, a leader, provisions and wages hold the line; the unpaid grumble", () => {
    const base = moraleGoal(newMorale(), calm(), 40);
    expect(moraleGoal(newMorale(), calm({ allies: 3 }), 40)).toBeGreaterThan(base);
    expect(moraleGoal(newMorale(), calm({ leader: 1 }), 40)).toBeGreaterThan(base);
    expect(moraleGoal(newMorale(), calm({ provisions: true }), 40)).toBeGreaterThan(base);
    expect(moraleGoal(newMorale(), calm({ paid: false }), 40)).toBeLessThan(base);
  });

  it("hostile numbers are harmless, and stay in 0..100", () => {
    const m = newMorale(Number.NaN);
    expect(m.v).toBe(0);
    moraleStep(m, calm({ dt: Number.NaN, allies: Infinity, hpLack: -Infinity, fear: Number.NaN, underFire: Number.NaN }), Number.NaN);
    expect(Number.isFinite(m.v) && Number.isFinite(m.shock)).toBe(true);
    for (let i = 0; i < 400; i++) moraleStep(m, calm({ allies: 4, leader: 1, provisions: true }), 100);
    expect(m.v).toBeLessThanOrEqual(100);
    expect(MORALE.rallyAt).toBe(55);
  });
});
