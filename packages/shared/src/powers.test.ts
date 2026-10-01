import { describe, expect, it } from "vitest";
import { liveTemplates } from "./regionStatus.ts";
import { applyOutcome, newCampaign, RESOLUTIONS, TEMPLATE_RESOLUTIONS, stanceOf } from "./factions.ts";
import { AUTHORED_FLAGS, HOOKS, NEWS, RIVALRIES, LEADERS } from "./powersText.ts";
import { MINOR_IDS, POWER_DEFS, eventItem, mapPins, newPowers, parsePowers, powerEffects, powerStance, powersAfterOutcome, powersAfterSettlement, powersDispatches, regionClimate, serializePowers } from "./powers.ts";
import { REL_BASE, RELATION_FX, applyRelationFx, driftRel, pairState } from "./relations.ts";
import { Rng, hash3 } from "./rng.ts";
import { PAIR_KEYS, POWER_IDS, POWERS_JSON_MAX, type PowersState, type SettlementEvent } from "./worldTypes.ts";
import { POWERS } from "./factions.ts";
import { HIGHMARK_STATUS } from "./highmark.ts";
import { generatePaper } from "./newspaper.ts";
import type { CampaignState, ResolutionId, ScenarioOutcome, ScenarioTemplateId } from "./campaignTypes.ts";

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") for (const v of Object.values(o)) deepFreeze(v);
  return Object.freeze(o);
};
const outcome = (resolution: ResolutionId, scenario: ScenarioTemplateId = "secure_crossing", extra: Partial<ScenarioOutcome> = {}): ScenarioOutcome => ({
  scenario, resolution, toll: 40, paid: 20, bridge: "intact", brokePromise: false, seconds: 30,
  tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 }, ...extra,
});
const templateOf = (r: ResolutionId): ScenarioTemplateId => (Object.keys(TEMPLATE_RESOLUTIONS) as ScenarioTemplateId[]).find((t) => TEMPLATE_RESOLUTIONS[t].includes(r)) ?? "secure_crossing";

describe("powers: state, parse, serialise", () => {
  it("round-trips and is deterministic per seed", () => {
    for (let s = 0; s < 50; s++) {
      const p = newPowers(s);
      expect(parsePowers(serializePowers(p))).toEqual(p);
      expect(serializePowers(newPowers(s))).toBe(serializePowers(p));
    }
    expect(serializePowers(newPowers(1))).not.toBe(serializePowers(newPowers(2)));
  });

  it("2000 hostile strings never throw and every parsed int is clamped", () => {
    const rng = new Rng(77);
    const base = serializePowers(newPowers(3));
    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      let s = base;
      const k = Math.floor(rng.next() * 6);
      if (k === 0) s = s.slice(0, Math.floor(rng.next() * s.length));
      else if (k === 1) { const at = Math.floor(rng.next() * s.length); s = s.slice(0, at) + String.fromCharCode(Math.floor(rng.next() * 128)) + s.slice(at + 1); }
      else if (k === 2) s = s.replace(/\d+/g, () => ["-9999999", "1e400", "null", "\"x\"", "9e99", "[]", "{}", "true"][Math.floor(rng.next() * 8)]!);
      else if (k === 3) s = JSON.stringify({ v: 1, minor: { brine: Math.floor(rng.next() * 9), reapers: "x", choir: [] }, rel: { "ward|rival": 1e12 }, rival: { goal: "nope", where: 7 }, flags: ["x", "party_post", "party_post", 5], log: [{ kind: "x".repeat(99), a: "ward" }, null, 3, { kind: "ok", a: "zzz" }] });
      else if (k === 4) s = "x".repeat(Math.floor(rng.next() * 5000));
      else s = String.fromCharCode(...Array.from({ length: 40 }, () => Math.floor(rng.next() * 65536)));
      const p = parsePowers(s);
      if (!p) continue;
      accepted++;
      for (const id of MINOR_IDS) {
        const m = p.minor[id];
        for (const v of [m.trust, m.fear, m.grievance, m.playerInfluence, m.rivalInfluence, m.militaryStrength, m.prosperity]) expect(Number.isInteger(v) && v >= 0 && v <= 100).toBe(true);
        expect(m.owes >= 0 && m.owes <= 3).toBe(true);
        expect(m.refusals.length).toBeLessThanOrEqual(3);
      }
      for (const k2 of PAIR_KEYS) expect(Math.abs(p.rel[k2])).toBeLessThanOrEqual(100);
      expect(p.flags.every((f) => AUTHORED_FLAGS.includes(f))).toBe(true);
      expect(p.flags.length).toBeLessThanOrEqual(12);
      expect(p.log.length).toBeLessThanOrEqual(6);
      expect(serializePowers(p).length).toBeLessThanOrEqual(POWERS_JSON_MAX);
    }
    expect(accepted).toBeGreaterThan(50);
    expect(parsePowers("")).toBeUndefined();
    expect(parsePowers("{\"v\":2}")).toBeUndefined();
    expect(parsePowers("x".repeat(POWERS_JSON_MAX + 1))).toBeUndefined();
  });

  it("the worst case still fits the cap", () => {
    const p = newPowers(1);
    for (const id of MINOR_IDS) Object.assign(p.minor[id], { trust: 100, fear: 100, grievance: 100, playerInfluence: 100, rivalInfluence: 100, militaryStrength: 100, prosperity: 100, lastAudienceDay: 9999, owes: 3, refusals: [9999, 9999, 9999] });
    for (const k of PAIR_KEYS) p.rel[k] = -100;
    p.flags = [...AUTHORED_FLAGS];
    p.log = Array.from({ length: 6 }, () => ({ day: 9999, kind: "rival_posted_surveyors_xxxxxxxxxxxxxxxxx".slice(0, 40), a: "choir" as const, b: "reapers" as const, n: -9999 }));
    p.rival = { ...p.rival, day: 9999, since: 9999, purse: 9999, seenDay: 9999 };
    expect(serializePowers(p).length).toBeLessThan(POWERS_JSON_MAX);
    expect(parsePowers(serializePowers(p))).toEqual(p);
  });
});

