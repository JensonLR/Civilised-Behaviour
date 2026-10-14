import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Shape, SphereGeometry, Vector3 } from "three";
import { LAMPSIDE, PALETTE, hash3, kessarLevel, lampsidePlan, relicPlan, type CollisionWorld, type LampsideHouse, type LampsideStall, type LampsideWall, type RelicBed } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { RoofKits, interiorShell, sealedDoor, type DoorMark, type RoofSource, type SealedStyle, type ShellStyle } from "../rooms.ts";
import { cart, tent } from "../landmarks.ts";
import { crateParts } from "../objects.ts";
import { pane, type LitPane } from "../litWindows.ts";
import { KESSAR, KESSAR_ANCHORS as A, WRECK, bridgeLips, kessarPlan, type WallSeg } from "./shared.ts";

/**
 * Every solid thing in Kessar Reach merged into ONE vertex-coloured geometry (one draw, one ink hull): the hill-fort (curtain wall with merlons, four round
 * towers with conical roofs, the gatehouse with its barred door and nine lamps, the keep and halls inside, cannons on the wall), the stone bridge (or its
 * stumps and rubble when the span is down), the rim wall along the gorge, the Ward's toll station, the landing pier and boat, the Syndicate's camp and the
 * Society's powder cart. Everything is placed from `kessarPlan()` and the world's terrain: the wall you see is the wall you bump into.
 * Masonry is boxes cut into courses (faceted, coloured per triangle): crisp blocks without a texture.
 */

const K = PALETTE.kessar;
const h01 = (seed: number, a: number, b = 0, c = 0): number => hash3(seed, a, b, c) / 4294967296;

/** Courses of sandstone blocks: rows 0.7 m high, blocks ~1.6 m long, each a shade of its own; caps pale, undersides dark. */
const masonry = (seed: number, base: number = K.stone, shade: number = K.stoneShade): ColourFn => (p, n, out) => {
  if (n.y > 0.6) {
    out.set(K.stoneCap);
    return;
  }
  if (n.y < -0.6) {
    out.set(K.stoneDark);
    return;
  }
  const row = Math.floor(p.y / 0.7);
  const col = Math.floor((p.x + p.z) / 1.6 + (row & 1) * 0.5);
  blend(out, base, shade, h01(seed, row, col) * 0.85);
  if (h01(seed + 7, row, col) > 0.93) blend(out, K.stoneShade, K.stoneDark, 0.5);
};

const plain = (c: number): ColourFn => (_p, _n, out) => void out.set(c);

function slab(k: Kit, size: V3, at: V3, colour: number | ColourFn, lod: Lod, rot?: V3, coarse = false): void {
  const fine = lod > 0 && !coarse;
  const sx = fine ? Math.min(8, Math.max(1, Math.round(size[0] / 1.6))) : 1;
  const sy = fine ? Math.min(14, Math.max(1, Math.round(size[1] / 0.7))) : 1;
  const sz = fine ? Math.min(8, Math.max(1, Math.round(size[2] / 1.6))) : 1;
  k.add(new BoxGeometry(size[0], size[1], size[2], sx, sy, sz), { at, rot, colour, flat: true, perFace: typeof colour !== "number" });
}

const box = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

const gold = K.lampGold;

/** A row of square merlons along the top of a wall: `n` blocks of `w` spread over `length`, at height `y`, on the z offset `z`. */
function merlons(k: Kit, length: number, y: number, z: number, n: number, w: number, h: number, depth: number, seed: number): void {
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (length * (i + 0.5)) / n;
    box(k, [w, h, depth], [x, y + h / 2, z], masonry(seed + i), undefined);
  }
}

// ---- the fort -------------------------------------------------------------------------------------------------------------------

function wallSegment(k: Kit, s: WallSeg, gy: number, lod: Lod, seed: number): void {
  k.setBase(s.x, gy, s.z, s.yaw);
  const H = KESSAR.wallHeight + 1.5;
  slab(k, [s.hx * 2, H, s.hz * 2], [0, H / 2 - 1.5, 0], masonry(seed), lod);
  if (lod) {
    // the wall walk's parapet: merlons on the outer edge (local -z is outward), a low inner lip
    merlons(k, s.hx * 2 - 0.5, KESSAR.wallHeight, -s.hz + 0.22, 4, 0.95, 1.05, 0.5, seed * 3);
    box(k, [s.hx * 2 - 0.3, 0.4, 0.3], [0, KESSAR.wallHeight + 0.2, s.hz - 0.2], K.stoneShade);
  }
}

function roofCone(k: Kit, r: number, h: number, at: V3, radial: number, rot = 0): void {
  k.add(new ConeGeometry(r, h, radial, 1), { at: [at[0], at[1] + h / 2, at[2]], rot: [0, rot, 0], colour: (p, n, out) => blend(out, K.roofDark, K.roof, Math.max(0, n.y) * 0.6 + (Math.floor((Math.atan2(p.x, p.z) + 3.2) * 2) & 1) * 0.25), flat: true });
}

function roundTower(k: Kit, x: number, z: number, r: number, h: number, gy: number, lod: Lod, seed: number): void {
  k.setBase(x, gy, z, 0);
  const radial = lod ? 14 : 8;
  k.add(new CylinderGeometry(r, r * 1.08, h + 1.5, radial, lod ? Math.round(h / 0.7 / 2) : 1), { at: [0, (h - 1.5) / 2, 0], colour: masonry(seed), flat: true, perFace: true });
  k.add(new CylinderGeometry(r + 0.45, r + 0.3, 0.7, radial), { at: [0, h - 0.1, 0], colour: K.stoneCap, flat: true });
  if (lod) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      box(k, [0.9, 0.9, 0.55], [Math.cos(a) * (r + 0.3), h + 0.7, Math.sin(a) * (r + 0.3)], masonry(seed + i), [0, -a + Math.PI / 2, 0]);
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * 0.25 + i * 0.5;
      box(k, [0.22, 1.1, 0.3], [Math.cos(a) * (r - 0.02), h * 0.62 + (i % 2) * 2, Math.sin(a) * (r - 0.02)], K.timber, [0, -a + Math.PI / 2, 0]);
    }
  }
  roofCone(k, r + 0.55, 4.6, [0, h + 0.2, 0], lod ? 12 : 8);
  k.add(new SphereGeometry(0.22, 6, 4), { at: [0, h + 4.9, 0], colour: gold });
}

function gatehouse(k: Kit, plan: ReturnType<typeof kessarPlan>, gy: (x: number, z: number) => number, lod: Lod, out: KessarOut): void {
  const f = plan.fort;
  for (const [i, b] of f.bastions.entries()) {
    k.setBase(b.x, gy(b.x, b.z), b.z, b.yaw);
    slab(k, [b.hx * 2, b.height + 1.5, b.hz * 2], [0, (b.height - 1.5) / 2, 0], masonry(40 + i), lod);
    if (lod) {
      merlons(k, b.hx * 2 - 0.4, b.height, b.hz - 0.25, 4, 0.95, 1.05, 0.5, 60 + i * 9);
      merlons(k, b.hx * 2 - 0.4, b.height, -b.hz + 0.25, 4, 0.95, 1.05, 0.5, 70 + i * 9);
    }
  }
  const d = f.door;
  const y = gy(d.x, d.z);
  k.setBase(d.x, y, d.z, 0);
  // the arch: a stone lintel band, a dark timber double door with iron straps, a portcullis, and the nine lamps over it
  slab(k, [d.hx * 2 + 0.6, 9.5, d.hz * 2 + 0.4], [0, 3.6, 0], masonry(50), lod);
  box(k, [d.hx * 2 - 0.5, d.height, 0.5], [0, d.height / 2 - 0.3, d.hz + 0.05], K.timber);
  const arch = new CylinderGeometry(d.hx - 0.25, d.hx - 0.25, 0.5, lod ? 14 : 8, 1, false, Math.PI / 2, Math.PI); // (the upper half: a semicircle over the door)
  arch.rotateX(Math.PI / 2);
  k.add(arch, { at: [0, d.height - 0.3, d.hz + 0.05], colour: K.timber, flat: true });
  if (lod) {
    for (let i = 0; i < 4; i++) box(k, [d.hx * 2 - 0.5, 0.16, 0.12], [0, 0.7 + i * 1.15, d.hz + 0.36], K.iron);
    for (let i = -2; i <= 2; i++) box(k, [0.14, d.height - 0.4, 0.12], [i * 1.15, d.height / 2 - 0.3, d.hz + 0.5], K.iron);
  }
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.08 + (0.84 * i) / 8);
    const lx = -Math.cos(a) * (d.hx - 0.1);
    const ly = d.height + 0.5 + Math.sin(a) * 1.5;
    k.add(new SphereGeometry(lod ? 0.2 : 0.16, 6, 4), { at: [lx, ly, d.hz + 0.35], colour: gold });
    // (the Ward's nine lamps are lit at night: they were gold balls in the dark, over a gate whose notice says it opens when the lamps agree)
    const w = k.worldPoint(lx, ly, d.hz + 0.35);
    out.lamps.push({ x: w[0], y: w[1], z: w[2] });
  }
  // D-038: the gate is SEALED. The portcullis is down, chained and padlocked, and the Ward's paper seal is across it (the notice is the cloth mesh's plaque: "THE GATE OPENS WHEN THE LAMPS AGREE")
  k.clearBase();
  {
    const gb = kessarLevel().buildings.find((x) => x.id === "fort.gate")!;
    k.setBase(d.x, y, d.z, Math.PI / 2);   // (local +x is the gate's front, facing the road)
    sealedDoor(k, `${gb.id}.door`, d.hz + 0.55, 0, gb.door, gb.doorH, SEAL, lod, out.marks, { x: d.x, y, z: d.z, yaw: Math.PI / 2 }, d.hz);   // (the portcullis stands 0.55 m proud of the wall face the collision has)
    // the sill the portcullis comes down on: the gate stands at the top of a steep approach (the ground falls ~1 m in the 1.2 m out to the portcullis), so a
    // masonry step runs out from the gatehouse face under it and down into the slope (it ends 0.2 m past the portcullis: nothing to walk into)
    const sillIn = d.hz + 0.15, sillOut = d.hz + 0.55 + 0.2;
    slab(k, [sillOut - sillIn, 1.9, gb.door + 0.9], [(sillIn + sillOut) / 2, -0.95, 0], masonry(51), lod, undefined, true);
    k.clearBase();
  }
  // the forecourt: two flanking lamp posts, standing on the ground as it is there (the approach climbs)
  k.clearBase();
  for (const s of [-1, 1]) {
    const lx = d.x + s * 4.6;
    const lz = d.z + d.hz + 3.6;
    const ly = gy(lx, lz);
    k.limb([lx, ly - 0.3, lz], [lx, ly + 2.5, lz], 0.1, 0.08, K.iron, 5);
    k.add(new SphereGeometry(0.3, 7, 5), { at: [lx, ly + 2.75, lz], colour: gold });
    out.lamps.push({ x: lx, y: ly + 2.75, z: lz });
  }
}

