import { WEAPON } from "@cb/shared";
import type { V3 } from "./parts.ts";

/**
 * How a caricature holds, aims, fires, reloads and swings a weapon. Pure maths (no three.js): the animator feeds it the frame's combat state
 * and body proportions and gets back
 *   - where the weapon is (position and Euler XYZ rotation in the TORSO's frame, so it moves with lean, twist and recoil), and
 *   - where each hand must be, solved into shoulder and elbow angles by a small analytic-numeric arm IK (`solveArm`), so the fist really is
 *     on the grip whatever the arm length, and the weapon is never a rigid prop stuck to a wave of the arms.
 * Weapon model space (see `WEAPON_ANCHORS`): the origin is the RIGHT hand's grip, -Z points down the barrel/blade, +Y is up, +X is the wielder's right.
 * Conventions match the animator: a hanging limb swings FORWARD (toward -Z) with +rotation.x, shoulders abduct with rotation.z (negative on the left,
 * positive on the right), an elbow flexes forward with +rotation.x; the torso frame has the shoulders at (+-hw, sy, 0) and looks down -Z.
 */

/** Named points on a weapon, in weapon model space (metres). The client's model builders build the geometry around exactly these. */
export interface Anchors {
  /** Where the left hand goes on a two-handed weapon (the fore-end, the guard). */
  left: V3;
  /** Muzzle or blade tip. */
  muzzle: V3;
  /** The lock/pan (where priming happens). */
  lock: V3;
  /** Butt plate or pommel. */
  butt: V3;
  /** How far the ramrod comes out of the muzzle end when drawn (0 for no rod). */
  rod: number;
  /** Direction (weapon space) the RIGHT fist wraps round: the axis of the handle it holds (a raked pistol grip, the small of a stock, a hilt, a cane's shaft). The hand's local Z is laid on it. */
  grip: V3;
  /** Same for the left hand on the fore-end of a two-handed piece (undefined: the left hand holds nothing). */
  gripL?: V3;
}

export const WEAPON_ANCHORS: Record<number, Anchors> = {
  // (the pistol's walnut grip and the small of a stock lean back: the handle's axis rises and tilts forward; a hilt and a cane's shaft lie along the blade)
  [WEAPON.PISTOL]: { left: [0, -0.02, -0.12], muzzle: [0, 0.022, -0.36], lock: [0, 0.04, -0.03], butt: [0, -0.1, 0.075], rod: 0.28, grip: [0, 0.95, -0.31] },
  [WEAPON.RIFLE]: { left: [0, -0.05, -0.36], muzzle: [0, 0.03, -1.0], lock: [0, 0.06, -0.03], butt: [0, -0.02, 0.24], rod: 0.7, grip: [0, 0.94, -0.34], gripL: [0, 0, -1] },
  [WEAPON.BLUNDERBUSS]: { left: [0, -0.05, -0.27], muzzle: [0, 0.03, -0.66], lock: [0, 0.06, -0.03], butt: [0, -0.02, 0.24], rod: 0.4, grip: [0, 0.94, -0.34], gripL: [0, 0, -1] },
  [WEAPON.SABRE]: { left: [0, 0, 0.09], muzzle: [0, -0.05, -0.98], lock: [0, 0, 0], butt: [0, 0, 0.09], rod: 0, grip: [0, 0, -1] },
  [WEAPON.UMBRELLA]: { left: [0, 0, 0.08], muzzle: [0, 0, -0.95], lock: [0, 0, 0], butt: [0, 0, 0.1], rod: 0, grip: [0, 0, -1] },
};

/** Per-frame combat input from the game. Everything is cosmetic. */
export interface WeaponPoseInput {
  /** Weapon id (`WEAPON`), or -1 for none drawn (bare hands). */
  id: number;
  /** 0..1: how much the wielder is aiming down the weapon (ease it in the caller or leave it: the animator damps it). */
  aim: number;
  /** Elevation of the aim, radians, + = up. */
  elev: number;
  /** 1 the instant a shot leaves, decaying to 0 (the caller owns the decay: recoil is a picture of the last shot). */
  fire: number;
  /** 0 = not reloading, else 0..1 progress of the reload. */
  reload: number;
  /** -1 = no blow in flight, else 0..1 progress of the blow (windup, strike, recovery), and which variant. */
  swing: number;
  swingKind: number;
  /** First-person: 0..1, tucks the aimed weapon toward the middle of the view and lowers it so the barrel sits under the eye line. */
  fp: number;
  /** Working a cannon: 0..1. */
  crew: number;
  /** Hidden: hands are busy (carrying, dragging, kneeling, downed). The weapon is not drawn and the arms are the animator's. */
  hidden: boolean;
}

export const newWeaponPoseInput = (): WeaponPoseInput => ({ id: -1, aim: 0, elev: 0, fire: 0, reload: 0, swing: -1, swingKind: 0, fp: 0, crew: 0, hidden: false });

/** The body measurements a hold depends on. */
export interface HoldBody {
  /** Shoulder half width, shoulder height above the torso origin, upper and lower arm lengths, torso depth. */
  hw: number;
  sy: number;
  upper: number;
  lower: number;
  depth: number;
  /** Hand radius (metres): the fist's centre is a little below the wrist joint, and the wrist is placed so that the CENTRE of the fist is on the grip. Optional (default 0.08). */
  hand?: number;
}

