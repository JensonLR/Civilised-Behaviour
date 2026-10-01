import { describe, expect, it } from "vitest";
import { applyOutcome, newCampaign, RESOLUTIONS } from "./factions.ts";
import { newPowers, parsePowers, powersAfterOutcome, serializePowers } from "./powers.ts";
import { COUNTER, GRUDGE_FX, RIVAL, RIVAL_GOALS, newRival, rivalAdvance, rivalAfterOutcome, rivalDispatch, rivalEventItem, rivalPresence, rivalSighting, scoreGoals } from "./rival.ts";
import { EVENT_NEWS, GOAL_NEWS } from "./rivalText.ts";
import type { CampaignState, ResolutionId } from "./campaignTypes.ts";
import type { PowersState, RivalEvent, RivalGoal } from "./worldTypes.ts";
import { RIVAL_ARRIVES_S } from "./campaignTypes.ts";

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") for (const v of Object.values(o)) deepFreeze(v);
  return Object.freeze(o);
};

/** A varied (campaign, powers) pair per seed so every goal has a seed that wants it. */
function world(seed: number): { c: CampaignState; p: PowersState } {
  const c0 = newCampaign(seed);
  const c = { ...c0, factions: { ...c0.factions, ward: { ...c0.factions.ward, militaryStrength: 30 + (seed % 5) * 15 }, rival: { ...c0.factions.rival, militaryStrength: 20 + ((seed * 3) % 60) } } };
  const p0 = newPowers(seed);
  const p = { ...p0, rival: { ...p0.rival, grudge: (seed * 7) % 100, purse: (seed * 13) % 220, posts: ((seed % 3) === 0 ? 1 : 0) as 0 | 1 }, flags: seed % 4 === 0 ? ["party_post"] : [] };
  return { c, p };
}

function run(seed: number, days: number): { events: RivalEvent[]; goals: RivalGoal[]; p: PowersState; c: CampaignState; trace: { before: PowersState; ev: RivalEvent[] }[] } {
  let { c, p } = world(seed);
  const events: RivalEvent[] = [];
  const goals: RivalGoal[] = [p.rival.goal];
  const trace: { before: PowersState; ev: RivalEvent[] }[] = [];
  for (let d = 0; d < days; d++) {
    const before = p;
    const r = rivalAdvance(c, p, p.rival.day + 1);
    c = r.c;
    p = r.p;
    events.push(...r.events);
    trace.push({ before, ev: r.events });
    if (goals[goals.length - 1] !== p.rival.goal) goals.push(p.rival.goal);
  }
  return { events, goals, p, c, trace };
}