describe("powers: the definitions", () => {
  it("every PowerDef field is non-empty; rivalries are symmetric; leaders are distinct; hooks have three distinct kinds", () => {
    const leaders = new Set<string>();
    for (const id of POWER_IDS) {
      const d = POWER_DEFS[id];
      for (const s of [d.name, d.seat, d.motto, d.structure, d.leader.name, d.leader.title, d.leader.speaker, d.economy.produces, d.economy.wants, d.military.style, d.military.garrison]) expect(s.length).toBeGreaterThan(3);
      for (const n of ["coin", "arms", "medicine", "deference"] as const) expect(d.needs[n].length).toBeGreaterThan(10);
      expect(d.likes.length).toBeGreaterThanOrEqual(3);
      expect(d.dislikes.length).toBeGreaterThanOrEqual(3);
      expect(d.rivalries.length).toBeGreaterThan(0);
      expect(d.hooks.length).toBe(3);
      expect(new Set(d.hooks.map((h) => h.kind)).size).toBe(3);
      leaders.add(d.leader.name);
      for (const r of d.rivalries) expect(RIVALRIES[r.id].some((x) => x.id === id), `${id} -> ${r.id}`).toBe(true);
    }
    expect(leaders.size).toBe(5);
    expect(new Set(MINOR_IDS.map((m) => LEADERS[m].name)).size).toBe(3);
  });
  it("the three new powers keep the ids, seats and mottos of POWERS", () => {
    for (const p of POWERS) {
      expect(POWER_DEFS[p.id as keyof typeof POWER_DEFS].seat).toBe(p.seat);
      expect(POWER_DEFS[p.id as keyof typeof POWER_DEFS].motto).toBe(p.motto);
    }
  });
  it("hooks: purchases cost money, favours name the endings that satisfy them, refusals set a flag", () => {
    for (const id of MINOR_IDS) {
      const [buy, favour, price] = HOOKS[id];
      expect(buy.cost).toBeGreaterThan(0);
      expect(favour.satisfiedBy!.length).toBeGreaterThan(1);
      for (const r of favour.satisfiedBy!) expect(RESOLUTIONS as readonly string[]).toContain(r);
      for (const h of [buy, favour, price]) expect(AUTHORED_FLAGS).toContain(h.flag);
      expect(price.fx).toBeDefined();
    }
  });
  it("the news has at least three authored variants of every head and body", () => {
    for (const [k, v] of Object.entries(NEWS)) {
      expect(v.head.length, k).toBeGreaterThanOrEqual(3);
      expect(v.body.length, k).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("relations", () => {
  it("RELATION_FX covers all 20 resolutions and no two endings of one template read alike", () => {
    expect(Object.keys(RELATION_FX).sort()).toEqual([...RESOLUTIONS].sort());
    for (const tpl of Object.keys(TEMPLATE_RESOLUTIONS) as ScenarioTemplateId[]) {
      if (tpl === "succession_dispute" && HIGHMARK_STATUS.stub) continue;   // D-036: neutral stubs until package G authors them (it sets stub:false, and this then bites)
      if (!liveTemplates().includes(tpl)) continue;   // D-037: likewise for the four newer templates, until their region's STATUS flag flips
      const rs = TEMPLATE_RESOLUTIONS[tpl];
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const a = RELATION_FX[rs[i]!], b = RELATION_FX[rs[j]!];
          const diff = PAIR_KEYS.filter((k) => (a[k] ?? 0) !== (b[k] ?? 0)).length;
          expect(diff, `${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
  it("drift converges on the authored base and bounds always hold", () => {
    let rel = { ...REL_BASE };
    for (const k of PAIR_KEYS) rel[k] = k.length % 2 ? 100 : -100;
    for (let i = 0; i < 250; i++) rel = driftRel(rel);
    expect(rel).toEqual(REL_BASE);
    const rng = new Rng(9);
    rel = { ...REL_BASE };
    for (let i = 0; i < 500; i++) {
      rel = applyRelationFx(rel, RESOLUTIONS[Math.floor(rng.next() * 20)]!);
      for (const k of PAIR_KEYS) expect(Math.abs(rel[k])).toBeLessThanOrEqual(100);
    }
  });
  it("pairState cut points", () => {
    expect(pairState(-70, 50, 50)).toBe("feud");
    expect(pairState(-70, 30, 50)).toBe("cold");
    expect(pairState(-21, 90, 90)).toBe("cold");
    expect(pairState(-20, 90, 90)).toBe("civil");
    expect(pairState(29, 0, 0)).toBe("civil");
    expect(pairState(30, 0, 0)).toBe("trade");
    expect(pairState(59, 0, 0)).toBe("trade");
    expect(pairState(60, 0, 0)).toBe("pact");
  });
});

describe("powers: rules", () => {
  it("a fresh campaign starts with no power warm or allied (no standing deal changes anything before the party has done a thing)", () => {
    for (let seed = 0; seed < 500; seed++) {
      const p = newPowers(seed);
      for (const id of MINOR_IDS) expect(["wary", "neutral"], `seed ${seed} ${id}`).toContain(powerStance(p.minor[id]));
      expect(powerEffects(p)).toEqual({ tollDelta: 0, manifestPct: 0, sailDelta: 0, intelDays: 0 });
    }
  });

  it("powerStance uses the Ward's cut points", () => {
    for (let t = 0; t <= 100; t += 10) for (let g = 0; g <= 100; g += 20) for (let f = 0; f <= 100; f += 25) {
      const m = { trust: t, grievance: g, fear: f };
      const ward = { id: "ward" as const, trust: t, fear: f, grievance: g, playerInfluence: 0, rivalInfluence: 0, militaryStrength: 0, prosperity: 0, need: "coin" as const };
      expect(powerStance(m)).toBe(stanceOf(ward));
    }
  });

  it("an ending moves relations, minors and the log; inputs are never mutated; same inputs, same output", () => {
    const c0 = deepFreeze(newCampaign(4));
    const p0 = deepFreeze(newPowers(4));
    for (const r of RESOLUTIONS) {
      const o = outcome(r, templateOf(r));
      const c1 = applyOutcome(c0, o);
      const p1 = powersAfterOutcome(c0, c1, p0, o);
      expect(serializePowers(p1)).toBe(serializePowers(powersAfterOutcome(c0, c1, p0, o)));
      expect(parsePowers(serializePowers(p1))).toEqual(p1);
    }
    const f = powersAfterOutcome(c0, applyOutcome(c0, outcome("provoked", "border_incident")), p0, outcome("provoked", "border_incident"));
    expect(f.rel["ward|rival"]).toBeLessThan(p0.rel["ward|rival"]);
  });

  it("a pair that changes state is printed", () => {
    let c = newCampaign(1);
    let p = newPowers(1);
    p = { ...p, rel: { ...p.rel, "ward|rival": -52 } };
    c = { ...c, factions: { ...c.factions, ward: { ...c.factions.ward, militaryStrength: 80 }, rival: { ...c.factions.rival, militaryStrength: 80 } } };
    const o = outcome("provoked", "border_incident");
    const c1 = applyOutcome(c, o);
    const p1 = powersAfterOutcome(c, c1, p, o);
    expect(p1.log.some((e) => e.kind.startsWith("rel_"))).toBe(true);
  });

  it("an errand is paid back (owes + 1) by an ending that satisfies it, and by nothing else", () => {
    const c = newCampaign(2);
    const p = { ...newPowers(2), flags: ["errand_choir"] };
    const bad = powersAfterOutcome(c, applyOutcome(c, outcome("paid")), p, outcome("paid"));
    expect(bad.minor.choir.owes).toBe(0);
    expect(bad.flags).toContain("errand_choir");
    const good = powersAfterOutcome(c, applyOutcome(c, outcome("forced")), p, outcome("forced"));
    expect(good.minor.choir.owes).toBe(1);
    expect(good.flags).not.toContain("errand_choir");
    expect(good.log.some((e) => e.kind === "favour_choir")).toBe(true);
  });

  it("settlement events: a founded post pleases the Houses and annoys the Syndicate; a raid and an abandonment set and clear flags", () => {
    const c = newCampaign(3);
    const p = newPowers(3);
    const ev = (kind: SettlementEvent["kind"], stage: SettlementEvent["stage"] = "camp"): SettlementEvent => ({ kind, day: 5, region: "kessar", stage, name: "Quim's Rest" });
    const f = powersAfterSettlement(c, p, [ev("founded")]);
    expect(f.minor.brine.trust).toBeGreaterThan(p.minor.brine.trust);
    expect(f.rival.grudge).toBeGreaterThan(p.rival.grudge);
    expect(f.flags).toContain("party_post");
    const r = powersAfterSettlement(c, f, [ev("raided")]);
    expect(r.flags).toContain("party_post_raided");
    const a = powersAfterSettlement(c, r, [ev("abandoned", "none")]);
    expect(a.flags).not.toContain("party_post");
    expect(powersAfterSettlement(c, p, [])).toBe(p);
  });

  it("regionClimate: every number is 0..100 and moves the right way", () => {
    const c = newCampaign(1), p = newPowers(1);
    const base = regionClimate(c, p, "kessar");
    for (const v of Object.values(base)) expect(v >= 0 && v <= 100 && Number.isInteger(v)).toBe(true);
    const strong = regionClimate({ ...c, factions: { ...c.factions, ward: { ...c.factions.ward, militaryStrength: 95 } } }, p, "kessar");
    expect(strong.security).toBeGreaterThan(base.security);
    const angry = regionClimate({ ...c, factions: { ...c.factions, ward: { ...c.factions.ward, grievance: 90 } } }, p, "kessar");
    expect(angry.hostility).toBeGreaterThan(base.hostility);
    const raid = regionClimate(c, { ...p, rival: { ...p.rival, goal: "sabotage_party" } }, "kessar");
    const quiet = regionClimate(c, { ...p, rival: { ...p.rival, goal: "lie_low" } }, "kessar");
    expect(raid.rivalPressure).toBeGreaterThan(quiet.rivalPressure);
    const tolled = regionClimate({ ...c, crossing: { ...c.crossing, toll: 90 } }, p, "kessar");
    expect(tolled.trade).toBeLessThan(base.trade);
    const friends = regionClimate(c, { ...p, minor: { ...p.minor, reapers: { ...p.minor.reapers, prosperity: 90 } } }, "kessar");
    expect(friends.labour).toBeGreaterThan(base.labour);
  });

  it("powerEffects sums flags and clamps", () => {
    const p = newPowers(1);
    expect(powerEffects(p)).toEqual({ tollDelta: 0, manifestPct: 0, sailDelta: 0, intelDays: 0 });
    const e = powerEffects({ ...p, flags: ["brine_tides", "reaper_grain", "choir_ledger"] });
    expect(e.sailDelta).toBe(-1);
    expect(e.manifestPct).toBe(-15);
    expect(e.intelDays).toBe(1);
    const bad = powerEffects({ ...p, flags: ["brine_markup", "reaper_strike", "choir_gossip"] });
    expect(bad.manifestPct).toBe(20);
    expect(bad.tollDelta).toBe(5);
    expect(bad.sailDelta).toBe(1);
  });

  it("mapPins: the unmet are unknown until named", () => {
    const c = newCampaign(1), p = newPowers(1);
    const pins = mapPins(c, p, ["brine"]);
    expect(pins.map((x) => x.id)).toEqual([...POWER_IDS]);
    expect(pins.find((x) => x.id === "ward")!.known).toBe(true);
    const choir = pins.find((x) => x.id === "choir")!;
    expect(choir.known).toBe(false);
    expect(choir.name).not.toContain("Lamentation");
    expect(pins.find((x) => x.id === "brine")!.audience).toBe(true);
    const named = mapPins(c, { ...p, minor: { ...p.minor, choir: { ...p.minor.choir, lastAudienceDay: 2 } } });
    expect(named.find((x) => x.id === "choir")!.known).toBe(true);
    expect(named.find((x) => x.id === "choir")!.name).toContain("Lamentation");
  });
});

describe("the paper: dispatches", () => {
  it("every authored kind prints, deterministically, and differently per kind", () => {
    const seen = new Set<string>();
    for (const kind of Object.keys(NEWS)) {
      const it = eventItem({ day: 4, kind, a: "brine", b: "ward", n: 1 }, 5)!;
      expect(it, kind).toBeDefined();
      expect(it.head.length).toBeGreaterThan(5);
      expect(it.head).not.toMatch(/\{[aAb]\}/);
      expect(eventItem({ day: 4, kind, a: "brine", b: "ward", n: 1 }, 5)).toEqual(it);
      seen.add(it.head);
    }
    expect(seen.size).toBe(Object.keys(NEWS).length);
    expect(eventItem({ day: 1, kind: "nope", a: "ward", n: 0 }, 1)).toBeUndefined();
  });
  it("extras print first and the limits hold; absent extras change nothing", () => {
    const c = applyOutcome(newCampaign(8), outcome("paid"));
    const p = newPowers(8);
    const d = powersDispatches(p, 8);
    expect(d.length).toBeGreaterThan(0);
    const withX = generatePaper(c, 8, { dispatches: d });
    expect(withX.stories[0]!.slug).toBe(d[0]!.slug);
    expect(withX.stories.length).toBeLessThanOrEqual(5);
    expect(generatePaper(c, 8, {})).toEqual(generatePaper(c, 8));
    expect(generatePaper(c, 8, { dispatches: [] })).toEqual(generatePaper(c, 8));
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
  });
});

export type { PowersState, CampaignState };

describe("canonical serialisation", () => {
  it("equal states are equal bytes whatever the key order, and parse then serialise is the identity", () => {
    for (let s = 0; s < 40; s++) {
      let p = newPowers(s);
      p = { ...p, flags: ["party_post"], log: [{ day: 3, kind: "settle_founded", n: 1, b: "rival", a: "brine" }, { day: 4, kind: "rival_outbid", n: 0, a: "rival" }] };
      const shuffled = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
      const reversed = Object.fromEntries(Object.entries(shuffled).reverse());
      expect(serializePowers(reversed as unknown as PowersState)).toBe(serializePowers(p));
      expect(serializePowers(parsePowers(serializePowers(p))!)).toBe(serializePowers(p));
    }
  });
});
