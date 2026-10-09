import { insideObstacle } from "./camp.ts";
import type { CollisionWorld } from "./collision.ts";
import { PEN } from "./clearing.ts";
import { RIVER, waterEdgeDistance } from "./landscape.ts";
import { clamp, smoothstep, wrapAngle } from "./math.ts";
import { Rng } from "./rng.ts";
import { villagePlan } from "./village.ts";

/**
 * The flock: sheep and goats that graze and wander. They are SCENERY, not simulation: a pure function of the world (which fixes each
 * animal's route of waypoints once, clear of every obstacle) and of the world clock (which fixes where on that route it is right now),
 * so every client sees the same animals in the same places with no messages and no server work. They are not obstacles: nobody collides
 * with a sheep. Routes are validated in `buildFlock` (straight, clear of obstacles and water) and traversed back and forth, so they need
 * no closing segment.
 */

export type AnimalKind = "sheep" | "goat" | "deer" | "stag" | "duck" | "cat";

export interface FlockSpec {
  kind: AnimalKind;
  count: number;
  home: { x: number; z: number };
  radius: number;
  /** Stay inside the pen's fence (waypoints are inside the rails, with room to spare). */
  inPen?: boolean;
  /** Swim: waypoints are in the pond's open water (clear of the jetty and the piles), not on land. */
  water?: boolean;
  /** The village cat: `home` is replaced by the granary steps (`villagePlan(...).cat`) and the first waypoint is the steps themselves, where it sleeps at night. */
  cat?: boolean;
}

export const FLOCKS: readonly FlockSpec[] = [
  { kind: "sheep", count: 5, home: { x: PEN.x, z: PEN.z }, radius: 3.6, inPen: true },
  { kind: "sheep", count: 4, home: { x: -8.5, z: 25 }, radius: 8 },
  { kind: "goat", count: 3, home: { x: -14, z: 8 }, radius: 6 },
  // the pond's ducks (the open water south of the jetty) and the deer at the forest edge east of the camp: both are scenery to be looked at from afar
  { kind: "duck", count: 4, home: { x: RIVER.b.x, z: RIVER.b.z + 0.6 }, radius: 4.2, water: true },
  { kind: "deer", count: 2, home: { x: 47, z: 9 }, radius: 9 },
  { kind: "stag", count: 1, home: { x: 47, z: 9 }, radius: 9 },
  // the cat: by the granary in the village (its home is filled in from the village plan)
  { kind: "cat", count: 1, home: { x: 0, z: 0 }, radius: 3.4, cat: true },
];

export interface Animal {
  kind: AnimalKind;
  /** Waypoints, flat [x, z, ...]; the animal walks them back and forth. */
  route: Float32Array;
  /** Seconds per leg (walk, then graze). */
  leg: number;
  /** Offset (seconds) so the flock is not in step. */
  phase: number;
  /** Body scale around 1. */
  size: number;
  /** 0..1 random for colour variation. */
  tone: number;
  /** 0..1 random for gait phase and facing. */
  seed: number;
  /** Sleeps curled up at route[0] through the night (the cat). */
  sleeper?: boolean;
}

export interface AnimalPose {
  x: number;
  z: number;
  /** Heading: direction (cos yaw, sin yaw) in x/z. */
  yaw: number;
  /** 0 standing .. 1 striding. */
  speed: number;
  /** 1 while grazing (head down), else 0; eases in and out. */
  graze: number;
  /** Metres per second right now. */
  mps: number;
  /** 1 while curled up asleep (a sleeper at night), else 0; eases in and out. */
  curl: number;
}

export const createAnimalPose = (): AnimalPose => ({ x: 0, z: 0, yaw: 0, speed: 0, graze: 0, mps: 0, curl: 0 });

const CLEAR = 0.9;
/** Body scale of each kind (the models share one frame: about a goat's size at scale 1) and the random spread added on top. */
const SIZE: Record<AnimalKind, number> = { sheep: 0.95, goat: 0.86, deer: 1.45, stag: 1.75, duck: 0.4, cat: 0.5 };
const SIZE_SPREAD: Record<AnimalKind, number> = { sheep: 0.16, goat: 0.16, deer: 0.14, stag: 0.08, duck: 0.05, cat: 0.05 };
/** Seconds an animal takes to turn on the spot at the start of a leg. */
const TURN = 1.8;

