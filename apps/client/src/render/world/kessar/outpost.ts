import { BoxGeometry, BufferGeometry, BufferAttribute, ConeGeometry, CylinderGeometry, SphereGeometry } from "three";
import { KESSAR, KESSAR_OUTPOST, PALETTE, SIDING, kessarPlan, outpostPlan, outpostRoad, telegraphPoles, type CollisionWorld, type OutpostPiece, type RegionDress, type RegionId } from "@cb/shared";
import { Kit, blend, type ColourFn } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { tent } from "../landmarks.ts";
import { gable } from "../vesper/structures.ts";

/**
 * The Society's outpost as scenery (D-035): every stage is built from the SAME `outpostPlan(stage)` the collision world reads, so the hut you see is the hut you bump
 * into. One merged vertex-coloured geometry (one draw, one ink hull) holds the stage's solids, the foundation's stakes and string, the telegraph's poles and wire and the
 * Syndicate's own post; the road is a second ground-pass overlay (no collision) and the steam launch is a third small solid. Palette colours only. The stage pieces carry no lettering
 * (the signboards are plain painted boards: the words live in outpostText.ts and are read in the paper and the prompts).
 */

const O = PALETTE.outpost;
const K = PALETTE.kessar;
const C = PALETTE.camp;
const box = (k: Kit, s: readonly [number, number, number], at: readonly [number, number, number], colour: number | ColourFn, rot?: readonly [number, number, number]): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

const planks: ColourFn = (p, _n, out) => blend(out, O.plank, O.plankDark, (Math.floor(p.y * 3.2) % 2) * 0.35 + (Math.floor(p.x * 2) % 2) * 0.1);
const stone: ColourFn = (p, n, out) => {
  if (n.y > 0.6) out.set(O.stoneHouse);
  else blend(out, O.stoneHouse, O.stoneShade, (Math.floor(p.y / 0.6) % 2) * 0.4 + 0.1);
};

function hut(k: Kit, p: OutpostPiece, gy: number, lod: Lod): void {
  k.setBase(p.x, gy, p.z, p.yaw);
  box(k, [p.hx * 2, p.height, p.hz * 2], [0, p.height / 2, 0], planks);
  const roof = new ConeGeometry(Math.hypot(p.hx, p.hz) + 0.35, 1.3, 4, 1);
  k.add(roof, { at: [0, p.height + 0.65, 0], rot: [0, Math.PI / 4, 0], scale: [p.hx / Math.hypot(p.hx, p.hz), 1, p.hz / Math.hypot(p.hx, p.hz)], colour: O.thatch, flat: true });
  if (lod) box(k, [0.7, 1.5, 0.08], [p.hx * 0.35, 0.75, p.hz + 0.02], O.plankDark);
  k.clearBase();
}

function house(k: Kit, p: OutpostPiece, gy: number, lod: Lod): void {
  k.setBase(p.x, gy, p.z, p.yaw);
  box(k, [p.hx * 2, p.height, p.hz * 2], [0, p.height / 2, 0], stone);
  k.add(new ConeGeometry(Math.hypot(p.hx, p.hz) + 0.4, 1.6, 4, 1), { at: [0, p.height + 0.8, 0], rot: [0, Math.PI / 4, 0], scale: [p.hx / Math.hypot(p.hx, p.hz), 1, p.hz / Math.hypot(p.hx, p.hz)], colour: O.slate, flat: true });
  if (lod) {
    box(k, [0.8, 1.7, 0.08], [0, 0.85, p.hz + 0.02], O.plankDark);
    for (const sx of [-1, 1]) box(k, [0.5, 0.6, 0.06], [sx * p.hx * 0.55, p.height * 0.6, p.hz + 0.02], O.clockFace);
  }
  k.clearBase();
}

/**
 * A counter with a sloping awning carried on two poles at its back corners: the counter (`w` x 0.9 x `d`), the poles standing on it and running up INTO the
 * awning's underside (the awning tilts down to the front, so the back poles are cut to where the board actually is), and the board itself.
 */
