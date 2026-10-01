import type { CampaignState, RegionId } from "./campaignTypes.ts";
import { REGION_IDS, isRegionId, SAIL_SECONDS } from "./campaignTypes.ts";
import { clampI, parseCampaign, stanceOf } from "./factions.ts";
import { CRATE_LINES, DELIVER_LINES, FOUNDATION_ONLY_CRATES, FOUNDED_LINES, OUTPOST_NAMES, REFUSED_LINES, SETTLEMENT_NEWS, STAGE_LABEL } from "./outpostText.ts";
import { PropKind, type PropKindId } from "./props.ts";
import { hash3 } from "./rng.ts";
import {
  FOUNDATION_CRATES, OUTPOST_STAGES, SETTLEMENTS_JSON_MAX, type OutpostPriority, type OutpostStage, type OutpostState, type PaperItem, type RegionClimate, type RegionDress, type RegionWorldOpts,
  type RivalAgent, type SettlementEvent, type SettlementsState, type TechState,
} from "./worldTypes.ts";

/**
 * The Society's outposts as a SIMULATION (D-035): founded by a physical act (carrying crates to a foundation, `deliverTo`), then earned, kept or lost by pure daily
 * evolution from supply, security, trade, the Ward's prosperity and the rival's pressure (`evolveSettlements`), with hysteresis and a minimum dwell so nothing flaps.
 * Roads, a telegraph and a steam launch are LATCHED thresholds with no menu (`techOf`): they show in the world, the paper and the map and change sailing time, capacity
 * and intel (`techEffects`). Pure and deterministic; hostile-safe parsing; every figure is a first pass nobody has played.
 *
 * OutpostState fields, as used here: `crates` counts crates at the foundation until the camp is founded, and afterwards the consecutive days of supply < 15 (the demotion clock);
 * `raids` (appended to the contract) counts raids that landed on a weak outpost (< 30 security).
 */

export const SUPPLY_DECAY = 3;
export const DWELL: Record<Exclude<OutpostStage, "none">, number> = { camp: 2, trading_post: 3, fortified_outpost: 3, settlement: 4, town: 5 };
/** The thresholds to ENTER a stage, and the (12 lower) thresholds to HOLD it: one table, so promotion and demotion cannot disagree. */
export const STAGE_RULES = {
  hysteresis: 12,
  trading_post: { supply: 40, trade: 35 },
  fortified_outpost: { security: 55, threat: 40 },
  settlement: { supply: 60, trade: 55, security: 45 },
  town: { supply: 75, trade: 70, prosperity: 55 },
  starved: { supply: 15, days: 3 },
} as const;
const H = STAGE_RULES.hysteresis;
const STAGE_SECURITY: Record<OutpostStage, number> = { none: 0, camp: 0, trading_post: 5, fortified_outpost: 25, settlement: 15, town: 20 };
const STAGE_TRADE: Record<OutpostStage, number> = { none: 0, camp: 0, trading_post: 10, fortified_outpost: 5, settlement: 15, town: 20 };

const rank = (s: OutpostStage): number => OUTPOST_STAGES.indexOf(s);
const pct = (v: number): number => Math.min(100, Math.max(0, Math.round(v)));
const toward = (v: number, target: number, step: number): number => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