function keep(k: Kit, plan: ReturnType<typeof kessarPlan>, gy: (x: number, z: number) => number, lod: Lod, panes: LitPane[]): void {
  const f = plan.fort;
  const kp = f.keep;
  const base = gy(kp.x, kp.z);
  k.setBase(kp.x, base, kp.z, 0);
  slab(k, [kp.hx * 2, kp.height + 1.5, kp.hz * 2], [0, (kp.height - 1.5) / 2, 0], masonry(80), lod);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.add(new CylinderGeometry(1.5, 1.6, kp.height + 4.5, lod ? 10 : 6), { at: [sx * (kp.hx - 0.2), (kp.height + 1.5) / 2 - 0.75 + 0.75, sz * (kp.hz - 0.2)], colour: masonry(84 + sx + sz * 2), flat: true, perFace: true });
    roofCone(k, 2.1, 3.6, [sx * (kp.hx - 0.2), kp.height + 3, sz * (kp.hz - 0.2)], lod ? 10 : 6);
  }
  if (lod) {
    merlons(k, kp.hx * 2 - 3.6, kp.height, kp.hz - 0.3, 5, 1.0, 1.1, 0.55, 100);
    merlons(k, kp.hx * 2 - 3.6, kp.height, -kp.hz + 0.3, 5, 1.0, 1.1, 0.55, 110);
    for (let i = 0; i < 5; i++) {
      box(k, [0.4, 1.2, 0.3], [-4 + i * 2, 5 + (i % 2) * 4, kp.hz + 0.05], K.timber);
      pane(panes, k, -4 + i * 2, 5 + (i % 2) * 4, kp.hz + 0.2, 1, 0.26, 0.96, 80 + i);   // (the slit's glass, set in its timber frame)
    }
  }
  // the pole on the roof
  k.limb([0, kp.height, 0], [0, kp.height + 6.5, 0], 0.12, 0.08, K.timber, 5);
  k.add(new SphereGeometry(0.3, 7, 5), { at: [0, kp.height + 6.6, 0], colour: gold });
  // halls in the courtyard: walls with pyramid roofs
  for (const [i, hall] of f.halls.entries()) {
    const hb = gy(hall.x, hall.z);
    k.setBase(hall.x, hb, hall.z, hall.yaw);
    slab(k, [hall.hx * 2, hall.height + 1, hall.hz * 2], [0, hall.height / 2 - 0.5, 0], masonry(120 + i, K.stoneCap, K.stone), lod);
    roofCone(k, Math.hypot(hall.hx, hall.hz) + 0.5, 3.2, [0, hall.height, 0], 4, Math.PI / 4);
    if (lod) box(k, [0.7, 1.6, 0.7], [hall.hx * 0.5, hall.height + 1.6, 0], K.stoneShade);
    // a window in each long face, a timber frame round its glass
    if (lod) for (const s of [-1, 1] as const) {
      box(k, [0.9, 1.2, 0.14], [0, hall.height * 0.55, s * (hall.hz + 0.05)], K.timber);
      pane(panes, k, 0, hall.height * 0.55, s * (hall.hz + 0.12), s, 0.66, 0.96, 120 + i);
    }
  }
}

function cannon(k: Kit, c: { x: number; z: number; yaw: number }, y: number, lod: Lod): void {
  k.setBase(c.x, y, c.z, c.yaw);
  box(k, [2.3, 0.3, 1.2], [-0.2, 0.25, 0], K.timber);
  for (const s of [-1, 1]) k.add(new CylinderGeometry(0.5, 0.5, 0.14, lod ? 10 : 6), { at: [-0.1, 0.5, s * 0.66], rot: [Math.PI / 2, 0, 0], colour: K.timberLight, flat: true });
  // the cheeks the barrel rides in, and the trunnion pin through barrel and cheeks (the barrel rests on the carriage, it does not hover over it)
  for (const s of [-1, 1]) box(k, [1.5, 0.62, 0.1], [-0.2, 0.69, s * 0.36], K.timber);
  k.add(new CylinderGeometry(0.09, 0.09, 0.9, 6), { at: [0.3, 1.03, 0], rot: [Math.PI / 2, 0, 0], colour: K.ironLight, flat: true });
  k.limb([-0.9, 0.95, 0], [1.9, 1.15, 0], 0.3, 0.22, K.iron, lod ? 10 : 6, true);
  k.add(new SphereGeometry(0.33, 8, 5), { at: [-0.95, 0.95, 0], colour: K.ironLight });
  if (lod) for (const x of [0.2, 1.1, 1.8]) k.add(new CylinderGeometry(0.32, 0.32, 0.12, 10), { at: [x, 1.05 + x * 0.08, 0], rot: [0, 0, Math.PI / 2 - 0.1], colour: K.ironLight, flat: true });
}

// ---- the bridge -----------------------------------------------------------------------------------------------------------------

/** The bridge's side profile (z along the span, y up, deck top at y = 0): two arches either side of the mid-pier, extruded across the deck. */
function bridgeBody(span: number, depth: number, width: number, arcSeg: number): BufferGeometry {
  const s = new Shape();
  const h = span / 2;
  const bottom = -depth;
  const spring = -2.6;
  const apex = -1.0;
  s.moveTo(-h, 0);
  s.lineTo(h, 0);
  s.lineTo(h, bottom);
  // right arch (seen from the north end it is the far one), then the pier between the arches, then the left
  const arch = (cx: number, hw: number): void => {
    s.lineTo(cx + hw, bottom);
    s.lineTo(cx + hw, spring);
    for (let i = 1; i <= arcSeg; i++) {
      const a = (i / arcSeg) * Math.PI;
      s.lineTo(cx + hw * Math.cos(a), spring + (apex - spring) * Math.sin(a));
    }
    s.lineTo(cx - hw, bottom);
  };
  arch(h * 0.5, h * 0.4);
  arch(-h * 0.5, h * 0.4);
  s.lineTo(-h, bottom);
  s.lineTo(-h, 0);
  const g = new ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: arcSeg });
  g.translate(0, 0, -width / 2);
  // shape x -> world z, shape z (depth) -> world x
  g.rotateY(-Math.PI / 2);
  return g;
}

function bridge(k: Kit, plan: ReturnType<typeof kessarPlan>, intact: boolean, lod: Lod, terrain: (x: number, z: number) => number): void {
  const b = plan.bridge;
  const L = KESSAR.level;
  const span = b.z1 - b.z0;
  const bed = L - KESSAR.gorgeDepth;
  const mid = (b.z0 + b.z1) / 2;
  k.setBase(b.x, L + 0.03, mid, 0); // (a hair above the bank: the deck's top must not z-fight the ground it meets)
  if (intact) {
    const body = bridgeBody(span, L - bed + 0.6, KESSAR.deckHalf * 2, lod ? 10 : 5);
    k.add(body, { colour: (p, n, out) => {
      if (n.y > 0.6) blend(out, K.roadDust, K.stoneCap, h01(31, Math.floor(p.x * 1.2), Math.floor(p.z * 0.9)) * 0.7);
      else if (n.y < -0.4) out.set(K.stoneDark);
      else blend(out, K.stone, K.stoneShade, h01(32, Math.floor(p.y / 0.7), Math.floor((p.x + p.z) / 1.4)) * 0.85);
    }, perFace: true });
    for (const s of [-1, 1]) {
      const px = s * (KESSAR.deckHalf + 0.3);
      slab(k, [0.6, KESSAR.parapetHeight, span], [px, KESSAR.parapetHeight / 2, 0], masonry(33 + s), lod, undefined, true);
      box(k, [0.95, 0.2, span + 0.4], [px, KESSAR.parapetHeight + 0.1, 0], K.stoneCap);
    }
  }
  // the lamps at the bridge's two ends: they stand on the abutments, so they are still there when the span is not
  for (const s of [-1, 1]) {
    const px = s * (KESSAR.deckHalf + 0.3);
    for (const e of [-1, 1]) {
      k.limb([px, 0, e * (span / 2 - 0.4)], [px, 2.6, e * (span / 2 - 0.4)], 0.13, 0.1, K.iron, 5);
      k.add(new SphereGeometry(0.3, 7, 5), { at: [px, 2.85, e * (span / 2 - 0.4)], colour: gold });
    }
  }
  // piers: standing under the deck, or the stumps the charge left (snapped off ragged)
  const stumpTop = intact ? L - 0.8 : L - 2.4;
  for (const p of b.piers) {
    k.setBase(p.x, bed - 0.5, p.z, 0);
    const h = stumpTop - (bed - 0.5);
    k.add(new CylinderGeometry(p.r, p.r * 1.15, h, lod ? 10 : 6), { at: [0, h / 2, 0], colour: masonry(36), flat: true, perFace: true });
    if (!intact) for (let i = 0; i < 4; i++) box(k, [0.5, 0.45 + 0.2 * (i % 2), 0.55], [Math.cos(i * 1.57 + 0.4) * 0.45, h + 0.12, Math.sin(i * 1.57 + 0.4) * 0.45], i % 2 ? K.stoneShade : K.stone, [0.15 * i, i * 0.8, 0.1]);
  }
  k.clearBase();
  if (!intact) brokenEnds(k, plan, lod, terrain);
}

