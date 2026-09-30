import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { legRadius, ringAt, type BodyCtx } from "./bodyKit.ts";
import { skirtRings, skirtSpec, torsoRings } from "./garments.ts";
import { sleeveFull, upperLegRings } from "./limbRings.ts";

/**
 * How far out from the body the arms must hang so that they clear it. An arm hangs from the shoulder, and a stout torso, wide hips or a coat skirt can be wider than the
 * shoulders are: at the default 5 degrees the sleeve and the hand would then hang inside the skirt or the belly. This answers, for one body (its proportions and its coat), the smallest
 * abduction (radians from the vertical) at which every part of the arm - elbow, forearm, the back of the hand - stands outside the body's outline by a margin. The animator uses it as its
 * resting arm angle, so the arms of a wide man hang clear of him and the arms of a thin man do not stick out.
 */

const MARGIN = 0.025;
const MAX = 0.5;

/** A minimal BodyCtx: enough for the ring tables that give the body's outline (colours do not matter). */
function shapeCtx(spec: CharacterSpec, P: Proportions): BodyCtx {
  return { spec, P, skin: 0, jacketC: 0, trouserC: 0, shirtC: 0, armC: 0, accent: 0, burnt: 0, footH: 0.05 * P.scale, leather: 0 };
}

export interface BodyOutline {
  /** Half-width of the body (torso, coat skirt, hips or legs, whichever is widest) at `depth` metres below the shoulder joint. */
  halfWidth(depth: number): number;
}

/** The outline of the body seen from the front, by depth below the shoulder joint (metres). */
export function bodyOutline(spec: CharacterSpec, P: Proportions): BodyOutline {
  const c = shapeCtx(spec, P);
  const torso = torsoRings(P, 0, spec.jacket);
  const legs = upperLegRings(c);
  const sk = skirtSpec(spec, P);
  const skirt = sk && sk.len > 0 ? skirtRings(c, sk.len, sk.flare, 0, 0) : undefined;
  const shoulderY = P.torsoHeight * 0.88;
  const pelvisAbove = 0.04 * P.scale; // (the torso's origin sits this far above the pelvis's)
  const r = legRadius(c);
  void r;
  return {
    halfWidth(depth: number): number {
      const yT = shoulderY - depth; // torso frame
      const yP = yT + pelvisAbove; // pelvis frame
      let w = 0;
      if (yT >= -0.05 * P.torsoHeight) w = Math.max(w, ringAt(torso, yT).rx - 0.025); // (a sleeve may brush the trunk: the arm hangs from its edge)
      if (yP <= 0.1 * P.scale) {
        w = Math.max(w, P.hipWidth + ringAt(legs, Math.min(yP, 0.04)).rx);
        if (skirt) w = Math.max(w, ringAt(skirt, yP).rx);
      }
      return w;
    },
  };
}

/** The resting arm abduction (radians, from the vertical) this body needs: never less than `base`. */
export function armRestAbduction(spec: CharacterSpec, P: Proportions, base = 0.08): number {
  const out = bodyOutline(spec, P);
  const f = sleeveFull(spec.jacket);
  const r = P.armRadius;
  // points along the arm: distance from the shoulder joint, and half-thickness of the arm (across the body) there
  const pts: { s: number; rad: number }[] = [];
  const U = P.armUpper;
  const L = P.armLower;
  for (const t of [0.35, 0.6, 0.85, 1]) pts.push({ s: U * t, rad: r * 1.36 * f });
  for (const t of [0.15, 0.4, 0.7, 1]) pts.push({ s: U + L * t, rad: r * 1.02 * f });
  pts.push({ s: U + L + P.handRadius * 0.5, rad: P.handRadius * 0.42 });
  for (let a = base; a <= MAX; a += 0.02) {
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    let ok = true;
    for (const p of pts) {
      if (P.shoulderHalfWidth + p.s * sa - p.rad < out.halfWidth(p.s * ca) + MARGIN) {
        ok = false;
        break;
      }
    }
    if (ok) return a;
  }
  return MAX;
}

/**
 * The deepest knee bend (radians) at which the calf and the thigh still clear each other: two limbs of the leg's radius meet at the knee at an angle, and at a distance `d` along both
 * their axes are `2 d sin(a / 2)` apart, which must be at least the sum of their radii. A thin leg folds almost double; a stout or short one stops much sooner.
 */
export function kneeFlexLimit(spec: CharacterSpec, P: Proportions): number {
  const r = legRadius(shapeCtx(spec, P));
  const thick = spec.trousers === 2 ? 1.5 : spec.trousers === 3 || spec.trousers === 4 || spec.trousers === 5 ? 1.35 : 1.2; // (breeches and the baggy cuts puff the thigh)
  const d = 0.75 * Math.min(P.legUpper, P.legLower);
  const ratio = Math.min(0.9, (r * thick + r * 0.95) / (2 * d));
  return Math.max(0.6, Math.PI - 2 * Math.asin(ratio));
}
