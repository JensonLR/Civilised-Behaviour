import type { Rng } from "./rng.ts";

/**
 * Body zones a hit can land on. Order is wire format (2 bits of severity per zone, packed in PlayerState.wounds): append only.
 * The zones map 1:1 onto rig bones on the client (head, torso, upper arms, thighs).
 */
export const ZONE = { HEAD: 0, TORSO: 1, ARM_L: 2, ARM_R: 3, LEG_L: 4, LEG_R: 5 } as const;
export type ZoneId = (typeof ZONE)[keyof typeof ZONE];
export const ZONE_COUNT = 6;
export const ZONE_NAMES = ["head", "torso", "left arm", "right arm", "left leg", "right leg"] as const;

/** Highest severity a single zone can carry: 0 clean, 1 scratch, 2 gash, 3 grievous. */
export const WOUND_MAX = 3;

/** Relative chance of a hit with no aimed zone landing in each zone (index = ZONE). */
const ZONE_WEIGHTS = [8, 34, 12, 12, 17, 17] as const;
const ZONE_WEIGHT_SUM = 100;

export const WOUNDS = {
  /** Damage below this leaves a bruise at most: no wound, no blood. */
  minDamage: 8,
  /** Damage at or above these thresholds reaches severity 1 / 2 / 3. */
  tier: [8, 22, 42],
  /** After a revive every wound is patched up to at most this severity (a field dressing, not a cure). */
  revivedCap: 2,
} as const;

/** Severity a single hit of `amount` damage leaves (0 = none). */
export function severityForDamage(amount: number): number {
  let s = 0;
  for (let i = 0; i < WOUNDS.tier.length; i++) if (amount >= WOUNDS.tier[i]!) s = i + 1;
  return s;
}

/** Picks a zone for an unaimed hit. Deterministic given the RNG state. */
export function pickZone(rng: Rng): ZoneId {
  let roll = rng.next() * ZONE_WEIGHT_SUM;
  for (let z = 0; z < ZONE_COUNT; z++) {
    roll -= ZONE_WEIGHTS[z]!;
    if (roll < 0) return z as ZoneId;
  }
  return ZONE.TORSO;
}

export const isZone = (z: unknown): z is ZoneId => typeof z === "number" && Number.isInteger(z) && z >= 0 && z < ZONE_COUNT;

/** Severity (0..3) of `zone` in the packed mask. */
export const woundLevel = (mask: number, zone: number): number => (mask >>> (zone * 2)) & 3;

/** New mask with `zone` set to exactly `level` (clamped 0..WOUND_MAX). */
export function setWound(mask: number, zone: number, level: number): number {
  const l = Math.max(0, Math.min(WOUND_MAX, Math.floor(level)));
  return (mask & ~(3 << (zone * 2))) | (l << (zone * 2));
}

/**
 * A hit stacks on what is already there: the new severity replaces the old only when worse, and a repeat hit on an
 * already-wounded zone (of equal or lower severity) bumps it by one, so sustained fire on one spot keeps getting worse.
 */
export function addWound(mask: number, zone: number, severity: number): number {
  if (severity <= 0) return mask;
  const cur = woundLevel(mask, zone);
  const next = cur === 0 ? severity : Math.max(severity, cur + 1);
  return setWound(mask, zone, next);
}

/** Every zone limited to at most `cap` (used when a casualty is revived). */
export function capWounds(mask: number, cap: number): number {
  let out = mask;
  for (let z = 0; z < ZONE_COUNT; z++) if (woundLevel(out, z) > cap) out = setWound(out, z, cap);
  return out;
}

export function worstWound(mask: number): number {
  let w = 0;
  for (let z = 0; z < ZONE_COUNT; z++) w = Math.max(w, woundLevel(mask, z));
  return w;
}

export function woundedZoneCount(mask: number): number {
  let n = 0;
  for (let z = 0; z < ZONE_COUNT; z++) if (woundLevel(mask, z) > 0) n++;
  return n;
}

/** Mask is a 12-bit field; sanitise anything that came off the wire or a save. */
export const sanitizeWounds = (mask: unknown): number => (typeof mask === "number" && Number.isFinite(mask) ? Math.floor(mask) & 0xfff : 0);
