import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, IcosahedronGeometry, SphereGeometry, TorusGeometry } from "three";
import { PALETTE, VESPER_ANCHORS, VESPER_STOCK, vesperPlan, vesperRoad, vesperRoadX, type CollisionWorld } from "./shared.ts";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { box, corrugated, frame, gable, h01, planks, slab, stone, type VesperSolidParts } from "./structures.ts";
import { rockColour } from "./rocks.ts";

/**
 * The WORKS of Vesper Gorge, merged into the same one geometry as the buildings: the iron headframe over the Lower Gallery's shaft (a lattice of legs, rings and braces, a platform and two sheave frames; the wheel
 * itself is its own turning mesh), the ore trestle (deck planks, rails, bents of piles) and the tipple at its far end, the narrow-gauge ore line down the road, the rock fall at the gorge's head (a heap that fills
 * its width, with splintered props), the pegs and the surveyors' line and the wharf with the ore barge. Placed from `vesperPlan()`; each collider is drawn where it stands.
 */

const P = PALETTE.vesper;

// ---- the headframe --------------------------------------------------------------------------------------------------------------------------

/** The sheave wheel in its own frame (axis along local z, centred on the origin): a rim, six spokes, a hub; turned by the view. */
export function sheaveGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const R = 1.55;
  k.add(new TorusGeometry(R, 0.13, lod ? 6 : 4, lod ? 22 : 12), { colour: P.iron, flat: true });
  k.add(new TorusGeometry(R - 0.32, 0.05, 4, lod ? 16 : 8), { colour: P.ironLight, flat: true });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.limb([0, 0, 0], [Math.cos(a) * R, Math.sin(a) * R, 0], 0.07, 0.06, P.iron, 4);
  }
  k.add(new CylinderGeometry(0.28, 0.28, 0.5, 8), { rot: [Math.PI / 2, 0, 0], colour: P.copper, flat: true });
  return k.build()!;
}

/** Where the sheave turns, in world coordinates. */
export function sheaveAt(): { x: number; y: number; z: number } {
  const h = vesperPlan().headframe;
  return { x: h.x, y: h.y + h.height - 1.6, z: h.z };
}