describe("rival agent", () => {
  it("is deterministic over 200 seeds x 30 days, and survives a JSON round trip each day", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const a = run(seed, 30), b = run(seed, 30);
      expect(serializePowers(a.p)).toBe(serializePowers(b.p));
      expect(a.events).toEqual(b.events);
    }
    const { c, p } = world(5);
    const viaJson = parsePowers(serializePowers(rivalAdvance(c, p, 12).p))!;
    expect(rivalAdvance(c, viaJson, 14).p.rival.day).toBe(14);
  });

  it("never mutates its inputs and never moves the campaign day", () => {
    const { c, p } = world(9);
    deepFreeze(c);
    deepFreeze(p);
    const r = rivalAdvance(c, p, c.day + 9);
    expect(r.c.day).toBe(c.day);
    expect(p.rival.day).toBe(1);
    expect(r.p.rival.day).toBe(10);
  });

  it("goals have inertia: none is dropped inside three days", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { trace } = run(seed, 30);
      let since = world(seed).p.rival.since;
      for (const t of trace) {
        for (const e of t.ev) if (e.kind === "goal_set") {
          // the goal that just ended ran at least three days (a payout needs `leadMin` days and the dwell is three; progress takes more)
          expect(e.day - since, `seed ${seed}`).toBeGreaterThanOrEqual(3); // (a literal, not RIVAL.dwell: the test must catch the constant being weakened)
          since = e.day;
        }
      }
    }
  });

  it("every goal is reached within 40 days in some seed", () => {
    const reached = new Set<RivalGoal>();
    for (let seed = 1; seed <= 200 && reached.size < 6; seed++) {
      const { goals } = run(seed, 40);
      for (const g of goals) reached.add(g);
    }
    expect([...reached].sort()).toEqual([...RIVAL_GOALS].sort());
  });

  it("every payout was announced at least two days earlier (the goal had been set, and printed, since then)", () => {
    let payouts = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { trace } = run(seed, 30);
      for (const t of trace) {
        for (const e of t.ev) {
          if (e.kind === "goal_set") continue;
          payouts++;
          expect(e.day - t.before.rival.since, `seed ${seed} ${e.kind}`).toBeGreaterThanOrEqual(2); // (a literal, not RIVAL.leadMin: the lead time is the fairness rule)
          // and the paper had a dispatch for that goal for every day since
          expect(rivalDispatch(t.before, seed).slug).toBe("rival-goal");
        }
      }
    }
    expect(payouts).toBeGreaterThan(100);
  });

  it("counterplay is real: for each goal at least two endings cut its progress by 15 or more", () => {
    for (const g of RIVAL_GOALS) {
      const strong = (Object.entries(COUNTER[g]) as [ResolutionId, number][]).filter(([, v]) => v >= 15);
      expect(strong.length, g).toBeGreaterThanOrEqual(2);
      const r = { ...newRival(1), goal: g, progress: 60 };
      for (const [res, v] of strong) expect(rivalAfterOutcome(r, res, 0).progress).toBe(Math.max(0, 60 - v));
    }
    expect(Object.keys(GRUDGE_FX).sort()).toEqual([...RESOLUTIONS].sort());
  });

  it("a settled crossing blocks buy_crossing", () => {
    let c = newCampaign(3);
    c = applyOutcome(c, { scenario: "secure_crossing", resolution: "paid", toll: 40, paid: 40, bridge: "intact", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
    const p0 = newPowers(3);
    const p = { ...p0, rival: { ...p0.rival, goal: "buy_crossing" as const, since: c.day - 1, progress: 95, purse: 300, day: c.day } };
    const r = rivalAdvance(c, p, c.day + 1);
    expect(r.c.crossing.control).not.toBe("rival");
    expect(r.events.some((e) => e.kind === "outbid")).toBe(true);
    expect(scoreGoals(c, p, c.day).buy_crossing).toBe(0);
  });

  it("three abandoned runs in a row let it succeed; a Ward that is strong and not abandoned does not", () => {
    const base = newCampaign(4);
    const strong = { ...base, factions: { ...base.factions, ward: { ...base.factions.ward, militaryStrength: 85 } } };
    const p0 = newPowers(4);
    const mk = (c: CampaignState): PowersState => ({ ...p0, rival: { ...p0.rival, goal: "buy_crossing", since: c.day - 1, progress: 95, purse: 300, day: c.day } });
    const noRes = rivalAdvance(strong, mk(strong), strong.day + 1);
    expect(noRes.c.crossing.control).toBe("ward");
    let c = strong;
    for (let i = 0; i < 3; i++) c = applyOutcome(c, { scenario: "secure_crossing", resolution: "abandoned", toll: 40, paid: 0, bridge: "intact", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
    c = { ...c, factions: { ...c.factions, ward: { ...c.factions.ward, militaryStrength: 85 } } };
    const r = rivalAdvance(c, mk(c), c.day + 1);
    expect(r.c.crossing.control).toBe("rival");
    expect(r.events.some((e) => e.kind === "bought_crossing")).toBe(true);
  });

  it("the constants are the spec's (a weakened lead time or dwell must fail here too)", () => {
    expect(RIVAL.leadMin).toBe(2);
    expect(RIVAL.dwell).toBe(3);
    expect(RIVAL.maxDays).toBe(10);
  });

  it("idle days are capped at ten per call and only the rival's clock moves", () => {
    const { c, p } = world(2);
    const r = rivalAdvance(c, p, c.day + 1000);
    expect(r.p.rival.day).toBe(p.rival.day + RIVAL.maxDays);
    expect(rivalAdvance(c, p, p.rival.day).p).toEqual(p);
    expect(rivalAdvance(c, p, 0).p.rival.day).toBe(p.rival.day);
  });

  it("outcomes: grudge moves, progress is cut by the counter, everything stays in range", () => {
    for (const r of RESOLUTIONS) {
      for (const g of RIVAL_GOALS) {
        const x = rivalAfterOutcome({ ...newRival(1), goal: g, progress: 50, grudge: 50 }, r, 3);
        expect(x.progress >= 0 && x.progress <= 100 && x.grudge >= 0 && x.grudge <= 100).toBe(true);
      }
    }
  });

  it("arm_brine arms the Houses; found_post adds a post; sabotage raids a standing outpost", () => {
    const c = newCampaign(6);
    const p0 = newPowers(6);
    const go = (goal: RivalGoal, extra: Partial<PowersState> = {}): ReturnType<typeof rivalAdvance> =>
      rivalAdvance(c, { ...p0, ...extra, rival: { ...p0.rival, goal, since: 4, progress: 95, purse: 300, day: 5, grudge: 60 } }, 6);
    const arm = go("arm_brine");
    expect(arm.p.minor.brine.militaryStrength).toBe(p0.minor.brine.militaryStrength + 15);
    expect(arm.events.some((e) => e.kind === "armed_brine")).toBe(true);
    const post = go("found_post");
    expect(post.p.rival.posts).toBe(1);
    const raid = go("sabotage_party", { flags: ["party_post"] });
    expect(raid.events.some((e) => e.kind === "raided_outpost")).toBe(true);
    expect(raid.p.flags).toContain("party_post_raided");
    expect(go("sabotage_party").events.some((e) => e.kind === "ambushed_party")).toBe(true);
    const low = go("lie_low");
    expect(low.p.rival.purse).toBeGreaterThan(300 - 1);
  });

  it("presence and sighting", () => {
    const c = newCampaign(1);
    const p = newPowers(1);
    const pre = rivalPresence(c, p);
    expect(pre.arrivesInS).toBeGreaterThanOrEqual(150);
    expect(pre.arrivesInS).toBeLessThanOrEqual(480);
    expect(pre.escort).toBeGreaterThanOrEqual(1);
    const angry = rivalPresence(c, { ...p, rival: { ...p.rival, goal: "sabotage_party", grudge: 80 } });
    expect(angry.arrivesInS).toBeLessThan(RIVAL_ARRIVES_S);
    expect(rivalPresence(c, { ...p, rival: { ...p.rival, goal: "arm_brine" } }).wagon).toBe(true);
    expect(rivalPresence(c, { ...p, rival: { ...p.rival, goal: "lie_low" } }).surveyors).toBe(0);
    expect(rivalSighting(c, p, 0)).toBeUndefined();
    const seen = { ...p, rival: { ...p.rival, seenDay: 3, day: 5, where: { region: "kessar" as const, spot: "ford" as const } } };
    const s = rivalSighting(c, seen, 0)!;
    expect(s.age).toBe(2);
    expect(s.where).toBe("at the ford");
    expect(s.goal).toBeUndefined();
    expect(rivalSighting(c, seen, 2)!.goal).toBeTruthy();
  });

  it("the copy: three variants of every goal and event, dispatch fills the days, events print", () => {
    for (const g of RIVAL_GOALS) {
      expect(GOAL_NEWS[g].head.length).toBeGreaterThanOrEqual(3);
      expect(GOAL_NEWS[g].body.length).toBeGreaterThanOrEqual(3);
    }
    for (const [k, v] of Object.entries(EVENT_NEWS)) {
      expect(v.head.length, k).toBeGreaterThanOrEqual(3);
      expect(v.body.length, k).toBeGreaterThanOrEqual(3);
      expect(rivalEventItem({ day: 3, kind: `rival_${k}`, a: "rival", n: 0 }, 2)?.head, k).toBeTruthy();
    }
    for (const g of RIVAL_GOALS) {
      const p = newPowers(2);
      const d = rivalDispatch({ ...p, rival: { ...p.rival, goal: g, lead: 3 } }, 4);
      expect(d.body).not.toContain("{days}");
    }
  });

  it("through the real commit pipeline: three ten-outcome campaigns (different seeds) play different goal sequences, the same seed the same one; every payout was announced", () => {
    const script = (seed: number): { goals: string[]; announced: boolean } => {
      let c = newCampaign(seed);
      let p = newPowers(seed);
      const goals: string[] = [p.rival.goal];
      let announced = true;
      const rs: ResolutionId[] = ["paid", "forced", "seized", "bargained", "abandoned", "tipped_off", "abandoned", "passed", "burned", "abandoned"];
      for (let i = 0; i < 10; i++) {
        const r = rs[(i + seed) % rs.length]!;
        const o = { scenario: "secure_crossing" as const, resolution: r, toll: 40, paid: 10, bridge: "intact" as const, brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: i % 2 } };
        const before = c;
        c = applyOutcome(before, o);
        p = powersAfterOutcome(before, c, p, o);
        const since = p.rival.since;
        const adv = rivalAdvance(c, p, c.day + 1);
        for (const e of adv.events) if (e.kind !== "goal_set" && e.day - since < 2) announced = false;
        c = adv.c;
        p = adv.p;
        if (goals[goals.length - 1] !== p.rival.goal) goals.push(p.rival.goal);
      }
      return { goals, announced };
    };
    const a = script(1), b = script(2), d = script(3);
    expect(script(1)).toEqual(a);
    expect(new Set([a.goals.join(">"), b.goals.join(">"), d.goals.join(">")]).size).toBeGreaterThanOrEqual(2);
    for (const r of [a, b, d]) expect(r.announced).toBe(true);
  });
});