export interface HandTarget {
  x: number;
  y: number;
  z: number;
  /** 0..1 how firmly this hand is on the weapon (0 = the arm is free and keeps its gait). */
  w: number;
  /** Unit direction (torso frame) of the handle this fist wraps round, or (0, 0, 0) when it holds nothing with an axis (a free hand, a bare fist, the reload's work). See `solveWrist`. */
  ax: number;
  ay: number;
  az: number;
}

export interface HoldOut {
  visible: boolean;
  /** Weapon transform in the torso frame: position and Euler XYZ rotation. */
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  right: HandTarget;
  left: HandTarget;
  /** Extra torso yaw and lean (radians, lean + = back) from the blow or the kick. */
  twist: number;
  lean: number;
  /** How far out of the muzzle the ramrod is (metres), for the model. */
  rod: number;
}

export const newHoldOut = (): HoldOut => ({ visible: false, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, right: { x: 0, y: 0, z: 0, w: 0, ax: 0, ay: 0, az: 0 }, left: { x: 0, y: 0, z: 0, w: 0, ax: 0, ay: 0, az: 0 }, twist: 0, lean: 0, rod: 0 });

// ---- small maths ------------------------------------------------------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Euler XYZ (three's default order: a vector is rotated by Z first, then Y, then X) applied to a local point, plus the position. */
export function placeLocal(px: number, py: number, pz: number, rx: number, ry: number, rz: number, lx: number, ly: number, lz: number, out: { x: number; y: number; z: number }): void {
  // Rz
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  let x = lx * cz - ly * sz;
  let y = lx * sz + ly * cz;
  let z = lz;
  // Ry
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const x2 = x * cy + z * sy;
  const z2 = -x * sy + z * cy;
  x = x2;
  z = z2;
  // Rx
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const y2 = y * cx - z * sx;
  const z3 = y * sx + z * cx;
  y = y2;
  z = z3;
  out.x = px + x;
  out.y = py + y;
  out.z = pz + z;
}

// ---- arm IK ---------------------------------------------------------------------------------------------------------------------------

/** Shoulder rotation x (swing forward), shoulder rotation z (abduction, sign per side) and elbow flexion. */
export interface ArmAngles {
  a: number;
  b: number;
  e: number;
}

/**
 * Forward kinematics in the shoulder's frame: the upper arm hangs along -Y, rotated by Rx(a) Rz(b); the forearm bends forward by `e` about the
 * upper arm's own X. Writes the hand position (relative to the shoulder joint).
 */
export function armHand(upper: number, lower: number, a: number, b: number, e: number, out: { x: number; y: number; z: number }): void {
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const sb = Math.sin(b);
  const cb = Math.cos(b);
  // u = Rx(a) Rz(b) (0,-1,0), f = Rx(a) (0,0,-1)
  const ux = sb;
  const uy = -ca * cb;
  const uz = -sa * cb;
  const fy = sa;
  const fz = -ca;
  const ce = Math.cos(e);
  const se = Math.sin(e);
  out.x = upper * ux + lower * ce * ux;
  out.y = upper * uy + lower * (ce * uy + se * fy);
  out.z = upper * uz + lower * (ce * uz + se * fz);
}

const fk = { x: 0, y: 0, z: 0 };
const fk2 = { x: 0, y: 0, z: 0 };

/** Joint limits of the rig (the ragdoll's hinge is -0.1..2.5; stay inside). `side` +1 right arm, -1 left. */
const LIM = { aLo: -1.3, aHi: 3.0, bLo: -1.15, bHi: 1.5, eLo: 0.03, eHi: 2.3 };

/**
 * Solves shoulder and elbow angles that put the hand at (tx, ty, tz) relative to the shoulder joint. Closed form first: the elbow flexion follows
 * from the distance alone (law of cosines: |hand|^2 = L1^2 + L2^2 + 2 L1 L2 cos e), then the shoulder's abduction from the sideways component and its
 * swing from the remaining two, exactly. If a joint limit is then violated (a target across the body, behind the shoulder) a few damped
 * Gauss-Newton steps from the clamped answer find the nearest legal pose. A target beyond reach is pulled back to the arm's length so the arm
 * straightens toward it. `io` receives the angles; `side` is +1 for the right arm, -1 for the left. Allocation-free. Returns the residual (metres).
 */
