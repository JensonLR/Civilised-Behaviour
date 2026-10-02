import type { CampaignState, FactionStance, NeedId, RegionId, ResolutionId, ScenarioOutcome } from "./campaignTypes.ts";
import { NEEDS, POWERS, WARD, clampI, stanceOf, type Temperament } from "./factions.ts";
import { HIGHMARK_RESOLUTIONS } from "./highmark.ts";
import type { MinorDelta as EndingMinorDelta } from "./regionEndings.ts";
import { ENGINE_ENDINGS, ENGINE_FAVOUR } from "./engineLedger.ts";
import { RAID_ENDINGS } from "./raidLedger.ts";
import { REAPERS_ENDINGS, REAPERS_FAVOUR } from "./reapersLedger.ts";
import { SALTMARKET_ENDINGS, SALTMARKET_FAVOUR } from "./saltmarketLedger.ts";
import { VESPER_ENDINGS, VESPER_FAVOUR } from "./vesperLedger.ts";
import { rivalAfterOutcome, newRival, rivalDispatch, rivalEventItem } from "./rival.ts";
import { REL_BASE, applyRelationFx, cloneState, hasFlag, pairEnds, pairKey, pairState, withFlag, withLog, withoutFlag, type RelVec } from "./relations.ts";
import { hash3 } from "./rng.ts";
import {
  AUTHORED_FLAGS, DISLIKES, ECONOMY, FLAG_FX, HOOKS, LEADERS, LIKES, MILITARY, NEEDS_TEXT, NEWS, POWER_SHORT, RIVALRIES, STRUCTURE, type HookDef, type Leader,
} from "./powersText.ts";
import {
  PAIR_KEYS, POWER_IDS, POWERS_JSON_MAX, type MapPowerPin, type MinorPowerId, type PaperItem, type PowerEffects, type PowerEvent, type PowerId, type PowerState, type PowersState,
  type RegionClimate, type SettlementEvent,
} from "./worldTypes.ts";

/**
 * The five powers as data and rules (D-035). `ward` and `rival` keep their FactionState in CampaignState.factions; the three minor powers live in `PowersState.minor`
 * (their own JSON blob, revision and parser, like PartyState). Pure and deterministic; hostile-safe parsing; no real-world names (the copy is powersText.ts).
 */

export const MINOR_IDS: readonly MinorPowerId[] = ["brine", "reapers", "choir"];
export const isMinor = (id: unknown): id is MinorPowerId => id === "brine" || id === "reapers" || id === "choir";
export const isPowerId = (id: unknown): id is PowerId => typeof id === "string" && (POWER_IDS as readonly string[]).includes(id);

export interface PowerDef {
  id: PowerId; name: string; seat: string; motto: string; leader: Leader; structure: string; temperament: Temperament;
  economy: { produces: string; wants: string; priceMul: number }; military: { style: string; base: number; garrison: string };
  needs: Record<NeedId, string>; likes: readonly string[]; dislikes: readonly string[]; rivalries: readonly { id: PowerId; why: string }[];
  /** Three hooks in a fixed order: a purchase, a favour, a price of refusal. Audiences play the minor powers' (the Ward's is the toll-bar parley, the Syndicate's is the rival agent). */
  hooks: readonly HookDef[];
}

const RIVAL_TEMPERAMENT: Temperament = { pride: 60, greed: 90, caution: 45, humour: 30 };
const SIDE_HOOKS = (flag: string): readonly HookDef[] => [
  { kind: "purchase", id: `${flag}_purchase`, title: "A Standing Arrangement", cost: 0, flag: "", text: "Settled at the table, in the parley and in the ledger; not played as an audience." },
  { kind: "favour", id: `${flag}_favour`, title: "A Favour at Court", cost: 0, flag: "", text: "Settled in the contracts themselves: what you do at Kessar is the favour." },
  { kind: "refusal", id: `${flag}_refusal`, title: "The Price of Refusing", cost: 0, flag: "", text: "Settled by the ledger, and by the rival agent's grudge." },
];

