import { describe, expect, it } from "vitest";
import { liveTemplates } from "../regionStatus.ts";
import { isNewTemplate, type NewEnding } from "../regionEndings.ts";
import type { CampaignState, ResolutionId, ScenarioFx, ScenarioTemplateId } from "../campaignTypes.ts";
import { BORDER_ESCALATE_S, CONVOY_DEPART_S, HOSTAGE_DEADLINE_S, RESOLVED_LINGER_S } from "../campaignTypes.ts";
import { BORDER } from "./border.ts";
import { applyOutcome, newCampaign } from "../factions.ts";
import { generatePaper } from "../newspaper.ts";
import { Rng } from "../rng.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { HIGHMARK_RESOLUTIONS, HIGHMARK_STATUS } from "../highmark.ts";
import { REGION_TEMPLATES, TEMPLATES, TEMPLATE_IDS } from "./registry.ts";
import type { ScenarioInput } from "../scenario.ts";
import type { AnyTemplate, BaseState, Fx } from "./types.ts";
import { lingerDone } from "./common.ts";
import { HOSTAGE, hostageTemplate } from "./hostage.ts";
import { stationsFor } from "../regions.ts";
import { objectiveMark } from "../compassMarks.ts";
import { KESSAR_SITES } from "../campaignTypes.ts";

const cm = (seed = 7, patch?: (c: CampaignState) => void): CampaignState => {
  const c = newCampaign(seed);
  patch?.(c);
  return c;
};
/** A campaign whose dealt complication is "none" for the template, so timings are exact. */
const calm = (id: ScenarioTemplateId): CampaignState => {
  for (let seed = 1; seed < 400; seed++) {
    const c = cm(seed);
    const s = TEMPLATES[id].init(c, 40, seed);
    if (complication(s) === "none") return c;
  }
  throw new Error("no calm seed");
};
const complication = (s: BaseState): string => (s as unknown as { complication?: string; core?: { complication: string } }).complication ?? (s as unknown as { core: { complication: string } }).core.complication;
const isCommit = (f: Fx): boolean => f === "commit" || (typeof f === "object" && f.k === "commit");

interface Run { s: BaseState; fx: Fx[]; commits: number }
function drive(def: AnyTemplate, c: CampaignState, events: readonly ScenarioInput[], s0?: BaseState): Run {
  let s = s0 ?? def.init(c, 40, 7);
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
const count = (group: string, alive: number, routed: number, down: number, total: number): ScenarioInput => ({ t: "count", group, alive, routed, down, total });
const talk = (kind: Extract<ScenarioInput, { t: "talk" }>["kind"], result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind, result, paid });

const T = TEMPLATES;
// D-036: these scripts are KESSAR's twenty endings. Highmark's five (HIGHMARK_RESOLUTIONS) are scripted by package G in succession.test.ts; the sixteen of D-037 (NewEnding) by packages C3 and D4.
const SCRIPTS: Record<Exclude<ResolutionId, (typeof HIGHMARK_RESOLUTIONS)[number] | NewEnding>, (c: CampaignState) => { id: ScenarioTemplateId; events: ScenarioInput[] } | undefined> = {
  paid: () => ({ id: "secure_crossing", events: [{ t: "arrive", party: 2 }, { t: "parley_open" }, { t: "deal", resolution: "paid", toll: 40, paid: 40 }] }),
  bargained: () => ({ id: "secure_crossing", events: [{ t: "arrive", party: 2 }, { t: "parley_open" }, { t: "deal", resolution: "bargained", toll: 30, paid: 30 }] }),
  bribed: () => ({ id: "secure_crossing", events: [{ t: "arrive", party: 2 }, { t: "parley_open" }, { t: "deal", resolution: "bribed", toll: 20, paid: 20 }] }),
  forced: () => ({ id: "secure_crossing", events: [{ t: "arrive", party: 2 }, { t: "hostile" }, count("ward", 1, 2, 5, 8)] }),
  sabotaged: () => ({ id: "secure_crossing", events: [near("bar"), { t: "use", target: "pier", slot: 0 }, ...ticks(12)] }),
  rival_secured: () => ({ id: "secure_crossing", events: ticks(520) }),
  abandoned: () => ({ id: "secure_crossing", events: [{ t: "arrive", party: 2 }, { t: "party_down" }] }),
  ransomed: (c) => ({ id: "hostage_rescue", events: [near("camp", 2), near("cage"), talk("ransom", "open"), talk("ransom", "ransom", T.hostage_rescue.init(c, 40, 7) && (T.hostage_rescue.init(c, 40, 7) as unknown as { ransom: number }).ransom)] }),
  slipped_away: () => ({ id: "hostage_rescue", events: [near("camp"), near("cage"), { t: "use", target: "cage", slot: 0 }, { t: "actor", id: "hostage", state: "arrived" }] }),
  rescued: () => ({ id: "hostage_rescue", events: [near("camp"), { t: "seen", group: "lookout" }, count("deserters", 1, 1, 2, 4), near("cage"), { t: "use", target: "cage", slot: 0 }, { t: "actor", id: "hostage", state: "arrived" }] }),
  hostage_lost: () => ({ id: "hostage_rescue", events: ticks(HOSTAGE_DEADLINE_S + 2, 2) }),
  seized: () => ({ id: "convoy_ambush", events: [...ticks(CONVOY_DEPART_S + 1), { t: "hostile", at: "guards" }, count("guards", 0, 1, 1, 2), { t: "use", target: "wagon", slot: 0 }, { t: "prop", what: "seized", at: "wagon", n: 60 }] }),
  tipped_off: () => ({ id: "convoy_ambush", events: [talk("ford_post", "open"), talk("ford_post", "tip"), ...ticks(CONVOY_DEPART_S + 1), count("guards", 0, 0, 2, 2)] }),
  burned: () => ({ id: "convoy_ambush", events: [...ticks(CONVOY_DEPART_S + 1), { t: "prop", what: "destroyed", at: "barrel", n: 3 }] }),
  passed: () => ({ id: "convoy_ambush", events: [...ticks(CONVOY_DEPART_S + 1), { t: "actor", id: "wagon", state: "arrived" }] }),
  mediated: () => ({ id: "border_incident", events: [near("marker"), talk("ward_post", "open"), talk("ward_post", "survey"), talk("surveyor", "open"), talk("surveyor", "survey"), ...ticks(BORDER.witnessS + 1)] }),
  sided_ward: () => ({ id: "border_incident", events: [near("ward"), talk("surveyor", "open"), talk("surveyor", "learn"), talk("surveyor", "close"), talk("ward_post", "open"), talk("ward_post", "tell")] }),
  sided_syndicate: () => ({ id: "border_incident", events: [near("rival"), talk("surveyor", "open"), talk("surveyor", "learn"), talk("surveyor", "envelope"), near("marker"), { t: "use", target: "marker", slot: 1 }] }),
  provoked: () => ({ id: "border_incident", events: [near("ward"), { t: "tally", add: { wounded: 1 } }, { t: "hostile", at: "ward" }] }),
  escalated: () => ({ id: "border_incident", events: [...ticks(BORDER_ESCALATE_S + 2), count("rival", 0, 0, 3, 3)] }),
};

