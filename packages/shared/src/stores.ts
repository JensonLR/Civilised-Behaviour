import { CAMP, inCampFootprint } from "./camp.ts";
import type { CollisionWorld } from "./collision.ts";
import { PROP_DEFS, PropKind, hqKeepOut, type PropKindId, type PropSpawn } from "./props.ts";
import { hashFloat } from "./rng.ts";

/**
 * THE STORES (D-115): the loose props a region starts with, set down by someone who meant it. They used to be strewn: a random point in a disc and a random
 * heading each, so every landing opened on crates at the player's feet, a chair alone in the grass and a bottle on the path. Now each heap is a still life (a stack
 * of crates against nothing in particular, barrels shoulder to shoulder, chairs round the fire with the empties beside them), placed at the side of the way rather
 * than in it, and never in the arrival: the ring the party lands in, the view up the way it must go, or the ground behind it where the camera hangs.
 *
 * Frame (as `levelPlan.ts`): a still life's local +x is its FRONT (the face toward the way), local +z to its right; world = (x + lx cos - lz sin, z + lx sin + lz cos).
 * Pure and deterministic: the jitter is a hash of the still life's place, never a clock or `Math.random`.
 */

export interface StorePiece {
  kind: PropKindId;
  /** Local position (metres) and height of its underside above the ground (a crate on a crate). */
  lx: number;
  lz: number;
  up: number;
  /** Heading in the prop's own convention (the physics yaw: a chair faces (sin yaw, cos yaw)), relative to the still life. */
  yaw: number;
  /** Indices (in the same still life) of the pieces it rests on: it is not there if any of them is not. */
  on: readonly number[];
}

export interface StillLife {
  x: number;
  z: number;
  /** Collision-convention yaw of the still life's front (+x). */
  yaw: number;
  pieces: readonly StorePiece[];
}

const CRATE_W = PROP_DEFS[PropKind.CRATE].half[0] * 2;
const CRATE_H = PROP_DEFS[PropKind.CRATE].half[1] * 2;
const BARREL_D = PROP_DEFS[PropKind.BARREL].half[0] * 2;
/** Between two crates in a row (a finger's gap), and between barrels. */
const CRATE_PITCH = CRATE_W + 0.04;
const BARREL_PITCH = BARREL_D + 0.05;

/**
 * Crates stacked in courses, bottom first (`[3, 2, 1]` is a pyramid of six): each course runs along local z, centred, and each crate above sits across the two below.
 * A course longer than the one under it is cut to fit.
 */
export function crateStack(courses: readonly number[]): StorePiece[] {
  const out: StorePiece[] = [];
  let below: number[] = [];
  courses.forEach((wanted, c) => {
    const n = c === 0 ? wanted : Math.min(wanted, Math.max(0, below.length - 1));
    const row: number[] = [];
    for (let i = 0; i < n; i++) {
      const lz = (i - (n - 1) / 2) * CRATE_PITCH;
      // a crate above rests on the two it straddles (the bottom course on the ground)
      const on = c === 0 ? [] : [below[i]!, below[i + 1]!];
      row.push(out.length);
      out.push({ kind: PropKind.CRATE, lx: 0, lz, up: c * (CRATE_H + 0.005), yaw: 0, on });
    }
    below = row;
  });
  return out;
}

/** Barrels shoulder to shoulder along local z. */
export function barrelRow(n: number): StorePiece[] {
  return Array.from({ length: n }, (_, i) => ({ kind: PropKind.BARREL, lx: 0, lz: (i - (n - 1) / 2) * BARREL_PITCH, up: 0, yaw: 0, on: [] }));
}

/** Three barrels in a triangle (two at the front, one behind them), or four in a lozenge. */
export function barrelHuddle(n: 3 | 4): StorePiece[] {
  const h = BARREL_PITCH / 2;
  const back = -BARREL_PITCH * 0.87;
  const pts: [number, number][] = n === 3 ? [[0, -h], [0, h], [back, 0]] : [[0, -h], [0, h], [back, -h * 2], [back, 0]];
  return pts.map(([lx, lz]) => ({ kind: PropKind.BARREL, lx, lz, up: 0, yaw: 0, on: [] }));
}

/**
 * `n` chairs on an arc of radius `r` round the still life's origin (the fire, the table), between local angles `from` and `to` (radians from local +x toward +z),
 * each turned to face the middle.
 */
export function chairCircle(n: number, r: number, from: number, to: number): StorePiece[] {
  const out: StorePiece[] = [];
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? (from + to) / 2 : from + ((to - from) * i) / (n - 1);
    const lx = Math.cos(a) * r;
    const lz = Math.sin(a) * r;
    // a chair faces (sin yaw, cos yaw): toward the middle is (-lx, -lz) in the local frame
    out.push({ kind: PropKind.CHAIR, lx, lz, up: 0, yaw: Math.atan2(-lx, -lz), on: [] });
  }
  return out;
}

