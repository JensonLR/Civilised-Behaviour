import { CAMP } from "./camp.ts";
import { smoothstep } from "./math.ts";
import { valueNoise, type Terrain } from "./terrain.ts";

/**
 * The shape of the land beyond the camp, as pure deterministic data shared by the server (obstacle keep-out, terrain heights), the
 * client (terrain paint, water mesh, ruin) and the tests: the Observatory hill, a broken aqueduct whose last arch spills a stream, the
 * stream itself (a shallow ford ending in a pond), and the worn footpaths that connect the camp, the ford, the hill and the map edge.
 * Positions are authored constants (identical for every seed); only the ground noise underneath changes with the seed.
 * No `Math.random`, no `Date.now`, no allocation on the hot paths (`height`, `waterField`, `trailSample`).
 */

// ---- the hill ---------------------------------------------------------------------------------------------------------------------

/** A flat-topped hill north-east of the camp, crowned by the ruined Observatory: the map's visual goal. */
export const HILL = { x: 34, z: -60, plateau: 10, base: 36, rise: 10 } as const;

// ---- the stream ---------------------------------------------------------------------------------------------------------------------

const AX = 24;
const AZ = -27.5;
const BX = -20;
const BZ = -36;
const RLEN = Math.hypot(BX - AX, BZ - AZ);
const RDX = (BX - AX) / RLEN;
const RDZ = (BZ - AZ) / RLEN;
/** Perpendicular of the axis (to the left of the flow). */
const RPX = -RDZ;
const RPZ = RDX;

export const RIVER = {
  /** Source: the broken end of the aqueduct. */
  a: { x: AX, z: AZ },
  /** Pond centre: the stream's end. */
  b: { x: BX, z: BZ },
  length: RLEN,
  /** Half-width of the channel at the source and at the pond end (metres). The wet width is ~72% of it. */
  w0: 1.5,
  w1: 2.5,
  /** The pond: a round widening at the end of the stream. */
  pondRadius: 6,
  /** Depth of the bed below the channel level, at the centre (metres). The ford is ankle to shin deep. */
  depth: 0.55,
  /** The water surface sits this far below the channel level. */
  freeboard: 0.1,
  /** Number of steps in the level table. */
  steps: 64,
} as const;

/** A low timber weir across the stream, upstream of the mill: the water drops `drop` metres over about one metre of chute, foaming at the foot. */
export const WEIR = { s: 21, drop: 0.3, half: 3.4 } as const;

/** Meander offset (metres, to the left of the axis) at distance `s` along it. Zero at both ends so the stream starts and ends on its anchors. */
function meander(s: number): number {
  const env = smoothstep(0, 9, s) * smoothstep(0, 9, RLEN - s);
  return env * (3.4 * Math.sin(s * 0.19 + 0.7) + 1.1 * Math.sin(s * 0.47 + 2.1));
}

/** Point on the stream's centreline at distance `s` (clamped). Writes into `out`. */
export function riverCentre(s: number, out: { x: number; z: number }): { x: number; z: number } {
  const c = s < 0 ? 0 : s > RLEN ? RLEN : s;
  const m = meander(c);
  out.x = AX + RDX * c + RPX * m;
  out.z = AZ + RDZ * c + RPZ * m;
  return out;
}

/** Half-width of the channel at `s`. */
export function riverHalfWidth(s: number): number {
  return RIVER.w0 + (RIVER.w1 - RIVER.w0) * smoothstep(0, RLEN * 0.8, s);
}

/**
 * The mill: a stone-and-timber watermill on the stream's north bank whose undershot wheel hangs over the water, its axle pointing across
 * the stream (so the water flows along the wheel's plane). `x/z/yaw` is the body's centre and heading (local +x = the door, which faces
 * away from the stream, up the lane); `wheel` is the axle's world x/z; `door` is the doorstep. Derived from the stream, so it follows it.
 */
export interface MillSite {
  s: number;
  x: number;
  z: number;
  yaw: number;
  /** Half-depth (along the door axis) and half-width of the body. */
  hx: number;
  hz: number;
  wheel: { x: number; z: number; r: number; axleAbove: number };
  door: { x: number; z: number };
  /** Unit vector pointing away from the water (the door's direction). */
  nx: number;
  nz: number;
  /** Unit vector along the flow. */
  tx: number;
  tz: number;
}

