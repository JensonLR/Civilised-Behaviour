import { describe, expect, it } from "vitest";
import { herdAt, herdPlan } from "./highmark.ts";
import { STAMPEDE, decodeHerdRuns, encodeHerdRuns, herdAnimalAt, runDuration, runProfile, type HerdRun } from "./stampede.ts";

/** D-114: the stampede. The run's pace, every animal's place from it, and the string the room carries. */
describe("D-114: a run", () => {
  it("speeds up, runs flat out, pulls up, and ends where it said it would; never faster than flat out", () => {
    const p = { s: 0, v: 0 };
    let last = -1;
    const T = runDuration(40);
    for (let t = -1; t <= T + 1; t += 0.05) {
      runProfile(40, t, p);
      expect(p.s).toBeGreaterThanOrEqual(last - 1e-9);
      expect(p.v).toBeLessThanOrEqual(STAMPEDE.speed + 1e-9);
      last = p.s;
    }
    runProfile(40, T + 0.01, p);
    expect(p.s).toBe(40);
    expect(p.v).toBe(0);
    runProfile(40, T / 2, p);
    expect(p.v).toBeCloseTo(STAMPEDE.speed, 6);
  });

  it("an animal without a run is where it grazes; running, it is well along the run's way at a gallop; after, it is where the herd ended up, drawn back together", () => {
    const plan = herdPlan(7);
    const g = { x: 0, z: 0, yaw: 0 };
    const a = { x: 0, z: 0, yaw: 0, speed: 0 };
    const none: (HerdRun | undefined)[] = [];
    herdAnimalAt(plan, 3, 100, none, a);
    herdAt(plan, 3, 100, g);
    expect(a).toMatchObject({ x: g.x, z: g.z, speed: 0 });
    const runs: (HerdRun | undefined)[] = [{ k: 0, t0: 100, fx: 1, fz: 0, dist: 40, ox: 0, oz: 0 }];
    herdAnimalAt(plan, 3, 103, runs, a);
    herdAt(plan, 3, 103, g);
    expect(a.x - g.x).toBeGreaterThan(15); // (east, flat out)
    expect(a.speed).toBeGreaterThan(STAMPEDE.speed * 0.8);
    expect(Math.cos(a.yaw)).toBeGreaterThan(0.9); // (heading east)
    herdAnimalAt(plan, 3, 140, runs, a);
    herdAt(plan, 3, 140, g);
    expect(a.x - g.x).toBeCloseTo(40, 0); // (where the run ended, the fan drawn back in)
    expect(Math.abs(a.z - g.z)).toBeLessThan(0.5);
    expect(a.speed).toBe(0);
    // another herd's animal is not moved by herd 0's run
    const other = plan.herds[0]!.n + 2;
    herdAnimalAt(plan, other, 103, runs, a);
    herdAt(plan, other, 103, g);
    expect(a.x).toBe(g.x);
  });

  it("travels as a short string and comes back the same; anything malformed is dropped", () => {
    const runs: (HerdRun | undefined)[] = [undefined, { k: 1, t0: 12.5, fx: 0.6, fz: -0.8, dist: 33.3, ox: 4, oz: -2 }];
    const s = encodeHerdRuns(runs);
    expect(s.length).toBeLessThan(60);
    const back = decodeHerdRuns(s, 4);
    expect(back[0]).toBeUndefined();
    expect(back[1]).toEqual(runs[1]);
    expect(decodeHerdRuns("9,1,1,0,10,0,0;x;1,2", 4).every((r) => r === undefined)).toBe(true);
    expect(decodeHerdRuns(undefined, 4)).toHaveLength(4);
  });
});