export function solveArm(upper: number, lower: number, side: 1 | -1, tx: number, ty: number, tz: number, io: ArmAngles): number {
  if (!Number.isFinite(tx + ty + tz)) return Infinity;
  const reach = (upper + lower) * 0.9995;
  const d = Math.hypot(tx, ty, tz);
  if (d > reach) {
    const k = reach / d;
    tx *= k;
    ty *= k;
    tz *= k;
  }
  const d2 = tx * tx + ty * ty + tz * tz;
  const ce = clamp((d2 - upper * upper - lower * lower) / (2 * upper * lower), -1, 1);
  let e = Math.acos(ce);
  const p = upper + lower * ce;
  const q = lower * Math.sqrt(Math.max(0, 1 - ce * ce));
  // abduction-positive x: the right arm reaches out to +x, the left to -x
  const x = side * tx;
  let b = Math.asin(clamp(x / Math.max(p, 1e-6), -1, 1));
  const m = p * Math.cos(b);
  const den = m * m + q * q;
  let a = den > 1e-12 ? Math.atan2((q * ty - m * tz) / den, (-m * ty - q * tz) / den) : io.a;
  a = clamp(a, LIM.aLo, LIM.aHi);
  b = clamp(b, LIM.bLo, LIM.bHi);
  e = clamp(e, LIM.eLo, LIM.eHi);
  io.a = a;
  io.b = side * b;
  io.e = e;
  armHand(upper, lower, a, side * b, e, fk);
  let err = Math.hypot(tx - fk.x, ty - fk.y, tz - fk.z);
  // A limit was hit: polish with damped Gauss-Newton from where the clamp left us.
  for (let it = 0; it < 6 && err > 0.001; it++) {
    const h = 1e-4;
    const rx = tx - fk.x;
    const ry = ty - fk.y;
    const rz = tz - fk.z;
    armHand(upper, lower, a + h, side * b, e, fk2);
    const j00 = (fk2.x - fk.x) / h;
    const j10 = (fk2.y - fk.y) / h;
    const j20 = (fk2.z - fk.z) / h;
    armHand(upper, lower, a, side * (b + h), e, fk2);
    const j01 = (fk2.x - fk.x) / h;
    const j11 = (fk2.y - fk.y) / h;
    const j21 = (fk2.z - fk.z) / h;
    armHand(upper, lower, a, side * b, e + h, fk2);
    const j02 = (fk2.x - fk.x) / h;
    const j12 = (fk2.y - fk.y) / h;
    const j22 = (fk2.z - fk.z) / h;
    const lam = 0.01;
    const m00 = j00 * j00 + j10 * j10 + j20 * j20 + lam;
    const m01 = j00 * j01 + j10 * j11 + j20 * j21;
    const m02 = j00 * j02 + j10 * j12 + j20 * j22;
    const m11 = j01 * j01 + j11 * j11 + j21 * j21 + lam;
    const m12 = j01 * j02 + j11 * j12 + j21 * j22;
    const m22 = j02 * j02 + j12 * j12 + j22 * j22 + lam;
    const g0 = j00 * rx + j10 * ry + j20 * rz;
    const g1 = j01 * rx + j11 * ry + j21 * rz;
    const g2 = j02 * rx + j12 * ry + j22 * rz;
    const det = m00 * (m11 * m22 - m12 * m12) - m01 * (m01 * m22 - m12 * m02) + m02 * (m01 * m12 - m11 * m02);
    if (Math.abs(det) < 1e-12) break;
    const da = (g0 * (m11 * m22 - m12 * m12) - m01 * (g1 * m22 - m12 * g2) + m02 * (g1 * m12 - m11 * g2)) / det;
    const db = (m00 * (g1 * m22 - m12 * g2) - g0 * (m01 * m22 - m12 * m02) + m02 * (m01 * g2 - g1 * m02)) / det;
    const de = (m00 * (m11 * g2 - g1 * m12) - m01 * (m01 * g2 - g1 * m02) + g0 * (m01 * m12 - m11 * m02)) / det;
    a = clamp(a + clamp(da, -0.5, 0.5), LIM.aLo, LIM.aHi);
    b = clamp(b + clamp(db, -0.5, 0.5), LIM.bLo, LIM.bHi);
    e = clamp(e + clamp(de, -0.6, 0.6), LIM.eLo, LIM.eHi);
    armHand(upper, lower, a, side * b, e, fk);
    err = Math.hypot(tx - fk.x, ty - fk.y, tz - fk.z);
    io.a = a;
    io.b = side * b;
    io.e = e;
  }
  return err;
}

// ---- the wrist ------------------------------------------------------------------------------------------------------------------------

/** Row-major 3x3 of the forearm's orientation in the torso frame for shoulder angles (a, b) and elbow flexion e: Rx(a) Rz(b) Rx(e). */
export function forearmMatrix(a: number, b: number, e: number, m: Float64Array): void {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const ce = Math.cos(e);
  const se = Math.sin(e);
  // Rz(b) Rx(e)
  const r00 = cb;
  const r01 = -sb * ce;
  const r02 = sb * se;
  const r10 = sb;
  const r11 = cb * ce;
  const r12 = -cb * se;
  const r20 = 0;
  const r21 = se;
  const r22 = ce;
  // Rx(a) * that
  m[0] = r00;
  m[1] = r01;
  m[2] = r02;
  m[3] = ca * r10 - sa * r20;
  m[4] = ca * r11 - sa * r21;
  m[5] = ca * r12 - sa * r22;
  m[6] = sa * r10 + ca * r20;
  m[7] = sa * r11 + ca * r21;
  m[8] = sa * r12 + ca * r22;
}

/** How far a wrist may turn the hand away from the forearm's line (radians): the wrist bends and the forearm rolls, in a caricature's generous range. */
export const WRIST_MAX = 1.3;

/** The hand's grip axis in its own frame: the line its knuckles lie on. */
export const HAND_GRIP_AXIS: V3 = [0, 0, 1];