describe("templates: one scripted run per resolution on the pure reducers", () => {
  for (const r of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
    it(`${r}: resolves, commits exactly once, and the first resolution wins`, () => {
      const pre = SCRIPTS[r]!(cm(7))!;
      const def = T[pre.id];
      const c = pre.id === "secure_crossing" && r === "rival_secured" ? calm(pre.id) : cm(7);
      const run = drive(def, c, pre.events);
      expect(run.s.resolution, r).toBe(r);
      expect(run.s.phase).toBe("resolved");
      expect(run.commits, "commit exactly once").toBe(1);
      expect(def.outcome(run.s)).toMatchObject({ scenario: pre.id, resolution: r });
      // after the end: nothing changes except the clock, and nothing commits again
      const more = drive(def, c, [{ t: "party_down" }, { t: "hostile", at: "ward" }, { t: "use", target: "cage", slot: 0 }, { t: "actor", id: "wagon", state: "arrived" }, { t: "talk", kind: "ransom", result: "open", paid: 0 }, ...ticks(5)], run.s);
      expect(more.s.resolution).toBe(r);
      expect(more.commits).toBe(0);
    });
  }

  it("each template has at least three distinct reachable end states, and the 20 outcomes are distinct campaigns and distinct papers", () => {
    const states = new Map<string, Set<string>>();
    const campaigns = new Set<string>();
    const heads = new Set<string>();
    for (const r of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
      const pre = SCRIPTS[r]!(cm(7))!;
      const def = T[pre.id];
      const c = pre.id === "secure_crossing" && r === "rival_secured" ? calm(pre.id) : cm(7);
      const run = drive(def, c, pre.events);
      const o = def.outcome(run.s)!;
      (states.get(pre.id) ?? states.set(pre.id, new Set()).get(pre.id)!).add(o.resolution);
      const after = applyOutcome(c, o);
      campaigns.add(JSON.stringify(after));
      heads.add(generatePaper(after, 5).headline);
    }
    // (Kessar's four original contracts; D-045's raid is a newer template, scripted in scenarios/outpostRaid.test.ts and covered by regionsContract.test.ts like every other)
    for (const id of REGION_TEMPLATES.kessar.filter((t) => !isNewTemplate(t))) expect(states.get(id)!.size, id).toBeGreaterThanOrEqual(3);
    expect(campaigns.size).toBe(20);
    expect(heads.size).toBe(20);
  });
});

