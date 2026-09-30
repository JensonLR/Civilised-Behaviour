import type { Obstacle } from "./collision.ts";
import { HILL, RIVER } from "./landscape.ts";
import { hashFloat } from "./rng.ts";
import type { Terrain } from "./terrain.ts";

/**
 * The Society's abandoned Observatory of Improvement, crowning the hill: a drum tower that once carried a dome, a colonnade of which
 * some columns still stand, and a broken aqueduct that marches down the slope toward the camp and spills the stream from its last
 * arch. This is the ONE plan that makes the collision (`ruinObstacles`, fed to `createArena`) and the visuals (client `ruins.ts`),
 * so a column you see is a column you cannot walk through. Pure, deterministic, allocation only when built.
 */

/** Collision yaw of the ruin's front: local +x points at the camp (the way the trail arrives). */
export const RUIN_YAW = Math.atan2(0 - HILL.z, 0 - HILL.x);

export interface Column {
  x: number;
  z: number;
  r: number;
  /** Height above the ground at its foot. */
  h: number;
  broken: boolean;
  /** Angle round the plateau centre, radians in the ruin's local frame (0 = the entrance). */
  a: number;
}

export interface Pier {
  x: number;
  z: number;
  r: number;
  /** Height of the pier top above the ground at its foot. */
  h: number;
  /** World height of the pier top (the springing of the arch above it). */
  top: number;
  /** Distance from the hill centre. */
  d: number;
}

/** The drum tower: a hollow ring of wall you can walk into through a doorway that faces the camp. */
export interface Tower {
  x: number;
  z: number;
  /** Outer and inner radius of the wall (metres). */
  r: number;
  rIn: number;
  /** Wall height above the ground (the dome springs from it). */
  h: number;
  /** Segments of the collision ring; the one at local angle 0 (facing the camp) is left out: that is the doorway. */
  segments: number;
  /** Half-angle of the doorway (radians) and its height (metres). */
  doorHalf: number;
  doorH: number;
  /** Radius of the plinth in the middle of the room. */
  plinth: number;
}

/** The great refractor on its stone pier in the courtyard, tilted up at the sky (drawn by the client; its pier is collidable). */
export interface Telescope {
  x: number;
  z: number;
  /** Pier radius and height. */
  r: number;
  h: number;
  /** World azimuth (radians, direction (cos, sin) in x/z) and elevation the tube points along. */
  az: number;
  el: number;
}

export interface RuinPlan {
  yaw: number;
  /** Plateau level (world y). */
  level: number;
  tower: Tower;
  telescope: Telescope;
  columns: Column[];
  piers: Pier[];
  /** Unit vector from the hill centre toward the aqueduct's end. */
  dir: { x: number; z: number };
  /** Distance from the hill centre to the aqueduct's broken end (its spill). */
  reach: number;
  /** A lantern hanging inside the tower (world x/z, y above the ground there): the one light in the dark room. */
  lantern: { x: number; z: number; y: number };
  /** Deck (water channel floor) world height at distance `d` from the hill centre. */
  deck(d: number): number;
}

const COLUMNS = 14;
export const TOWER_SEGMENTS = 14;
const COLONNADE_RADIUS = 8.4;
const PIER_SPACING = 4.6;

