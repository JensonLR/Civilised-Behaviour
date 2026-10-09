import { REGIONS, isRegionId, isValidJoinCode, type RegionId } from "@cb/shared";
import { readStored, writeStored } from "../settings.ts";
import { ALL_DONE } from "./orientationLogic.ts";

/**
 * "Your expeditions": a small record of the campaigns THIS BROWSER has been in, kept in localStorage (`cb.expeditions`) so the front door can offer Continue, a list to resume
 * from, and so the first-run orientation can be remembered PER CAMPAIGN rather than per browser.
 *
 * What it holds is only what the front door needs: the campaign's join code (the server's resume needs the code AND this browser's anonymous identity token, `cb.identity`,
 * which already exists and is NOT copied here), the name used, the last region and day seen, when it was last played, and the orientation progress. No world data, no seed, no
 * member keys, nothing the server does not already show every member. See docs/PRIVACY_DATA_MAP.md.
 *
 * Pure functions over plain arrays (tested as tables, including hostile storage), then three thin storage wrappers. Every read validates; a corrupt, foreign or hostile value is
 * dropped field by field and never throws; every write is guarded because storage can be blocked.
 */

export const EXPEDITIONS_KEY = "cb.expeditions";
export const EXPEDITIONS_VERSION = 1;
/** The oldest are forgotten past this many (the server keeps its own copy for its retention period; this is only the door's list). */
export const MAX_EXPEDITIONS = 12;
const MAX_RAW_CHARS = 32_768;
const NAME_MAX = 20;
const DAY_MAX = 100_000;

export interface OrientProgress {
  /** Bitmask of the orientation steps done (orientationLogic.ts). */
  readonly done: number;
  readonly skipped: boolean;
}

export interface Expedition {
  /** The five-character join code, upper case. The key. */
  readonly code: string;
  /** The name this browser's player used there (what resuming sends; the door's input can override it). */
  readonly name: string;
  readonly region: RegionId;
  /** The campaign's day when last seen (0 when never learned). */
  readonly day: number;
  /** Epoch ms. */
  readonly lastPlayed: number;
  readonly orient?: OrientProgress;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A display name made safe to keep and to show: control characters and angle brackets out (it is only ever set as text), trimmed, capped. */
export const cleanName = (v: unknown): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, NAME_MAX) : "");

function parseOrient(v: unknown): OrientProgress | undefined {
  if (!isObj(v)) return undefined;
  const done = typeof v.done === "number" && Number.isInteger(v.done) && v.done >= 0 && v.done <= ALL_DONE ? v.done : 0;
  const skipped = v.skipped === true;
  return done === 0 && !skipped ? undefined : { done, skipped };
}

function parseOne(v: unknown, now: number): Expedition | undefined {
  if (!isObj(v)) return undefined;
  const code = typeof v.code === "string" ? v.code.toUpperCase() : "";
  if (!isValidJoinCode(code)) return undefined;
  const lp = v.lastPlayed;
  if (typeof lp !== "number" || !Number.isFinite(lp) || lp < 0) return undefined;
  const day = typeof v.day === "number" && Number.isInteger(v.day) && v.day >= 0 && v.day <= DAY_MAX ? v.day : 0;
  const orient = parseOrient(v.orient);
  return {
    code,
    name: cleanName(v.name),
    region: isRegionId(v.region) ? v.region : "hollowmere",
    day,
    lastPlayed: Math.min(lp, now), // (a clock that was wrong once must not pin an entry to the top of the list for ever)
    ...(orient ? { orient } : {}),
  };
}

/** Newest first, one per code (the newest of duplicates), capped. */
function tidy(list: Expedition[]): Expedition[] {
  const seen = new Set<string>();
  const out: Expedition[] = [];
  for (const e of [...list].sort((a, b) => b.lastPlayed - a.lastPlayed)) {
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    out.push(e);
    if (out.length >= MAX_EXPEDITIONS) break;
  }
  return out;
}

/** A stored value, read back. Anything that is not the current version's plain shape is an empty list, and a bad entry in a good list is dropped alone. Never throws. */
export function parseExpeditions(raw: unknown, now: number = Date.now()): Expedition[] {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_CHARS) return [];
  try {
    const j: unknown = JSON.parse(raw);
    if (!isObj(j) || j.v !== EXPEDITIONS_VERSION || !Array.isArray(j.list)) return [];
    const out: Expedition[] = [];
    for (const item of j.list.slice(0, MAX_EXPEDITIONS * 4)) {
      const e = parseOne(item, now);
      if (e) out.push(e);
    }
    return tidy(out);
  } catch {
    return [];
  }
}

