import { describe, expect, it } from "vitest";
import { newCampaign, serializeCampaign, applyOutcome } from "./factions.ts";
import { OUTPOST_NAMES, SETTLEMENT_NEWS, CRATE_LINES, REFUSED_LINES } from "./outpostText.ts";
import { PropKind } from "./props.ts";
import { Rng } from "./rng.ts";
import { SAIL_SECONDS, type CampaignState } from "./campaignTypes.ts";
import {
  DELIVERY, DWELL, SUPPLY_DECAY, deliverEffect, deliverTo, evolveSettlements, foundationStatus, newSettlements, parseSettlements, raidOutpost, regionDressOf, regionWorldOpts, serializeSettlements,
  settlementDispatches, settlementNews, techEffects, techOf, worldKey,
} from "./settlement.ts";
import { OUTPOST_STAGES, SETTLEMENTS_JSON_MAX, FOUNDATION_CRATES, type OutpostStage, type RegionClimate, type SettlementEvent, type SettlementEventKind, type SettlementsState } from "./worldTypes.ts";

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") for (const v of Object.values(o)) deepFreeze(v);
  return Object.freeze(o);
};
const GOOD: RegionClimate = { security: 80, trade: 80, hostility: 10, rivalPressure: 10, labour: 70 };
const camp = (day: number): CampaignState => ({ ...newCampaign(5), day, factions: { ...newCampaign(5).factions, ward: { ...newCampaign(5).factions.ward, prosperity: 80 } } });

function found(day = 1, seed = 5): SettlementsState {
  let s = newSettlements();
  for (let i = 0; i < FOUNDATION_CRATES; i++) s = deliverTo(s, "kessar", PropKind.CRATE, camp(day), seed).s;
  return s;
}

describe("settlements: parse and serialise", () => {
  it("round-trips, and 2000 hostile strings never throw and stay in range", () => {
    let s = found();
    s = evolveSettlements(s, camp(2), GOOD, 2).s;
    expect(parseSettlements(serializeSettlements(s))).toEqual(s);
    expect(parseSettlements(serializeSettlements(newSettlements()))).toEqual(newSettlements());
    const rng = new Rng(31);
    const base = serializeSettlements(s);
    let ok = 0;
    for (let i = 0; i < 2000; i++) {
      let t = base;
      const k = Math.floor(rng.next() * 5);
      if (k === 0) t = t.slice(0, Math.floor(rng.next() * t.length));
      else if (k === 1) t = t.replace(/\d+/g, () => ["-5", "1e99", "null", "\"x\"", "[]", "{}", "true", "9999999"][Math.floor(rng.next() * 8)]!);
      else if (k === 2) t = JSON.stringify({ v: 1, posts: { kessar: { stage: "town", name: "<script>x</script>".repeat(5), supply: 1e9 }, mars: { stage: "camp" }, hollowmere: 5 }, tech: { road: 99, since: [] } });
      else if (k === 3) t = "{".repeat(Math.floor(rng.next() * 3000));
      else t = String.fromCharCode(...Array.from({ length: 30 }, () => Math.floor(rng.next() * 65536)));
      const p = parseSettlements(t);
      if (!p) continue;
      ok++;
      for (const post of Object.values(p.posts)) {
        expect(OUTPOST_STAGES).toContain(post.stage);
        for (const v of [post.supply, post.security, post.trade, post.growth]) expect(v >= 0 && v <= 100 && Number.isInteger(v)).toBe(true);
        expect(post.name.length).toBeLessThanOrEqual(28);
        expect(post.name).not.toMatch(/[<>]/);
      }
      expect([0, 1, 2]).toContain(p.tech.road);
      expect(serializeSettlements(p).length).toBeLessThanOrEqual(SETTLEMENTS_JSON_MAX);
    }
    expect(ok).toBeGreaterThan(30);
    expect(parseSettlements("")).toBeUndefined();
    expect(parseSettlements("{\"v\":3}")).toBeUndefined();
    expect(parseSettlements("x".repeat(SETTLEMENTS_JSON_MAX + 1))).toBeUndefined();
  });
  it("the worst case is under the cap", () => {
    const s = found();
    s.posts.kessar = { ...s.posts.kessar!, name: "W".repeat(28), supply: 100, security: 100, trade: 100, growth: 100, foundedDay: 9999, stageSince: 9999, raidedDay: 9999, crates: 99, raids: 9, stage: "town", priority: "extraction" };
    expect(serializeSettlements(s).length).toBeLessThan(SETTLEMENTS_JSON_MAX);
  });
});