export const newTech = (): TechState => ({ road: 0, telegraph: false, launch: false, since: { road: 0, telegraph: 0, launch: 0 } });
export const newSettlements = (): SettlementsState => ({ v: 1, posts: {}, tech: newTech() });

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Parse and serialise (hostile-safe)
// ---------------------------------------------------------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const PRIORITIES: readonly OutpostPriority[] = ["trade", "military", "growth", "extraction", "transport"];
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : d);
const cleanName = (v: unknown): string => {
  if (typeof v !== "string") return OUTPOST_NAMES[0]!;
  const s = v.replace(/[^\p{L}\p{N}' \-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 28);
  return s.length >= 3 ? s : OUTPOST_NAMES[0]!;
};

function parsePost(raw: unknown, region: RegionId): OutpostState | undefined {
  if (!isObj(raw)) return undefined;
  const stage = oneOf(raw.stage, OUTPOST_STAGES, "none");
  const ruined = raw.ruined === true && stage === "none";
  return {
    region, name: cleanName(raw.name), stage, priority: oneOf(raw.priority, PRIORITIES, "trade"), foundedDay: clampI(raw.foundedDay, 0, 9999, 0), stageSince: clampI(raw.stageSince, 0, 9999, 0),
    crates: clampI(raw.crates, 0, 99, 0), supply: clampI(raw.supply, 0, 100, 0), security: clampI(raw.security, 0, 100, 0), trade: clampI(raw.trade, 0, 100, 0), growth: clampI(raw.growth, 0, 100, 0),
    raidedDay: clampI(raw.raidedDay, 0, 9999, 0), ruined, raids: clampI(raw.raids, 0, 9, 0),
  };
}

/** Never throws; rejects wrong version / non-objects / oversized text; clamps every field; an unknown region's post is dropped. */
export function parseSettlements(json: string): SettlementsState | undefined {
  if (typeof json !== "string" || json.length === 0 || json.length > SETTLEMENTS_JSON_MAX) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isObj(raw) || raw.v !== 1) return undefined;
  const posts: SettlementsState["posts"] = {};
  if (isObj(raw.posts)) {
    for (const [k, v] of Object.entries(raw.posts)) {
      if (!isRegionId(k)) continue;
      const p = parsePost(v, k);
      if (p) posts[k] = p;
    }
  }
  const t = isObj(raw.tech) ? raw.tech : {};
  const since = isObj(t.since) ? t.since : {};
  const tech: TechState = {
    road: clampI(t.road, 0, 2, 0) as 0 | 1 | 2, telegraph: t.telegraph === true, launch: t.launch === true,
    since: { road: clampI(since.road, 0, 9999, 0), telegraph: clampI(since.telegraph, 0, 9999, 0), launch: clampI(since.launch, 0, 9999, 0) },
  };
  return { v: 1, posts, tech };
}

/** CANONICAL key order (see serializePowers): equal states are equal bytes. */
export function serializeSettlements(s: SettlementsState): string {
  const posts: Record<string, OutpostState> = {};
  for (const id of REGION_IDS) {
    const p = s.posts[id];
    if (p) posts[id] = { region: p.region, name: p.name, stage: p.stage, priority: p.priority, foundedDay: p.foundedDay, stageSince: p.stageSince, crates: p.crates, supply: p.supply, security: p.security, trade: p.trade, growth: p.growth, raidedDay: p.raidedDay, ruined: p.ruined, raids: p.raids };
  }
  const t = s.tech;
  return JSON.stringify({ v: 1, posts, tech: { road: t.road, telegraph: t.telegraph, launch: t.launch, since: { road: t.since.road, telegraph: t.since.telegraph, launch: t.since.launch } } });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Delivery: the physical act
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** What each kind of thing does at the foundation (deltas; a bottle does nothing and is refused with a line). */
export const DELIVERY: Record<"crate" | "barrel" | "chair", { supply: number; security: number; trade: number; growth: number }> = {
  crate: { supply: 12, security: 0, trade: 0, growth: 0 },
  barrel: { supply: 0, security: 10, trade: 0, growth: 0 },
  chair: { supply: 0, security: 0, trade: 2, growth: 8 },
};
const deliveryKey = (kind: PropKindId): "crate" | "barrel" | "chair" | undefined => (kind === PropKind.CRATE ? "crate" : kind === PropKind.BARREL ? "barrel" : kind === PropKind.CHAIR ? "chair" : undefined);

export function deliverEffect(kind: PropKindId): { supply: number; security: number; trade: number; growth: number } {
  const k = deliveryKey(kind);
  return k ? { ...DELIVERY[k] } : { supply: 0, security: 0, trade: 0, growth: 0 };
}

const pickLine = (list: readonly string[], seed: number, a: number, b: number): string => list[hash3(seed >>> 0, a, b, 0x0d17) % list.length]!;
const fill = (t: string, v: Record<string, string | number>): string => t.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? ""));

