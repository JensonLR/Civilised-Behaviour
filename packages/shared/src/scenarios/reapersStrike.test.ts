import { describe, expect, it } from "vitest";
import type { CampaignState, ScenarioTemplateId } from "../campaignTypes.ts";
import { NPC_CAP } from "../campaignTypes.ts";
import { applyOutcome, newCampaign } from "../factions.ts";
import { HIGHMARK_SITES } from "../highmark.ts";
import { pickHighmarkContract } from "../reapersLedger.ts";
import type { ScenarioInput } from "../scenario.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { STRIKE, reapersStrikeTemplate as def, type StrikeState } from "./reapersStrike.ts";
import { pickTemplate } from "./registry.ts";
import type { Fx } from "./types.ts";

function calm(): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 400; seed++) {
    const c = { ...newCampaign(seed), purse: 200 };
    if (def.init(c, 0, seed).complication === "none") return { c, seed };
  }
  throw new Error("no calm seed");
}
const { c: C, seed: SEED } = calm();
const isCommit = (f: Fx): boolean => typeof f === "object" && f.k === "commit";
interface Run { s: StrikeState; fx: Fx[]; commits: number }
function drive(events: readonly ScenarioInput[], s0?: StrikeState): Run {
  let s = s0 ?? def.init(C, 0, SEED);
  const fx: Fx[] = [];
  for (const e of events) {
    const r = def.reduce(s, e);
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx, commits: fx.filter(isCommit).length };
}
const ticks = (seconds: number, dt = 1): ScenarioInput[] => Array.from({ length: Math.ceil(seconds / dt) }, () => ({ t: "tick", dt }));
const talk = (kind: "reaper" | "steward", result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind, result, paid });
const S0 = def.init(C, 0, SEED);
const PROOF: ScenarioInput = { t: "use", target: "proof", slot: 0 };
const arrive = (i: number): ScenarioInput => ({ t: "actor", id: `breaker-${i}`, state: "arrived" });
const said = (fx: Fx[]): string => fx.map((f) => (typeof f === "object" && f.k === "say" ? f.text : "")).join(" | ");

