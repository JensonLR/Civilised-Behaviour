import { ZONE, type ZoneId } from "./wounds.ts";

/**
 * Limbs that can be lost. A bit mask (PlayerState.missing) so it replicates as one byte. Heads and torsos are never severed: characters are
 * downed, never dead, and the comedy stops short of decapitation.
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
/** Mask is 4 bits; sanitise anything from the wire or a save. */
export const sanitizeMissing = (mask: unknown): number => (typeof mask === "number" && Number.isFinite(mask) ? Math.floor(mask) & 15 : 0);

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
