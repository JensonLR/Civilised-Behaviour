import { HORSE_SEAT } from "../horse.ts";
import { barrelOutside } from "./horse.ts";
import type { CharacterRig } from "./rig.ts";
import { solveArm, type ArmAngles } from "./weaponPose.ts";

/**
 * The rider's pose: seated on the horse, thighs along the barrel, feet in the stirrups, hands on the reins. A POST-PASS over the animator's own pose: the animator resets and
 * writes every joint each frame, then (when `PoseInput.ride` is set) calls `applyRidePose`, which blends the sitting pose over whatever the animator produced by `weight` (the
 * animator eases it, so mounting and dismounting never snap). The legs are solved, not keyed, and go ROUND the barrel (`fitRideLegs`): each ankle as near its stirrup as a leg
 * of the rider's length can reach without passing through the horse (a long-legged rider's foot is in the iron; a short-legged one straddles the cob with the legs splayed), and
 * the arms use the weapon code's `solveArm` to put each hand on the reins. Allocation-free per frame (the legs' fit is worked out once per rider and horse, then cached).
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
  /** The horse's barrel width factor (HorseRig.girth): the legs go round it. Default `RIDE_GIRTH`. */
  girth?: number;
  /** OUT: where the rider's right stirrup iron hangs (the pose writes it; the horse hangs its irons there with `HorseRig.setStirrups`): the leathers are let down or taken up to the rider's leg. */
  iron?: StirrupPlace;
}

/** A stirrup iron's place in the horse's body frame (horse units; the right one, the left mirrors in x): its centre, its half-width (it fits the boot) and its turn about the vertical (it faces the way the toes point). */
export interface StirrupPlace {
  x: number;
  y: number;
  z: number;
  half: number;
  yaw: number;
}

/** A middling cob's barrel factor, for a ride input that does not say. */
export const RIDE_GIRTH = 0.85;

export const newRideInput = (): RideInput => ({ weight: 1, bob: 0, bodyZ: 0, pitch: 0, roll: 0, speed01: 0, scale: 1, reins: true, girth: RIDE_GIRTH, iron: { x: 0, y: 0, z: 0, half: 0, yaw: 0 } });

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

/** The right leg's riding angles (the hip's full Euler XYZ, the knee's hinge), the left mirrors them; and how near the ankle came to its stirrup (m). */
export interface RideLegs {
  hx: number;
  hy: number;
  hz: number;
  kx: number;
  /** Ankle to stirrup (m): 0 when the leg reaches round the barrel to the iron. */
  miss: number;
  /** The deepest a sampled point of the leg lies inside the barrel (grown by the leg's half-thickness), as `barrelOutside` measures it: >= 0 is clear. */
  depth: number;
  /** Where the right iron goes so the boot stands in it (see `StirrupPlace`). */
  iron: StirrupPlace;
}

/** The boot, for placing the iron under it (metres): the sole's drop below the ankle, the foot's length and width. */
export interface RideFoot {
  h: number;
  len: number;
  w: number;
}

/**
 * Fits a rider's right leg to the horse: the hip at the seat, the thigh and shin of the rider's lengths, the ankle as near the stirrup as it can get while the leg (from a little
 * out of the saddle down to the ankle, thickened by `pad`) stays outside the barrel. A long leg wraps the barrel and puts the foot in the iron; a short one cannot, and straddles
 * the cob with the knee out over the flank (a child on a carthorse). A search over the thigh's swing and spread and the shin's splay, then two finer passes round the best;
 * deterministic. Everything is in the seat's frame in metres (the barrel moves with the seat, so the answer holds for any pitch and roll).
 */