function headframe(k: Kit, world: CollisionWorld, lod: Lod, parts: VesperSolidParts): void {
  const h = vesperPlan().headframe;
  const T = h.y;
  const top = h.height - 2.4;
  const legs: V3[][] = [];
  const leg = (sx: number, sz: number, y: number): V3 => {
    const t = y / top;
    const r = 2.05 - 1.15 * t;
    return [h.x + sx * r, T + y, h.z + sz * r];
  };
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    k.limb(leg(sx, sz, -0.6), leg(sx, sz, top), 0.22, 0.14, P.iron, lod ? 7 : 5);
    legs.push([leg(sx, sz, 0), leg(sx, sz, top)]);
  }
  // rings and X-braces on each face, every five metres of height
  const levels = [0.4, 5.6, 10.8, 16.0, top];
  for (let i = 0; i < levels.length; i++) {
    const y = levels[i]!;
    for (let f = 0; f < 4; f++) {
      const [sx0, sz0] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][f]!;
      const [sx1, sz1] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][(f + 1) % 4]!;
      k.limb(leg(sx0!, sz0!, y), leg(sx1!, sz1!, y), 0.08, 0.08, P.iron, 4);
      if (i + 1 < levels.length) {
        const y1 = levels[i + 1]!;
        k.limb(leg(sx0!, sz0!, y), leg(sx1!, sz1!, y1), 0.05, 0.05, P.ironLight, 4);
        if (lod) k.limb(leg(sx1!, sz1!, y), leg(sx0!, sz0!, y1), 0.05, 0.05, P.ironLight, 4);
      }
    }
  }
  // the head: a timber platform with a rail, two bearing frames for the sheave, the work-light
  k.setBase(h.x, T + top, h.z, 0);
  box(k, [2.6, 0.2, 2.6], [0, 0.1, 0], P.timber);
  for (const s of [-1, 1]) k.limb([0, 0.2, s * 1.15], [0, 1.9, s * 0.1], 0.1, 0.08, P.iron, 5);
  k.limb([-1.5, 0.1, 0], [1.5, 0.1, 0], 0.08, 0.08, P.ironLight, 5);
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) k.limb([sx * 1.25, 0.2, sz * 1.25], [sx * 1.25, 1.1, sz * 1.25], 0.04, 0.04, P.iron, 4);
  box(k, [2.5, 0.05, 0.05], [0, 1.1, 1.25], P.iron);
  box(k, [2.5, 0.05, 0.05], [0, 1.1, -1.25], P.iron);
  k.limb([0, 1.95, 0], [0, 2.5, 0], 0.03, 0.03, P.iron, 4);
  k.add(new SphereGeometry(0.16, 6, 4), { at: [0, 2.6, 0], colour: P.glowLamp });
  k.clearBase();
  parts.glows.push({ x: h.x, y: T + top + 2.6, z: h.z });
  // the cable: from the sheave's near side down to the winding house's drum, and a second straight down the shaft
  const w = vesperPlan().winding;
  const wy = world.terrainHeight(w.x, w.z);
  k.limb([h.x + 0.7, T + top + 1.0, h.z + 1.0], [w.x - w.hx - 0.3, wy + 3.2, w.z + 0.5], 0.035, 0.035, P.ironLight, 4);
  k.limb([h.x - 0.7, T + top + 1.0, h.z - 0.9], [h.x - 0.7, T + 1.0, h.z - 0.9], 0.035, 0.035, P.ironLight, 4);
  // the shaft collar and the cage's landing at the foot: planks and a skip bucket
  k.setBase(h.x, T, h.z, 0);
  box(k, [4.6, 0.3, 4.6], [0, 0.0, 0], P.timber);
  k.add(new CylinderGeometry(0.5, 0.42, 0.9, 8), { at: [-0.7, 0.75, -0.9], colour: P.iron, flat: true });
  k.clearBase();
}

// ---- the trestle and the tipple ------------------------------------------------------------------------------------------------------------

function trestle(k: Kit, world: CollisionWorld, lod: Lod): void {
  const t = vesperPlan().trestle;
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  const y = t.y;
  // deck planks across the way, alternating tones
  const step = lod ? 0.62 : 2.4;
  for (let x = t.x0 + step / 2; x < t.x1; x += step) box(k, [step - (lod ? 0.04 : 0.05), 0.16, t.hz * 2 - 0.12], [x, y - 0.08, t.z], h01(320, Math.round(x * 4)) > 0.5 ? P.timber : P.timberLight);
  // stringers under it
  for (const s of [-1, 1]) box(k, [t.x1 - t.x0, 0.5, 0.3], [(t.x0 + t.x1) / 2, y - 0.5, t.z + s * (t.hz - 0.4)], P.timber);
  // rails and posts along both edges (the rails stop at the terrace's edge, as the collider's do)
  const rx0 = t.x0 + 0.2, rx1 = 15;
  for (const s of [-1, 1]) {
    const z = t.z + s * (t.hz - 0.06);
    for (let x = rx0; x <= rx1 + 0.01; x += lod ? 3 : 6) k.limb([x, y, z], [x, y + 1.1, z], 0.06, 0.05, P.timber, 5);
    k.limb([rx0, y + 1.05, z], [rx1, y + 1.05, z], 0.045, 0.045, P.timberLight, 4);
    if (lod) k.limb([rx0, y + 0.55, z], [rx1, y + 0.55, z], 0.035, 0.035, P.timber, 4);
  }
  // the bents: pairs of piles from the ground to the deck, a cap beam, X-braces across and diagonals along
  const xs = [...new Set(t.piles.map((p) => p.x))].sort((a, b) => b - a);
  for (const x of xs) {
    const a = t.piles.find((p) => p.x === x && p.z < t.z)!;
    const b = t.piles.find((p) => p.x === x && p.z > t.z)!;
    const ya = g(a.x, a.z), yb = g(b.x, b.z);
    k.limb([a.x, ya - 0.8, a.z], [a.x, y - 0.75, a.z], 0.34, 0.3, P.timber, lod ? 7 : 5);
    k.limb([b.x, yb - 0.8, b.z], [b.x, y - 0.75, b.z], 0.34, 0.3, P.timber, lod ? 7 : 5);
    box(k, [0.4, 0.34, (b.z - a.z) + 1.0], [x, y - 0.95, t.z], P.timber);
    const mid = (ya + y) / 2;
    k.limb([a.x, ya + 0.3, a.z], [b.x, mid + 0.3, b.z], 0.1, 0.1, P.timberLight, 4);
    k.limb([b.x, yb + 0.3, b.z], [a.x, mid + 0.3, a.z], 0.1, 0.1, P.timberLight, 4);
  }
  for (let i = 0; i + 1 < xs.length; i++) {
    for (const s of [-1, 1]) {
      const z = t.z + s * 1.15;
      k.limb([xs[i]!, y - 1.1, z], [xs[i + 1]!, g(xs[i + 1]!, z) + 0.8, z], 0.09, 0.09, P.timberLight, 4);
    }
  }
}

