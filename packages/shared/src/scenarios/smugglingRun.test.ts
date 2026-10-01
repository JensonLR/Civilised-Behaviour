import { describe, expect, it } from "vitest";
import type { CampaignState, ScenarioFx } from "../campaignTypes.ts";
import { COMPLICATION_HINT } from "../chaos.ts";
import { RESOLVED_LINGER_S } from "../campaignTypes.ts";
import { applyOutcome, newCampaign } from "../factions.ts";
import { PropKind } from "../props.ts";
import { Rng } from "../rng.ts";
import { SALTMARKET_SPOTS, saltmarketPlan } from "../saltmarket.ts";
import type { ScenarioInput } from "../scenario.ts";
import { lingerDone } from "./common.ts";
import { SMUGGLE, smugglingRunTemplate as def, type SmugglingState } from "./smugglingRun.ts";
import type { Fx } from "./types.ts";

const cm = (seed = 7): CampaignState => newCampaign(seed);
/** A campaign whose dealt complication is "none" (the timings are then exact). */
function calm(): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 400; seed++) {
    const c = cm(seed);
    if (def.init(c, 0, seed).complication === "none") return { c, seed };
  }
  throw new Error("no calm seed");
}
const { c: C, seed: SEED } = calm();
const isCommit = (f: Fx): boolean => f === "commit" || (typeof f === "object" && f.k === "commit");
interface Run { s: SmugglingState; fx: Fx[]; commits: number }
function drive(events: readonly ScenarioInput[], s0?: SmugglingState, c: CampaignState = C, seed = SEED): Run {
  let s = s0 ?? def.init(c, 0, seed);
  const fx: Fx[] = [];
  for (const e of events) {
    const r = def.reduce(s, e);
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx, commits: fx.filter(isCommit).length };
}
const ticks = (seconds: number, dt = 1): ScenarioInput[] => Array.from({ length: Math.ceil(seconds / dt) }, () => ({ t: "tick", dt }));
const near = (at: string, party = 1): ScenarioInput => ({ t: "near", at, party });
const seen = (group: string): ScenarioInput => ({ t: "seen", group });
const count = (group: string, alive: number, routed: number, down: number, total: number): ScenarioInput => ({ t: "count", group, alive, routed, down, total });
const talk = (result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0, kind: Extract<ScenarioInput, { t: "talk" }>["kind"] = "tide_reeve"): ScenarioInput => ({ t: "talk", kind, result, paid });
const use = (target: string): ScenarioInput => ({ t: "use", target, slot: 0 });
const P = def.init(C, 0, SEED).price;
const LOAD = [near("cove", 2)];
const LAND = [use("drop"), use("drop"), use("drop")];
const has = (fx: Fx[], k: string): boolean => fx.some((f) => typeof f === "object" && f.k === k);

const SCRIPTS = {
  landed: () => [...LOAD, ...LAND],
  impounded: () => [...LOAD, seen("patrol"), ...ticks(SMUGGLE.challengeS + 1)],
  scuttled: () => [...LOAD, use("plug")],
  informed: () => [talk("open"), talk("tell")],
  abandoned: () => [...LOAD, { t: "party_down" } as ScenarioInput],
} as const;

