import { LIMB } from "./limbs.ts";
import { ZONE, woundLevel, type ZoneId } from "./wounds.ts";

/**
 * HIT REACTIONS (D-104): where a blow lands decides what it does to the body, after the hit reactions of the big open-world westerns. A heavy blow to a
 * leg puts the man down on that knee; one to the gut or the head doubles him over; one to the arm knocks the weapon out of his hand. While he is down on
 * the knee or doubled up he can neither walk nor fight back: a well-placed shot buys the shooter a moment.
 *
 * Who reacts: NPC rows only (soldiers, rivals, hired hands, civilians), never a beast and never a rider. A human player's body is predicted on their own
 * machine, and a stagger the server imposed would arrive a round trip late and snap them; players get the arm-wound aim shake below instead, which the
 * server and the crosshair both read.
 *
 * Wire (PlayerState.react, one byte, server-owned): kind in the top two bits, side in bit 5 (0 left, 1 right: the hurt leg or arm), and the reaction's
 * whole length in tenths of a second in the low five bits (the clients pace the get-up from it). 0 = none. The server times it and writes 0 at the end.
 */
export const REACT = { NONE: 0, FLOORED: 1, DOUBLED: 2, DISARMED: 3 } as const;
export type ReactKind = (typeof REACT)[keyof typeof REACT];

export const HIT_REACT = {
  /** Damage to a leg that puts the body down on that knee, and the seconds it stays there (more for a heavier blow, up to `floorHeavy` more damage). */
  legFloor: 18,
  floorS: [1.0, 1.8],
  floorHeavy: 40,
  /** Damage to the torso that doubles the body over, and for how long. */
  torsoDouble: 22,
  doubleS: [0.8, 1.3],
  doubleHeavy: 40,
  /** A blow to the head that does not kill reels the body (the doubled pose, shorter). */
  headReel: 15,
  reelS: 0.7,
  /** Damage to an arm that knocks a weapon (not bare fists) out of the hand, and how long the empty hand smarts. */
  armDisarm: 16,
  disarmS: 0.9,
  /** Aim with a wounded arm: the cone grows by these fractions (gash, grievous, lost arm), summed over both arms, capped. */
  shake: { gash: 0.3, grievous: 0.7, lost: 0.5, max: 2.2 },
} as const;

/** The longest a reaction can be told on the wire (five bits of tenths). */
const MAX_TENTHS = 31;

export const packReact = (kind: ReactKind, right: boolean, seconds: number): number =>
  kind === REACT.NONE ? 0 : (kind << 6) | (right ? 32 : 0) | Math.max(1, Math.min(MAX_TENTHS, Math.round(seconds * 10)));
export const reactKind = (b: number): ReactKind => ((b >>> 6) & 3) as ReactKind;
/** True when the hurt leg or arm is the right one. */
export const reactRight = (b: number): boolean => (b & 32) !== 0;
/** The whole length of the reaction (seconds), as it was told at the start. */
export const reactSeconds = (b: number): number => (b & 31) / 10;
/** Down on a knee or doubled over: the body can neither walk nor attack. */
export const reactHolds = (b: number): boolean => {
  const k = reactKind(b);
  return k === REACT.FLOORED || k === REACT.DOUBLED;
};

const ramp = (amount: number, from: number, over: number, lo: number, hi: number): number => lo + (hi - lo) * Math.max(0, Math.min(1, (amount - from) / over));

/**
 * The reaction a blow of `damage` to `zone` leaves (packed, 0 = none). `armed`: something other than bare fists is in the hand (an arm hit can only knock
 * a weapon away when there is one). The caller decides who reacts at all (see the header).
 */
export function reactionFor(zone: ZoneId, damage: number, armed: boolean): number {
  if (!(damage > 0)) return 0;
  const H = HIT_REACT;
  switch (zone) {
    case ZONE.LEG_L:
    case ZONE.LEG_R:
      return damage >= H.legFloor ? packReact(REACT.FLOORED, zone === ZONE.LEG_R, ramp(damage, H.legFloor, H.floorHeavy, H.floorS[0], H.floorS[1])) : 0;
    case ZONE.TORSO:
      return damage >= H.torsoDouble ? packReact(REACT.DOUBLED, false, ramp(damage, H.torsoDouble, H.doubleHeavy, H.doubleS[0], H.doubleS[1])) : 0;
    case ZONE.HEAD:
      return damage >= H.headReel ? packReact(REACT.DOUBLED, false, H.reelS) : 0;
    case ZONE.ARM_L:
    case ZONE.ARM_R:
      return armed && damage >= H.armDisarm ? packReact(REACT.DISARMED, zone === ZONE.ARM_R, H.disarmS) : 0;
    default:
      return 0;
  }
}

/**
 * Whether a new reaction replaces the one in force: a body already down on a knee is not stood up by a lesser blow, but a fresh disarm or a heavier
 * stagger takes over. (Kinds rank FLOORED > DOUBLED > DISARMED.)
 */
export function reactOverrides(next: number, current: number): boolean {
  if (next === 0) return false;
  if (current === 0) return true;
  const rank = (b: number): number => [0, 3, 2, 1][reactKind(b)]!;
  return rank(next) >= rank(current);
}

const armShake = (wounds: number, missing: number, zone: ZoneId, limb: number): number => {
  const S = HIT_REACT.shake;
  if ((missing & limb) !== 0) return S.lost;
  const l = woundLevel(wounds, zone);
  return l >= 3 ? S.grievous : l === 2 ? S.gash : 0;
};

/** How much a wounded or missing arm widens the aim (a multiplier on the cone, 1 = steady). Both arms count: a rifle wants two. Allocation-free (the crosshair reads it every frame). */
export function aimShake(wounds: number, missing: number): number {
  return Math.min(HIT_REACT.shake.max, 1 + armShake(wounds, missing, ZONE.ARM_L, LIMB.ARM_L) + armShake(wounds, missing, ZONE.ARM_R, LIMB.ARM_R));
}
