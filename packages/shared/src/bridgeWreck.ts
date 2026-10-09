import { KESSAR, kessarPlan } from "./kessar.ts";
import { hash3 } from "./rng.ts";
import type { Terrain } from "./terrain.ts";

/**
 * D-097: the Kessar bridge's FALL. When the charge goes, the span between the two broken ends breaks into pieces (deck slabs, parapet runs) that drop into the gorge under it and
 * come to rest on its ramps and in the channel, tilted to the ground they lie on, partly under water. One pure plan serves three readers: the collision world (each resting piece
 * is solid, `bridgeWreckObstacles`), the scenery (the pieces drawn where they lie, client kessar/bridgeWreck.ts) and the fall itself (each piece leaves the deck at `from`, after
 * `delay`, and lands at `rest`). The broken ends stay on the banks; what is in between is here. Deterministic, a function of the terrain only; nothing overlaps (tests).
 */

export type WreckKind = "deck" | "parapet";
export interface WreckPose { x: number; y: number; z: number; rx: number; ry: number; rz: number }
export interface WreckPiece {
  kind: WreckKind;
  /** Full size: across (x), thick (y), along (z), in the piece's own frame. */
  size: readonly [number, number, number];
  /** Where it was in the standing bridge (axis-aligned). */
  from: { x: number; y: number; z: number };
  rest: WreckPose;
  /** Seconds after the blast that it lets go (the middle first, the ends last). */
  delay: number;
  /** An end run hangs from the broken face by its top edge (that edge's middle, and the way the run reaches out from it) and swings down; the rest fall free. */
  hinge?: { x: number; y: number; z: number; dir: 1 | -1 };
}

/** The fall: free pieces are thrown up a little by the blast and drop under gravity; hinged ones swing down in `swingS`. */
export const FALL = { g: 9.8, kick: 2.0, swingS: 1.1 } as const;

export const WRECK = {
  /** How far each broken end reaches out over the gorge from its lip, and how thick the deck slab is. */
  overhang: 1.2, deckThick: 1.4,
  /** The span breaks into this many runs along its length; each run into two halves across the deck. */
  runs: 4,
  /** How deep a resting piece sits in the bed (mud, gravel) below its lowest corner. */
  sink: 0.18,
} as const;

/** The two lips of the gorge at the bridge (north, south): where each broken end stops being ground. */
export function bridgeLips(): [number, number] {
  const st = kessarPlan().stubs;
  const zs = st.map((s) => s.z).sort((a, b) => a - b);
  return [zs[0]!, zs[zs.length - 1]!];
}

type V3 = [number, number, number];
const rot = (p: V3, rx: number, ry: number, rz: number): V3 => {
  // three.js Euler XYZ order: v' = Rx * Ry * Rz * v
  let [x, y, z] = p;
  let c = Math.cos(rz), s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rx); s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
};
/** The piece's three axes (unit) and half sizes, in the world. */
export function wreckAxes(size: readonly [number, number, number], p: WreckPose): { axes: [V3, V3, V3]; half: V3 } {
  return { axes: [rot([1, 0, 0], p.rx, p.ry, p.rz), rot([0, 1, 0], p.rx, p.ry, p.rz), rot([0, 0, 1], p.rx, p.ry, p.rz)], half: [size[0] / 2, size[1] / 2, size[2] / 2] };
}
/** The eight corners of a resting piece. */
export function wreckCorners(size: readonly [number, number, number], p: WreckPose): V3[] {
  const { axes: [a, b, c], half: [hx, hy, hz] } = wreckAxes(size, p);
  const out: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out.push([p.x + a[0] * hx * sx + b[0] * hy * sy + c[0] * hz * sz, p.y + a[1] * hx * sx + b[1] * hy * sy + c[1] * hz * sz, p.z + a[2] * hx * sx + b[2] * hy * sy + c[2] * hz * sz]);
  }
  return out;
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Two oriented boxes overlap by more than `slack` metres (the separating axis test, 15 axes). */
export function obbOverlap(sa: readonly [number, number, number], pa: WreckPose, sb: readonly [number, number, number], pb: WreckPose, slack = 0): boolean {
  const A = wreckAxes(sa, pa), B = wreckAxes(sb, pb);
  const d: V3 = [pb.x - pa.x, pb.y - pa.y, pb.z - pa.z];
  const axes: V3[] = [...A.axes, ...B.axes];
  for (const u of A.axes) for (const v of B.axes) {
    const c = cross(u, v);
    if (Math.hypot(...c) > 1e-6) axes.push(c);
  }
  for (const ax of axes) {
    const n = Math.hypot(...ax);
    const u: V3 = [ax[0] / n, ax[1] / n, ax[2] / n];
    const ra = A.half.reduce((s, h, i) => s + h * Math.abs(dot(A.axes[i]!, u)), 0);
    const rb = B.half.reduce((s, h, i) => s + h * Math.abs(dot(B.axes[i]!, u)), 0);
    if (Math.abs(dot(d, u)) > ra + rb - slack) return false;
  }
  return true;
}

