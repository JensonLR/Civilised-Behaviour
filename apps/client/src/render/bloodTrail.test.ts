import { describe, expect, it } from "vitest";
import { LIMB, ZONE, setWound } from "@cb/shared";
import { TRAIL, trailGap, trailStep } from "./bloodTrail.ts";

/** D-104: a trail you can follow, from the wounds the server replicates. */
describe("D-104: blood trails", () => {
  it("a scratch leaves none; a gash drips; grievous drips closer; a stump and a crawl closer still", () => {
    expect(trailGap(0, 0, false)).toBe(0);
    expect(trailGap(setWound(0, ZONE.ARM_L, 1), 0, false)).toBe(0);
    const gash = trailGap(setWound(0, ZONE.LEG_R, 2), 0, false);
    const grievous = trailGap(setWound(0, ZONE.TORSO, 3), 0, false);
    expect(gash).toBeGreaterThan(grievous);
    expect(grievous).toBeGreaterThan(0);
    expect(trailGap(0, LIMB.ARM_R, false)).toBe(TRAIL.stump);
    expect(trailGap(setWound(0, ZONE.LEG_R, 2), 0, true)).toBe(TRAIL.crawl);
    expect(trailGap(0, 0, true)).toBe(0); // (downed and unwounded: nothing to drip)
  });

  it("drops come every so many metres travelled, not every frame; standing still drops nothing", () => {
    const gap = trailGap(setWound(0, ZONE.LEG_R, 3), 0, false);
    let d = 0;
    let drops = 0;
    for (let i = 0; i < 600; i++) {
      d = trailStep(d, 3, 1 / 60, gap); // ten seconds at 3 m/s: 30 m
      if (d < 0) {
        drops++;
        d = 0;
      }
    }
    expect(drops).toBeGreaterThanOrEqual(Math.floor(30 / gap) - 1);
    expect(drops).toBeLessThanOrEqual(Math.ceil(30 / gap));
    expect(trailStep(0.2, 0.1, 1 / 60, gap)).toBe(0.2);
    expect(trailStep(0.2, 3, 1 / 60, 0)).toBe(0.2);
    expect(trailStep(0.2, Number.NaN, 1 / 60, gap)).toBe(0.2);
  });
});
