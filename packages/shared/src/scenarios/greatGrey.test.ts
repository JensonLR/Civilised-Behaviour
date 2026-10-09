import { describe, expect, it } from "vitest";
import type { CampaignState } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { OBJECTIVE_SPOTS, objectiveMark } from "../compassMarks.ts";
import { newCampaign } from "../factions.ts";
import { HIGHMARK_ANCHORS, HIGHMARK_SITES, createHighmarkWorld, highmarkNavOptions, type HighmarkTerrain } from "../highmark.ts";
import { NavQuery, buildNavGrid, newNavPath } from "../nav.ts";
import type { ScenarioInput } from "../scenario.ts";
import { HUNT, greatGreyTemplate as def, type HuntState } from "./greatGrey.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { OUTCOME_KIND } from "./terms.ts";
import type { Fx } from "./types.ts";

/** D-094: the Great Grey, Highmark's third contract (the GDD's hunt). */
function seedWith(pred: (s: HuntState) => boolean): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 600; seed++) {
    const c = { ...newCampaign(seed), purse: 300 };
    if (pred(def.init(c, 0, seed))) return { c, seed };
  }
  throw new Error("no seed");
}
const { c: C, seed: SEED } = seedWith((s) => s.complication === "none");
const S0 = def.init(C, 0, SEED);
function drive(events: readonly ScenarioInput[], s0: HuntState = S0): { s: HuntState; fx: Fx[] } {
  let s = s0;
  const fx: Fx[] = [];
  for (const e of events) {
    const r = def.reduce(s, e);
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx };
}
const ticks = (seconds: number, dt = 1): ScenarioInput[] => Array.from({ length: Math.ceil(seconds / dt) }, () => ({ t: "tick", dt }));
const near: ScenarioInput = { t: "near", at: "barley", party: 2 };
const master = (result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind: "master_of_hunt", result, paid });
const agent = (result: Extract<ScenarioInput, { t: "talk" }>["result"]): ScenarioInput => ({ t: "talk", kind: "menagerie_agent", result, paid: 0 });
const actor = (id: string, state: "down" | "arrived" | "left"): ScenarioInput => ({ t: "actor", id, state });
const shot: ScenarioInput = { t: "hostile", at: "grey" };
const LICENCE: ScenarioInput[] = [near, master("open"), master("paid", S0.price.licence)];

