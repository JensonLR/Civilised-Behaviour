import type { ResolutionId } from "./campaignTypes.ts";
import { pluck } from "./regionEndings.ts";
import { ENGINE_ENDINGS } from "./engineLedger.ts";
import { RAID_ENDINGS } from "./raidLedger.ts";
import { SIEGE_ENDINGS } from "./siegeLedger.ts";
import { HUNT_ENDINGS } from "./huntLedger.ts";
import { REAPERS_ENDINGS } from "./reapersLedger.ts";
import { SALTMARKET_ENDINGS } from "./saltmarketLedger.ts";
import { VESPER_ENDINGS } from "./vesperLedger.ts";
import { PAIR_KEYS, POWER_IDS, type PairKey, type PairState, type PowerEvent, type PowerId, type PowersState } from "./worldTypes.ts";

/**
 * The relation matrix between the five powers (D-035): ten pairs, each -100..100, drifting toward an authored base and moved by ONE table over the 20 resolutions.
 * `RELATION_FX` is `Record<ResolutionId, ...>`, so adding a resolution without deciding what it does to the map of grudges is a compile error.
 */

export type RelVec = Record<PairKey, number>;

/** Where each pair settles when left alone. Ward and Syndicate are cold; the Houses dislike everyone who is not paying; the Reapers and the Guild cannot abide each other. */
export const REL_BASE: Readonly<RelVec> = {
  "ward|rival": -30, "ward|brine": -25, "ward|reapers": 15, "ward|choir": 10, "rival|brine": -35, "rival|reapers": -10, "rival|choir": 5, "brine|reapers": -15, "brine|choir": 20, "reapers|choir": -20,
};

export const pairKey = (a: PowerId, b: PowerId): PairKey | undefined => {
  const i = POWER_IDS.indexOf(a), j = POWER_IDS.indexOf(b);
  if (i < 0 || j < 0 || i === j) return undefined;
  return (i < j ? `${a}|${b}` : `${b}|${a}`) as PairKey;
};
export const pairEnds = (k: PairKey): [PowerId, PowerId] => {
  const [a, b] = k.split("|");
  return [a as PowerId, b as PowerId];
};

/** What each ending does to the powers' opinion of one another (before the day's drift). Every entry nudges a different shape of the map, so no two endings read alike. */
export const RELATION_FX: Record<ResolutionId, Partial<Record<PairKey, number>>> = {
  ...pluck(VESPER_ENDINGS, "relations"), ...pluck(SALTMARKET_ENDINGS, "relations"), ...pluck(REAPERS_ENDINGS, "relations"), ...pluck(ENGINE_ENDINGS, "relations"), ...pluck(RAID_ENDINGS, "relations"), ...pluck(HUNT_ENDINGS, "relations"), ...pluck(SIEGE_ENDINGS, "relations"),   // D-037 (regionEndings.ts)
  // the crossing
  paid:            { "ward|rival": -2, "ward|brine": 2, "ward|choir": 2 },
  bargained:       { "ward|rival": -3, "ward|reapers": 3, "ward|brine": -2, "reapers|choir": 2 },
  bribed:          { "ward|choir": -4, "rival|choir": 3, "brine|choir": 3, "ward|brine": -2 },
  forced:          { "ward|rival": 6, "ward|brine": -6, "ward|reapers": -8, "ward|choir": -6, "brine|reapers": 3 },
  sabotaged:       { "ward|brine": -8, "rival|brine": 4, "ward|rival": -5, "brine|choir": -3, "reapers|choir": 4 },
  rival_secured:   { "ward|rival": -12, "rival|brine": 6, "rival|reapers": -4, "ward|choir": 3 },
  abandoned:       { "ward|rival": -2, "brine|reapers": -2 },
  // the cage
  ransomed:        { "rival|reapers": -4, "ward|reapers": 2, "rival|brine": 2 },
  rescued:         { "ward|rival": -6, "rival|reapers": -6, "ward|reapers": 4, "reapers|choir": -3 },
  slipped_away:    { "ward|reapers": 5, "ward|choir": 3, "ward|rival": 2 },
  hostage_lost:    { "rival|choir": 5, "ward|reapers": -4, "reapers|choir": -4 },
  // the wagon
  seized:          { "rival|brine": -8, "ward|rival": -4, "brine|choir": 3, "rival|reapers": -2 },
  tipped_off:      { "ward|rival": -6, "ward|brine": 3, "rival|brine": -3, "ward|choir": 2 },
  burned:          { "rival|brine": -6, "rival|reapers": -6, "brine|reapers": 3, "rival|choir": -3 },
  passed:          { "ward|rival": 3, "rival|brine": 5, "ward|brine": -3, "rival|choir": 2 },
  // the marker stone
  mediated:        { "ward|rival": 6, "ward|choir": 3, "rival|choir": 3, "brine|reapers": 2 },
  sided_ward:      { "ward|rival": -8, "ward|brine": 4, "ward|reapers": 3, "rival|reapers": -3 },
  sided_syndicate: { "ward|rival": -10, "rival|brine": 4, "rival|choir": 3, "ward|reapers": -4 },
  provoked:        { "ward|rival": -12, "ward|brine": -4, "rival|brine": -4, "brine|choir": 4 },
  escalated:       { "ward|rival": -6, "ward|brine": -6, "rival|brine": -6, "ward|reapers": -6, "rival|reapers": -6 },
  // the chair at Highmark (D-036). The Reapers' Assembly ratifies, the Guild certifies the King's death (and bills for it), the Houses want the concession. The story is carried by reapers|choir and
  // reapers|brine; no two endings read alike (each differs from every other in at least two pairs).
  backed_elder:    { "reapers|choir": -6, "brine|reapers": 3, "ward|reapers": 2, "brine|choir": 2 },
  backed_younger:  { "reapers|choir": -4, "brine|reapers": -5, "rival|reapers": 2, "ward|choir": -2 },
  regency:         { "reapers|choir": 3, "brine|reapers": 4, "brine|choir": 3, "ward|reapers": 4 },
  usurped:         { "reapers|choir": -10, "brine|reapers": -6, "ward|choir": -3, "rival|reapers": -4, "ward|rival": 3 },
  crown_sold:      { "reapers|choir": 2, "brine|reapers": -3, "rival|brine": -10, "rival|reapers": -8, "ward|rival": 4 },
};