const AWNING_TILT = 0.18;
function awnedCounter(k: Kit, w: number, d: number, top: number, awning: number, colour: number | ColourFn): void {
  box(k, [w, 0.9, d], [0, 0.45, 0], colour);
  const az = 0.15, depth = d + 0.6, thick = 0.06;
  const pz = -d / 2 + 0.1;
  // the underside of the tilted board above local z (rotation about x by AWNING_TILT: y' = y cos - z sin), plus 3 cm into it
  const under = top - (pz - az) * Math.sin(AWNING_TILT) - (thick / 2) * Math.cos(AWNING_TILT) + 0.03;
  for (const sx of [-1, 1]) k.limb([sx * (w / 2 - 0.1), 0.9, pz], [sx * (w / 2 - 0.1), under, pz], 0.05, 0.05, O.pole, 5);
  box(k, [w + 0.4, thick, depth], [0, top, az], awning, [AWNING_TILT, 0, 0]);
}

function stall(k: Kit, p: OutpostPiece, gy: number): void {
  k.setBase(p.x, gy, p.z, p.yaw);
  awnedCounter(k, p.hx * 2, p.hz * 2, 2.3, K.awning, planks);
  k.clearBase();
}

function well(k: Kit, p: OutpostPiece, gy: number): void {
  k.setBase(p.x, gy, p.z, 0);
  k.add(new CylinderGeometry(p.hx, p.hx + 0.06, 0.9, 10), { at: [0, 0.45, 0], colour: stone, flat: true });
  for (const sx of [-1, 1]) k.limb([sx * (p.hx - 0.1), 0.9, 0], [sx * (p.hx - 0.1), 2.2, 0], 0.05, 0.05, O.pole, 5);
  k.add(new ConeGeometry(p.hx + 0.5, 0.5, 4, 1), { at: [0, 2.45, 0], rot: [0, Math.PI / 4, 0], colour: O.thatch, flat: true });
  k.clearBase();
}

function rail(k: Kit, p: OutpostPiece, gy: number): void {
  k.setBase(p.x, gy, p.z, p.yaw);
  box(k, [p.hx * 2, 0.1, 0.12], [0, 1, 0], O.plankDark);
  for (const sx of [-1, 1]) k.limb([sx * (p.hx - 0.08), 0, 0], [sx * (p.hx - 0.08), 1.1, 0], 0.05, 0.05, O.pole, 5);
  k.clearBase();
}

function palisade(k: Kit, p: OutpostPiece, gy: number, lod: Lod): void {
  k.setBase(p.x, gy, p.z, p.yaw);
  const n = Math.max(2, Math.round((p.hx * 2) / 0.45));
  const w = (p.hx * 2) / n;
  for (let i = 0; i < n; i++) {
    const x = -p.hx + w * (i + 0.5);
    const h = p.height - 0.2 * ((i * 7) % 3) * 0.5;
    k.limb([x, -0.2, 0], [x, h, 0], w * 0.55, w * 0.5, O.palisade, 5);
    if (lod) k.add(new ConeGeometry(w * 0.5, 0.35, 5, 1), { at: [x, h + 0.17, 0], colour: O.palisadeTop, flat: true });
  }
  box(k, [p.hx * 2, 0.12, 0.1], [0, p.height * 0.35, 0.14], O.plankDark);
  k.clearBase();
}

function tower(k: Kit, p: OutpostPiece, gy: number, lod: Lod, kind: OutpostPiece["kind"]): void {
  k.setBase(p.x, gy, p.z, 0);
  const r = p.hx;
  const body = kind === "mill" ? planks : kind === "clock" ? stone : planks;
  k.add(new CylinderGeometry(r * 0.85, r, p.height, lod ? 10 : 6), { at: [0, p.height / 2, 0], colour: body, flat: true });
  k.add(new ConeGeometry(r * 1.25, kind === "clock" ? 3 : 2.2, lod ? 10 : 6), { at: [0, p.height + (kind === "clock" ? 1.5 : 1.1), 0], colour: kind === "clock" ? O.slate : O.thatch, flat: true });
  if (kind === "clock") for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) k.add(new CylinderGeometry(0.55, 0.55, 0.06, 12), { at: [Math.sin(a) * (r * 0.85 + 0.02), p.height - 1.1, Math.cos(a) * (r * 0.85 + 0.02)], rot: [Math.PI / 2, 0, -a], colour: O.clockFace, flat: true });
  if (kind === "mill") for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.4;
    k.limb([0, p.height - 0.8, r], [Math.sin(a) * 3.4, p.height - 0.8 + Math.cos(a) * 3.4, r + 0.2], 0.07, 0.05, O.plankDark, 4);
  }
  k.clearBase();
}