function defOf(id: PowerId): PowerDef {
  const base = id === "rival" ? undefined : POWERS.find((p) => p.id === id);
  return {
    id, name: base?.name ?? "Dunmarrow-Vesk Syndicate", seat: base?.seat ?? "The Syndicate camp, Kessar south bank", motto: base?.motto ?? "Every border is a pricing error.",
    leader: LEADERS[id], structure: STRUCTURE[id], temperament: base?.temperament ?? RIVAL_TEMPERAMENT, economy: ECONOMY[id], military: MILITARY[id], needs: NEEDS_TEXT[id],
    likes: LIKES[id], dislikes: DISLIKES[id], rivalries: RIVALRIES[id], hooks: id === "ward" || id === "rival" ? SIDE_HOOKS(id) : HOOKS[id],
  };
}
export const POWER_DEFS: Record<PowerId, PowerDef> = { ward: defOf("ward"), rival: defOf("rival"), brine: defOf("brine"), reapers: defOf("reapers"), choir: defOf("choir") };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------------------------------------

const MINOR_BASE: Record<MinorPowerId, Omit<PowerState, "id">> = {
  brine: { trust: 20, fear: 5, grievance: 10, playerInfluence: 10, rivalInfluence: 35, militaryStrength: 50, prosperity: 70, need: "arms", lastAudienceDay: 0, owes: 0, refusals: [] },
  reapers: { trust: 24, fear: 5, grievance: 5, playerInfluence: 15, rivalInfluence: 10, militaryStrength: 30, prosperity: 45, need: "medicine", lastAudienceDay: 0, owes: 0, refusals: [] },
  choir: { trust: 25, fear: 10, grievance: 10, playerInfluence: 10, rivalInfluence: 20, militaryStrength: 10, prosperity: 55, need: "deference", lastAudienceDay: 0, owes: 0, refusals: [] },
};
const pct = (v: unknown, d: number): number => clampI(v, 0, 100, d);

export function newPowers(seed: number): PowersState {
  const jit = (id: number, k: number): number => (hash3(seed >>> 0, id, k) % 11) - 5;
  const minor = {} as Record<MinorPowerId, PowerState>;
  MINOR_IDS.forEach((id, i) => {
    const b = MINOR_BASE[id];
    minor[id] = { ...b, id, refusals: [], trust: pct(b.trust + jit(i, 1), b.trust), prosperity: pct(b.prosperity + jit(i, 2), b.prosperity), militaryStrength: pct(b.militaryStrength + jit(i, 3), b.militaryStrength) };
  });
  return { v: 1, minor, rel: { ...REL_BASE }, rival: newRival(seed), flags: [], log: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : d);

function parseMinor(raw: unknown, id: MinorPowerId): PowerState {
  const d = MINOR_BASE[id];
  const r = isObj(raw) ? raw : {};
  const refusals = Array.isArray(r.refusals) ? r.refusals.slice(-3).map((x) => clampI(x, 0, 9999, 0)) : [];
  return {
    id, trust: pct(r.trust, d.trust), fear: pct(r.fear, d.fear), grievance: pct(r.grievance, d.grievance), playerInfluence: pct(r.playerInfluence, d.playerInfluence),
    rivalInfluence: pct(r.rivalInfluence, d.rivalInfluence), militaryStrength: pct(r.militaryStrength, d.militaryStrength), prosperity: pct(r.prosperity, d.prosperity),
    need: oneOf(r.need, NEEDS, d.need), lastAudienceDay: clampI(r.lastAudienceDay, 0, 9999, 0), owes: clampI(r.owes, 0, 3, 0), refusals,
  };
}

const RIVAL_GOAL_LIST = ["buy_crossing", "survey_route", "arm_brine", "found_post", "sabotage_party", "lie_low"] as const;
const SPOTS = ["camp", "road", "ford", "fort", "outpost", "sea"] as const;

function parseRival(raw: unknown): PowersState["rival"] {
  const d = newRival(0);
  const r = isObj(raw) ? raw : {};
  const w = isObj(r.where) ? r.where : {};
  return {
    day: clampI(r.day, 1, 9999, 1), goal: oneOf(r.goal, RIVAL_GOAL_LIST, d.goal), since: clampI(r.since, 1, 9999, 1), progress: pct(r.progress, 0), purse: clampI(r.purse, 0, 9999, d.purse),
    escort: pct(r.escort, d.escort), grudge: pct(r.grudge, 0), posts: clampI(r.posts, 0, 2, 0) as 0 | 1 | 2, where: { region: w.region === "hollowmere" ? "hollowmere" : "kessar", spot: oneOf(w.spot, SPOTS, "camp") },
    seenDay: clampI(r.seenDay, 0, 9999, 0), lead: clampI(r.lead, 0, 99, 4),
  };
}

/** Hostile-safe: never throws, rejects wrong version / non-objects / oversized text, clamps every field, drops unknown flags and malformed log rows. */
export function parsePowers(json: string): PowersState | undefined {
  if (typeof json !== "string" || json.length === 0 || json.length > POWERS_JSON_MAX) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isObj(raw) || raw.v !== 1) return undefined;
  const m = isObj(raw.minor) ? raw.minor : {};
  const minor = { brine: parseMinor(m.brine, "brine"), reapers: parseMinor(m.reapers, "reapers"), choir: parseMinor(m.choir, "choir") };
  const rr = isObj(raw.rel) ? raw.rel : {};
  const rel = {} as RelVec;
  for (const k of PAIR_KEYS) rel[k] = clampI(rr[k], -100, 100, REL_BASE[k]);
  const flags: string[] = [];
  if (Array.isArray(raw.flags)) for (const f of raw.flags) if (typeof f === "string" && AUTHORED_FLAGS.includes(f) && !flags.includes(f) && flags.length < 12) flags.push(f);
  const log: PowerEvent[] = [];
  if (Array.isArray(raw.log)) {
    for (const e of raw.log.slice(-6)) {
      if (!isObj(e) || typeof e.kind !== "string" || e.kind.length > 40 || !isPowerId(e.a)) continue;
      const ev: PowerEvent = { day: clampI(e.day, 0, 9999, 0), kind: e.kind, a: e.a, n: clampI(e.n, -9999, 9999, 0) };
      if (isPowerId(e.b)) ev.b = e.b;
      log.push(ev);
    }
  }
  return { v: 1, minor, rel, rival: parseRival(raw.rival), flags, log };
}