describe("hostage rescue rules", () => {
  const def = T.hostage_rescue;
  const c = calm("hostage_rescue");
  const run = (...e: ScenarioInput[]): Run => drive(def, c, e);
  const ransom = (def.init(c, 40, 7) as unknown as { ransom: number }).ransom;

  it("a quiet cage slips away only when nobody has seen you and the camp has heard nothing loud", () => {
    expect(run(near("cage"), { t: "use", target: "cage", slot: 0 }, { t: "actor", id: "hostage", state: "arrived" }).s.resolution).toBe("slipped_away");
    // seen first: the alarm is up, and a hostage at the dock is only a rescue when three of the four are broken
    const seen = run(near("cage"), { t: "seen", group: "lookout" }, { t: "use", target: "cage", slot: 0 }, { t: "actor", id: "hostage", state: "arrived" });
    expect(seen.s.resolution).toBeUndefined();
    expect(drive(def, c, [count("deserters", 2, 0, 2, 4)], seen.s).s.resolution).toBeUndefined();
    expect(drive(def, c, [count("deserters", 1, 1, 2, 4)], seen.s).s.resolution).toBe("rescued");
    // a carouser who sees you hails you: no stealth any more, but not yet an alarm; a parley (or six seconds of standing there) settles which
    const hailed = run(near("cage"), { t: "seen", group: "deserters" });
    expect(hailed.fx.some((f) => typeof f === "object" && f.k === "order")).toBe(false);
    const talks = drive(def, c, [talk("ransom", "open"), ...ticks(10)], hailed.s);
    expect(talks.fx.some((f) => typeof f === "object" && f.k === "order" && f.order.o === "alert")).toBe(false);
    expect(drive(def, c, ticks(5), hailed.s).fx.some((f) => typeof f === "object" && f.k === "order")).toBe(false);
    expect(drive(def, c, ticks(7), hailed.s).fx.some((f) => typeof f === "object" && f.k === "order" && f.order.o === "alert")).toBe(true);
    const spoiled = drive(def, c, [{ t: "use", target: "cage", slot: 0 }], hailed.s);
    expect(spoiled.fx.some((f) => typeof f === "object" && f.k === "order" && f.order.o === "alert")).toBe(true);
    // loud but not yet an alarm (noise 40..69) spoils the stealth: the lock rattles and the camp wakes
    const loud = run(near("cage"), { t: "noise", level: 55 }, { t: "use", target: "cage", slot: 0 });
    expect(loud.fx).toContainEqual({ k: "open", what: "cage" });
    expect(loud.fx.some((f) => typeof f === "object" && f.k === "order" && f.order.o === "alert")).toBe(true);
    // noise fades: forty seconds later the camp has stopped listening
    const faded = run(near("cage"), { t: "noise", level: 55 }, ...ticks(20), { t: "use", target: "cage", slot: 0 });
    expect(faded.fx.some((f) => typeof f === "object" && f.k === "order" && f.order.o === "alert")).toBe(false);
    // a shot is an alarm at once
    expect(run({ t: "noise", level: 80 }).fx.some((f) => typeof f === "object" && f.k === "order" && f.order.o === "alert")).toBe(true);
  });

  it("D-041: the lookout hails a party walking up the road instead of shooting it; the ransom is reachable; walking away answers the question", () => {
    const alerts = (r: Run): boolean => r.fx.some((f) => typeof f === "object" && f.k === "order" && f.order.o === "alert");
    const hailed = run(near("lookout"), { t: "seen", group: "lookout" });
    expect(alerts(hailed)).toBe(false);
    // the tracker names the man to answer, before the cage, and the compass points at him; the clock is their patience, not the Syndicate's
    const v = def.view(hailed.s, 0);
    expect(v.objectives.map((o) => o.id)).toEqual(["find", "explain", "free", "dock"]);
    expect(v.objectives[0]!.done).toBe(true);
    expect(objectiveMark("kessar", v)).toMatchObject({ label: "The colour-sergeant", x: KESSAR_SITES.hostage.posts[0]!.x, z: KESSAR_SITES.hostage.posts[0]!.z });
    expect(v.timerLabel).toBe("Their patience");
    expect(v.endsAtWorldMs).toBe(HOSTAGE.lookoutChallengeS * 1000);
    // longer than a carouser gives: the colour-sergeant is across the camp
    expect(HOSTAGE.lookoutChallengeS).toBeGreaterThan(HOSTAGE.challengeS);
    expect(alerts(drive(def, c, ticks(HOSTAGE.lookoutChallengeS - 1), hailed.s))).toBe(false);
    expect(alerts(drive(def, c, ticks(HOSTAGE.lookoutChallengeS + 1), hailed.s))).toBe(true);
    // walk up to the colour-sergeant in time and the ransom is on the table
    const talking = drive(def, c, [...ticks(8), near("camp"), talk("ransom", "open"), ...ticks(30)], hailed.s);
    expect(alerts(talking)).toBe(false);
    expect(talking.fx).toContainEqual({ k: "parley", kind: "ransom", price: ransom });
    expect(drive(def, c, [talk("ransom", "ransom", ransom)], talking.s).s.resolution).toBe("ransomed");
    // or walk well away: the hail lapses, no alarm, but the stealth is spoilt (the cage will shriek)
    const gone = drive(def, c, [near("lookout", 0), ...ticks(HOSTAGE.lookoutChallengeS + 5)], hailed.s);
    expect(alerts(gone)).toBe(false);
    expect(def.view(gone.s, 0).objectives.some((o) => o.id === "explain")).toBe(false);
    const back = drive(def, c, [near("cage"), { t: "use", target: "cage", slot: 0 }], gone.s);
    expect(alerts(back)).toBe(true);
    // a fresh arrival still shoots first
    expect(alerts(run({ t: "seen", group: "late:reinf" }))).toBe(true);
  });

  it("D-041: a rescuer who has come within twice the boat's reach of the landing has brought Mr. Quim in, though he trails five metres behind", () => {
    const dock = stationsFor("kessar").find((st) => st.id === "dock")!;
    const goal = hostageTemplate.observe.actors.find((a) => a.id === "hostage")!.goal!;
    // the inland half-circle (the way up from the Orchard), at twice the boat's reach: a person who stops at the dock's edge to wait for him
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + (i / 12) * Math.PI;
      const lx = dock.x + Math.cos(a) * dock.r * 2, lz = dock.z + Math.sin(a) * dock.r * 2;
      const qx = lx, qz = lz - 5; // five metres back along the way up
      expect(Math.hypot(qx - goal.x, qz - goal.z), `leader at ${lx.toFixed(1)},${lz.toFixed(1)}`).toBeLessThanOrEqual(goal.r + 1e-9);
    }
    expect(hostageTemplate.observe.actors.find((a) => a.id === "hostage")!.boards).toBe(true);
  });

  it("the cage opens only in reach, and only once", () => {
    expect(run({ t: "use", target: "cage", slot: 0 }).fx).toEqual([]);
    const o = run(near("cage"), { t: "use", target: "cage", slot: 0 });
    expect(o.fx.filter((f) => typeof f === "object" && f.k === "open")).toHaveLength(1);
    expect(drive(def, c, [{ t: "use", target: "cage", slot: 0 }], o.s).fx).toEqual([]);
  });

  it("the ransom parley: priced from the ledger, affordable or refused, and no shots", () => {
    const talking = run(near("cage"), talk("ransom", "open"));
    expect(talking.fx).toContainEqual({ k: "parley", kind: "ransom", price: ransom });
    expect(talking.s.phase).toBe("parley");
    const paid = drive(def, c, [talk("ransom", "ransom", ransom)], talking.s);
    expect(paid.s.resolution).toBe("ransomed");
    expect(def.outcome(paid.s)).toMatchObject({ paid: ransom, tally: { downed: 0 }, brokePromise: false });
    // a forged amount, or one the purse cannot cover, buys nothing
    expect(drive(def, c, [talk("ransom", "ransom", 1)], talking.s).s.resolution).toBeUndefined();
    expect(drive(def, c, [talk("ransom", "ransom", 99999)], talking.s).s.resolution).toBeUndefined();
    const poor = cm(7, (x) => { x.purse = 3; });
    const ps = def.init(poor, 40, 7);
    const pt = drive(def, poor, [talk("ransom", "open"), talk("ransom", "ransom", (ps as unknown as { ransom: number }).ransom)], ps);
    expect(pt.s.resolution).toBeUndefined();
    // no result without an open parley
    expect(run(talk("ransom", "ransom", ransom)).s.resolution).toBeUndefined();
    // threatening in a parley is a broken promise and an alarm
    const th = drive(def, c, [talk("ransom", "hostile")], talking.s);
    expect(th.s.phase).not.toBe("parley");
    expect(def.outcome(drive(def, c, [{ t: "party_down" }], th.s).s)).toMatchObject({ resolution: "abandoned", brokePromise: true });
  });

  it("the deadline buys him; the Syndicate's bid shortens it; being downed ends it; the dock stops the clock", () => {
    expect(drive(def, c, ticks(HOSTAGE_DEADLINE_S - 2, 2)).s.resolution).toBeUndefined();
    expect(drive(def, c, ticks(HOSTAGE_DEADLINE_S + 2, 2)).s.resolution).toBe("hostage_lost");
    const bid = cm(3, (x) => { x.factions.ward.rivalInfluence = 90; });
    let s = def.init(bid, 40, 1);
    for (let seed = 1; seed < 300 && (s as unknown as { complication: string }).complication !== "rival_bid"; seed++) s = def.init(bid, 40, seed);
    expect((s as unknown as { complication: string }).complication).toBe("rival_bid");
    expect(drive(def, bid, ticks(302, 2), s).s.resolution).toBe("hostage_lost");
    expect(drive(def, bid, ticks(290, 2), s).s.resolution).toBeUndefined();
    expect(run(near("cage"), { t: "use", target: "cage", slot: 0 }, { t: "actor", id: "hostage", state: "down" }).s.resolution).toBe("hostage_lost");
    const dock = run(near("cage"), { t: "use", target: "cage", slot: 0 }, { t: "actor", id: "hostage", state: "arrived" }, ...ticks(HOSTAGE_DEADLINE_S + 20, 5));
    expect(dock.s.resolution).toBe("slipped_away");
  });

  it("reinforcements arrive at 240 s (a late group the runner spawns) and join the alarm", () => {
    let s = def.init(c, 40, 1);
    let cc = c;
    for (let seed = 1; seed < 500; seed++) {
      cc = cm(seed, (x) => { x.sites.lastComplication = "none"; });
      s = def.init(cc, 40, seed);
      if ((s as unknown as { complication: string }).complication === "reinforcements") break;
    }
    expect((s as unknown as { complication: string }).complication).toBe("reinforcements");
    expect(def.roster(cc, 1, s).some((p) => p.group === "late:reinf")).toBe(true);
    const early = drive(def, cc, ticks(238, 2), s);
    expect(early.fx.some((f) => typeof f === "object" && f.k === "spawn")).toBe(false);
    const later = drive(def, cc, ticks(244, 2), s);
    expect(later.fx).toContainEqual({ k: "spawn", group: "late:reinf" });
  });
});

