import type {
  BridgeState, CampaignState, CasualtyTally, CrossingControl, CrossingState, FactionId, FactionState, HistoryEntry, Leverage, NeedId,
  RegionId, ResolutionId, ScenarioOutcome, FactionStance,
} from "./campaignTypes.ts";
import { isRegionId } from "./campaignTypes.ts";
import { hash3 } from "./rng.ts";

/**
 * Factions and the campaign ledger. Pure and deterministic: no Math.random/Date.now; every roll is hash3(seed, ...).
 * The campaign is server-owned; this file is the ONE rules table that turns a finished scenario into lasting consequences
 * (applyOutcome) and the one place that decides what the Ward will ask (askingToll) and what it remembers (wardMemory).
 *
 * Everything local is fictional. The satire is aimed at institutions (tolls, forms, "improvement"), never at a people.
 */

export const STANCES: readonly FactionStance[] = ["hostile", "wary", "neutral", "warm", "allied"];
export const NEEDS: readonly NeedId[] = ["coin", "arms", "medicine", "deference"];
export const RESOLUTIONS: readonly ResolutionId[] = ["paid", "bargained", "bribed", "forced", "sabotaged", "rival_secured", "abandoned"];
const BRIDGES: readonly BridgeState[] = ["intact", "rigged", "collapsed"];
const CONTROLS: readonly CrossingControl[] = ["ward", "society", "rival", "contested"];
const FACTION_IDS: readonly FactionId[] = ["ward", "rival"];
const TALLY_KEYS: readonly (keyof CasualtyTally)[] = ["wounded", "downed", "limbsLost", "garrisonKilled", "garrisonRouted", "civiliansHarmed", "rivalKilled"];

export const HISTORY_CAP = 12;
export const TOLL_MIN = 25;
export const TOLL_MAX = 90;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The local powers. Four sketched; the Ward of the Nine Lamps is authored in full below.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface Temperament { pride: number; greed: number; caution: number; humour: number }   // 0..100

export interface LocalPower {
  id: string; name: string; seat: string; region: RegionId | null; motto: string; blurb: string;
  temperament: Temperament; need: NeedId; rivals: readonly string[];
}

export const POWERS: readonly LocalPower[] = [
  {
    id: "ward", name: "Ward of the Nine Lamps", seat: "Kessar Hill Fort", region: "kessar", motto: "Nine lamps, no shadows, several invoices.",
    blurb: "Keepers of the only bridge for forty miles. Nine lamps are lit on the wall every dusk; eight are for show, one is for the tax.",
    temperament: { pride: 72, greed: 55, caution: 62, humour: 38 }, need: "coin", rivals: ["rival", "brine"],
  },
  {
    id: "brine", name: "Brine Houses of Ossuary Bay", seat: "Saltmarket Quay", region: null, motto: "The tide is ours; you are renting it.",
    blurb: "Seven salt-trading families who own the tides by deed and charge visitors for the weather. They bury their disputes at sea, usually with the disputant.",
    temperament: { pride: 55, greed: 85, caution: 40, humour: 60 }, need: "arms", rivals: ["ward", "rival"],
  },
  {
    id: "reapers", name: "Thornfield Reapers' Compact", seat: "Thornfield Granges", region: null, motto: "Harvest first. Grievances can be threshed later.",
    blurb: "A farming co-operative with a scythe-militia and a strike fund. Polite until the barley is in, then astonishing.",
    temperament: { pride: 35, greed: 30, caution: 70, humour: 65 }, need: "medicine", rivals: ["choir", "brine"],
  },
  {
    id: "choir", name: "Low Vesper Lamentation Guild", seat: "The Long Cloister, Low Vesper", region: null, motto: "Grief, professionally handled, at competitive rates.",
    blurb: "Hired mourners who run every funeral, cemetery and rumour in the lowlands. They bill per corpse and have a vested interest in your expedition.",
    temperament: { pride: 80, greed: 60, caution: 35, humour: 75 }, need: "deference", rivals: ["reapers", "ward"],
  },
];

