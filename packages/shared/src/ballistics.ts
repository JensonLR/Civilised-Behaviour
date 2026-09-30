import { CHARACTER, FLAG } from "./constants.ts";
import type { CollisionWorld, Obstacle } from "./collision.ts";
import { ZONE_COUNT } from "./wounds.ts";

/**
 * The geometry of shooting, as pure allocation-free functions shared by the server (authority), the client (aim point, tracer
 * ends, impact pictures) and the tests:
 *   - a character's zones as stacked ellipsoids on its capsule, and ray/segment tests against them;
 *   - ballistic stepping (gravity, optional drag);
 *   - rays against the static world (terrain and obstacles), with the surface hit;
 *   - explosion distance and a melee swing as a fan of short rays.
 * Conventions: yaw 0 looks down -Z, +X is the character's right; elevation + = up.
 */

// ---- the body as ellipsoids ----------------------------------------------------------------------------------------------------------

/** Centre (character frame: x right, y up, z back; feet at y = 0) and radii of each zone's ellipsoid, for a standing figure 1.8 m tall. */
export const BODY_SHAPES: readonly (readonly [number, number, number, number, number, number])[] = [
  /* HEAD  */ [0, 1.6, -0.02, 0.21, 0.24, 0.22],
  /* TORSO */ [0, 1.14, 0, 0.3, 0.42, 0.21],
  /* ARM_L */ [-0.37, 1.1, 0, 0.11, 0.4, 0.13],
  /* ARM_R */ [0.37, 1.1, 0, 0.11, 0.4, 0.13],
  /* LEG_L */ [-0.13, 0.43, 0, 0.15, 0.45, 0.15],
  /* LEG_R */ [0.13, 0.43, 0, 0.15, 0.45, 0.15],
];

/** A crouching body is squashed to this fraction of its height; a downed one lies on its back (the animator's angle and lift). */
const CROUCH_K = CHARACTER.crouchHeight / CHARACTER.height;
const LIE_ANGLE = Math.PI / 2 - 0.1;
const LIE_LIFT = 0.15;
const LIE_COS = Math.cos(LIE_ANGLE);
const LIE_SIN = Math.sin(LIE_ANGLE);

/** Where a character is and how it is posed: all a hit test needs. Works on schema instances and plain objects. */
export interface BodyPose {
  x: number;
  y: number;
  z: number;
  facing: number;
  flags: number;
}

export interface BodyHit {
  /** Distance along the ray. */
  t: number;
  zone: number;
  x: number;
  y: number;
  z: number;
}

export const newBodyHit = (): BodyHit => ({ t: 0, zone: 0, x: 0, y: 0, z: 0 });

/** Entry distance of a ray into an axis-aligned ellipsoid (0 when it starts inside), or -1 for a miss. Allocation-free. */
export function rayEllipsoid(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): number {
  const px = (ox - cx) / rx;
  const py = (oy - cy) / ry;
  const pz = (oz - cz) / rz;
  const vx = dx / rx;
  const vy = dy / ry;
  const vz = dz / rz;
  const a = vx * vx + vy * vy + vz * vz;
  if (a < 1e-18) return -1;
  const b = px * vx + py * vy + pz * vz;
  const c = px * px + py * py + pz * pz - 1;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / a;
  const t1 = (-b + s) / a;
  if (t1 < 0) return -1;
  return t0 >= 0 ? t0 : 0;
}

// character-frame scratch for the ray
let lox = 0;
let loy = 0;
let loz = 0;
let ldx = 0;
let ldy = 0;
let ldz = 0;

/**
 * Casts a ray (direction need not be unit; `maxT` is in the ray's own units, so pass a unit direction to get metres) at a character
 * and reports the first zone it enters. `inflate` grows every ellipsoid (the radius of the ball, the width of a blade). Returns false on a
 * miss. The character's zones move with its stance: crouching squashes them, a downed body lies on its back.
 */