const blank = (region: RegionId, name: string, day: number): OutpostState => ({
  region, name, stage: "none", priority: "trade", foundedDay: day, stageSince: day, crates: 0, supply: 0, security: 0, trade: 0, growth: 0, raidedDay: 0, ruined: false, raids: 0,
});

/** Founds the camp of `region`: named from the authored list by hash3 (a refounded ruin takes another name), at its first stage with a little in the store. */
export function foundOutpost(s: SettlementsState, region: RegionId, c: CampaignState, seed: number): SettlementsState {
  const old = s.posts[region];
  const name = OUTPOST_NAMES[hash3(seed >>> 0, c.day, old ? 1 : 0, 0x0a11) % OUTPOST_NAMES.length]!;
  const post: OutpostState = { ...blank(region, name, c.day), stage: "camp", crates: 0, supply: 30, security: 35, trade: 25, growth: 20 };
  return { ...s, posts: { ...s.posts, [region]: post } };
}

export interface Delivery { s: SettlementsState; events: SettlementEvent[]; accepted: boolean; line: string }

/**
 * One prop carried to the foundation. Crates build it (`FOUNDATION_CRATES` of them found a camp, or refound a ruin); once there is a camp a crate is supply, a barrel
 * security (powder for the palisade), a chair growth ("furniture is the vanguard of civilisation"); a bottle is refused with a line. The caller consumes the prop only when `accepted`.
 */
export function deliverTo(s: SettlementsState, region: RegionId, kind: PropKindId, c: CampaignState, seed: number): Delivery {
  const day = c.day;
  const k = deliveryKey(kind);
  const post = s.posts[region];
  if (!k) return { s, events: [], accepted: false, line: pickLine(REFUSED_LINES, seed, day, 1) };
  if (!post || post.stage === "none") {
    if (k !== "crate") return { s, events: [], accepted: false, line: FOUNDATION_ONLY_CRATES };
    const cur = post ?? blank(region, "", day);
    const n = Math.min(FOUNDATION_CRATES, cur.crates + 1);
    if (n < FOUNDATION_CRATES) {
      const next: OutpostState = { ...cur, crates: n, name: cur.name || OUTPOST_NAMES[hash3(seed >>> 0, day, 0x0a11) % OUTPOST_NAMES.length]!, ruined: cur.ruined };
      return { s: { ...s, posts: { ...s.posts, [region]: next } }, events: [], accepted: true, line: fill(pickLine(CRATE_LINES, seed, day, n), { n, of: FOUNDATION_CRATES }) };
    }
    const founded = foundOutpost(s, region, c, seed);
    const name = founded.posts[region]!.name;
    return { s: founded, events: [{ kind: "founded", day, region, stage: "camp", name }], accepted: true, line: fill(pickLine(FOUNDED_LINES, seed, day, 2), { name }) };
  }
  const fx = DELIVERY[k];
  const next: OutpostState = { ...post, supply: pct(post.supply + fx.supply), security: pct(post.security + fx.security), trade: pct(post.trade + fx.trade), growth: pct(post.growth + fx.growth) };
  return {
    s: { ...s, posts: { ...s.posts, [region]: next } }, events: [{ kind: "delivered", day, region, stage: post.stage, name: post.name }], accepted: true,
    line: fill(pickLine(DELIVER_LINES[k], seed, day, post.supply), { name: post.name }),
  };
}

/** The foundation's progress for the prompt: the crates down so far (0..FOUNDATION_CRATES), and whether there is a standing camp. */
export function foundationStatus(s: SettlementsState, region: RegionId): { crates: number; standing: boolean; ruined: boolean } {
  const p = s.posts[region];
  return { crates: p && p.stage === "none" ? p.crates : 0, standing: !!p && p.stage !== "none", ruined: !!p && p.ruined };
}