/**
 * D-097: what the charge leaves of the bridge at each bank (the span itself lies in the gorge: bridgeWreck.ts). The abutment and a slab of the deck reaching `WRECK.overhang`
 * out over the gorge, its end a ragged break; the parapets on it, snapped lower at the break; and across the road at the lip, where a walker is stopped from stepping into the
 * gap (`plan.stubs`, solid to the rim's height), a heap of the masonry the blast threw back: blocks of every size, so the view across the gorge is over and between them, not
 * a wall (the first build put up two plain 8 m walls there; seen in play, they read as walls and hid the river).
 */
function brokenEnds(k: Kit, plan: ReturnType<typeof kessarPlan>, lod: Lod, terrain: (x: number, z: number) => number): void {
  const b = plan.bridge;
  const L = KESSAR.level;
  const [lipN, lipS] = bridgeLips();
  const W = KESSAR.deckHalf;
  const rough = (seed: number): ColourFn => (p, n, out) => (n.y > 0.6 ? blend(out, K.roadDust, K.stoneCap, h01(seed, Math.floor(p.x * 2), Math.floor(p.z * 2)) * 0.6) : blend(out, K.stoneShade, K.stoneDark, h01(seed + 1, Math.floor(p.y * 3), Math.floor((p.x + p.z) * 2)) * 0.7));
  for (const [lip, dir, end] of [[lipN, 1, b.z0], [lipS, -1, b.z1]] as const) {
    const face = lip + dir * WRECK.overhang;
    const zc = (face + end) / 2, len = Math.abs(face - end);
    // the abutment and the slab: from the deck's top down to the ground under the break (the ramp falls away beneath it)
    const depth = L - terrain(b.x, face) + 0.5;
    slab(k, [W * 2, depth, len], [b.x, L + 0.03 - depth / 2, zc], masonry(240 + dir), lod, undefined, true);
    box(k, [W * 2 - 0.1, 0.06, len], [b.x, L + 0.06, zc], K.roadDust);
    // the break: teeth of the deck's masonry standing proud of the face, of uneven depth and height (inside the next metre: the wreck plan keeps that clear)
    const n = lod ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const tw = (W * 2) / n, tl = 0.12 + h01(250 + dir, i) * 0.4, th = 0.4 + h01(251 + dir, i) * (WRECK.deckThick - 0.4);
      box(k, [tw - 0.05, th, tl], [b.x - W + (i + 0.5) * tw, L + 0.03 - th / 2 - (i % 3 === 1 ? 0.25 : 0), face + dir * tl / 2], rough(260 + i));
    }
    // the parapets on the stump, snapped at the break: full height to within a metre of it, then a lower ragged end
    for (const s of [-1, 1]) {
      const px = b.x + s * (W + 0.3);
      const full = len - 0.9;
      slab(k, [0.6, KESSAR.parapetHeight, full], [px, L + KESSAR.parapetHeight / 2, end + dir * full / 2], masonry(33 + s), lod, undefined, true);
      box(k, [0.95, 0.2, full], [px, L + KESSAR.parapetHeight + 0.1, end + dir * full / 2], K.stoneCap);
      const stub = 0.45 + h01(270 + s, dir) * 0.35;
      box(k, [0.6, stub, 0.8], [px, L + stub / 2, end + dir * (full + 0.4)], rough(280 + s));
    }
    // the heap across the road at the lip: a course of thrown blocks about waist high, a few more on top, and two slabs of the deck stood on end by the blast, so it
    // reaches the rim's height only where those stand (the gorge is seen over it)
    for (const sx of [-0.35, 0.3]) {
      const sh = KESSAR.rimHeight - 0.05 - h01(302 + dir, sx) * 0.2;
      box(k, [1.1, sh, 0.28], [b.x + sx * W, L + sh / 2 - 0.1, lip + dir * 0.12], rough(305 + dir), [0.12 * dir, sx * 0.9, (h01(303 + dir, sx) - 0.5) * 0.3]);
    }
    for (let i = 0; i < 8; i++) {
      const bw = 0.75 + h01(290 + dir, i) * 0.35, bh = 0.45 + h01(291 + dir, i) * 0.3;
      const x = b.x - W + 0.45 + i * ((W * 2 - 0.9) / 7);
      box(k, [bw, bh, 0.55 + h01(292 + dir, i) * 0.2], [x, L + bh / 2 - 0.05, lip + (h01(293 + dir, i) - 0.5) * 0.25], i % 3 ? masonry(300 + i) : rough(300 + i), [0, (h01(294 + dir, i) - 0.5) * 0.5, (h01(295 + dir, i) - 0.5) * 0.12]);
      if (h01(296 + dir, i) < 0.4) {
        const th = 0.3 + h01(297 + dir, i) * 0.3;
        box(k, [bw * 0.75, th, 0.5], [x + (h01(298 + dir, i) - 0.5) * 0.3, L + bh - 0.05 + th / 2, lip + (h01(299 + dir, i) - 0.5) * 0.2], rough(310 + i), [0.08, (h01(300 + dir, i) - 0.5) * 0.6, (h01(301 + dir, i) - 0.5) * 0.25]);
      }
    }
  }
}

// ---- the rim wall, the toll station, the landing, the camps --------------------------------------------------------------------------

/**
 * The rim along the gorge's lips: a stone railing (D-097; it was a plain wall the rim's height, which hid the gorge, the river and the bridge's arches from the bank). A plinth,
 * posts, a rail and a capping rail at the rim's height: as solid to a walker as the wall was (its collider is the same box), and the gorge is seen through it.
 */
function rim(k: Kit, plan: ReturnType<typeof kessarPlan>, terrain: (x: number, z: number) => number, lod: Lod): void {
  const segs = plan.rim;   // (with the span down, the gap's solid is drawn as the heap at each broken end: brokenEnds)
  const H = KESSAR.rimHeight, plinth = 0.5, cap = 0.16;
  for (const [i, s] of segs.entries()) {
    const y = terrain(s.x, s.z);
    k.setBase(s.x, y, s.z, s.yaw);
    const len = s.hx * 2, t = s.hz * 2;
    slab(k, [len, plinth + 0.4, t + 0.1], [0, (plinth - 0.4) / 2, 0], masonry(200 + (i % 9)), lod, undefined, true);
    box(k, [len + 0.04, cap, t + 0.22], [0, H - cap / 2, 0], K.stoneCap);
    // a post where each run begins (the next run's begins where this one ends), more only on a long run; and one rail between plinth and cap: open, so the gorge shows
    const posts = Math.max(1, Math.round(len / 3.2));
    for (let p = 0; p < posts; p++) box(k, [0.3, H - cap - plinth, t + 0.04], [-len / 2 + 0.15 + (p / posts) * len, plinth + (H - cap - plinth) / 2, 0], K.stone);
    box(k, [len, 0.1, t * 0.5], [0, plinth + (H - cap - plinth) * 0.52, 0], K.stoneCap);
  }
  k.clearBase();
}

/** The toll booth's inside: cream lime-wash, a plank floor, an iron-strapped door; and the Ward's seals on the gate. */
const BOOTH: ShellStyle = { outer: K.stone, inner: K.wardCream, floor: K.timberLight, floorDark: K.timber, trim: K.timber, leaf: K.timber, strap: K.iron, lamp: K.lampGold, ceiling: K.timber };
const SEAL: SealedStyle = { frame: K.stoneShade, door: K.timber, board: K.timberLight, boardDark: K.timber, iron: K.iron, brass: K.lampGold, paper: K.wardCream, wax: K.wardRed };

interface KessarOut {
  marks: DoorMark[];
  /** Lanterns: their flames' world positions, and a floor level for a lamp in a room (it burns by day); outdoor lamps (no `lit`) follow the night. */
  lamps: { x: number; y: number; z: number; lit?: number }[];
  roofs: RoofKits;
  /** D-089: the keep's and the halls' windows (the Ward keeps late hours). */
  panes: LitPane[];
}