export function rayBody(pose: BodyPose, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, inflate: number, out: BodyHit): boolean {
  const downed = (pose.flags & FLAG.DOWNED) !== 0;
  // broad phase: closest approach in the ground plane to the body's axis (a lying body reaches ~1.9 m behind it)
  const reachR = (downed ? 2.05 : 0.6) + inflate;
  const hx = pose.x - ox;
  const hz = pose.z - oz;
  const a = dx * dx + dz * dz;
  let tc = a > 1e-12 ? (hx * dx + hz * dz) / a : 0;
  tc = tc < 0 ? 0 : tc > maxT ? maxT : tc;
  const ex = ox + dx * tc - pose.x;
  const ez = oz + dz * tc - pose.z;
  if (ex * ex + ez * ez > reachR * reachR) return false;

  // into the character frame: translate, undo the heading, then (downed) undo the lie
  const c = Math.cos(pose.facing);
  const s = Math.sin(pose.facing);
  const px = ox - pose.x;
  const pz = oz - pose.z;
  lox = px * c - pz * s;
  loz = px * s + pz * c;
  loy = oy - pose.y;
  ldx = dx * c - dz * s;
  ldz = dx * s + dz * c;
  ldy = dy;
  if (downed) {
    loy -= LIE_LIFT;
    const ny = loy * LIE_COS + loz * LIE_SIN;
    const nz = -loy * LIE_SIN + loz * LIE_COS;
    loy = ny;
    loz = nz;
    const nyd = ldy * LIE_COS + ldz * LIE_SIN;
    const nzd = -ldy * LIE_SIN + ldz * LIE_COS;
    ldy = nyd;
    ldz = nzd;
  }
  const k = (pose.flags & FLAG.CROUCHING) !== 0 && !downed ? CROUCH_K : 1;
  let best = Infinity;
  let bestZone = -1;
  for (let z = 0; z < ZONE_COUNT; z++) {
    const sh = BODY_SHAPES[z]!;
    const t = rayEllipsoid(lox, loy, loz, ldx, ldy, ldz, sh[0], sh[1] * k, sh[2], sh[3] + inflate, sh[4] * k + inflate, sh[5] + inflate);
    if (t >= 0 && t < best) {
      best = t;
      bestZone = z;
    }
  }
  if (bestZone < 0 || best > maxT) return false;
  out.t = best;
  out.zone = bestZone;
  out.x = ox + dx * best;
  out.y = oy + dy * best;
  out.z = oz + dz * best;
  return true;
}

/** The middle of the chest in world space (aim point, explosion line of sight). */
export function bodyCentre(pose: BodyPose, out: { x: number; y: number; z: number }): void {
  if ((pose.flags & FLAG.DOWNED) !== 0) {
    out.x = pose.x - Math.sin(pose.facing) * -0.6;
    out.z = pose.z - Math.cos(pose.facing) * -0.6;
    out.y = pose.y + 0.3;
    return;
  }
  const k = (pose.flags & FLAG.CROUCHING) !== 0 ? CROUCH_K : 1;
  out.x = pose.x;
  out.y = pose.y + 1.1 * k;
  out.z = pose.z;
}

/** Distance from a blast centre to the nearest part of a body (its chest line minus its girth). 0 when the blast is inside it. */
export function blastDistance(pose: BodyPose, cx: number, cy: number, cz: number): number {
  const lying = (pose.flags & FLAG.DOWNED) !== 0;
  const k = (pose.flags & FLAG.CROUCHING) !== 0 && !lying ? CROUCH_K : 1;
  const lo = pose.y + (lying ? 0.05 : 0.25 * k);
  const hi = pose.y + (lying ? 0.5 : 1.55 * k);
  const y = cy < lo ? lo : cy > hi ? hi : cy;
  const d = Math.hypot(cx - pose.x, cy - y, cz - pose.z) - (lying ? 0.5 : 0.28);
  return d > 0 ? d : 0;
}

// ---- projectiles -----------------------------------------------------------------------------------------------------------------------