describe("settlements: founding is a physical act", () => {
  it("four crates found a camp, one at a time, each with its own line; the fifth is supply", () => {
    let s = newSettlements();
    const c = camp(3);
    const lines = new Set<string>();
    for (let i = 1; i <= FOUNDATION_CRATES; i++) {
      const d = deliverTo(s, "kessar", PropKind.CRATE, c, 7);
      expect(d.accepted).toBe(true);
      s = d.s;
      lines.add(d.line);
      if (i < FOUNDATION_CRATES) {
        expect(foundationStatus(s, "kessar")).toEqual({ crates: i, standing: false, ruined: false });
        expect(d.events).toEqual([]);
        expect(d.line).toContain(`${i} of ${FOUNDATION_CRATES}`);
      } else {
        expect(d.events.map((e) => e.kind)).toEqual(["founded"]);
        expect(s.posts.kessar!.stage).toBe("camp");
        expect(OUTPOST_NAMES).toContain(s.posts.kessar!.name);
        expect(d.line).toContain(s.posts.kessar!.name);
      }
    }
    expect(foundationStatus(s, "kessar").standing).toBe(true);
    const before = s.posts.kessar!.supply;
    const fifth = deliverTo(s, "kessar", PropKind.CRATE, c, 7);
    expect(fifth.accepted).toBe(true);
    expect(fifth.s.posts.kessar!.supply).toBe(before + DELIVERY.crate.supply);
    expect(fifth.events.map((e) => e.kind)).toEqual(["delivered"]);
    expect(CRATE_LINES.length).toBeGreaterThanOrEqual(3);
  });

  it("a bottle is refused with a line; nothing but crates counts at the foundation; a barrel is security and a chair is growth", () => {
    const c = camp(3);
    const none = deliverTo(newSettlements(), "kessar", PropKind.BOTTLE, c, 1);
    expect(none.accepted).toBe(false);
    expect(REFUSED_LINES).toContain(none.line);
    expect(none.s.posts).toEqual({});
    expect(deliverTo(newSettlements(), "kessar", PropKind.BARREL, c, 1).accepted).toBe(false);
    expect(deliverTo(newSettlements(), "kessar", PropKind.CHAIR, c, 1).accepted).toBe(false);
    const s = found();
    expect(deliverTo(s, "kessar", PropKind.BOTTLE, c, 1).accepted).toBe(false);
    const b = deliverTo(s, "kessar", PropKind.BARREL, c, 1);
    expect(b.s.posts.kessar!.security).toBe(s.posts.kessar!.security + DELIVERY.barrel.security);
    const ch = deliverTo(s, "kessar", PropKind.CHAIR, c, 1);
    expect(ch.s.posts.kessar!.growth).toBe(s.posts.kessar!.growth + DELIVERY.chair.growth);
    expect(deliverEffect(PropKind.BOTTLE)).toEqual({ supply: 0, security: 0, trade: 0, growth: 0 });
    expect(deliverEffect(PropKind.CRATE).supply).toBeGreaterThan(0);
  });

  it("a fallen camp is a ruin and four crates raise it again", () => {
    let s = found(1);
    s = { ...s, posts: { kessar: { ...s.posts.kessar!, supply: 0, stageSince: 1 } } };
    let ev: SettlementEvent[] = [];
    for (let d = 2; d < 30 && s.posts.kessar!.stage !== "none"; d++) {
      const r = evolveSettlements(s, camp(d), { ...GOOD, trade: 0, security: 0 }, d);
      s = r.s;
      ev = ev.concat(r.events);
    }
    expect(s.posts.kessar!.stage).toBe("none");
    expect(s.posts.kessar!.ruined).toBe(true);
    expect(ev.some((e) => e.kind === "abandoned")).toBe(true);
    for (let i = 0; i < FOUNDATION_CRATES; i++) s = deliverTo(s, "kessar", PropKind.CRATE, camp(40), 3).s;
    expect(s.posts.kessar!.stage).toBe("camp");
    expect(s.posts.kessar!.ruined).toBe(false);
  });

  it("never mutates its inputs; the same inputs give the same output", () => {
    const s = deepFreeze(found());
    const c = deepFreeze(camp(4));
    expect(serializeSettlements(deliverTo(s, "kessar", PropKind.CRATE, c, 2).s)).toBe(serializeSettlements(deliverTo(s, "kessar", PropKind.CRATE, c, 2).s));
    expect(serializeSettlements(evolveSettlements(s, c, GOOD, 5).s)).toBe(serializeSettlements(evolveSettlements(s, c, GOOD, 5).s));
    expect(raidOutpost(s, "kessar", 4).events[0]!.kind).toBe("raided");
    expect(raidOutpost(newSettlements(), "kessar", 4).events).toEqual([]);
  });
});

