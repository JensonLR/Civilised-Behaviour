import { HORSE_SEAT } from "../horse.ts";
import type { CharacterRig } from "./rig.ts";
import { solveArm, type ArmAngles } from "./weaponPose.ts";

/**
 * The rider's pose: seated on the horse, thighs along the barrel, feet in the stirrups, hands on the reins. A POST-PASS over the animator's own pose: the animator resets and
 * writes every joint each frame, then (when `PoseInput.ride` is set) calls `applyRidePose`, which blends the sitting pose over whatever the animator produced by `weight` (the
 * animator eases it, so mounting and dismounting never snap). The legs are solved, not keyed: closed-form two-bone IK puts each ankle on its stirrup whatever the rider's
 * proportions, and the arms use the weapon code's `solveArm` to put each hand on the reins. Allocation-free.
 */

export interface RideInput {
  /** 0..1 blend of the ride pose over the walking pose (the animator eases it; callers may pass 1). */
  weight?: number;
  /** The barrel's motion this frame (HorseAnimator.motion): its origin's height above rest and z shift (m, horse units), pitch (nose-up positive) and roll (radians). */
  bob: number;
  bodyZ?: number;
  pitch: number;
  roll: number;
  /** 0..1 speed fraction: the rider leans into the gallop. */
  speed01: number;
  /** The horse's scale (HorseRig.scale): the seat, stirrups and reins scale with it. Default 1. */
  scale?: number;
  /** Hands on the reins (default true); false leaves the arms to the animator (a drawn weapon, a raised fist). */
  reins?: boolean;
}

export const newRideInput = (): RideInput => ({ weight: 1, bob: 0, bodyZ: 0, pitch: 0, roll: 0, speed01: 0, scale: 1, reins: true });

/** The barrel's origin at rest (the horse builder's body pivot): seat, stirrups and hands are body-attached, so they are expressed relative to it. */
const BODY_Y = 0.62;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export interface LegAngles {
  /** hip rotation.x (forward positive), hip rotation.z (abduction: outward positive on the right leg, negative on the left) and knee rotation.x (negative folds the shin back). */
  hx: number;
  hz: number;
  kx: number;
}

/**
 * Two-bone leg IK in the rig's own joint conventions (Euler XYZ: the hip is `Rx(hx) Rz(hz)`, the knee `Rx(kx)`, a hanging limb points -Y and swings FORWARD with a positive
 * hx). Puts the ankle at (tx, ty, tz) relative to the hip joint (a target beyond reach straightens the leg toward it); the knee flexes so the shin goes back. Returns the residual in
 * metres (0 for a reachable target; `legFk` is the inverse and the test round-trips them).
 */
export function legIk(upper: number, lower: number, tx: number, ty: number, tz: number, out: LegAngles): number {
  const reach = (upper + lower) * 0.9995;
  let d = Math.hypot(tx, ty, tz);
  if (d > reach) {
    const k = reach / d;
    tx *= k;
    ty *= k;
    tz *= k;
    d = reach;
  }
  const minD = Math.abs(upper - lower) + 1e-3;
  if (d < minD) d = minD;
  const c = clamp((d * d - upper * upper - lower * lower) / (2 * upper * lower), -1, 1);
  const flex = Math.acos(c);
  const kx = -flex;
  const wy = -upper - lower * c;
  const wz = lower * Math.sin(flex);
  const beta = Math.asin(clamp(tx / Math.max(Math.abs(wy), 1e-6), -1, 1));
  const Y = wy * Math.cos(beta);
  const alpha = Math.atan2(tz, ty) - Math.atan2(wz, Y);
  out.hx = alpha;
  out.hz = beta;
  out.kx = kx;
  // The residual (m): what the angles actually reach versus the target (non-zero only beyond reach, or when the target lies more sideways than this hip's Euler order can point).
  legFk(upper, lower, out, fk);
  return Math.hypot(tx - fk.x, ty - fk.y, tz - fk.z);
}

/** The ankle for given leg angles, relative to the hip (the inverse of `legIk`, for tests). */
export function legFk(upper: number, lower: number, a: LegAngles, out: { x: number; y: number; z: number }): void {
  const wy = -upper - lower * Math.cos(a.kx);
  const wz = -lower * Math.sin(a.kx);
  // Rz(hz)
  const x1 = -wy * Math.sin(a.hz);
  const y1 = wy * Math.cos(a.hz);
  // Rx(hx)
  out.x = x1;
  out.y = y1 * Math.cos(a.hx) - wz * Math.sin(a.hx);
  out.z = y1 * Math.sin(a.hx) + wz * Math.cos(a.hx);
}

const fk = { x: 0, y: 0, z: 0 };
const legL: LegAngles = { hx: 0, hz: 0, kx: 0 };
const legR: LegAngles = { hx: 0, hz: 0, kx: 0 };
const arm: ArmAngles = { a: 0.9, b: 0.1, e: 0.9 };
const armSeed: [ArmAngles, ArmAngles] = [{ a: 0.9, b: -0.1, e: 0.9 }, { a: 0.9, b: 0.1, e: 0.9 }];