function post(k: Kit, p: OutpostPiece, gy: number, kind: OutpostPiece["kind"]): void {
  k.limb([p.x, gy - 0.2, p.z], [p.x, gy + p.height, p.z], p.hx * 1.1, p.hx, kind === "bell" ? O.pole : O.palisade, 6);
  if (kind === "bell") {
    k.add(new ConeGeometry(0.3, 0.38, 8, 1), { at: [p.x, gy + p.height - 0.35, p.z], colour: O.brass, flat: true });
    k.add(new SphereGeometry(0.06, 5, 4), { at: [p.x, gy + p.height - 0.58, p.z], colour: O.brass });
  } else k.add(new ConeGeometry(p.hx * 1.3, 0.3, 6, 1), { at: [p.x, gy + p.height + 0.15, p.z], colour: O.palisadeTop, flat: true });
}

function wallSeg(k: Kit, p: OutpostPiece, gy: number): void {
  k.setBase(p.x, gy, p.z, p.yaw);
  box(k, [p.hx * 2, p.height, p.hz * 2], [0, p.height / 2, 0], stone);
  k.clearBase();
}

// ---- D-091, the industrial age: the railhead (Kessar) and the works ------------------------------------------------------------------------------

/** The lowest ground under a piece's footprint (its corners and centre): a body built up from here stands on the ground everywhere, never on stilts of air. */
function lowest(world: CollisionWorld, p: OutpostPiece): number {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  let lo = world.terrainHeight(p.x, p.z);
  for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const dx = lx * p.hx, dz = lz * p.hz;
    lo = Math.min(lo, world.terrainHeight(p.x + dx * c + dz * s, p.z - dx * s + dz * c));
  }
  return lo;
}

const bricks: ColourFn = (p, n, out) => {
  if (n.y > 0.6) out.set(O.brickShade);
  else blend(out, O.brick, O.brickShade, (Math.floor(p.y / 0.3) % 2) * 0.3 + (Math.floor(p.x / 0.6 + (Math.floor(p.y / 0.3) % 2) * 0.5) % 2) * 0.12);
};

/** The siding's track: a sleeper every 0.65 m on its own patch of ballast, each at the ground under it, and the two rails carried from sleeper to sleeper. */
function siding(k: Kit, p: OutpostPiece, world: CollisionWorld, lod: Lod): void {
  const n = Math.round((p.hz * 2 - 0.3) / 0.65);
  const z0 = p.z - p.hz + 0.15;
  const pitch = (p.hz * 2 - 0.3) / n;
  const tops: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + i * pitch;
    const y = Math.min(world.terrainHeight(p.x - SIDING.half, z), world.terrainHeight(p.x, z), world.terrainHeight(p.x + SIDING.half, z));
    box(k, [SIDING.half * 2, 0.12, pitch + 0.02], [p.x, y + 0.02, z], O.ballast);
    box(k, [SIDING.half * 2 - 0.3, 0.1, 0.24], [p.x, y + 0.12, z], O.sleeper);
    tops.push([z, y + 0.17]);
  }
  for (const sx of [-SIDING.gauge, SIDING.gauge]) {
    for (let i = 0; i + 1 < tops.length; i++) {
      const [za, ya] = tops[i]!, [zb, yb] = tops[i + 1]!;
      k.limb([p.x + sx, ya + 0.05, za], [p.x + sx, yb + 0.05, zb], 0.045, 0.045, O.rail, lod ? 5 : 3);
    }
  }
}

/** The rail level at `z` on the siding at `x` (as `siding` lays it), for what stands on the rails. */
function railTop(world: CollisionWorld, x: number, z: number): number {
  return Math.min(world.terrainHeight(x - SIDING.half, z), world.terrainHeight(x, z), world.terrainHeight(x + SIDING.half, z)) + 0.27;
}

