import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Shape, SphereGeometry } from "three";
import { PALETTE, hash3, kessarLevel, type CollisionWorld } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { RoofKits, interiorShell, sealedDoor, type DoorMark, type RoofSource, type SealedStyle, type ShellStyle } from "../rooms.ts";
import { cart, tent } from "../landmarks.ts";
import { crateParts } from "../objects.ts";
import { KESSAR, KESSAR_ANCHORS as A, kessarPlan, type WallSeg } from "./shared.ts";

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
  }
}

function keep(k: Kit, plan: ReturnType<typeof kessarPlan>, gy: (x: number, z: number) => number, lod: Lod): void {
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
    for (let i = 0; i < 5; i++) box(k, [0.4, 1.2, 0.3], [-4 + i * 2, 5 + (i % 2) * 4, kp.hz + 0.05], K.timber);
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

function bridge(k: Kit, plan: ReturnType<typeof kessarPlan>, intact: boolean, lod: Lod): void {
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
      for (const e of [-1, 1]) {
        k.limb([px, 0, e * (span / 2 - 0.4)], [px, 2.6, e * (span / 2 - 0.4)], 0.13, 0.1, K.iron, 5);
        k.add(new SphereGeometry(0.3, 7, 5), { at: [px, 2.85, e * (span / 2 - 0.4)], colour: gold });
      }
    }
  }
  // piers: standing under the deck, or the stumps the charge left
  const stumpTop = intact ? L - 0.8 : L - 2.4;
  for (const p of b.piers) {
    k.setBase(p.x, bed - 0.5, p.z, 0);
    const h = stumpTop - (bed - 0.5);
    k.add(new CylinderGeometry(p.r, p.r * 1.15, h, lod ? 10 : 6), { at: [0, h / 2, 0], colour: masonry(36), flat: true, perFace: true });
    if (!intact) for (let i = 0; i < 4; i++) box(k, [0.5, 0.7, 0.6], [Math.cos(i * 1.7) * 0.9, h + 0.15, Math.sin(i * 1.7) * 0.9], K.stoneShade, [0.3 * i, i, 0.2]);
  }
  k.clearBase();
  if (!intact) {
    // broken deck lying in the water
    for (let i = 0; i < 4; i++) {
      const x = b.x + (i - 1.5) * 1.9;
      const z = A.bridge.z + (i % 2 ? 3.4 : -3.1);
      box(k, [2.2, 0.55, 1.6], [x, bed + 0.35, z], masonry(37 + i), [0.15 * i, i * 0.9, 0.2 - 0.1 * i]);
    }
  }
}

// ---- the rim wall, the toll station, the landing, the camps --------------------------------------------------------------------------

function rim(k: Kit, plan: ReturnType<typeof kessarPlan>, terrain: (x: number, z: number) => number, lod: Lod, collapsed: boolean): void {
  const segs = collapsed ? [...plan.rim, ...plan.stubs] : plan.rim;
  for (const [i, s] of segs.entries()) {
    const y = terrain(s.x, s.z);
    k.setBase(s.x, y, s.z, s.yaw);
    const h = KESSAR.rimHeight + 0.4;
    slab(k, [s.hx * 2, h, s.hz * 2], [0, h / 2 - 0.4 + 0.0, 0], masonry(200 + (i % 9)), lod, undefined, true);
    if (lod) box(k, [s.hx * 2 + 0.05, 0.16, s.hz * 2 + 0.3], [0, KESSAR.rimHeight - 0.4 + 0.08 + 0.4, 0], K.stoneCap);
  }
  k.clearBase();
}

/** The toll booth's inside: cream lime-wash, a plank floor, an iron-strapped door; and the Ward's seals on the gate. */
const BOOTH: ShellStyle = { outer: K.stone, inner: K.wardCream, floor: K.timberLight, floorDark: K.timber, trim: K.timber, leaf: K.timber, strap: K.iron, lamp: K.lampGold, ceiling: K.timber };
const SEAL: SealedStyle = { frame: K.stoneShade, door: K.timber, board: K.timberLight, boardDark: K.timber, iron: K.iron, brass: K.lampGold, paper: K.wardCream, wax: K.wardRed };

interface KessarOut {
  marks: DoorMark[];
  lamps: { x: number; y: number; z: number }[];
  roofs: RoofKits;
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
  out.lamps.push({ x: lw[0], y: lw[1], z: lw[2] });
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

function signposts(k: Kit, plan: ReturnType<typeof kessarPlan>, terrain: (x: number, z: number) => number): void {
  for (const s of plan.signs) {
    const y = terrain(s.x, s.z);
    k.setBase(s.x, y, s.z, s.yaw);
    k.limb([0, -0.3, 0], [0, 2.3, 0], 0.09, 0.07, K.timber, 5);
    // (local +x is the board's FACE direction, so the board runs along local z)
    box(k, [0.09, 0.52, 2.5], [0, 1.85, 0], K.wardCream);
    box(k, [0.12, 0.06, 2.6], [0, 2.14, 0], K.timberLight);
    box(k, [0.12, 0.06, 2.6], [0, 1.56, 0], K.timberLight);
  }
  k.clearBase();
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

/** Everything solid, merged. `collapsed` swaps the bridge for its stumps; `lod` 0 is the cheap shape the ink hull and the low preset use. */
export function buildKessarSolid(world: CollisionWorld, lod: Lod): { geometry: BufferGeometry | undefined; collapsed: boolean; marks: DoorMark[]; lamps: { x: number; y: number; z: number }[]; roofs: RoofSource | undefined } {
  const plan = kessarPlan();
  const terrain = (x: number, z: number): number => world.terrainHeight(x, z);
  const intact = world.obstacles.some((o) => o.tag === "bridge" && o.kind === "box");
  const k = new Kit();
  const out: KessarOut = { marks: [], lamps: [], roofs: new RoofKits() };
  const f = plan.fort;
  f.wall.forEach((s, i) => wallSegment(k, s, terrain(s.x, s.z), lod, 10 + (i % 7)));
  f.towers.forEach((t, i) => roundTower(k, t.x, t.z, t.r, t.height, terrain(t.x, t.z), lod, 20 + i));
  gatehouse(k, plan, terrain, lod, out);
  keep(k, plan, terrain, lod);
  for (const c of f.cannons) {
    // on the wall walk of the segment it stands on (the walk is level at that segment's ground + wall height; the hill under the cannon is higher)
    const seg = f.wall.reduce((a, s) => (Math.hypot(s.x - c.x, s.z - c.z) < Math.hypot(a.x - c.x, a.z - c.z) ? s : a));
    cannon(k, c, terrain(seg.x, seg.z) + KESSAR.wallHeight, lod);
  }
  bridge(k, plan, intact, lod);
  rim(k, plan, terrain, lod, !intact);
  tollStation(k, plan, terrain, lod, out);
  signposts(k, plan, terrain);
  banners(k, plan, terrain);
  pier(k, plan, lod);
  camps(k, plan, terrain, lod);
  k.clearBase();
  return { geometry: k.build(), collapsed: !intact, marks: out.marks, lamps: out.lamps, roofs: out.roofs.finish() };
}