/**
 * What a resting piece must keep clear of: the pier stumps the charge leaves (`kessarObstacles`, collapsed), and at each lip the broken end of the bridge (its slab reaching
 * `overhang` out over the gorge, its parapet stubs) and the wreckage across the road there (the solid that keeps a walker out of the gap: `plan.stubs`).
 */
export function wreckKeepouts(): { size: [number, number, number]; pose: WreckPose }[] {
  const b = kessarPlan().bridge;
  const L = KESSAR.level;
  const bed = L - KESSAR.gorgeDepth;
  const top = L - 2.4;
  const out = b.piers.map((p) => ({ size: [p.r * 2.4, top - bed + 1, p.r * 2.4] as [number, number, number], pose: { x: p.x, y: (top + bed - 1) / 2, z: p.z, rx: 0, ry: 0, rz: 0 } }));
  const [lipN, lipS] = bridgeLips();
  for (const [lip, dir] of [[lipN, 1], [lipS, -1]] as const) {
    const w = (KESSAR.deckHalf + 0.6) * 2;
    // the end: from a metre behind the lip to the overhang's broken face, from under the slab to the parapets' tops
    out.push({ size: [w, 4, WRECK.overhang + 1.2], pose: { x: b.x, y: L - 1.6, z: lip + dir * (WRECK.overhang - 1.2) / 2, rx: 0, ry: 0, rz: 0 } });
  }
  return out;
}

/** Where a piece may go if it cannot lie where it fell, nearest first: along the river (either way, outward first) and in toward the middle of the gorge. */
const SEARCH: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let i = -48; i <= 48; i++) for (let j = 0; j <= 12; j++) out.push([i * 0.25, j * 0.3]);
  return out.sort((a, b) => Math.abs(a[0]) + 2 * a[1] - (Math.abs(b[0]) + 2 * b[1]) || b[0] - a[0]);
})();