/** The tank engine, facing north along the siding: six wheels on the rails, side tanks along the boiler, a cab, a tall chimney and a puff of steam. */
function engine(k: Kit, p: OutpostPiece, world: CollisionWorld, lod: Lod): void {
  const y = Math.min(railTop(world, p.x, p.z - 1.5), railTop(world, p.x, p.z + 1.5));
  k.setBase(p.x, y, p.z, 0);
  for (const wz of [-1.5, 0, 1.5]) for (const sx of [-1, 1]) k.add(new CylinderGeometry(0.45, 0.45, 0.14, lod ? 12 : 8), { at: [sx * SIDING.gauge, 0.45, wz], rot: [0, 0, Math.PI / 2], colour: O.engineRed, flat: true });
  box(k, [1.9, 0.28, 5.0], [0, 0.82, 0], O.soot);
  for (const sz of [-1, 1]) box(k, [1.9, 0.34, 0.14], [0, 0.78, sz * 2.47], O.engineRed);
  if (lod) for (const sz of [-1, 1]) for (const sx of [-1, 1]) k.add(new CylinderGeometry(0.1, 0.1, 0.22, 6), { at: [sx * 0.62, 0.78, sz * 2.62], rot: [Math.PI / 2, 0, 0], colour: O.rail, flat: true });
  k.add(new CylinderGeometry(0.62, 0.62, 3.0, lod ? 12 : 8), { at: [0, 1.6, -0.75], rot: [Math.PI / 2, 0, 0], colour: O.engine, flat: true });
  k.add(new CylinderGeometry(0.64, 0.64, 0.4, lod ? 12 : 8), { at: [0, 1.6, -2.25], rot: [Math.PI / 2, 0, 0], colour: O.soot, flat: true });
  for (const sx of [-1, 1]) box(k, [0.38, 0.95, 2.2], [sx * 0.74, 1.42, -0.8], O.engine);
  k.limb([0, 2.1, -1.85], [0, 2.95, -1.85], 0.2, 0.26, O.soot, lod ? 8 : 6);
  k.add(new SphereGeometry(0.28, 8, 5), { at: [0, 2.2, -0.55], scale: [1, 0.8, 1], colour: O.brass });
  box(k, [1.85, 1.75, 1.45], [0, 1.83, 1.6], O.engine);
  box(k, [2.0, 0.1, 1.65], [0, 2.75, 1.6], O.soot);
  if (lod) for (const sx of [-1, 1]) box(k, [0.04, 0.5, 0.55], [sx * 0.94, 2.15, 1.45], O.sleeper);
  k.add(new SphereGeometry(0.45, 6, 5), { at: [0, 3.25, -1.95], scale: [1, 0.75, 1], colour: O.steam, flat: true });
  k.clearBase();
}

/** A buffer stop at the end of the line: two timber posts and a red-painted beam across the rails. */
function bufferStop(k: Kit, p: OutpostPiece, world: CollisionWorld): void {
  const gy = lowest(world, p);
  k.setBase(p.x, gy, p.z, 0);
  for (const sx of [-1, 1]) box(k, [0.22, 1.1, 0.22], [sx * 0.62, 0.5, 0], O.sleeper);
  box(k, [p.hx * 2, 0.32, 0.3], [0, 0.88, 0], O.engineRed);
  k.clearBase();
}

/** The water tank on four legs, its spout swung back over the end of the track. */
function waterTank(k: Kit, p: OutpostPiece, world: CollisionWorld, lod: Lod): void {
  const legs: [number, number][] = [[-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75]];
  for (const [dx, dz] of legs) k.limb([p.x + dx, world.terrainHeight(p.x + dx, p.z + dz) - 0.15, p.z + dz], [p.x + dx, world.terrainHeight(p.x, p.z) + 3.7, p.z + dz], 0.11, 0.09, O.sleeper, 5);
  const gy = world.terrainHeight(p.x, p.z);
  k.setBase(p.x, gy, p.z, 0);
  box(k, [1.9, 0.14, 1.9], [0, 3.62, 0], O.sleeper);
  k.add(new CylinderGeometry(p.hx, p.hx, 1.7, lod ? 14 : 8), { at: [0, 4.54, 0], colour: O.tankIron, flat: true });
  k.add(new CylinderGeometry(p.hx + 0.06, p.hx + 0.06, 0.12, lod ? 14 : 8), { at: [0, 5.42, 0], colour: O.soot, flat: true });
  k.limb([0.8, 4.0, 0.8], [1.15, 3.3, 1.7], 0.1, 0.09, O.soot, 5);
  k.clearBase();
}