describe("convoy ambush rules", () => {
  const def = T.convoy_ambush;
  const c = calm("convoy_ambush");
  const run = (...e: ScenarioInput[]): Run => drive(def, c, e);

  it("the wagon leaves at CONVOY_DEPART_S: orders, then the wagon goes", () => {
    expect(run(...ticks(CONVOY_DEPART_S - 2)).fx).toEqual([]);
    const go = run(...ticks(CONVOY_DEPART_S + 2));
    expect(go.fx).toContainEqual({ k: "wagon", op: "go" });
    expect(go.fx).toContainEqual({ k: "order", group: "guards", order: { o: "march", route: "convoy" } });
    expect(go.s.phase).toBe("waiting");
  });

  it("seizing needs the guards down or routed AND an INTERACT; the cargo value is the outcome's loot", () => {
    const standing = run(...ticks(CONVOY_DEPART_S + 1), { t: "use", target: "wagon", slot: 0 });
    expect(standing.fx.some((f) => typeof f === "object" && f.k === "wagon" && f.op === "seize")).toBe(false);
    const ready = run(...ticks(CONVOY_DEPART_S + 1), count("guards", 0, 1, 1, 2), { t: "use", target: "wagon", slot: 0 });
    expect(ready.fx).toContainEqual({ k: "wagon", op: "seize" });
    expect(ready.s.resolution).toBeUndefined();
    // a seize that nobody asked for (no claim) is ignored
    expect(drive(def, c, [count("guards", 0, 1, 1, 2), { t: "prop", what: "seized", at: "wagon", n: 99 }], run(...ticks(CONVOY_DEPART_S + 1)).s).s.resolution).toBeUndefined();
    const done = drive(def, c, [{ t: "prop", what: "seized", at: "wagon", n: 72 }], ready.s);
    expect(done.s.resolution).toBe("seized");
    expect(def.outcome(done.s)!.loot).toBe(72);
  });

  it("burned: only a barrel within burnRadius of the wagon counts", () => {
    expect(run({ t: "prop", what: "destroyed", at: "barrel", n: 30 }).s.resolution).toBeUndefined();
    const b = run({ t: "prop", what: "destroyed", at: "barrel", n: 5 });
    expect(b.s.resolution).toBe("burned");
    expect(b.fx).toContainEqual({ k: "wagon", op: "wreck" });
    expect(b.fx).toContainEqual({ k: "explode", at: "wagon" });
  });

  it("tipped off: the Ward post is told once; the ambush resolves when the guards fall, with no player kill", () => {
    const t1 = run(talk("ford_post", "open"));
    expect(t1.fx).toContainEqual({ k: "parley", kind: "ford_post", price: 0 });
    const tipped = drive(def, c, [talk("ford_post", "tip")], t1.s);
    expect(tipped.fx).toContainEqual({ k: "war", a: "ward", b: "rival", on: true });
    expect(drive(def, c, [count("guards", 1, 0, 1, 2)], tipped.s).s.resolution).toBeUndefined();
    expect(drive(def, c, [count("guards", 0, 1, 1, 2)], tipped.s).s.resolution).toBe("tipped_off");
    // guards falling WITHOUT a tip is not a tip-off (it waits for the seizing)
    expect(run(count("guards", 0, 0, 2, 2)).s.resolution).toBeUndefined();
    // a tip with no open parley does nothing
    expect(run(talk("ford_post", "tip")).fx).toEqual([]);
  });

  it("witnesses: a Ward patrol that watches the ambush makes it a broken promise", () => {
    const w = run({ t: "hostile", at: "guards" }, { t: "seen", group: "late:patrol" }, count("guards", 0, 0, 2, 2), { t: "prop", what: "destroyed", at: "barrel", n: 2 });
    expect(def.outcome(w.s)!.brokePromise).toBe(true);
    expect(def.outcome(run({ t: "hostile", at: "guards" }, { t: "prop", what: "destroyed", at: "barrel", n: 2 }).s)!.brokePromise).toBe(false);
  });

  it("outriders and a patrol are late groups the template names", () => {
    for (const comp of ["outriders", "ward_patrol"] as const) {
      let cc = c, s = def.init(c, 40, 1);
      for (let seed = 1; seed < 800; seed++) {
        cc = cm(seed);
        s = def.init(cc, 40, seed);
        if ((s as unknown as { complication: string }).complication === comp) break;
      }
      expect((s as unknown as { complication: string }).complication).toBe(comp);
      const group = comp === "outriders" ? "late:outrider" : "late:patrol";
      expect(def.roster(cc, 1, s).some((p) => p.group === group)).toBe(true);
      expect(drive(def, cc, ticks(100), s).fx).toContainEqual({ k: "spawn", group });
      expect(def.view(s, 0).hint.length).toBeGreaterThan(40);
      expect(def.view(s, 0).complication).toBe(comp);
    }
  });
});