let cache: { key: Terrain; pieces: WreckPiece[] } | undefined;
/** The fallen span: deterministic for a terrain (Kessar's gorge is not seeded, but the call takes the terrain it lands on). */
export function kessarBridgeWreck(terrain: Terrain): WreckPiece[] {
  if (cache?.key === terrain) return cache.pieces;
  const b = kessarPlan().bridge;
  const L = KESSAR.level;
  const [lipN, lipS] = bridgeLips();
  const z0 = lipN + WRECK.overhang, z1 = lipS - WRECK.overhang;   // (the broken ends keep the rest)
  const run = (z1 - z0) / WRECK.runs;
  const mid = (z0 + z1) / 2;
  const half = KESSAR.deckHalf;
  const pieces: WreckPiece[] = [];
  const h = (i: number, k: number): number => hash3(0xb51d6e, i, k) / 4294967296;
  const blocks = wreckKeepouts();
  const placed: { size: readonly [number, number, number]; pose: WreckPose }[] = [...blocks];
  // rest a piece on the ground under (x, z): tilted to the slope it lies on, turned a little, sunk a little; then walked away from anything it would overlap
  const settle = (size: readonly [number, number, number], x: number, z: number, ry: number, rollJ: number, i: number): WreckPose => {
    // (the search walks it along the river, the gorge's long way, away from the bridge first and then the other way; across, it never leaves the gorge: a piece stays
    // between the broken ends)
    const [lo, hi] = [lipN + WRECK.overhang + 0.4, lipS - WRECK.overhang - 0.4];
    const out = Math.sign(x) || 1, toMid = Math.sign(mid - z) || 1;
    const why = { bank: 0, high: 0, overlap: 0 };
    for (const [dx, dz] of SEARCH) {
      const xx = x + dx * out;
      const zz = Math.min(hi, Math.max(lo, z + dz * toMid));
      const hl = size[2] / 2, hw = size[0] / 2;
      const cz = Math.cos(ry), sz = Math.sin(ry);
      const at = (u: number, v: number): number => terrain.height(xx + u * cz + v * sz, zz - u * sz + v * cz);
      const front = at(0, hl), back = at(0, -hl), right = at(hw, 0), left = at(-hw, 0);
      const pitch = -Math.atan2(front - back, size[2]);
      const roll = Math.atan2(right - left, size[0]) + rollJ;
      const ground = Math.max(front, back, right, left, at(0, 0));
      const pose: WreckPose = { x: xx, y: 0, z: zz, rx: pitch, ry, rz: roll };
      // drop it until its lowest corner is `sink` below the ground under that corner, everywhere
      let lift = -Infinity;
      for (const c of wreckCorners(size, { ...pose, y: 0 })) lift = Math.max(lift, terrain.height(c[0], c[2]) - WRECK.sink - c[1]);
      pose.y = lift;
      void ground;
      // in the gorge (every corner over ground below the banks) and not standing up out of it like a wall at the lip
      const cs = wreckCorners(size, pose);
      if (cs.some((c) => terrain.height(c[0], c[2]) > L - 0.5)) { why.bank++; continue; }
      if (cs.some((c) => c[1] > L + 0.1)) { why.high++; continue; }
      if (!placed.some((q) => obbOverlap(size, pose, q.size, q.pose, -0.04))) return pose;
      why.overlap++;
    }
    throw new Error(`bridgeWreck: no room for piece ${i} (${size.join("x")} at ${x.toFixed(1)},${z.toFixed(1)}): ${JSON.stringify(why)}`);
  };
  let i = 0;
  // the middle runs go first (they have the furthest to fall), the ends last
  const order = Array.from({ length: WRECK.runs }, (_, r) => r).sort((a, b2) => Math.abs(a + 0.5 - WRECK.runs / 2) - Math.abs(b2 + 0.5 - WRECK.runs / 2));
  // an end run does not fall free: it hangs from the broken face by its top edge and swings down until it lies on the ramp below (`hinge`)
  const hinge = (size: readonly [number, number, number], x: number, zEdge: number, dir: 1 | -1, rollJ: number): WreckPose => {
    const H: V3 = [0, size[1] / 2, -dir * size[2] / 2];
    for (let deg = 4; deg <= 85; deg += 1) {
      const rx = dir * deg * Math.PI / 180;
      const R = rot(H, rx, 0, rollJ);
      const pose: WreckPose = { x: x - R[0], y: L + 0.03 - R[1], z: zEdge - R[2], rx, ry: 0, rz: rollJ };
      // (only the far edge lands: the near one is bedded in the broken face it hangs from; wreckCorners runs z fastest, so odd corners are +z)
      if (wreckCorners(size, pose).some((c, k) => (k % 2 ? 1 : -1) === dir && c[1] <= terrain.height(c[0], c[2]) - WRECK.sink)) return pose;
    }
    throw new Error("bridgeWreck: an end run never reached the ramp");
  };
  for (const r of order) {
    const zc = z0 + run * (r + 0.5);
    const end = r === 0 ? 1 : r === WRECK.runs - 1 ? -1 : 0;
    for (const side of [-1, 1]) {
      const size: [number, number, number] = [half - 0.05, WRECK.deckThick, run - 0.12];
      const from = { x: b.x + side * half / 2, y: L + 0.03 - WRECK.deckThick / 2, z: zc };
      const hz = end === 1 ? z0 : z1;
      const rest = end !== 0 ? hinge(size, from.x, hz, end as 1 | -1, (h(i, 3) - 0.5) * 0.12)
        : settle(size, b.x + side * (half / 2 + 0.5 + h(i, 1) * 0.8), zc + (zc - mid) * 0.12, (h(i, 2) - 0.5) * 0.7, (h(i, 3) - 0.5) * 0.5, i);
      const piece: WreckPiece = { kind: "deck", size, from, rest, delay: 0.08 + Math.abs(zc - mid) * 0.035 + h(i, 4) * 0.12 };
      if (end !== 0) piece.hinge = { x: from.x, y: L + 0.03, z: hz, dir: end as 1 | -1 };
      pieces.push(piece);
      placed.push({ size, pose: rest });
      i++;
    }
  }
  // the parapets: each side's run of balustrade breaks in three and topples outward
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const len = (z1 - z0) / 3 - 0.1;
      const zc = z0 + (z1 - z0) * (k + 0.5) / 3;
      const size: [number, number, number] = [0.6, KESSAR.parapetHeight + 0.2, len];
      const from = { x: b.x + side * (half + 0.3), y: L + 0.03 + (KESSAR.parapetHeight + 0.2) / 2, z: zc };
      const rest = settle(size, b.x + side * (half + 1.6 + h(i, 1)), zc + (zc - mid) * 0.08, (h(i, 2) - 0.5) * 0.5, side * (1.2 + h(i, 3) * 0.3), i);
      pieces.push({ kind: "parapet", size, from, rest, delay: 0.2 + Math.abs(zc - mid) * 0.03 + h(i, 4) * 0.15 });
      placed.push({ size, pose: rest });
      i++;
    }
  }
  cache = { key: terrain, pieces };
  return pieces;
}