function tollStation(k: Kit, plan: ReturnType<typeof kessarPlan>, terrain: (x: number, z: number) => number, lod: Lod, out: KessarOut): void {
  const t = plan.toll;
  const bo = t.booth;
  const lb = kessarLevel().buildings.find((x) => x.id === "toll.booth")!;
  const gy = terrain(bo.x, bo.z);
  k.setBase(bo.x, gy, bo.z, bo.yaw);
  // the one reward interior: stone walls (masonry outside, cream within), a doorway facing the customs yard, a desk and a ledger, a lamp; the pyramid roof is its own (lifted when the viewer is inside)
  interiorShell(k, { id: lb.id, hx: bo.hx, hz: bo.hz, floor: lb.floor, wallH: lb.wallH, door: lb.door, doorH: lb.doorH, steps: 0, t: lb.t ?? 0.3 }, { ...BOOTH, outer: masonry(300, K.stoneCap, K.stone) }, lod, out.marks, { x: bo.x, y: gy, z: bo.z, yaw: bo.yaw });
  const lw = k.worldPoint(-bo.hx * 0.15, lb.floor + 2.3, 0);
  out.lamps.push({ x: lw[0], y: lw[1], z: lw[2], lit: 0.7 });
  const fl = lb.floor;
  // the Warden's counter along the back wall, a stool, the ledger and a stack of seals; a striped awning over the door
  box(k, [0.7, 0.9, bo.hz * 2 - 1.2], [-bo.hx + 0.6, fl + 0.45, 0], K.timberLight);
  box(k, [0.5, 0.06, 0.8], [-bo.hx + 0.6, fl + 0.93, -0.4], K.wardCream);
  box(k, [0.16, 0.3, 0.16], [-bo.hx + 0.6, fl + 1.08, 0.7], K.ironLight);
  box(k, [0.4, 0.45, 0.4], [-bo.hx + 1.5, fl + 0.22, 0.4], K.timber);
  box(k, [1.0, 0.1, lb.door + 0.8], [bo.hx + 0.45, fl + lb.doorH + 0.12, 0], (p, _n, o2) => o2.set(Math.floor((p.z + 10) * 2.5) & 1 ? K.wardRed : K.wardCream), [0, 0, -0.3]);
  const rk = out.roofs.begin(lb.id);
  rk.setBase(bo.x, gy, bo.z, bo.yaw);
  roofCone(rk, Math.hypot(bo.hx, bo.hz) + 0.4, bo.height - fl - lb.wallH, [0, fl + lb.wallH, 0], 4, Math.PI / 4);
  k.clearBase();
  const de = t.desk;
  k.setBase(de.x, terrain(de.x, de.z), de.z, de.yaw);
  box(k, [de.hx * 2, de.height, de.hz * 2], [0, de.height / 2, 0], K.timberLight);
  box(k, [0.6, 0.06, 0.42], [0.1, de.height + 0.05, 0], K.wardCream); // the ledger
  box(k, [0.16, 0.3, 0.16], [-0.45, de.height + 0.15, 0.1], K.ironLight);
  k.clearBase();
  // gate posts, and the toll bar swung UP (the bar is the Warden's to lower: for now the road is open, the price is not)
  for (const p of t.posts) {
    const y = terrain(p.x, p.z);
    k.setBase(p.x, y, p.z, 0);
    k.limb([0, -0.3, 0], [0, 2.7, 0], 0.22, 0.17, K.stoneCap, 8);
    k.add(new SphereGeometry(0.33, 7, 5), { at: [0, 3.0, 0], colour: gold });
  }
  k.clearBase();
  const left = t.posts[0]!;
  const right = t.posts[1]!;
  const ly = terrain(left.x, left.z);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a: V3 = [left.x + 0.2 + (i / n) * 3.3, ly + 1.6 + (i / n) * 2.3, left.z];
    const b: V3 = [left.x + 0.2 + ((i + 1) / n) * 3.3, ly + 1.6 + ((i + 1) / n) * 2.3, left.z];
    k.limb(a, b, 0.09, 0.09, i & 1 ? K.wardCream : K.wardRed, 5);
  }
  k.limb([left.x + 0.2, ly + 1.6, left.z], [left.x - 0.6, ly + 1.0, left.z], 0.09, 0.09, K.wardRed, 5);
  k.add(new CylinderGeometry(0.22, 0.22, 0.5, 8), { at: [left.x - 0.7, ly + 0.9, left.z], colour: K.iron, flat: true });
  void right;
}

/** A signboard on its post (Kessar's own boards, and D-129's at the Relic Works): the lettering is the cloth's decal on both faces. */
function signpost(k: Kit, s: { x: number; z: number; yaw: number }, terrain: (x: number, z: number) => number): void {
  const y = terrain(s.x, s.z);
  k.setBase(s.x, y, s.z, s.yaw);
  // the post stops under the board, with two braces out to it (it ran up through the board and crossed the middle of the lettering on both faces)
  k.limb([0, -0.3, 0], [0, 1.53, 0], 0.09, 0.075, K.timber, 5);
  for (const sz of [-1, 1]) k.limb([0, 0.95, 0], [0, 1.53, sz * 0.75], 0.03, 0.03, K.timber, 3);
  // (local +x is the board's FACE direction, so the board runs along local z)
  box(k, [0.09, 0.52, 2.5], [0, 1.85, 0], K.wardCream);
  box(k, [0.12, 0.06, 2.6], [0, 2.14, 0], K.timberLight);
  box(k, [0.12, 0.06, 2.6], [0, 1.56, 0], K.timberLight);
  k.clearBase();
}

function signposts(k: Kit, plan: ReturnType<typeof kessarPlan>, terrain: (x: number, z: number) => number): void {
  for (const s of plan.signs) signpost(k, s, terrain);
}