function tipple(k: Kit, world: CollisionWorld, lod: Lod): void {
  const b = vesperPlan().tipple;
  const gy = world.terrainHeight(b.x, b.z);
  const f = frame(b, "e");   // the deck arrives at its east face
  k.setBase(b.x, gy, b.z, f.yaw);
  const hx = f.lx, hz = f.lz, H = b.height;
  box(k, [hx * 2, H - 0.8, hz * 2], [0, (H - 0.8) / 2 + 0.2, 0], planks(330));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * (hx - 0.1), -0.8, sz * (hz - 0.1)], [sx * (hx - 0.1), H - 0.6, sz * (hz - 0.1)], 0.16, 0.14, P.timber, 5);
  gable(k, hx + 0.5, hz + 0.6, 1.5, [0, H - 0.6, 0]);
  // the tipping hatch where the deck ends: a dark mouth with an iron lip, and an iron-banded bin below
  // (D-038: a hopper, not a door: an iron-lipped chute under the deck's end, nothing a person could use)
  box(k, [1.4, 0.3, 1.6], [0, 1.9, hz + 0.3], P.iron, [-0.5, 0, 0]);
  box(k, [2.2, 0.14, 0.3], [0, 1.45, hz + 0.9], P.ironLight);
  box(k, [2.6, 0.14, 0.9], [0, 0.4, hz + 0.45], P.iron, [-0.25, 0, 0]);
  for (let i = 0; i < 3; i++) box(k, [hx * 2 + 0.1, 0.1, hz * 2 + 0.1], [0, 0.7 + i * 1.4, 0], P.iron);
  // a chute out of the side wall, leaning
  k.limb([hx - 0.4, 1.0, -hz - 0.05], [hx + 0.5, 0.2, -hz - 2.2], 0.45, 0.5, P.timber, lod ? 6 : 4);
  k.clearBase();
}

// ---- the ore line, the fall, the pegs, the wharf ---------------------------------------------------------------------------------------------

/** The narrow-gauge line down the road: two rails on sleepers, 1.0 m east of the road's centreline (the dry bed crosses the road at a few places; the sleepers lie over it). */
function rails(k: Kit, world: CollisionWorld, lod: Lod): void {
  const road = vesperRoad();
  const off = 1.1;
  for (let i = 0; i + 1 < road.length; i++) {
    const a = road[i]!, b = road[i + 1]!;
    if (a.z > 100) continue;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;
    const ang = Math.atan2(dz, dx);
    for (const s of [-0.5, 0.5]) {
      const ax = a.x + nx * (off + s) , az = a.z + nz * (off + s);
      const bx = b.x + nx * (off + s), bz = b.z + nz * (off + s);
      k.limb([ax, world.terrainHeight(ax, az) + 0.16, az], [bx, world.terrainHeight(bx, bz) + 0.16, bz], 0.04, 0.04, P.ironLight, 4);
    }
    const n = lod ? 4 : 2;
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      const sx = a.x + dx * t + nx * off, sz = a.z + dz * t + nz * off;
      box(k, [0.16, 0.1, 1.5], [sx, world.terrainHeight(sx, sz) + 0.06, sz], P.timber, [0, -ang, 0]);
    }
  }
}