export function ruinPlan(terrain: Terrain): RuinPlan {
  const level = terrain.height(HILL.x, HILL.z);
  const yaw = RUIN_YAW;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const local = (lx: number, lz: number): { x: number; z: number } => ({ x: HILL.x + lx * cy - lz * sy, z: HILL.z + lx * sy + lz * cy });
  const columns: Column[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    const a = (i / COLUMNS) * Math.PI * 2;
    // the entrance faces the camp: leave a gap either side of local angle 0
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.36) continue;
    const p = local(Math.cos(a) * COLONNADE_RADIUS, Math.sin(a) * COLONNADE_RADIUS);
    const roll = hashFloat(0x0b5, i, 3);
    const broken = roll < 0.42;
    const ground = terrain.height(p.x, p.z);
    columns.push({ x: p.x, z: p.z, r: 0.5 + hashFloat(0x0b5, i, 4) * 0.08, h: broken ? 2.1 + roll * 6 : 6.4, broken, a });
    void ground;
  }
  const tc = local(-1.2, 0);
  const R_OUT = 3.35;
  const R_IN = 2.6;
  const tower: Tower = { x: tc.x, z: tc.z, r: R_OUT, rIn: R_IN, h: 9.2, segments: TOWER_SEGMENTS, doorHalf: Math.PI / TOWER_SEGMENTS, doorH: 3.1, plinth: 0.6 };
  const tp = local(-1.2 + 5.4, -3.6);
  const telescope: Telescope = { x: tp.x, z: tp.z, r: 0.62, h: 1.25, az: yaw - Math.PI * 0.5, el: 0.9 };
  // the aqueduct runs from the plateau edge toward the stream's source
  const ax = RIVER.a.x - HILL.x;
  const az = RIVER.a.z - HILL.z;
  const reach = Math.hypot(ax, az);
  const dir = { x: ax / reach, z: az / reach };
  const deck = (d: number): number => level + 1.2 - (d - 10) * 0.05;
  const piers: Pier[] = [];
  for (let d = 14; d < reach - 1.5; d += PIER_SPACING) {
    const x = HILL.x + dir.x * d;
    const z = HILL.z + dir.z * d;
    const top = deck(d) - 0.9;
    piers.push({ x, z, r: 0.95, h: top - terrain.height(x, z), top, d });
  }
  const lp = local(-1.2 - 2.05, 0); // on the wall opposite the door
  const lantern = { x: lp.x, z: lp.z, y: 2.4 };
  return { yaw, level, tower, telescope, columns, piers, dir, reach, lantern, deck };
}

/**
 * The ruin's collidable parts: the tower as a RING of wall boxes with a doorway (and a plinth in the middle of the room), the standing
 * and broken columns, the telescope's pier, the aqueduct piers.
 */
export function ruinObstacles(terrain: Terrain): Obstacle[] {
  const plan = ruinPlan(terrain);
  const out: Obstacle[] = [];
  const t = plan.tower;
  const g = terrain.height(t.x, t.z);
  const mid = (t.r + t.rIn) / 2;
  const step = (Math.PI * 2) / t.segments;
  for (let i = 1; i < t.segments; i++) {
    // segment 0 is the doorway (local angle 0 faces the camp); each wall box is tangent to the ring and overlaps its neighbours a touch
    const a = i * step;
    const wa = plan.yaw + a; // world angle of the segment's centre
    const cx = t.x + Math.cos(wa) * mid;
    const cz = t.z + Math.sin(wa) * mid;
    out.push({ kind: "box", tag: "ruin", x: cx, z: cz, hx: mid * Math.tan(step / 2) + 0.03, hz: (t.r - t.rIn) / 2, yaw: wa + Math.PI / 2, y0: g - 1, y1: g + t.h });
  }
  out.push({ kind: "circle", tag: "ruin", x: t.x, z: t.z, r: t.plinth, y0: g - 1, y1: g + 1.1 });
  for (const c of plan.columns) {
    const y = terrain.height(c.x, c.z);
    out.push({ kind: "circle", tag: "ruin", x: c.x, z: c.z, r: c.r, y0: y - 1, y1: y + c.h });
  }
  const sc = plan.telescope;
  out.push({ kind: "circle", tag: "ruin", x: sc.x, z: sc.z, r: sc.r, y0: terrain.height(sc.x, sc.z) - 1, y1: terrain.height(sc.x, sc.z) + sc.h });
  for (const p of plan.piers) {
    const y = terrain.height(p.x, p.z);
    out.push({ kind: "circle", tag: "ruin", x: p.x, z: p.z, r: p.r, y0: y - 1, y1: p.top });
  }
  return out;
}