export function fitRideLegs(upper: number, lower: number, hipWidth: number, pad: number, scale: number, girth: number, foot: RideFoot = { h: 0.05, len: 0.4, w: 0.18 }): RideLegs {
  const s = scale;
  const ly = HORSE_SEAT.y - BODY_Y;
  const lz = HORSE_SEAT.z;
  const ax = HORSE_SEAT.stirrup.x * s - hipWidth;
  const ay = (HORSE_SEAT.stirrup.y - 0.03 - BODY_Y - ly) * s;
  const az = (HORSE_SEAT.stirrup.z - lz) * s;
  // how deep a point (relative to the hip, metres) is in the padded barrel: < 0 inside
  const outside = (x: number, y: number, z: number): number => barrelOutside(girth, (x + hipWidth) / s, y / s + ly, z / s + lz, pad / s);
  // the thigh is checked from where it leaves the saddle (a short thigh is all saddle but its knee), the shin all the way
  const t0 = Math.min(0.85, Math.max(0.45, 0.13 / Math.max(upper, 1e-3)));
  const evaluate = (a: number, b: number, g: number, out: RideLegs | undefined, bound = Infinity): number => {
    const tx = Math.sin(b);
    const ty = -Math.cos(b) * Math.cos(a);
    const tz = -Math.cos(b) * Math.sin(a);
    const kx0 = tx * upper;
    const ky0 = ty * upper;
    const kz0 = tz * upper;
    let sx = ax - kx0 + g;
    let sy = ay - ky0;
    let sz = az - kz0;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= sl;
    sy /= sl;
    sz /= sl;
    const ex = kx0 + sx * lower - ax;
    const ey = ky0 + sy * lower - ay;
    const ez = kz0 + sz * lower - az;
    const miss = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const cosF = clamp(tx * sx + ty * sy + tz * sz, -1, 1);
    const fold = Math.acos(cosF);
    // the hip frame: its -Y down the thigh, its +Z the way the shin folds (the knee hinges about X and folds the shin back, toward +Z)
    let zx = sx - cosF * tx;
    let zy = sy - cosF * ty;
    let zz = sz - cosF * tz;
    let zl = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (zl < 1e-4) {
      // a straight leg: fold toward the horse's tail
      zx = -tz * tx;
      zy = -tz * ty;
      zz = 1 - tz * tz;
      zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    }
    zx /= zl;
    zy /= zl;
    zz /= zl;
    // The foot has no joint of its own: it points along the shin frame's -Z, which is sin(fold) T - cos(fold) Z of the hip frame. A knee that folds DOWN over a thigh laid out
    // sideways turns the toes out like a wing; a seat folds the knee fore and aft (thigh forward, shin back), so the toes point where the horse goes (-Z).
    const footZ = Math.sin(fold) * tz - cosF * zz;
    // clear of the horse first, then the stirrup; toes forward; a little spread and a thigh that goes forward, as a seat does; a shin that hangs, not one that climbs; no knee folded flat
    const cheap = 0.75 * miss + 0.5 * (1 + footZ) + 0.03 * b + 0.05 * Math.max(0, -a) + Math.max(0, sy + 0.25) + Math.max(0, fold - 2.3);
    if (!out && cheap >= bound) return cheap; // (the barrel can only add: no need to probe it)
    let depth = 0;
    for (let k = 0; k <= 9; k++) {
      // the knee first (k = 0), then down the shin, then back up the thigh: the probes most likely inside come first, so a hopeless pose stops early
      const o =
        k < 5
          ? outside(kx0 + sx * ((lower * k) / 4), ky0 + sy * ((lower * k) / 4), kz0 + sz * ((lower * k) / 4))
          : outside(tx * upper * (t0 + ((1 - t0) * (k - 5)) / 4), ty * upper * (t0 + ((1 - t0) * (k - 5)) / 4), tz * upper * (t0 + ((1 - t0) * (k - 5)) / 4));
      if (-o > depth) {
        depth = -o;
        if (!out && cheap + 4 * depth >= bound) return cheap + 4 * depth;
      }
    }
    const cost = cheap + 4 * depth;
    if (out) {
      const yx = -tx;
      const yy = -ty;
      const yz = -tz;
      // X = Y x Z (only its x is needed)
      const xx = yy * zz - yz * zy;
      // Euler XYZ from the matrix with columns X, Y, Z (three's convention: m13 = Z.x, m23 = Z.y, m33 = Z.z, m12 = Y.x, m11 = X.x, m32 = Y.z, m22 = Y.y)
      out.hy = Math.asin(clamp(zx, -1, 1));
      if (Math.abs(zx) < 0.9999999) {
        out.hx = Math.atan2(-zy, zz);
        out.hz = Math.atan2(-yx, xx);
      } else {
        out.hx = Math.atan2(yz, yy);
        out.hz = 0;
      }
      out.kx = -fold;
      out.miss = miss;
      out.depth = depth;
      // the iron: its tread under the ball of the foot (the sole is `foot.h` down the shin from the ankle, the ball a fifth of the foot ahead of it along the toes), in the barrel's frame
      const fx = Math.sin(fold) * tx - cosF * zx;
      const fy = Math.sin(fold) * ty - cosF * zy;
      const fz = footZ;
      const half = Math.max(0.05, foot.w / 2 + 0.015) / s;
      const px = kx0 + sx * (lower + foot.h) + fx * foot.len * 0.22 + hipWidth;
      const py = ky0 + sy * (lower + foot.h) + fy * foot.len * 0.22;
      const pz = kz0 + sz * (lower + foot.h) + fz * foot.len * 0.22;
      out.iron.x = px / s;
      out.iron.y = py / s + ly + half * 1.2;
      out.iron.z = pz / s + lz;
      out.iron.half = half;
      out.iron.yaw = Math.atan2(fx, fz);
    }
    return cost;
  };
  let bestA = 0.6;
  let bestB = 0.3;
  let bestG = 0;
  let best = Infinity;
  for (let ia = 0; ia <= 18; ia++)
    for (let ib = 0; ib <= 15; ib++)
      for (let ig = 0; ig <= 6; ig++) {
        const a = -0.3 + ia * 0.1;
        const b = ib * 0.1;
        const g = ig * 0.2;
        const c = evaluate(a, b, g, undefined, best);
        if (c < best - 1e-9) {
          best = c;
          bestA = a;
          bestB = b;
          bestG = g;
        }
      }
  for (const step of [0.04, 0.015]) {
    const ca = bestA;
    const cb = bestB;
    const cg = bestG;
    for (let ia = -2; ia <= 2; ia++)
      for (let ib = -2; ib <= 2; ib++)
        for (let ig = -2; ig <= 2; ig++) {
          const a = ca + ia * step;
          const b = Math.max(0, cb + ib * step);
          const g = Math.max(0, cg + ig * step * 2);
          const c = evaluate(a, b, g, undefined, best);
          if (c < best - 1e-9) {
            best = c;
            bestA = a;
            bestB = b;
            bestG = g;
          }
        }
  }
  const out: RideLegs = { hx: 0, hy: 0, hz: 0, kx: 0, miss: 0, depth: 0, iron: { x: 0, y: 0, z: 0, half: 0, yaw: 0 } };
  evaluate(bestA, bestB, bestG, out);
  return out;
}

