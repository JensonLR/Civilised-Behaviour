import { FOLLOWER_CAP, NPC, type ScenarioOutcome } from "./campaignTypes.ts";
import type { Follower, FollowerKind, NpcSpec, PartyState } from "./expeditionTypes.ts";
import { clamp } from "./math.ts";
import { moraleBand } from "./morale.ts";
import { hash3 } from "./rng.ts";
import { WEAPON, type WeaponId } from "./weapons.ts";

/**
 * Hired hands (D-034, package L). Three authored kinds with temperaments; everything here is pure and deterministic (a hire pool is a function of
 * (seed, day), a settlement of (party, purse, outcome, report)), and every money move is exact to the penny: the purse never goes negative and a
 * wage is paid in full or not at all (what is not paid is `owed`, and owed wages are what make hands grumble, desert and cap their nerve at 60).
 */

export const FOLLOWER_KINDS: readonly FollowerKind[] = ["porter", "rifleman", "surgeon"];
export const isFollowerKind = (k: unknown): k is FollowerKind => k === "porter" || k === "rifleman" || k === "surgeon";

export interface FollowerDef {
  kind: FollowerKind;
  role: number;
  weapon: WeaponId;
  wage: number;
  bravery: number;
  skill: number;
  /** Kilograms of capacity a hand adds to the party (partyCapacity reads the roster kinds; this is the table the sheet shows). */
  carry: number;
  title: string;
  /** The temperament stamp on the hire list. */
  stamp: string;
  blurb: string;
  names: readonly string[];
  /** A look PATCH (field name -> catalog index): the integrator lays it over `generateCharacter(lookSeed)` through `specFromUntrusted`. */
  look: Readonly<Record<string, number>>;
  /** "%n" is the follower's name. */
  grumbles: readonly string[];
  desertions: readonly string[];
  hireLines: readonly string[];
}

export const FOLLOWER_DEFS: Readonly<Record<FollowerKind, FollowerDef>> = {
  porter: {
    kind: "porter", role: NPC.PORTER, weapon: WEAPON.FISTS, wage: 6, bravery: 35, skill: 20, carry: 25, title: "Porter", stamp: "LOYAL TO THE LOAD",
    blurb: "Unarmed. Carries a prop for you and puts it where you point. Adds 25 kg to what the party may take.",
    names: ["Dobbin Harrowgate", "Mutt Pennyfeather", "Gillam the Elder", "Tansy Brace", "Fenwick Lumley", "Ozzie Crabtree"],
    look: { pack: 5, hat: 8, jacket: 0, shirt: 6, boots: 3, belly: 150 },
    grumbles: [
      "%n notes that a porter is paid to carry, not to be carried away.",
      "%n has begun to weigh the crates against the wages and finds the crates heavier.",
      "%n asks, to nobody, whether the Society has heard of money.",
    ],
    desertions: [
      "%n has put the load down, politely, in the middle of the road, and walked off the way a man walks who has found his own name.",
      "%n left the tin trunk and a note: 'Re: wages. See attached silence.'",
      "%n has gone home. The trunk is yours. The trunk was always yours. That was the problem.",
    ],
    hireLines: ["Strong back, weak opinions.", "Has carried a piano up a hill and a grudge down it.", "Will not ask what is in the crate. Will notice."],
  },
  rifleman: {
    kind: "rifleman", role: NPC.HIRED_RIFLE, weapon: WEAPON.RIFLE, wage: 14, bravery: 60, skill: 62, carry: 0, title: "Rifleman", stamp: "HIRED, NOT INSPIRED",
    blurb: "Carries a rifle and answers fire. Holds a position, closes on a target when told, and does not start a war on his own account.",
    names: ["Jem Cobbold", "Marta Skellow", "Alder Fenn", "Rook Tamblyn", "Cissy Garrowby", "Hob Ketteridge"],
    look: { hat: 20, jacket: 5, pack: 6, hipGear: 9, boots: 4, moustache: 3 },
    grumbles: [
      "%n is cleaning the rifle in the manner of a man composing a letter of complaint.",
      "%n remarks that courage is wonderful, and so is a pay packet, and he can only afford one of them.",
      "%n has started counting the party's rounds and the party's money, and the numbers are not friends.",
    ],
    desertions: [
      "%n has taken the rifle, which is his, and the compass, which was a misunderstanding, and gone to look for an employer with a ledger.",
      "%n has deserted. His note reads: 'No hard feelings. Several soft ones.'",
      "%n has found other work. It is the work of walking away from this.",
    ],
    hireLines: ["Hit a flagpole once, at some distance, on purpose.", "Served three colonels and outlived two.", "Asks what the rate is for 'getting shot at, sincerely'."],
  },
  surgeon: {
    kind: "surgeon", role: NPC.SURGEON, weapon: WEAPON.PISTOL, wage: 18, bravery: 45, skill: 40, carry: 0, title: "Surgeon", stamp: "BILLABLE",
    blurb: "Dresses wounds from the medical kit and revives the fallen. Wears a pistol for emphasis. The dearest hand and the one you will miss.",
    names: ["Dr. Ambrose Quillfeather", "Dr. Philippa Crake", "Dr. Ignatius Bloat", "Dr. Wilhelmina Sprake", "Dr. Octavian Nubbin", "Dr. Delphine Marsh-Tolliver"],
    look: { eyewear: 4, jacket: 3, hat: 0, pack: 4, hipGear: 1, gloves: 1 },
    grumbles: [
      "%n has sent the party an itemised invoice for the invoice.",
      "%n observes that a surgeon who works for promises is merely a very optimistic butcher.",
      "%n is withholding the good bandages on a matter of principle, which is interest.",
    ],
    desertions: [
      "%n has left, taking the saw and the opinion that the party was never really ill, only poorly managed.",
      "%n has resigned by the traditional method of not being there.",
      "%n has gone in search of patients who pay in advance, which is to say the dead.",
    ],
    hireLines: ["Has done this before, and the records agree.", "Washes his hands, which is more than the Ward does.", "Believes in bleeding, but only the right people."],
  },
};

