import { describe, expect, it } from "vitest";
import type { CampaignState } from "../campaignTypes.ts";
import { NPC_CAP } from "../campaignTypes.ts";
import { newCampaign } from "../factions.ts";
import type { ScenarioInput } from "../scenario.ts";
import { VESPER_SITES, VESPER_STOCK } from "../vesper.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import type { Fx } from "./types.ts";
import { ENGINE, windingEngineTemplate as def, type EngineState } from "./windingEngine.ts";

function calm(): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 400; seed++) {
    const c = { ...newCampaign(seed), purse: 200 };
    if (def.init(c, 0, seed).complication === "none") return { c, seed };
  }
  throw new Error("no calm seed");
}
const { c: C, seed: SEED } = calm();
const isCommit = (f: Fx): boolean => typeof f === "object" && f.k === "commit";
function drive(events: readonly ScenarioInput[], s0?: EngineState): { s: EngineState; fx: Fx[]; commits: number } {
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
const talk = (result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind: "engineer", result, paid });
const use = (target: string): ScenarioInput => ({ t: "use", target, slot: 0 });
const yard = (n: number): ScenarioInput => ({ t: "near", at: "yard", party: n });
const seen = (group = "guards"): ScenarioInput => ({ t: "seen", group });
const S0 = def.init(C, 0, SEED);
const said = (fx: Fx[]): string => fx.map((f) => (typeof f === "object" && f.k === "say" ? f.text : "")).join(" | ");
const alertOf = (fx: Fx[], group: string): boolean => fx.some((f) => typeof f === "object" && f.k === "order" && f.group === group && f.order.o === "alert");

