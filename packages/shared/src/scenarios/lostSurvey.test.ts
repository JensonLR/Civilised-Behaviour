import { describe, expect, it } from "vitest";
import type { CampaignState, ScenarioFx } from "../campaignTypes.ts";
import { OBJECTIVE_SPOTS, objectiveMark } from "../compassMarks.ts";
import { newCampaign } from "../factions.ts";
import { NavQuery, buildNavGrid, newNavPath } from "../nav.ts";
import { SALTMARKET, SALTMARKET_SURVEY, createSaltmarketWorld, saltmarketNavOptions, type SaltmarketTerrain } from "../saltmarket.ts";
import type { ScenarioInput } from "../scenario.ts";
import { LOST, lostSurveyTemplate as def, type SurveyState } from "./lostSurvey.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { OUTCOME_KIND } from "./terms.ts";
import type { Fx } from "./types.ts";

/** D-093: the Lost Survey, the Saltmarket's third contract. */
function seedWith(pred: (s: SurveyState) => boolean): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 600; seed++) {
    const c = { ...newCampaign(seed), purse: 300 };
    if (pred(def.init(c, 0, seed))) return { c, seed };
  }
  throw new Error("no seed");
}
const { c: C, seed: SEED } = seedWith((s) => s.complication === "none");
const S0 = def.init(C, 0, SEED);
interface Run { s: SurveyState; fx: Fx[] }
function drive(events: readonly ScenarioInput[], s0: SurveyState = S0): Run {
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
const near = (party = 2): ScenarioInput => ({ t: "near", at: "house", party });
const collector = (result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind: "dues_collector", result, paid });
const surveyor = (result: Extract<ScenarioInput, { t: "talk" }>["result"]): ScenarioInput => ({ t: "talk", kind: "lost_surveyor", result, paid: 0 });
const arrived: ScenarioInput = { t: "actor", id: "surveyor", state: "arrived" };
const wardens = (broken: number): ScenarioInput => ({ t: "count", group: "wardens", alive: LOST.wardens - broken, routed: 0, down: broken, total: LOST.wardens });
const follows = (fx: readonly Fx[]): boolean => fx.some((f) => typeof f === "object" && (f as ScenarioFx).k === "follow" && (f as Extract<ScenarioFx, { k: "follow" }>).group === "surveyor");
const PAY: ScenarioInput[] = [near(), collector("open"), collector("paid", S0.price.dues)];