describe("border incident rules", () => {
  const def = T.border_incident;
  const c = calm("border_incident");
  const run = (...e: ScenarioInput[]): Run => drive(def, c, e);
  const tension = (s: BaseState): number => (s as unknown as { tension: number }).tension;

  it("tension rises with time and noise and falls when somebody talks", () => {
    const t0 = tension(def.init(c, 40, 7));
    const later = run(...ticks(60));
    expect(tension(later.s)).toBeGreaterThan(t0 + 10);
    expect(tension(run(...ticks(60), { t: "noise", level: 50 }).s)).toBeGreaterThan(tension(later.s) + 10);
    const talked = run(...ticks(60), talk("ward_post", "open"));
    expect(tension(talked.s)).toBeLessThan(tension(later.s));
    expect(tension(drive(def, c, [talk("ward_post", "survey")], talked.s).s)).toBeLessThan(tension(talked.s));
  });

  it("mediation needs BOTH sides, and then a witness at the Stone while the chains go out (D-041)", () => {
    const one = run(talk("ward_post", "open"), talk("ward_post", "survey"));
    expect(one.s.resolution).toBeUndefined();
    const agreed = drive(def, c, [talk("surveyor", "open"), talk("surveyor", "survey")], one.s);
    expect(agreed.s.resolution).toBeUndefined(); // agreeing is the start of the hard part
    // nobody at the Stone: the chains wait (and the tension keeps rising)
    const away = drive(def, c, ticks(BORDER.witnessS + 5), agreed.s);
    expect(away.s.resolution).toBeUndefined();
    expect(tension(away.s)).toBeGreaterThan(tension(agreed.s));
    // somebody stands witness: mediated, once the time is served (stepping off pauses it)
    const half = drive(def, c, [near("marker"), ...ticks(BORDER.witnessS / 2), near("marker", 0), ...ticks(10)], agreed.s);
    expect(half.s.resolution).toBeUndefined();
    expect(drive(def, c, [near("marker"), ...ticks(BORDER.witnessS / 2 + 1)], half.s).s.resolution).toBe("mediated");
    const done = drive(def, c, [near("marker"), ...ticks(BORDER.witnessS + 1)], agreed.s);
    expect(done.s.resolution).toBe("mediated");
    expect(done.fx).toContainEqual({ k: "order", group: "ward", order: { o: "stand_down" } });
    expect(done.fx).toContainEqual({ k: "order", group: "rival", order: { o: "stand_down" } });
  });

  it("telling the patrol the plan needs the plan; pulling the Stone needs the envelope", () => {
    const blind = run(talk("ward_post", "open"), talk("ward_post", "tell"));
    expect(blind.s.resolution).toBeUndefined();
    expect(blind.fx.some((f) => typeof f === "object" && f.k === "say")).toBe(true);
    expect(run(near("marker"), { t: "use", target: "marker", slot: 0 }).s.resolution).toBeUndefined();
    // an envelope without the plan is refused (the parley never offers it, and the reducer will not take it)
    expect(run(talk("surveyor", "open"), talk("surveyor", "envelope"), near("marker"), { t: "use", target: "marker", slot: 0 }).s.resolution).toBeUndefined();
    const syn = run(talk("surveyor", "open"), talk("surveyor", "learn"), talk("surveyor", "envelope"), near("marker"), { t: "use", target: "marker", slot: 0 });
    expect(syn.s.resolution).toBe("sided_syndicate");
    expect(syn.fx).toContainEqual({ k: "order", group: "ward", order: { o: "alert" } });
    // out of reach of the Stone, nothing is pulled
    expect(run(talk("surveyor", "open"), talk("surveyor", "learn"), talk("surveyor", "envelope"), { t: "use", target: "marker", slot: 0 }).s.resolution).toBeUndefined();
  });

  it("provoked: the first shot resolves it; the wronged side fights and the other holds its fire", () => {
    const p = run({ t: "hostile", at: "rival" });
    expect(p.s.resolution).toBe("provoked");
    expect(p.fx).toContainEqual({ k: "order", group: "rival", order: { o: "attack", side: "party" } });
    expect(p.fx).toContainEqual({ k: "order", group: "ward", order: { o: "hold_fire" } });
    expect(run({ t: "hostile", at: "elsewhere" }).s.resolution).toBeUndefined();
  });

  it("escalation: time or tension 100 starts a war between the sides; it ends when one side is gone or the clash runs its course", () => {
    const e = run(...ticks(BORDER_ESCALATE_S + 1));
    expect(e.s.phase).toBe("escalated");
    expect(e.fx).toContainEqual({ k: "war", a: "ward", b: "rival", on: true });
    expect(e.commits).toBe(0);
    expect(drive(def, c, [count("rival", 0, 0, 3, 3)], e.s).s.resolution).toBe("escalated");
    expect(drive(def, c, ticks(50), e.s).s.resolution).toBe("escalated");
    const loud = run({ t: "noise", level: 100 }, { t: "noise", level: 100 }, { t: "noise", level: 100 }, { t: "noise", level: 100 });
    expect(loud.s.phase).toBe("escalated");
    // talking is useless once the shooting starts
    expect(drive(def, c, [talk("ward_post", "open")], e.s).fx.some((f) => typeof f === "object" && f.k === "parley")).toBe(false);
  });

  it("complications: a stray shot adds 40 tension at 150 s; reinforcements add a late group", () => {
    for (const comp of ["stray_shot", "reinforcements", "fog"] as const) {
      let cc = c, s = def.init(c, 40, 1);
      for (let seed = 1; seed < 800; seed++) {
        cc = cm(seed, (x) => { x.sites.lastComplication = "none"; });
        s = def.init(cc, 40, seed);
        if ((s as unknown as { complication: string }).complication === comp) break;
      }
      expect((s as unknown as { complication: string }).complication, comp).toBe(comp);
      if (comp === "stray_shot") {
        const before = drive(def, cc, ticks(148), s), after = drive(def, cc, ticks(152), s);
        expect(tension(after.s) - tension(before.s)).toBeGreaterThan(35);
      }
      if (comp === "reinforcements") expect(drive(def, cc, ticks(125), s).fx).toContainEqual({ k: "spawn", group: "late:reinf" });
    }
  });
});