/** CANONICAL: fixed key order whatever order the rules built the object in, so equal states are equal bytes (a saved campaign resumes byte for byte). */
export function serializePowers(p: PowersState): string {
  const minor = (m: PowerState): PowerState => ({
    id: m.id, trust: m.trust, fear: m.fear, grievance: m.grievance, playerInfluence: m.playerInfluence, rivalInfluence: m.rivalInfluence, militaryStrength: m.militaryStrength,
    prosperity: m.prosperity, need: m.need, lastAudienceDay: m.lastAudienceDay, owes: m.owes, refusals: [...m.refusals],
  });
  const rel = {} as PowersState["rel"];
  for (const k of PAIR_KEYS) rel[k] = p.rel[k];
  const r = p.rival;
  return JSON.stringify({
    v: 1, minor: { brine: minor(p.minor.brine), reapers: minor(p.minor.reapers), choir: minor(p.minor.choir) }, rel,
    rival: { day: r.day, goal: r.goal, since: r.since, progress: r.progress, purse: r.purse, escort: r.escort, grudge: r.grudge, posts: r.posts, where: { region: r.where.region, spot: r.where.spot }, seenDay: r.seenDay, lead: r.lead },
    flags: [...p.flags], log: p.log.map((e) => (e.b === undefined ? { day: e.day, kind: e.kind, a: e.a, n: e.n } : { day: e.day, kind: e.kind, a: e.a, b: e.b, n: e.n })),
  });
}

/** Same cut points as the Ward's `stanceOf` (trust - grievance + fear / 2). */
export function powerStance(p: Pick<PowerState, "trust" | "grievance" | "fear">): FactionStance {
  const s = p.trust - p.grievance + 0.5 * p.fear;
  return s < -10 ? "hostile" : s < 10 ? "wary" : s < 30 ? "neutral" : s < 55 ? "warm" : "allied";
}

