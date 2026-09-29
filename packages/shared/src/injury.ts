import { LIMB, limbZone, LIMB_LIST } from "./limbs.ts";
import { ZONE, ZONE_COUNT, setWound, woundLevel } from "./wounds.ts";

/**
 * What injuries do to a character's abilities. ONE pure, allocation-free function shared by the server step, the client
 * prediction and the server's interaction rules, so the three can never disagree (D-026).
 *
 * Inputs are server-owned replicated state (`PlayerState.wounds`, `PlayerState.missing`, and the `FLAG.PEG_LEG` bit the server
 * raises when a wooden leg is fitted where a leg is missing). The client predicts with the last replicated values, which is safe
 * because the reconciler snapshot carries them together with the position they produced (see NETWORKING.md).
 *
 * Rules (a lost limb overrides the wound on its own zone, because the stump is always "grievous"):
 *   leg   healthy/scratch 1.0 | gash 0.9 | grievous 0.6, no sprint, no jump | lost 0.45, no sprint, no jump | lost + peg 0.7, no sprint
 *   speed = product of both legs (so two bad legs is a crawl-like ~0.2)
 *   head or torso grievous: no sprint (dizzy / winded)
 *   arm   "sound" = present and at most a gash. Two sound arms carry anything; one sound arm carries light props only;
 *         no sound arm but a present (grievous) arm can still hold a light prop; both arms lost carries and throws nothing.
 *   throw strength = mean of the two arms (lost 0, grievous 0.4, gash 0.85, else 1)
 */
export const INJURY = {
  leg: { gash: 0.9, grievous: 0.6, lost: 0.45, peg: 0.7 },
  arm: { gash: 0.85, grievous: 0.4 },
  /** Props at or under this mass (kg) can be handled with one hand (bottle, chair). Crates and barrels need two sound arms. */
  lightPropMass: 8,
  /** "No limit" for two sound arms; finite so the struct stays a plain number. */
  heavyPropMass: 1000,
  /** Field dressing never treats a wound below this severity (a scratch stays a scratch: the story stays on the body)... */
  dressFloor: 1,
  /** ...and never a stump below this (a dressed stump is still a stump). */
  stumpFloor: 2,
} as const;

export interface InjuryMods {
  /** Multiplies every walking speed (run, crouch, carry, drag). Never applied to a downed crawl. */
  speedMul: number;
  sprintOk: boolean;
  jumpOk: boolean;
  /** Heaviest prop (kg) this body can lift: 0 = nothing (both arms gone), `lightPropMass`, or `heavyPropMass`. */
  carryMaxMass: number;
  /** 0..1 multiplier on throw speed; 0 = cannot throw. */
  throwMul: number;
}

export const createInjuryMods = (): InjuryMods => ({ speedMul: 1, sprintOk: true, jumpOk: true, carryMaxMass: INJURY.heavyPropMass, throwMul: 1 });

/** Speed factor of one leg, and whether it lets the body sprint / jump. Inlined into `injuryMods` (no allocation). */
function legFactor(level: number, lost: boolean, peg: boolean): number {
  if (lost) return peg ? INJURY.leg.peg : INJURY.leg.lost;
  return level >= 3 ? INJURY.leg.grievous : level === 2 ? INJURY.leg.gash : 1;
}

function armPower(level: number, lost: boolean): number {
  if (lost) return 0;
  return level >= 3 ? INJURY.arm.grievous : level === 2 ? INJURY.arm.gash : 1;
}

/**
 * Fills `out` (and returns it). Allocation-free; safe to call once per simulation step. `wounds`/`missing` may be undefined
 * (schema numbers are undefined until first assigned on a client): the bitwise maths reads that as zero.
 */