/** The rock fall: a heap of banded boulders and rubble filling the gorge's width at the plug, splintered timber props sticking out. */
function fall(k: Kit, world: CollisionWorld, lod: Lod): void {
  const f = vesperPlan().fall;
  const gy = world.terrainHeight(f.x, f.z);
  const n = lod ? 110 : 56;
  for (let i = 0; i < n; i++) {
    const u = h01(340, i) * 2 - 1;
    const x = f.x + u * (f.hx - 1.0);
    const along = 1 - Math.abs(u) ** 1.5;
    const zf = (h01(341, i) - 0.5) * 2;
    const z = f.z + zf * 3.4;
    const big = h01(342, i) > 0.8;
    const r = big ? 1.0 + h01(352, i) * 0.9 : 0.35 + h01(353, i) * 0.7;
    const crest = along * (1 - Math.abs(zf) ** 1.4) * 6.8;
    const y = gy + 0.1 + h01(343, i) * crest * 0.95 + r * 0.3;
    k.add(new IcosahedronGeometry(r, lod ? 1 : 0), { at: [x, y, z], rot: [h01(344, i) * 3, h01(345, i) * 3, h01(346, i) * 3], scale: [1.2, 0.75, 0.95], colour: rockColour, flat: true, perFace: true, jitter: 0.24, seed: 350 + i });
  }
  // splintered props and a bent rail sticking out of the heap
  for (let i = 0; i < 6; i++) {
    const x = f.x - 6 + i * 2.4 + (h01(347, i) - 0.5);
    const y0 = gy + 1.4 + h01(348, i) * 1.8;
    k.limb([x, y0, f.z + 2.4], [x + (h01(349, i) - 0.5) * 1.6, y0 + 0.4 + h01(351, i) * 0.9, f.z + 4.3], 0.12, 0.09, P.timberLight, 5);
  }
  k.limb([f.x + 3.5, gy + 2.5, f.z + 2.6], [f.x + 4.6, gy + 3.7, f.z + 3.8], 0.05, 0.05, P.ironLight, 4);
}

/** The pegging ground: four stakes with rag tops, the Syndicate's line between them, a theodolite on a tripod, a survey table under a brochure board. */
function pegs(k: Kit, world: CollisionWorld, lod: Lod): void {
  const ps = vesperPlan().pegs;
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  for (const p of ps) {
    const y = g(p.x, p.z);
    k.limb([p.x, y - 0.1, p.z], [p.x, y + 1.3, p.z], 0.045, 0.035, P.timberLight, 5);
    k.add(new BoxGeometry(0.12, 0.2, 0.12), { at: [p.x, y + 1.32, p.z], colour: P.companyRed, flat: true });
  }
  if (lod) for (let i = 0; i < 4; i++) {
    const a = ps[i]!, b = ps[(i + 1) % 4]!;
    k.limb([a.x, g(a.x, a.z) + 0.55, a.z], [b.x, g(b.x, b.z) + 0.55, b.z], 0.012, 0.012, P.plank, 3);
  }
  // the theodolite: a tripod and a brass drum
  const S = vesperPlan().tents;
  void S;
  const tx = -28, tz = -31;
  const ty = g(tx, tz);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    k.limb([tx + Math.cos(a) * 0.7, ty, tz + Math.sin(a) * 0.7], [tx, ty + 1.3, tz], 0.03, 0.025, P.timber, 4);
  }
  k.add(new CylinderGeometry(0.16, 0.16, 0.34, 8), { at: [tx, ty + 1.5, tz], colour: P.copper, flat: true });
  k.limb([tx, ty + 1.62, tz], [tx + 0.35, ty + 1.7, tz], 0.04, 0.04, P.iron, 4);
}