/** Military strength of any power: the Ward and the Syndicate from the campaign, the minors from their state. */
export const militaryOf = (c: CampaignState, p: PowersState, id: PowerId): number => (id === "ward" ? c.factions.ward.militaryStrength : id === "rival" ? c.factions.rival.militaryStrength : p.minor[id].militaryStrength);

// ---------------------------------------------------------------------------------------------------------------------------------------------
// After an ending: relations, the minors' moods, errands, the rival's grudge
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** Resolutions of the newer regions that also satisfy a pledged favour (their ledger files declare them). */
const FAVOUR_EXTRA: Record<MinorPowerId, readonly ResolutionId[]> = {
  brine: [...(VESPER_FAVOUR.brine ?? []), ...(SALTMARKET_FAVOUR.brine ?? [])], reapers: [...(VESPER_FAVOUR.reapers ?? []), ...(SALTMARKET_FAVOUR.reapers ?? []), ...(REAPERS_FAVOUR.reapers ?? [])], choir: [...(VESPER_FAVOUR.choir ?? []), ...(SALTMARKET_FAVOUR.choir ?? []), ...(ENGINE_FAVOUR.choir ?? [])],
};
const FAVOUR_OF: Record<MinorPowerId, { flag: string; hook: HookDef }> = {
  brine: { flag: "errand_brine", hook: HOOKS.brine[1] }, reapers: { flag: "errand_reapers", hook: HOOKS.reapers[1] }, choir: { flag: "errand_choir", hook: HOOKS.choir[1] },
};

/**
 * What Highmark's chair means to each minor power (D-036). The Reapers' Assembly holds the ratifying vote, so every ending moves them; the Guild certifies the King's death (and bills for
 * it) and the Houses want the concession, so they move on the endings that touch those. Integer deltas (applied after the day's drift), distinct per ending.
 */
type ChairKey = (typeof HIGHMARK_RESOLUTIONS)[number];
type MinorDelta = Partial<Pick<PowerState, "trust" | "fear" | "grievance" | "playerInfluence" | "rivalInfluence" | "militaryStrength" | "prosperity">>;
const CHAIR_FX: Record<ChairKey, Record<MinorPowerId, MinorDelta>> = {
  backed_elder:   { reapers: { trust: 6, grievance: -2, playerInfluence: 4, prosperity: 3 }, choir: { prosperity: 6, trust: 2 }, brine: { trust: 1 } },
  backed_younger: { reapers: { trust: 4, playerInfluence: 3, prosperity: 5, militaryStrength: 2 }, choir: { prosperity: 6 }, brine: { trust: -3, rivalInfluence: 2 } },
  regency:        { reapers: { trust: 9, grievance: -4, playerInfluence: 6, prosperity: 2 }, choir: { trust: 3 }, brine: { trust: 2 } },
  usurped:        { reapers: { trust: -10, grievance: 12, fear: 6, militaryStrength: 5, playerInfluence: -4 }, choir: { prosperity: 12, trust: 3 }, brine: { trust: -4, fear: 3 } },
  crown_sold:     { reapers: { trust: -8, grievance: 10, prosperity: -6, rivalInfluence: 8, playerInfluence: -3 }, choir: { prosperity: 3 }, brine: { trust: -6, grievance: 8, rivalInfluence: 10 } },
};
const isChair = (r: string): r is ChairKey => (HIGHMARK_RESOLUTIONS as readonly string[]).includes(r);
/** D-037: the rows of the newer regions' endings (their numbers: what each meant to each minor power, and the dispatch the paper prints). */
const ENDING_ROWS: Partial<Record<ResolutionId, { minors: Record<MinorPowerId, EndingMinorDelta>; news: { a: PowerId; b?: PowerId } }>> = { ...VESPER_ENDINGS, ...SALTMARKET_ENDINGS, ...REAPERS_ENDINGS, ...ENGINE_ENDINGS, ...RAID_ENDINGS };