export function injuryMods(wounds: number, missing: number, prosthetic: boolean, out: InjuryMods): InjuryMods {
  const lostLegL = (missing & LIMB.LEG_L) !== 0;
  const lostLegR = (missing & LIMB.LEG_R) !== 0;
  const lostArmL = (missing & LIMB.ARM_L) !== 0;
  const lostArmR = (missing & LIMB.ARM_R) !== 0;
  // One wooden leg replaces one lost leg (the left one if both are gone; the other stays a stump).
  const pegL = prosthetic && lostLegL;
  const pegR = prosthetic && lostLegR && !pegL;

  const legL = woundLevel(wounds, ZONE.LEG_L);
  const legR = woundLevel(wounds, ZONE.LEG_R);
  out.speedMul = legFactor(legL, lostLegL, pegL) * legFactor(legR, lostLegR, pegR);
  const legBad = lostLegL || lostLegR || legL >= 3 || legR >= 3;
  out.sprintOk = !legBad && woundLevel(wounds, ZONE.HEAD) < 3 && woundLevel(wounds, ZONE.TORSO) < 3;
  // A leg that is lost (peg or not) still forbids sprinting; a peg only buys the jump back when it replaces every lost leg.
  const jumpBad = (lostLegL && !pegL) || (lostLegR && !pegR) || (!lostLegL && legL >= 3) || (!lostLegR && legR >= 3);
  out.jumpOk = !jumpBad;

  const armL = woundLevel(wounds, ZONE.ARM_L);
  const armR = woundLevel(wounds, ZONE.ARM_R);
  const pL = armPower(armL, lostArmL);
  const pR = armPower(armR, lostArmR);
  const soundL = !lostArmL && armL <= 2;
  const soundR = !lostArmR && armR <= 2;
  out.carryMaxMass = lostArmL && lostArmR ? 0 : soundL && soundR ? INJURY.heavyPropMass : INJURY.lightPropMass;
  out.throwMul = (pL + pR) / 2;
  return out;
}

/** Can this body lift a prop of `mass` kg? (`injuryMods` first.) */
export const canCarry = (m: InjuryMods, mass: number): boolean => m.carryMaxMass > 0 && mass <= m.carryMaxMass;

/** Prompt / notice wording for a refused lift, so the client and the server say the same thing. */
export function carryRefusal(m: InjuryMods): string {
  return m.carryMaxMass <= 0 ? "You have no arms to carry that with." : "Your arm is in no state to carry that.";
}

/** Order in which equally bad wounds are dressed: what keeps a comrade moving first. */
const DRESS_ORDER = [ZONE.LEG_L, ZONE.LEG_R, ZONE.ARM_L, ZONE.ARM_R, ZONE.TORSO, ZONE.HEAD] as const;

/** Lowest severity a field dressing can leave on `zone`. */
function dressFloor(zone: number, missing: number): number {
  for (let i = 0; i < LIMB_LIST.length; i++) {
    const limb = LIMB_LIST[i]!;
    if ((missing & limb) !== 0 && limbZone(limb) === zone) return INJURY.stumpFloor;
  }
  return INJURY.dressFloor;
}

/**
 * The wound one field dressing would treat next: the worst zone still above its floor (ties: legs, arms, torso, head), or -1 when
 * there is nothing left that a dressing can help. Pure; the server decides, the client only uses it to word a prompt.
 */
export function dressableZone(wounds: number, missing: number): number {
  let best = -1;
  let bestLevel = 0;
  for (let i = 0; i < ZONE_COUNT; i++) {
    const z = DRESS_ORDER[i]!;
    const level = woundLevel(wounds, z);
    if (level > dressFloor(z, missing) && level > bestLevel) {
      best = z;
      bestLevel = level;
    }
  }
  return best;
}

/**
 * One field dressing: the worst dressable zone drops one severity level. Bounded by the floors, so total healing is finite:
 * a grievous limb takes two dressings to reach a scratch, and only new injuries create new work.
 */
export function dressWound(wounds: number, missing: number): number {
  const z = dressableZone(wounds, missing);
  return z < 0 ? wounds : setWound(wounds, z, woundLevel(wounds, z) - 1);
}