/** The works: a brick engine-house under a slate gable, its chimney rising out of the west gable with a band of soot at the top, and smoke. */
function works(k: Kit, p: OutpostPiece, world: CollisionWorld, lod: Lod): void {
  const lo = lowest(world, p) - 0.1;
  const top = world.terrainHeight(p.x, p.z) + p.height;
  k.setBase(p.x, lo, p.z, p.yaw);
  const h = top - lo;
  box(k, [p.hx * 2, h, p.hz * 2], [0, h / 2, 0], bricks);
  gable(k, p.hx + 0.3, p.hz + 0.35, 1.3, [0, h, 0], O.slate);
  // the chimney: a square stack set into the west gable wall, standing clear of the ridge
  const cx = -p.hx + 0.45;
  box(k, [0.9, h + 5.6, 0.9], [cx, (h + 5.6) / 2, 0], bricks);
  box(k, [1.0, 0.7, 1.0], [cx, h + 5.6 - 0.35, 0], O.soot);
  if (lod) {
    box(k, [1.0, 1.9, 0.08], [p.hx * 0.3, 0.95, p.hz + 0.03], O.plankDark);
    for (const sx of [-1, 1]) box(k, [0.06, 0.7, 0.5], [sx * (p.hx + 0.02), h * 0.62, 0], O.soot);
  }
  // (the smoke sits in the chimney's mouth and the second puff on the first: a puff in the air above it floated)
  k.add(new SphereGeometry(0.6, 6, 5), { at: [cx + 0.1, h + 5.85, 0.05], scale: [1, 0.75, 1], colour: O.soot, flat: true });
  k.add(new SphereGeometry(0.45, 6, 5), { at: [cx + 0.55, h + 6.35, 0.3], scale: [1, 0.75, 1], colour: O.steam, flat: true });
  k.clearBase();
}

/** The spoil heap: what the works has dug out and has nowhere to put, in a low lumpy cone sunk into the ground. */
function spoilHeap(k: Kit, p: OutpostPiece, world: CollisionWorld): void {
  const gy = world.terrainHeight(p.x, p.z);
  let lo = gy;
  for (let i = 0; i < 8; i++) lo = Math.min(lo, world.terrainHeight(p.x + Math.cos(i) * p.hx, p.z + Math.sin(i) * p.hx));
  k.add(new ConeGeometry(p.hx, p.height + (gy - lo) + 0.15, 9, 2), { at: [p.x, lo - 0.15 + (p.height + (gy - lo) + 0.15) / 2, p.z], colour: O.spoil, jitter: 0.08, seed: 91 });
  for (let i = 0; i < 4; i++) k.add(new SphereGeometry(0.22, 5, 4), { at: [p.x + Math.cos(i * 1.7) * (p.hx - 0.1), lo + 0.08, p.z + Math.sin(i * 1.7) * (p.hx - 0.1)], scale: [1, 0.6, 1], colour: O.spoil, flat: true });
}

/** The foundation: stakes at the corners of a square round the yard, string between them (the name board is its own piece: it stays when the stakes go). */
function stakes(k: Kit, p: OutpostPiece, world: CollisionWorld): void {
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  const corners: [number, number][] = [[-p.hx, -p.hz], [p.hx, -p.hz], [p.hx, p.hz], [-p.hx, p.hz]];
  for (const [dx, dz] of corners) k.limb([p.x + dx, g(p.x + dx, p.z + dz) - 0.05, p.z + dz], [p.x + dx, g(p.x + dx, p.z + dz) + 0.7, p.z + dz], 0.045, 0.03, O.stake, 5);
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!, b = corners[(i + 1) % 4]!;
    k.limb([p.x + a[0], g(p.x + a[0], p.z + a[1]) + 0.55, p.z + a[1]], [p.x + b[0], g(p.x + b[0], p.z + b[1]) + 0.55, p.z + b[1]], 0.012, 0.012, O.string, 3);
  }
}

/** The name board: a pole and a painted plank (1.4 x 0.7) at every stage; `outpostSigns.ts` letters it with the post's name and what it has become. */
function signBoard(k: Kit, p: OutpostPiece, world: CollisionWorld): void {
  const sy = world.terrainHeight(p.x, p.z);
  k.limb([p.x, sy - 0.1, p.z], [p.x, sy + 1.5, p.z], 0.05, 0.05, O.pole, 5);
  box(k, [1.4, 0.7, 0.06], [p.x, sy + 1.4, p.z], O.sign);
}