/** How far a ray from (x, z) along (dx, dz) (unit) travels before it meets a footprint: a box (yawed as `Kit.setBase` turns it) or a circle. 0 when it starts inside, Infinity on a miss. */
function rayToBox(x: number, z: number, dx: number, dz: number, o: { x: number; z: number; yaw: number; hx: number; hz: number }): number {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const px = (x - o.x) * c + (z - o.z) * s, pz = -(x - o.x) * s + (z - o.z) * c;
  const vx = dx * c + dz * s, vz = -dx * s + dz * c;
  let t0 = 0, t1 = Infinity;
  for (const [p, v, h] of [[px, vx, o.hx], [pz, vz, o.hz]] as const) {
    if (Math.abs(v) < 1e-9) {
      if (Math.abs(p) > h) return Infinity;
      continue;
    }
    const a = (-h - p) / v, b = (h - p) / v;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? t0 : Infinity;
}
function rayToCircle(x: number, z: number, dx: number, dz: number, cx: number, cz: number, r: number): number {
  const ox = x - cx, oz = z - cz;
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (b > 0 || disc < 0) return Infinity;
  return -b - Math.sqrt(disc);
}

/**
 * Every banner hangs from a rod, and every rod is HELD: the cloth's top edge is wrapped round the rod (the cloth mesh's top is at `top`, the rod's
 * centre a hair above it), and the rod is either bracketed into the masonry behind it (iron arms from each end back into the keep, a bastion or a
 * tower: whatever a ray straight back from the end meets), lashed to an existing pole beside it (the Syndicate's camp flag), or carried by a pole of
 * its own planted in the ground behind the cloth, with two stays to the rod's ends (the toll yard's and the landing's standards).
 */
function banners(k: Kit, plan: ReturnType<typeof kessarPlan>, terrain: (x: number, z: number) => number): void {
  const f = plan.fort;
  const boxes = [f.keep, ...f.bastions]; // (the masonry the fort's banners hang on; each banner is below its top)
  const BRACKET = 1.2; // metres: a rod end further than this from masonry is not wall-hung
  const behind = (x: number, z: number, dx: number, dz: number): number => {
    let d = Infinity;
    for (const o of boxes) d = Math.min(d, rayToBox(x, z, dx, dz, o));
    for (const t of f.towers) d = Math.min(d, rayToCircle(x, z, dx, dz, t.x, t.z, t.r));
    return d;
  };
  const poles = [plan.camp.flag];
  for (const b of plan.banners) {
    const ground = terrain(b.x, b.z);
    const y = ground + b.top + 0.03;
    const nx = Math.cos(b.yaw), nz = Math.sin(b.yaw); // the cloth's face (as cloth.ts hangs it)
    const rx = Math.sin(b.yaw);
    const rz = -Math.cos(b.yaw);
    const half = b.w / 2 + 0.25;
    k.limb([b.x - rx * half, y, b.z - rz * half], [b.x + rx * half, y, b.z + rz * half], 0.05, 0.05, K.timber, 5);
    for (const s of [-1, 1]) k.add(new SphereGeometry(0.09, 5, 4), { at: [b.x + rx * half * s, y, b.z + rz * half * s], colour: gold });
    const ends = [-1, 1].map((s) => {
      const ex = b.x + rx * (half - 0.15) * s, ez = b.z + rz * (half - 0.15) * s;
      return { ex, ez, d: behind(ex, ez, -nx, -nz) };
    });
    if (ends.every((e) => e.d <= BRACKET)) {
      // wall-hung: an iron arm from each end of the rod back into the stone (sunk 0.15 m), and a stay from its wall end up to the rod
      for (const e of ends) {
        if (e.d === 0) continue; // (the rod's end is already in the wall)
        const wx = e.ex - nx * (e.d + 0.15), wz = e.ez - nz * (e.d + 0.15);
        k.limb([e.ex, y, e.ez], [wx, y, wz], 0.035, 0.035, K.iron, 5);
        k.limb([wx, y + 0.45, wz], [e.ex, y + 0.02, e.ez], 0.018, 0.018, K.iron, 4);
      }
      continue;
    }
    const pole = poles.find((p) => Math.hypot(p.x - b.x, p.z - b.z) < 1);
    if (pole) {
      // lashed to the pole beside it: an iron arm from the pole to the rod's middle, and a stay above it
      k.limb([pole.x, y, pole.z], [b.x, y, b.z], 0.04, 0.04, K.iron, 5);
      k.limb([pole.x, y + 0.3, pole.z], [b.x, y + 0.02, b.z], 0.018, 0.018, K.iron, 4);
      continue;
    }
    // a standard of its own: a pole in the ground just behind the cloth (the rod crosses its face), a gold knob, and two stays to the rod's ends
    const px = b.x - nx * 0.11, pz = b.z - nz * 0.11;
    const py = terrain(px, pz);
    k.limb([px, py - 0.3, pz], [px, y + 0.55, pz], 0.08, 0.06, K.timber, 6);
    k.add(new SphereGeometry(0.11, 6, 4), { at: [px, y + 0.62, pz], colour: gold });
    for (const s of [-1, 1]) k.limb([px, y + 0.5, pz], [b.x + rx * (half - 0.12) * s, y + 0.02, b.z + rz * (half - 0.12) * s], 0.015, 0.015, K.iron, 4);
  }
}

function pier(k: Kit, plan: ReturnType<typeof kessarPlan>, lod: Lod): void {
  const p = plan.pier;
  const L = KESSAR.level;
  const len = p.z1 - p.z0;
  k.setBase(p.x, L + 0.03, (p.z0 + p.z1) / 2, 0);
  // planks: a run of boards, each its own shade
  const n = Math.round(len / 0.55);
  k.add(new BoxGeometry(p.half * 2, 0.32, len, 1, 1, n), { at: [0, -0.16, 0], colour: (pt, nn, out) => (nn.y > 0.6 ? blend(out, K.timberLight, K.timber, h01(9, Math.floor((pt.z + 50) / 0.55)) * 0.8) : out.set(K.timber)), flat: true, perFace: true });
  for (let i = 0; i <= Math.floor(len / 3); i++) {
    for (const s of [-1, 1]) {
      const z = -len / 2 + i * 3;
      k.limb([s * (p.half - 0.1), KESSAR.seabed - 0.6 - L, z], [s * (p.half - 0.1), 0.45, z], 0.17, 0.15, K.timber, lod ? 6 : 4);
    }
  }
  for (const z of [-len / 2 + 1.2, len / 2 - 1.2]) for (const s of [-1, 1]) k.add(new CylinderGeometry(0.17, 0.2, 0.55, 7), { at: [s * (p.half - 0.25), 0.27, z], colour: K.iron, flat: true });
  k.clearBase();
  // the boat, moored alongside: an open hull, thwarts, a mast and a sail striped in the Society's red
  const bt = plan.boat;
  const sea = KESSAR.seaLevel;
  k.setBase(bt.x, sea, bt.z, bt.yaw);
  const hull = new SphereGeometry(1, lod ? 14 : 8, lod ? 8 : 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  k.add(hull, { at: [0, 0.35, 0], rot: [0, 0, 0], scale: [1.05, 0.75, 3.2], colour: (p2, n, out) => blend(out, K.hull, K.timber, p2.y < -0.55 ? 0.6 : 0), flat: true });
  k.add(new BoxGeometry(2.0, 0.08, 6.3), { at: [0, 0.34, 0], colour: K.timberLight, flat: true });
  if (lod) for (const z of [-1.4, 0.2, 1.6]) box(k, [1.9, 0.09, 0.3], [0, 0.22, z], K.timberLight);
  k.limb([0, 0.3, -0.9], [0, 4.4, -0.9], 0.07, 0.05, K.timber, 5);
  box(k, [0.05, 2.5, 1.9], [0, 2.75, 0.06], (pt, _n, out) => out.set(Math.floor((pt.y + 10) * 1.4) & 1 ? K.wardCream : PALETTE.camp.canvasTrim));
  k.clearBase();
}

function camps(k: Kit, plan: ReturnType<typeof kessarPlan>, terrain: (x: number, z: number) => number, lod: Lod): void {
  for (const t of plan.camp.tents) {
    k.setBase(t.x, terrain(t.x, t.z), t.z, t.yaw);
    tent(k, lod);
  }
  const w = plan.camp.wagon;
  k.setBase(w.x, terrain(w.x, w.z), w.z, w.yaw);
  cart(k, lod);
  const c = plan.cart;
  k.setBase(c.x, terrain(c.x, c.z), c.z, c.yaw);
  cart(k, lod);
  for (const cr of plan.camp.crates) {
    k.setBase(cr.x, terrain(cr.x, cr.z) + cr.height / 2, cr.z, cr.yaw);
    crateParts(k, cr.half * 2, cr.height, cr.half * 2, lod);
  }
  const f = plan.camp.flag;
  const fy = terrain(f.x, f.z);
  k.clearBase();
  k.limb([f.x, fy - 0.2, f.z], [f.x, fy + 6, f.z], 0.11, 0.08, K.timber, 6);
  k.add(new SphereGeometry(0.2, 6, 4), { at: [f.x, fy + 6.15, f.z], colour: gold });
}

// ---- Lampside (D-119): the Ward's lower town -----------------------------------------------------------------------------------------

/** Lime-wash over the stone: cream in broad patches, the stone showing where it has flaked, an ochre dado splashed up from the street. `cy`: the piece's centre above the ground. */
const limewash = (seed: number, cy: number): ColourFn => (p, n, out) => {
  if (n.y > 0.6) return void out.set(K.stoneCap);
  if (n.y < -0.6) return void out.set(K.stoneDark);
  const y = p.y + cy;
  if (y < 0.6) return void blend(out, K.ochre, K.stoneShade, h01(seed, Math.floor((p.x + p.z) * 1.5)) * 0.6);
  if (h01(seed + 5, Math.floor(y / 0.7), Math.floor((p.x + p.z) / 1.6)) > 0.9) return void blend(out, K.stone, K.stoneShade, 0.4);
  blend(out, K.wardCream, K.stoneCap, h01(seed + 3, Math.floor(y / 1.4), Math.floor((p.x + p.z) / 2.4)) * 0.8);
};

/** Mud brick in courses (a hand of ochre, a hand of clay), on the garden walls. */
const mudBrick = (seed: number): ColourFn => (p, n, out) => {
  if (n.y > 0.6) return void out.set(K.sandPale);
  const row = Math.floor((p.y + 5) / 0.3);
  const col = Math.floor((p.x + p.z + 50) / 0.6 + (row & 1) * 0.5);
  blend(out, K.ochre, K.clay, h01(seed, row, col) * 0.55);
};

const stripes = (i: number): ColourFn => (p, _n, out) => void out.set((Math.floor((p.z + 10) * 2.6) + i) & 1 ? K.wardRed : K.wardCream);

/** A small iron lantern hung from a bracket (the Ward's lamp at every door): its arm from the wall at local (x, y, z) along +z, the lamp `reach` out. Its flame joins `lamps` (lit at night). */
function bracketLamp(k: Kit, x: number, y: number, z: number, reach: number, out: KessarOut): void {
  k.limb([x, y, z], [x, y + 0.05, z + reach], 0.025, 0.025, K.iron, 4);
  k.limb([x, y - 0.35, z], [x, y - 0.02, z + reach * 0.55], 0.018, 0.018, K.iron, 3);
  box(k, [0.18, 0.26, 0.18], [x, y - 0.17, z + reach], K.iron);
  box(k, [0.13, 0.17, 0.2], [x, y - 0.17, z + reach], gold);
  box(k, [0.13, 0.2, 0.13], [x, y - 0.17, z + reach], gold);
  k.add(new ConeGeometry(0.14, 0.12, 4, 1), { at: [x, y + 0.02, z + reach], rot: [0, Math.PI / 4, 0], colour: K.iron, flat: true });
  const f = k.worldPoint(x, y - 0.17, z + reach);
  out.lamps.push({ x: f[0], y: f[1], z: f[2] });
}

/**
 * A house of Lampside by its plan: walls of lime-wash or coursed sandstone; a flat roof behind a parapet (water spouts, jars on the roof) or a red-tile hip with a gilt finial; two
 * storeys with a string course and a timber balcony over the door; shuttered windows below and lit ones above (D-089); the door SEALED with the Ward's paper seal (its notice is
 * the cloth's plaque) and a lamp on a bracket beside it; an awning over some. Drawn in the house's front frame: local z out of the street face, local x along the street.
 */
function lampsideHouse(k: Kit, h: LampsideHouse, terrain: (x: number, z: number) => number, lod: Lod, out: KessarOut, seed: number, levelId = `lampside.${h.id}`): void {
  const lb = kessarLevel().buildings.find((b) => b.id === levelId)!;
  const gy = terrain(h.x, h.z);
  // (the town's ground is levelled, but the walls reach under the lowest corner all the same)
  let lo = gy;
  k.setBase(h.x, gy, h.z, h.yaw);
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const c = k.worldPoint(sx * h.hx, 0, sz * h.hz);
    lo = Math.min(lo, terrain(c[0], c[2]));
  }
  const drop = gy - lo + 0.4;
  const W = h.hz;   // half the frontage
  const D = h.hx;   // half the depth
  const H = h.height;
  const flat = h.roof === "flat";
  const body = flat ? H - 0.45 : H;
  k.setBase(h.x, gy, h.z, h.yaw - Math.PI / 2);
  const wall = h.lime ? limewash(seed, (body - drop) / 2) : masonry(seed);
  slab(k, [W * 2, body + drop, D * 2], [0, (body - drop) / 2, 0], wall, lod);
  if (flat) {
    // the parapet round the roof, its cornice, and (detailed) a notch at each corner, two timber spouts out of the street face, jars on the roof
    const t = 0.24;
    const pc = h.lime ? limewash(seed + 1, body + 0.225) : masonry(seed + 1);
    box(k, [W * 2, 0.45, t], [0, body + 0.225, D - t / 2], pc);
    box(k, [W * 2, 0.45, t], [0, body + 0.225, -D + t / 2], pc);
    for (const s of [-1, 1]) box(k, [t, 0.45, D * 2 - t * 2], [s * (W - t / 2), body + 0.225, 0], pc);
    box(k, [W * 2 + 0.16, 0.1, D * 2 + 0.16], [0, body - 0.05, 0], K.stoneCap);
    if (lod) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(k, [0.42, 0.22, 0.42], [sx * (W - 0.21), H + 0.11, sz * (D - 0.21)], K.stoneCap);
      for (const s of [-1, 1]) box(k, [0.13, 0.13, 0.55], [s * (W - 0.7), body + 0.04, D + 0.26], K.timber);
      for (let j = 0; j < 3; j++) {
        const jx = -W * 0.5 + j * 0.55, jz = -D * 0.4 + (j % 2) * 0.35;
        k.add(new SphereGeometry(0.24, 7, 5), { at: [jx, body + 0.22, jz], scale: [1, 1.15, 1], colour: K.clay, flat: true });
        k.add(new CylinderGeometry(0.09, 0.12, 0.12, 6), { at: [jx, body + 0.5, jz], colour: K.clay, flat: true });
      }
    }
  } else {
    // the eaves course and the red-tile hip, a gilt finial at its peak
    box(k, [W * 2 + 0.24, 0.2, D * 2 + 0.24], [0, H - 0.08, 0], K.stoneCap);
    const rise = LAMPSIDE.roofRise;
    const hip = new ConeGeometry(Math.SQRT2, rise, 4, 1);
    hip.rotateY(Math.PI / 4);
    k.add(hip, { at: [0, H + rise / 2, 0], scale: [W + 0.45, 1, D + 0.45], colour: (p, n, o) => blend(o, K.roofDark, K.roof, Math.max(0, n.y) * 0.6 + (Math.floor((p.y + 5) * 4) & 1) * 0.22), flat: true });
    hip.dispose();
    k.add(new SphereGeometry(0.13, 6, 4), { at: [0, H + rise + 0.08, 0], colour: gold });
  }
  const up = h.storeys === 2;
  const floor2 = H * 0.5;
  if (up && lod) box(k, [W * 2 + 0.1, 0.16, D * 2 + 0.1], [0, floor2 - 0.1, 0], K.stoneCap);
  // the street face: shuttered windows either side of the door (closed: ward-blue boards on a stone sill), lit glass above (or one high window on a single storey)
  const winX = W - 0.75;
  for (const s of [-1, 1]) {
    box(k, [0.66, 0.84, 0.08], [s * winX, 1.45, D + 0.03], K.wardBlue);
    if (lod) box(k, [0.04, 0.8, 0.1], [s * winX, 1.45, D + 0.05], K.timber);
    box(k, [0.84, 0.1, 0.22], [s * winX, 0.98, D + 0.06], K.stoneCap);
  }
  const lit = (x: number, y: number, z: number, side: 1 | -1, w: number, hh: number, sd: number): void => {
    box(k, [w + 0.16, hh + 0.16, 0.1], [x, y, z], K.timber);
    pane(out.panes, k, x, y, z + side * 0.04, side, w, hh, sd);
    box(k, [w + 0.3, 0.1, 0.2], [x, y - hh / 2 - 0.1, z], K.stoneCap);
  };
  if (up) {
    for (const s of [-1, 1]) lit(s * winX, floor2 + 1.25, D + 0.02, 1, 0.6, 0.9, seed * 7 + s);
    lit(0, floor2 + 1.25, -D - 0.02, -1, 0.6, 0.9, seed * 7 + 5);
    // the balcony over the door: a plank floor on two brackets, a rail, a tall shuttered door behind it
    if (lod) {
      const bw = 2.4, bd = 0.85;
      box(k, [bw, 0.12, bd], [0, floor2 + 0.06, D + bd / 2], K.timberLight);
      for (const s of [-1, 1]) k.limb([s * (bw / 2 - 0.2), floor2 - 0.65, D + 0.02], [s * (bw / 2 - 0.2), floor2, D + bd - 0.1], 0.05, 0.05, K.timber, 4);
      for (let j = 0; j <= 6; j++) k.limb([-bw / 2 + 0.06 + (j * (bw - 0.12)) / 6, floor2 + 0.12, D + bd - 0.06], [-bw / 2 + 0.06 + (j * (bw - 0.12)) / 6, floor2 + 0.95, D + bd - 0.06], 0.025, 0.025, K.timber, 4);
      for (const s of [-1, 1]) k.limb([s * (bw / 2 - 0.06), floor2 + 0.12, D + 0.02], [s * (bw / 2 - 0.06), floor2 + 0.95, D + bd - 0.06], 0.03, 0.03, K.timber, 4);
      box(k, [bw, 0.08, 0.08], [0, floor2 + 0.98, D + bd - 0.06], K.timber);
      for (const s of [-1, 1]) box(k, [0.08, 0.08, bd - 0.06], [s * (bw / 2 - 0.06), floor2 + 0.98, D + bd / 2], K.timber);
      box(k, [1.0, 1.9, 0.08], [0, floor2 + 1.1, D + 0.03], K.wardBlue);
      box(k, [0.05, 1.86, 0.1], [0, floor2 + 1.1, D + 0.05], K.timber);
    }
  } else lit(W * 0.5, 1.65, -D - 0.02, -1, 0.6, 0.7, seed * 7);   // (a single storey's lit window looks onto its garden: the street face is shuttered)
  // D-120: the back door onto the alley, the town's own way in and out (the street door is sealed to the Society): planks in a stone frame, two iron straps, a
  // worn step; no handle on this side (it is latched from within)
  {
    const bw = 1.0, bh = LAMPSIDE.door.height - 0.15;
    box(k, [bw, bh, 0.08], [0, bh / 2, -D - 0.03], (p, _n, o) => blend(o, K.timber, K.timberLight, (Math.floor((p.x + 5) * 6) & 1) * 0.35));
    for (const sx of [-1, 1]) box(k, [0.12, bh + 0.1, 0.14], [sx * (bw / 2 + 0.06), (bh + 0.1) / 2, -D - 0.04], K.stoneCap);
    box(k, [bw + 0.36, 0.14, 0.16], [0, bh + 0.07, -D - 0.05], K.stoneCap);
    if (lod) for (const y of [0.45, bh - 0.45]) box(k, [bw - 0.08, 0.06, 0.03], [0, y, -D - 0.085], K.iron);
    box(k, [bw + 0.3, 0.12, 0.42], [0, 0.04, -D - 0.21], K.stoneShade);
  }
  // the lamp beside the door, and (some houses) an awning of the Ward's stripes over it
  const dw = LAMPSIDE.door.width;
  bracketLamp(k, -(dw / 2 + 0.55), 2.45, D + 0.02, 0.42, out);
  if (h.awning) {
    k.add(new BoxGeometry(dw + 0.6, 0.07, 1.0, 1, 1, lod ? 4 : 1), { at: [0, LAMPSIDE.door.height + 0.45, D + 0.48], rot: [0.28, 0, 0], colour: (p, n, o) => stripes(seed)(new Vector3(p.z, p.y, p.x), n, o), flat: true, perFace: true });
    for (const s of [-1, 1]) k.limb([s * (dw / 2 + 0.25), LAMPSIDE.door.height + 0.62, D + 0.02], [s * (dw / 2 + 0.25), LAMPSIDE.door.height + 0.3, D + 0.95], 0.02, 0.02, K.iron, 3);
  }
  k.clearBase();
  // the sealed door, in the house's own frame (its local +x is the street face)
  k.setBase(h.x, gy, h.z, h.yaw);
  sealedDoor(k, `${lb.id}.door`, h.hx, 0, lb.door, lb.doorH, SEAL, lod, out.marks, { x: h.x, y: gy, z: h.z, yaw: h.yaw });
  k.clearBase();
}