/** One day of the minors' drift (fear cools by 2, grudges soften by 1, as the Ward's do) and what this ending meant to each. */
function minorAfter(m: PowerState, o: ScenarioOutcome): PowerState {
  const t = o.tally;
  const dead = t.garrisonKilled + t.rivalKilled;
  const r = o.resolution;
  const n = { ...m, refusals: [...m.refusals], fear: pct(m.fear - 2, m.fear), grievance: pct(m.grievance - 1, m.grievance) };
  if (m.id === "reapers") {
    n.grievance = pct(n.grievance + 3 * Math.min(5, t.civiliansHarmed) + (r === "forced" ? 4 : 0), n.grievance);
    n.trust = pct(n.trust + (r === "rescued" || r === "ransomed" || r === "slipped_away" ? 6 : 0), n.trust);
  } else if (m.id === "choir") {
    n.prosperity = pct(n.prosperity + Math.min(10, dead * 2), n.prosperity);
    n.trust = pct(n.trust + (dead > 0 ? 2 : 0), n.trust);
  } else {
    n.trust = pct(n.trust + (r === "paid" || r === "bargained" || r === "bribed" ? 3 : 0) - (r === "sabotaged" || r === "forced" ? 4 : 0), n.trust);
  }
  if (r === "sided_syndicate" || r === "passed" || r === "rival_secured") n.rivalInfluence = pct(n.rivalInfluence + 3, n.rivalInfluence);
  const d: MinorDelta | undefined = isChair(r) ? CHAIR_FX[r][m.id] : ENDING_ROWS[r]?.minors[m.id];
  if (d) for (const k of Object.keys(d) as (keyof MinorDelta)[]) n[k] = pct(n[k] + (d[k] ?? 0), n[k]);
  return n;
}

/**
 * The map of grudges after a finished scenario. `before`/`after` are the campaign around it. Drift one day, the ending's nudges (`RELATION_FX`), the minors' moods,
 * any errand this ending satisfies (owes + 1), the Syndicate's grudge and progress, and a log line for every pair that changed state. Pure; inputs untouched.
 */
export function powersAfterOutcome(before: CampaignState, after: CampaignState, p0: PowersState, o: ScenarioOutcome): PowersState {
  const p = cloneState(p0);
  const rel0 = p.rel;
  p.rel = applyRelationFx(rel0, o.resolution);
  for (const id of MINOR_IDS) p.minor[id] = minorAfter(p.minor[id], o);
  for (const id of MINOR_IDS) {
    const f = FAVOUR_OF[id];
    if (!hasFlag(p, f.flag) || !((f.hook.satisfiedBy ?? []).includes(o.resolution) || (FAVOUR_EXTRA[id] ?? []).includes(o.resolution))) continue;
    const m = p.minor[id];
    m.owes = Math.min(3, m.owes + 1);
    m.trust = pct(m.trust + 8, m.trust);
    p.flags = withoutFlag(p.flags, f.flag);
    for (const k of PAIR_KEYS) {
      const d = f.hook.rel?.[k];
      if (d) p.rel[k] = clampRelI(p.rel[k] + d);
    }
    p.log = withLog(p.log, { day: after.day, kind: `favour_${id}`, a: id, n: m.owes });
  }
  p.rival = rivalAfterOutcome(p.rival, o.resolution, o.tally.rivalKilled);
  for (const k of PAIR_KEYS) {
    const [a, b] = pairEnds(k);
    const s0 = pairState(rel0[k], militaryOf(before, p0, a), militaryOf(before, p0, b));
    const s1 = pairState(p.rel[k], militaryOf(after, p, a), militaryOf(after, p, b));
    if (s0 !== s1) p.log = withLog(p.log, { day: after.day, kind: `rel_${s1}`, a, b, n: p.rel[k] });
  }
  // the chair's own dispatch goes last, so it is the newest and the paper (and the six-line cap) keep it
  if (isChair(o.resolution)) p.log = withLog(p.log, { day: after.day, kind: `chair_${o.resolution}`, a: "reapers", b: o.resolution === "crown_sold" ? "brine" : "choir", n: Math.max(0, Math.min(999, Math.round(o.paid))) });
  // D-037: the newer regions' endings print their own dispatch (`end_<resolution>`), also last so the six-line cap keeps it
  const row = ENDING_ROWS[o.resolution];
  if (row) p.log = withLog(p.log, row.news.b === undefined ? { day: after.day, kind: `end_${o.resolution}`, a: row.news.a, n: Math.max(0, Math.min(999, Math.round(o.paid))) } : { day: after.day, kind: `end_${o.resolution}`, a: row.news.a, b: row.news.b, n: Math.max(0, Math.min(999, Math.round(o.paid))) });
  return p;
}
const clampRelI = (v: number): number => Math.min(100, Math.max(-100, Math.round(v)));

