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
  { name: "table", width: 0.9, wear: 0.75, pts: [[1.2, -5.2], [-1.4, -5.6], [-2.4, -6.1]] },
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
  { x: 12.2, z: -39, r: 1.7, wear: 0.75 },
  // trodden ground at the well and at the pen's gate
  { x: -4.2, z: 15.4, r: 2.1, wear: 0.72 },
  { x: -11.6, z: 17.5, r: 1.7, wear: 0.7 },
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

/** True if (x, z) is within `margin` metres of bare path (nothing tall should grow on it). */
export function nearTrail(x: number, z: number, margin: number): boolean {
  for (const t of TRAILS) {
    const pad = t.width + margin + 0.5;
    if (x < t.minX - pad || x > t.maxX + pad || z < t.minZ - pad || z > t.maxZ + pad) continue;
    if (trailDistance(t, x, z) < t.width * 0.5 + margin) return true;
  }
  return false;
}

// ---- the terrain wrapper -------------------------------------------------------------------------------------------------------------

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
export function withLandscape(base: Terrain): LandscapeTerrain {
  const plateau = base.height(HILL.x, HILL.z) + HILL.rise;
  const inner = (x: number, z: number): number => {
    const h0 = base.height(x, z);
    const d = Math.hypot(x - HILL.x, z - HILL.z);
    if (d >= HILL.base) return h0;
    const m = 1 - smoothstep(HILL.plateau, HILL.base, d);
    return h0 + (plateau - h0) * m;
  };
  const N = RIVER.steps;
  const level = new Float64Array(N + 1);
  const c = { x: 0, z: 0 };
  let run = Infinity;
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * RLEN;
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