export interface Ballistic {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * One semi-implicit Euler step: gravity then (optional) exponential drag on the velocity, then the move. Deterministic; the caller
 * tests the segment from the old to the new position.
 */
export function stepBallistic(b: Ballistic, dt: number, gravity: number, drag = 0): void {
  b.vy -= gravity * dt;
  if (drag > 0) {
    const k = Math.exp(-drag * dt);
    b.vx *= k;
    b.vy *= k;
    b.vz *= k;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
}

// ---- rays against the static world -----------------------------------------------------------------------------------------------------

/** What a surface is made of (picks the impact picture and sound). */
export const SURFACE = { EARTH: 0, WOOD: 1, IRON: 2, STONE: 3, CLOTH: 4, FLESH: 5 } as const;
export type SurfaceId = (typeof SURFACE)[keyof typeof SURFACE];

const TAG_SURFACE: Record<string, SurfaceId> = {
  tree: SURFACE.WOOD,
  snag: SURFACE.WOOD,
  stump: SURFACE.WOOD,
  log: SURFACE.WOOD,
  crate: SURFACE.WOOD,
  cart: SURFACE.WOOD,
  luggage: SURFACE.WOOD,
  table: SURFACE.WOOD,
  sign: SURFACE.WOOD,
  pole: SURFACE.WOOD,
  hammock: SURFACE.CLOTH,
  tent: SURFACE.CLOTH,
  flag: SURFACE.WOOD,
  scope: SURFACE.IRON,
  cannon: SURFACE.IRON,
  rock: SURFACE.STONE,
  wall: SURFACE.STONE,
  ruin: SURFACE.STONE,
  fire: SURFACE.EARTH,
};

export const surfaceOfTag = (tag: string | undefined): SurfaceId => (tag !== undefined ? TAG_SURFACE[tag] : undefined) ?? SURFACE.STONE;

export interface WorldHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  surface: SurfaceId;
}

export const newWorldHit = (): WorldHit => ({ t: 0, nx: 0, ny: 1, nz: 0, surface: SURFACE.EARTH });

/** A coarse XZ grid over a world's obstacles, built once per CollisionWorld (the world is immutable after construction). */
interface RayGrid {
  cells: Map<number, number[]>;
  obstacles: readonly Obstacle[];
  stamp: Uint32Array;
  next: number;
}

const CELL = 8;
const cellKey = (cx: number, cz: number): number => (cx + 512) * 1024 + (cz + 512);
const grids = new WeakMap<CollisionWorld, RayGrid>();

function gridFor(world: CollisionWorld): RayGrid {
  let g = grids.get(world);
  if (g && g.obstacles === world.obstacles) return g;
  const cells = new Map<number, number[]>();
  world.obstacles.forEach((o, i) => {
    const ext = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
    for (let cx = Math.floor((o.x - ext) / CELL); cx <= Math.floor((o.x + ext) / CELL); cx++) {
      for (let cz = Math.floor((o.z - ext) / CELL); cz <= Math.floor((o.z + ext) / CELL); cz++) {
        const k = cellKey(cx, cz);
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
    }
  });
  g = { cells, obstacles: world.obstacles, stamp: new Uint32Array(world.obstacles.length), next: 1 };
  grids.set(world, g);
  return g;
}

// scratch results of the obstacle tests
let hitT = 0;
let hitNx = 0;
let hitNy = 0;
let hitNz = 0;

/** Ray against a vertical cylinder or an oriented box (slabs), both bounded in y. Sets the scratch and returns true on a hit at t >= 0. */
function rayObstacle(o: Obstacle, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
  let tin = -Infinity;
  let tout = Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  // y slab
  if (Math.abs(dy) < 1e-12) {
    if (oy < o.y0 || oy > o.y1) return false;
  } else {
    let t0 = (o.y0 - oy) / dy;
    let t1 = (o.y1 - oy) / dy;
    let n0 = -1; // normal of the face entered at t0 (bottom face for an upward ray)
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
      n0 = 1;
    }
    tin = t0;
    ny = n0;
    tout = t1;
  }
  if (o.kind === "circle") {
    const a = dx * dx + dz * dz;
    const fx = ox - o.x;
    const fz = oz - o.z;
    const c = fx * fx + fz * fz - o.r * o.r;
    if (a < 1e-12) {
      if (c > 0) return false;
    } else {
      const b = fx * dx + fz * dz;
      const disc = b * b - a * c;
      if (disc < 0) return false;
      const s = Math.sqrt(disc);
      const t0 = (-b - s) / a;
      const t1 = (-b + s) / a;
      if (t0 > tin) {
        tin = t0;
        const px = fx + dx * t0;
        const pz = fz + dz * t0;
        const l = Math.hypot(px, pz) || 1;
        nx = px / l;
        nz = pz / l;
        ny = 0;
      }
      if (t1 < tout) tout = t1;
    }
  } else {
    const co = Math.cos(o.yaw);
    const si = Math.sin(o.yaw);
    const px = ox - o.x;
    const pz = oz - o.z;
    const lx = px * co + pz * si;
    const lz = -px * si + pz * co;
    const ldxx = dx * co + dz * si;
    const ldzz = -dx * si + dz * co;
    for (let axis = 0; axis < 2; axis++) {
      const p = axis === 0 ? lx : lz;
      const d = axis === 0 ? ldxx : ldzz;
      const h = axis === 0 ? o.hx : o.hz;
      if (Math.abs(d) < 1e-12) {
        if (p < -h || p > h) return false;
        continue;
      }
      let t0 = (-h - p) / d;
      let t1 = (h - p) / d;
      let sign = -1;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
        sign = 1;
      }
      if (t0 > tin) {
        tin = t0;
        // local axis normal rotated back into the world
        const lnx = axis === 0 ? sign : 0;
        const lnz = axis === 1 ? sign : 0;
        nx = lnx * co - lnz * si;
        nz = lnx * si + lnz * co;
        ny = 0;
      }
      if (t1 < tout) tout = t1;
    }
  }
  if (tin > tout || tout < 0) return false;
  if (tin < 0) {
    // starting inside: report a hit right here (a shot fired from within a solid stops at once)
    hitT = 0;
    hitNx = -dx;
    hitNy = -dy;
    hitNz = -dz;
    return maxT >= 0;
  }
  if (tin > maxT) return false;
  hitT = tin;
  hitNx = nx;
  hitNy = ny;
  hitNz = nz;
  return true;
}