/** How far below the wrist joint the fist's centre is, in hand radii (the palm's middle, where a rod passes through a closed hand). */
export const HAND_CENTRE = 0.55;

/**
 * The wrist rotation (a quaternion x, y, z, w in the FOREARM's frame) that lays the hand's grip axis (its local Z, `HAND_GRIP_AXIS`) on the handle direction (ax, ay, az) given in the
 * TORSO frame, for a forearm at (a, b, e) (see `forearmMatrix`). It is the smallest turn that does it (the axis has no sign: a fist wraps a rod either way, so the nearer of the two
 * directions is used), limited to `WRIST_MAX`. Returns the axis error left over (radians, 0 when the wrist could do it all). `m` is scratch (9 numbers). Allocation-free.
 * `out.s` is the direction the fist took last time (+1 the handle's own direction, -1 the opposite, 0 none yet): it is kept unless the other is clearly nearer (cos > 0.35), so a
 * handle at a right angle to the forearm does not flip the hand over from one frame (or one iteration) to the next; the choice made is written back.
 */
export function solveWrist(a: number, b: number, e: number, ax: number, ay: number, az: number, out: { x: number; y: number; z: number; w: number; s?: number }, m: Float64Array): number {
  const l = Math.hypot(ax, ay, az);
  if (!(l > 1e-6)) {
    out.x = out.y = out.z = 0;
    out.w = 1;
    return 0;
  }
  forearmMatrix(a, b, e, m);
  // the handle in the forearm's frame: M^T v
  let vx = (m[0]! * ax + m[3]! * ay + m[6]! * az) / l;
  let vy = (m[1]! * ax + m[4]! * ay + m[7]! * az) / l;
  let vz = (m[2]! * ax + m[5]! * ay + m[8]! * az) / l;
  const prefer = out.s ?? 0;
  const sign = prefer !== 0 && Math.abs(vz) < 0.35 ? prefer : vz < 0 ? -1 : 1;
  out.s = sign;
  if (sign < 0) {
    vx = -vx;
    vy = -vy;
    vz = -vz;
  }
  // rotate (0, 0, 1) onto (vx, vy, vz): the axis is (0,0,1) x v = (-vy, vx, 0), the angle acos(vz)
  const s = Math.hypot(vx, vy);
  const full = Math.atan2(s, vz);
  if (s < 1e-9) {
    out.x = out.y = out.z = 0;
    out.w = 1;
    return 0;
  }
  const turn = Math.min(full, WRIST_MAX);
  const k = Math.sin(turn / 2) / s;
  out.x = -vy * k;
  out.y = vx * k;
  out.z = 0;
  out.w = Math.cos(turn / 2);
  return full - turn;
}

/** Rotates the vector (x, y, z) by the unit quaternion q and writes it to `o`. */
export function rotateByQuat(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number, o: { x: number; y: number; z: number }): void {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  o.x = x + q.w * tx + (q.y * tz - q.z * ty);
  o.y = y + q.w * ty + (q.z * tx - q.x * tz);
  o.z = z + q.w * tz + (q.x * ty - q.y * tx);
}

/** The forearm's matrix times a vector: forearm frame -> torso frame. */
export function applyMatrix(m: Float64Array, x: number, y: number, z: number, o: { x: number; y: number; z: number }): void {
  o.x = m[0]! * x + m[1]! * y + m[2]! * z;
  o.y = m[3]! * x + m[4]! * y + m[5]! * z;
  o.z = m[6]! * x + m[7]! * y + m[8]! * z;
}

// ---- holds -------------------------------------------------------------------------------------------------------------------------------------

type Kind = "pistol" | "long" | "blade" | "stick" | "hands";
const kindOf = (id: number): Kind =>
  id === WEAPON.PISTOL ? "pistol" : id === WEAPON.RIFLE || id === WEAPON.BLUNDERBUSS ? "long" : id === WEAPON.SABRE ? "blade" : id === WEAPON.UMBRELLA ? "stick" : "hands";

const tmp = { x: 0, y: 0, z: 0 };
const tmp2 = { x: 0, y: 0, z: 0 };

/** Pose scratch reused between calls (position, rotation of the weapon before blends). */
interface P6 {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}
const base: P6 = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
const alt: P6 = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

const set6 = (o: P6, x: number, y: number, z: number, rx: number, ry: number, rz = 0): void => {
  o.x = x;
  o.y = y;
  o.z = z;
  o.rx = rx;
  o.ry = ry;
  o.rz = rz;
};
const mix6 = (o: P6, b: P6, t: number): void => {
  o.x = lerp(o.x, b.x, t);
  o.y = lerp(o.y, b.y, t);
  o.z = lerp(o.z, b.z, t);
  o.rx = lerp(o.rx, b.rx, t);
  o.ry = lerp(o.ry, b.ry, t);
  o.rz = lerp(o.rz, b.rz, t);
};

/**
 * Blends of the hold state, damped by the animator between frames: aim (0..1), reload (0..1), and whether the weapon is out at all.
 */
export interface HoldBlend {
  aim: number;
  reload: number;
  hold: number;
  swing: number;
}

