import { ZONE, type ZoneId } from "./wounds.ts";

/**
 * Limbs that can be lost. A bit mask (PlayerState.missing) so it replicates as one byte. A torso is never severed, and neither is a player's head or a hand's:
 * the party is downed, never dead. An ENEMY's head can come off (D-118, `HEAD`, `beheads`): the owner's call, behind the campaign's dismemberment rule and the
 * player's gore settings.
 */
export const LIMB = { ARM_L: 1, ARM_R: 2, LEG_L: 4, LEG_R: 8 } as const;
export type LimbId = (typeof LIMB)[keyof typeof LIMB];
export const LIMB_LIST: readonly LimbId[] = [LIMB.ARM_L, LIMB.ARM_R, LIMB.LEG_L, LIMB.LEG_R];
export const LIMB_NAMES: Record<LimbId, string> = { 1: "left arm", 2: "right arm", 4: "left leg", 8: "right leg" };

/** The limb a wound zone belongs to (head and torso have none). */
export function zoneLimb(zone: number): LimbId | undefined {
  switch (zone) {
    case ZONE.ARM_L: return LIMB.ARM_L;
    case ZONE.ARM_R: return LIMB.ARM_R;
    case ZONE.LEG_L: return LIMB.LEG_L;
    case ZONE.LEG_R: return LIMB.LEG_R;
    default: return undefined;
  }
}

export function limbZone(limb: LimbId): ZoneId {
  return limb === LIMB.ARM_L ? ZONE.ARM_L : limb === LIMB.ARM_R ? ZONE.ARM_R : limb === LIMB.LEG_L ? ZONE.LEG_L : ZONE.LEG_R;
}

export const isLimb = (v: unknown): v is LimbId => v === 1 || v === 2 || v === 4 || v === 8;
export const hasLimbLoss = (missing: number, limb: LimbId): boolean => (missing & limb) !== 0;
export const limbsLost = (missing: number): number => LIMB_LIST.filter((l) => (missing & l) !== 0).length;
/** Mask is 5 bits (the four limbs and the head); sanitise anything from the wire or a save. */
export const sanitizeMissing = (mask: unknown): number => (typeof mask === "number" && Number.isFinite(mask) ? Math.floor(mask) & 31 : 0);

/**
 * D-118: the head, as a bit in the same mask. Not a limb (`LIMB_LIST`, the stumps, the dressings and the limb tallies stay the four): it comes off only an enemy's
 * shoulders (the room decides who), and a man without one is down for good (never revived, never back as a grudge).
 */
export const HEAD = 16;
export const isHeadless = (missing: number): boolean => (missing & HEAD) !== 0;
/** The four limbs of a mask, without the head (what the limb tallies, the grudges and the stumps count). */
export const limbBits = (missing: number): number => missing & 15;

export const BEHEAD = {
  /** Any blow to the head this heavy (its damage x the weapon's sever bias) takes it off: a cannonball or a powder blast at the man's ear; never a rifle ball (154) or a sabre's ordinary cut (97). */
  heavy: 250,
} as const;

/**
 * Whether a blow that lands on `zone` takes the head off: a sabre's coup de grace (D-105) that lands on the head always does, and no other coup de grace ever does (a gun's
 * butt carries the finisher's quadrupled sever bias, and must not); any other blow to the head does at `amount` x `severBias` of `BEHEAD.heavy` or more. Pure and
 * certain (no roll, so it never draws on the room's randomness); the room decides who may lose a head at all.
 */
export function beheads(zone: number, amount: number, severBias: number, finisher: boolean, sabre: boolean): boolean {
  if (zone !== ZONE.HEAD || !(amount > 0)) return false;
  if (finisher) return sabre;
  return amount * Math.max(0, severBias) >= BEHEAD.heavy;
}

export const SEVER = {
  /** Below this a blow cannot take a limb off. */
  minDamage: 45,
  /** At or above this it always does (when the limb is hit and dismemberment is on). */
  certainDamage: 90,
  /** Extra chance per severity level already on that zone: a limb that has been cut up comes off more easily. */
  perWoundLevel: 0.12,
} as const;

/** Probability 0..1 that a blow of `amount` damage to a limb already wounded to `zoneLevel` severs it. Pure; the caller rolls. */
export function severChance(amount: number, zoneLevel: number): number {
  if (!(amount >= SEVER.minDamage)) return 0;
  if (amount >= SEVER.certainDamage) return 1;
  const base = ((amount - SEVER.minDamage) / (SEVER.certainDamage - SEVER.minDamage)) * 0.7;
  return Math.max(0, Math.min(1, base + Math.max(0, zoneLevel) * SEVER.perWoundLevel));
}

/**
 * True when the wooden leg (look history: 0 none, 1 left, 2 right) sits where a leg is actually missing. A peg on a healthy leg
 * changes nothing and a peg on the wrong side is just decoration. The server raises `FLAG.PEG_LEG` from this.
 */
export function prosthesisFor(woodenLeg: number, missing: number): boolean {
  return (woodenLeg === 1 && (missing & LIMB.LEG_L) !== 0) || (woodenLeg === 2 && (missing & LIMB.LEG_R) !== 0);
}