/** Free ground for an animal: off every obstacle by `margin`, out of the water, on gentle ground, inside the map. */
function freeSpot(world: CollisionWorld, x: number, z: number, margin: number): boolean {
  if (Math.hypot(x, z) > world.boundsRadius - 8) return false;
  if (waterEdgeDistance(x, z) < 1.2) return false;
  let hit = false;
  world.forEachNear(x, z, (o) => {
    if (!hit && insideObstacle(o, x, z, margin)) hit = true;
  });
  if (hit) return false;
  const h = world.terrainHeight(x, z);
  return Math.hypot(world.terrainHeight(x + 0.6, z) - h, world.terrainHeight(x, z + 0.6) - h) / 0.6 < 0.55;
}

/** Open water for a duck: well inside the pond's edge and off every obstacle (the jetty's piles, the stepping stones, the punt) by `margin`. */
function freeWater(world: CollisionWorld, x: number, z: number, margin: number): boolean {
  if (Math.hypot(x - RIVER.b.x, z - RIVER.b.z) > RIVER.pondRadius - 1.1) return false;
  let hit = false;
  world.forEachNear(x, z, (o) => {
    if (!hit && insideObstacle(o, x, z, margin)) hit = true;
  });
  return !hit;
}

/** A straight leg is walkable if every half-metre along it is free ground (or open water, for a swimmer). */
function freeLeg(world: CollisionWorld, ax: number, az: number, bx: number, bz: number, margin: number, water = false): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const z = az + ((bz - az) * i) / n;
    if (!(water ? freeWater(world, x, z, margin) : freeSpot(world, x, z, margin))) return false;
  }
  return true;
}

/** Fixes every animal's route for this world. Deterministic in the world; call once when the world is built. */
export function buildFlock(world: CollisionWorld, flocks: readonly FlockSpec[] = FLOCKS): Animal[] {
  const out: Animal[] = [];
  if (world.obstacles.length === 0) return out;
  const catAt = villagePlan(world.terrain).cat;
  flocks.forEach((f, fi) => {
    const home = f.cat ? catAt : f.home;
    for (let i = 0; i < f.count; i++) {
      const rng = new Rng(0xf10c + fi * 977 + i * 31);
      const inside = (x: number, z: number): boolean => (f.inPen ? Math.abs(x - PEN.x) < PEN.hx - 1.0 && Math.abs(z - PEN.z) < PEN.hz - 1.0 : Math.hypot(x - home.x, z - home.z) < f.radius);
      const margin = f.inPen ? 0.7 : f.water ? 0.8 : f.cat ? 0.5 : CLEAR;
      const free = (x: number, z: number): boolean => (f.water ? freeWater(world, x, z, margin) : freeSpot(world, x, z, margin));
      // candidate waypoints (the cat's first is the steps it sleeps on, if they are clear)
      const pts: [number, number][] = [];
      if (f.cat && freeSpot(world, catAt.x, catAt.z, margin)) pts.push([catAt.x, catAt.z]);
      for (let tries = 0; pts.length < 8 && tries < 400; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const d = f.radius * Math.sqrt(rng.next());
        const x = home.x + Math.cos(a) * d;
        const z = home.z + Math.sin(a) * d;
        if (inside(x, z) && free(x, z)) pts.push([x, z]);
      }
      // chain them: from each waypoint go to a random other one the straight line to which is clear
      const route: number[] = [];
      if (pts.length > 0) {
        let cur = pts.splice(f.cat ? 0 : Math.floor(rng.next() * pts.length), 1)[0]!;
        route.push(cur[0], cur[1]);
        for (let step = 0; step < 6 && pts.length > 0; step++) {
          const options = pts.map((p, idx) => ({ p, idx })).filter(({ p }) => Math.hypot(p[0] - cur[0], p[1] - cur[1]) > 2.2 && Math.hypot(p[0] - cur[0], p[1] - cur[1]) < 9 && freeLeg(world, cur[0], cur[1], p[0], p[1], margin * 0.7, f.water));
          if (options.length === 0) break;
          const pick = options[Math.floor(rng.next() * options.length)]!;
          pts.splice(pick.idx, 1);
          cur = pick.p;
          route.push(cur[0], cur[1]);
        }
      }
      if (route.length === 0) continue; // nowhere clear to stand: no animal
      // back and forth: forward then backward without repeating the ends
      const n = route.length / 2;
      const full: number[] = [...route];
      for (let k = n - 2; k >= 1; k--) full.push(route[k * 2]!, route[k * 2 + 1]!);
      out.push({
        kind: f.kind,
        route: new Float32Array(full),
        leg: 15 + rng.next() * 9,
        phase: rng.next() * 400,
        size: SIZE[f.kind] + rng.next() * SIZE_SPREAD[f.kind],
        tone: rng.next(),
        seed: rng.next(),
        sleeper: f.cat ? true : undefined,
      });
    }
  });
  return out;
}