/** `n` chairs side by side along local z, all facing the front (local +x): a waiting line, the front row at a funeral. */
export function chairRow(n: number, pitch = 0.62): StorePiece[] {
  return Array.from({ length: n }, (_, i) => ({ kind: PropKind.CHAIR, lx: 0, lz: (i - (n - 1) / 2) * pitch, up: 0, yaw: Math.PI / 2, on: [] }));
}

/** A crate for a desk with a chair behind it facing the front (and, if `kind` says so, a barrel for the desk instead), and an empty on the ground beside it. */
export function desk(top: PropKindId = PropKind.CRATE): StorePiece[] {
  return [{ kind: top, lx: 0, lz: 0, up: 0, yaw: 0, on: [] }, ...shifted(chairCircle(1, 0.88, Math.PI, Math.PI), 0, 0), ...bottles(1, 0.1, 0.62)];
}

/** Empties: `n` bottles set down together at (lx, lz). */
export function bottles(n: number, lx: number, lz: number): StorePiece[] {
  const ring: [number, number][] = [[0, 0], [0.16, 0.1], [-0.05, 0.19], [0.12, -0.14]];
  return ring.slice(0, n).map(([dx, dz]) => ({ kind: PropKind.BOTTLE, lx: lx + dx, lz: lz + dz, up: 0, yaw: 0, on: [] }));
}

/** Pieces moved by (dx, dz) in the still life's frame (and their rests renumbered after `base` pieces), so builders can be put side by side. */
export function shifted(pieces: readonly StorePiece[], dx: number, dz: number, base = 0): StorePiece[] {
  return pieces.map((p) => ({ ...p, lx: p.lx + dx, lz: p.lz + dz, on: p.on.map((i) => i + base) }));
}

/** Several builders as one still life: each group's rests are renumbered for where it lands in the list. */
export function compose(...groups: readonly (readonly StorePiece[])[]): StorePiece[] {
  const out: StorePiece[] = [];
  for (const g of groups) out.push(...shifted(g, 0, 0, out.length));
  return out;
}

/** How far a prop reaches from its centre on the ground (its keep-out radius). */
export function pieceRadius(kind: PropKindId): number {
  const d = PROP_DEFS[kind];
  return d.shape === "box" ? Math.hypot(d.half[0], d.half[2] || d.half[0]) : d.half[0];
}

/**
 * The spawns of a still life: every piece whose ground `fits` (bottom pieces only: a crate above stands where the two under it do), and none resting on a piece that
 * did not. A hair of jitter (a hash of the place) turns each piece a degree or three off true so a stack reads as stacked by hand, not printed.
 */
export function placeStillLife(sl: StillLife, fits: (x: number, z: number, r: number) => boolean, out: PropSpawn[], missed?: (x: number, z: number, kind: PropKindId) => void): number {
  const c = Math.cos(sl.yaw);
  const s = Math.sin(sl.yaw);
  const placed: boolean[] = [];
  let n = 0;
  sl.pieces.forEach((p, i) => {
    const x = sl.x + p.lx * c - p.lz * s;
    const z = sl.z + p.lx * s + p.lz * c;
    const ok = p.on.length > 0 ? p.on.every((j) => placed[j]) : fits(x, z, pieceRadius(p.kind));
    placed.push(ok);
    if (!ok) {
      missed?.(x, z, p.kind);
      return;
    }
    const jitter = (hashFloat(Math.round(sl.x * 10), Math.round(sl.z * 10), i, 0x570e) - 0.5) * (p.kind === PropKind.CHAIR ? 0.25 : 0.1);
    // (the physics yaw turns the other way to the frame's: a piece's local heading `yaw` is `yaw - sl.yaw` in the world, so a crate's faces line up with the stack's front)
    const spawn: PropSpawn = { kind: p.kind, x, z, yaw: p.yaw - sl.yaw + jitter };
    if (p.up > 0) spawn.up = p.up;
    out.push(spawn);
    n++;
  });
  return n;
}

/** The middle of a landing's ring of four (the spawn function a region exports). */
export function arrivalCentre(spawn: (index: number, count: number) => { x: number; z: number }): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (let i = 0; i < 4; i++) {
    const p = spawn(i, 4);
    x += p.x / 4;
    z += p.z / 4;
  }
  return { x, z };
}

/** Every landing faces up the way north (the camera's first look is along -z). */
export const ARRIVAL_TOWARD = { x: 0, z: -1 } as const;