function millSite(): MillSite {
  const s = 27.6;
  const c = riverCentre(s, { x: 0, z: 0 });
  const c2 = riverCentre(s + 0.6, { x: 0, z: 0 });
  const tl = Math.hypot(c2.x - c.x, c2.z - c.z);
  const tx = (c2.x - c.x) / tl;
  const tz = (c2.z - c.z) / tl;
  const nx = -tz;
  const nz = tx;
  const hw = riverHalfWidth(s);
  const hx = 2.35;
  const hz = 2.9;
  const back = hw + 0.35; // the wall on the water side stands right on the bank
  const bx = c.x + nx * (back + hx);
  const bz = c.z + nz * (back + hx);
  const wd = back - 0.6; // wheel: an axle's length in front of that wall, half over the water
  return {
    s,
    x: bx,
    z: bz,
    yaw: Math.atan2(nz, nx),
    hx,
    hz,
    wheel: { x: c.x + nx * wd, z: c.z + nz * wd, r: 1.32, axleAbove: 0.98 },
    door: { x: bx + nx * (hx + 0.5), z: bz + nz * (hx + 0.5) },
    nx,
    nz,
    tx,
    tz,
  };
}
export const MILL: MillSite = millSite();

/**
 * The jetty on the pond's north shore: a plank pier from the land end (`x0`, `z0`, on the bank) out over the pond to (`x1`, `z1`), with the
 * ferry lane arriving at its foot and a punt moored alongside (on the side of `side`, +1 = to the left of the way out).
 */
export const JETTY = (() => {
  const a = -2.0; // radians, angle of the shore point from the pond's centre: a little west of due north
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const R = RIVER.pondRadius;
  return { x0: RIVER.b.x + ux * (R + 0.9), z0: RIVER.b.z + uz * (R + 0.9), x1: RIVER.b.x + ux * (R - 3.6), z1: RIVER.b.z + uz * (R - 3.6), width: 1.5, ux: -ux, uz: -uz, side: 1 as 1 | -1 };
})();

export interface WaterField {
  /** Channel coordinate: 0 on the centreline, 1 at the channel edge, >1 on the banks. Pond and stream are unioned. */
  q: number;
  /** Distance along the stream axis, clamped 0..length (the nearest centreline parameter; the pond reports `length`). */
  s: number;
  /** True when the pond (not the stream) is the nearer feature. */
  pond: boolean;
}

/** How far out from the channel edge the bank blends into natural ground (in channel units). */
export const BANK = 2.6;

/** Fills `out` with the channel coordinate at (x, z). Seed-independent geometry; allocation-free. */
export function waterField(x: number, z: number, out: WaterField): WaterField {
  const dx = x - AX;
  const dz = z - AZ;
  const s = dx * RDX + dz * RDZ;
  const l = dx * RPX + dz * RPZ;
  const sc = s < 0 ? 0 : s > RLEN ? RLEN : s;
  const m = meander(sc);
  const slope = (meander(sc + 0.5) - m) / 0.5;
  const along = s - sc;
  const across = (l - m) / Math.sqrt(1 + slope * slope);
  const qs = Math.hypot(along, across) / riverHalfWidth(sc);
  const qp = Math.hypot(x - BX, z - BZ) / RIVER.pondRadius;
  out.pond = qp < qs;
  out.q = out.pond ? qp : qs;
  out.s = out.pond ? RLEN : sc;
  return out;
}

const scratchField: WaterField = { q: 0, s: 0, pond: false };

/** Metres from (x, z) to the channel edge: negative inside the channel. Cheap keep-out test for trees, props and rocks. */
export function waterEdgeDistance(x: number, z: number): number {
  const f = waterField(x, z, scratchField);
  const w = f.pond ? RIVER.pondRadius : riverHalfWidth(f.s);
  return (f.q - 1) * w;
}

// ---- footpaths ---------------------------------------------------------------------------------------------------------------------