/**
 * The whole hold for one frame. `input` is the raw combat input, `blend` the animator's damped versions of its aim/reload/hold weights.
 * `speed01` (0..1) is how fast the body is moving, so a walker carries the weapon lower and closer than a stander.
 */
export function computeHold(input: WeaponPoseInput, blend: HoldBlend, body: HoldBody, time: number, speed01: number, out: HoldOut): HoldOut {
  const id = input.id;
  const kind = kindOf(id);
  const anchors = WEAPON_ANCHORS[id];
  const { hw, sy, upper, lower } = body;
  const A = upper + lower;
  out.right.w = 0;
  out.left.w = 0;
  out.right.ax = out.right.ay = out.right.az = 0;
  out.left.ax = out.left.ay = out.left.az = 0;
  out.twist = 0;
  out.lean = 0;
  out.rod = 0;
  out.visible = id >= 0 && kind !== "hands" && !input.hidden && blend.hold > 0.02;
  const fire = clamp(input.fire, 0, 1);
  const kick = fire * fire;

  // Shoulder pivots in the torso frame.
  const shRx = hw;
  const shRy = sy;
  const aim = blend.aim;

  if (kind === "hands" || id < 0) {
    // Bare fists: a jab from the right shoulder when a blow is in flight; otherwise the arms are the animator's.
    if (input.swing >= 0 && !input.hidden) fistBlow(input, body, out);
    return out;
  }

  // ---- base placement (ready -> aimed) ----------------------------------------------------------------------------------------------
  if (kind === "long") {
    // At the ready: carried across the chest, muzzle up and inward. Aimed: butt in the right shoulder, barrel along the sight line.
    set6(base, shRx - 0.02, sy - 0.5 * A * 0.75 - speed01 * 0.03, -0.3 - speed01 * 0.02, 0.85, 0.36, 0);
    // aimed: grip a hand's width in front of the shoulder, butt into the pocket of it
    const butt = anchors!.butt;
    // (cross-body: the barrel points a little inward, as a shouldered piece does along the sight line from the shoulder to the aim point, and it
    //  brings the fore-end within the left hand's reach)
    set6(alt, shRx * 0.92, sy - 0.075, -0.05 - butt[2] - 0.03, input.elev, 0.3, 0);
    // pivot the elevation about the butt: recompute the grip so the butt stays in the shoulder
    placeLocal(0, 0, 0, input.elev, 0.3, 0, butt[0], butt[1], butt[2], tmp);
    alt.x = shRx * 0.92 - tmp.x;
    alt.y = sy - 0.075 - tmp.y;
    alt.z = -0.05 - tmp.z;
    // first person: the aimed weapon slides toward the middle of the view and down so the barrel sits under the eye line
    if (input.fp > 0) {
      alt.x -= 0.16 * input.fp;
      alt.y += 0.22 * input.fp;
    }
    mix6(base, alt, aim);
    // recoil (applied after the reach fit below): the weapon slams back into the shoulder and the muzzle lifts
    out.lean = kick * 0.05;
  } else if (kind === "pistol") {
    // At the ready: low in front of the hip, muzzle down-forward. Aimed: arm out along the sight line.
    set6(base, shRx * 0.95, sy - 0.55 * A - speed01 * 0.03, -0.3 * A - 0.04, -0.22 + input.elev * 0.3, 0.05, 0);
    // aimed: the arm extended, the hand on the sight line under the eye
    const reach = 0.95 * A;
    const ce = Math.cos(input.elev);
    set6(alt, shRx * 0.55, sy - 0.04 + Math.sin(input.elev) * reach, -ce * reach, input.elev, 0.12, 0);
    if (input.fp > 0) {
      alt.x -= 0.2 * input.fp;
      alt.y += 0.3 * input.fp;
    }
    mix6(base, alt, aim);
    out.lean = kick * 0.04;
  } else {
    // Blade or stick: at the side, point forward and down; a cane rests near vertical.
    const cane = kind === "stick";
    set6(base, shRx * 1.1, sy - 0.62 * A, -0.2 * A - speed01 * 0.03, cane ? -1.35 : -0.55, cane ? 0.05 : 0.12, cane ? 0.0 : 0.0);
    // guard (aim held): blade forward and up in front of the chest
    set6(alt, shRx * 0.8, sy - 0.32 * A, -0.42 * A, cane ? -0.5 : 0.1 + input.elev * 0.3, cane ? 0.15 : 0.1, 0);
    mix6(base, alt, aim);
  }

  // breathing: at the ready the piece rides the breath and shifts its weight a touch, aimed it wanders a hair round the sight line; walking or running hides both
  const still = 1 - clamp(speed01 * 1.5, 0, 1);
  const sway = (1 - aim * 0.65) * still;
  base.y += 0.0045 * Math.sin(time * 1.9) * sway;
  base.z += 0.004 * Math.sin(time * 1.3) * sway;
  base.rx += 0.014 * Math.sin(time * 1.6) * sway;
  base.ry += 0.008 * Math.sin(time * 0.8) * (0.4 + aim) * still;
  base.rx += 0.006 * Math.sin(time * 1.1) * aim * still;

  // ---- reload: the piece comes up to the chest, muzzle high, while the free hand works --------------------------------------------------
  const rl = blend.reload;
  if (rl > 0.01 && (kind === "long" || kind === "pistol")) {
    if (kind === "long") set6(alt, shRx * 0.35, sy - 0.85 * A, -0.42 * A, 1.22, 0.32, 0);
    else set6(alt, shRx * 0.45, sy - 0.55 * A, -0.35 * A, 1.15, 0.2, 0);
    mix6(base, alt, rl);
  }

  // ---- blows ----------------------------------------------------------------------------------------------------------------------------
  if (input.swing >= 0 && blend.swing > 0.01) blow(input, blend, body, id, kind, out);
  else out.twist = 0;

  // ---- write the transform and the hands ----------------------------------------------------------------------------------------------------
  out.px = base.x;
  out.py = base.y;
  out.pz = base.z;
  out.rx = base.rx;
  out.ry = base.ry;
  out.rz = base.rz;
  if (blend.swing > 0.01 && input.swing >= 0) mix6ToOut(out, blend.swing);

  // Right hand: always on the grip. Left hand: on the fore-end of a two-handed piece (as far along it as this arm can reach); working during a
  // reload; free otherwise.
  placeLocal(out.px, out.py, out.pz, out.rx, out.ry, out.rz, 0, 0, 0, tmp);
  out.right.x = tmp.x;
  out.right.y = tmp.y;
  out.right.z = tmp.z;
  out.right.w = blend.hold;
  // The grip must be in reach of the right shoulder: if not, the whole piece comes in toward it.
  fitRight(out, body);
  const two = kind === "long" || (kind === "pistol" && rl > 0.01);
  if (two && anchors) {
    if (rl > 0.01) reloadHand(input.reload, id, anchors, body, out, tmp2);
    else foreGrip(out, body, anchors, tmp2);
    out.left.x = tmp2.x;
    out.left.y = tmp2.y;
    out.left.z = tmp2.z;
    out.left.w = blend.hold;
  } else if (kind === "pistol" && aim > 0.05) {
    // duelist's stance: the free hand tucked behind the hip
    out.left.x = -hw * 0.75;
    out.left.y = sy - 0.62 * A;
    out.left.z = 0.06;
    out.left.w = blend.hold * aim;
  } else if ((kind === "blade" || kind === "stick") && aim > 0.05) {
    out.left.x = -hw * 0.7;
    out.left.y = sy - 0.5 * A;
    out.left.z = 0.05;
    out.left.w = blend.hold * aim;
  }

  // Recoil, applied last so the arms' reach cannot swallow it: the piece drives back along its own line and the muzzle climbs.
  if (kick > 0 && (kind === "long" || kind === "pistol")) {
    const back = kind === "long" ? 0.1 : 0.07;
    const climb = kind === "long" ? 0.14 : 0.32;
    out.pz += kick * back;
    out.rx += kick * climb;
    placeLocal(out.px, out.py, out.pz, out.rx, out.ry, out.rz, 0, 0, 0, tmp);
    out.right.x = tmp.x;
    out.right.y = tmp.y;
    out.right.z = tmp.z;
    if (out.left.w > 0.01 && anchors && kind === "long" && rl <= 0.01) {
      foreGrip(out, body, anchors, tmp2);
      out.left.x = tmp2.x;
      out.left.y = tmp2.y;
      out.left.z = tmp2.z;
    }
  }

  if (anchors && rl > 0.01) out.rod = anchors.rod * rodOut(input.reload);
  // the handles the fists wrap round, in the torso frame (the weapon's own axes turned by its pose)
  if (anchors) {
    placeLocal(0, 0, 0, out.rx, out.ry, out.rz, anchors.grip[0], anchors.grip[1], anchors.grip[2], tmp);
    out.right.ax = tmp.x;
    out.right.ay = tmp.y;
    out.right.az = tmp.z;
    if (two && anchors.gripL && rl <= 0.01 && kind === "long") {
      placeLocal(0, 0, 0, out.rx, out.ry, out.rz, anchors.gripL[0], anchors.gripL[1], anchors.gripL[2], tmp);
      out.left.ax = tmp.x;
      out.left.ay = tmp.y;
      out.left.az = tmp.z;
    }
  }
  return out;
}