/**
 * The arrival (D-115): the ground nothing loose may stand on at a landing. The ring the party lands in (`ringR` round its middle), the view up the way it must go
 * (a corridor `aheadW` either side of the line toward `toward`, `aheadL` long), and the ground behind the ring where the camera hangs (`behindL` back, `behindW`
 * either side). `r` is the prop's own reach.
 */
export const ARRIVAL = { ringR: 4.6, aheadL: 18, aheadW: 2.6, behindL: 5, behindW: 2.4 } as const;

export function inArrival(centre: { x: number; z: number }, toward: { x: number; z: number }, x: number, z: number, r: number): boolean {
  const dx = x - centre.x;
  const dz = z - centre.z;
  if (dx * dx + dz * dz < (ARRIVAL.ringR + r) ** 2) return true;
  const len = Math.hypot(toward.x, toward.z) || 1;
  const fx = toward.x / len;
  const fz = toward.z / len;
  const along = dx * fx + dz * fz;
  const across = Math.abs(-dx * fz + dz * fx);
  if (along >= 0 && along <= ARRIVAL.aheadL && across < ARRIVAL.aheadW + r) return true;
  return along < 0 && along >= -ARRIVAL.behindL && across < ARRIVAL.behindW + r;
}

/**
 * Where the expedition's own kegs come ashore (the manifest's powder, D-047): rows on the bank east of the landing, well beside the arrival (the hands come ashore round
 * it, and a keg at a hand's feet was knocked flat), each on open, dry ground clear of the region's own stores (`props`) and of the kegs before it. Up to `n` spots.
 */
export function kitKegSpots(land: { x: number; z: number }, arrival: { x: number; z: number }, world: CollisionWorld, props: readonly { x: number; z: number }[], n: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const t = world.terrain as { waterDepth?: (x: number, z: number) => number };
  const r = pieceRadius(PropKind.BARREL);
  const pos = { x: 0, z: 0 };
  for (let row = 0; row < 6 && out.length < n; row++) {
    for (let col = 0; col < 8 && out.length < n; col++) {
      const x = land.x + 6.4 + col * 0.74 + (row % 2) * 0.37;
      const z = land.z - 2.4 - row * 0.68;
      if (inArrival(arrival, ARRIVAL_TOWARD, x, z, r + 0.6) || (t.waterDepth?.(x, z) ?? 0) > 0) continue;
      if (props.some((p) => Math.hypot(p.x - x, p.z - z) < 0.95) || out.some((p) => Math.hypot(p.x - x, p.z - z) < 0.7)) continue;
      pos.x = x;
      pos.z = z;
      if (world.resolveXZ(pos, world.terrainHeight(x, z), r + 0.15, 1.2)) continue;
      out.push({ x, z });
    }
  }
  return out;
}

/** The middle of Hollowmere's spawn ring (`arena.ts` `spawnPoint` rings the origin; not imported, so the region modules can use this file without a cycle). */
export const HUB_ARRIVAL = { x: 0, z: 0 } as const;

/**
 * Hollowmere's camp (D-115): the expedition's own loose things, where an expedition would have left them. Three chairs drawn up on the far side of the fire with the
 * empties at their feet; the baggage stacked beside the trunks; three barrels by the cart; and one chair turned to the gramophone. The fire's circle turns a little with
 * the campaign's seed, so no two camps are quite the same. Never in the arrival, in the camp's own furniture, by a finger-post or on the two walked lines.
 */
export function campProps(seed: number, world: CollisionWorld): PropSpawn[] {
  const out: PropSpawn[] = [];
  const pos = { x: 0, z: 0 };
  const fits = (x: number, z: number, r: number): boolean => {
    if (inArrival(HUB_ARRIVAL, ARRIVAL_TOWARD, x, z, r) || inCampFootprint(x, z, r + 0.25) || hqKeepOut(x, z)) return false;
    pos.x = x;
    pos.z = z;
    return !world.resolveXZ(pos, world.terrainHeight(x, z), Math.max(0.35, r + 0.15), 1.2);
  };
  const turn = (hashFloat(seed, 0x5f1, 0, 0) - 0.5) * 0.5;
  const ear = 0.2 + hashFloat(seed, 0x5f2, 0, 0) * 0.7;
  const f = CAMP.fire;
  const g = CAMP.gramophone;
  const lifes: StillLife[] = [
    { x: f.x, z: f.z, yaw: turn, pieces: compose(chairCircle(3, 2.05, -0.7, 0.7), bottles(2, 2.65, -0.42)) },
    { x: -2.4, z: 7.4, yaw: 0, pieces: crateStack([3, 2]) },
    { x: 6.8, z: 9.9, yaw: Math.PI / 2, pieces: barrelRow(3) },
    { x: g.x, z: g.z, yaw: 0, pieces: chairCircle(1, 1.35, ear, ear) },
  ];
  for (const sl of lifes) placeStillLife(sl, fits, out);
  return out;
}