/** A market stall: a counter on the customer's side, a backboard, four posts and an awning in the Ward's stripes falling toward the front, the goods (lamps, jars, a bolt of ward-blue cloth), and its lamp. */
function lampsideStall(k: Kit, st: LampsideStall, terrain: (x: number, z: number) => number, lod: Lod, out: KessarOut, i: number, goods: (k: Kit, W: number, D: number) => void = townGoods): void {
  const gy = terrain(st.x, st.z);
  k.setBase(st.x, gy, st.z, st.yaw - Math.PI / 2);
  const W = st.hz, D = st.hx, H = st.height;
  box(k, [W * 2 - 0.1, 0.95, 0.5], [0, 0.475, D - 0.3], K.timberLight);
  box(k, [W * 2, 0.06, 0.62], [0, 0.98, D - 0.3], K.timber);
  box(k, [W * 2 - 0.1, 1.7, 0.08], [0, 0.85, -D + 0.04], K.timber);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * (W - 0.07), -0.2, sz * (D - 0.07)], [sx * (W - 0.07), sz > 0 ? H + 0.07 : H + 0.45, sz * (D - 0.07)], 0.05, 0.045, K.timber, 5);
  const tilt = Math.atan2(0.45, D * 2);
  k.add(new BoxGeometry(W * 2 + 0.4, 0.06, D * 2 + 0.5, lod ? 6 : 1, 1, 1), { at: [0, H + 0.24, 0.05], rot: [tilt, 0, 0], colour: (p, n, o) => stripes(i)(new Vector3(p.z, p.y, p.x), n, o), flat: true, perFace: true });
  box(k, [W * 2 + 0.4, 0.2, 0.04], [0, H - 0.08, D + 0.29], (p, n, o) => stripes(i + 1)(new Vector3(p.z, p.y, p.x), n, o));
  if (lod) goods(k, W, D);
  bracketLamp(k, W - 0.07, H - 0.12, D - 0.07, 0.25, out);
  k.clearBase();
}