describe("The Quiet Barge: one scripted run per ending on the pure reducer", () => {
  for (const r of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
    it(`${r}: resolves, commits exactly once, the first resolution wins, and the outcome is the Saltmarket's`, () => {
      const run = drive(SCRIPTS[r]());
      expect(run.s.resolution, r).toBe(r);
      expect(run.s.phase).toBe("resolved");
      expect(run.commits, "commit exactly once").toBe(1);
      expect(def.outcome(run.s)).toMatchObject({ scenario: "smuggling_run", resolution: r, region: "saltmarket", bridge: "intact", toll: 0 });
      // after the end: nothing changes except the clock, and nothing commits again
      const more = drive([{ t: "party_down" }, { t: "hostile", at: "patrol" }, use("plug"), use("drop"), use("lantern"), talk("open"), talk("tell"), ...ticks(RESOLVED_LINGER_S + 5)], run.s);
      expect(more.s.resolution).toBe(r);
      expect(more.commits).toBe(0);
      expect(lingerDone(more.s)).toBe(true);
    });
  }

  it("the endings are materially different: >= 3 distinct (campaign, outcome) pairs differing in >= 3 fields", () => {
    const seen = new Map<string, string>();
    for (const r of ["landed", "impounded", "scuttled", "informed"] as const) {
      const o = def.outcome(drive(SCRIPTS[r]()).s)!;
      const after = applyOutcome(C, o);
      seen.set(r, JSON.stringify({ purse: after.purse, ends: after.sites.ends, res: after.history.at(-1)!.resolution, lies: after.lies, rival: after.factions.rival, loot: o.loot ?? 0, paid: o.paid }));
    }
    expect(new Set(seen.values()).size).toBe(4);
    const outs = (["landed", "impounded", "scuttled", "informed"] as const).map((r) => def.outcome(drive(SCRIPTS[r]()).s)!);
    expect(new Set(outs.map((o) => o.loot ?? 0)).size, "loot differs").toBeGreaterThanOrEqual(3);
  });
});