describe("The Great Grey (D-094)", () => {
  it("is deterministic, its prices and bell inside their ranges, and rain rings the bell early", () => {
    expect(def.init(C, 0, SEED)).toEqual(S0);
    for (let seed = 1; seed < 200; seed++) {
      const s = def.init({ ...newCampaign(seed), purse: 300 }, 0, seed);
      expect(s.price.licence % 5).toBe(0);
      expect(s.price.licence).toBeGreaterThanOrEqual(HUNT.priceLicence[0]);
      expect(s.price.licence).toBeLessThanOrEqual(HUNT.priceLicence[1]);
      expect(s.price.sale).toBeGreaterThanOrEqual(HUNT.priceSale[0]);
      expect(s.price.sale).toBeLessThanOrEqual(HUNT.priceSale[1]);
      const shift = s.complication === "rain" ? HUNT.rainBell : 0;
      expect(s.bellAt - shift).toBeGreaterThanOrEqual(HUNT.bellMin);
      expect(s.bellAt - shift).toBeLessThanOrEqual(HUNT.bellMax);
    }
  });

  it("grey_trophy, licensed: the licence bought, the shot lawful, the beast down is a win with no broken promise", () => {
    const r = drive([...LICENCE, shot]);
    expect(r.s.licence).toBe(true);
    expect(r.s.poached).toBe(false);
    expect(r.s.spent).toBe(S0.price.licence);
    const down = drive([actor("grey@fold", "down")], r.s);
    expect(down.s.resolution).toBe("grey_trophy");
    expect(def.outcome(down.s)).toMatchObject({ scenario: "great_grey", resolution: "grey_trophy", paid: S0.price.licence, brokePromise: false, region: "highmark" });
    expect(OUTCOME_KIND.grey_trophy).toBe("won");
    // the beast's three watches each report its fall: the first ends it, the rest are frozen out
    expect(drive([actor("grey@pen", "down"), actor("grey@range", "down")], down.s).s.resolution).toBe("grey_trophy");
  });

  it("grey_trophy, poached: a shot (even a miss) without the licence is poaching, and the trophy keeps the broken promise; buying the licence afterwards does not unring it", () => {
    const r = drive([near, shot]);
    expect(r.s.poached).toBe(true);
    expect(r.s.brokePromise).toBe(true);
    expect(r.fx.some((f) => typeof f === "object" && f.k === "say" && /POACHING/.test(f.text))).toBe(true);
    const late = drive([master("open"), master("paid", S0.price.licence), actor("grey@fold", "down")], r.s);
    expect(late.s.resolution).toBe("grey_trophy");
    expect(def.outcome(late.s)!.brokePromise).toBe(true);
  });

  it("grey_driven: back into its herd, alive, is a win; a fold reached after a shot is still a win (and still poaching)", () => {
    const r = drive([near, actor("grey@range", "arrived"), actor("grey@fold", "arrived")]);
    expect(r.s.resolution).toBe("grey_driven");
    expect(OUTCOME_KIND.grey_driven).toBe("won");
    expect(def.outcome(r.s)!.brokePromise).toBe(false);
    expect(def.outcome(drive([near, shot, actor("grey@fold", "arrived")]).s)).toMatchObject({ resolution: "grey_driven", brokePromise: true });
  });

  it("grey_sold: the agent's pen is shut until a price is agreed; agreed, the beast in it is the sale, paid as loot", () => {
    const shut = drive([near, actor("grey@pen", "arrived")]);
    expect(shut.s.resolution).toBeUndefined();
    expect(shut.s.penShut).toBe(true);
    expect(shut.fx.some((f) => typeof f === "object" && f.k === "say" && /shut/.test(f.text))).toBe(true);
    const deal = drive([agent("open"), agent("learn"), agent("survey")], shut.s);
    expect(deal.s.deal).toBe(true);
    expect(def.view(deal.s, 0).objectives.some((o) => o.id === "pen")).toBe(true);
    // (the runner reports `arrived` once per entry into the circle: it walks out and back in)
    const sold = drive([actor("grey@pen", "arrived")], deal.s);
    expect(sold.s.resolution).toBe("grey_sold");
    expect(def.outcome(sold.s)!.loot).toBe(S0.price.sale);
    expect(OUTCOME_KIND.grey_sold).toBe("partial");
  });

  it("grey_escaped: off the herd ground, or the harvest bell first (with a warning); leaving after anything happened; abandoned when the party is down", () => {
    expect(drive([near, actor("grey@range", "arrived"), actor("grey@range", "left")]).s.resolution).toBe("grey_escaped");
    const warn = drive(ticks(S0.bellAt - 80, 2));
    expect(warn.fx.some((f) => typeof f === "object" && f.k === "say" && /bell/.test(f.text))).toBe(true);
    expect(warn.s.resolution).toBeUndefined();
    expect(drive(ticks(S0.bellAt + 2, 2)).s.resolution).toBe("grey_escaped");
    expect(OUTCOME_KIND.grey_escaped).toBe("lost");
    expect(def.leave(S0)).toBeUndefined();
    expect(def.leave(drive([near]).s)).toBe("grey_escaped");
    expect(drive([near, { t: "party_down" }]).s.resolution).toBe("abandoned");
  });

  it("the licence's price is the band the other parleys use; a token, or more than the purse, buys nothing", () => {
    expect(drive([near, master("open"), master("paid", Math.round(S0.price.licence * 0.8))]).s.licence).toBe(true);
    expect(drive([near, master("open"), master("paid", Math.round(S0.price.licence * 0.4))]).s.licence).toBe(false);
    const poor = def.init({ ...C, purse: S0.price.licence - 5 }, 0, SEED);
    expect(drive([near, master("open"), master("paid", S0.price.licence)], poor).s.licence).toBe(false);
  });

  it("the orders card carries the poaching rule until the licence is bought; the compass points at the barley, then its herd camp", () => {
    expect(def.view(S0, 0).rule).toMatch(/licence/);
    expect(def.view(drive(LICENCE).s, 0).rule).toBeUndefined();
    const v0 = def.view(S0, 0);
    expect(objectiveMark("highmark", v0)).toMatchObject({ x: HIGHMARK_SITES.strike.barley.x, z: HIGHMARK_SITES.strike.barley.z });
    const v1 = def.view(drive([near]).s, 0);
    expect(objectiveMark("highmark", v1)).toMatchObject({ x: HIGHMARK_SITES.hunt.fold.x, z: HIGHMARK_SITES.hunt.fold.z });
    for (const o of v0.objectives) expect(o.id in OBJECTIVE_SPOTS.great_grey, o.id).toBe(true);
  });

  it("the roster: one beast in the barley (a beast's brain, nobody's side), the Master, the agent and two drovers; the parleys give the template what it reads", () => {
    const r = def.roster(C, SEED, S0);
    const grey = r.find((sp) => sp.id === "grey")!;
    expect(grey).toMatchObject({ role: NPC.BEAST, brain: "beast", side: "neutral", group: "grey" });
    expect(Math.hypot(grey.post.x - HIGHMARK_SITES.strike.barley.x, grey.post.z - HIGHMARK_SITES.strike.barley.z)).toBeLessThan(HIGHMARK_SITES.strike.barley.r);
    expect(r.filter((sp) => sp.role === NPC.BEAST)).toHaveLength(1);
    const ctx = { price: S0.price.licence, purse: 300, seed: 3, day: 2 };
    const results = (kind: "master_of_hunt" | "menagerie_agent"): string[] => {
      const v = openSiteParley(kind, ctx);
      expect(v.frame?.heading.length).toBeGreaterThan(8);
      const out = new Set<string>();
      for (let i = 0; i < v.options.length; i++) {
        const st = answerSiteParley(kind, ctx, v, i);
        if (st.done) out.add(st.done.result);
        else if (st.view) for (let k = 0; k < st.view.options.length; k++) { const s2 = answerSiteParley(kind, ctx, st.view, k); if (s2.done) out.add(s2.done.result); }
      }
      return [...out].sort();
    };
    expect(results("master_of_hunt")).toEqual(["paid", "walked"]);
    expect(results("menagerie_agent")).toEqual(["survey", "walked"]);
  });

  describe("on the ground", () => {
    for (const seed of [1, 7, 42]) {
      const world = createHighmarkWorld(seed);
      const q = new NavQuery(buildNavGrid(world, highmarkNavOptions(world)));
      const path = newNavPath();
      it(`seed ${seed}: the people stand on open ground; the beast's way from the barley to its herd and to the agent's pen is walkable and dry; both are inside the herd ground's range`, () => {
        for (const sp of def.roster(C, SEED, S0)) expect(q.open(sp.post.x, sp.post.z), `${sp.id} open`).toBe(true);
        const H = HIGHMARK_SITES.hunt;
        for (const goal of [H.fold, H.pen]) {
          let x: number = H.grey.x, z: number = H.grey.z;
          for (let leg = 0; leg < 6; leg++) {
            expect(q.path(x, z, goal.x, goal.z, path)).toBe(true);
            x = path.x[path.n - 1]!;
            z = path.z[path.n - 1]!;
            if (path.complete) break;
          }
          expect(path.complete, `a way to ${goal.x},${goal.z}`).toBe(true);
          expect((world.terrain as HighmarkTerrain).waterDepth(goal.x, goal.z), "the circle's centre is dry").toBe(0);
          expect(Math.hypot(goal.x - HIGHMARK_ANCHORS.herdGround.x, goal.z - HIGHMARK_ANCHORS.herdGround.z) + goal.r).toBeLessThan(H.range);
        }
        expect(Math.hypot(H.grey.x - HIGHMARK_ANCHORS.herdGround.x, H.grey.z - HIGHMARK_ANCHORS.herdGround.z)).toBeLessThan(H.range - 30);
      }, 60_000);
    }
  });
});