/** What a founded post, a raid or a loss means to everyone else: the Houses are pleased, the Syndicate annoyed, the Ward tested; a raid is blamed on somebody. */
export function powersAfterSettlement(c: CampaignState, p0: PowersState, ev: readonly SettlementEvent[]): PowersState {
  if (ev.length === 0) return p0;
  const p = cloneState(p0);
  for (const e of ev) {
    if (e.kind === "founded") {
      p.flags = withFlag(p.flags, "party_post");
      p.minor.brine.trust = pct(p.minor.brine.trust + 6, 20);
      p.minor.brine.prosperity = pct(p.minor.brine.prosperity + 4, 60);
      p.rival.grudge = pct(p.rival.grudge + 10, p.rival.grudge);
      p.rel["rival|brine"] = clampRelI(p.rel["rival|brine"] - 4);
      p.rel["ward|brine"] = clampRelI(p.rel["ward|brine"] + 4);
      p.rel["ward|rival"] = clampRelI(p.rel["ward|rival"] - 2);
      p.log = withLog(p.log, { day: e.day, kind: "settle_founded", a: "brine", b: "rival", n: 1 });
    } else if (e.kind === "raided") {
      p.flags = withFlag(p.flags, "party_post_raided");
      p.minor.reapers.grievance = pct(p.minor.reapers.grievance + 3, 5);
      p.rival.progress = Math.min(100, p.rival.progress); // the raid was the payout: nothing more to claim
      p.log = withLog(p.log, { day: e.day, kind: "settle_raided", a: "rival", b: "ward", n: 1 });
    } else if (e.kind === "abandoned") {
      p.flags = withoutFlag(withoutFlag(p.flags, "party_post"), "party_post_raided");
      p.log = withLog(p.log, { day: e.day, kind: "settle_abandoned", a: "ward", n: 1 });
    } else if (e.kind === "promoted" && (e.stage === "settlement" || e.stage === "town")) {
      p.minor.reapers.prosperity = pct(p.minor.reapers.prosperity + 3, 45);
      p.minor.brine.prosperity = pct(p.minor.brine.prosperity + 3, 60);
    }
  }
  void c;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// What the powers add up to
// ---------------------------------------------------------------------------------------------------------------------------------------------

const clamp100 = (v: number): number => Math.min(100, Math.max(0, Math.round(v)));
const PRESSURE: Record<PowersState["rival"]["goal"], number> = { buy_crossing: 40, survey_route: 45, arm_brine: 30, found_post: 55, sabotage_party: 75, lie_low: 5 };

/** The region's mood in five numbers (0..100) for the settlement rules: security from the Ward's strength and its quarrel with the Syndicate; trade from the Houses, prosperity and the crossing. */
export function regionClimate(c: CampaignState, p: PowersState, _region: RegionId): RegionClimate {
  const w = c.factions.ward, r = p.rival;
  const wr = p.rel["ward|rival"];
  const controlTrade = c.crossing.control === "ward" || c.crossing.control === "society" ? 25 : c.crossing.control === "rival" ? 15 : 8;
  return {
    security: clamp100(0.5 * w.militaryStrength + 0.2 * ((wr + 100) / 2) - 0.2 * r.escort + 25),
    trade: clamp100(0.25 * p.minor.brine.trust + 0.3 * w.prosperity + controlTrade - 0.15 * c.crossing.toll + 20),
    hostility: clamp100(0.5 * w.grievance + 0.3 * r.grudge + 5),
    rivalPressure: clamp100(PRESSURE[r.goal] * (0.5 + r.escort / 100) + 0.2 * r.grudge),
    labour: clamp100(0.5 * p.minor.reapers.prosperity + 0.3 * p.minor.reapers.trust + 10),
  };
}

const sum = (a: PowerEffects, b: Partial<PowerEffects>): PowerEffects => ({
  tollDelta: a.tollDelta + (b.tollDelta ?? 0), manifestPct: a.manifestPct + (b.manifestPct ?? 0), sailDelta: a.sailDelta + (b.sailDelta ?? 0), intelDays: a.intelDays + (b.intelDays ?? 0),
});
const warm = (s: FactionStance): boolean => s === "warm" || s === "allied";

/** What standing deals and flags change elsewhere (the integrator applies: the Ward's toll, the manifest's cost, the sailing time, the days of intel). */
export function powerEffects(p: PowersState): PowerEffects {
  let e: PowerEffects = { tollDelta: 0, manifestPct: 0, sailDelta: 0, intelDays: 0 };
  for (const f of p.flags) e = sum(e, FLAG_FX[f] ?? {});
  if (warm(powerStance(p.minor.brine))) e = sum(e, { manifestPct: -3 });
  if (warm(powerStance(p.minor.reapers))) e = sum(e, { manifestPct: -3 });
  if (powerStance(p.minor.choir) === "allied") e = sum(e, { intelDays: 1 });
  return {
    tollDelta: Math.min(20, Math.max(-20, e.tollDelta)), manifestPct: Math.min(25, Math.max(-25, e.manifestPct)), sailDelta: Math.min(2, Math.max(-2, e.sailDelta)),
    intelDays: Math.min(3, Math.max(0, e.intelDays)),
  };
}

/** The powers on the map: unmet ones are `known: false` (and show "?") until a rumour (the paper named them) or an audience, or the third expedition, names them. */
export function mapPins(c: CampaignState, p: PowersState, pending: readonly PowerId[] = []): MapPowerPin[] {
  return POWER_IDS.map((id): MapPowerPin => {
    const d = POWER_DEFS[id];
    const stance = id === "ward" ? stanceOf(c.factions.ward) : id === "rival" ? stanceOf(c.factions.rival) : powerStance(p.minor[id]);
    const known = id === "ward" || id === "rival" || p.minor[id].lastAudienceDay > 0 || p.log.some((e) => e.a === id || e.b === id) || c.expeditions >= 3;
    const need = id === "ward" ? c.factions.ward.need : id === "rival" ? c.factions.rival.need : p.minor[id].need;
    return {
      id, name: known ? d.name : "Unknown power", seat: known ? d.seat : "?", stance, note: known ? d.needs[need] : "Nobody has told you about them yet.", known, audience: pending.includes(id),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The paper
// ---------------------------------------------------------------------------------------------------------------------------------------------

const upper = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const fillNames = (t: string, a: PowerId, b: PowerId | undefined): string => t.replace(/\{A\}/g, upper(POWER_SHORT[a])).replace(/\{a\}/g, POWER_SHORT[a]).replace(/\{b\}/g, b ? POWER_SHORT[b] : "its neighbours");

/** One printed item for a log event (rival events go through rivalText). `undefined` when the kind is unknown. */
export function eventItem(ev: PowerEvent, seed: number): PaperItem | undefined {
  if (ev.kind.startsWith("rival_")) return rivalEventItem(ev, seed);
  const t = NEWS[ev.kind];
  if (!t) return undefined;
  const pick = (list: readonly string[], tag: number): string => list[hash3(seed >>> 0, ev.day, tag, ev.n) % list.length]!;
  return { slug: ev.kind.replace(/_/g, "-"), head: fillNames(pick(t.head, 5), ev.a, ev.b), body: fillNames(pick(t.body, 6), ev.a, ev.b) };
}

/**
 * Dispatches the paper prints FIRST (`PaperExtras.dispatches`): what the Syndicate has in hand (announced from the day it is set), then the newest of the powers' log.
 * `max` bounds the count so the paper's own stories still fit.
 */
export function powersDispatches(p: PowersState, seed: number, max = 3): PaperItem[] {
  const out: PaperItem[] = [rivalDispatch(p, seed)];
  for (let i = p.log.length - 1; i >= 0 && out.length < max; i--) {
    const it = eventItem(p.log[i]!, seed);
    if (it && !it.slug.startsWith("rival-goal") && !out.some((o) => o.slug === it.slug)) out.push(it);
  }
  return out.slice(0, max);
}