/** Brings the whole piece in toward the right shoulder if the grip is out of that arm's reach (by up to 0.35 m). */
function fitRight(out: HoldOut, body: HoldBody): void {
  const reach = (body.upper + body.lower) * 0.96 + (body.hand ?? 0.08) * HAND_CENTRE * 0.8; // (the wrist stops short of the grip by the fist's half depth)
  const dx = out.right.x - body.hw;
  const dy = out.right.y - body.sy;
  const dz = out.right.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= reach) {
    // ...and not nearer than the elbow can fold (a long arm with the butt pulled into the shoulder: the fist would have to be inside the bent arm, and it
    // stops short of the grip); the piece is pushed out from the shoulder until the arm can bend to it
    const u = body.upper;
    const l = body.lower;
    // (a fist bigger than the default 8 cm sits further from the wrist, so the wrist must be that much further from the shoulder's fold)
    const near = Math.sqrt(u * u + l * l + 2 * u * l * Math.cos(ELBOW_FOLD)) + Math.max(0, (body.hand ?? 0.08) - 0.08) * HAND_CENTRE * 3;
    if (d >= near || d < 1e-6) return;
    const push = Math.min(0.3, near - d) / d;
    out.px += dx * push;
    out.py += dy * push;
    out.pz += dz * push;
    out.right.x += dx * push;
    out.right.y += dy * push;
    out.right.z += dz * push;
    return;
  }
  const k = Math.min(0.35, d - reach) / d;
  out.px -= dx * k;
  out.py -= dy * k;
  out.pz -= dz * k;
  out.right.x -= dx * k;
  out.right.y -= dy * k;
  out.right.z -= dz * k;
}

