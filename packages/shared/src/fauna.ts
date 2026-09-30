import { insideObstacle } from "./camp.ts";
import type { CollisionWorld } from "./collision.ts";
import { PEN } from "./clearing.ts";
import { waterEdgeDistance } from "./landscape.ts";
import { clamp, smoothstep, wrapAngle } from "./math.ts";
import { Rng } from "./rng.ts";

/**
 * The flock: sheep and goats that graze and wander. They are SCENERY, not simulation: a pure function of the world (which fixes each
 * animal's route of waypoints once, clear of every obstacle) and of the world clock (which fixes where on that route it is right now),
 * so every client sees the same animals in the same places with no messages and no server work. They are not obstacles: nobody collides
 * with a sheep. Routes are validated in `buildFlock` (straight, clear of obstacles and water) and traversed back and forth, so they need
 * no closing segment.
 */

export type AnimalKind = "sheep" | "goat";

export interface FlockSpec {
  kind: AnimalKind;
  count: number;
  home: { x: number; z: number };
  radius: number;
  /** Stay inside the pen's fence (waypoints are inside the rails, with room to spare). */
  inPen?: boolean;
}

export const FLOCKS: readonly FlockSpec[] = [
  { kind: "sheep", count: 5, home: { x: PEN.x, z: PEN.z }, radius: 3.6, inPen: true },
  { kind: "sheep", count: 4, home: { x: -8.5, z: 25 }, radius: 8 },
  { kind: "goat", count: 3, home: { x: -14, z: 8 }, radius: 6 },
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
  /** Nominal walking speed for the gait (m/s) - the animation's stride follows it. */
  seed: number;
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
}

export const createAnimalPose = (): AnimalPose => ({ x: 0, z: 0, yaw: 0, speed: 0, graze: 0, mps: 0 });

const CLEAR = 0.9;
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

/** A straight leg is walkable if every half-metre along it is free ground. */
function freeLeg(world: CollisionWorld, ax: number, az: number, bx: number, bz: number, margin: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
  for (let i = 0; i <= n; i++) {
    if (!freeSpot(world, ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, margin)) return false;
  }
  return true;
}

/** Fixes every animal's route for this world. Deterministic in the world; call once when the world is built. */
export function buildFlock(world: CollisionWorld, flocks: readonly FlockSpec[] = FLOCKS): Animal[] {
  const out: Animal[] = [];
  if (world.obstacles.length === 0) return out;
  flocks.forEach((f, fi) => {
    for (let i = 0; i < f.count; i++) {
      const rng = new Rng(0xf10c + fi * 977 + i * 31);
      const inside = (x: number, z: number): boolean => (f.inPen ? Math.abs(x - PEN.x) < PEN.hx - 1.0 && Math.abs(z - PEN.z) < PEN.hz - 1.0 : Math.hypot(x - f.home.x, z - f.home.z) < f.radius);
      const margin = f.inPen ? 0.7 : CLEAR;
      // candidate waypoints
      const pts: [number, number][] = [];
      for (let tries = 0; pts.length < 8 && tries < 400; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const d = f.radius * Math.sqrt(rng.next());
        const x = f.home.x + Math.cos(a) * d;
        const z = f.home.z + Math.sin(a) * d;
        if (inside(x, z) && freeSpot(world, x, z, margin)) pts.push([x, z]);
      }
      // chain them: from each waypoint go to a random other one the straight line to which is clear
      const route: number[] = [];
      if (pts.length > 0) {
        let cur = pts.splice(Math.floor(rng.next() * pts.length), 1)[0]!;
        route.push(cur[0], cur[1]);
        for (let step = 0; step < 6 && pts.length > 0; step++) {
          const options = pts.map((p, idx) => ({ p, idx })).filter(({ p }) => Math.hypot(p[0] - cur[0], p[1] - cur[1]) > 2.2 && Math.hypot(p[0] - cur[0], p[1] - cur[1]) < 9 && freeLeg(world, cur[0], cur[1], p[0], p[1], margin * 0.7));
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
        size: (f.kind === "goat" ? 0.86 : 0.95) + rng.next() * 0.16,
        tone: rng.next(),
        seed: rng.next(),
      });
    }
  });
  return out;
}

const legIndex = (a: Animal, t: number): { i: number; u: number } => {
  const n = a.route.length / 2;
  const tt = t + a.phase;
  const k = Math.floor(tt / a.leg);
  return { i: ((k % n) + n) % n, u: (tt - k * a.leg) / a.leg };
};

/** Where an animal is, which way it faces and how it moves, `t` seconds into the world's life. Pure; allocation-free with `out`. */
export function animalPose(a: Animal, t: number, out: AnimalPose = createAnimalPose()): AnimalPose {
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