/** Body radius of each kind at scale 1 (m), nose to tail: two animals' middles never come nearer than the sum of theirs (a head never pokes into a neighbour). */
export const BODY_R: Readonly<Record<AnimalKind, number>> = { sheep: 0.62, goat: 0.56, deer: 0.72, stag: 0.82, duck: 0.2, cat: 0.24 };

/**
 * A flock grazes shoulder to shoulder, never through each other: each animal walks its own route, the routes of a small flock cross, and two of them stood in
 * one another. This pushes apart any two of the first `n` animals (middles `x`, `z`, body radii `r`) that are nearer than their radii allow, each by half the
 * overlap, in a few passes. Deterministic in its inputs (every client sees the same flock) and allocation-free.
 */
export function separateBodies(x: Float64Array, z: Float64Array, r: Float64Array, n: number, passes = 4): void {
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = x[j]! - x[i]!, dz = z[j]! - z[i]!;
      const want = r[i]! + r[j]!;
      const d = Math.hypot(dx, dz);
      if (d >= want) continue;
      let ux = dx / d, uz = dz / d;
      if (d < 1e-6) {
        // (exactly on top of each other: part them along a direction fixed by the pair, the same on every client)
        const a = (i * 7 + j * 13) * 0.61803;
        ux = Math.cos(a);
        uz = Math.sin(a);
      }
      const push = (want - d) / 2;
      x[i] = x[i]! - ux * push;
      z[i] = z[i]! - uz * push;
      x[j] = x[j]! + ux * push;
      z[j] = z[j]! + uz * push;
    }
  }
}

/** Scratch for `separateCapsules`: the two closest points (x, z, x, z). */
const closest = new Float64Array(4);

/** Writes the closest points of the plan segments p1-q1 and p2-q2 into `closest` and returns their distance (Ericson's method, clamped to both segments). */
function segmentGap(p1x: number, p1z: number, q1x: number, q1z: number, p2x: number, p2z: number, q2x: number, q2z: number): number {
  const d1x = q1x - p1x, d1z = q1z - p1z, d2x = q2x - p2x, d2z = q2z - p2z;
  const rx = p1x - p2x, rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1z * rz;
    if (e <= 1e-9) s = clamp(-c / a, 0, 1);
    else {
      const b = d1x * d2x + d1z * d2z;
      const den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  closest[0] = p1x + d1x * s;
  closest[1] = p1z + d1z * s;
  closest[2] = p2x + d2x * t;
  closest[3] = p2z + d2z * t;
  return Math.hypot(closest[2]! - closest[0]!, closest[3]! - closest[1]!);
}

/**
 * As `separateBodies`, for long beasts: each of the first `n` is a capsule along its heading `yaw` (from `back` behind its middle to `front` ahead of it, `r`
 * wide), and two that overlap are pushed apart along the line between their nearest points. A circle round a 2.8 m beast would hold its neighbours a body
 * length off at the shoulder; one round its body let a head stand in the next one's flank.
 */
export function separateCapsules(x: Float64Array, z: Float64Array, yaw: Float64Array, back: number, front: number, r: number, n: number, passes = 8): void {
  const want = 2 * r;
  const reach = 2 * Math.max(front, back) + want; // (two heads facing: each spine's longer end towards the other)
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(x[j]! - x[i]!) > reach || Math.abs(z[j]! - z[i]!) > reach) continue;
      const ci = Math.cos(yaw[i]!), si = Math.sin(yaw[i]!), cj = Math.cos(yaw[j]!), sj = Math.sin(yaw[j]!);
      const d = segmentGap(x[i]! - ci * back, z[i]! - si * back, x[i]! + ci * front, z[i]! + si * front, x[j]! - cj * back, z[j]! - sj * back, x[j]! + cj * front, z[j]! + sj * front);
      if (d >= want) continue;
      let ux = closest[2]! - closest[0]!, uz = closest[3]! - closest[1]!;
      if (d < 1e-6) {
        // (the spines cross: part them along a direction fixed by the pair, the same on every client)
        const a = (i * 7 + j * 13) * 0.61803;
        ux = Math.cos(a);
        uz = Math.sin(a);
      } else {
        ux /= d;
        uz /= d;
      }
      const push = (want - d) / 2;
      x[i] = x[i]! - ux * push;
      z[i] = z[i]! - uz * push;
      x[j] = x[j]! + ux * push;
      z[j] = z[j]! + uz * push;
    }
  }
}

