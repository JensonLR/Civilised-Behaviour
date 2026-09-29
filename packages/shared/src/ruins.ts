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

export interface RuinPlan {
  yaw: number;
  /** Plateau level (world y). */
  level: number;
  tower: { x: number; z: number; r: number; h: number };
  columns: Column[];
  piers: Pier[];
  /** Unit vector from the hill centre toward the aqueduct's end. */
  dir: { x: number; z: number };
  /** Distance from the hill centre to the aqueduct's broken end (its spill). */
  reach: number;
  /** Deck (water channel floor) world height at distance `d` from the hill centre. */
  deck(d: number): number;
}

const COLUMNS = 14;
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
  const tower = { x: tc.x, z: tc.z, r: 3.3, h: 11 };
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
  return { yaw, level, tower, columns, piers, dir, reach, deck };
}

/** The ruin's collidable parts: the tower, the standing and broken columns, the aqueduct piers. */
export function ruinObstacles(terrain: Terrain): Obstacle[] {
  const plan = ruinPlan(terrain);
  const out: Obstacle[] = [];
  const t = plan.tower;
  const g = terrain.height(t.x, t.z);
  out.push({ kind: "circle", tag: "ruin", x: t.x, z: t.z, r: t.r, y0: g - 1, y1: g + t.h });
  for (const c of plan.columns) {
    const y = terrain.height(c.x, c.z);
    out.push({ kind: "circle", tag: "ruin", x: c.x, z: c.z, r: c.r, y0: y - 1, y1: y + c.h });
  }
  for (const p of plan.piers) {
    const y = terrain.height(p.x, p.z);
    out.push({ kind: "circle", tag: "ruin", x: p.x, z: p.z, r: p.r, y0: y - 1, y1: p.top });
  }
  return out;
}