export const followerRole = (kind: FollowerKind): number => FOLLOWER_DEFS[kind].role;
export const followerName = (f: Pick<Follower, "name">): string => f.name;
const fmt = (line: string, name: string): string => line.replace(/%n/g, name);
const pick = <T>(list: readonly T[], h: number): T => list[(h >>> 0) % list.length]!;
const clampI = (v: number, lo: number, hi: number): number => clamp(Math.round(Number.isFinite(v) ? v : lo), lo, hi);

/** The follower id: stable, short, never equal to a garrison id (those are `sentry-n`, `warden`, `rival-n`). */
export const followerId = (kind: FollowerKind, seed: number, day: number, slot: number): string => `hand-${kind[0]}${(hash3(seed, day, 0x4a1d + slot * 7) >>> 0).toString(36)}`;

export function makeFollower(kind: FollowerKind, seed: number, day: number, slot: number, nameIx: number): Follower {
  const d = FOLLOWER_DEFS[kind];
  const jitter = (hash3(seed, day, 0xb7a0 + slot) % 17) - 8;
  return {
    id: followerId(kind, seed, day, slot), kind, name: d.names[((nameIx % d.names.length) + d.names.length) % d.names.length]!, lookSeed: hash3(seed, day, 0x100c + slot) >>> 0,
    wage: d.wage, bravery: clampI(d.bravery + jitter, 5, 95), loyalty: 50, morale: 70, wounded: 0, owed: 0,
  };
}

export const HIRE_CANDIDATES = 3;

/** Three candidates per visit (per day), deterministic. Two kinds at least; names never repeat inside the pool. Anyone already on the roster is left out. */
export function hirePool(seed: number, day: number, party?: PartyState): Follower[] {
  const kinds: FollowerKind[] = [];
  for (let i = 0; i < HIRE_CANDIDATES; i++) kinds.push(FOLLOWER_KINDS[hash3(seed, day, 0x7001 + i) % FOLLOWER_KINDS.length]!);
  if (kinds[0] === kinds[1] && kinds[1] === kinds[2]) kinds[2] = FOLLOWER_KINDS[(FOLLOWER_KINDS.indexOf(kinds[2]!) + 1) % FOLLOWER_KINDS.length]!;
  const used: Record<string, number> = {};
  const out: Follower[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i]!;
    const n = used[k] ?? 0;
    used[k] = n + 1;
    const f = makeFollower(k, seed, day, i, hash3(seed, day, 0x9ad0 + FOLLOWER_KINDS.indexOf(k)) + n);
    if (party && party.roster.some((r) => r.id === f.id)) continue;
    out.push(f);
  }
  return out;
}