/** Lampside's stalls' goods on the counter (in the stall's frame: x along the counter, z out to the customer): brass lamps (the town's trade), clay jars, a bolt of ward-blue cloth. */
function townGoods(k: Kit, W: number, D: number): void {
  for (let g = 0; g < 3; g++) {
    const gx = -W + 0.45 + g * 0.42;
    k.add(new CylinderGeometry(0.07, 0.1, 0.2, 6), { at: [gx, 1.11, D - 0.3], colour: gold, flat: true });
    k.add(new CylinderGeometry(0.02, 0.02, 0.12, 4), { at: [gx + 0.08, 1.15, D - 0.3], rot: [0, 0, 1.1], colour: gold, flat: true });
  }
  for (let g = 0; g < 2; g++) k.add(new SphereGeometry(0.17, 7, 5), { at: [W - 0.45 - g * 0.4, 1.17, D - 0.32], scale: [1, 1.2, 1], colour: K.clay, flat: true });
  k.add(new CylinderGeometry(0.12, 0.12, 0.7, 8), { at: [0.1, 1.13, D - 0.28], rot: [0, 0, Math.PI / 2], colour: K.wardBlue, flat: true });
}

/** The town's well: a stone head with a dark shaft, a timber frame, its pulley, the rope and a bucket on the rim. */
function lampsideWell(k: Kit, w: { x: number; z: number; r: number; height: number }, terrain: (x: number, z: number) => number, lod: Lod): void {
  const gy = terrain(w.x, w.z);
  k.setBase(w.x, gy, w.z, 0.4);
  const radial = lod ? 14 : 8;
  k.add(new CylinderGeometry(w.r, w.r + 0.06, w.height + 0.3, radial, lod ? 2 : 1), { at: [0, (w.height - 0.3) / 2, 0], colour: masonry(470), flat: true, perFace: true });
  k.add(new CylinderGeometry(w.r + 0.06, w.r + 0.06, 0.12, radial), { at: [0, w.height + 0.06, 0], colour: K.stoneCap, flat: true });
  k.add(new CylinderGeometry(w.r - 0.16, w.r - 0.16, 0.02, radial), { at: [0, w.height + 0.13, 0], colour: K.stoneDark, flat: true });
  for (const s of [-1, 1]) k.limb([s * (w.r - 0.08), w.height, 0], [s * (w.r - 0.08), w.height + 1.55, 0], 0.07, 0.06, K.timber, 5);
  k.limb([-(w.r + 0.02), w.height + 1.5, 0], [w.r + 0.02, w.height + 1.5, 0], 0.06, 0.06, K.timber, 5);
  k.add(new CylinderGeometry(0.13, 0.13, 0.1, 8), { at: [0, w.height + 1.38, 0], rot: [Math.PI / 2, 0, 0], colour: K.timberLight, flat: true });
  // the rope from the pulley down to the bucket standing on the rim
  k.limb([0.12, w.height + 1.36, 0], [w.r - 0.12, w.height + 0.4, 0.2], 0.012, 0.012, K.timber, 3);
  k.add(new CylinderGeometry(0.15, 0.12, 0.26, 8), { at: [w.r - 0.12, w.height + 0.25, 0.2], colour: K.timber, flat: true });
  k.clearBase();
}

/** A lamp post where the street begins: an iron post on a stone foot, a bracket and the lamp. */
function lampsidePost(k: Kit, p: { x: number; z: number }, terrain: (x: number, z: number) => number, out: KessarOut, toward: number): void {
  const gy = terrain(p.x, p.z);
  k.setBase(p.x, gy, p.z, toward);
  box(k, [0.34, 0.3, 0.34], [0, 0.1, 0], K.stoneShade);
  k.limb([0, 0.2, 0], [0, 3.05, 0], 0.07, 0.05, K.iron, 6);
  k.add(new SphereGeometry(0.08, 6, 4), { at: [0, 3.1, 0], colour: gold });
  bracketLamp(k, 0, 2.95, 0, 0.42, out);
  k.clearBase();
}

/**
 * The garden walls: mud brick on a stone footing under a pale cap, one run at a time on its own ground; a square pier with a cap where a run meets a gate. Each run is drawn 3 cm
 * past both its ends and every other run 6 mm proud (thicker and taller): neighbours overlap without sharing a vertex or a face, so no seam shows, nothing flickers, and a
 * garden's ring of walls is a ring of runs (as one welded piece its box would hold the whole garden).
 */
function lampsideWalls(k: Kit, walls: readonly LampsideWall[], terrain: (x: number, z: number) => number, lod: Lod): void {
  const Wl = LAMPSIDE.wall;
  walls.forEach((w, i) => {
    const gy = terrain(w.x, w.z);
    k.setBase(w.x, gy, w.z, w.yaw);
    const len = w.hx * 2 + 0.06;
    const e = (i & 1) * 0.006;
    box(k, [len, 0.42 + e, Wl.half * 2 + 0.1 + e], [0, e / 2, 0], K.stoneShade);
    k.add(new BoxGeometry(len, Wl.height - 0.2, Wl.half * 2 + e, lod ? Math.max(1, Math.round(len / 0.6)) : 1, lod ? 4 : 1, 1), { at: [0, 0.1 + (Wl.height - 0.2) / 2, 0], colour: mudBrick(500 + i), flat: true, perFace: true });
    box(k, [len, 0.1 + e, Wl.half * 2 + 0.08 + e], [0, Wl.height - 0.05 + e / 2, 0], K.sandPale);
    for (const e of w.piers) {
      const px = e * (w.hx - Wl.pierHalf + 0.03);   // (3 cm past the run's end, so the run's end face is inside the pier, not flush with its face)
      box(k, [Wl.pierHalf * 2, Wl.pier, Wl.pierHalf * 2], [px, Wl.pier / 2 - 0.1, 0], masonry(520 + i));
      box(k, [Wl.pierHalf * 2 + 0.12, 0.1, Wl.pierHalf * 2 + 0.12], [px, Wl.pier - 0.05, 0], K.stoneCap);
    }
  });
  k.clearBase();
}

/** Lampside, everything solid: the houses, the stalls, the well, the street's two lamp posts, the garden walls. */
function lampside(k: Kit, terrain: (x: number, z: number) => number, lod: Lod, out: KessarOut): void {
  const plan = lampsidePlan();
  plan.houses.forEach((h, i) => lampsideHouse(k, h, terrain, lod, out, 600 + i * 11));
  plan.stalls.forEach((st, i) => lampsideStall(k, st, terrain, lod, out, i));
  lampsideWell(k, plan.well, terrain, lod);
  // (each post's bracket reaches over the street)
  for (const p of plan.posts) lampsidePost(k, p, terrain, out, p.x < 0 ? -Math.PI / 2 : Math.PI / 2);
  lampsideWalls(k, plan.walls, terrain, lod);
}

// ---- the Relic Works (D-129): antiquities made to order on the west beach -----------------------------------------------------------

/** The stall's goods: two banded amphorae, three figurines, two clay tablets leaning on the backboard's side, and on its own plinth the bust of an ancient king in a pith helmet. */
function relicGoods(k: Kit, W: number, D: number): void {
  const top = 1.01;
  const z = D - 0.3;
  for (let g = 0; g < 2; g++) {
    const gx = -W + 0.35 + g * 0.4;
    k.add(new SphereGeometry(0.15, 8, 6), { at: [gx, top + 0.21, z], scale: [1, 1.4, 1], colour: K.clay, flat: true });
    k.add(new CylinderGeometry(0.152, 0.152, 0.05, 8), { at: [gx, top + 0.22, z], colour: K.roofDark, flat: true });
    k.add(new CylinderGeometry(0.05, 0.06, 0.13, 6), { at: [gx, top + 0.46, z], colour: K.clay, flat: true });
    for (const sx of [-1, 1]) k.limb([gx + sx * 0.05, top + 0.47, z], [gx + sx * 0.13, top + 0.34, z], 0.016, 0.016, K.clay, 3);
  }
  for (let g = 0; g < 3; g++) {
    const gx = -0.25 + g * 0.2;
    k.add(new CylinderGeometry(0.035, 0.05, 0.17, 6), { at: [gx, top + 0.085, z + 0.05], colour: K.stoneShade, flat: true });
    k.add(new SphereGeometry(0.045, 6, 4), { at: [gx, top + 0.2, z + 0.05], colour: K.stoneShade, flat: true });
  }
  for (let g = 0; g < 2; g++) box(k, [0.22, 0.28, 0.04], [0.32 + g * 0.27, top + 0.14, z - 0.12], K.clay, [-0.22, 0, 0]);
  // the king: terracotta on a pale plinth, moustached, in a whitewashed pith helmet (what the Society wants to find, it finds)
  const bx = W - 0.33;
  box(k, [0.26, 0.14, 0.26], [bx, top + 0.07, z], K.stoneCap);
  box(k, [0.34, 0.15, 0.2], [bx, top + 0.215, z], K.clay);
  k.add(new CylinderGeometry(0.05, 0.06, 0.08, 6), { at: [bx, top + 0.32, z], colour: K.clay, flat: true });
  k.add(new SphereGeometry(0.105, 8, 6), { at: [bx, top + 0.43, z], scale: [0.95, 1.05, 1], colour: K.clay, flat: true });
  // a nose, and the moustache in two waxed halves swept down and out
  box(k, [0.035, 0.05, 0.04], [bx, top + 0.43, z + 0.1], K.clay);
  for (const sx of [-1, 1]) box(k, [0.075, 0.022, 0.03], [bx + sx * 0.04, top + 0.397, z + 0.098], K.timber, [0, 0, sx * -0.35]);
  k.add(new SphereGeometry(0.125, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), { at: [bx, top + 0.46, z], scale: [1, 0.9, 1.08], colour: K.wardCream, flat: true });
  k.add(new CylinderGeometry(0.19, 0.19, 0.02, 10), { at: [bx, top + 0.46, z], scale: [1, 1, 1.12], colour: K.wardCream, flat: true });
}