describe("The Quiet Barge: the rules", () => {
  it("being seen before you have been to the cargo is nothing; after it, it is a challenge you have eight seconds to answer", () => {
    expect(drive([seen("patrol"), ...ticks(30)]).s.resolution).toBeUndefined();
    const r = drive([...LOAD, seen("patrol")]);
    expect(r.s.challenge).toBe(SMUGGLE.challengeS);
    expect(r.s.phase).toBe("standoff");
    expect(drive([...LOAD, seen("patrol"), ...ticks(SMUGGLE.challengeS - 2)]).s.resolution).toBeUndefined();
    // a second sighting while a challenge runs changes nothing
    expect(drive([...LOAD, seen("patrol"), ...ticks(3), seen("customs")]).s.challenge).toBeCloseTo(SMUGGLE.challengeS - 3, 5);
  });

  it("a declaration (free) or a courtesy (paid) is a stamped passage: the patrol waves you through, for four minutes, not for five", () => {
    for (const how of [[talk("open"), talk("survey")], [talk("open"), talk("paid", P.courtesy)]]) {
      const r = drive([...LOAD, ...how, seen("patrol")]);
      expect(r.s.challenge, "waved through").toBe(0);
      expect(r.s.permit).toBeGreaterThan(0);
      expect(drive([...LOAD, ...how, ...ticks(SMUGGLE.permitS + 2), seen("patrol")]).s.challenge, "the passage has lapsed").toBe(SMUGGLE.challengeS);
    }
    // a declaration puts the duty (and the profit) with the Houses; a courtesy does not
    const declared = drive([...LOAD, talk("open"), talk("survey"), ...LAND]);
    const paid = drive([...LOAD, talk("open"), talk("paid", P.courtesy), ...LAND]);
    expect(declared.s.resolution).toBe("landed");
    expect(paid.s.resolution).toBe("landed");
    expect(def.outcome(declared.s)!.loot ?? 0).toBe(0);
    expect(def.outcome(paid.s)!.loot).toBeGreaterThan(0);
    expect(def.outcome(paid.s)!.paid).toBe(P.courtesy);
  });

  it("the courtesy is priced and checked: a forged amount, an amount the purse cannot cover, or no open parley changes nothing", () => {
    for (const paid of [0, 1, 1e9, -5, NaN, P.courtesy * 2]) {
      const r = drive([talk("open"), talk("paid", paid)]);
      expect(r.s.permit, `paid ${paid}`).toBe(0);
      expect(r.s.paid).toBe(0);
    }
    const poor = { ...C, purse: 5 };
    expect(drive([talk("open"), talk("paid", P.courtesy)], undefined, poor).s.permit).toBe(0);
    expect(drive([talk("paid", P.courtesy)]).s.permit, "no parley open").toBe(0);
    expect(drive([talk("open"), talk("close"), talk("paid", P.courtesy)]).s.permit).toBe(0);
  });

  it("the lantern draws the patrol off (their sightings are ignored for lureS) and is lit once; the Customs House's own men are not fooled", () => {
    const lit = drive([...LOAD, use("lantern")]);
    expect(lit.s.lit).toBe(true);
    expect(lit.fx.some((f) => typeof f === "object" && f.k === "order" && f.group === "patrol" && f.order.o === "march" && f.order.route === "lure")).toBe(true);
    expect(drive([...LOAD, use("lantern"), seen("patrol")]).s.challenge, "the patrol is looking at a lantern").toBe(0);
    expect(drive([...LOAD, use("lantern"), seen("customs")]).s.challenge, "the House's men are indoors in spirit but not blind").toBe(SMUGGLE.challengeS);
    const after = drive([...LOAD, use("lantern"), ...ticks(SMUGGLE.lureS + 2), seen("patrol")]);
    expect(after.s.challenge, "the lure has ended").toBe(SMUGGLE.challengeS);
    // lit twice: the second press changes nothing but a line
    const twice = drive([...LOAD, use("lantern"), use("lantern")]);
    expect(twice.s.lureUntil).toBe(lit.s.lureUntil);
  });

  it("the patrol walks the boardwalk in legs of legS seconds, alternating routes, and stops when it is fighting", () => {
    const r = drive(ticks(SMUGGLE.legS * 2 + 2));
    const marches = r.fx.filter((f): f is Extract<ScenarioFx, { k: "order" }> => typeof f === "object" && f.k === "order" && f.group === "patrol" && f.order.o === "march");
    expect(marches.length).toBe(3);
    expect(marches.map((m) => (m.order as { route: string }).route)).toEqual(["line", "back", "line"]);
    const fight = drive([{ t: "hostile", at: "patrol" }, ...ticks(SMUGGLE.legS * 2)]);
    expect(fight.fx.some((f) => typeof f === "object" && f.k === "order" && f.order.o === "march")).toBe(false);
    for (const route of Object.keys(def.routes!)) expect(def.routes![route]!.length).toBeGreaterThanOrEqual(2);
  });

  it("three crates land the cargo; the fourth is a bonus nobody can count; a hot landing gives hotS seconds to break the patrol", () => {
    expect(drive([...LOAD, use("drop"), use("drop")]).s.resolution).toBeUndefined();
    expect(drive([...LOAD, ...LAND]).s.resolution).toBe("landed");
    // a shot first: the Customs House is awake. Three crates in, and the patrol is a minute behind...
    const hot = drive([...LOAD, { t: "noise", level: 90 }, ...LAND]);
    expect(hot.s.resolution).toBeUndefined();
    expect(hot.s.hot).toBe(SMUGGLE.hotS);
    expect(drive([], hot.s).s.phase).toBe("fighting");
    // ...and it catches up if nobody breaks it
    expect(drive(ticks(SMUGGLE.hotS + 1), hot.s).s.resolution).toBe("impounded");
    // ...unless they do: 3 of the 4 men down or routed (0.6 of the guard)
    const won = drive([count("customs", 0, 0, 2, 2), count("patrol", 1, 1, 0, 2)], hot.s);
    expect(won.s.resolution).toBe("landed");
    // broken first, landed after: no hot landing
    const broke = drive([...LOAD, { t: "hostile", at: "customs" }, count("customs", 0, 1, 1, 2), count("patrol", 0, 1, 1, 2), ...LAND]);
    expect(broke.s.resolution).toBe("landed");
  });

  it("a shot is noise: the rain muffles it; a quiet noise does nothing; the first shot at the Customs House is a broken promise only if the party had made one", () => {
    expect(drive([{ t: "noise", level: SMUGGLE.alarmNoise - 1 }]).s.alarm).toBe(false);
    expect(drive([{ t: "noise", level: SMUGGLE.alarmNoise }]).s.alarm).toBe(true);
    const wet = drive([{ t: "weather", rain: 0.9 }, { t: "noise", level: SMUGGLE.alarmNoise }]);
    expect(wet.s.alarm).toBe(false);
    expect(drive([{ t: "weather", rain: 0.9 }, { t: "noise", level: SMUGGLE.alarmNoise + SMUGGLE.rainNoiseBonus }]).s.alarm).toBe(true);
    const bare = drive([{ t: "hostile", at: "customs" }, count("customs", 0, 0, 2, 2), count("patrol", 0, 0, 2, 2), ...LOAD, ...LAND]);
    expect(def.outcome(bare.s)!.brokePromise).toBe(false);
    const promised = drive([talk("open"), talk("survey"), { t: "hostile", at: "patrol" }, count("customs", 0, 0, 2, 2), count("patrol", 0, 0, 2, 2), ...LOAD, ...LAND]);
    expect(def.outcome(promised.s)!.brokePromise).toBe(true);
  });

  it("the Tide-Reeve down wakes the Customs House; a hostile parley does too", () => {
    expect(drive([{ t: "actor", id: "reeve", state: "down" }]).s.alarm).toBe(true);
    expect(drive([talk("open"), talk("hostile")]).s.alarm).toBe(true);
    expect(drive([{ t: "actor", id: "bargeman-0", state: "down" }]).s.alarm).toBe(false);
  });

  it("informing: the Houses pay the finder's fee; the barge is theirs; nothing else commits", () => {
    const r = drive([talk("open"), talk("learn"), talk("tell")]);
    expect(r.s.resolution).toBe("informed");
    const o = def.outcome(r.s)!;
    expect(o.loot).toBe(P.tip);
    expect(o.paid).toBe(0);
    expect(has(r.fx, "order")).toBe(true);
  });

  it("slack water ends the run: the Constabulary finds the barge; a Ward patrol (the complication) is a late man at 90 s", () => {
    expect(drive(ticks(SMUGGLE.slackS - 5, 5)).s.resolution).toBeUndefined();
    expect(drive(ticks(SMUGGLE.slackS + 5, 5)).s.resolution).toBe("impounded");
    // the complication that adds a man
    let cw: { c: CampaignState; seed: number } | undefined;
    for (let seed = 1; seed < 600 && !cw; seed++) { const c = cm(seed); if (def.init(c, 0, seed).complication === "ward_patrol") cw = { c, seed }; }
    expect(cw, "a ward_patrol seed exists").toBeDefined();
    const r = drive(ticks(SMUGGLE.extraAt + 2), undefined, cw!.c, cw!.seed);
    expect(has(r.fx, "spawn")).toBe(true);
    expect(r.s.guards.extra.total).toBe(1);
    expect(def.view(r.s, 1000).complication).toBe("ward_patrol");
  });

  it("scuttling needs the cargo to have been seen to; an unloaded party has no plug to pull", () => {
    expect(drive([use("plug")]).s.resolution).toBeUndefined();
    expect(drive([...LOAD, use("plug")]).s.resolution).toBe("scuttled");
  });

  it("the crates are four, at the cove, and the plan's drop-house door, plug and lantern are where the template looks", () => {
    expect(def.props!.length).toBe(SMUGGLE.crates);
    expect(def.props!.every((p) => p.kind === PropKind.CRATE)).toBe(true);
    expect(new Set(def.props!.map((p) => p.id)).size).toBe(SMUGGLE.crates);
    const u = Object.fromEntries(def.observe.use.map((x) => [x.id, x]));
    expect(u.drop!.at).toEqual(SALTMARKET_SPOTS.dropDoor);
    expect(u.drop!.carry).toBe("crate");
    expect(u.drop!.consume).toBe(true);
    expect(u.plug!.carry).toBe("none");
    expect(u.lantern!.carry).toBe("none");
    expect(saltmarketPlan().boats.some((b) => b.kind === "barge")).toBe(true);
  });
});