describe("the Winding Engine (D-044): the reducer", () => {
  it("fouled: a crate in the feed while nobody has raised the alarm ends it quietly, once", () => {
    const r = drive([yard(1), use("feed")]);
    expect(r.s.resolution).toBe("engine_fouled");
    expect(r.commits).toBe(1);
    expect(def.outcome(r.s)).toMatchObject({ scenario: "winding_engine", region: "vesper", resolution: "engine_fouled", paid: 0 });
    // a challenge does not stop a cheeky crate
    expect(drive([yard(1), seen(), use("feed")]).s.resolution).toBe("engine_fouled");
  });

  it("a challenge: leaving the terrace ends it, staying raises the whole terrace; a sighting off the terrace lapses harmlessly", () => {
    const challenged = drive([yard(1), seen("beat")]);
    expect(challenged.s.challengeUntil).toBeGreaterThan(0);
    expect(challenged.s.phase).toBe("standoff");
    expect(def.view(challenged.s, 0).timerLabel).toBe("The guard's whistle");
    const left = drive([yard(0), ...ticks(ENGINE.challengeS + 1)], challenged.s);
    expect(left.s.alarm).toBe(false);
    expect(left.s.challengeUntil).toBe(0);
    expect(said(left.fx)).toMatch(/stay off/);
    const stayed = drive(ticks(ENGINE.challengeS + 1), challenged.s);
    expect(stayed.s.alarm).toBe(true);
    for (const g of ["guards", "beat", "late:extra"]) expect(alertOf(stayed.fx, g), g).toBe(true);
    // seen from afar, never on the terrace: the challenge lapses and nothing happens
    const far = drive([seen(), ...ticks(ENGINE.challengeS + 1)]);
    expect(far.s.alarm).toBe(false);
    expect(far.s.challengeUntil).toBe(0);
  });

  it("with the alarm up the feed is refused (nothing consumed) until every guard is down or routed", () => {
    const alarmed = drive([yard(1), { t: "hostile", at: "guards" }]).s;
    expect(alarmed.alarm).toBe(true);
    const refused = def.reduce(alarmed, use("feed"));
    expect(refused.s).toBe(alarmed);
    expect(said(refused.fx)).toMatch(/shovel/);
    const down = drive([{ t: "count", group: "guards", alive: 0, routed: 1, down: 1, total: 2 }, { t: "count", group: "beat", alive: 0, routed: 0, down: 1, total: 1 }], alarmed);
    expect(said(down.fx)).toMatch(/minding itself/);
    expect(drive([use("feed")], down.s).s.resolution).toBe("engine_fouled");
  });

  it("blown: the keg lit at the boiler clears the terrace, goes off at the fuse and settles into the ending; it beats the clock", () => {
    const lit = drive([yard(1), use("keg")]);
    expect(lit.s.keg).toBe("set");
    expect(lit.s.phase).toBe("rigging");
    expect(lit.fx).toContainEqual({ k: "order", group: "guards", order: { o: "flee" } });
    const bang = drive(ticks(ENGINE.fuseS + 0.5, 0.5), lit.s);
    expect(bang.fx).toContainEqual({ k: "explode", at: "boiler" });
    const done = drive(ticks(ENGINE.settleS + 1), bang.s);
    expect(done.s.resolution).toBe("engine_blown");
    // lit a breath before the cut: the blast still wins
    const late = drive([...ticks(S0.cutAt - 2), use("keg"), ...ticks(ENGINE.fuseS + ENGINE.settleS + 2)]);
    expect(late.s.resolution).toBe("engine_blown");
    expect(late.commits).toBe(1);
  });

  it("bought: the engineer's inspection, paid from the purse at about his price; a short or forged payment buys nothing", () => {
    const r = drive([talk("open"), talk("paid", S0.price)]);
    expect(r.s.resolution).toBe("engine_bought");
    expect(def.outcome(r.s)!.paid).toBe(S0.price);
    for (const bad of [0, S0.price * 3, NaN, -S0.price]) expect(drive([talk("open"), talk("paid", bad)]).s.phase, `paid ${bad}`).not.toBe("resolved");
    const poor = def.init({ ...C, purse: 5 }, 0, SEED);
    expect(drive([talk("open"), talk("paid", poor.price)], poor).s.phase).not.toBe("resolved");
    expect(drive([talk("paid", S0.price)]).s.phase, "no parley, no deal").not.toBe("resolved");
    // threatened, he shouts for the guards; alarmed, he will not talk
    const shouted = drive([talk("open"), talk("hostile")]);
    expect(shouted.s.alarm).toBe(true);
    expect(drive([talk("open")], shouted.s).fx.some((f) => typeof f === "object" && f.k === "parley")).toBe(false);
  });

  it("struck: the cut breaks through on its clock; asking teaches the weakness; the beat turns while all is quiet", () => {
    const r = drive(ticks(S0.cutAt + 1));
    expect(r.s.resolution).toBe("vein_struck");
    expect(r.commits).toBe(1);
    const beats = r.fx.filter((f) => typeof f === "object" && f.k === "order" && f.group === "beat" && f.order.o === "march").length;
    expect(beats).toBeGreaterThanOrEqual(Math.floor(S0.cutAt / ENGINE.beatS) - 1);
    const asked = drive([talk("open"), talk("learn"), talk("close")]);
    expect(asked.s.asked).toBe(true);
    expect(def.view(asked.s, 0).hint).toMatch(/no stomach for grit/);
    expect(def.view(asked.s, 0).objectives.map((o) => o.id)).toEqual(["yard", "stop", "feed", "keg"]);
  });

  it("leaving commits only what happened; the party down is abandoned; the run freezes once resolved", () => {
    expect(def.leave(S0)).toBeUndefined();
    expect(def.leave(drive([yard(1), talk("open"), talk("learn"), talk("close")]).s)).toBeUndefined();
    expect(def.leave(drive([yard(1), { t: "hostile", at: "beat" }]).s)).toBe("vein_struck");
    expect(def.leave(drive([use("keg")]).s)).toBe("engine_blown");
    expect(drive([{ t: "party_down" }]).s.resolution).toBe("abandoned");
    const done = drive([use("feed")]).s;
    const after = drive([use("keg"), talk("open"), ...ticks(S0.cutAt + 5), { t: "party_down" }], done);
    expect(after.s.resolution).toBe("engine_fouled");
    expect(after.commits).toBe(0);
  });

  it("complications: fog slows the cut, reinforcements send a fourth guard who is alerted if the terrace already is", () => {
    const by = new Map<string, { s: EngineState; c: CampaignState; seed: number }>();
    for (let seed = 1; seed < 800 && by.size < 4; seed++) {
      const c = { ...newCampaign(seed), purse: 100 };
      const s = def.init(c, 0, seed);
      if (!by.has(s.complication)) by.set(s.complication, { s, c, seed });
    }
    expect([...by.keys()].sort()).toEqual(["fog", "none", "rain", "reinforcements"]);
    expect(by.get("fog")!.s.cutAt).toBeGreaterThanOrEqual(ENGINE.cutMin + ENGINE.fogCut);
    const R = by.get("reinforcements")!;
    expect(def.roster(R.c, R.seed, R.s).some((p) => p.group === "late:extra")).toBe(true);
    expect(def.roster(C, SEED, S0).some((p) => p.group === "late:extra")).toBe(false);
    const alarmed = drive([{ t: "hostile", at: "guards" }, ...ticks(ENGINE.extraAtS + 1)], R.s);
    expect(alarmed.fx).toContainEqual({ k: "spawn", group: "late:extra" });
    expect(alertOf(alarmed.fx.slice(alarmed.fx.findIndex((f) => typeof f === "object" && f.k === "spawn")), "late:extra")).toBe(true);
  });

  it("the people, the props and the observe spec agree", () => {
    const r = def.roster(C, SEED, S0);
    const ids = r.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.length).toBeLessThanOrEqual(Math.min(14, NPC_CAP));
    for (const u of def.observe.use) if (u.npc) expect(ids).toContain(u.npc);
    for (const a of def.observe.actors) expect(ids).toContain(a.id);
    expect(def.observe.use.find((u) => u.id === "feed")).toMatchObject({ carry: "crate", consume: true, at: VESPER_SITES.engine.boiler });
    expect(def.observe.use.find((u) => u.id === "keg")).toMatchObject({ carry: "barrel", consume: true });
    expect(def.props!.filter((p) => p.id.startsWith("grit")).length).toBe(2);
    expect(def.props!.find((p) => p.id === "keg")).toMatchObject({ x: VESPER_STOCK.keg.x, z: VESPER_STOCK.keg.z });
    expect(def.sites!.boiler).toEqual(VESPER_SITES.engine.boiler);
  });

  it("the engineer's parley: the inspection is a payment, asking teaches, and a way out is always offered", () => {
    const ctx = { price: S0.price, purse: 200, seed: 3, day: 2 };
    const v = openSiteParley("engineer", ctx);
    expect(answerSiteParley("engineer", ctx, v, v.options.findIndex((o) => /inspection/.test(o.label)))).toMatchObject({ done: { result: "paid", paid: S0.price } });
    expect(answerSiteParley("engineer", ctx, v, v.options.findIndex((o) => /cannot stand/.test(o.label)))).toMatchObject({ emit: "learn" });
    expect(v.options.some((o) => o.id === "walk_away")).toBe(true);
  });
});
