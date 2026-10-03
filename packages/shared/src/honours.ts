import type { ResolutionId, ScenarioOutcome } from "./campaignTypes.ts";

/**
 * HONOURS (D-055): the Society decorates its members. Every contract, each member who was there earns at most one honour, from what THEY did (not the party's tally):
 * the foes they put down, the comrades they got up, the kegs they lit, the kindness they did on the road, how often they were carried home. The latest honour is their
 * title (`PlayerState.title`, on their name plate), and the campaign keeps each member's last three (a saved section keyed by the member's HMAC key, the same key the
 * membership list holds; titles are ids from this file, never free text). It is the GDD's "characters carry history", cheaply: a name that means something after a week.
 */
export type HonourId = "terror" | "crack_shot" | "bandager" | "friend_of_the_road" | "powder_monkey" | "peacemaker" | "twice_mended" | "sturdy";
/** Highest first: a member gets the first one they qualify for. */
export const HONOUR_IDS: readonly HonourId[] = ["terror", "crack_shot", "bandager", "friend_of_the_road", "powder_monkey", "peacemaker", "twice_mended", "sturdy"];

/** What one member did in one contract run (counted by the server as it happens). */
export interface Deeds {
  /** Enemies they put down. */
  foesDowned: number;
  /** Revives and dressings they finished on somebody else. */
  helped: number;
  /** Times they went down themselves. */
  downed: number;
  /** Kegs they lit (D-054). */
  kegs: number;
  /** Incidents they settled kindly (a traveller up, a dispatch taken, a deserter signed, a horse caught: D-052). */
  kindness: number;
}
export const newDeeds = (): Deeds => ({ foesDowned: 0, helped: 0, downed: 0, kegs: 0, kindness: 0 });

/** Endings that were a deal rather than a fight. */
const DEALS: ReadonlySet<ResolutionId> = new Set<ResolutionId>(["paid", "bargained", "bribed", "ransomed", "mediated"]);

/** The honour these deeds earn in a contract that ended so (undefined: none; most members earn one when anything happened at all). Pure. */
export function awardHonour(d: Deeds, o: Pick<ScenarioOutcome, "resolution">): HonourId | undefined {
  if (d.foesDowned >= 6) return "terror";
  if (d.foesDowned >= 3) return "crack_shot";
  if (d.helped >= 2) return "bandager";
  if (d.kindness >= 1) return "friend_of_the_road";
  if (d.kegs >= 1) return "powder_monkey";
  if (DEALS.has(o.resolution) && d.foesDowned === 0) return "peacemaker";
  if (d.downed >= 2) return "twice_mended";
  if (d.downed === 1) return "sturdy";
  return undefined;
}

/** The title as it is worn ("Sir Reginald Blunt, Bandager-in-Ordinary"). */
export const HONOUR_TITLE: Readonly<Record<HonourId, string>> = {
  terror: "Terror of the Ledger",
  crack_shot: "Crack Shot (Self-Certified)",
  bandager: "Bandager-in-Ordinary",
  friend_of_the_road: "Friend of the Road",
  powder_monkey: "Powder Monkey, First Class",
  peacemaker: "Peacemaker, by Purchase",
  twice_mended: "Twice Mended",
  sturdy: "Sturdy Specimen",
};

/** Every member's honours, newest first (at most `HONOURS_KEPT` each). Keyed by the member's HMAC key (persistence/identity.ts), never an identity. */
export interface HonoursState { v: 1; by: Record<string, HonourId[]> }
export const HONOURS_KEPT = 3;
/** As many members as a campaign record holds (persistence MAX_MEMBERS), with room for the owner. */
const MAX_KEYS = 9;
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const newHonours = (): HonoursState => ({ v: 1, by: {} });

/** A member is decorated: the new honour first, the oldest falls off. Pure (the input is untouched). */
export function decorate(h: HonoursState, key: string, honour: HonourId): HonoursState {
  if (!KEY_RE.test(key)) return h;
  const by = { ...h.by, [key]: [honour, ...(h.by[key] ?? [])].slice(0, HONOURS_KEPT) };
  const keys = Object.keys(by);
  if (keys.length > MAX_KEYS) delete by[keys.find((k) => k !== key)!];
  return { v: 1, by };
}

/** The title a member wears now ("" when undecorated). */
export const titleOf = (h: HonoursState, key: string | undefined): string => {
  const first = key ? h.by[key]?.[0] : undefined;
  return first ? HONOUR_TITLE[first] : "";
};

/** Hostile-safe: wrong version, bad keys, unknown honours and overlong lists are dropped; undefined when it is not an honours section at all. Never throws. */
export function parseHonours(json: string): HonoursState | undefined {
  if (typeof json !== "string" || json.length > 4096) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || (raw as { v?: unknown }).v !== 1) return undefined;
  const src = (raw as { by?: unknown }).by;
  const out = newHonours();
  if (typeof src !== "object" || src === null) return out;
  for (const [k, v] of Object.entries(src as Record<string, unknown>).slice(0, MAX_KEYS)) {
    if (!KEY_RE.test(k) || !Array.isArray(v)) continue;
    const list = v.filter((x): x is HonourId => HONOUR_IDS.includes(x as HonourId)).slice(0, HONOURS_KEPT);
    if (list.length) out.by[k] = list;
  }
  return out;
}

/** Fixed order, so equal states serialise to equal text. */
export const serializeHonours = (h: HonoursState): string =>
  JSON.stringify({ v: 1, by: Object.fromEntries(Object.keys(h.by).sort().map((k) => [k, h.by[k]!.slice(0, HONOURS_KEPT)])) });