/** v := R^-1 v for R = Rx(rx) Rz(rz) (Euler XYZ with no y): undo X first, then Z. In place on a 3-array. */
function unrotate(v: { x: number; y: number; z: number }, rx: number, rz: number): void {
  const cx = Math.cos(-rx);
  const sx = Math.sin(-rx);
  const y1 = v.y * cx - v.z * sx;
  const z1 = v.y * sx + v.z * cx;
  const cz = Math.cos(-rz);
  const sz = Math.sin(-rz);
  const x2 = v.x * cz - y1 * sz;
  const y2 = v.x * sz + y1 * cz;
  v.x = x2;
  v.y = y2;
  v.z = z1;
}

const tgt = { x: 0, y: 0, z: 0 };

/**
 * Blends the riding pose over the pose the animator just wrote. Joints touched: pelvis (height, pitch, roll), torso (lean), both hips, knees, shoulders and elbows. Call after the
 * animator's own arm and leg work and before the head is levelled (the animator does this for `PoseInput.ride`). The seat, the stirrups and the hands are all attached to the barrel,
 * which pitches and rolls as one with the pelvis, so their targets in the pelvis's frame do not depend on the tilt: only the seat's place does.
 */
export function applyRidePose(rig: CharacterRig, ride: RideInput, w: number): void {
  if (!(w > 0)) return;
  const j = rig.joints;
  const P = rig.proportions;
  const s = ride.scale ?? 1;
  // the seat in the horse frame: the barrel's origin plus the seat offset turned by the barrel's pitch and roll (Rx(pitch) Rz(roll))
  const lx = 0;
  const ly = HORSE_SEAT.y - BODY_Y;
  const lz = HORSE_SEAT.z;
  const cz = Math.cos(ride.roll);
  const sz = Math.sin(ride.roll);
  const x1 = lx * cz - ly * sz;
  const y1 = lx * sz + ly * cz;
  const cx = Math.cos(ride.pitch);
  const sx = Math.sin(ride.pitch);
  const seatY = (BODY_Y + ride.bob + y1 * cx - lz * sx) * s;
  const seatZ = ((ride.bodyZ ?? 0) + y1 * sx + lz * cx) * s;
  const seatX = x1 * s;

  // ---- pelvis and spine: sits on the saddle, follows the barrel, leans into the gallop ----------------------------------------------------------------
  const lean = 0.06 + ride.speed01 * 0.14;
  const px = lerp(j.pelvis.rotation.x, ride.pitch, w);
  const pz = lerp(j.pelvis.rotation.z, ride.roll, w);
  j.pelvis.position.y = lerp(j.pelvis.position.y, seatY, w);
  j.pelvis.position.z = lerp(j.pelvis.position.z, seatZ, w);
  j.pelvis.position.x = lerp(j.pelvis.position.x, seatX, w);
  j.pelvis.rotation.x = px;
  j.pelvis.rotation.z = pz;
  j.pelvis.rotation.y = lerp(j.pelvis.rotation.y, 0, w);
  const tx = lerp(j.torso.rotation.x, -(lean + P.lean) - ride.pitch * 0.45, w);
  const tz = lerp(j.torso.rotation.z, -ride.roll * 0.6, w);
  j.torso.rotation.x = tx;
  j.torso.rotation.z = tz;
  j.torso.rotation.y = lerp(j.torso.rotation.y, 0, w);

  // ---- legs: ankles on the stirrups (barrel-attached, so relative to the seat they do not move with the tilt) ---------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    tgt.x = (side * HORSE_SEAT.stirrup.x - lx) * s - side * P.hipWidth;
    tgt.y = (HORSE_SEAT.stirrup.y - 0.03 - BODY_Y - ly) * s;
    tgt.z = (HORSE_SEAT.stirrup.z - lz) * s;
    const out = side < 0 ? legL : legR;
    legIk(P.legUpper, P.legLower, tgt.x, tgt.y, tgt.z, out);
    const hip = side < 0 ? j.hipL : j.hipR;
    const knee = side < 0 ? j.kneeL : j.kneeR;
    hip.rotation.x = lerp(hip.rotation.x, out.hx, w);
    hip.rotation.y = lerp(hip.rotation.y, 0, w);
    hip.rotation.z = lerp(hip.rotation.z, out.hz, w);
    knee.rotation.x = lerp(knee.rotation.x, out.kx, w);
  }

  // ---- arms: hands on the reins (or left to the animator when a weapon is up) ---------------------------------------------------------------------------------------
  if (ride.reins === false) return;
  const shoulderY = P.torsoHeight * 0.88;
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? j.shoulderL : j.shoulderR;
    const el = side < 0 ? j.elbowL : j.elbowR;
    const seed = armSeed[side < 0 ? 0 : 1]!;
    // hand (barrel-attached) -> pelvis frame -> torso frame -> shoulder frame
    tgt.x = (side * HORSE_SEAT.hand.x - lx) * s;
    tgt.y = (HORSE_SEAT.hand.y - BODY_Y - ly) * s - 0.04 * P.scale; // (the torso group sits a little above the pelvis joint)
    tgt.z = (HORSE_SEAT.hand.z - lz) * s;
    unrotate(tgt, tx, tz);
    Object.assign(arm, seed);
    solveArm(P.armUpper, P.armLower, side === 1 ? 1 : -1, tgt.x - side * P.shoulderHalfWidth, tgt.y - shoulderY, tgt.z, arm);
    seed.a = arm.a;
    seed.b = arm.b;
    seed.e = arm.e;
    sh.rotation.x = lerp(sh.rotation.x, arm.a, w);
    sh.rotation.z = lerp(sh.rotation.z, arm.b, w);
    el.rotation.x = lerp(el.rotation.x, arm.e, w);
  }
}