describe("The Quiet Barge: leave, view, roster, fuzz", () => {
  it("leave: nothing happened is dismissed; a run in progress is abandoned; a crate carried or a challenge open is impounded; the end is the end", () => {
    expect(def.leave(def.init(C, 0, SEED))).toBeUndefined();
    expect(def.leave(drive([...LOAD]).s)).toBe("abandoned");
    expect(def.leave(drive([{ t: "tally", add: { wounded: 1 } }]).s)).toBe("abandoned");
    expect(def.leave(drive([talk("open"), talk("survey")]).s)).toBe("abandoned");
    expect(def.leave(drive([...LOAD, use("drop")]).s)).toBe("impounded");
    expect(def.leave(drive([...LOAD, seen("patrol")]).s)).toBe("impounded");
    expect(def.leave(drive(SCRIPTS.scuttled()).s)).toBe("scuttled");
    const r = drive([...LOAD, { t: "leave" }]);
    expect(r.s.resolution).toBe("abandoned");
    expect(r.commits).toBe(1);
    expect(drive([{ t: "leave" }]).s.resolution).toBeUndefined();
  });

  it("every view has unique objective ids, names the complication, and carries a timer that moves toward slack water", () => {
    for (let seed = 1; seed < 200; seed++) {
      const c = cm(seed);
      const s = def.init(c, 0, seed);
      const v = def.view(s, 5000);
      expect(v.template).toBe("smuggling_run");
      expect(new Set(v.objectives.map((o) => o.id)).size).toBe(v.objectives.length);
      expect(v.objectives.length).toBeGreaterThan(3);
      expect(v.hint.length).toBeGreaterThan(30);
      if (s.complication !== "none") expect(v.complication).toBe(s.complication);
      else expect(v.complication).toBeUndefined();
    }
    const v0 = def.view(def.init(C, 0, SEED), 10_000);
    expect(v0.timerLabel).toBe("Slack water ends");
    expect(v0.endsAtWorldMs).toBe(10_000 + SMUGGLE.slackS * 1000);
    expect(def.view(drive(ticks(100)).s, 10_000).endsAtWorldMs).toBe(10_000 + (SMUGGLE.slackS - 100) * 1000);
    expect(def.view(drive(SCRIPTS.landed()).s, 0).endsAtWorldMs).toBe(0);
    expect(def.view(drive(SCRIPTS.landed()).s, 0).objectives.some((o) => o.id === "home")).toBe(true);
  });

  it("every complication the template can be dealt is named in the hint", () => {
    for (const comp of ["fog", "rain", "ward_patrol"] as const) {
      let found: { c: CampaignState; seed: number } | undefined;
      for (let seed = 1; seed < 800 && !found; seed++) { const c = cm(seed); if (def.init(c, 0, seed).complication === comp) found = { c, seed }; }
      expect(found, `${comp} is dealt`).toBeDefined();
      const hint = def.view(def.init(found!.c, 0, found!.seed), 0).hint;
      expect(hint, comp).toContain({ fog: "Fog on the delta", rain: "Rain on the boards", ward_patrol: "A Ward patrolman" }[comp]);
      expect(COMPLICATION_HINT[comp].length).toBeGreaterThan(20);
    }
  });

  it("the roster is authored, unique, <= 14 rows with every observed id in it; init and roster are deterministic", () => {
    const a = def.init(C, 0, 5), b = def.init(structuredClone(C), 0, 5);
    expect(a).toEqual(b);
    const ro = def.roster(C, 5, a);
    expect(def.roster(C, 5, b)).toEqual(ro);
    const ids = ro.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(14);
    for (const p of ro) { expect(p.name.length).toBeGreaterThan(3); expect(p.bravery).toBeLessThanOrEqual(100); }
    for (const u of def.observe.use) if (u.npc !== undefined) expect(ids, `use ${u.id}`).toContain(u.npc);
    for (const a2 of def.observe.actors) expect(ids, `actor ${a2.id}`).toContain(a2.id);
    const groups = new Set(ro.map((p) => p.group));
    for (const g of def.observe.hostileGroups) expect(groups.has(g), `hostile group ${g}`).toBe(true);
    for (const s of def.observe.seen) expect(groups.has(s.group), `seen group ${s.group}`).toBe(true);
    for (const c2 of def.observe.count) expect(groups.has(c2.group), `count group ${c2.group}`).toBe(true);
    // every group an order names exists
    const named = new Set<string>();
    for (const e of [[{ t: "hostile", at: "customs" }], ticks(100), [...LOAD, use("lantern")], SCRIPTS.landed()] as ScenarioInput[][]) for (const f of drive(e).fx) if (typeof f === "object" && (f.k === "order" || f.k === "spawn")) named.add(f.group);
    for (const g of named) expect(g === "late:extra" || groups.has(g) || g === "reeve" || g === "bargemen", g).toBe(true);
    expect(ro.some((p) => p.group === "late:extra")).toBe(true);
    // the cast of this template and its sibling together fit the server's cap
    expect(ro.length).toBeLessThanOrEqual(24);
  });

  it("a 5000-sequence hostile-event fuzz never throws and never commits twice", () => {
    const rng = new Rng(0x5a17);
    const targets = ["drop", "plug", "lantern", "reeve", "", "__proto__", "cage", "wagon"];
    const groups = ["customs", "patrol", "late:extra", "reeve", "bargemen", "", "deserters"];
    const kinds = ["tide_reeve", "auctioneer", "house_head", "ransom", "foreman"] as const;
    const results = ["open", "close", "hostile", "paid", "survey", "learn", "tell", "envelope", "tip", "ransom"] as const;
    let ends = 0;
    for (let i = 0; i < 5000; i++) {
      const c = cm(1 + (i % 60));
      let s = def.init(c, 0, 1 + (i % 60));
      let commits = 0;
      for (let k = 0; k < 40; k++) {
        const roll = rng.int(0, 11);
        let e: ScenarioInput;
        if (roll < 2) e = { t: "use", target: targets[rng.int(0, targets.length - 1)]!, slot: rng.int(-3, 9) };
        else if (roll < 4) e = { t: "talk", kind: kinds[rng.int(0, kinds.length - 1)]!, result: results[rng.int(0, results.length - 1)]!, paid: rng.chance(0.2) ? NaN : rng.int(-5, 500) };
        else if (roll < 5) e = { t: "near", at: ["cove", "drop", "customs", "x"][rng.int(0, 3)]!, party: rng.int(-2, 1e9) };
        else if (roll < 6) e = { t: "seen", group: groups[rng.int(0, groups.length - 1)]! };
        else if (roll < 7) e = { t: "count", group: groups[rng.int(0, groups.length - 1)]!, alive: rng.int(-3, 9), routed: rng.int(-3, 9), down: rng.chance(0.1) ? NaN : rng.int(-3, 9), total: rng.int(-3, 1e9) };
        else if (roll < 8) e = { t: "noise", level: rng.chance(0.1) ? NaN : rng.range(-20, 160) };
        else if (roll < 9) e = { t: "hostile", at: groups[rng.int(0, groups.length - 1)]! };
        else if (roll < 10) e = { t: "weather", rain: rng.range(-1, 2) };
        else if (roll < 11) e = { t: "actor", id: ["reeve", "bargeman-0", "x"][rng.int(0, 2)]!, state: (["down", "free", "arrived"] as const)[rng.int(0, 2)]! };
        else e = { t: "tick", dt: rng.chance(0.1) ? NaN : rng.range(-2, 12) };
        const r = def.reduce(s, e);
        s = r.s;
        commits += r.fx.filter(isCommit).length;
        expect(Number.isFinite(s.t)).toBe(true);
        if (s.phase === "resolved") break;
      }
      expect(commits).toBeLessThanOrEqual(1);
      if (s.resolution !== undefined) {
        ends++;
        expect(def.outcome(s)?.resolution).toBe(s.resolution);
      }
    }
    expect(ends).toBeGreaterThan(50);
  });

  it("the client cannot reach an ending before the world says so: forged use and talk results, from nowhere, resolve nothing in 60 s", () => {
    const results = ["ransom", "survey", "learn", "tell", "envelope", "tip", "paid", "bargained", "bribed", "hostile"] as const;
    for (const result of results) for (const paid of [0, 1, 40, 1e9, NaN, -4]) {
      const r = def.reduce(def.init(cm(3), 0, 3), { t: "talk", kind: "tide_reeve", result, paid });
      expect(r.s.resolution, `${result} ${paid}`).toBeUndefined();
      expect(r.fx.some(isCommit)).toBe(false);
    }
    for (const t of ["drop", "plug", "lantern", "reeve", "", "__proto__"]) expect(def.reduce(def.init(cm(3), 0, 3), { t: "use", target: t, slot: 0 }).s.resolution, t).toBeUndefined();
    expect(drive(ticks(60)).s.resolution).toBeUndefined();
  });
});