describe("leave: sailing away commits per the table", () => {
  it("dismissed when nothing happened; the template's own ending otherwise", () => {
    const table: [ScenarioTemplateId, ScenarioInput[], ResolutionId | undefined][] = [
      ["secure_crossing", [], undefined],
      ["secure_crossing", [{ t: "tick", dt: 3 }], undefined],
      ["secure_crossing", [{ t: "arrive", party: 1 }], "abandoned"],
      ["secure_crossing", [{ t: "hostile" }], "abandoned"],
      ["secure_crossing", [{ t: "tally", add: { wounded: 1 } }], "abandoned"],
      ["secure_crossing", [near("bar"), { t: "use", target: "pier", slot: 0 }], "sabotaged"],
      ["hostage_rescue", [], undefined],
      ["hostage_rescue", [near("camp")], undefined],
      ["hostage_rescue", [{ t: "tally", add: { downed: 1 } }], "hostage_lost"],
      ["hostage_rescue", [{ t: "seen", group: "lookout" }], undefined], // (D-041: hailed and gone, nothing happened)
      ["hostage_rescue", [near("lookout"), { t: "seen", group: "lookout" }, ...ticks(16)], "hostage_lost"],
      ["hostage_rescue", [{ t: "seen", group: "late:reinf" }], "hostage_lost"],
      ["hostage_rescue", [near("cage"), { t: "use", target: "cage", slot: 0 }], "hostage_lost"],
      ["hostage_rescue", [near("cage"), { t: "use", target: "cage", slot: 0 }, { t: "actor", id: "hostage", state: "arrived" }], "slipped_away"],
      ["convoy_ambush", [], undefined],
      ["convoy_ambush", [...ticks(30)], undefined],
      ["convoy_ambush", [...ticks(CONVOY_DEPART_S + 1)], "passed"],
      ["convoy_ambush", [{ t: "hostile", at: "guards" }], "passed"],
      ["border_incident", [], undefined],
      ["border_incident", [near("marker")], "escalated"],
      ["border_incident", [{ t: "tally", add: { wounded: 1 } }], "escalated"],
    ];
    for (const [id, events, want] of table) {
      const def = T[id];
      const run = drive(def, calm(id), events);
      expect(def.leave(run.s), `${id} ${JSON.stringify(events).slice(0, 80)}`).toBe(want);
      const left = drive(def, calm(id), [{ t: "leave" }], run.s);
      if (want === undefined) {
        expect(left.s.resolution, "dismissed").toBeUndefined();
        expect(left.commits).toBe(0);
        expect(def.outcome(left.s)).toBeUndefined();
      } else {
        expect(left.s.resolution).toBe(want);
        expect(left.commits).toBe(run.s.phase === "resolved" ? 0 : 1);
        expect(def.outcome(left.s)!.resolution).toBe(want);
      }
    }
  });

  it("a lit fuse falls unwatched (the bridge is gone, nobody was on it); abandoned keeps the tally and the broken promises", () => {
    const def = T.secure_crossing;
    const lit = drive(def, calm("secure_crossing"), [near("bar"), { t: "use", target: "pier", slot: 0 }, { t: "leave" }]);
    expect(def.outcome(lit.s)).toMatchObject({ resolution: "sabotaged", bridge: "collapsed" });
    const fought = drive(def, calm("secure_crossing"), [{ t: "arrive", party: 2 }, { t: "parley_open" }, { t: "hostile" }, { t: "tally", add: { garrisonKilled: 2, limbsLost: 1 } }, { t: "leave" }]);
    expect(def.outcome(fought.s)).toMatchObject({ resolution: "abandoned", brokePromise: true, tally: { garrisonKilled: 2, limbsLost: 1 } });
  });
});