/** A raid lands (the rival's `raided_outpost` event): the stores are carried off and the watch is shaken; a second raid on a weak outpost is the end of its stage. */
export function raidOutpost(s: SettlementsState, region: RegionId, day: number): { s: SettlementsState; events: SettlementEvent[] } {
  const p = s.posts[region];
  if (!p || p.stage === "none") return { s, events: [] };
  const next: OutpostState = { ...p, supply: pct(p.supply - 30), security: pct(p.security - 15), raidedDay: day, raids: p.security < 30 ? Math.min(9, p.raids + 1) : p.raids };
  return { s: { ...s, posts: { ...s.posts, [region]: next } }, events: [{ kind: "raided", day, region, stage: p.stage, name: p.name }] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Tech: latched thresholds, no menu
// ---------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Emergent and LATCHED: once earned it stays (a ruined camp does not take the road away). Road 1 = a trading post for three days and a Ward that is not hostile; road 2 =
 * a settlement with trade >= 50; telegraph = a road, a settlement, a crossing the Syndicate does not hold and a bridge standing (a ford line needs trade >= 70);
 * launch = a settlement whose priority is transport, or any town. `since` records the campaign day each was first earned.
 */
export function techOf(s: SettlementsState, c: CampaignState, _climate: RegionClimate): TechState {
  const old = s.tech;
  const p = s.posts.kessar;
  let road = old.road, telegraph = old.telegraph, launch = old.launch;
  const since = { ...old.since };
  if (p && p.stage !== "none") {
    const r = rank(p.stage);
    if (road < 1 && r >= rank("trading_post") && c.day - p.stageSince >= 3 && stanceOf(c.factions.ward) !== "hostile") {
      road = 1;
      since.road = c.day;
    }
    if (road < 2 && road >= 1 && r >= rank("settlement") && p.trade >= 50) {
      road = 2;
      since.road = c.day;
    }
    const lineOk = c.crossing.bridge !== "collapsed" || p.trade >= 70;
    if (!telegraph && road >= 1 && r >= rank("settlement") && c.crossing.control !== "rival" && lineOk) {
      telegraph = true;
      since.telegraph = c.day;
    }
    if (!launch && ((r >= rank("settlement") && p.priority === "transport") || p.stage === "town")) {
      launch = true;
      since.launch = c.day;
    }
  }
  return { road: road as 0 | 1 | 2, telegraph, launch, since };
}

/** What the infrastructure changes: the launch's 3 s sailing (undefined = the region's own), +20 kg of capacity per road level, the telegraph's two days of intel. */
export function techEffects(t: TechState): { sailSeconds: number | undefined; capacityKg: number; intelDays: number } {
  return { sailSeconds: t.launch ? Math.max(1, Math.round(SAIL_SECONDS / 2)) : undefined, capacityKg: 20 * t.road, intelDays: t.telegraph ? 2 : 0 };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Daily evolution
// ---------------------------------------------------------------------------------------------------------------------------------------------

function priorityOf(p: OutpostState, climate: RegionClimate, tech: TechState): OutpostPriority {
  const score: Record<OutpostPriority, number> = {
    trade: p.trade, military: p.security, growth: p.growth, extraction: (p.supply + climate.labour) / 2, transport: p.trade * 0.7 + tech.road * 15,
  };
  let best = p.priority;
  for (const k of PRIORITIES) if (score[k] >= score[best] + 10) best = k;   // a priority changes only when another clearly leads
  return best;
}

function holds(p: OutpostState, c: CampaignState): boolean {
  switch (p.stage) {
    case "trading_post": return p.supply >= STAGE_RULES.trading_post.supply - H && p.trade >= STAGE_RULES.trading_post.trade - H;
    case "fortified_outpost": return p.security >= STAGE_RULES.fortified_outpost.security - H && p.supply >= STAGE_RULES.trading_post.supply - H;
    case "settlement": return p.supply >= STAGE_RULES.settlement.supply - H && p.trade >= STAGE_RULES.settlement.trade - H && p.security >= STAGE_RULES.settlement.security - H;
    case "town": return p.supply >= STAGE_RULES.town.supply - H && p.trade >= STAGE_RULES.town.trade - H && c.factions.ward.prosperity >= STAGE_RULES.town.prosperity - H;
    default: return true;
  }
}

function promotion(p: OutpostState, c: CampaignState, climate: RegionClimate, tech: TechState): OutpostStage | undefined {
  const R = STAGE_RULES;
  const toSettlement = p.supply >= R.settlement.supply && p.trade >= R.settlement.trade && p.security >= R.settlement.security && tech.road >= 1;
  switch (p.stage) {
    case "camp": return p.supply >= R.trading_post.supply && p.trade >= R.trading_post.trade ? "trading_post" : undefined;
    case "trading_post":
      if (toSettlement) return "settlement";
      return p.security >= R.fortified_outpost.security && (climate.hostility >= R.fortified_outpost.threat || climate.rivalPressure >= R.fortified_outpost.threat) ? "fortified_outpost" : undefined;
    case "fortified_outpost": return toSettlement ? "settlement" : undefined;
    case "settlement": return p.supply >= R.town.supply && p.trade >= R.town.trade && c.factions.ward.prosperity >= R.town.prosperity && (tech.telegraph || tech.launch) ? "town" : undefined;
    default: return undefined;
  }
}

/**
 * One campaign day for every outpost: supply drains, security and trade move toward what the region's climate and the stage allow, growth follows supply and labour, the
 * priority drifts, then (only once the stage has lasted its `DWELL`) the stage is held, lost or earned. A camp that starves or is raided twice falls and is `ruined` (refounding
 * takes four crates again). Returns the new state and what happened, for the paper and for the powers. Inputs are never mutated.
 */
export function evolveSettlements(s: SettlementsState, c: CampaignState, climate: RegionClimate, day: number): { s: SettlementsState; events: SettlementEvent[] } {
  const events: SettlementEvent[] = [];
  const posts: SettlementsState["posts"] = {};
  let tech = s.tech;
  for (const [k, p0] of Object.entries(s.posts) as [RegionId, OutpostState][]) {
    if (p0.stage === "none") {
      posts[k] = p0;
      continue;
    }
    let p: OutpostState = { ...p0 };
    p.supply = pct(p.supply - SUPPLY_DECAY);
    p.security = toward(p.security, pct(0.7 * climate.security + STAGE_SECURITY[p.stage]), 4);
    p.trade = toward(p.trade, pct(0.8 * climate.trade + STAGE_TRADE[p.stage]), 4);
    p.growth = pct(p.growth + (p.supply >= 40 ? 2 : -2) + Math.round((climate.labour - 50) / 25));
    p.crates = p.supply < STAGE_RULES.starved.supply ? Math.min(99, p.crates + 1) : 0;
    if (day - p.raidedDay > 10 && p.raids > 0 && day % 10 === 0) p.raids -= 1;
    tech = techOf({ ...s, posts: { ...s.posts, [k]: p }, tech }, c, climate);
    p.priority = priorityOf(p, climate, tech);
    if (day - p.stageSince >= DWELL[p.stage as Exclude<OutpostStage, "none">]) {
      const starving = p.crates >= STAGE_RULES.starved.days;
      if (starving || p.raids >= 2 || !holds(p, c)) {
        const lower = rank(p.stage) - 1;
        if (lower < 1) {
          events.push({ kind: "abandoned", day, region: k, stage: "none", name: p.name });
          p = { ...p, stage: "none", ruined: true, crates: 0, supply: 0, security: 0, trade: 0, growth: 0, raids: 0, stageSince: day };
        } else {
          p = { ...p, stage: OUTPOST_STAGES[lower]!, stageSince: day, raids: 0, crates: 0 };
          events.push({ kind: "demoted", day, region: k, stage: p.stage, name: p.name });
        }
      } else {
        const up = promotion(p, c, climate, tech);
        if (up) {
          p = { ...p, stage: up, stageSince: day };
          events.push({ kind: "promoted", day, region: k, stage: up, name: p.name });
        }
      }
    }
    posts[k] = p;
  }
  const kp = posts.kessar;
  if (tech.road > s.tech.road) events.push({ kind: "road", day, region: "kessar", stage: kp?.stage ?? "none", name: kp?.name ?? "" });
  if (tech.telegraph && !s.tech.telegraph) events.push({ kind: "telegraph", day, region: "kessar", stage: kp?.stage ?? "none", name: kp?.name ?? "" });
  if (tech.launch && !s.tech.launch) events.push({ kind: "launch", day, region: "kessar", stage: kp?.stage ?? "none", name: kp?.name ?? "" });
  return { s: { v: 1, posts, tech }, events };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// What the world and the view read
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** What the VIEW draws in `region` (no collision): the outpost, the Syndicate's own post, the road, the poles, the launch. */
export function regionDressOf(s: SettlementsState, rival: Pick<RivalAgent, "posts">, region: RegionId): RegionDress {
  const p = s.posts[region];
  return { outpost: p?.stage ?? "none", rivalPost: region === "kessar" ? rival.posts : 0, road: region === "kessar" ? s.tech.road : 0, telegraph: region === "kessar" && s.tech.telegraph, launch: region === "kessar" && s.tech.launch, name: p?.name ?? "" };
}

/** What the COLLISION world depends on, from the two replicated JSON strings (both sides call this, so they build the same world). Garbage in = the plain world. */
export function regionWorldOpts(campaignJson: string, settlementsJson: string): RegionWorldOpts {
  const c = parseCampaign(campaignJson);
  const s = parseSettlements(settlementsJson);
  const stage = s?.posts.kessar?.stage ?? "none";
  return { bridge: c?.crossing.bridge ?? "intact", outpost: stage, telegraph: stage !== "none" && s?.tech.telegraph === true };
}

/** The world's identity: rebuild the collision world only when this changes. A rigged bridge and an intact one are the same world. */
export function worldKey(o: RegionWorldOpts): string {
  return `${o.bridge === "collapsed" ? "collapsed" : "standing"}|${o.outpost ?? "none"}|${o.telegraph === true ? "wire" : "-"}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The paper
// ---------------------------------------------------------------------------------------------------------------------------------------------

const upper = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** One printed item per event (>= 3 authored variants of every head and body, picked by hash3; `{stage}` reads "a trading post", capitalised at a head's start). */
export function settlementDispatches(_s: SettlementsState, ev: readonly SettlementEvent[], seed: number): PaperItem[] {
  return ev.map((e) => {
    const t = SETTLEMENT_NEWS[e.kind];
    const pick = (list: readonly string[], tag: number): string => list[hash3(seed >>> 0, e.day, tag, e.name.length) % list.length]!;
    const vars = { name: e.name || "the outpost", stage: STAGE_LABEL[e.stage] };
    return { slug: `post-${e.kind}`, head: upper(fill(pick(t.head, 7), vars)), body: upper(fill(pick(t.body, 8), vars)) };
  });
}

/** The events the state itself implies, newest first (the client has no event stream: it reads the paper's dispatches out of the settlements it replicates). */
export function settlementNews(s: SettlementsState): SettlementEvent[] {
  const out: SettlementEvent[] = [];
  const p = s.posts.kessar;
  if (p) {
    if (p.stage !== "none") {
      out.push({ kind: "founded", day: p.foundedDay, region: "kessar", stage: "camp", name: p.name });
      if (rank(p.stage) > 1) out.push({ kind: "promoted", day: p.stageSince, region: "kessar", stage: p.stage, name: p.name });
      if (p.raidedDay > 0) out.push({ kind: "raided", day: p.raidedDay, region: "kessar", stage: p.stage, name: p.name });
    } else if (p.ruined) out.push({ kind: "abandoned", day: p.stageSince, region: "kessar", stage: "none", name: p.name });
  }
  const nm = p?.name ?? "";
  const st = p?.stage ?? "none";
  if (s.tech.since.road > 0) out.push({ kind: "road", day: s.tech.since.road, region: "kessar", stage: st, name: nm });
  if (s.tech.since.telegraph > 0) out.push({ kind: "telegraph", day: s.tech.since.telegraph, region: "kessar", stage: st, name: nm });
  if (s.tech.since.launch > 0) out.push({ kind: "launch", day: s.tech.since.launch, region: "kessar", stage: st, name: nm });
  return out.sort((a, b) => b.day - a.day);
}