describe("The Lost Survey (D-093)", () => {
  it("is deterministic, its prices and tide are inside their ranges, and rain brings the tide on early while fog holds it off", () => {
    expect(def.init(C, 0, SEED)).toEqual(S0);
    for (let seed = 1; seed < 200; seed++) {
      const s = def.init({ ...newCampaign(seed), purse: 300 }, 0, seed);
      expect(s.price.dues % 5).toBe(0);
      expect(s.price.dues).toBeGreaterThanOrEqual(LOST.priceDues[0]);
      expect(s.price.dues).toBeLessThanOrEqual(LOST.priceDues[1]);
      expect(s.price.sale).toBeGreaterThanOrEqual(LOST.priceSale[0]);
      expect(s.price.sale).toBeLessThanOrEqual(LOST.priceSale[1]);
      const shift = s.complication === "rain" ? LOST.rainTide : s.complication === "fog" ? LOST.fogTide : 0;
      expect(s.tideAt - shift).toBeGreaterThanOrEqual(LOST.tideMin);
      expect(s.tideAt - shift).toBeLessThanOrEqual(LOST.tideMax);
    }
  });

  it("survey_home, paid: the dues buy the books back, the surveyor follows whoever paid, and his arrival at the quay is a win", () => {
    const r = drive(PAY);
    expect(r.s.books).toBe("surveyor");
    expect(r.s.surveyor).toBe("following");
    expect(r.s.phase).toBe("extract");
    expect(follows(r.fx), "he is told to follow").toBe(true);
    expect(r.s.spent).toBe(S0.price.dues);
    expect(def.view(S0, 0).timerLabel).toMatch(/tide/i);
    expect(def.view(r.s, 0).timerLabel, "the tide no longer matters once he is out of the house").toBe("");
    // the tide comes and goes: he is already walking
    const late = drive([...ticks(S0.tideAt + 10, 5), arrived], r.s);
    expect(late.s.resolution).toBe("survey_home");
    const o = def.outcome(late.s)!;
    expect(o).toMatchObject({ scenario: "lost_survey", resolution: "survey_home", paid: S0.price.dues, brokePromise: false, region: "saltmarket" });
    expect(o.loot).toBeUndefined();
    expect(OUTCOME_KIND.survey_home).toBe("won");
  });

  it("the dues as the parley settled them: an admired ledger's lower price is accepted, a token or more than the purse is not", () => {
    const flattered = Math.round(S0.price.dues * 0.8);
    expect(drive([near(), collector("open"), collector("paid", flattered)]).s.books).toBe("surveyor");
    expect(drive([near(), collector("open"), collector("paid", Math.round(S0.price.dues * 0.5))]).s.books).toBe("held");
    const poor = def.init({ ...C, purse: S0.price.dues - 5 }, 0, SEED);
    expect(drive([near(), collector("open"), collector("paid", S0.price.dues)], poor).s.books).toBe("held");
    // a payment without the talks open is nothing
    expect(drive([near(), collector("paid", S0.price.dues)]).s.books).toBe("held");
  });

  it("survey_home, forced: a threat brings the wardens on; break both and he takes his books, a broken promise to the Houses", () => {
    const r = drive([near(), collector("open"), collector("hostile")]);
    expect(r.s.hostile).toBe(true);
    expect(r.s.phase).toBe("fighting");
    expect(r.fx.some((f) => typeof f === "object" && f.k === "order" && f.group === "wardens" && f.order.o === "alert")).toBe(true);
    // one warden is not enough
    expect(drive([wardens(1)], r.s).s.books).toBe("held");
    const freed = drive([wardens(1), wardens(2)], r.s);
    expect(freed.s.books).toBe("surveyor");
    expect(freed.s.forced).toBe(true);
    expect(follows(freed.fx)).toBe(true);
    const home = drive([arrived], freed.s);
    expect(home.s.resolution).toBe("survey_home");
    expect(def.outcome(home.s)!.brokePromise).toBe(true);
    // the wardens broken before anybody started anything is not a release (a stray count)
    expect(drive([wardens(2)]).s.books).toBe("held");
  });

  it("chart_ceded: the Collector takes the chart, or the surveyor is talked into leaving it; he comes home without it, a settlement short of a win", () => {
    for (const how of [[near(), collector("open"), collector("survey")], [near(), surveyor("open"), surveyor("learn"), surveyor("survey")]] as ScenarioInput[][]) {
      const r = drive(how);
      expect(r.s.books).toBe("ceded");
      expect(follows(r.fx)).toBe(true);
      const home = drive([arrived], r.s);
      expect(home.s.resolution).toBe("chart_ceded");
      expect(def.outcome(home.s)!.paid).toBe(0);
    }
    expect(OUTCOME_KIND.chart_ceded).toBe("partial");
    // once the chart is ceded the Collector has nothing left to sell back
    const ceded = drive([near(), collector("open"), collector("survey")]).s;
    expect(drive([collector("open")], ceded).s.parley).toBeUndefined();
  });

  it("survey_sold: the Houses buy the survey on the spot, the party is paid and the surveyor stays (the contract ends at once)", () => {
    const r = drive([near(), collector("open"), collector("tip")]);
    expect(r.s.resolution).toBe("survey_sold");
    expect(follows(r.fx)).toBe(false);
    const o = def.outcome(r.s)!;
    expect(o.loot).toBe(S0.price.sale);
    expect(OUTCOME_KIND.survey_sold).toBe("partial");
    const v = def.view(r.s, 0);
    expect(v.objectives.find((o2) => o2.id === "quay")!.done).toBe(true);
  });

  it("survey_lost: the tide with the surveyor still at the house (with a warning first), or the surveyor down on the way", () => {
    const warn = drive(ticks(S0.tideAt - 80, 2));
    expect(warn.fx.some((f) => typeof f === "object" && f.k === "say" && /rising/.test(f.text))).toBe(true);
    expect(warn.s.resolution).toBeUndefined();
    const tide = drive([near(), ...ticks(S0.tideAt + 2, 2)]);
    expect(tide.s.resolution).toBe("survey_lost");
    const down = drive([...PAY, { t: "actor", id: "surveyor", state: "down" }]);
    expect(down.s.resolution).toBe("survey_lost");
    expect(OUTCOME_KIND.survey_lost).toBe("lost");
    // the sooner the rain, the sooner the tide
    const wet = seedWith((s) => s.complication === "rain"), dry = seedWith((s) => s.complication === "fog");
    const rain = def.init(wet.c, 0, wet.seed), fog = def.init(dry.c, 0, dry.seed);
    expect(rain.tideAt).toBeLessThanOrEqual(LOST.tideMax + LOST.rainTide);
    expect(fog.tideAt).toBeGreaterThanOrEqual(LOST.tideMin + LOST.fogTide);
  });

  it("leaving commits nothing when nothing happened, the survey lost once anything did; the party down is abandoned; the state freezes once resolved", () => {
    expect(def.leave(S0)).toBeUndefined();
    expect(def.leave(drive([{ t: "use", target: "peg", slot: 0 }]).s)).toBe("survey_lost");
    expect(def.leave(drive([near()]).s)).toBe("survey_lost");
    expect(def.leave(drive(PAY).s)).toBe("survey_lost");
    const ab = drive([near(), { t: "party_down" }]);
    expect(ab.s.resolution).toBe("abandoned");
    const after = drive([...PAY, arrived], ab.s);
    expect(after.s.resolution).toBe("abandoned");
  });

  it("the trail: the strip goes peg, then windpump, then the house; the chalk alone is enough; the house can be found without either", () => {
    const ids = (s: SurveyState): string[] => def.view(s, 0).objectives.map((o) => o.id);
    expect(ids(S0)[0]).toBe("peg");
    const peg = drive([{ t: "use", target: "peg", slot: 0 }]);
    expect(peg.s.trail).toBe(1);
    expect(ids(peg.s)[0]).toBe("pump");
    const pump = drive([{ t: "use", target: "pump", slot: 0 }], peg.s);
    expect(ids(pump.s)[0]).toBe("house");
    expect(drive([{ t: "use", target: "pump", slot: 0 }]).s.trail).toBe(2);
    const found = drive([near()]);
    expect(def.view(found.s, 0).objectives[0]).toMatchObject({ id: "house", done: true });
    // the compass follows: each step's flag stands on the mark the objective names
    for (const s of [S0, peg.s, pump.s]) {
      const v = def.view(s, 0);
      const m = objectiveMark("saltmarket", v)!;
      const spot = OBJECTIVE_SPOTS.lost_survey[v.objectives[0]!.id]!;
      expect(spot).not.toBe("home");
      if (spot !== "home") expect([m.x, m.z]).toEqual([spot.x, spot.z]);
    }
    // the parley's terms reach the hint once asked
    const asked = drive([near(), collector("open"), collector("learn")]);
    expect(def.view(asked.s, 0).hint).toContain(`£${S0.price.sale}`);
  });

  it("the parley scripts give the template what it reads: the Collector pays, cedes and sells; the surveyor only cedes; both name the reed-cutter's house", () => {
    const ctx = { price: S0.price.dues, purse: 300, seed: 3, day: 2 };
    const results = (kind: "dues_collector" | "lost_surveyor"): Set<string> => {
      const v = openSiteParley(kind, ctx);
      expect(v.frame?.heading).toMatch(/reed-cutter's house/);
      const out = new Set<string>();
      for (let i = 0; i < v.options.length; i++) {
        const st = answerSiteParley(kind, ctx, v, i);
        if (st.done) out.add(st.done.result);
        else if (st.view) for (let k = 0; k < st.view.options.length; k++) { const s2 = answerSiteParley(kind, ctx, st.view, k); if (s2.done) out.add(s2.done.result); }
      }
      return out;
    };
    expect([...results("dues_collector")].sort()).toEqual(["hostile", "paid", "survey", "tip", "walked"]);
    expect([...results("lost_surveyor")].sort()).toEqual(["survey", "walked"]);
  });

  describe("on the ground", () => {
    for (const seed of [1, 7, 42]) {
      const world = createSaltmarketWorld(seed);
      const q = new NavQuery(buildNavGrid(world, saltmarketNavOptions(world)));
      const path = newNavPath();
      it(`seed ${seed}: everybody stands on open, dry ground by the hut, and the surveyor has a whole path home to the quay`, () => {
        for (const sp of def.roster(C, SEED, S0)) {
          expect(q.open(sp.post.x, sp.post.z), `${sp.id} open`).toBe(true);
          expect((world.terrain as SaltmarketTerrain).waterDepth(sp.post.x, sp.post.z), `${sp.id} dry`).toBe(0);
          expect(Math.hypot(sp.post.x - SALTMARKET_SURVEY.house.x, sp.post.z - SALTMARKET_SURVEY.house.z), `${sp.id} at the house`).toBeLessThan(LOST.houseR - 4);
        }
        const P = SALTMARKET_SURVEY;
        // a way home exists: the walk is longer than one search's budget (he follows a leader in short hops in play), so it is searched in legs, each from where the last one ended
        let x: number = P.surveyor.x, z: number = P.surveyor.z, legs = 0;
        for (; legs < 8; legs++) {
          expect(q.path(x, z, P.quay.x, P.quay.z, path), `leg ${legs}`).toBe(true);
          x = path.x[path.n - 1]!;
          z = path.z[path.n - 1]!;
          if (path.complete) break;
        }
        expect(path.complete, "a whole path home, in legs").toBe(true);
        expect(Math.hypot(x - P.quay.x, z - P.quay.z)).toBeLessThan(LOST.quayR);
        expect(q.path(P.quay.x, P.quay.z, P.peg.x, P.peg.z, path) && path.complete, "the peg from the quay").toBe(true);
        // the chalk is on the windpump's leg out in the pond: waded to (never deep), from somewhere a body fits
        const wd = (world.terrain as SaltmarketTerrain).waterDepth(P.pumpMark.x, P.pumpMark.z);
        expect(wd, "the pond is shallow at the windpump").toBeLessThan(0.9);
        const y = world.groundHeight(P.pumpMark.x, P.pumpMark.z, 1e6);
        expect(world.resolveXZ({ x: P.pumpMark.x, z: P.pumpMark.z }, y, 0.6, 1.8), "nothing solid where the chalk is read").toBe(false);
        expect(y).toBeGreaterThan(SALTMARKET.waterY - 0.9);
        // the house's own circle reaches the people, and the quay's circle is the boardwalk's dry end
        expect((world.terrain as SaltmarketTerrain).waterDepth(P.quay.x, P.quay.z)).toBe(0);
      }, 60_000);
    }
  });
});