describe("crossing: settled", () => {
  const def = T.secure_crossing;
  const paid = (c: CampaignState, r: ResolutionId = "paid"): CampaignState =>
    applyOutcome(c, { scenario: "secure_crossing", resolution: r, toll: 40, paid: 40, bridge: "intact", tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 }, brokePromise: false, seconds: 1 });

  it("after paid / bargained / bribed / forced the crossing is settled for SETTLED_DAYS days; sabotaged, rival_secured and abandoned do not settle", () => {
    for (const r of ["paid", "bargained", "bribed", "forced"] as const) {
      let c = paid(newCampaign(5), r);
      expect(def.settled!(c), r).toBe(true);
      const s = def.init(c, 40, 7);
      expect(s.phase, "a forced entry starts resolved").toBe("resolved");
      expect(s.resolution).toBeUndefined();
      expect(def.outcome(s)).toBeUndefined();
      expect(def.view(s, 0).hint).toMatch(/on the books/);
      expect(def.leave(s)).toBeUndefined();
      // two more days of other business and it is still settled; the third and it lapses
      c = applyOutcome(c, { scenario: "border_incident", resolution: "mediated", toll: 0, paid: 0, bridge: "intact", tally: c.tally, brokePromise: false, seconds: 1 });
      c = { ...c, tally: newCampaign(1).tally };
      expect(def.settled!(c)).toBe(true);
      c = applyOutcome(c, { scenario: "border_incident", resolution: "mediated", toll: 0, paid: 0, bridge: "intact", tally: c.tally, brokePromise: false, seconds: 1 });
      expect(def.settled!(c)).toBe(true);
      c = applyOutcome(c, { scenario: "border_incident", resolution: "mediated", toll: 0, paid: 0, bridge: "intact", tally: c.tally, brokePromise: false, seconds: 1 });
      expect(def.settled!(c), `${r} after the window`).toBe(false);
      expect(def.init(c, 40, 7).phase).toBe("approach");
    }
    for (const r of ["sabotaged", "rival_secured", "abandoned"] as const) expect(def.settled!(paid(newCampaign(5), r)), r).toBe(false);
  });

  it("once the window is over the toll lapses back to the asking price", () => {
    let c = paid(newCampaign(5));
    expect(c.crossing.toll).toBe(40);
    expect(def.init({ ...c, day: c.day + 1 }, 55, 7)).toBeDefined();
    c = { ...c, day: c.day + 3 };
    const s = def.init(c, 55, 7) as unknown as { core: { toll: number } };
    expect(s.core.toll).toBe(55);
  });

  it("a settled crossing never commits, so re-paying is impossible", () => {
    const c = paid(newCampaign(5));
    const run = drive(def, c, [{ t: "arrive", party: 2 }, { t: "parley_open" }, { t: "deal", resolution: "paid", toll: 40, paid: 40 }, { t: "hostile" }, { t: "party_down" }]);
    expect(run.commits).toBe(0);
    expect(run.s.resolution).toBeUndefined();
  });
});

describe("client-reachable fuzz: nothing a client can send resolves a run before the world says so", () => {
  // "pier" is gated by the RUNNER (a carried barrel in reach: server Scenario.test.ts forges it with empty hands); the reducer cannot see hands
  const TARGETS = ["cage", "wagon", "marker", "warden", "ransom", "ford_post", "surveyor", "ward_post", "", "__proto__"];
  const KINDS = ["warden", "ransom", "ward_post", "surveyor", "ford_post"] as const;
  it("3000 sequences of forged use / talk-open / talk-close / near / tick never reach an ending before the clock does", () => {
    const rng = new Rng(0xbadc0de);
    let ends = 0;
    for (let i = 0; i < 3000; i++) {
      const id = TEMPLATE_IDS[i % TEMPLATE_IDS.length]!;
      const def = T[id];
      const c = cm(1 + (i % 50));
      let s = def.init(c, 40, 1 + (i % 50));
      let seconds = 0;
      for (let k = 0; k < 30; k++) {
        const roll = rng.int(0, 9);
        let e: ScenarioInput;
        if (roll < 3) e = { t: "use", target: TARGETS[rng.int(0, TARGETS.length - 1)]!, slot: rng.int(-3, 9) };
        else if (roll < 5) e = { t: "talk", kind: KINDS[rng.int(0, KINDS.length - 1)]!, result: rng.chance(0.5) ? "open" : "close", paid: rng.int(-5, 500) };
        else if (roll < 7) e = { t: "near", at: ["cage", "camp", "cut", "marker", "ward", "rival", "bar", "lookout", "x"][rng.int(0, 8)]!, party: rng.int(-2, 6) };
        else if (roll < 8) e = { t: "weather", rain: rng.range(-1, 2) };
        else { const dt = rng.range(0, 3); seconds += Math.min(dt, 5); e = { t: "tick", dt }; }
        const r = def.reduce(s, e);
        s = r.s;
        if (s.phase === "resolved") break;
      }
      if (s.resolution !== undefined) {
        ends++;
        // only the clock may have ended it, and the shortest clock is a hostage deadline of 300 s or the border's 240 s: 30 ticks of <= 3 s cannot reach either
        expect(seconds, `${id} ended by ${s.resolution} at ${s.t}`).toBeGreaterThan(60);
      }
    }
    expect(ends).toBe(0);
  });

  it("a forged talk RESULT without its open parley, from nowhere, or with garbage amounts, resolves nothing", () => {
    const results = ["ransom", "survey", "learn", "tell", "envelope", "tip", "paid", "bargained", "bribed", "hostile"] as const;
    for (const id of TEMPLATE_IDS) {
      for (const kind of KINDS) for (const result of results) for (const paid of [0, 1, 40, 1e9, NaN, -4]) {
        const def = T[id];
        const r = def.reduce(def.init(cm(3), 40, 3), { t: "talk", kind, result, paid } as ScenarioInput);
        expect(r.s.resolution, `${id} ${kind} ${result}`).toBeUndefined();
        expect(r.fx.some(isCommit)).toBe(false);
      }
    }
  });

  it("hostile garbage never throws: NaN dt, huge counts, wrong groups", () => {
    for (const id of TEMPLATE_IDS) {
      const def = T[id];
      let s = def.init(cm(2), 40, 2);
      const junk: ScenarioInput[] = [
        { t: "tick", dt: NaN }, { t: "tick", dt: -5 }, { t: "tick", dt: 1e9 }, { t: "count", group: "deserters", alive: 99, routed: -4, down: NaN, total: 1e9 }, { t: "count", group: "", alive: 1, routed: 1, down: 1, total: 1 },
        { t: "noise", level: NaN }, { t: "noise", level: 1e9 }, { t: "seen", group: "x" }, { t: "prop", what: "destroyed", at: "barrel", n: NaN }, { t: "actor", id: "hostage", state: "free" }, { t: "near", at: "cage", party: 1e9 },
      ];
      for (const e of junk) expect(() => { s = def.reduce(s, e).s; }, `${id} ${JSON.stringify(e)}`).not.toThrow();
      expect(Number.isFinite(s.t)).toBe(true);
    }
  });
});