/** The fit for a rider on a horse of this scale and girth, worked out the first time and kept on the rig (a rider changes horse rarely; the fit is a few thousand probes). */
const fitCache = new WeakMap<CharacterRig, { scale: number; girth: number; legs: RideLegs }>();
function rideLegsFor(rig: CharacterRig, scale: number, girth: number): RideLegs {
  const hit = fitCache.get(rig);
  if (hit && hit.scale === scale && hit.girth === girth) return hit.legs;
  const P = rig.proportions;
  const legs = fitRideLegs(P.legUpper, P.legLower, P.hipWidth, rideLegPad(P.scale), scale, girth, { h: 0.05 * P.scale, len: P.footLength, w: P.footWidth });
  fitCache.set(rig, { scale, girth, legs });
  return legs;
}

/** How far the leg's axis keeps off the barrel: most of a trouser leg's half-thickness (`legRadius`: 0.1 x scale + 2 cm of cloth) and the blanket under it; the last few centimetres of cloth press into the saddle flap, as a real leg does. */
export const rideLegPad = (riderScale: number): number => 0.5 * (0.1 * riderScale + 0.02) + 0.015;

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

  // ---- legs: round the barrel toward the stirrups (barrel-attached, so in the seat's frame the fit does not move with the tilt: worked out once, then cached) --------------------
  const fit = rideLegsFor(rig, s, ride.girth ?? RIDE_GIRTH);
  const iron = ride.iron;
  if (iron) {
    iron.x = fit.iron.x;
    iron.y = fit.iron.y;
    iron.z = fit.iron.z;
    iron.half = fit.iron.half;
    iron.yaw = fit.iron.yaw;
  }
  for (const side of [-1, 1] as const) {
    const hip = side < 0 ? j.hipL : j.hipR;
    const knee = side < 0 ? j.kneeL : j.kneeR;
    // (the right leg is solved; the left is its mirror across the horse's centre plane: x swings the same, y and z turn the other way)
    hip.rotation.x = lerp(hip.rotation.x, fit.hx, w);
    hip.rotation.y = lerp(hip.rotation.y, side * fit.hy, w);
    hip.rotation.z = lerp(hip.rotation.z, side * fit.hz, w);
    knee.rotation.x = lerp(knee.rotation.x, fit.kx, w);
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