export const newParty = (): PartyState => ({ v: 1, loadout: { ammo: 0, medical: 0, provisions: 0, powder: 0, horses: 0, wagon: false }, roster: [], medical: 0, provisions: 0 });

export interface MoneyResult { party: PartyState; purse: number; ok: boolean; why: string }

const refuse = (party: PartyState, purse: number, why: string): MoneyResult => ({ party, purse, ok: false, why });
const cloneParty = (p: PartyState): PartyState => ({ ...p, loadout: { ...p.loadout }, roster: p.roster.map((f) => ({ ...f })) });

/** Signing fee = one wage. The candidate must be in today's pool, the roster below the cap, the purse sufficient. Returns a new party and purse (inputs untouched). */
export function hire(party: PartyState, purse: number, id: string, seed: number, day: number): MoneyResult {
  const cand = hirePool(seed, day).find((c) => c.id === id);
  if (!cand) return refuse(party, purse, "Nobody of that name is waiting at the quay.");
  if (party.roster.some((f) => f.id === id)) return refuse(party, purse, `${cand.name} is already on the books.`);
  if (party.roster.length >= FOLLOWER_CAP) return refuse(party, purse, `The party already has ${FOLLOWER_CAP} hands; the tent holds no more.`);
  if (!Number.isFinite(purse) || purse < cand.wage) return refuse(party, purse, `The signing fee is £${cand.wage} and the purse cannot find it.`);
  const next = cloneParty(party);
  next.roster.push(cand);
  return { party: next, purse: purse - cand.wage, ok: true, why: `${cand.name} signs (£${cand.wage}).` };
}

/**
 * D-052: a deserter signs on for rations: a rifleman with no signing fee and nothing owed yet, his loyalty untested (35). Refused when the tent is full (`FOLLOWER_CAP`) or he
 * is already on the books. His id is derived from the seed and the day, so it is stable across a reload of the same run.
 */
export function enlist(party: PartyState, name: string, lookSeed: number, seed: number, day: number): { party: PartyState; ok: boolean; id: string } {
  const id = `hand-x${(hash3(seed, day, 0xde5e) >>> 0).toString(36)}`;
  if (party.roster.length >= FOLLOWER_CAP || party.roster.some((f) => f.id === id)) return { party, ok: false, id };
  const next = cloneParty(party);
  next.roster.push({ ...makeFollower("rifleman", seed, day, 7, 0), id, name: name.slice(0, 32), lookSeed: lookSeed >>> 0, loyalty: 35 });
  return { party: next, ok: true, id };
}

/** Dismissal pays what is owed first (severance is a debt, not a gift); with the purse short the hand stays and the sheet says why. */
export function dismiss(party: PartyState, purse: number, id: string): MoneyResult {
  const f = party.roster.find((r) => r.id === id);
  if (!f) return refuse(party, purse, "Nobody of that name is on the books.");
  if (!Number.isFinite(purse) || purse < f.owed) return refuse(party, purse, `${f.name} is owed £${f.owed} and will not go without it.`);
  const next = cloneParty(party);
  next.roster = next.roster.filter((r) => r.id !== id);
  return { party: next, purse: purse - f.owed, ok: true, why: f.owed > 0 ? `${f.name} is paid off (£${f.owed}) and goes.` : `${f.name} is released.` };
}

/** What the expedition did to the hands, from the world (the outcome itself does not know their names). */
export interface SettleReport {
  /** Followers lying downed when the run ended and not revived. */
  down?: readonly string[];
  /** Followers killed (they stay dead; their wages die with them, which the paper will not mention). */
  dead?: readonly string[];
  /** Morale each follower finished with, 0..100. */
  morale?: Readonly<Record<string, number>>;
}

export interface Settlement { party: PartyState; purse: number; lines: string[] }

export const WOUNDED_EXPEDITIONS = 2;
export const OWED_LOYALTY = 15;
export const OWED_MORALE_CAP = 60;
export const REST_MORALE = 15;

/** Wage due for this expedition: convalescent hands draw half (they did nothing and say so). */
export const wageDue = (f: Pick<Follower, "wage" | "wounded" | "owed">): number => f.owed + (f.wounded > 0 ? Math.floor(f.wage / 2) : f.wage);