/** The telegraph: a pole every 16 m with a crossarm and two insulators, wire hung between them (a slack line of three segments each). */
function telegraph(k: Kit, world: CollisionWorld): void {
  const poles = telegraphPoles();
  const tops: [number, number, number][] = [];
  for (const q of poles) {
    const gy = world.terrainHeight(q.x, q.z);
    k.limb([q.x, gy - 0.3, q.z], [q.x, gy + 6.6, q.z], 0.15, 0.11, O.pole, 6);
    box(k, [1.5, 0.12, 0.12], [q.x, gy + 6.2, q.z], O.pole);
    for (const s of [-0.6, 0.6]) k.add(new SphereGeometry(0.07, 5, 4), { at: [q.x + s, gy + 6.35, q.z], colour: C.glass });
    tops.push([q.x, gy + 6.25, q.z]);
  }
  for (let i = 0; i + 1 < tops.length; i++) {
    const a = tops[i]!, b = tops[i + 1]!;
    for (const s of [-0.6, 0.6]) {
      const sag = (t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t + s, a[1] + (b[1] - a[1]) * t - 1.1 * Math.sin(Math.PI * t), a[2] + (b[2] - a[2]) * t];
      for (let j = 0; j < 4; j++) k.limb(sag(j / 4), sag((j + 1) / 4), 0.014, 0.014, O.wire, 3);
    }
  }
}

/** The Syndicate's own post (a signboard and a tent; at two posts a hut, a counter and a rail): visual only, in the Syndicate's green. */
function rivalPost(k: Kit, world: CollisionWorld, stage: 1 | 2, lod: Lod): void {
  const at = KESSAR_OUTPOST.rivalSite;
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  k.limb([at.x, g(at.x, at.z) - 0.1, at.z], [at.x, g(at.x, at.z) + 5, at.z], 0.1, 0.07, K.timber, 6);
  box(k, [0.06, 1.0, 1.7], [at.x + 0.05, g(at.x, at.z) + 4.3, at.z + 0.9], K.synGreen);
  box(k, [0.07, 0.3, 1.7], [at.x + 0.05, g(at.x, at.z) + 4.4, at.z + 0.9], K.synStripe);
  k.setBase(at.x - 5, g(at.x - 5, at.z + 2), at.z + 2, 0.3);
  tent(k, lod);
  k.clearBase();
  box(k, [1.5, 0.9, 0.06], [at.x + 2, g(at.x + 2, at.z - 3) + 1.1, at.z - 3], O.sign);
  k.limb([at.x + 2, g(at.x + 2, at.z - 3) - 0.1, at.z - 3], [at.x + 2, g(at.x + 2, at.z - 3) + 0.8, at.z - 3], 0.05, 0.05, O.pole, 5);
  if (stage >= 2) {
    k.setBase(at.x + 7, g(at.x + 7, at.z + 3), at.z + 3, -0.2);
    box(k, [3.4, 3, 2.8], [0, 1.5, 0], planks);
    k.add(new ConeGeometry(2.6, 1.3, 4, 1), { at: [0, 3.65, 0], rot: [0, Math.PI / 4, 0], colour: K.synGreen, flat: true });
    k.clearBase();
    // the counter, its awning on two poles (the awning used to hang over it with nothing holding it up)
    k.setBase(at.x + 7, g(at.x + 7, at.z - 3), at.z - 3, 0);
    awnedCounter(k, 2.4, 1.1, 2.2, K.synStripe, planks);
    k.clearBase();
  }
}

/**
 * The steam launch: a hull, a cabin, a funnel and a puff, moored alongside the landing pier opposite the rowing boat, bow to the sea, riding the water line
 * as the boat does. (It was placed off `KESSAR_ANCHORS.pier`, which is the bridge's parapet, not the landing's pier, and sat beached on the sand among the palms.)
 */
function launch(k: Kit): void {
  const { pier, boat } = kessarPlan();
  k.setBase(pier.x - (boat.x - pier.x), KESSAR.seaLevel, boat.z, Math.PI / 2);
  k.add(new BoxGeometry(5.2, 0.9, 1.7), { at: [0, 0.35, 0], colour: O.launchHull, flat: true });
  k.add(new ConeGeometry(0.85, 1.4, 4, 1), { at: [3.2, 0.35, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 1], colour: O.launchHull, flat: true });
  box(k, [2.1, 0.9, 1.3], [-0.5, 1.2, 0], O.launchTrim);
  k.add(new CylinderGeometry(0.28, 0.34, 1.5, 8), { at: [-1.2, 2.2, 0], colour: O.slate, flat: true });
  k.add(new SphereGeometry(0.5, 6, 5), { at: [-1.2, 3.3, 0], scale: [1, 0.8, 1], colour: O.steam, flat: true });
  k.clearBase();
}