/** The kiln: a square of mud brick with a pale cap, its firing mouth to the east (dark, the embers red in it, a timber lintel) and its flue rising at the back. The mouth glows at night. */
function relicKiln(k: Kit, kn: { x: number; z: number; half: number; height: number; flue: number }, terrain: (x: number, z: number) => number, lod: Lod, out: KessarOut): void {
  const gy = terrain(kn.x, kn.z);
  k.setBase(kn.x, gy, kn.z, 0);
  const s = kn.half * 2, H = kn.height, drop = 0.3;
  k.add(new BoxGeometry(s, H - 0.1 + drop, s, lod ? 3 : 1, lod ? 6 : 1, lod ? 3 : 1), { at: [0, (H - 0.1 - drop) / 2, 0], colour: mudBrick(560), flat: true, perFace: true });
  box(k, [s + 0.08, 0.1, s + 0.08], [0, H - 0.05, 0], K.sandPale);
  // (local +x is east: the mouth's face)
  box(k, [0.04, 0.58, 0.64], [kn.half + 0.01, 0.5, 0], K.stoneDark);
  box(k, [0.04, 0.24, 0.46], [kn.half + 0.02, 0.33, 0], K.wardRed);
  box(k, [0.12, 0.1, 0.9], [kn.half + 0.04, 0.84, 0], K.timber);
  const fl = kn.flue - H;
  k.add(new BoxGeometry(0.5, fl + 0.05, 0.5, 1, lod ? 3 : 1, 1), { at: [-kn.half + 0.4, H + fl / 2 - 0.025, 0], colour: mudBrick(570), flat: true, perFace: true });
  box(k, [0.6, 0.08, 0.6], [-kn.half + 0.4, kn.flue + 0.04, 0], K.sandPale);
  if (lod) box(k, [0.3, 0.04, 0.3], [-kn.half + 0.4, kn.flue + 0.1, 0], K.stoneDark);
  const f = k.worldPoint(kn.half + 0.06, 0.45, 0);
  out.lamps.push({ x: f[0], y: f[1], z: f[2] });
  k.clearBase();
}

/** An ageing bed: a heap of sand over two rows of buried pots, only their mouths showing (a few dug half out, ripe), and a stake with a paper tag at its north end. */
function relicBed(k: Kit, b: RelicBed, terrain: (x: number, z: number) => number, lod: Lod, i: number): void {
  const gy = terrain(b.x, b.z);
  k.setBase(b.x, gy, b.z, 0);
  const drop = 0.3;
  k.add(new BoxGeometry(b.hx * 2, b.height - 0.1 + drop, b.hz * 2, 1, 1, lod ? 6 : 1), { at: [0, (b.height - 0.1 - drop) / 2, 0], colour: (p, n, o) => blend(o, K.sand, K.sandWet, n.y > 0.6 ? 0.1 : 0.45 + h01(700 + i, Math.floor((p.z + 9) / 1.4)) * 0.2), flat: true, perFace: true });
  box(k, [b.hx * 2 - 0.22, 0.1, b.hz * 2 - 0.22], [0, b.height - 0.05, 0], K.sand);
  if (lod) {
    for (const lx of [-0.32, 0.32]) {
      for (let j = 0, z = -b.hz + 0.5; z < b.hz - 0.3; z += 0.75, j++) {
        const ripe = h01(710 + i, j, lx > 0 ? 1 : 0) > 0.86;
        const y = b.height;
        if (ripe) {
          // dug half out: the shoulder above the sand, the neck and the lip
          k.add(new SphereGeometry(0.14, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), { at: [lx, y - 0.02, z], colour: K.clay, flat: true });
          k.add(new CylinderGeometry(0.06, 0.07, 0.12, 7), { at: [lx, y + 0.17, z], colour: K.clay, flat: true });
          k.add(new CylinderGeometry(0.085, 0.085, 0.03, 7), { at: [lx, y + 0.24, z], colour: K.roofDark, flat: true });
        } else {
          k.add(new CylinderGeometry(0.11, 0.13, 0.05, 7), { at: [lx, y + 0.02, z], colour: K.clay, flat: true });
          k.add(new CylinderGeometry(0.075, 0.075, 0.012, 7), { at: [lx, y + 0.045, z], colour: K.stoneDark, flat: true });
        }
      }
    }
  }
  k.limb([0, b.height - 0.1, -b.hz + 0.12], [0, b.height + 0.62, -b.hz + 0.12], 0.025, 0.022, K.timber, 4);
  box(k, [0.22, 0.14, 0.02], [0, b.height + 0.5, -b.hz + 0.1], K.wardCream);
  k.clearBase();
}

/** The drying shelf against the works' south gable: two trestles, two planks, new pots and bowls drying pale (unfired) in the sun. */
function relicShelf(k: Kit, sh: { x: number; z: number; hx: number; hz: number; height: number }, terrain: (x: number, z: number) => number, lod: Lod): void {
  const gy = terrain(sh.x, sh.z);
  k.setBase(sh.x, gy, sh.z, 0);
  const H = sh.height;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * (sh.hx - 0.15), -0.1, sz * (sh.hz - 0.06)], [sx * (sh.hx - 0.15), H - 0.06, sz * (sh.hz - 0.06)], 0.035, 0.035, K.timber, 4);
  box(k, [sh.hx * 2, 0.06, sh.hz * 2], [0, H - 0.03, 0], K.timberLight);
  box(k, [sh.hx * 2 - 0.1, 0.05, sh.hz * 2 - 0.08], [0, 0.36, 0], K.timberLight);
  if (lod) {
    for (let g = 0; g < 7; g++) {
      const gx = -sh.hx + 0.25 + g * 0.42;
      const r = 0.1 + h01(720, g) * 0.06;
      k.add(new SphereGeometry(r, 7, 5), { at: [gx, H + r * 1.1, 0], scale: [1, 1.25, 1], colour: K.sandPale, flat: true });
      k.add(new CylinderGeometry(r * 0.4, r * 0.48, 0.1, 6), { at: [gx, H + r * 2.45 + 0.04, 0], colour: K.sandPale, flat: true });
    }
    for (let g = 0; g < 4; g++) k.add(new CylinderGeometry(0.15, 0.1, 0.1, 8), { at: [-sh.hx + 0.45 + g * 0.7, 0.435, 0], colour: K.stoneCap, flat: true });
  }
  k.clearBase();
}

/** The Relic Works, everything solid: the works (a Lampside house by type), its kiln, the ageing yard's walls and beds, the drying shelf, the stall and the two boards. */
function relicWorks(k: Kit, terrain: (x: number, z: number) => number, lod: Lod, out: KessarOut): void {
  const plan = relicPlan();
  lampsideHouse(k, plan.works, terrain, lod, out, 640, `relic.${plan.works.id}`);
  relicKiln(k, plan.kiln, terrain, lod, out);
  lampsideWalls(k, plan.yard.walls, terrain, lod);
  plan.beds.forEach((b, i) => relicBed(k, b, terrain, lod, i));
  relicShelf(k, plan.shelf, terrain, lod);
  lampsideStall(k, plan.stall, terrain, lod, out, 3, relicGoods);
  for (const b of plan.boards) signpost(k, b, terrain);
}

/** Everything solid, merged. `collapsed` swaps the bridge for its stumps; `lod` 0 is the cheap shape the ink hull and the low preset use. */
export function buildKessarSolid(world: CollisionWorld, lod: Lod): { geometry: BufferGeometry | undefined; collapsed: boolean; marks: DoorMark[]; lamps: { x: number; y: number; z: number; lit?: number }[]; roofs: RoofSource | undefined; panes: LitPane[] } {
  const plan = kessarPlan();
  const terrain = (x: number, z: number): number => world.terrainHeight(x, z);
  const intact = world.obstacles.some((o) => o.tag === "bridge" && o.kind === "box");
  const k = new Kit();
  const out: KessarOut = { marks: [], lamps: [], roofs: new RoofKits(), panes: [] };
  const f = plan.fort;
  f.wall.forEach((s, i) => wallSegment(k, s, terrain(s.x, s.z), lod, 10 + (i % 7)));
  f.towers.forEach((t, i) => roundTower(k, t.x, t.z, t.r, t.height, terrain(t.x, t.z), lod, 20 + i));
  gatehouse(k, plan, terrain, lod, out);
  keep(k, plan, terrain, lod, out.panes);
  for (const c of f.cannons) {
    // on the wall walk of the segment it stands on (the walk is level at that segment's ground + wall height; the hill under the cannon is higher)
    const seg = f.wall.reduce((a, s) => (Math.hypot(s.x - c.x, s.z - c.z) < Math.hypot(a.x - c.x, a.z - c.z) ? s : a));
    cannon(k, c, terrain(seg.x, seg.z) + KESSAR.wallHeight, lod);
  }
  bridge(k, plan, intact, lod, terrain);
  rim(k, plan, terrain, lod);
  tollStation(k, plan, terrain, lod, out);
  signposts(k, plan, terrain);
  banners(k, plan, terrain);
  pier(k, plan, lod);
  camps(k, plan, terrain, lod);
  lampside(k, terrain, lod, out);
  relicWorks(k, terrain, lod, out);
  k.clearBase();
  return { geometry: k.build(), collapsed: !intact, marks: out.marks, lamps: out.lamps, roofs: out.roofs.finish(), panes: out.panes };
}