function wharf(k: Kit, world: CollisionWorld, lod: Lod): void {
  const q = vesperPlan().wharf;
  const len = q.z1 - q.z0;
  const planksN = Math.round(len / 0.55);
  for (let i = 0; i < (lod ? planksN : Math.round(planksN / 3)); i++) {
    const w = lod ? 0.5 : 1.55;
    const z = q.z0 + (i + 0.5) * (lod ? 0.55 : 1.65);
    box(k, [q.half * 2, 0.14, w], [q.x, q.y - 0.07, z], i % 3 === 0 ? P.timberLight : P.timber);
  }
  for (const s of [-1, 1]) for (let z = q.z0 + 0.5; z < q.z1; z += 3.2) k.limb([q.x + s * (q.half + 0.05), -3.0, z], [q.x + s * (q.half + 0.05), q.y + 0.8, z], 0.1, 0.09, P.timber, 5);
  for (const b of q.bollards) k.limb([b.x, q.y - 0.3, b.z], [b.x, q.y + 0.9, b.z], 0.2, 0.17, P.iron, 7);
  // the pool: a flat disc of seep-water in the basin
  k.add(new CylinderGeometry(q.pool.r, q.pool.r, 0.08, lod ? 28 : 14), { at: [q.pool.x, q.pool.y, q.pool.z], colour: (_p, n, out) => blend(out, P.seepDark, P.seepGreen, 0.08 + 0.1 * (n.y > 0.5 ? 1 : 0)), flat: true });
  // the ore barge: a timber hull heaped with copper ore, a stubby mast, a lamp
  const bt = q.barge;
  k.setBase(bt.x, q.pool.y + 0.08, bt.z, bt.yaw);
  const hull = new BoxGeometry(2.9, 1.1, 7.8, 1, 1, 6);
  const hp = hull.attributes.position as BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    const zz = hp.getZ(i);
    const taper = 1 - Math.pow(Math.abs(zz) / 3.9, 3) * 0.7;
    if (hp.getY(i) < 0) hp.setX(i, hp.getX(i) * taper * 0.85);
    else hp.setX(i, hp.getX(i) * taper);
    if (Math.abs(zz) > 3.8) hp.setY(i, hp.getY(i) + (hp.getY(i) > 0 ? 0.3 : 0));
  }
  k.add(hull, { at: [0, 0.35, 0], colour: (p, n, out) => blend(out, P.timber, P.crepe, n.y > 0.5 ? 0.3 : Math.max(0, -p.y) * 0.6), flat: true });
  k.add(new IcosahedronGeometry(1.1, 1), { at: [0, 1.15, 0.4], scale: [1.1, 0.55, 2.0], colour: (_p, n, out) => blend(out, P.copper, P.verdigris, Math.max(0, n.y) * 0.25), flat: true, jitter: 0.12, seed: 360 });
  k.limb([0, 0.9, -2.6], [0, 4.4, -2.6], 0.1, 0.07, P.timber, 6);
  k.add(new SphereGeometry(0.12, 5, 4), { at: [0, 4.5, -2.6], colour: P.glowLamp });
  k.clearBase();
}

export function addVesperWorks(k: Kit, world: CollisionWorld, lod: Lod, parts: VesperSolidParts): void {
  headframe(k, world, lod, parts);
  trestle(k, world, lod);
  tipple(k, world, lod);
  rails(k, world, lod);
  fall(k, world, lod);
  pegs(k, world, lod);
  wharf(k, world, lod);
  parts.glows.push({ x: VESPER_STOCK.keg.x, y: world.terrainHeight(VESPER_STOCK.keg.x, VESPER_STOCK.keg.z) + 1.6, z: VESPER_STOCK.keg.z });
  void VESPER_ANCHORS;
  void vesperRoadX;
  void corrugated;
  void slab;
  void stone;
}