export interface TrailDef {
  name: string;
  /** Control points (x, z); smoothed with two Chaikin passes. */
  pts: readonly (readonly [number, number])[];
  /** Width of the bare path in metres. */
  width: number;
  /** 0..1 how bare (1 = beaten earth, lower = a faint desire line). */
  wear: number;
  /** Half the gauge between two cart-wheel ruts, if the way is a cart road. */
  ruts?: number;
  /** The way fades out toward the map edge beyond this radius. */
  fadeFrom?: number;
  /**
   * Laid out after the arena's forest was placed (the village roads): tree/rock generation ignores it (`nearTrail(..., "legacy")`) so no
   * existing tree moves, and `createArena` clears whatever stands on it afterwards.
   */
  late?: boolean;
}

export interface Trail extends TrailDef {
  /** Smoothed polyline, flat [x0, z0, x1, z1, ...]. */
  line: Float64Array;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function chaikin(p: readonly (readonly [number, number])[], passes: number): number[][] {
  let cur = p.map((q) => [q[0], q[1]]);
  for (let k = 0; k < passes; k++) {
    const next: number[][] = [cur[0]!];
    for (let i = 0; i + 1 < cur.length; i++) {
      const a = cur[i]!;
      const b = cur[i + 1]!;
      next.push([a[0]! * 0.75 + b[0]! * 0.25, a[1]! * 0.75 + b[1]! * 0.25], [a[0]! * 0.25 + b[0]! * 0.75, a[1]! * 0.25 + b[1]! * 0.75]);
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  return cur;
}

/** The climb: one long turn round the hill from the ford (r = 35) up to the plateau's front steps (r = 11), arriving facing the camp. */
function hillSpiral(): [number, number][] {
  const out: [number, number][] = [];
  const a0 = Math.atan2(-29 - HILL.z, 17.5 - HILL.x); // where the trail meets the foot of the hill, on the camp side
  const turn = 5.9; // radians: a little short of a full turn
  for (let i = 1; i <= 18; i++) {
    const t = i / 18;
    const a = a0 - turn * t;
    const r = 35 - 24 * (t * (1.2 - 0.2 * t));
    out.push([HILL.x + Math.cos(a) * r, HILL.z + Math.sin(a) * r]);
  }
  return out;
}

const fire = CAMP.fire;
const TRAIL_DEFS: readonly TrailDef[] = [
  // the way to the Observatory: past the sign, round the wall, across the ford, then up the hill in one long turn
  {
    name: "observatory",
    width: 1.9,
    wear: 1,
    pts: [
      [fire.x + 2.6, fire.z + 1],
      [11.6, 0.2],
      [14.2, -5.5],
      [16.6, -11.5],
      [18.9, -17.5],
      [16.8, -23],
      [17.5, -29],
      ...hillSpiral(),
      [HILL.x - 3, HILL.z + 9.5],
    ],
  },
  // the coast road: the cart's ruts run back to the south edge
  {
    name: "coast",
    width: 2.3,
    wear: 0.95,
    ruts: 0.74,
    fadeFrom: 70,
    pts: [
      [8.2, 8.5],
      [6.6, 9.9],
      [5.6, 12.5],
      [6.6, 17],
      [10, 24],
      [15, 34],
      [19, 46],
      [24, 60],
      [30, 76],
      [35, 94],
    ],
  },
  // a hunters' track west between the tents, fading toward the edge
  {
    name: "west",
    width: 1.35,
    wear: 0.75,
    fadeFrom: 52,
    pts: [
      [-4, -0.6],
      [-12.5, -0.6],
      [-21, -3],
      [-33, -7],
      [-47, -5],
      [-62, 1],
      [-78, 9],
      [-94, 14],
    ],
  },
  // the footbridge path: on from the flag path, north across the stream (on a plank bridge) to a fishing spot on the far bank
  { name: "footbridge", width: 1.15, wear: 0.8, pts: [[11, -14.5], [11.5, -19.5], [11.4, -25], [11.9, -29], [12.4, -33.5], [12.2, -38.6]] },
  // footpaths between the camp's features
  { name: "tent-fire-a", width: 1.05, wear: 0.85, pts: [[-5.8, 3.7], [-3, 2.2], [0.8, -1], [4.4, -3.6]] },
  { name: "tent-fire-b", width: 1.05, wear: 0.85, pts: [[-6.1, -4.5], [-2.6, -4.8], [1.5, -4.5], [4.4, -4.1]] },
  { name: "fire-flag", width: 0.95, wear: 0.8, pts: [[4.6, -4.6], [3.5, -6.6], [2.6, -8.4], [5.2, -10.2], [8, -12.6], [11, -14.5]] },
  { name: "fire-cart", width: 1.05, wear: 0.85, pts: [[6.4, -2.2], [7, 1.2], [8, 4.2], [8.6, 6.6]] },
  { name: "crates", width: 0.95, wear: 0.8, pts: [[3.8, -1.6], [4.2, 2], [4, 4.8]] },
  { name: "luggage", width: 1, wear: 0.8, pts: [[-4.2, 7.4], [-1, 6.2], [2.4, 5.8], [3.6, 5.2]] },
  { name: "luggage-tents", width: 0.95, wear: 0.75, pts: [[-4.6, 7.4], [-5.6, 5.8], [-5.8, 3.9]] },
  { name: "wash", width: 0.9, wear: 0.7, pts: [[-6.4, 0.6], [-9.6, -0.6], [-12.4, -1.2]] },
  { name: "table", width: 0.9, wear: 0.75, pts: [[1.2, -5.2], [-1.4, -5.6], [-2.4, -6.3]] },
  // ---- the village (village.ts): the footbridge path goes on past the fishing spot along the stream's north bank into the village's main street
  // (cart ruts all the way to the plaza), which loops round the west end and comes back south to meet the hunters' track; short lanes serve
  // the mill and the ferry steps.
  {
    name: "village",
    width: 2.5,
    wear: 0.9,
    ruts: 0.72,
    late: true,
    pts: [[12.2, -38.6], [8.5, -42.2], [3, -45.4], [-3, -47.9], [-9, -50], [-15, -51.4], [-21, -51.8], [-27, -51.2], [-33, -49.2], [-37.6, -45.6], [-39.6, -40]],
  },
  { name: "village-west", width: 1.7, wear: 0.8, late: true, pts: [[-39.6, -40], [-40.6, -32], [-38.6, -22], [-36, -14], [-33, -7]] },
  { name: "mill-lane", width: 1.3, wear: 0.82, late: true, pts: [[-2, -47.3], [-1.5, -43.6], [-0.6, -40.2]] },
  { name: "ferry-lane", width: 1.35, wear: 0.84, late: true, pts: [[-23.3, -51.4], [-23.1, -47.4], [-22.9, -44.6], [-22.9, -42.4]] },
  { name: "hall-steps", width: 1.7, wear: 0.8, late: true, pts: [[-21, -52], [-21, -55.3], [-21, -58.5]] },
  // doorsteps: short lanes from each door to the street
  { name: "door-cot-a", width: 1.05, wear: 0.78, late: true, pts: [[5.9, -41.3], [6.0, -42.4], [6.2, -43.4]] },
  { name: "door-shop", width: 1.4, wear: 0.8, late: true, pts: [[-6.5, -52.5], [-6.7, -50.8], [-6.9, -49.4]] },
  { name: "door-gran-a", width: 1.0, wear: 0.75, late: true, pts: [[-9.3, -48.4], [-9.5, -49.1], [-9.6, -49.8]] },
  { name: "door-gran-b", width: 1.0, wear: 0.75, late: true, pts: [[-32.7, -53.1], [-32.1, -51.4], [-31.5, -49.9]] },
  { name: "door-cot-b", width: 1.0, wear: 0.75, late: true, pts: [[-37.9, -49.1], [-36.7, -47.8], [-35.9, -47.0]] },
  { name: "door-cot-c", width: 1.0, wear: 0.75, late: true, pts: [[-38.0, -32.5], [-39.6, -33.0]] },
  { name: "door-stilt-w", width: 0.9, wear: 0.75, late: true, pts: [[-23.7, -46.4], [-23.0, -46.5]] },
  { name: "door-stilt-e", width: 0.9, wear: 0.75, late: true, pts: [[-19.4, -46.2], [-22.6, -46.3]] },
];

function buildTrail(d: TrailDef): Trail {
  const sm = chaikin(d.pts, 2);
  const line = new Float64Array(sm.length * 2);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  sm.forEach((p, i) => {
    line[i * 2] = p[0]!;
    line[i * 2 + 1] = p[1]!;
    minX = Math.min(minX, p[0]!);
    maxX = Math.max(maxX, p[0]!);
    minZ = Math.min(minZ, p[1]!);
    maxZ = Math.max(maxZ, p[1]!);
  });
  return { ...d, line, minX, maxX, minZ, maxZ };
}

/** Smoothed footpaths, built once. */
export const TRAILS: readonly Trail[] = TRAIL_DEFS.map(buildTrail);

/** Worn ground that is not a line: the meeting place at the spawn, the hearth, the cart, the doorways. */
export const WORN_PATCHES: readonly { x: number; z: number; r: number; wear: number }[] = [
  { x: 0, z: 0, r: 3.9, wear: 0.9 },
  { x: fire.x, z: fire.z, r: 3.1, wear: 0.9 },
  { x: CAMP.cart.x - 0.8, z: CAMP.cart.z + 0.5, r: 2.5, wear: 0.85 },
  { x: -5.9, z: 3.8, r: 1.5, wear: 0.8 },
  { x: -6.2, z: -4.5, r: 1.5, wear: 0.8 },
  { x: CAMP.sign.x, z: CAMP.sign.z, r: 1.9, wear: 0.8 },
  { x: -2.4, z: -6.1, r: 1.6, wear: 0.7 },
  // under the HQ marquee: trodden bare
  { x: -3.3, z: -8.0, r: 2.6, wear: 0.85 },
  { x: 12.2, z: -39, r: 1.7, wear: 0.75 },
  // trodden ground at the well and at the pen's gate
  { x: -4.2, z: 15.4, r: 2.1, wear: 0.72 },
  { x: -11.6, z: 17.5, r: 1.7, wear: 0.7 },
  // the village: the plaza's beaten earth (cobbles are painted on it), the mill's yard and the smithy's forecourt
  { x: -21, z: -57.4, r: 6.6, wear: 0.9 },
  { x: -0.6, z: -40.8, r: 1.8, wear: 0.78 },
  { x: -6.6, z: -52.6, r: 2.4, wear: 0.85 },
];

const EDGE_TAPER = 0.55;

/** Distance from (x, z) to the segment (ax, az)-(bx, bz). */
export function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** Distance from (x, z) to a trail's smoothed centreline. */
export function trailDistance(t: Trail, x: number, z: number): number {
  const p = t.line;
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const d = segmentDistance(x, z, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!);
    if (d < best) best = d;
  }
  return best;
}

export interface TrailSample {
  /** Bare earth, 0..1: the path itself. */
  wear: number;
  /** Trampled grass on the shoulders, 0..1 (also true on the path). */
  shoulder: number;
  /** Wheel ruts, 0..1. */
  rut: number;
}

/** Raggedness of path edges: one shared field so the painted vertices, the crisp overlay and the ground-cover mask all agree. */
export function edgeNoise(x: number, z: number): number {
  return valueNoise(61, x / 1.7, z / 1.7) - 0.5;
}

/** Wear of one trail at distance `d` from its centreline, given the local edge noise `n` and radius `r`; the SAME formula the terrain overlay bakes. */
export function trailProfile(t: Trail, d: number, n: number, r: number, out: TrailSample): void {
  const fade = t.fadeFrom ? 1 - EDGE_TAPER * smoothstep(t.fadeFrom, t.fadeFrom + 38, r) : 1;
  const half = t.width * 0.5;
  const core = t.wear * fade * (1 - smoothstep(half - 0.12, half + 0.32, d + n * 0.5));
  const sh = 0.9 * fade * (1 - smoothstep(half + 0.1, half * 1.5 + 0.9, d + n * 0.9));
  if (core > out.wear) out.wear = core;
  if (sh > out.shoulder) out.shoulder = sh;
  if (t.ruts) {
    // two continuous wheel tracks ~0.4 m wide (the overlay texel is ~0.23 m, so anything thinner breaks into dots)
    const rut = fade * t.wear * (1 - smoothstep(0.09, 0.22, Math.abs(d - t.ruts) + n * 0.02)) * (1 - smoothstep(half * 0.95, half * 1.1, d));
    if (rut > out.rut) out.rut = rut;
  }
}

/** Wear of a round worn patch at distance `d`; shared with the overlay bake. */
export function patchProfile(p: { r: number; wear: number }, d: number, n: number, out: TrailSample): void {
  const core = p.wear * (1 - smoothstep(p.r * 0.55, p.r + 0.3, d + n * 1.2));
  const sh = 0.9 * (1 - smoothstep(p.r * 0.8, p.r * 1.6, d + n * 1.6));
  if (core > out.wear) out.wear = core;
  if (sh > out.shoulder) out.shoulder = sh;
}

/** Path wear, trampled shoulder and ruts at (x, z). Allocation-free: writes into `out`. */
export function trailSample(x: number, z: number, out: TrailSample): TrailSample {
  out.wear = 0;
  out.shoulder = 0;
  out.rut = 0;
  const n = edgeNoise(x, z);
  const r = Math.hypot(x, z);
  for (const t of TRAILS) {
    const pad = t.width * 1.5 + 1.2;
    if (x < t.minX - pad || x > t.maxX + pad || z < t.minZ - pad || z > t.maxZ + pad) continue;
    trailProfile(t, trailDistance(t, x, z), n, r, out);
  }
  for (const p of WORN_PATCHES) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r * 1.8) continue;
    patchProfile(p, d, n, out);
  }
  return out;
}