/** How far a held fist may be folded in toward its shoulder (elbow flexion, radians; the rig's own stop is 2.3). */
const ELBOW_FOLD = 2.2;

/** The left hand's place on a two-handed piece: the fore-end, or as far along toward the grip as this arm (shoulder at -hw) can reach. */
function foreGrip(out: HoldOut, body: HoldBody, a: Anchors, o: { x: number; y: number; z: number }): void {
  const reach = (body.upper + body.lower) * 0.955 + (body.hand ?? 0.08) * HAND_CENTRE * 0.8;
  for (let s = 1; s >= 0.2; s -= 0.1) {
    placeLocal(out.px, out.py, out.pz, out.rx, out.ry, out.rz, a.left[0] * s, a.left[1] * s, a.left[2] * s, o);
    if (Math.hypot(o.x + body.hw, o.y - body.sy, o.z) <= reach) return;
  }
  limitLeft(o, body, reach); // nowhere along the fore-end is in reach: hold the nearest point the arm allows
}

function mix6ToOut(out: HoldOut, w: number): void {
  // The blow writes into `alt` (its own pose); blend it over the base pose already written to `out`.
  out.px = lerp(out.px, alt.x, w);
  out.py = lerp(out.py, alt.y, w);
  out.pz = lerp(out.pz, alt.z, w);
  out.rx = lerp(out.rx, alt.rx, w);
  out.ry = lerp(out.ry, alt.ry, w);
  out.rz = lerp(out.rz, alt.rz, w);
}

/** How far the ramrod is drawn out at reload progress u (out during the ram, in before and after). */
function rodOut(u: number): number {
  return smooth(0.5, 0.58, u) * (1 - smooth(0.88, 0.94, u));
}

/** A waypoint of the free hand during a reload: `frame` 0 = the powder horn on the hip (torso frame), 1 = weapon space. */
interface Way {
  u: number;
  frame: 0 | 1;
  x: number;
  y: number;
  z: number;
}

const waysCache = new Map<number, Way[]>();

/** The free hand's route through a reload for a weapon: to the horn, over the muzzle to pour, back for the ball, three strokes of the ramrod, the pan, home. */
function reloadWays(id: number, a: Anchors, long: boolean): Way[] {
  const hit = waysCache.get(id);
  if (hit) return hit;
  const mz = a.muzzle;
  const top: V3 = [mz[0], mz[1] + 0.07, mz[2] + 0.03];
  const low: V3 = [mz[0], mz[1] + 0.07, mz[2] + (long ? 0.36 : 0.17)];
  const lock = a.lock;
  const w = (u: number, frame: 0 | 1, p: V3): Way => ({ u, frame, x: p[0], y: p[1], z: p[2] });
  const horn: V3 = [0, 0, 0];
  const list: Way[] = [
    w(0, 1, a.left),
    w(0.12, 0, horn),
    w(0.28, 1, top),
    w(0.4, 1, [top[0], top[1] + 0.035, top[2]]),
    w(0.46, 0, horn),
    w(0.53, 1, top),
  ];
  for (let i = 0; i < 6; i++) list.push(w(0.53 + ((i + 1) * 0.32) / 6, 1, i % 2 === 0 ? low : top));
  list.push(w(0.92, 1, [lock[0], lock[1] + 0.06, lock[2] - 0.03]), w(1, 1, a.left));
  waysCache.set(id, list);
  return list;
}

/**
 * The free hand's work during a reload (u = 0..1), in the torso frame: continuous, smooth between waypoints (`reloadWays`).
 */
function reloadHand(u: number, id: number, a: Anchors, body: HoldBody, out: HoldOut, o: { x: number; y: number; z: number }): void {
  const ways = reloadWays(id, a, id === WEAPON.RIFLE || id === WEAPON.BLUNDERBUSS);
  let i = 0;
  while (i < ways.length - 2 && u > ways[i + 1]!.u) i++;
  const w0 = ways[i]!;
  const w1 = ways[i + 1]!;
  const t = smooth(w0.u, w1.u, u);
  const A = body.upper + body.lower;
  const place = (w: Way, dst: { x: number; y: number; z: number }): void => {
    if (w.frame === 1) placeLocal(out.px, out.py, out.pz, out.rx, out.ry, out.rz, w.x, w.y, w.z, dst);
    else {
      // the powder horn hangs at the left hip
      dst.x = -body.hw * 0.85;
      dst.y = body.sy - 0.85 * A;
      dst.z = -0.02;
    }
  };
  place(w0, tmpA);
  place(w1, tmpB);
  o.x = lerp(tmpA.x, tmpB.x, t);
  o.y = lerp(tmpA.y, tmpB.y, t);
  o.z = lerp(tmpA.z, tmpB.z, t);
  limitLeft(o, body, A * 0.98); // whatever the waypoints ask, the hand stays within the arm's length (short arms just reach less far)
}