// scratch state of the current world ray (module level so the query allocates nothing)
let qGrid: RayGrid | undefined;
let qStamp = 0;
let qOx = 0;
let qOy = 0;
let qOz = 0;
let qDx = 0;
let qDy = 0;
let qDz = 0;
let qBest = 0;
let qFound = false;
let qOut: WorldHit | undefined;

function visitCell(cx: number, cz: number): void {
  const g = qGrid!;
  const list = g.cells.get(cellKey(cx, cz));
  if (!list) return;
  for (let k = 0; k < list.length; k++) {
    const i = list[k]!;
    if (g.stamp[i] === qStamp) continue;
    g.stamp[i] = qStamp;
    const o = g.obstacles[i]!;
    if (rayObstacle(o, qOx, qOy, qOz, qDx, qDy, qDz, qBest) && hitT < qBest) {
      qBest = hitT;
      qFound = true;
      const out = qOut!;
      out.t = hitT;
      out.nx = hitNx;
      out.ny = hitNy;
      out.nz = hitNz;
      out.surface = surfaceOfTag(o.tag);
    }
  }
}

/**
 * Casts a ray (unit direction) into the static world - obstacles first, then the terrain - and reports the nearest hit within `maxT`
 * metres. Allocation-free after the first call for a world. Returns false when nothing is in the way.
 */