/**
 * True if (x, z) is within `margin` metres of bare path (nothing tall should grow on it). `which` picks the paths that were there before the
 * village ("legacy": what forest generation avoids), the village roads only ("late"), or all of them (default).
 */
export function nearTrail(x: number, z: number, margin: number, which: "all" | "legacy" | "late" = "all"): boolean {
  for (const t of TRAILS) {
    if (which !== "all" && !!t.late !== (which === "late")) continue;
    const pad = t.width + margin + 0.5;
    if (x < t.minX - pad || x > t.maxX + pad || z < t.minZ - pad || z > t.maxZ + pad) continue;
    if (trailDistance(t, x, z) < t.width * 0.5 + margin) return true;
  }
  return false;
}

// ---- the terrain wrapper -------------------------------------------------------------------------------------------------------------

/** A round patch of ground levelled to the height its centre had (structure: the village's `VILLAGE_PADS`). */
export interface GroundPad {
  x: number;
  z: number;
  r: number;
  blend: number;
}

export interface LandscapeTerrain extends Terrain {
  /** Depth of standing water above the bed at (x, z), metres; 0 on dry land. */
  waterDepth(x: number, z: number): number;
  /** Channel level (the ford's reference height) at distance `s` along the stream. */
  channelLevel(s: number): number;
}