/** A hauled campaign: a crate every day, a good climate; returns the stages reached. */
function haul(days: number, climate: RegionClimate, c0: CampaignState, deliver = true): { s: SettlementsState; stages: Set<OutpostStage>; events: SettlementEvent[] } {
  let s = found(1);
  const stages = new Set<OutpostStage>([s.posts.kessar!.stage]);
  const events: SettlementEvent[] = [];
  for (let d = 2; d <= days; d++) {
    const c = { ...c0, day: d };
    if (deliver) s = deliverTo(s, "kessar", PropKind.CRATE, c, 5).s;
    const r = evolveSettlements(s, c, climate, d);
    s = r.s;
    events.push(...r.events);
    stages.add(s.posts.kessar!.stage);
  }
  return { s, stages, events };
}

describe("settlements: evolution", () => {
  it("a hauled outpost in a good climate reaches town; every stage on the way is visited, with the infrastructure latched", () => {
    const r = haul(60, GOOD, camp(1));
    expect(r.s.posts.kessar!.stage).toBe("town");
    for (const st of ["camp", "trading_post", "settlement", "town"] as const) expect(r.stages.has(st), st).toBe(true);
    expect(r.s.tech.road).toBe(2);
    expect(r.s.tech.telegraph).toBe(true);
    expect(r.s.tech.launch).toBe(true);
    const kinds = new Set(r.events.map((e) => e.kind));
    for (const k of ["promoted", "road", "telegraph", "launch"] as const) expect(kinds.has(k), k).toBe(true);
  });

  it("a threatened but poor outpost becomes a fortified outpost", () => {
    const r = haul(40, { security: 90, trade: 48, hostility: 70, rivalPressure: 60, labour: 50 }, camp(1));
    expect(r.stages.has("fortified_outpost")).toBe(true);
  });

  it("neglect demotes it stage by stage and finally ruins the camp", () => {
    const up = haul(60, GOOD, camp(1));
    let s = up.s;
    const seen: OutpostStage[] = [s.posts.kessar!.stage];
    for (let d = 61; d < 160; d++) {
      s = evolveSettlements(s, camp(d), { security: 10, trade: 5, hostility: 50, rivalPressure: 50, labour: 20 }, d).s;
      const st = s.posts.kessar!.stage;
      if (seen[seen.length - 1] !== st) seen.push(st);
    }
    expect(seen[0]).toBe("town");
    expect(seen.at(-1)).toBe("none");
    expect(s.posts.kessar!.ruined).toBe(true);
    // one stage at a time
    for (let i = 1; i < seen.length - 1; i++) expect(OUTPOST_STAGES.indexOf(seen[i - 1]!) - OUTPOST_STAGES.indexOf(seen[i]!)).toBe(1);
    // latched: the road, wire and launch stay earned
    expect(s.tech.telegraph).toBe(true);
  });

  it("two raids on a weak outpost cost it a stage", () => {
    let s = haul(30, GOOD, camp(1)).s;
    const stage0 = s.posts.kessar!.stage;
    s = { ...s, posts: { kessar: { ...s.posts.kessar!, security: 10, stageSince: 1 } } };
    s = raidOutpost(s, "kessar", 40).s;
    s = { ...s, posts: { kessar: { ...s.posts.kessar!, security: 10 } } };
    s = raidOutpost(s, "kessar", 41).s;
    expect(s.posts.kessar!.raids).toBe(2);
    const r = evolveSettlements(s, camp(42), GOOD, 42);
    expect(OUTPOST_STAGES.indexOf(r.s.posts.kessar!.stage)).toBeLessThan(OUTPOST_STAGES.indexOf(stage0));
    expect(r.events.some((e) => e.kind === "demoted" || e.kind === "abandoned")).toBe(true);
  });

  it("the telegraph is blocked by a fallen bridge (unless trade is high) and by a Syndicate-held crossing; the launch halves the sailing", () => {
    const base = haul(60, GOOD, camp(1)).s;
    const fresh: SettlementsState = { ...base, tech: { road: 0, telegraph: false, launch: false, since: { road: 0, telegraph: 0, launch: 0 } } };
    const post = { ...base.posts.kessar!, stage: "settlement" as const, stageSince: 1, trade: 60, priority: "trade" as const };
    const s0: SettlementsState = { ...fresh, posts: { kessar: post } };
    const c = camp(30);
    const down = { ...c, crossing: { ...c.crossing, bridge: "collapsed" as const } };
    const rival = { ...c, crossing: { ...c.crossing, control: "rival" as const } };
    const after = (cc: CampaignState): boolean => techOf(techOf(s0, cc, GOOD) === s0.tech ? s0 : { ...s0, tech: techOf(s0, cc, GOOD) }, cc, GOOD).telegraph;
    expect(after(c)).toBe(true);
    expect(after(down)).toBe(false);
    expect(after(rival)).toBe(false);
    const ford = { ...s0, posts: { kessar: { ...post, trade: 75 } } };
    expect(techOf({ ...ford, tech: techOf(ford, down, GOOD) }, down, GOOD).telegraph).toBe(true);
    expect(techEffects(newSettlements().tech)).toEqual({ sailSeconds: undefined, capacityKg: 0, intelDays: 0 });
    const t = techEffects({ road: 2, telegraph: true, launch: true, since: { road: 1, telegraph: 1, launch: 1 } });
    expect(t.sailSeconds).toBe(SAIL_SECONDS / 2);
    expect(t.capacityKg).toBe(40);
    expect(t.intelDays).toBe(2);
    // a transport settlement gets the launch; a trading one does not
    const tr = { ...s0, posts: { kessar: { ...post, priority: "transport" as const } } };
    expect(techOf(tr, c, GOOD).launch).toBe(true);
    expect(techOf(s0, c, GOOD).launch).toBe(false);
  });

  it("5000 random sequences never change a stage twice inside its dwell, never leave range, and are deterministic", () => {
    const rng = new Rng(1234);
    for (let run = 0; run < 100; run++) {
      let s = found(1, run);
      let changes: { day: number; from: OutpostStage }[] = [];
      let lastStage: OutpostStage = "camp";
      let lastDay = 1;
      const log: string[] = [];
      for (let d = 2; d < 52; d++) {
        const c = { ...camp(d), crossing: { ...camp(d).crossing, control: rng.next() < 0.1 ? ("rival" as const) : ("ward" as const), bridge: rng.next() < 0.1 ? ("collapsed" as const) : ("intact" as const) } };
        const climate: RegionClimate = { security: Math.floor(rng.next() * 101), trade: Math.floor(rng.next() * 101), hostility: Math.floor(rng.next() * 101), rivalPressure: Math.floor(rng.next() * 101), labour: Math.floor(rng.next() * 101) };
        const roll = rng.next();
        if (s.posts.kessar!.stage === "none" || roll < 0.5) s = deliverTo(s, "kessar", roll < 0.3 ? PropKind.CRATE : roll < 0.4 ? PropKind.BARREL : PropKind.CHAIR, c, run).s;
        if (rng.next() < 0.08) s = raidOutpost(s, "kessar", d).s;
        const r = evolveSettlements(s, c, climate, d);
        s = r.s;
        const p = s.posts.kessar!;
        for (const v of [p.supply, p.security, p.trade, p.growth]) expect(v >= 0 && v <= 100).toBe(true);
        log.push(`${p.stage}:${p.supply}`);
        if (p.stage !== lastStage) {
          if (lastStage !== "none") expect(d - lastDay, `run ${run} day ${d} ${lastStage}->${p.stage}`).toBeGreaterThanOrEqual(DWELL[lastStage]);
          changes.push({ day: d, from: lastStage });
          lastStage = p.stage;
          lastDay = d;
        }
        if (p.stage === "none" && d % 5 === 0) lastDay = d; // a refounding restarts the clock
        if (p.stage !== "none" && lastStage === "none") { lastStage = p.stage; lastDay = d; }
      }
      changes = [];
    }
    expect(SUPPLY_DECAY).toBe(3);
  });
});

