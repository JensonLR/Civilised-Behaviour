import type { FactionId, RegionId } from "./campaignTypes.ts";
import { LIMB } from "./limbs.ts";
import { isPeopleId, type PeopleId } from "./peoples.ts";

/**
 * SURVIVORS WITH GRUDGES (D-109), after the nemesis of the big orc-hunting game (the idea; built here). A soldier the party maims (an arm or a leg off, set alight,
 * booted, roped, ridden down: D-111) and leaves behind is not always as dead as he looked. The worst-used man of a run is remembered in the campaign (`sites.grudges`); a later contract in
 * the same region fields him again: the same face, a hook where his hand was or a peg where his leg was, singed if he burned, a name the paper has given him, more nerve
 * and a better eye, and something to say to the party. Beaten again, he may be back again (`maxReturns`), and the paper keeps count.
 *
 * Pure. The server records (systems/Grudges.ts) and fields him (the Cast's spawn); the codec validates the list (factions.ts `parseSites`).
 */
export type GrudgeCause = "limb" | "fire" | "boot" | "rope" | "hoof";
export const GRUDGE_CAUSES: readonly GrudgeCause[] = ["limb", "fire", "boot", "rope", "hoof"];

export interface Grudge {
  /** The man as he was: his name (rank and all), role, face, people (absent: the colonial caricature), and whose he was where. */
  name: string;
  role: number;
  lookSeed: number;
  people?: PeopleId;
  faction: FactionId;
  region: RegionId;
  /** What it cost him: the limbs he lost (a `LIMB` mask), whether he burned, and what the paper will say it was. */
  missing: number;
  burnt: boolean;
  cause: GrudgeCause;
  /** Who did it (the party member's name) and when. */
  by: string;
  day: number;
  /** How many times he has come back. */
  returns: number;
}

export const GRUDGE = {
  /** How many the campaign remembers (the oldest is forgotten first), and how often one man comes back. */
  cap: 4,
  maxReturns: 2,
  /** He needs a night to get his hook fitted: never back the same day. */
  minDays: 1,
  /** What it did to him: a better eye and steadier nerve (added to his spec, to 100). */
  skill: 20,
  bravery: 30,
  /** The order the causes count in when picking the run's worst-used man. */
  weight: { limb: 3, fire: 2, boot: 1, rope: 1, hoof: 1 } as Record<GrudgeCause, number>,
  /** He says his piece when he is this close to one of the party and can be heard. */
  speakR: 25,
} as const;

/** The name the paper gives him, from the worst of what was done to him. */
export function epithet(g: Pick<Grudge, "missing" | "burnt" | "cause">): string {
  if ((g.missing & (LIMB.ARM_L | LIMB.ARM_R)) !== 0) return "Hook";
  if ((g.missing & (LIMB.LEG_L | LIMB.LEG_R)) !== 0) return "Peg";
  if (g.burnt || g.cause === "fire") return "Smoky";
  if (g.cause === "boot") return "Bootprint";
  if (g.cause === "hoof") return "Hoofprint";
  return "Tether";
}

/** His name with it: `Sentry Tamsin Cray` becomes `Sentry Tamsin "Hook" Cray` (before the surname); a name already carrying one is left alone. */
export function grudgeName(name: string, nick: string): string {
  const n = name.trim().slice(0, 60);
  if (n.includes('"')) return n;
  const at = n.lastIndexOf(" ");
  return at < 0 ? `"${nick}" ${n}` : `${n.slice(0, at)} "${nick}"${n.slice(at)}`;
}

/** The look patch for his return: a hook for a lost arm, a wooden leg for a lost leg (on the side he lost), singed clothes and scars if he burned. */
export function grudgeLook(g: Pick<Grudge, "missing" | "burnt">): Record<string, number> {
  const out: Record<string, number> = {};
  if ((g.missing & LIMB.ARM_R) !== 0) out.hook = 2;
  else if ((g.missing & LIMB.ARM_L) !== 0) out.hook = 1;
  if ((g.missing & LIMB.LEG_R) !== 0) out.woodenLeg = 2;
  else if ((g.missing & LIMB.LEG_L) !== 0) out.woodenLeg = 1;
  if (g.burnt) {
    out.burnt = 2;
    out.scars = 0b101;
  }
  return out;
}

/** What he lost, for the paper ("an arm", "a leg", "his eyebrows", "his dignity", "his liberty"). */
export function grudgeLoss(g: Pick<Grudge, "missing" | "burnt" | "cause">): string {
  const arms = (g.missing & LIMB.ARM_L ? 1 : 0) + (g.missing & LIMB.ARM_R ? 1 : 0);
  const legs = (g.missing & LIMB.LEG_L ? 1 : 0) + (g.missing & LIMB.LEG_R ? 1 : 0);
  if (arms + legs >= 2) return "rather more than one limb";
  if (arms === 1) return "an arm";
  if (legs === 1) return "a leg";
  if (g.burnt || g.cause === "fire") return "his eyebrows";
  if (g.cause === "boot") return "his dignity";
  if (g.cause === "hoof") return "his hat";
  return "his liberty";
}

/** The list with `g` remembered: the same man (face and region) is replaced, not doubled; past the cap, the oldest goes. */
export function rememberGrudge(list: readonly Grudge[] | undefined, g: Grudge): Grudge[] {
  const rest = (list ?? []).filter((x) => !(x.lookSeed === g.lookSeed && x.region === g.region));
  rest.push(g);
  while (rest.length > GRUDGE.cap) rest.shift();
  return rest;
}

/** Which remembered man (an index into `list`) comes back in `region` on `day`: the oldest grudge there that has had its night; -1 for none. */
export function pickGrudge(list: readonly Grudge[] | undefined, region: RegionId, day: number): number {
  if (!list) return -1;
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const g = list[i]!;
    if (g.region !== region || g.returns >= GRUDGE.maxReturns || day - g.day < GRUDGE.minDays) continue;
    if (best < 0 || g.day < list[best]!.day) best = i;
  }
  return best;
}

/** A grudge as saved, checked field by field (anything malformed is dropped, never thrown). `isRegion` and `isFaction` come from the caller (no import cycle). */
export function parseGrudges(raw: unknown, isRegion: (v: unknown) => v is RegionId, isFaction: (v: unknown) => v is FactionId): Grudge[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Grudge[] = [];
  for (const r of raw.slice(-GRUDGE.cap)) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
    const role = int(o.role, 1, 255);
    const lookSeed = int(o.lookSeed, 0, 4294967295);
    const missing = int(o.missing, 0, 15);
    const day = int(o.day, 0, 9999);
    const returns = int(o.returns, 0, GRUDGE.maxReturns);
    const cause = GRUDGE_CAUSES.find((c) => c === o.cause);
    if (typeof o.name !== "string" || o.name.length === 0 || o.name.length > 60 || typeof o.by !== "string" || o.by.length > 40) continue;
    if (role === undefined || lookSeed === undefined || missing === undefined || day === undefined || returns === undefined || !cause) continue;
    if (!isRegion(o.region) || !isFaction(o.faction)) continue;
    const g: Grudge = { name: o.name, role, lookSeed, faction: o.faction, region: o.region, missing, burnt: o.burnt === true, cause, by: o.by, day, returns };
    if (isPeopleId(o.people)) g.people = o.people;
    out.push(g);
  }
  return out;
}