/** The Ward's leader: fully authored. She runs the toll bar herself because nobody else can be trusted with the arithmetic. */
export const WARD = {
  leader: { name: "Ysolde Hask", title: "Lamp-Warden", speaker: "Lamp-Warden Ysolde Hask" },
  temperament: { pride: 72, greed: 55, caution: 62, humour: 38 } satisfies Temperament,
  /** Price list: a stance-and-need adjusted toll in pounds. The 40 is what she considers "a courtesy". */
  price: { base: 40, floor: TOLL_MIN, ceiling: TOLL_MAX, bribeShare: 0.5 },
  likes: ["receipts", "being asked first", "a proper salute", "tea that arrives hot"],
  dislikes: ["surprises", "shortcuts across her bridge", "anyone who says 'improvement'"],
  /** What each need sounds like in her mouth. Shown in the parley and the paper. */
  needs: {
    coin: "The Ward's coffers have a draught in them.",
    arms: "The Ward's armoury is mostly enthusiasm and one good pike.",
    medicine: "The Ward's infirmary is out of lint, and out of patience.",
    deference: "The Ward has not been saluted properly since the Society arrived, and it has noticed.",
  } satisfies Record<NeedId, string>,
  /** Who she cannot stand, and why. The Syndicate undercuts her tolls; the Brine Houses sell her salt at weather prices. */
  rivalries: [
    { id: "rival", why: "The Dunmarrow-Vesk Syndicate keeps offering to 'streamline' the crossing, which means owning it." },
    { id: "brine", why: "The Brine Houses charge her for the rain that falls on her own wall." },
  ],
} as const;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Construction, parsing, serialising
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** Clamp to an integer in [lo, hi]; anything non-numeric or non-finite becomes `dflt` (itself clamped). */
export function clampI(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
const pct = (v: unknown, dflt: number): number => clampI(v, 0, 100, dflt);

const zeroTally = (): CasualtyTally => ({ wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 });

function defaultFaction(id: FactionId): FactionState {
  return id === "ward"
    ? { id, trust: 35, fear: 10, grievance: 15, playerInfluence: 10, rivalInfluence: 30, militaryStrength: 55, prosperity: 50, need: "coin" }
    : { id, trust: 10, fear: 0, grievance: 0, playerInfluence: 20, rivalInfluence: 30, militaryStrength: 45, prosperity: 60, need: "coin" };
}

export function newCampaign(seed: number): CampaignState {
  return {
    v: 1, seed: seed >>> 0, day: 1, expeditions: 0, purse: 120, lies: 0,
    factions: { ward: defaultFaction("ward"), rival: defaultFaction("rival") },
    crossing: { bridge: "intact", control: "ward", toll: 0, tollPaidTotal: 0, bribed: false, exposed: false },
    tally: zeroTally(), history: [],
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : dflt);

function parseFaction(raw: unknown, id: FactionId): FactionState {
  const d = defaultFaction(id);
  const r = isObj(raw) ? raw : {};
  return {
    id, trust: pct(r.trust, d.trust), fear: pct(r.fear, d.fear), grievance: pct(r.grievance, d.grievance), playerInfluence: pct(r.playerInfluence, d.playerInfluence),
    rivalInfluence: pct(r.rivalInfluence, d.rivalInfluence), militaryStrength: pct(r.militaryStrength, d.militaryStrength), prosperity: pct(r.prosperity, d.prosperity),
    need: oneOf(r.need, NEEDS, d.need),
  };
}

/** Hostile-safe: never throws, rejects wrong version / non-objects / oversized text, clamps every field to a sane integer range. */
export function parseCampaign(json: string): CampaignState | undefined {
  if (typeof json !== "string" || json.length === 0 || json.length > 8192) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return undefined; }
  if (!isObj(raw) || raw.v !== 1) return undefined;
  const f = isObj(raw.factions) ? raw.factions : {};
  const cr = isObj(raw.crossing) ? raw.crossing : {};
  const ta = isObj(raw.tally) ? raw.tally : {};
  const tally = zeroTally();
  for (const k of TALLY_KEYS) tally[k] = clampI(ta[k], 0, 9999, 0);
  const history: HistoryEntry[] = [];
  if (Array.isArray(raw.history)) {
    for (const h of raw.history.slice(-HISTORY_CAP)) {
      if (!isObj(h) || !isRegionId(h.region)) continue;
      history.push({ seq: clampI(h.seq, 0, 9999, 0), region: h.region, resolution: oneOf(h.resolution, RESOLUTIONS, "abandoned"), day: clampI(h.day, 1, 9999, 1) });
    }
  }
  return {
    v: 1, seed: clampI(raw.seed, 0, 4294967295, 0), day: clampI(raw.day, 1, 9999, 1), expeditions: clampI(raw.expeditions, 0, 9999, 0),
    purse: clampI(raw.purse, 0, 99999, 0), lies: clampI(raw.lies, 0, 99, 0),
    factions: { ward: parseFaction(f.ward, "ward"), rival: parseFaction(f.rival, "rival") },
    crossing: {
      bridge: oneOf(cr.bridge, BRIDGES, "intact"), control: oneOf(cr.control, CONTROLS, "ward"), toll: clampI(cr.toll, 0, 200, 0),
      tollPaidTotal: clampI(cr.tollPaidTotal, 0, 99999, 0), bribed: cr.bribed === true, exposed: cr.exposed === true,
    },
    tally, history,
  };
}

/** Fixed key order, so equal campaigns serialise to equal text. Well under the 4 KB wire budget (12 history entries ~ 0.7 KB). */
export function serializeCampaign(c: CampaignState): string {
  return JSON.stringify(c);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Relation sim: stance, asking price, memory
// ---------------------------------------------------------------------------------------------------------------------------------------------

/**
 * score = trust - grievance + 0.5 * fear (fear buys deference, not affection).
 * Cut points: < -10 hostile, < 10 wary, < 30 neutral, < 55 warm, otherwise allied. A fresh campaign scores 25: neutral.
 */
export function stanceOf(f: FactionState): FactionStance {
  const s = f.trust - f.grievance + 0.5 * f.fear;
  return s < -10 ? "hostile" : s < 10 ? "wary" : s < 30 ? "neutral" : s < 55 ? "warm" : "allied";
}

const STANCE_TOLL: Record<FactionStance, number> = { hostile: 25, wary: 10, neutral: 0, warm: -8, allied: -18 };
const NEED_TOLL: Record<NeedId, number> = { coin: 8, arms: 4, medicine: 0, deference: 0 };

/** Integer pounds 25..90: 40 base + need + (prosperity-50)/5 + 0.15*rivalInfluence (the Syndicate bids the crossing up) + stance. */
export function askingToll(c: CampaignState): number {
  const f = c.factions.ward;
  const raw = WARD.price.base + NEED_TOLL[f.need] + (f.prosperity - 50) * 0.2 + f.rivalInfluence * 0.15 + STANCE_TOLL[stanceOf(f)];
  return Math.min(TOLL_MAX, Math.max(TOLL_MIN, Math.round(raw)));
}

/** What each past resolution left in the Ward's memory (before decay). */
const MEMORY: Record<ResolutionId, { gratitude: number; resentment: number; contempt: number }> = {
  paid: { gratitude: 20, resentment: 0, contempt: 5 },
  bargained: { gratitude: 12, resentment: 0, contempt: 0 },
  bribed: { gratitude: 0, resentment: 10, contempt: 30 },
  forced: { gratitude: 0, resentment: 50, contempt: 10 },
  sabotaged: { gratitude: 0, resentment: 35, contempt: 15 },
  rival_secured: { gratitude: 0, resentment: 10, contempt: 25 },
  abandoned: { gratitude: 0, resentment: 10, contempt: 15 },
};
const MEMORY_DECAY = 0.6;

export interface WardMemory { gratitude: number; resentment: number; contempt: number; last: ResolutionId | undefined; repeat: number }

/** She forgets on a schedule: each expedition back weighs 0.6x the one after it. Broken promises (lies) feed contempt and never decay. */
export function wardMemory(c: CampaignState): WardMemory {
  let g = 0, r = 0, k = 0, w = 1;
  for (let i = c.history.length - 1; i >= 0; i--) {
    const m = MEMORY[c.history[i]!.resolution];
    g += m.gratitude * w; r += m.resentment * w; k += m.contempt * w;
    w *= MEMORY_DECAY;
  }
  const last = c.history.length ? c.history[c.history.length - 1]!.resolution : undefined;
  let repeat = 0;
  for (let i = c.history.length - 1; i >= 0 && c.history[i]!.resolution === last; i--) repeat++;
  const lim = (v: number): number => Math.min(100, Math.round(v));
  return { gratitude: lim(g), resentment: lim(r), contempt: lim(k + c.lies * 4), last, repeat };
}

export function leverageOf(c: CampaignState, live: { armed: number; garrisonAlive: number; garrisonTotal: number; partyWounded: number }): Leverage {
  const n = (v: number, hi: number): number => clampI(v, 0, hi, 0);
  return {
    purse: c.purse, armed: n(live.armed, 16), garrisonAlive: n(live.garrisonAlive, 64), garrisonTotal: n(live.garrisonTotal, 64),
    partyWounded: n(live.partyWounded, 16), rivalInfluence: c.factions.ward.rivalInfluence, lies: c.lies,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// applyOutcome: the one rules table
// ---------------------------------------------------------------------------------------------------------------------------------------------

type WardDelta = { trust: number; fear: number; grievance: number; prosperity: number; playerInfluence: number; rivalInfluence: number };
interface Rule { control: CrossingControl | undefined; toll: "asked" | "paid" | "zero" | "rival"; ward: WardDelta; need: NeedId; lies: number; rivalProsperity: number; rivalGrievance: number }

const RULES: Record<ResolutionId, Rule> = {
  //                                                     trust fear grievance prosperity playerInf rivalInf
  paid:          { control: "ward",      toll: "asked", ward: { trust: 8,   fear: -3, grievance: -4, prosperity: 6,   playerInfluence: 5,  rivalInfluence: -2 }, need: "arms",      lies: 0, rivalProsperity: 0, rivalGrievance: 0 },
  bargained:     { control: "ward",      toll: "paid",  ward: { trust: 12,  fear: -3, grievance: -8, prosperity: 3,   playerInfluence: 8,  rivalInfluence: -4 }, need: "coin",      lies: 0, rivalProsperity: 0, rivalGrievance: 0 },
  bribed:        { control: "ward",      toll: "zero",  ward: { trust: -2,  fear: 0,  grievance: 0,  prosperity: 0,   playerInfluence: 3,  rivalInfluence: 2 },  need: "deference", lies: 1, rivalProsperity: 0, rivalGrievance: 0 },
  forced:        { control: "society",   toll: "zero",  ward: { trust: -15, fear: 20, grievance: 25, prosperity: -4,  playerInfluence: 0,  rivalInfluence: 4 },  need: "medicine",  lies: 0, rivalProsperity: 2, rivalGrievance: 0 },
  sabotaged:     { control: "contested", toll: "zero",  ward: { trust: -10, fear: 5,  grievance: 15, prosperity: -12, playerInfluence: -8, rivalInfluence: 10 }, need: "coin",      lies: 0, rivalProsperity: 5, rivalGrievance: 0 },
  rival_secured: { control: "rival",     toll: "rival", ward: { trust: -4,  fear: 0,  grievance: 4,  prosperity: -2,  playerInfluence: -10, rivalInfluence: 18 }, need: "deference", lies: 0, rivalProsperity: 8, rivalGrievance: -5 },
  abandoned:     { control: undefined,   toll: "asked", ward: { trust: 0,   fear: 0,  grievance: 8,  prosperity: 0,   playerInfluence: -3, rivalInfluence: 4 },  need: "deference", lies: 0, rivalProsperity: 0, rivalGrievance: 0 },
};

/** Needs from each resolution are applied to whatever the Ward lacked next; "abandoned" leaves the standing toll and control alone. */
export function applyOutcome(c: CampaignState, o: ScenarioOutcome): CampaignState {
  const rule = RULES[o.resolution];
  const w0 = c.factions.ward, r0 = c.factions.rival;
  const t = o.tally;
  const add = (base: number, d: number): number => clampI(base + d, 0, 100, base);

  // A bribe from an earlier run comes out now, if it was destined to (decided when it was paid): the Ward's memory of being made a fool.
  const lands = c.crossing.bribed && c.crossing.exposed;
  const lateGrievance = lands ? 20 : 0, lateTrust = lands ? -10 : 0;

  // One day of drift (fear cools, grudges soften slightly), then the outcome, then what the dead and the crowd cost her.
  const civ = Math.min(5, t.civiliansHarmed);
  const ward: FactionState = {
    ...w0,
    trust: add(w0.trust, rule.ward.trust + lateTrust - (o.brokePromise ? 10 : 0)),
    fear: add(w0.fear, rule.ward.fear - 2 + Math.min(10, t.limbsLost * 2)),
    grievance: add(w0.grievance, rule.ward.grievance - 1 + lateGrievance + civ * 3),
    prosperity: add(w0.prosperity, rule.ward.prosperity - civ * 2),
    playerInfluence: add(w0.playerInfluence, rule.ward.playerInfluence),
    rivalInfluence: add(w0.rivalInfluence, rule.ward.rivalInfluence),
    militaryStrength: add(w0.militaryStrength, -6 * t.garrisonKilled - 2 * t.garrisonRouted),
    need: rule.need,
  };
  const rival: FactionState = {
    ...r0,
    rivalInfluence: ward.rivalInfluence,
    prosperity: add(r0.prosperity, rule.rivalProsperity),
    grievance: add(r0.grievance, rule.rivalGrievance),
    militaryStrength: add(r0.militaryStrength, -6 * t.rivalKilled),
  };

  const bridge: BridgeState = o.resolution === "sabotaged" || c.crossing.bridge === "collapsed" ? "collapsed" : o.bridge;
  const toll = rule.toll === "asked" ? (o.resolution === "abandoned" ? c.crossing.toll : clampI(o.toll, 0, 200, 0))
    : rule.toll === "paid" ? clampI(o.paid, 0, 200, 0)
    : rule.toll === "rival" ? clampI(o.toll + 15, 0, 200, 0) : 0;
  const paid = clampI(o.paid, 0, c.purse, 0);

  let bribed = false, exposed = false;
  if (lands) exposed = true;   // the scandal has landed (bribed now false): the paper may say so once; a bribe that never surfaces is forgotten
  if (o.resolution === "bribed") {
    bribed = true;
    exposed = ward.rivalInfluence >= 50 || hash3(c.seed, c.expeditions, c.day, 77) / 4294967296 < 0.5;
  }
  const crossing: CrossingState = {
    bridge, control: rule.control ?? c.crossing.control, toll, tollPaidTotal: clampI(c.crossing.tollPaidTotal + paid, 0, 99999, 0), bribed, exposed,
  };

  const tally = zeroTally();
  for (const k of TALLY_KEYS) tally[k] = clampI(c.tally[k] + clampI(t[k], 0, 999, 0), 0, 9999, 0);

  const history = c.history.concat({ seq: c.expeditions + 1, region: "kessar", resolution: o.resolution, day: c.day + 1 });
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);

  return {
    ...c,
    day: clampI(c.day + 1, 1, 9999, 1), expeditions: clampI(c.expeditions + 1, 0, 9999, 0), purse: c.purse - paid,
    lies: clampI(c.lies + rule.lies + (o.brokePromise ? 1 : 0), 0, 99, 0),
    factions: { ward, rival }, crossing, tally, history,
  };
}

const CONTROL_TEXT: Record<CrossingControl, string> = {
  ward: "The Ward holds the crossing.", society: "The Society holds the crossing, which the Ward will remember.",
  rival: "The Syndicate holds the crossing and has put up a sign about it.", contested: "Nobody holds the crossing; there is nothing left to hold.",
};

/** Plain lines for the debrief card: what changed between two campaign states. Terse, factual, a little sour. */
export function consequenceLines(before: CampaignState, after: CampaignState): string[] {
  const out: string[] = [];
  const s0 = stanceOf(before.factions.ward), s1 = stanceOf(after.factions.ward);
  if (s0 !== s1) out.push(`The Ward now regards you as ${s1} (was ${s0}).`);
  if (after.crossing.control !== before.crossing.control) out.push(CONTROL_TEXT[after.crossing.control]);
  if (after.crossing.bridge !== before.crossing.bridge) out.push(`The bridge is ${after.crossing.bridge}.`);
  if (after.crossing.toll !== before.crossing.toll) out.push(after.crossing.toll ? `The crossing toll stands at £${after.crossing.toll}.` : "The crossing toll is waived, for now.");
  if (after.purse !== before.purse) out.push(`The purse is £${after.purse} (${after.purse - before.purse >= 0 ? "+" : "-"}£${Math.abs(after.purse - before.purse)}).`);
  if (after.crossing.bribed && after.crossing.exposed) out.push("The quartermaster's new boots are being discussed in the wrong places.");
  if (!after.crossing.bribed && after.crossing.exposed && before.crossing.bribed) out.push("The bribe has surfaced. The Lamp-Warden has read the receipts you did not ask for.");
  const dm = before.factions.ward.militaryStrength - after.factions.ward.militaryStrength;
  if (dm > 0) out.push(`The Ward's garrison is weaker by ${dm}.`);
  if (after.factions.ward.need !== before.factions.ward.need) out.push(WARD.needs[after.factions.ward.need]);
  return out;
}
