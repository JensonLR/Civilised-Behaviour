import type { Follower, Loadout } from "./expeditionTypes.ts";

/**
 * The manifest (D-034, package L): what the party takes ashore, in pounds sterling-ish and kilograms. Pure, deterministic, hostile-safe: the server
 * validates a manifest at propose and again at sail, the client sheet (`ui/Loadout.ts`) shows exactly these numbers. Weight is a HARD BUDGET at the
 * table and never a movement penalty (that would be a new predicted input); the sheet shows it as a plain gauge in words (Light / Laden / Full).
 *
 * Rule: anyone at the table edits the manifest freely; the cost is charged when the ship leaves (cancel is free); anything unaffordable at departure
 * is dropped one unit at a time in a FIXED order (`DROP_ORDER`) with a notice for each category touched.
 */

export type LoadoutKey = keyof Loadout;

export interface LoadoutItem {
  key: LoadoutKey;
  name: string;
  /** Largest count the manifest takes (the wagon is 0 or 1). */
  max: number;
  /** Kilograms and pounds PER UNIT. Horses and the wagon weigh nothing on the manifest: they ARE the capacity. */
  kg: number;
  cost: number;
  /** One line of what a unit does, in the voice of the supply clerk. */
  note: string;
}

/** Table order = sheet order. */
export const LOADOUT_ITEMS: readonly LoadoutItem[] = [
  { key: "ammo", name: "Ammunition crate", max: 2, kg: 6, cost: 10, note: "Half again as many rounds for every firearm. Stencilled FRAGILE, which it is not." },
  { key: "medical", name: "Medical kit", max: 3, kg: 3, cost: 6, note: "Four field dressings and a bottle the surgeon calls anaesthetic." },
  { key: "provisions", name: "Provisions", max: 3, kg: 4, cost: 4, note: "Hired hands recover their nerve on a full stomach and grumble about wages on an empty one." },
  { key: "powder", name: "Powder keg", max: 3, kg: 8, cost: 8, note: "A barrel left at the landing for whatever needs persuading. Handle like a rumour." },
  { key: "horses", name: "Horse", max: 2, kg: 0, cost: 28, note: "Ridden by one, opinion of everyone. The second carries kit." },
  { key: "wagon", name: "Wagon", max: 1, kg: 0, cost: 34, note: "Needs a horse. Four crates, two bodies, no springs." },
];

export const LOADOUT_KEYS: readonly LoadoutKey[] = LOADOUT_ITEMS.map((i) => i.key);
const ITEM: Readonly<Record<LoadoutKey, LoadoutItem>> = Object.fromEntries(LOADOUT_ITEMS.map((i) => [i.key, i])) as Record<LoadoutKey, LoadoutItem>;

/** What gets dropped first when the manifest does not fit the purse or the capacity at departure. */
export const DROP_ORDER: readonly LoadoutKey[] = ["powder", "provisions", "wagon", "horses", "ammo", "medical"];

export const CAPACITY = { perHuman: 30, perPorter: 25, wagon: 90, extraHorse: 40 } as const;

export const emptyLoadout = (): Loadout => ({ ammo: 0, medical: 0, provisions: 0, powder: 0, horses: 0, wagon: false });

const count = (v: unknown, max: number): number => {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(0, Math.floor(v)));
};

/** Hostile-safe: anything at all in, a well-formed manifest out (unknown keys dropped, counts floored and clamped, junk = 0). Never throws. */
export function normalizeLoadout(raw: unknown): Loadout {
  const r: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const own = (k: string): unknown => (Object.prototype.hasOwnProperty.call(r, k) ? r[k] : undefined);
  return {
    ammo: count(own("ammo"), 2) as Loadout["ammo"],
    medical: count(own("medical"), 3) as Loadout["medical"],
    provisions: count(own("provisions"), 3) as Loadout["provisions"],
    powder: count(own("powder"), 3) as Loadout["powder"],
    horses: count(own("horses"), 2) as Loadout["horses"],
    wagon: own("wagon") === true,
  };
}

export const loadoutEquals = (a: Loadout, b: Loadout): boolean =>
  a.ammo === b.ammo && a.medical === b.medical && a.provisions === b.provisions && a.powder === b.powder && a.horses === b.horses && a.wagon === b.wagon;

const unitsOf = (l: Loadout, k: LoadoutKey): number => (k === "wagon" ? (l.wagon ? 1 : 0) : l[k]);

export function loadoutCost(l: Loadout): number {
  let c = 0;
  for (const it of LOADOUT_ITEMS) c += unitsOf(l, it.key) * it.cost;
  return c;
}

export function loadoutWeight(l: Loadout): number {
  let w = 0;
  for (const it of LOADOUT_ITEMS) w += unitsOf(l, it.key) * it.kg;
  return w;
}