export function rayWorld(world: CollisionWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: WorldHit): boolean {
  const g = gridFor(world);
  if (g.next > 0xfffffff0) {
    g.stamp.fill(0);
    g.next = 1;
  }
  qGrid = g;
  qStamp = g.next++;
  qOx = ox;
  qOy = oy;
  qOz = oz;
  qDx = dx;
  qDy = dy;
  qDz = dz;
  qBest = maxT;
  qFound = false;
  qOut = out;

  // obstacles: walk the XZ grid cells the ray crosses (Amanatides-Woo; t is in 3D ray units)
  let cx = Math.floor(ox / CELL);
  let cz = Math.floor(oz / CELL);
  if (Math.hypot(dx, dz) < 1e-9) visitCell(cx, cz);
  else {
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    const tDeltaX = adx > 1e-12 ? CELL / adx : Infinity;
    const tDeltaZ = adz > 1e-12 ? CELL / adz : Infinity;
    let tMaxX = adx > 1e-12 ? (dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / adx : Infinity;
    let tMaxZ = adz > 1e-12 ? (dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / adz : Infinity;
    for (let guard = 0; guard < 256; guard++) {
      visitCell(cx, cz);
      const exit = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (exit >= qBest || exit > maxT) break;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
  }
  let best = qBest;
  let found = qFound;

  // terrain: march, then bisect the crossing
  if (oy < world.terrainHeight(ox, oz)) {
    out.t = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.surface = SURFACE.EARTH;
    return true;
  }
  let prevT = 0;
  let t = 0;
  for (let guard = 0; t < best && guard < 1200; guard++) {
    t = Math.min(best, t + Math.min(3, 0.5 + t * 0.03));
    if (oy + dy * t < world.terrainHeight(ox + dx * t, oz + dz * t)) {
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (oy + dy * mid < world.terrainHeight(ox + dx * mid, oz + dz * mid)) hi = mid;
        else lo = mid;
      }
      if (hi < best) {
        best = hi;
        found = true;
        out.t = hi;
        const px = ox + dx * hi;
        const pz = oz + dz * hi;
        const e = 0.3;
        let nx = world.terrainHeight(px - e, pz) - world.terrainHeight(px + e, pz);
        let nz = world.terrainHeight(px, pz - e) - world.terrainHeight(px, pz + e);
        const ny = 2 * e;
        const l = Math.hypot(nx, ny, nz);
        nx /= l;
        nz /= l;
        out.nx = nx;
        out.ny = ny / l;
        out.nz = nz;
        out.surface = SURFACE.EARTH;
      }
      break;
    }
    prevT = t;
  }
  qOut = undefined;
  return found;
}

// ---- melee ----------------------------------------------------------------------------------------------------------------------------------

const MELEE_YAW = [-1, -0.5, 0, 0.5, 1] as const;
const MELEE_ELEV = [-0.55, -0.2, 0.15, 0.4] as const;

/**
 * A swing as a fan of short rays (five across the arc, four in height) from the wielder's chest. Returns the nearest zone of `target`
 * that any ray reaches within `reach`, or false. The blade's own width is `inflate`.
 */
export function meleeFan(target: BodyPose, ox: number, oy: number, oz: number, yaw: number, elev: number, reach: number, arcHalf: number, inflate: number, out: BodyHit): boolean {
  let found = false;
  let bestT = Infinity;
  const tmp = scratchHit;
  for (let i = 0; i < MELEE_YAW.length; i++) {
    const y = yaw + MELEE_YAW[i]! * arcHalf;
    const sy = Math.sin(y);
    const cy = Math.cos(y);
    for (let j = 0; j < MELEE_ELEV.length; j++) {
      const e = elev + MELEE_ELEV[j]!;
      const ce = Math.cos(e);
      if (rayBody(target, ox, oy, oz, -sy * ce, Math.sin(e), -cy * ce, reach, inflate, tmp) && tmp.t < bestT) {
        bestT = tmp.t;
        out.t = tmp.t;
        out.zone = tmp.zone;
        out.x = tmp.x;
        out.y = tmp.y;
        out.z = tmp.z;
        found = true;
      }
    }
  }
  return found;
}

const scratchHit = newBodyHit();