describe("the Reapers' Strike (D-042): the reducer", () => {
  it("an honest measure needs the bushel weighed AND both signatures, in either order; words alone change nothing", () => {
    // without the proof neither side signs
    const words = drive([talk("steward", "open"), talk("steward", "survey"), talk("reaper", "open"), talk("reaper", "survey")]);
    expect(words.s.agreed).toEqual({ steward: false, compact: false });
    expect(words.s.phase).not.toBe("resolved");
    expect(said(words.fx)).toMatch(/On whose evidence/);
    // the Steward first, then the Compact
    const a = drive([PROOF, talk("steward", "open"), talk("steward", "survey"), talk("reaper", "open"), talk("reaper", "survey")]);
    expect(a.s.resolution).toBe("honest_measure");
    expect(a.commits).toBe(1);
    expect(a.s.brokePromise).toBe(false);
    // the Compact first (it waits on the Steward), then the Steward
    const b = drive([PROOF, talk("reaper", "open"), talk("reaper", "survey"), talk("steward", "open"), talk("steward", "survey")]);
    expect(b.s.resolution).toBe("honest_measure");
    // the Compact asked again while it waits does not open a second parley
    const signed = drive([PROOF, talk("reaper", "open"), talk("reaper", "survey")]).s;
    const again = def.reduce(signed, talk("reaper", "open"));
    expect(again.s.parley).toBeUndefined();
    expect(again.fx.some((f) => typeof f === "object" && f.k === "parley")).toBe(false);
    expect(said(again.fx)).toMatch(/The Steward has not/);
  });

  it("the bonus buys the Compact back today; a short or forged payment buys nothing", () => {
    const r = drive([talk("reaper", "open"), talk("reaper", "paid", S0.price.bonus)]);
    expect(r.s.resolution).toBe("bought_back");
    expect(r.s.paid).toBe(S0.price.bonus);
    expect(def.outcome(r.s)).toMatchObject({ scenario: "reapers_strike", region: "highmark", resolution: "bought_back", paid: S0.price.bonus });
    expect(def.outcome(r.s)!.loot).toBeUndefined();
    for (const bad of [0, 1, S0.price.bonus * 3, NaN, -S0.price.bonus]) {
      expect(drive([talk("reaper", "open"), talk("reaper", "paid", bad)]).s.phase, `paid ${bad}`).not.toBe("resolved");
    }
    const poor = def.init({ ...C, purse: 10 }, 0, SEED);
    expect(drive([talk("reaper", "open"), talk("reaper", "paid", poor.price.bonus)], poor).s.phase).not.toBe("resolved");
    // a payment without the parley open is not a payment
    expect(drive([talk("reaper", "paid", S0.price.bonus)]).s.phase).not.toBe("resolved");
  });

  it("the barge lands at its hour and marches; two strike-breakers in the barley break the strike, one does not", () => {
    const land = drive(ticks(S0.barge + 1));
    expect(land.s.landed).toBe(true);
    expect(land.fx).toContainEqual({ k: "spawn", group: "late:breakers" });
    expect(land.fx).toContainEqual({ k: "order", group: "late:breakers", order: { o: "march", route: "breakers" } });
    expect(land.s.phase).toBe("tension");
    const one = drive([arrive(0)], land.s);
    expect(one.s.phase).not.toBe("resolved");
    const two = drive([arrive(0), arrive(1)], land.s);
    expect(two.s.resolution).toBe("strike_broken");
    expect(two.commits).toBe(1);
  });

  it("fighting the strike-breakers turns them: arrivals during the fight do not count, and they are ordered onto the party", () => {
    const land = drive(ticks(S0.barge + 1)).s;
    const r = drive([{ t: "hostile", at: "late:breakers" }, arrive(0), arrive(1), arrive(2)], land);
    expect(r.s.fight).toBe(true);
    expect(r.s.phase).toBe("fighting");
    expect(r.s.resolution).toBeUndefined();
    expect(r.fx).toContainEqual({ k: "order", group: "late:breakers", order: { o: "alert" } });
    // and the rain still comes
    expect(drive(ticks(S0.rainAt - S0.barge + 2), r.s).s.resolution).toBe("barley_lost");
  });

  it("the rain ends it with the Compact still out; the run then freezes but for the clock", () => {
    const r = drive(ticks(S0.rainAt + 1));
    expect(r.s.resolution).toBe("barley_lost");
    expect(r.commits).toBe(1);
    const after = drive([PROOF, talk("reaper", "open"), talk("reaper", "paid", S0.price.bonus), arrive(0), arrive(1), { t: "party_down" }, { t: "tick", dt: 2 }], r.s);
    expect(after.s.resolution).toBe("barley_lost");
    expect(after.commits).toBe(0);
    expect(after.s.t).toBeGreaterThan(r.s.t);
  });

  it("the Steward's fee: it hurries the barge, and pays only on results (bought back, or broken)", () => {
    const tipped = drive([...ticks(10), talk("steward", "open"), talk("steward", "tip")]);
    expect(tipped.s.tipped).toBe(true);
    expect(tipped.s.barge).toBeLessThanOrEqual(10 + STRIKE.hurriedS);
    expect(tipped.s.barge).toBeLessThanOrEqual(S0.barge);
    const bought = drive([talk("reaper", "open"), talk("reaper", "paid", S0.price.bonus)], tipped.s);
    expect(bought.s.resolution).toBe("bought_back");
    expect(def.outcome(bought.s)!.loot).toBe(S0.price.fee);
    const landed = drive(ticks(STRIKE.hurriedS + 2), tipped.s).s;
    expect(landed.landed).toBe(true);
    const broken = drive([arrive(0), arrive(1)], landed);
    expect(def.outcome(broken.s)).toMatchObject({ resolution: "strike_broken", loot: S0.price.fee });
    const lost = drive(ticks(S0.rainAt), tipped.s);
    expect(lost.s.resolution).toBe("barley_lost");
    expect(def.outcome(lost.s)!.loot).toBeUndefined();
    // taking his fee and then making him sign is a broken promise
    const honest = drive([PROOF, talk("steward", "open"), talk("steward", "survey"), talk("reaper", "open"), talk("reaper", "survey")], tipped.s);
    expect(honest.s.resolution).toBe("honest_measure");
    expect(honest.s.brokePromise).toBe(true);
    expect(def.outcome(honest.s)!.loot).toBeUndefined();
  });

  it("threats and violence close doors: a threatened Compact will not deal, a Steward who fled cannot be shown the bushel", () => {
    const threatened = drive([talk("reaper", "open"), talk("reaper", "hostile"), talk("reaper", "open")]);
    expect(threatened.s.refused).toBe(true);
    expect(threatened.s.parley).toBeUndefined();
    expect(said(threatened.fx)).toMatch(/nothing to say/);
    const blood = drive([{ t: "hostile", at: "compact" }]);
    expect(blood.s.refused).toBe(true);
    expect(blood.fx).toContainEqual({ k: "order", group: "compact", order: { o: "flee" } });
    const fled = drive([talk("steward", "open"), talk("steward", "hostile"), PROOF]);
    expect(fled.s.stewardGone).toBe(true);
    expect(fled.s.proof).toBe(false);
    expect(fled.fx).toContainEqual({ k: "order", group: "granary", order: { o: "flee" } });
    // the use the runner would have consumed the bushel on returns the SAME state: nothing is consumed
    expect(def.reduce(fled.s, PROOF).s).toBe(fled.s);
    const downed = drive([{ t: "actor", id: "steward", state: "down" }, { t: "actor", id: "foreperson", state: "down" }]);
    expect(downed.s.stewardGone && downed.s.refused).toBe(true);
    // having agreed and then drawing blood on the line is a broken promise
    const agreed = drive([PROOF, talk("reaper", "open"), talk("reaper", "survey"), { t: "hostile", at: "compact" }]);
    expect(agreed.s.brokePromise).toBe(true);
  });

  it("leaving commits only what happened", () => {
    expect(def.leave(S0)).toBeUndefined();
    expect(def.leave(drive([...ticks(20), { t: "near", at: "line", party: 2 }, talk("reaper", "open"), talk("reaper", "learn"), talk("reaper", "close")]).s)).toBeUndefined();
    const landed = drive(ticks(S0.barge + 1)).s;
    expect(def.leave(landed)).toBeUndefined();   // the barge landing is the world's doing, not the party's
    expect(def.leave(drive([PROOF]).s)).toBe("barley_lost");
    expect(def.leave(drive([PROOF], landed).s)).toBe("strike_broken");
    expect(def.leave(drive([{ t: "hostile", at: "late:breakers" }], landed).s)).toBe("barley_lost");
    const left = drive([talk("steward", "open"), talk("steward", "tip"), ...ticks(STRIKE.hurriedS + 2), { t: "leave" }]);
    expect(def.outcome(left.s)).toMatchObject({ resolution: "strike_broken", loot: S0.price.fee });
    expect(drive([{ t: "party_down" }]).s.resolution).toBe("abandoned");
  });

  it("complications move the clocks the way the hint says", () => {
    const by = new Map<string, StrikeState>();
    for (let seed = 1; seed < 600 && by.size < 4; seed++) {
      const s = def.init({ ...newCampaign(seed), purse: 100 }, 0, seed);
      if (!by.has(s.complication)) by.set(s.complication, s);
    }
    expect([...by.keys()].sort()).toEqual(["fog", "none", "outriders", "rain"]);
    const range = (s: StrikeState): { barge: number; rain: number } => ({ barge: s.barge, rain: s.rainAt });
    expect(range(by.get("outriders")!).barge).toBeLessThan(STRIKE.bargeMin);
    expect(range(by.get("rain")!).rain).toBeLessThan(STRIKE.rainMin);
    expect(range(by.get("fog")!).barge).toBeGreaterThan(STRIKE.bargeMin + STRIKE.fogBarge - 1);
    expect(range(by.get("fog")!).rain).toBeGreaterThan(STRIKE.rainMin + STRIKE.fogRain - 1);
    for (const s of by.values()) expect(s.barge, "the barge lands before the rain").toBeLessThan(s.rainAt - 60);
  });

  it("the view: progressive objectives, a timer to the barge then the rain, a hint that grows with what was learnt", () => {
    const v0 = def.view(S0, 0);
    expect(v0.objectives.map((o) => o.id)).toEqual(["line", "settle"]);
    expect(v0.timerLabel).toMatch(/barge/);
    const told = drive([talk("reaper", "open"), talk("reaper", "learn")]).s;
    const v1 = def.view(told, 0);
    expect(v1.objectives.map((o) => o.id)).toEqual(["line", "bushel", "steward", "compact", "settle"]);
    expect(v1.hint).toMatch(/granary terrace/);
    const landed = def.view(drive(ticks(S0.barge + 1)).s, 0);
    expect(landed.objectives.map((o) => o.id)).toContain("breakers");
    expect(landed.timerLabel).toBe("The rain");
    const done = def.view(drive([talk("reaper", "open"), talk("reaper", "paid", S0.price.bonus)]).s, 0);
    expect(done.resolution).toBe("bought_back");
    expect(done.objectives.find((o) => o.id === "home")).toBeDefined();
    expect(done.objectives.find((o) => o.id === "settle")!.done).toBe(true);
  });

  it("the people and the observe spec agree: ids unique, every watched or used npc is on the roster, under the cap, the breakers held back", () => {
    const r = def.roster(C, SEED, S0);
    const ids = r.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.length).toBeLessThanOrEqual(Math.min(14, NPC_CAP));
    for (const u of def.observe.use) if (u.npc) expect(ids).toContain(u.npc);
    for (const a of def.observe.actors) expect(ids).toContain(a.id);
    expect(r.filter((p) => p.group === "late:breakers").length).toBe(STRIKE.breakers);
    expect(r.filter((p) => p.side === "rival").every((p) => p.group === "late:breakers")).toBe(true);
    expect(def.observe.use.find((u) => u.id === "proof")).toMatchObject({ carry: "barrel", consume: true, prop: "bushel" });
    expect(def.props).toEqual([{ id: "bushel", kind: expect.any(Number), x: HIGHMARK_SITES.strike.scale.x, z: HIGHMARK_SITES.strike.scale.z }]);
    const route = def.routes!.breakers!;
    expect(route[route.length - 1]).toEqual({ x: HIGHMARK_SITES.strike.barley.x, z: HIGHMARK_SITES.strike.barley.z });
  });

  it("the two parleys: the Foreperson's bonus is a payment, the Steward's fee is a tip, and asking teaches", () => {
    const ctx = { price: S0.price.bonus, purse: 200, seed: 3, day: 2 };
    const fv = openSiteParley("reaper", ctx);
    const pay = fv.options.findIndex((o) => /bonus/.test(o.label));
    expect(answerSiteParley("reaper", ctx, fv, pay)).toMatchObject({ done: { result: "paid", paid: S0.price.bonus } });
    const ask = fv.options.findIndex((o) => /Ask/.test(o.label));
    expect(answerSiteParley("reaper", ctx, fv, ask)).toMatchObject({ emit: "learn" });
    const sctx = { price: S0.price.fee, purse: 0, seed: 3, day: 2 };
    const sv = openSiteParley("steward", sctx);
    const tip = sv.options.findIndex((o) => /fee/.test(o.label));
    expect(sv.options[tip]!.cost).toBe(0);
    expect(answerSiteParley("steward", sctx, sv, tip)).toMatchObject({ done: { result: "tip", paid: 0 } });
  });
});

describe("Highmark offers both contracts (D-042)", () => {
  const outcome = (r: string, t: ScenarioTemplateId) => ({ scenario: t, resolution: r as never, toll: 0, paid: 0, bridge: "intact" as const, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 }, brokePromise: false, seconds: 60, complication: "none" as const, region: "highmark" as const });
  it("the chair on the first visit (as every save before D-042 was offered), then the two alternate; other regions' history does not count", () => {
    let c = newCampaign(9);
    expect(pickHighmarkContract(c)).toBe("succession_dispute");
    expect(pickTemplate(c, "highmark", 4)).toBe("succession_dispute");
    c = applyOutcome(c, { ...outcome("paid", "secure_crossing"), region: "kessar" });
    expect(pickTemplate(c, "highmark", 4)).toBe("succession_dispute");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const t = pickTemplate(c, "highmark", 5 + i)!;
      seen.push(t);
      c = applyOutcome(c, outcome(t === "succession_dispute" ? "regency" : "barley_lost", t));
    }
    expect(seen).toEqual(["succession_dispute", "reapers_strike", "succession_dispute", "reapers_strike"]);
    expect(c.sites.ends.reapers_strike).toBe("barley_lost");
  });
});