/** Each resting piece as a solid (a turned box from the ground to its highest corner): what you climb over in the gorge is what you see lying there. */
export function bridgeWreckObstacles(terrain: Terrain): { kind: "box"; tag: "rock"; x: number; z: number; hx: number; hz: number; yaw: number; y0: number; y1: number }[] {
  return kessarBridgeWreck(terrain).map((p) => {
    const cs = wreckCorners(p.size, p.rest);
    // the footprint: the corners' extent along the piece's own heading (ry), so a tilted slab's solid stays under it
    const c = Math.cos(p.rest.ry), s = Math.sin(p.rest.ry);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, top = -Infinity;
    for (const q of cs) {
      const dx = q[0] - p.rest.x, dz = q[2] - p.rest.z;
      const u = dx * c - dz * s, v = dx * s + dz * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); top = Math.max(top, q[1]);
    }
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    // (the collision box turns the other way to three.js: its local x is (cos yaw, sin yaw), a turned mesh's is (cos ry, -sin ry))
    return { kind: "box", tag: "rock", x: p.rest.x + uc * c + vc * s, z: p.rest.z - uc * s + vc * c, hx: (u1 - u0) / 2 * 0.9, hz: (v1 - v0) / 2 * 0.9, yaw: -p.rest.ry, y0: terrain.height(p.rest.x, p.rest.z) - 2, y1: top };
  });
}

/** When a piece comes to rest, in seconds after the blast. */
export function wreckLandTime(p: WreckPiece): number {
  if (p.hinge) return p.delay + FALL.swingS;
  const drop = p.from.y - p.rest.y;
  return p.delay + (FALL.kick + Math.sqrt(FALL.kick * FALL.kick + 2 * FALL.g * Math.max(0, drop))) / FALL.g;
}

/**
 * Where a piece is `t` seconds after the blast (into `out`): still in the bridge before its `delay`, then falling (a free piece along a ballistic drop, turning into its
 * resting attitude as it goes; a hinged one swinging about its top edge, faster as it goes), then at rest. Allocation-free; the scenery calls it every frame for a few seconds.
 */
export function wreckPoseAt(p: WreckPiece, t: number, out: WreckPose): WreckPose {
  const r = p.rest;
  const tl = t - p.delay;
  if (tl <= 0) {
    out.x = p.from.x; out.y = p.from.y; out.z = p.from.z; out.rx = 0; out.ry = 0; out.rz = 0;
    return out;
  }
  if (p.hinge) {
    const k = Math.min(1, tl / FALL.swingS);
    const e = k * k;   // (a door falling open: slow off the hinge, fast at the end)
    const rx = r.rx * e, rz = r.rz * e;
    const hl = p.size[2] / 2, ht = p.size[1] / 2;
    // the hinge is the top near edge, local (0, +thick/2, -dir * length/2): keep it where it is while the run turns about it
    const [hx, hy, hz] = rot([0, ht, -p.hinge.dir * hl], rx, 0, rz);
    out.x = p.hinge.x - hx; out.y = p.hinge.y - hy; out.z = p.hinge.z - hz; out.rx = rx; out.ry = 0; out.rz = rz;
    return out;
  }
  const T = wreckLandTime(p) - p.delay;
  const k = Math.min(1, tl / T);
  const sm = k * k * (3 - 2 * k);
  out.x = p.from.x + (r.x - p.from.x) * k;
  out.z = p.from.z + (r.z - p.from.z) * k;
  out.y = k >= 1 ? r.y : p.from.y + FALL.kick * tl - 0.5 * FALL.g * tl * tl;
  out.rx = r.rx * sm; out.ry = r.ry * sm; out.rz = r.rz * sm;
  return out;
}