/** Pulls a left-hand target in toward the left shoulder until it is no further than `max`. */
function limitLeft(o: { x: number; y: number; z: number }, body: HoldBody, max: number): void {
  const dx = o.x + body.hw;
  const dy = o.y - body.sy;
  const d = Math.hypot(dx, dy, o.z);
  if (d <= max) return;
  const k = max / d;
  o.x = -body.hw + dx * k;
  o.y = body.sy + dy * k;
  o.z *= k;
}

const tmpA = { x: 0, y: 0, z: 0 };
const tmpB = { x: 0, y: 0, z: 0 };

/** A jab with a bare fist, from the right shoulder. */
function fistBlow(input: WeaponPoseInput, body: HoldBody, out: HoldOut): void {
  const s = input.swing;
  const A = body.upper + body.lower;
  const wind = smooth(0, 0.3, s) * (1 - smooth(0.3, 0.42, s));
  const strike = smooth(0.3, 0.45, s) * (1 - smooth(0.6, 1, s));
  out.visible = false;
  out.right.x = body.hw * 0.9 + 0.05 - wind * 0.1;
  out.right.y = body.sy - 0.3 * A + strike * 0.12;
  out.right.z = -0.25 * A + wind * 0.22 - strike * 0.7 * A;
  out.right.w = Math.max(wind, strike);
  out.left.x = -body.hw * 0.5;
  out.left.y = body.sy - 0.2 * A;
  out.left.z = -0.32 * A;
  out.left.w = 0.75 * out.right.w;
  out.twist = (-0.35 * strike + 0.25 * wind) * (input.swingKind % 2 === 0 ? 1 : -1);
}

/**
 * A blow with the weapon in hand, written into `alt` as the blow's own weapon pose (the caller blends it over the base by `blend.swing`).
 * Timeline: 0..0.36 wind-up, 0.36..0.62 the stroke, the rest recovery. Variants: 0 slash right to left, 1 backhand left to right, 2 overhead
 * chop, 3 the butt-stroke of a firearm (and a thrust for a stick).
 */
function blow(input: WeaponPoseInput, blend: HoldBlend, body: HoldBody, id: number, kind: Kind, out: HoldOut): void {
  const s = input.swing;
  const A = body.upper + body.lower;
  const wind = smooth(0, 0.34, s);
  const stroke = smooth(0.36, 0.6, s);
  const back = smooth(0.66, 1, s);
  const variant = kind === "long" || kind === "pistol" ? 3 : input.swingKind % 3;
  const shX = body.hw;
  const shY = body.sy;
  let reach = 0.56 * A;
  if (variant === 0 || variant === 1) {
    // horizontal arc about the shoulder, chest high
    const dir = variant === 0 ? 1 : -1;
    const phi0 = dir * 1.1;
    const phi1 = -dir * 1.15;
    const phi = lerp(lerp(0.12 * dir, phi0, wind), phi1, stroke) * (1 - back) + back * 0.12;
    const r = reach * (1 - 0.25 * wind + 0.35 * stroke);
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    alt.x = shX - sp * r;
    alt.y = shY - 0.16 * A + 0.04 * Math.sin(stroke * Math.PI);
    alt.z = -cp * r;
    alt.rx = -0.06 + (variant === 0 ? 0.12 : -0.05);
    alt.ry = phi;
    alt.rz = -0.35 * dir * Math.sin(stroke * Math.PI);
    out.twist = -phi * 0.45;
  } else if (variant === 2) {
    // overhead chop: up behind the head, down through the front
    const raise = lerp(0, 1, wind) * (1 - stroke);
    const rxA = lerp(lerp(-0.5, 2.25, wind), -0.4, stroke);
    const rxB = lerp(rxA, -0.5, back);
    alt.x = shX * 0.8;
    alt.y = shY + 0.3 * raise - 0.12 * A * stroke * (1 - back) - 0.05;
    alt.z = -0.3 * A - 0.3 * A * stroke + 0.12 * raise;
    alt.rx = rxB;
    alt.ry = 0.05;
    alt.rz = 0;
    out.twist = 0.12 * wind - 0.28 * stroke;
  } else {
    // butt-stroke / thrust: the piece turns end for end and drives forward
    const flip = kind === "long" ? smooth(0, 0.3, s) * (1 - smooth(0.7, 1, s)) : 0;
    const drive = stroke * (1 - back);
    alt.x = shX * 0.75;
    alt.y = shY - 0.3 * A + 0.05 * drive;
    alt.z = -0.28 * A - 0.42 * drive + 0.1 * wind * (1 - stroke);
    alt.rx = kind === "long" ? 0.35 * (1 - flip) : kind === "pistol" ? 0.2 : -0.1;
    alt.ry = flip * Math.PI * 0.92;
    alt.rz = 0;
    out.twist = -0.25 * drive + 0.18 * wind * (1 - stroke);
  }
  void blend;
  void id;
}