/** Kilograms the party can take: 30 per human, +25 per porter, +90 with a wagon, +40 per horse beyond the first. */
export function partyCapacity(humans: number, roster: readonly Pick<Follower, "kind">[], l: Loadout): number {
  const h = Number.isFinite(humans) ? Math.min(4, Math.max(1, Math.floor(humans))) : 1;
  let porters = 0;
  for (const f of roster) if (f.kind === "porter") porters++;
  return h * CAPACITY.perHuman + porters * CAPACITY.perPorter + (l.wagon ? CAPACITY.wagon : 0) + Math.max(0, l.horses - 1) * CAPACITY.extraHorse;
}

export type LoadWord = "Light" | "Laden" | "Full" | "Overloaded";
/** The gauge in words, so it never depends on colour: Light under 55%, Laden to 85%, Full to the limit, Overloaded beyond it. */
export function loadWord(weight: number, capacity: number): LoadWord {
  if (!(capacity > 0)) return weight > 0 ? "Overloaded" : "Light";
  const u = weight / capacity;
  return u > 1 ? "Overloaded" : u > 0.85 ? "Full" : u >= 0.55 ? "Laden" : "Light";
}

export interface LoadoutContext { purse: number; humans: number; roster: readonly Pick<Follower, "kind">[] }
export interface LoadoutCheck { ok: boolean; problems: string[]; cost: number; weight: number; capacity: number }

export function validateLoadout(l: Loadout, ctx: LoadoutContext): LoadoutCheck {
  const problems: string[] = [];
  const cost = loadoutCost(l);
  const weight = loadoutWeight(l);
  const capacity = partyCapacity(ctx.humans, ctx.roster, l);
  if (l.wagon && l.horses < 1) problems.push("A wagon needs a horse to pull it.");
  if (weight > capacity) problems.push(`Overweight by ${weight - capacity} kg: the party can carry ${capacity} kg.`);
  const purse = Number.isFinite(ctx.purse) ? ctx.purse : 0;
  if (cost > purse) problems.push(`£${cost - purse} short: the manifest comes to £${cost} and the purse holds £${Math.max(0, Math.floor(purse))}.`);
  return { ok: problems.length === 0, problems, cost, weight, capacity };
}

export interface Trimmed { loadout: Loadout; lines: string[]; dropped: number }

/**
 * Departure: makes the manifest fit the purse and the capacity. A wagon without a horse goes first (it cannot move); then single units are dropped in
 * `DROP_ORDER` until it fits. Returns a notice line per category touched. A manifest that already fits comes back unchanged with no lines.
 */
export function trimLoadout(input: Loadout, ctx: LoadoutContext): Trimmed {
  const l = normalizeLoadout(input);
  const lines: string[] = [];
  const took: Record<string, number> = {};
  let dropped = 0;
  const drop = (k: LoadoutKey): void => {
    if (k === "wagon") l.wagon = false;
    else (l[k] as number)--;
    took[k] = (took[k] ?? 0) + 1;
    dropped++;
  };
  if (l.wagon && l.horses < 1) drop("wagon");
  for (const k of DROP_ORDER) {
    while (unitsOf(l, k) > 0 && !validateLoadout(l, ctx).ok) {
      // a wagon cannot outlive its last horse
      if (k === "horses" && l.wagon && l.horses === 1) {
        drop("wagon");
        continue;
      }
      drop(k);
    }
  }
  for (const k of DROP_ORDER) {
    const n = took[k];
    if (n) lines.push(`${ITEM[k].name}${n > 1 ? ` x${n}` : ""} left on the quay: the manifest did not fit.`);
  }
  return { loadout: l, lines, dropped };
}

export interface PrepEffects {
  /** Multiplier on every firearm's reserve rounds. */
  reserveMul: number;
  /** Field dressings in the party's medical stock. */
  dressings: number;
  /** Provision crates (>= 1 keeps hired hands fed and quiet). */
  provisions: number;
  /** Powder kegs set out at the landing as BARREL props. */
  kegs: number;
  horses: number;
  wagon: boolean;
}

export const DRESSINGS_PER_KIT = 4;

export function prepEffects(l: Loadout): PrepEffects {
  const n = normalizeLoadout(l);
  return { reserveMul: 1 + 0.5 * n.ammo, dressings: n.medical * DRESSINGS_PER_KIT, provisions: n.provisions, kegs: n.powder, horses: n.horses, wagon: n.wagon && n.horses >= 1 };
}

/** Step a manifest field by `d` (the sheet's stepper): clamped, and the wagon toggles. Pure; returns a new manifest. */
export function stepLoadout(l: Loadout, key: LoadoutKey, d: number): Loadout {
  const out = { ...l };
  const it = ITEM[key];
  if (key === "wagon") out.wagon = d > 0;
  else (out[key] as number) = Math.min(it.max, Math.max(0, (l[key] as number) + Math.sign(d)));
  return out;
}