export const serializeExpeditions = (list: readonly Expedition[]): string => JSON.stringify({ v: EXPEDITIONS_VERSION, list: tidy([...list]) });

/** Adds or updates one expedition (`lastPlayed` becomes `now`). Pure: returns the new list. */
export function upsertExpedition(list: readonly Expedition[], code: string, patch: { name?: string; region?: string; day?: number; orient?: OrientProgress }, now: number): Expedition[] {
  const c = code.toUpperCase();
  if (!isValidJoinCode(c)) return [...list];
  const old = list.find((e) => e.code === c);
  const name = patch.name !== undefined ? cleanName(patch.name) : old?.name ?? "";
  const region = isRegionId(patch.region) ? patch.region : old?.region ?? "hollowmere";
  const day = patch.day !== undefined && Number.isInteger(patch.day) && patch.day >= 0 && patch.day <= DAY_MAX ? patch.day : old?.day ?? 0;
  const orient = patch.orient ? parseOrient(patch.orient) ?? { done: 0, skipped: false } : old?.orient;
  const next: Expedition = { code: c, name, region, day, lastPlayed: now, ...(orient ? { orient } : {}) };
  return tidy([next, ...list.filter((e) => e.code !== c)]);
}

export const withoutExpedition = (list: readonly Expedition[], code: string): Expedition[] => list.filter((e) => e.code !== code.toUpperCase());

// ---- storage (guarded) ----------------------------------------------------------------------------------------------------------------------

export const listExpeditions = (now: number = Date.now()): Expedition[] => parseExpeditions(readStored(EXPEDITIONS_KEY), now);
const save = (list: readonly Expedition[]): void => writeStored(EXPEDITIONS_KEY, list.length === 0 ? null : serializeExpeditions(list));

/** The one the door's Continue offers: the most recently played. */
export const mostRecentExpedition = (now?: number): Expedition | undefined => listExpeditions(now)[0];

/** Records (or refreshes) an expedition: the code, and whatever of name / region / day the caller knows. Marks it played now. */
export function noteExpedition(code: string, patch: { name?: string; region?: string; day?: number } = {}, now: number = Date.now()): void {
  save(upsertExpedition(listExpeditions(now), code, patch, now));
}

export function forgetExpedition(code: string): void {
  save(withoutExpedition(listExpeditions(), code));
}

/** The orientation progress of ONE campaign (undefined: never started there, so the card shows). */
export const getOrientProgress = (code: string): OrientProgress | undefined => listExpeditions().find((e) => e.code === code.toUpperCase())?.orient;

/**
 * Stores the orientation progress of a campaign that is in the record (a campaign nobody remembered, such as the demo's, has nowhere to keep it: its card simply starts again on a
 * reload). Keeps `lastPlayed` as it was: finishing a step is not the same as playing.
 */
export function setOrientProgress(code: string, orient: OrientProgress, now: number = Date.now()): void {
  const list = listExpeditions(now);
  const old = list.find((e) => e.code === code.toUpperCase());
  if (!old) return;
  save([{ ...old, orient: parseOrient(orient) ?? { done: 0, skipped: false } }, ...list.filter((e) => e.code !== old.code)]);
}

/**
 * D-101: a player who JOINED somebody else's running expedition is not put through the welcome card (the owner: a fresh player gets the tutorial when they start a game, "if they
 * don't join another lobby someone already started"). Marks it skipped for this campaign unless this browser already has progress there; "Replay tutorial" still brings it back.
 */
export function quietOrientationForJoiner(code: string): void {
  if (getOrientProgress(code) === undefined) setOrientProgress(code, { done: 0, skipped: true });
}

/** Forgets the orientation progress of a campaign (the replay): the card starts again from nothing. */
export function clearOrientProgress(code: string): void {
  const list = listExpeditions();
  const old = list.find((e) => e.code === code.toUpperCase());
  if (!old) return;
  const { orient: _orient, ...rest } = old;
  void _orient;
  save(tidy([rest, ...list.filter((e) => e.code !== old.code)]));
}

// ---- words ----------------------------------------------------------------------------------------------------------------------------------

/** "just now", "12 min ago", "3 h ago", "2 days ago", "5 weeks ago". */
export function ageText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} ${d === 1 ? "day" : "days"} ago`;
  return `${Math.floor(d / 7)} weeks ago`;
}

/** The one line under an expedition in the list: "No. K7M2Q · last at Kessar Reach · Day 4 · 3 h ago". */
export function expeditionMeta(e: Expedition, now: number = Date.now()): string {
  const parts = [`No. ${e.code}`, `last at ${REGIONS[e.region].name}`];
  if (e.day > 0) parts.push(`Day ${e.day}`);
  parts.push(ageText(now - e.lastPlayed));
  return parts.join(" · ");
}