export const clampRel = (v: number): number => Math.min(100, Math.max(-100, Math.round(v)));

/** A pair's state: feud only with both sides able to fight (military >= 40), otherwise it stays cold. */
export function pairState(rel: number, milA: number, milB: number): PairState {
  if (rel <= -60 && milA >= 40 && milB >= 40) return "feud";
  if (rel < -20) return "cold";
  if (rel >= 60) return "pact";
  if (rel >= 30) return "trade";
  return "civil";
}

/** One day of drift: every pair moves one step toward its base. Pure; returns a fresh record. */
export function driftRel(rel: Readonly<RelVec>): RelVec {
  const out = {} as RelVec;
  for (const k of PAIR_KEYS) {
    const v = rel[k], b = REL_BASE[k];
    out[k] = v === b ? v : v < b ? Math.min(b, v + 1) : Math.max(b, v - 1);
  }
  return out;
}

/** The map after an ending: drift one day, then the ending's own nudges. */
export function applyRelationFx(rel: Readonly<RelVec>, resolution: ResolutionId): RelVec {
  const out = driftRel(rel);
  const fx = RELATION_FX[resolution];
  for (const k of PAIR_KEYS) {
    const d = fx[k];
    if (d) out[k] = clampRel(out[k] + d);
  }
  return out;
}

// ---- small helpers shared by powers.ts and rival.ts (kept here so neither imports the other) ----
export const LOG_CAP = 6, FLAG_CAP = 12;
export const hasFlag = (p: Pick<PowersState, "flags">, f: string): boolean => p.flags.includes(f);
export const withFlag = (flags: readonly string[], f: string): string[] => (flags.includes(f) ? [...flags] : [...flags, f].slice(-FLAG_CAP));
export const withoutFlag = (flags: readonly string[], f: string): string[] => flags.filter((x) => x !== f);
/** Newest last, capped; the paper prints the newest first. */
export const withLog = (log: readonly PowerEvent[], ev: PowerEvent): PowerEvent[] => [...log, ev].slice(-LOG_CAP);
/** A copy that shares nothing mutable with `p` (pure rules clone, mutate the clone, return it). */
export const cloneState = (p: PowersState): PowersState => ({
  v: 1, minor: { brine: { ...p.minor.brine, refusals: [...p.minor.brine.refusals] }, reapers: { ...p.minor.reapers, refusals: [...p.minor.reapers.refusals] }, choir: { ...p.minor.choir, refusals: [...p.minor.choir.refusals] } },
  rel: { ...p.rel }, rival: { ...p.rival, where: { ...p.rival.where } }, flags: [...p.flags], log: p.log.map((e) => ({ ...e })),
});