const legIndex = (a: Animal, t: number): { i: number; u: number } => {
  const n = a.route.length / 2;
  const tt = t + a.phase;
  const k = Math.floor(tt / a.leg);
  return { i: ((k % n) + n) % n, u: (tt - k * a.leg) / a.leg };
};

/** How much of the night a sleeper has settled into (0 awake, 1 curled up): eases in at 21:00 and out at 06:00, each in a quarter of an hour of world time. */
export function sleepWeight(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  return h >= 12 ? smoothstep(21, 21.25, h) : 1 - smoothstep(5.75, 6, h);
}

/**
 * Where an animal is, which way it faces and how it moves, `t` seconds into the world's life. `hours` (the time of day) only matters to a
 * sleeper: at night it is curled up at the first waypoint, and it goes there in the quarter hour before. Pure; allocation-free with `out`.
 */
export function animalPose(a: Animal, t: number, out: AnimalPose = createAnimalPose(), hours = 12): AnimalPose {
  animalRoutePose(a, t, out);
  out.curl = 0;
  if (a.sleeper) {
    const w = sleepWeight(hours);
    if (w > 0) {
      const hx = a.route[0]!;
      const hz = a.route[1]!;
      const dx = hx - out.x;
      const dz = hz - out.z;
      const d = Math.hypot(dx, dz);
      if (w >= 1 || d < 0.02) {
        out.x = hx;
        out.z = hz;
        if (w >= 1) out.yaw = a.seed * Math.PI * 2;
        out.speed = 0;
        out.mps = 0;
        out.graze = 0;
      } else {
        out.x += dx * w;
        out.z += dz * w;
        out.yaw = Math.atan2(dz, dx);
        out.speed = 0.5 * (1 - w);
        out.mps = 0.45 * out.speed;
        out.graze = 0;
      }
      out.curl = smoothstep(0.9, 1, w);
    }
  }
  return out;
}

function animalRoutePose(a: Animal, t: number, out: AnimalPose): AnimalPose {
  const n = a.route.length / 2;
  const { i, u } = legIndex(a, t);
  const j = (i + 1) % n;
  const ax = a.route[i * 2]!;
  const az = a.route[i * 2 + 1]!;
  if (n === 1) {
    out.x = ax;
    out.z = az;
    out.yaw = a.seed * Math.PI * 2;
    out.speed = 0;
    out.graze = 1;
    out.mps = 0;
    return out;
  }
  const bx = a.route[j * 2]!;
  const bz = a.route[j * 2 + 1]!;
  const len = Math.hypot(bx - ax, bz - az);
  // A leg: turn on the spot toward the next waypoint (TURN seconds), stroll there (~0.85 m/s, eased), then graze for the rest of it.
  const sec = u * a.leg;
  const walk = clamp(len / 0.85, 2, a.leg - TURN - 1.8);
  const m = clamp((sec - TURN) / walk, 0, 1);
  const e = m * m * (3 - 2 * m);
  out.x = ax + (bx - ax) * e;
  out.z = az + (bz - az) * e;
  const yawNow = Math.atan2(bz - az, bx - ax);
  const h = (i - 1 + n) % n;
  const yawPrev = Math.atan2(az - a.route[h * 2 + 1]!, ax - a.route[h * 2]!);
  out.yaw = yawPrev + wrapAngle(yawNow - yawPrev) * smoothstep(0, TURN, sec);
  const walking = sec >= TURN && sec < TURN + walk;
  out.mps = walking ? (6 * m * (1 - m) * len) / walk : 0;
  out.speed = clamp(out.mps / 0.9, 0, 1);
  // grazing: after the walk the head goes down (eased), and comes up before the next turn
  const end = TURN + walk;
  out.graze = sec < end ? 0 : smoothstep(end, end + 1.2, sec) * (1 - smoothstep(a.leg - 1.5, a.leg - 0.2, sec));
  return out;
}