describe("settlements: what the world and the view read", () => {
  it("worldKey separates what the collision world depends on; a rigged bridge is a standing one", () => {
    const keys = new Set<string>();
    for (const bridge of ["intact", "rigged", "collapsed"] as const) for (const outpost of OUTPOST_STAGES) for (const telegraph of [false, true]) keys.add(worldKey({ bridge, outpost, telegraph }));
    expect(keys.size).toBe(2 * OUTPOST_STAGES.length * 2);
    expect(worldKey({ bridge: "rigged" })).toBe(worldKey({ bridge: "intact" }));
    expect(worldKey({})).toBe(worldKey({ bridge: "intact", outpost: "none", telegraph: false }));
  });
  it("regionWorldOpts reads both JSON strings and shrugs off garbage", () => {
    const c = applyOutcome(newCampaign(1), { scenario: "secure_crossing", resolution: "sabotaged", toll: 40, paid: 0, bridge: "collapsed", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
    const r = haul(60, GOOD, camp(1)).s;
    expect(regionWorldOpts(serializeCampaign(c), serializeSettlements(r))).toEqual({ bridge: "collapsed", outpost: "town", telegraph: true });
    expect(regionWorldOpts("nope", "nope")).toEqual({ bridge: "intact", outpost: "none", telegraph: false });
    expect(regionWorldOpts(serializeCampaign(newCampaign(1)), serializeSettlements(newSettlements()))).toEqual({ bridge: "intact", outpost: "none", telegraph: false });
  });
  it("regionDressOf: the outpost, the rival's post, the road, the wire, the launch", () => {
    const r = haul(60, GOOD, camp(1)).s;
    const d = regionDressOf(r, { posts: 2 }, "kessar");
    expect(d).toMatchObject({ outpost: "town", rivalPost: 2, road: 2, telegraph: true, launch: true });
    expect(d.name.length).toBeGreaterThan(2);
    expect(regionDressOf(r, { posts: 2 }, "hollowmere")).toEqual({ outpost: "none", rivalPost: 0, road: 0, telegraph: false, launch: false, name: "" });
  });
});

describe("settlements: the paper", () => {
  it("every event kind has at least three authored variants and prints deterministically, filled in", () => {
    const kinds = Object.keys(SETTLEMENT_NEWS) as SettlementEventKind[];
    expect(kinds.length).toBe(9);
    for (const k of kinds) {
      expect(SETTLEMENT_NEWS[k].head.length, k).toBeGreaterThanOrEqual(3);
      expect(SETTLEMENT_NEWS[k].body.length, k).toBeGreaterThanOrEqual(3);
      const heads = new Set<string>();
      for (let seed = 0; seed < 40; seed++) {
        const ev: SettlementEvent = { kind: k, day: 3 + seed, region: "kessar", stage: "trading_post", name: "Quim's Rest" };
        const it = settlementDispatches(newSettlements(), [ev], seed)[0]!;
        expect(it.head + it.body).not.toMatch(/\{\w+\}/);
        expect(settlementDispatches(newSettlements(), [ev], seed)[0]).toEqual(it);
        heads.add(it.head);
      }
      expect(heads.size, k).toBeGreaterThanOrEqual(3);
    }
  });
  it("settlementNews reads the story out of the state alone", () => {
    const r = haul(60, GOOD, camp(1)).s;
    const kinds = settlementNews(r).map((e) => e.kind);
    for (const k of ["founded", "promoted", "road", "telegraph", "launch"] as const) expect(kinds).toContain(k);
    expect(settlementNews(newSettlements())).toEqual([]);
  });
});

describe("settlements: canonical serialisation", () => {
  it("equal states are equal bytes whatever the key order, and parse then serialise is the identity", () => {
    const r = haul(40, GOOD, camp(1)).s;
    const text = serializeSettlements(r);
    const reorder = (o: unknown): unknown => (Array.isArray(o) ? o.map(reorder) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, reorder(v)])) : o);
    expect(serializeSettlements(reorder(r) as SettlementsState)).toBe(text);
    expect(serializeSettlements(parseSettlements(text)!)).toBe(text);
  });
});