describe("determinism, views and the linger", () => {
  it("init and roster are deterministic; rosters are authored, fictional and capped", () => {
    for (const id of TEMPLATE_IDS) {
      const def = T[id];
      const c = cm(9);
      const a = def.init(c, 40, 5), b = def.init(structuredClone(c), 40, 5);
      expect(a).toEqual(b);
      expect(def.roster(c, 5, a)).toEqual(def.roster(c, 5, b));
      const ids = def.roster(c, 5, a).map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(24);
      for (const p of def.roster(c, 5, a)) { expect(p.name.length).toBeGreaterThan(3); expect(p.skill).toBeGreaterThanOrEqual(0); expect(p.bravery).toBeLessThanOrEqual(100); }
      expect(def.title.length).toBeGreaterThan(5);
      expect(def.brief.length).toBeGreaterThan(60);
    }
  });

  it("every view carries template and title, objectives with unique ids, and names the complication in the hint", () => {
    for (const id of TEMPLATE_IDS) {
      const def = T[id];
      for (let seed = 1; seed < 200; seed++) {
        const c = cm(seed);
        const s = def.init(c, 40, seed);
        const v = def.view(s, 1000);
        expect(v.template).toBe(id);
        expect(v.title).toBe(def.title);
        expect(new Set(v.objectives.map((o) => o.id)).size).toBe(v.objectives.length);
        expect(v.objectives.length).toBeGreaterThan((id === "succession_dispute" && HIGHMARK_STATUS.stub) || !liveTemplates().includes(id) ? 0 : 1);   // D-036/D-037: a stub has one; the real template has several
        expect(v.hint.length).toBeGreaterThan(30);
        const comp = (s as unknown as { complication?: string }).complication;
        if (comp && comp !== "none" && id !== "secure_crossing") expect(v.complication).toBe(comp);
      }
    }
  });

  it("every objective reads alone as the HUD's one line of direction: short, and in the player's words", () => {
    // D-063 shows the first unfinished objective by itself under the compass, so each line must stand alone: ~60 characters, the control called "Use" (as the
    // key prompts say), and never the old "by whatever means", which told a fresh player nothing about where to go or what to do there
    for (const id of TEMPLATE_IDS) {
      const def = T[id];
      const c = cm(11);
      const s0 = def.init(c, 40, 11);
      const steps: ScenarioInput[][] = [[], def.observe.near.map((n) => near(n.id, 2)), [{ t: "arrive", party: 2 }, { t: "hostile" }], ticks(90, 3), ticks(400, 5), [{ t: "party_down" }]];
      let s = s0;
      for (const step of steps) {
        s = drive(def, c, step, s).s;
        for (const o of def.view(s, 1000).objectives) {
          expect(o.text.length, `${id}: ${o.text}`).toBeLessThanOrEqual(60);
          expect(o.text, id).not.toMatch(/INTERACT|by whatever means/);
        }
      }
    }
  });

  it("the linger counts from the resolution", () => {
    const def = T.hostage_rescue;
    const c = calm("hostage_rescue");
    const run = drive(def, c, [{ t: "party_down" }]);
    expect(lingerDone(run.s)).toBe(false);
    expect(lingerDone(drive(def, c, ticks(RESOLVED_LINGER_S + 1), run.s).s)).toBe(true);
    expect(lingerDone(def.init(c, 40, 1))).toBe(false);
  });

  it("parleys: the options are re-derived on the server; a forged index or stale view re-issues the round", () => {
    const ctx = { price: 40, purse: 100, seed: 3, day: 2 };
    for (const kind of ["ransom", "ward_post", "surveyor", "ford_post"] as const) {
      const v = openSiteParley(kind, ctx);
      for (const bad of [-1, 99, 1.5, NaN]) {
        const step = answerSiteParley(kind, ctx, v, bad);
        expect(step.done, `${kind} ${bad}`).toBeUndefined();
        expect(step.view!.round).toBe(v.round);
      }
      expect(() => answerSiteParley(kind, ctx, { round: 9, toll: -5 } as never, 0)).not.toThrow();
      expect(() => answerSiteParley(kind, ctx, undefined as never, 0)).not.toThrow();
    }
    // a ransom the purse cannot cover re-issues the round and charges nothing
    const poor = { ...ctx, purse: 5 };
    const pv = openSiteParley("ransom", poor);
    expect(answerSiteParley("ransom", poor, pv, 0).done).toBeUndefined();
    // the same view and the rich purse pays exactly the price shown
    const rich = answerSiteParley("ransom", ctx, openSiteParley("ransom", ctx), 0);
    expect(rich.done).toEqual({ result: "ransom", paid: 40 });
  });

  it("the fx a template emits are all runner-known shapes", () => {
    const known = new Set(["spawn", "order", "war", "say", "open", "explode", "bridge", "commit", "wagon", "parley"]);
    for (const [, run] of Object.entries(SCRIPTS)) void run;
    for (const r of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
      const pre = SCRIPTS[r]!(cm(7))!;
      const out = drive(T[pre.id], cm(7), pre.events);
      for (const f of out.fx) {
        if (typeof f === "string") expect(["garrison_alert", "garrison_stand_down", "gate_open", "arm_charge", "rival_advance", "commit"]).toContain(f);
        else expect(known.has((f as ScenarioFx).k), `${r}: ${JSON.stringify(f)}`).toBe(true);
      }
    }
  });
});