/**
 * After each expedition: wages are paid in roster order, each in full or not at all (unpaid becomes `owed`: loyalty -15, morale capped at 60), the
 * downed-and-not-revived become `wounded` for two expeditions (they sit the next ones out), the dead are struck off, and a hand who is both unpaid and
 * broken (or whose loyalty has run out) deserts with an authored line. Pure: new party and purse out, inputs untouched.
 */
export function settleRoster(party: PartyState, purse: number, outcome: Pick<ScenarioOutcome, "resolution" | "brokePromise">, report: SettleReport = {}): Settlement {
  const lines: string[] = [];
  const down = new Set(report.down ?? []);
  const dead = new Set(report.dead ?? []);
  let p = Number.isFinite(purse) ? Math.max(0, Math.floor(purse)) : 0;
  const next = cloneParty(party);
  const kept: Follower[] = [];
  let paid = 0;
  let nPaid = 0;
  for (const f of next.roster) {
    if (dead.has(f.id)) {
      lines.push(`${f.name} did not come back. ${f.owed > 0 ? `The £${f.owed} owed is written off as a courtesy to the Society.` : "The wages are saved, which the Society notes with something like tenderness."}`);
      continue;
    }
    const due = wageDue(f);
    if (p >= due) {
      p -= due;
      paid += due;
      nPaid++;
      f.owed = 0;
      f.loyalty = clampI(f.loyalty + 5, 0, 100);
    } else {
      f.owed = due;
      f.loyalty = clampI(f.loyalty - OWED_LOYALTY, 0, 100);
      if (next.provisions <= 0) lines.push(fmt(pick(FOLLOWER_DEFS[f.kind].grumbles, hash3(f.lookSeed, f.owed, 0x6a)), f.name));
    }
    const endM = clampI(report.morale?.[f.id] ?? f.morale, 0, 100);
    f.morale = clampI(endM + REST_MORALE, 0, 100);
    if (f.owed > 0) f.morale = Math.min(f.morale, OWED_MORALE_CAP);
    if (down.has(f.id)) {
      f.wounded = WOUNDED_EXPEDITIONS;
      lines.push(`${f.name} was left down at the end and is laid up for ${WOUNDED_EXPEDITIONS} expeditions.`);
    } else f.wounded = Math.max(0, f.wounded - 1);
    // an unpaid hand with no nerve left walks; so does one who has stopped believing in the Society (loyalty 0)
    if (f.owed > 0 && (moraleBand(endM) === "broken" || f.loyalty <= 0)) {
      lines.push(fmt(pick(FOLLOWER_DEFS[f.kind].desertions, hash3(f.lookSeed, f.loyalty, 0xde5e)), f.name));
      continue;
    }
    kept.push(f);
  }
  next.roster = kept;
  next.provisions = 0;
  next.medical = 0;
  if (nPaid > 0) lines.unshift(`Wages: £${paid} paid to ${nPaid} hand${nPaid === 1 ? "" : "s"}.`);
  return { party: next, purse: p, lines };
}

/** Where the hands stand at landfall: a ring about `near`, 2.6 m out, one every quarter turn, starting behind the party. */
export function followerSpecs(party: PartyState, seed: number, near: { x: number; z: number }): NpcSpec[] {
  const out: NpcSpec[] = [];
  const list = party.roster.filter((f) => f.wounded <= 0).slice(0, FOLLOWER_CAP);
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    const d = FOLLOWER_DEFS[f.kind];
    const a = Math.PI * 0.75 + (i * Math.PI) / 2.2;
    out.push({
      id: f.id, role: d.role, faction: "ward", side: "party", group: "party", post: { x: near.x + Math.sin(a) * 2.6, z: near.z + Math.cos(a) * 2.6 }, weapon: d.weapon,
      lookSeed: f.lookSeed ^ (seed & 0xff), look: { ...d.look }, name: f.name, skill: d.skill, bravery: f.bravery, brain: "follower",
    });
  }
  return out;
}

/** Nerve a hand fights with: bravery moved by loyalty (+-15 at the extremes). */
export const effectiveBravery = (f: Pick<Follower, "bravery" | "loyalty">): number => clamp(f.bravery + (f.loyalty - 50) * 0.3, 0, 100);
/** Morale a hand lands with: carried over, capped at 60 while owed wages. */
export const startMorale = (f: Pick<Follower, "morale" | "owed">): number => (f.owed > 0 ? Math.min(f.morale, OWED_MORALE_CAP) : clamp(f.morale, 0, 100));