/** The whole dress of `region` as ONE geometry (undefined when nothing is to be drawn). `lod` 0 is the cheap shape the ink hull and the low preset use. */
export function buildOutpostGeometry(world: CollisionWorld, dress: RegionDress, lod: Lod, region: RegionId = "kessar"): BufferGeometry | undefined {
  const k = new Kit();
  // (the railhead stands at Kessar only, as the wire and the launch do; the works wherever the dress says)
  const plan = outpostPlan(dress.outpost, region, { railway: region === "kessar" && dress.railway === true, works: dress.works === true });
  for (const p of plan.pieces) {
    const gy = world.terrainHeight(p.x, p.z);
    switch (p.kind) {
      case "stakes": stakes(k, p, world); break;
      case "sign": signBoard(k, p, world); break;
      case "tent": k.setBase(p.x, gy, p.z, p.yaw); tent(k, lod); k.clearBase(); break;
      case "fire":
        k.add(new CylinderGeometry(p.hx, p.hx + 0.05, 0.12, 8), { at: [p.x, gy + 0.06, p.z], colour: C.ash, flat: true });
        for (let i = 0; i < 6; i++) k.add(new SphereGeometry(0.16, 5, 4), { at: [p.x + Math.cos(i) * 0.7, gy + 0.1, p.z + Math.sin(i) * 0.7], scale: [1, 0.7, 1], colour: C.fireStone, flat: true });
        break;
      case "hut": hut(k, p, gy, lod); break;
      case "stall": stall(k, p, gy); break;
      case "rail": rail(k, p, gy); break;
      case "well": well(k, p, gy); break;
      case "palisade": palisade(k, p, gy, lod); break;
      case "tower": tower(k, p, gy, lod, "tower"); break;
      case "mill": tower(k, p, gy, lod, "mill"); break;
      case "clock": tower(k, p, gy, lod, "clock"); break;
      case "post": case "bell": post(k, p, gy, p.kind); break;
      case "house": case "hall": house(k, p, gy, lod); break;
      case "wall": wallSeg(k, p, gy); break;
      case "siding": siding(k, p, world, lod); break;
      case "engine": engine(k, p, world, lod); break;
      case "buffer": bufferStop(k, p, world); break;
      case "tank": waterTank(k, p, world, lod); break;
      case "works": works(k, p, world, lod); break;
      case "spoil": spoilHeap(k, p, world); break;
    }
  }
  // (the wire, the Syndicate's post and the launch stand at Kessar only: their lines and moorings are Kessar's; `regionDressOf` never sets them elsewhere)
  if (region === "kessar") {
    if (dress.telegraph) telegraph(k, world);
    if (dress.rivalPost > 0) rivalPost(k, world, dress.rivalPost as 1 | 2, lod);
    if (dress.launch) launch(k);
  }
  k.clearBase();
  return k.build();
}

/** The road as a ground-pass overlay (`outpostRoad`: from the yard's board out through the gate to the south-bank track; wider at level 2), hugging the terrain. No collision. */
export function buildRoadRibbon(world: CollisionWorld, level: 0 | 1 | 2): BufferGeometry | undefined {
  const road = outpostRoad(level);
  if (!road) return undefined;
  const path: [number, number][] = road.path.map((q) => [q.x, q.z]);
  const half = road.half;
  const verts: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const col = ((hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255])(O.road);
  const edge = ((hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255])(O.roadEdge);
  // subdivide each leg every ~2 m so the ribbon follows the swell
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  pts.push(path[path.length - 1]!);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[Math.min(pts.length - 1, i + 1)]!, r = pts[Math.max(0, i - 1)]!;
    let dx = q[0] - r[0], dz = q[1] - r[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    for (const s of [-1, 0, 1] as const) {
      const x = p[0] - dz * half * s, z = p[1] + dx * half * s;
      verts.push(x, world.terrainHeight(x, z) + 0.07, z);
      const c = s === 0 ? col : edge;
      cols.push(c[0], c[1], c[2]);
    }
    if (i + 1 < pts.length) {
      const a = i * 3, b = (i + 1) * 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(cols), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
