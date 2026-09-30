import { FLAG } from "@cb/shared";
import type { ExpressionId } from "./animator.ts";
import type { CharacterRig } from "./rig.ts";

/**
 * Things the animator does not do (and that its owner is not editing): the hands. `HandPoser` turns what a character is doing into a grip for each hand
 * (`rig.setHandGrip`, 0 relaxed .. 1 fist) and eases it, so fists clench with anger, hands open in fear, a carried load is held, a sprint pumps loose fists and a
 * weapon or tool in the hand can force its own grip. Pure targets (`handGripTargets`) are separate from the easing so they can be tested and reused.
 */

export interface HandInput {
  /** FLAG bits from @cb/shared (the same flags the animator gets). */
  flags: number;
  /** Horizontal speed, m/s. */
  speed: number;
  /** The character's current expression (the animator's `currentExpression`). */
  expression: ExpressionId;
  /**
   * Grip forced by something held in that hand (a hilt 0.8, a rifle stock 0.75, a lantern handle 0.85, a bottle 0.7). Wins over everything except a missing/hooked hand
   * (which ignores grips anyway). `undefined` = nothing held.
   */
  holdL?: number | undefined;
  holdR?: number | undefined;
}

/** Target grips for both hands, before easing. */
export function handGripTargets(input: HandInput): { L: number; R: number } {
  const { flags, speed, expression } = input;
  const carrying = (flags & FLAG.CARRYING) !== 0;
  const dragging = (flags & FLAG.DRAGGING) !== 0;
  const reviving = (flags & FLAG.REVIVING) !== 0;
  const sprinting = (flags & FLAG.SPRINTING) !== 0;
  // gait: hanging hands are loose; a run curls them; a sprint clenches them
  let base = speed < 0.4 ? 0.1 : Math.min(0.5, 0.18 + speed * 0.06);
  if (sprinting) base = 0.75;
  let L = base;
  let R = base;
  if (reviving) L = R = 0.3; // hands pressing on a patient
  if (carrying) L = R = 0.85; // holding a load
  if (dragging) L = R = 0.92; // gripping a body under the arms
  switch (expression) {
    case "pain":
      R = Math.max(R, 1); // the hand clutched to the belly
      L = Math.max(L, 0.55);
      break;
    case "fear":
      L = R = Math.min(L, 0.28) + 0.1; // hands up, fingers spread and trembling
      break;
    case "triumph":
    case "angry":
      L = R = 1;
      break;
    case "drunk":
      L = R = Math.min(L, 0.05);
      break;
    default:
      break;
  }
  if (input.holdL !== undefined) L = input.holdL;
  if (input.holdR !== undefined) R = input.holdR;
  return { L, R };
}

const damp = (a: number, b: number, rate: number, dt: number): number => a + (b - a) * (1 - Math.exp(-rate * dt));

/** Eases a rig's hands toward their targets. Call once per frame after the animator; allocation-free. */
export class HandPoser {
  private l = 0;
  private r = 0;
  private readonly input: HandInput = { flags: 0, speed: 0, expression: "neutral" };

  constructor(private readonly rig: CharacterRig) {
    this.l = rig.handGrip("L");
    this.r = rig.handGrip("R");
  }

  update(dt: number, flags: number, speed: number, expression: ExpressionId, holdL?: number, holdR?: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const i = this.input;
    i.flags = flags;
    i.speed = speed;
    i.expression = expression;
    i.holdL = holdL;
    i.holdR = holdR;
    const t = handGripTargets(i);
    // a hand closing on something is quicker than one relaxing
    this.l = damp(this.l, t.L, t.L > this.l ? 16 : 9, dt);
    this.r = damp(this.r, t.R, t.R > this.r ? 16 : 9, dt);
    this.rig.setHandGrip("L", this.l);
    this.rig.setHandGrip("R", this.r);
  }
}
