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
/** An arm beside hip gear may stand out further (the body alone never asks for more than MAX): on an extreme stubby body the gear stands a hand's width beyond the belly, and the arm that swings past it must clear it (about 57 degrees; hipGear.test.ts). */
const MAX_GEAR = 1.0;

/** A minimal BodyCtx: enough for the ring tables that give the body's outline (colours do not matter). */
function shapeCtx(spec: CharacterSpec, P: Proportions): BodyCtx {
  return { spec, P, skin: 0, jacketC: 0, trouserC: 0, shirtC: 0, armC: 0, accent: 0, burnt: 0, footH: 0.05 * P.scale, leather: 0 };
}

export interface BodyOutline {
  /** Half-width of the body (torso, coat skirt, hips or legs, whichever is widest) at `depth` metres below the shoulder joint. */
  halfWidth(depth: number): number;
}

/**
 * Hip gear that hangs beside the body on one side: how far it stands out beyond the body's WIDEST point over the heights it covers (gear.ts places each of these off `reach`, the widest
 * of the torso, the coat skirt and the thighs over its span, never off the local width), and over which torso-frame heights. `extra` is the offset at the top of the span, `extraLow` at the bottom
 * (a sabre's scabbard swings outward toward the chape). A hand that hangs beside a holster, a canteen, a scabbard, a machete, a coil of rope, a satchel or a birdcage must clear THAT, so the arm on that side rests further out.
 */
export function gearOnSide(spec: CharacterSpec, P: Proportions, side: "L" | "R"): { yLo: number; yHi: number; extra: number; extraLow: number } | undefined {
  const h = P.torsoHeight;
  const u = Math.max(0.8, Math.min(1.18, h / 0.6));
  const g = spec.hipGear;
  const leg = P.legUpper + P.legLower;
  const same = (yLo: number, yHi: number, extra: number): { yLo: number; yHi: number; extra: number; extraLow: number } => ({ yLo, yHi, extra, extraLow: extra });
  if (side === "R") {
    if (g === 1) return same(h * 0.08 - 0.11 * u, h * 0.08 + 0.2 * u, 0.03 + 0.068 * u);
    if (g === 6) return same(h * 0.04 - Math.min(0.44, leg * 0.5), h * 0.04 + 0.22, 0.115);
    if (g === 7) return same(h * 0.08 - 0.14 * u - 0.4, h * 0.08 + 0.14, 0.118 + 0.06 * u);
  } else {
    if (g === 2) return same(h * 0.06 - 0.105 * u, h * 0.06 + 0.2 * u, 0.076 * u + 0.006);
    if (g === 5) return { yLo: h * 0.1 - Math.min(0.78, leg * 0.8 + h * 0.1), yHi: h * 0.1 + 0.19, extra: 0.06, extraLow: 0.15 };
    if (spec.pack === 3) return same(h * 0.02 - 0.125 * u, h * 0.02 + 0.2 * u, 0.118 * u + 0.008);
    if (spec.pack === 8) return same(h * 0.02 - 0.13 * u, h * 0.02 + 0.25 * u, 0.212 * u + 0.012);
  }
  return undefined;
}

/** The outline of the body seen from the front, by depth below the shoulder joint (metres). */
export function bodyOutline(spec: CharacterSpec, P: Proportions, side?: "L" | "R"): BodyOutline {
  const c = shapeCtx(spec, P);
  const torso = torsoRings(P, 0, spec.jacket);
  const legs = upperLegRings(c);
  const sk = skirtSpec(spec, P);
  const skirt = sk && sk.len > 0 ? skirtRings(c, sk.len, sk.flare, 0, 0) : undefined;
  const shoulderY = P.torsoHeight * 0.88;
  const pelvisAbove = 0.04 * P.scale; // (the torso's origin sits this far above the pelvis's)
  const r = legRadius(c);
  void r;
  const gear = side ? gearOnSide(spec, P, side) : undefined;
  const body = (yT: number): number => {
    const yP = yT + pelvisAbove; // pelvis frame
    let w = 0;
    if (yT >= -0.05 * P.torsoHeight) w = Math.max(w, ringAt(torso, yT).rx - 0.025); // (a sleeve may brush the trunk: the arm hangs from its edge)
    if (yP <= 0.1 * P.scale) {
      w = Math.max(w, P.hipWidth + ringAt(legs, Math.min(yP, 0.04)).rx);
      if (skirt) w = Math.max(w, ringAt(skirt, yP).rx);
    }
    return w;
  };
  // gear stands off the widest the body gets over its whole span (gear.ts: `reach`), so the span's widest is found once, here
  let spanWidest = 0;
  if (gear) for (let i = 0; i <= 12; i++) spanWidest = Math.max(spanWidest, body(gear.yLo + ((gear.yHi - gear.yLo) * i) / 12));
  return {
    halfWidth(depth: number): number {
      const yT = shoulderY - depth; // torso frame
      let w = body(yT);
      if (gear && yT >= gear.yLo && yT <= gear.yHi) {
        const t = (yT - gear.yLo) / (gear.yHi - gear.yLo || 1);
        w = Math.max(w, spanWidest + gear.extraLow + (gear.extra - gear.extraLow) * t);
      }
      return w;
    },
  };
}

/** The resting arm abduction (radians, from the vertical) this body needs: never less than `base`. */
export function armRestAbduction(spec: CharacterSpec, P: Proportions, base = 0.08, side?: "L" | "R"): number {
  const out = bodyOutline(spec, P, side);
  const f = sleeveFull(spec.jacket);
  const r = P.armRadius;
  // points along the arm: distance from the shoulder joint, and half-thickness of the arm (across the body) there
  const pts: { s: number; rad: number }[] = [];
  const U = P.armUpper;
  const L = P.armLower;
  for (const t of [0.35, 0.6, 0.85, 1]) pts.push({ s: U * t, rad: r * 1.36 * f });
  for (const t of [0.15, 0.4, 0.7, 1]) pts.push({ s: U + L * t, rad: r * 1.02 * f });
  pts.push({ s: U + L + P.handRadius * 0.5, rad: P.handRadius * 0.42 });
  const limit = side && gearOnSide(spec, P, side) ? MAX_GEAR : MAX;
  for (let a = base; a <= limit; a += 0.02) {
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
  return limit;
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

/**
 * What the body has in front of and around its thighs to fold them against, each 0..1: `belly` (a paunch sticks out further than the thigh is long) and `skirt` (a coat skirt that
 * hangs over the knees: a rigid skirt cannot ride up, so a deep crouch drives the knees through it). The animator lifts the thigh less in a crouch or a kneel for either, and splays
 * the knees wider and leans less for a belly only (a skirt hangs straight: wider knees would go through its sides).
 */
export function crouchObstruction(spec: CharacterSpec, P: Proportions): { belly: number; skirt: number } {
  const belly = Math.max(0, Math.min(1, P.bellyForward / (0.55 * P.legUpper + 0.05)));
  const sk = skirtSpec(spec, P);
  const skirt = sk ? Math.max(0, Math.min(1, sk.len / (P.legUpper * 1.4))) : 0;
  return { belly, skirt };
}