/**
 * Lays the hill, the stream and its pond over a base terrain. The hill is a flat-topped rise (the base noise is blended toward the
 * plateau level); the stream is carved so that its cross-section is level (a channel with a rounded bed that blends into the banks over
 * `BANK` channel widths). The channel level follows the base ground downhill along the stream (a running minimum, so water never flows
 * uphill), sampled into a table once, at construction. Pure and deterministic given the base terrain.
 */
export function withLandscape(base: Terrain, padList: readonly GroundPad[] = []): LandscapeTerrain {
  const plateau = base.height(HILL.x, HILL.z) + HILL.rise;
  const hill = (x: number, z: number): number => {
    const h0 = base.height(x, z);
    const d = Math.hypot(x - HILL.x, z - HILL.z);
    if (d >= HILL.base) return h0;
    const m = 1 - smoothstep(HILL.plateau, HILL.base, d);
    return h0 + (plateau - h0) * m;
  };
  // Pads: round patches of ground levelled to the height their centre had (the village's floors, yards and market stalls). Where pads
  // overlap the levels are blended by weight, and the strongest weight decides how far the ground moves off its natural shape.
  // A pad sits at the average height of the ground it covers (centre, mid-radius and rim), so it cuts and fills evenly instead of standing on a stilt or in a pit.
  const padLevel = padList.map((p) => {
    let sum = hill(p.x, p.z) * 2;
    let n = 2;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      sum += hill(p.x + Math.cos(a) * p.r * 0.6, p.z + Math.sin(a) * p.r * 0.6) + hill(p.x + Math.cos(a) * p.r, p.z + Math.sin(a) * p.r);
      n += 2;
    }
    return sum / n;
  });
  // a pad on a slope must not become a cliff: its blend is stretched until the ground it levels off climbs back at a walkable rate
  const padBlend = padList.map((p, i) => {
    let diff = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      diff = Math.max(diff, Math.abs(hill(p.x + Math.cos(a) * p.r, p.z + Math.sin(a) * p.r) - padLevel[i]!));
    }
    return Math.max(p.blend, diff * 4.2);
  });
  let px0 = Infinity;
  let px1 = -Infinity;
  let pz0 = Infinity;
  let pz1 = -Infinity;
  padList.forEach((p, i) => {
    px0 = Math.min(px0, p.x - p.r - padBlend[i]!);
    px1 = Math.max(px1, p.x + p.r + padBlend[i]!);
    pz0 = Math.min(pz0, p.z - p.r - padBlend[i]!);
    pz1 = Math.max(pz1, p.z + p.r + padBlend[i]!);
  });
  const inner = (x: number, z: number): number => {
    const h0 = hill(x, z);
    if (padList.length === 0 || x < px0 || x > px1 || z < pz0 || z > pz1) return h0;
    let wsum = 0;
    let lsum = 0;
    let wmax = 0;
    for (let i = 0; i < padList.length; i++) {
      const p = padList[i]!;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d >= p.r + padBlend[i]!) continue;
      const w = 1 - smoothstep(p.r, p.r + padBlend[i]!, d);
      const w6 = (w * w * w * w * w * w * 100) / (p.r * p.r); // (a pad's own level dominates wherever it is strong, and a small pad beats a big one: interiors stay level)
      wsum += w6;
      lsum += w6 * padLevel[i]!;
      if (w > wmax) wmax = w;
    }
    if (wmax === 0) return h0;
    return h0 + (lsum / wsum - h0) * wmax;
  };
  const N = RIVER.steps;
  const level = new Float64Array(N + 1);
  const c = { x: 0, z: 0 };
  let run = Infinity;
  let weirDone = false;
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * RLEN;
    // the weir: the water steps down a hand's breadth (a tenth of the stream's length of fast, foamy chute) and stays down
    if (!weirDone && s >= WEIR.s) {
      run -= WEIR.drop;
      weirDone = true;
    }
    // ground under the centreline (three samples along it), never higher than the running minimum upstream
    let acc = 0;
    for (const o of [-5, 0, 5]) {
      riverCentre(s + o, c);
      acc += inner(c.x, c.z);
    }
    run = Math.min(run - 0.004, acc / 3 - 0.2);
    level[i] = run;
  }
  const channelLevel = (s: number): number => {
    const u = ((s < 0 ? 0 : s > RLEN ? RLEN : s) / RLEN) * N;
    const i = Math.min(N - 1, Math.floor(u));
    return level[i]! + (level[i + 1]! - level[i]!) * (u - i);
  };
  const f: WaterField = { q: 0, s: 0, pond: false };
  const pondReach = (RIVER.pondRadius * BANK + 1) ** 2;
  const height = (x: number, z: number): number => {
    const h0 = inner(x, z);
    // cheap reject: the stream's corridor and the pond, with the bank
    const dx = x - AX;
    const dz = z - AZ;
    const s = dx * RDX + dz * RDZ;
    const l = dx * RPX + dz * RPZ;
    const nearStream = s > -6 && s < RLEN + 6 && l > -12 && l < 12;
    if (!nearStream && (x - BX) * (x - BX) + (z - BZ) * (z - BZ) > pondReach) return h0;
    waterField(x, z, f);
    if (f.q >= BANK) return h0;
    const hc = channelLevel(f.s);
    const bed = f.q < 1 ? hc - RIVER.depth * (1 - smoothstep(0, 1, f.q)) : hc;
    return h0 + (bed - h0) * (1 - smoothstep(1, BANK, f.q));
  };
  const waterDepth = (x: number, z: number): number => {
    waterField(x, z, f);
    if (f.q >= 1) return 0;
    const s = f.s;
    const d = channelLevel(s) - RIVER.freeboard - height(x, z);
    return d > 0 ? d : 0;
  };
  return { height, waterDepth, channelLevel };
}
