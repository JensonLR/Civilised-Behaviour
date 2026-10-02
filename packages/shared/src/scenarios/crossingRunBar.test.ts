import { describe, expect, it } from "vitest";
import { newCampaign } from "../factions.ts";
import { crossingTemplate, RUN_BAR, type CrossingRun } from "./crossing.ts";
import type { Fx } from "./types.ts";
import type { ScenarioInput } from "../scenario.ts";

/** D-040: walking past the Ward's bar without settling is no longer free: a shout, a few seconds' grace, then the horn. */
const start = (): CrossingRun => {
  let s = crossingTemplate.init(newCampaign(5), 40, 5);
  s = crossingTemplate.reduce(s, { t: "near", at: "bar", party: 1 }).s; // at the bar: the standoff
  return s;
};
const step = (s: CrossingRun, e: ScenarioInput): { s: CrossingRun; fx: Fx[] } => crossingTemplate.reduce(s, e);
const tick = (s: CrossingRun, secs: number): { s: CrossingRun; fx: Fx[] } => {
  const fx: Fx[] = [];
  for (let t = 0; t < secs; t += 0.5) {
    const r = step(s, { t: "tick", dt: 0.5 });
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx };
};
const alerted = (fx: Fx[]): boolean => fx.some((f) => typeof f === "object" && f.k === "order" && f.group === "ward" && f.order.o === "alert");
const said = (fx: Fx[]): string[] => fx.flatMap((f) => (typeof f === "object" && f.k === "say" ? [f.text] : []));

describe("running the Ward's bar (D-040)", () => {
  it("the road north of the bar is watched: a shout, then the horn if you stay past the grace", () => {
    let s = start();
    expect(s.core.phase).toBe("standoff");
    let r = step(s, { t: "near", at: "past", party: 1 });
    expect(said(r.fx).join(" ")).toMatch(/toll/i);
    expect(alerted(r.fx)).toBe(false);
    s = r.s;
    r = tick(s, RUN_BAR.graceS - 1);
    expect(alerted(r.fx)).toBe(false);
    expect(r.s.core.hostile).toBe(false);
    r = tick(r.s, 2);
    expect(alerted(r.fx)).toBe(true);
    expect(r.s.core.hostile).toBe(true);
    expect(r.s.core.phase).toBe("fighting");
  });

  it("stepping back behind the bar inside the grace keeps the peace; walking past again once warned sounds the horn at once", () => {
    let s = start();
    s = step(s, { t: "near", at: "past", party: 1 }).s;
    s = tick(s, 2).s;
    s = step(s, { t: "near", at: "past", party: 0 }).s;
    const quiet = tick(s, 20);
    expect(alerted(quiet.fx)).toBe(false);
    expect(quiet.s.core.hostile).toBe(false);
    const again = step(quiet.s, { t: "near", at: "past", party: 2 });
    expect(alerted(again.fx)).toBe(true);
  });

  it("once the crossing is settled (paid), in a fight, or under a lit fuse the road is open; a parley is never interrupted", () => {
    let s = start();
    s = step(s, { t: "parley_open" }).s;
    const talking = step(s, { t: "near", at: "past", party: 1 });
    expect(said(talking.fx)).toEqual([]);
    s = step(talking.s, { t: "deal", resolution: "paid", toll: 40, paid: 40 }).s;
    expect(s.core.phase).toBe("resolved");
    const walk = step(step(s, { t: "near", at: "past", party: 0 }).s, { t: "near", at: "past", party: 1 });
    expect(said(walk.fx)).toEqual([]);
    expect(alerted(tick(walk.s, 10).fx)).toBe(false);
    // a settled crossing at the start (on the books) is open too
    const c = newCampaign(5);
    c.history.push({ seq: 1, region: "kessar", resolution: "paid", day: c.day, template: "secure_crossing" });
    let booked = crossingTemplate.init(c, 40, 5);
    booked = step(booked, { t: "near", at: "past", party: 1 }).s;
    expect(alerted(tick(booked, 10).fx)).toBe(false);
  });
});
