import { BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, SphereGeometry } from "three";
import { CLOISTER, PALETTE, VESPER_TRIG, hash3, vesperLevel, type CollisionWorld } from "./shared.ts";
import { pane, type LitPane } from "../litWindows.ts";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { RoofKits, interiorShell, sealedDoor, tentFlap, type DoorMark, type RoofSource, type SealedStyle, type ShellStyle } from "../rooms.ts";
import { PLAQUE } from "../plaques.ts";
import { vesperPlan, type VesperBox, type VesperPlan } from "./shared.ts";

/**
 * The buildings and small works of Vesper Gorge, merged by `buildVesperSolid` (solid.ts) into ONE vertex-coloured geometry: the Long Cloister (a gallery of arches cut into the west cliff, hung with crepe,
 * with its bell-gable), the Assay House (stone below, plaster above, a pair of scales on the roof, a furnace stack), the foreman's office, the powder magazine, the Company's timber stack, the winding house,
 * the Syndicate's striped tents, ore carts and spoil heaps, the lamps, and the rock needles on the plateau. Everything is placed from `vesperPlan()` and the terrain: the box you see is the box you bump into.
 * Palette colours only (`PALETTE.vesper`). No dome, minaret or script; the Guild's emblem is a bell, the Company's a pick and hammer, the Syndicate's a monogram.
 */

const P = PALETTE.vesper;
export const h01 = (seed: number, a: number, b = 0, c = 0): number => hash3(seed, a, b, c) / 4294967296;

/** Courses of cut stone: rows 0.6 m high, blocks ~1.5 m long, each a shade of its own; caps pale, undersides dark. */
export const stone = (seed: number, base: number = P.strataBone, shade: number = P.strataBuff): ColourFn => (p, n, out) => {
  if (n.y > 0.6) {
    out.set(P.chalk);
    return;
  }
  if (n.y < -0.6) {
    out.set(P.strataShade);
    return;
  }
  const row = Math.floor(p.y / 0.6);
  const col = Math.floor((p.x + p.z) / 1.5 + (row & 1) * 0.5);
  blend(out, base, shade, h01(seed, row, col) * 0.85);
  if (h01(seed + 7, row, col) > 0.93) blend(out, P.strataBuff, P.strataRust, 0.5);
};

/** Upright planks, each its own brown. */
export const planks = (seed: number, base: number = P.timber, light: number = P.timberLight): ColourFn => (p, n, out) => {
  const i = Math.floor((p.x + p.z) / 0.28);
  blend(out, base, light, h01(seed, i) * 0.7 + (n.y > 0.5 ? 0.25 : 0));
};

/** Corrugated iron: ribs along local x. */
export const corrugated: ColourFn = (p, n, out) => {
  const rib = (Math.floor((p.x + p.z * 0.4) * 3.2) & 1) * 0.5;
  blend(out, P.iron, P.ironLight, Math.max(0, n.y) * 0.45 + rib * 0.4);
};

export const box = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

/** A stone slab cut into courses (finer subdivision at lod 1 so the colour function has rows to bite on). */
export function slab(k: Kit, size: V3, at: V3, colour: number | ColourFn, lod: Lod, rot?: V3): void {
  const fine = lod > 0;
  const sx = fine ? Math.min(8, Math.max(1, Math.round(size[0] / 1.5))) : 1;
  const sy = fine ? Math.min(14, Math.max(1, Math.round(size[1] / 0.6))) : 1;
  const sz = fine ? Math.min(10, Math.max(1, Math.round(size[2] / 1.5))) : 1;
  k.add(new BoxGeometry(size[0], size[1], size[2], sx, sy, sz), { at, rot, colour, flat: true, perFace: typeof colour !== "number" });
}

/** A gable roof (ridge along local x): `hx`/`hz` half the eave extents, `h` the rise; the gable ends are closed. */
export function gable(k: Kit, hx: number, hz: number, h: number, at: V3, colour: ColourFn | number = corrugated): void {
  const v = [
    [-hx, 0, -hz], [hx, 0, -hz], [hx, h, 0], [-hx, h, 0],
    [hx, 0, hz], [-hx, 0, hz], [-hx, h, 0], [hx, h, 0],
    [-hx, 0, hz], [-hx, 0, -hz], [-hx, h, 0],
    [hx, 0, -hz], [hx, 0, hz], [hx, h, 0],
  ];
  const idx = [0, 3, 2, 0, 2, 1, 4, 7, 6, 4, 6, 5, 8, 10, 9, 11, 13, 12];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(idx.flatMap((i) => v[i]!)), 3));
  g.computeVertexNormals();
  k.add(g, { at, colour, flat: true, perFace: typeof colour !== "number" });
}

/** A pyramid roof over a square footprint of half-side `r`. */
export function pyramid(k: Kit, r: number, h: number, at: V3, colour: ColourFn | number = corrugated): void {
  k.add(new ConeGeometry(r * Math.SQRT2, h, 4, 1), { at: [at[0], at[1] + h / 2, at[2]], rot: [0, Math.PI / 4, 0], colour, flat: true, perFace: typeof colour !== "number" });
}

/**
 * Which way a building faces: the base yaw and the local half-extents that place local +z on the door side. `face` is the direction the door looks (world axes): "e" +x, "w" -x, "s" +z, "n" -z.
 */
export function frame(b: VesperBox, face: "n" | "e" | "s" | "w"): { yaw: number; lx: number; lz: number } {
  switch (face) {
    case "s": return { yaw: 0, lx: b.hx, lz: b.hz };
    case "n": return { yaw: Math.PI, lx: b.hx, lz: b.hz };
    case "w": return { yaw: Math.PI / 2, lx: b.hz, lz: b.hx };
    case "e": return { yaw: -Math.PI / 2, lx: b.hz, lz: b.hx };
  }
}

// ---- the Long Cloister ----------------------------------------------------------------------------------------------------------------------

/** The Records Room's inside: lime-wash the colour of old paper, plank floor, ledger shelves. The sealed buildings' boards and chain. */
const RECORDS: ShellStyle = { outer: P.strataBone, inner: P.companyCream, floor: P.timberLight, floorDark: P.timber, trim: P.timber, leaf: P.timber, strap: P.iron, lamp: P.glowLamp, ceiling: P.timber };
const SEAL: SealedStyle = { frame: P.chalk, door: P.timber, board: P.timberLight, boardDark: P.timber, iron: P.iron, brass: P.copper, paper: P.companyCream, wax: P.companyRed };

/**
 * The block a sealed door's notice is nailed to (in the building's level frame, door face at `hx`): the cloth's plaque (`pushPlaques`) stands 0.3 m proud of the wall, clear of the door's boards, so without
 * this it hung in front of them. A backing board just behind the plaque (a rim wider than it), held off the crossed boards by two blocks.
 */
function notice(k: Kit, hx: number, floor: number, doorH: number): void {
  const y = floor + 0.08 + doorH * 0.62;
  box(k, [0.04, PLAQUE.hh * 2 + 0.06, PLAQUE.hw * 2 + 0.08], [hx + 0.275, y, 0], P.timber);
  for (const s of [-1, 1]) box(k, [0.16, 0.2, 0.12], [hx + 0.18, y, s * (PLAQUE.hw - 0.2)], P.timber);
}

/** What the buildings leave behind for the view: the doors drawn, the lamps burning inside, the roofs for the cutaway. */
export interface VesperOut {
  marks: DoorMark[];
  roofs: RoofKits;
  /** D-089: the buildings' windows (the Assay House, the foreman's ledger window, the winding house, which works nights). */
  panes: LitPane[];
}

/**
 * The Long Cloister (D-038): an `open-front` gallery. A mass of the cliff's own rock behind, a colonnade of eight broad piers with seven arches 2.4 m clear between them, a lit corridor 3.1 m deep behind the arches
 * (a pavement that follows the ground, a lantern at every pier, crepe swagged across the openings), and at its north end the Records Room (a door 1.5 m wide, ledger shelves, a desk). The flat roof over the
 * corridor and the Records Room's own roof are separate (the cutaway lifts the one over the viewer); the bell-gable stands over the cliff's mass. Drawn from the same constants as the collision.
 */
function cloister(k: Kit, world: CollisionWorld, lod: Lod, glows: { x: number; y: number; z: number; lit?: number }[], out: VesperOut): void {
  const c = vesperPlan().cloister;
  const C = CLOISTER;
  const gy = world.terrainHeight(c.x, c.z);
  const H = c.height;
  const z0 = c.z - c.hz, z1 = c.z + c.hz;
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  k.setBase(0, 0, 0, 0);   // (world frame: x east, z south; every height is read from the terrain where its part stands)
  // the cliff's mass behind the gallery, and the corridor's south end
  const mx = (c.x - c.hx + C.backX) / 2;
  slab(k, [C.backX - (c.x - c.hx), H + 0.8, c.hz * 2], [mx, gy + (H - 0.8) / 2, c.z], stone(210), lod);
  slab(k, [C.pierIn - C.backX, H, 0.3], [(C.backX + C.pierIn) / 2, g((C.backX + C.pierIn) / 2, z1) + H / 2, z1 - 0.15], stone(211), lod);
  // the colonnade: eight piers, a lintel over every arch (the openings are 2.4 clear and 3.7 high), pilasters, the cornice and the parapet along the face
  const pitch = C.pierW + C.archClear;
  const fx = (C.pierIn + C.frontX) / 2;
  for (let i = 0; i <= C.arches; i++) {
    const zc = z0 + C.pierW / 2 + i * pitch;
    slab(k, [C.frontX - C.pierIn, H + 0.8, C.pierW], [fx, g(fx, zc) + (H - 0.8) / 2, zc], stone(212 + (i % 3)), lod);
    k.limb([C.frontX + 0.12, g(C.frontX, zc), zc], [C.frontX + 0.12, g(C.frontX, zc) + H - 0.2, zc], 0.3, 0.26, P.chalk, lod ? 8 : 5);
    k.add(new SphereGeometry(0.2, 6, 4), { at: [C.frontX + 0.12, g(C.frontX, zc) + H - 0.1, zc], colour: P.strataBone, flat: true });
  }
  for (let i = 0; i < C.arches; i++) {
    const zc = z0 + C.pierW + C.archClear / 2 + i * pitch;
    const yg = g(fx, zc);
    const hArch = 3.7;
    slab(k, [C.frontX - C.pierIn, H - hArch + 0.1, C.archClear], [fx, yg + hArch + (H - hArch) / 2, zc], stone(220 + i), lod);
    // the voussoirs' keystone, the sill, the crepe swag and two streamers
    box(k, [0.5, 0.5, 0.34], [C.frontX + 0.05, yg + hArch + 0.15, zc], P.chalk);
    // the Guild's black crepe, hung as a valance under the lintel: a band and a fringe of tabs (no legs, nothing in the opening below head height)
    box(k, [0.1, 0.3, C.archClear + 0.05], [C.frontX + 0.22, yg + hArch - 0.18, zc], P.crepeFold);
    if (lod) for (let t = 0; t < 5; t++) box(k, [0.08, 0.22, 0.3], [C.frontX + 0.24, yg + hArch - 0.44, zc - C.archClear / 2 + 0.25 + t * ((C.archClear - 0.5) / 4)], P.crepe);
    // the forecourt's paving at the arch (flat: no step the collision lacks)
    box(k, [1.4, 0.05, C.archClear + 0.5], [C.frontX + 0.7, yg + 0.03, zc], P.chalk);
  }
  box(k, [1.6, 0.3, c.hz * 2 + 0.6], [C.frontX - 0.4, gy + H - 0.05, c.z], P.chalk);
  // the corridor's pavement: a tile a pier-bay long, each on the ground where it stands
  for (let i = 0; i < 6; i++) {
    const zc = C.recordsZ1 + 2.4 + i * 4.8;
    const px = (C.backX + C.pierIn) / 2;
    box(k, [C.pierIn - C.backX, 0.06, 4.7], [px, g(px, zc) + 0.02, zc], i % 2 ? P.strataBuff : P.strataBone);
    // a lantern on a wrought bracket from the back wall at every second bay: the corridor is lit. (It hung from the roof's beam, and the roof is lifted while the
    // viewer is in the gallery: the chains were left hanging from nothing.) The chain runs from the bracket's end into the lamp's iron cap, which sits on the glass.
    if (i % 2 === 0) {
      const lx = C.backX + 0.7;
      const ly = g(lx, zc) + 2.7;
      k.limb([C.backX - 0.05, ly + 0.62, zc], [lx + 0.04, ly + 0.62, zc], 0.025, 0.02, P.iron, 4);
      k.limb([C.backX - 0.05, ly + 0.15, zc], [C.backX + 0.45, ly + 0.6, zc], 0.018, 0.015, P.iron, 4);   // (its brace)
      k.limb([lx, ly + 0.63, zc], [lx, ly + 0.16, zc], 0.012, 0.012, P.iron, 3);
      k.add(new CylinderGeometry(0.05, 0.09, 0.07, 6), { at: [lx, ly + 0.14, zc], colour: P.iron, flat: true });
      k.add(new SphereGeometry(0.13, 6, 4), { at: [lx, ly, zc], colour: P.glowLamp });
      glows.push({ x: lx, y: ly, z: zc, lit: 0.45 });   // (a lamp under a roof burns bright even at noon, so the gallery is seen to be lit from the forecourt)
    }
  }
  // the roof over the corridor (flat stone, a parapet each side): its own piece, lifted while the viewer is in the gallery
  const rk = out.roofs.begin("cloister");
  rk.setBase(0, 0, 0, 0);
  const rx = (C.backX + C.frontX) / 2;
  const rz = (C.recordsZ1 + C.southEnd) / 2;
  const rl = C.southEnd - C.recordsZ1 + 0.3;
  box(rk, [C.frontX - C.backX + 0.6, 0.4, rl], [rx, gy + H + 0.0, rz], (p, n, o2) => (n.y < -0.5 ? o2.set(P.timberLight) : n.y > 0.5 ? o2.set(P.chalk) : o2.set(P.strataBone)));
  box(rk, [0.3, 0.55, rl], [C.frontX - 0.1, gy + H + 0.4, rz], P.strataBone);
  box(rk, [0.3, 0.55, rl], [C.backX + 0.2, gy + H + 0.4, rz], P.strataBone);
  // the Records Room at the north end
  const lb = vesperLevel().buildings.find((x) => x.id === "records")!;
  const rg = g(lb.x, lb.z);
  k.setBase(lb.x, rg, lb.z, lb.yaw);
  interiorShell(k, { id: lb.id, hx: lb.hx, hz: lb.hz, floor: lb.floor, wallH: lb.wallH, door: lb.door, doorH: lb.doorH, steps: 0, t: lb.t ?? 0.3 }, { ...RECORDS, outer: stone(230) }, lod, out.marks, { x: lb.x, y: rg, z: lb.z, yaw: lb.yaw });
  const fl = lb.floor;
  // ledger shelves floor to ceiling along both long walls, a clerk's desk and stool at the far end, a lantern
  for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) {
    const x = -lb.hx + 1.4 + i * 1.6;
    box(k, [1.4, 3.2, 0.34], [x, fl + 1.6, sz * (lb.hz - 0.5)], P.timber);
    // (the ledgers' spines stand proud of the shelf's face: they were drawn at the shelf's own depth, inside its box, and the shelves read as bare dark boards)
    for (let j = 0; j < 4; j++) box(k, [1.3, 0.34, 0.26], [x, fl + 0.5 + j * 0.8, sz * (lb.hz - 0.5) - sz * 0.2], [P.companyRed, P.crepe, P.copper, P.strataRust][(i + j) % 4]!);
  }
  box(k, [0.8, 0.08, 1.4], [-lb.hx + 0.8, fl + 0.9, 0], P.timberLight);
  box(k, [0.7, 0.9, 0.08], [-lb.hx + 0.8, fl + 0.45, 0.66], P.timber);
  box(k, [0.7, 0.9, 0.08], [-lb.hx + 0.8, fl + 0.45, -0.66], P.timber);
  box(k, [0.4, 0.45, 0.4], [-lb.hx + 1.5, fl + 0.22, 0.2], P.timber);
  const lw = k.worldPoint(-lb.hx * 0.15, fl + 2.3, 0);
  glows.push({ x: lw[0], y: lw[1], z: lw[2], lit: 0.7 });   // (the Records Room's lamp: visible through the door at any hour)
  const rrk = out.roofs.begin("records");
  rrk.setBase(0, 0, 0, 0);
  box(rrk, [C.pierIn - C.backX + 0.5, 0.4, C.recordsZ1 - C.recordsZ0 + 0.3], [(C.backX + C.pierIn) / 2, rg + fl + lb.wallH + 0.05, (C.recordsZ0 + C.recordsZ1) / 2], (p, n, o2) => (n.y < -0.5 ? o2.set(P.timberLight) : o2.set(P.chalk)));
  k.clearBase();
  // the bell-gable: a slim tower on the roof of the cliff's mass with an open belfry and a bell of copper, a crepe-black roof
  // (its foot stands ON the mass, whose top is gy + H: it was set 0.7 m above it, and the whole tower hung in the air)
  k.setBase(c.x, gy + H - 0.05, c.z, 0);
  box(k, [2.6, 4.2, 2.6], [0, 2.1, 0], stone(215));
  box(k, [3.0, 0.3, 3.0], [0, 4.3, 0], P.chalk);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * 1.05, 4.4, sz * 1.05], [sx * 1.05, 7.0, sz * 1.05], 0.24, 0.2, P.chalk, 6);
  k.add(new CylinderGeometry(0.46, 0.8, 1.2, lod ? 10 : 6), { at: [0, 5.9, 0], colour: P.copper, flat: true });
  k.limb([0, 7.0, 0], [0, 6.5, 0], 0.06, 0.06, P.iron, 4);
  pyramid(k, 1.75, 2.6, [0, 6.97, 0], P.crepe);   // (the roof rests on the four piers' heads at 7.0, and the bell's hanger meets its underside)
  k.add(new SphereGeometry(0.2, 6, 4), { at: [0, 9.8, 0], colour: P.guildSilver });
  k.clearBase();
}

// ---- the Assay House ------------------------------------------------------------------------------------------------------------------

function assay(k: Kit, world: CollisionWorld, lod: Lod, out: VesperOut): void {
  const p = vesperPlan();
  const b = p.assay;
  const gy = world.terrainHeight(b.x, b.z);
  const f = frame(b, "w");
  k.setBase(b.x, gy, b.z, f.yaw);
  const hx = f.lx, hz = f.lz, H = b.height;
  // stone below, plaster above with dark framing
  slab(k, [hx * 2, 3.3, hz * 2], [0, 1.15, 0], stone(230), lod);
  box(k, [hx * 2 + 0.3, 0.25, hz * 2 + 0.3], [0, 2.9, 0], P.chalk);
  box(k, [hx * 2 - 0.1, H - 3.0, hz * 2 - 0.1], [0, 3.0 + (H - 3.0) / 2, 0], P.strataBone);
  for (let i = 0; i <= 4; i++) box(k, [0.16, H - 3.1, 0.14], [-hx + 0.1 + (i * (hx * 2 - 0.2)) / 4, 3.05 + (H - 3.1) / 2, hz + 0.0], P.timber);
  box(k, [hx * 2 + 0.1, 0.18, 0.16], [0, H - 0.1, hz + 0.0], P.timber);
  box(k, [hx * 2 + 0.1, 0.16, 0.16], [0, 3.1, hz + 0.0], P.timber);
  // the roof: a shallow lean-to of corrugated iron, a parapet, the scales on a pole
  box(k, [hx * 2 + 0.6, 0.2, hz * 2 + 0.6], [0, H + 0.05, 0], P.iron);
  gable(k, hx + 0.4, hz + 0.5, 1.0, [0, H + 0.12, 0]);
  // windows with iron bars, a stout door under a hood, a counter window, steps
  const n = Math.max(2, Math.round(hx / 1.5));
  for (let i = 0; i < n; i++) {
    const x = -hx + ((i + 0.5) * hx * 2) / n;
    if (i === Math.floor(n / 2)) continue;
    box(k, [0.8, 1.2, 0.14], [x, 4.8, hz + 0.02], P.crepe);
    pane(out.panes, k, x, 4.8, hz + 0.1, 1, 0.6, 0.98, 240 + i);   // (in front of the crepe, behind the bars)
    box(k, [1.0, 0.12, 0.24], [x, 4.15, hz + 0.08], P.chalk);
    if (lod) for (let s = -1; s <= 1; s++) k.limb([x + s * 0.24, 4.3, hz + 0.14], [x + s * 0.24, 5.4, hz + 0.14], 0.02, 0.02, P.iron, 4);
  }
  const d = Math.floor(n / 2);
  const dx = -hx + ((d + 0.5) * hx * 2) / n;
  // (D-038: the door is SEALED, the iron grille shut: drawn below in the building's own frame)
  // the counter: a hatch with a brass grille and a shelf (where a claim is presented)
  box(k, [1.9, 1.1, 0.2], [dx - 3.3, 1.6, hz + 0.04], P.crepe);
  box(k, [2.4, 0.12, 0.7], [dx - 3.3, 1.05, hz + 0.4], P.timberLight);
  if (lod) for (let i = -3; i <= 3; i++) k.limb([dx - 3.3 + i * 0.24, 1.1, hz + 0.16], [dx - 3.3 + i * 0.24, 2.1, hz + 0.16], 0.02, 0.02, P.copper, 4);
  k.clearBase();
  {
    const lb = vesperLevel().buildings.find((x) => x.id === "assay")!;
    k.setBase(b.x, gy, b.z, lb.yaw);
    sealedDoor(k, `${lb.id}.door`, lb.hx, 0, lb.door, lb.doorH, SEAL, lod, out.marks, { x: b.x, y: gy, z: b.z, yaw: lb.yaw });
    // the door's iron hood: a sheet sloping out from the wall over the frame, its drip-bar along the front, on two wall brackets (the counter window beside it is where a claim is presented)
    // (the drip-bar alone hung 0.4 m off the wall with nothing holding it)
    box(k, [0.2, 0.16, lb.door + 1.0], [lb.hx + 0.4, lb.doorH + 0.4, 0], P.iron);
    box(k, [0.5, 0.05, lb.door + 1.0], [lb.hx + 0.24, lb.doorH + 0.5, 0], P.iron, [0, 0, -0.18]);
    for (const s of [-1, 1]) k.limb([lb.hx, lb.doorH + 0.02, s * (lb.door / 2 + 0.35)], [lb.hx + 0.42, lb.doorH + 0.36, s * (lb.door / 2 + 0.35)], 0.03, 0.03, P.iron, 4);
    notice(k, lb.hx, lb.floor, lb.doorH);
    k.clearBase();
  }
  // the scales: a pole, a beam, two pans on chains (the Assay House weighs everything, including opinions)
  k.setBase(b.x, gy + H + 1.1, b.z, 0);
  k.limb([0, 0, 0], [0, 2.7, 0], 0.1, 0.07, P.iron, 6);
  k.limb([-1.6, 2.7, 0], [1.6, 2.7, 0], 0.06, 0.06, P.copper, 5);
  for (const s of [-1, 1]) {
    k.limb([s * 1.6, 2.7, 0], [s * 1.35, 1.7, 0.25], 0.012, 0.012, P.iron, 3);
    k.limb([s * 1.6, 2.7, 0], [s * 1.85, 1.7, -0.25], 0.012, 0.012, P.iron, 3);
    k.add(new CylinderGeometry(0.5, 0.36, 0.1, lod ? 12 : 7), { at: [s * 1.6, 1.62, 0], colour: P.copper, flat: true });
  }
  k.add(new SphereGeometry(0.14, 6, 4), { at: [0, 2.82, 0], colour: P.copper });
  k.clearBase();
  // the furnace stack: a tapered brick chimney with iron bands and a cap
  const c = p.chimney;
  const cy = world.terrainHeight(c.x, c.z);
  k.add(new CylinderGeometry(c.r * 0.62, c.r * 1.05, c.height, lod ? 12 : 7, lod ? 6 : 1), { at: [c.x, cy + c.height / 2, c.z], colour: stone(240, P.strataRust, P.strataRustDark), flat: true, perFace: true });
  for (const t of [0.2, 0.45, 0.7]) k.add(new CylinderGeometry(c.r * (1.08 - t * 0.43), c.r * (1.08 - t * 0.43), 0.14, 10), { at: [c.x, cy + c.height * t, c.z], colour: P.iron, flat: true });
  k.add(new CylinderGeometry(c.r * 0.82, c.r * 0.62, 0.45, 10), { at: [c.x, cy + c.height + 0.2, c.z], colour: P.iron, flat: true });
  // a furnace shed against the stack
  k.setBase(c.x - 0.5, cy, c.z + 2.4, 0);
  slab(k, [3.2, 2.4, 2.4], [0, 1.2, 0], stone(245), lod);
  gable(k, 1.8, 1.5, 0.9, [0, 2.4, 0]);
  k.clearBase();
}

// ---- the Company's yard -----------------------------------------------------------------------------------------------------------------

function yard(k: Kit, world: CollisionWorld, lod: Lod, out: VesperOut): void {
  const p = vesperPlan();
  // the foreman's office: a plank hut on timber footings, a corrugated roof, a porch with a bell-pull and a ledger window, a stove pipe
  {
    const b = p.office;
    const gy = world.terrainHeight(b.x, b.z);
    const f = frame(b, "e");
    k.setBase(b.x, gy, b.z, f.yaw);
    const hx = f.lx, hz = f.lz, H = b.height;
    box(k, [hx * 2, H, hz * 2], [0, H / 2 + 0.2, 0], planks(250));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * (hx - 0.2), -0.6, sz * (hz - 0.2)], [sx * (hx - 0.2), 0.3, sz * (hz - 0.2)], 0.12, 0.1, P.timber, 5);
    gable(k, hx + 0.5, hz + 0.6, 1.5, [0, H + 0.2, 0]);   // (on the walls' top, H + 0.2: it was 5 cm above them)
    box(k, [1.3, 0.9, 0.12], [-2.0, 2.1, hz + 0.02], P.crepe);
    pane(out.panes, k, -2.0, 2.1, hz + 0.09, 1, 1.08, 0.7, 250);   // the ledger window: the Company keeps the lamp lit behind it
    box(k, [1.5, 0.1, 0.5], [-2.0, 1.6, hz + 0.3], P.timberLight);
    box(k, [3.4, 0.16, 1.5], [0.2, 0.15, hz + 0.9], P.timber);
    for (const sx of [-1, 1]) k.limb([sx * 1.55 + 0.2, 0.2, hz + 1.5], [sx * 1.55 + 0.2, 2.7, hz + 1.5], 0.07, 0.06, P.timber, 5);
    box(k, [3.6, 0.14, 1.8], [0.2, 2.75, hz + 0.9], P.iron, [0.1, 0, 0]);
    k.limb([-hx + 0.8, H + 0.15, -0.5], [-hx + 0.8, H + 2.1, -0.5], 0.14, 0.12, P.iron, 6);
    k.clearBase();
    // D-038: locked: the door (on the porch) is SEALED; the ledger window is the only way to talk to the Company
    const lb = vesperLevel().buildings.find((x) => x.id === "office")!;
    k.setBase(b.x, gy, b.z, lb.yaw);
    sealedDoor(k, `${lb.id}.door`, lb.hx, 0.2, lb.door, lb.doorH, SEAL, lod, out.marks, { x: b.x, y: gy, z: b.z, yaw: lb.yaw });
    notice(k, lb.hx, lb.floor, lb.doorH);
    k.clearBase();
    // a sign-board on two posts: THE LOWER GALLERY COMPANY (the lettering is the cloth's)
  }
  // the powder magazine: squat stone, an earth-covered roof, an iron door
  {
    const b = p.magazine;
    const gy = world.terrainHeight(b.x, b.z);
    const f = frame(b, "e");
    k.setBase(b.x, gy, b.z, f.yaw);
    const hx = f.lx, hz = f.lz, H = b.height;
    slab(k, [hx * 2, H, hz * 2], [0, H / 2 - 0.1, 0], stone(260, P.strataBuff, P.strataRust), lod);
    k.add(new SphereGeometry(1, lod ? 12 : 6, lod ? 6 : 3, 0, Math.PI * 2, 0, Math.PI / 2), { at: [0, H - 0.1, 0], scale: [hx + 0.3, 0.8, hz + 0.3], colour: P.spoil, flat: true });
    box(k, [0.6, 0.6, 0.1], [hx - 0.7, 1.6, hz + 0.02], P.companyRed);
    k.clearBase();
    // D-038: the iron door is padlocked and sealed (the keg's source)
    const lb = vesperLevel().buildings.find((x) => x.id === "magazine")!;
    k.setBase(b.x, gy, b.z, lb.yaw);
    sealedDoor(k, `${lb.id}.door`, lb.hx, 0, lb.door, lb.doorH, { ...SEAL, door: P.iron, board: P.ironLight, boardDark: P.iron }, lod, out.marks, { x: b.x, y: gy, z: b.z, yaw: lb.yaw });
    notice(k, lb.hx, lb.floor, lb.doorH);
    k.clearBase();
  }
  // the timber stack: pit-props and sleepers laid crosswise
  {
    const b = p.timberStack;
    const gy = world.terrainHeight(b.x, b.z);
    k.setBase(b.x, gy, b.z, b.yaw);
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i < 4; i++) {
        const along = row % 2 === 0;
        const x = along ? 0 : -b.hx + 0.3 + i * ((b.hx * 2 - 0.6) / 3);
        const z = along ? -b.hz + 0.3 + i * ((b.hz * 2 - 0.6) / 3) : 0;
        box(k, along ? [b.hx * 2, 0.26, 0.26] : [0.26, 0.26, b.hz * 2], [x, 0.14 + row * 0.26, z], h01(262, row, i) > 0.5 ? P.timber : P.timberLight);
      }
    }
    k.clearBase();
  }
  // the winding house: a stout shed with a big arched window, a stove pipe, the drum's cable running out to the headframe
  {
    const b = p.winding;
    const gy = world.terrainHeight(b.x, b.z);
    const f = frame(b, "w");
    k.setBase(b.x, gy, b.z, f.yaw);
    const hx = f.lx, hz = f.lz, H = b.height;
    slab(k, [hx * 2, 1.6, hz * 2], [0, 0.4, 0], stone(270), lod);
    box(k, [hx * 2, H - 1.2, hz * 2], [0, 1.2 + (H - 1.2) / 2, 0], planks(272));
    gable(k, hx + 0.5, hz + 0.5, 1.8, [0, H, 0]);   // (on the plank walls' top: it was 5 cm above them)
    box(k, [2.2, 1.7, 0.14], [0, 2.7, hz + 0.02], P.crepe);
    pane(out.panes, k, 0, 2.7, hz + 0.1, 1, 1.9, 1.45, 270);   // the arched window's glass (the engine works nights)
    k.add(new CylinderGeometry(1.1, 1.1, 0.14, lod ? 14 : 8, 1, false, 0, Math.PI), { at: [0, 3.55, hz + 0.02], rot: [Math.PI / 2, 0, 0], colour: P.crepe, flat: true });
    k.limb([-hx + 0.7, H + 0.8, 0.5], [-hx + 0.7, H + 3.0, 0.5], 0.16, 0.13, P.iron, 6);
    k.clearBase();
  }
}

// ---- tents, carts, spoil ------------------------------------------------------------------------------------------------------------------

function tent(k: Kit, x: number, y: number, z: number, yaw: number, kind: "syndicate" | "company" | "guild", lod: Lod): void {
  const a = kind === "syndicate" ? P.synGreen : kind === "company" ? P.companyRed : P.guildPlum;
  const b = P.companyCream;
  k.setBase(x, y, z, yaw);
  // a ridge tent: two slopes of alternating stripes (each stripe its own quad), closed gable ends, a dark doorway, guy lines
  const hx = 2.1, hz = 1.55, h = 2.3;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const x0 = -hx + (i * 2 * hx) / n, x1 = -hx + ((i + 1) * 2 * hx) / n;
    const colour = i % 2 ? a : b;
    for (const s of [-1, 1]) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(s < 0 ? [x0, 0, -hz, x0, h, 0, x1, h, 0, x0, 0, -hz, x1, h, 0, x1, 0, -hz] : [x0, 0, hz, x1, h, 0, x0, h, 0, x0, 0, hz, x1, 0, hz, x1, h, 0]), 3));
      g.computeVertexNormals();
      k.add(g, { colour, flat: true });
    }
  }
  for (const s of [-1, 1]) {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(s < 0 ? [-hx, 0, hz, -hx, h, 0, -hx, 0, -hz] : [hx, 0, -hz, hx, h, 0, hx, 0, hz]), 3));
    g.computeVertexNormals();
    k.add(g, { colour: a, flat: true });
  }
  // D-038: the flap is TIED SHUT (a canvas panel, two ties, a bedroll, a boot): nobody walks in
  tentFlap(k, hx, 1.5, 1.0, { canvas: b, canvasDark: a, rope: P.timberLight, roll: P.companyRed, boot: P.timber }, Math.round(x));
  k.limb([hx, h, 0], [hx, h + 0.55, 0], 0.03, 0.025, P.timber, 4);
  if (lod) for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    k.limb([sx * hx * 0.9, h * 0.2, sz * hz * 0.9], [sx * (hx + 1.4), 0.03, sz * (hz + 1.4)], 0.012, 0.012, P.plank, 3);
    box(k, [0.05, 0.2, 0.05], [sx * (hx + 1.4), 0.09, sz * (hz + 1.4)], P.timber);
  }
  k.clearBase();
}

function cart(k: Kit, x: number, y: number, z: number, yaw: number, lod: Lod, seed: number): void {
  k.setBase(x, y, z, yaw);
  // an ore cart on narrow wheels: a tapered iron body heaped with copper ore, a drawbar
  k.add(new BoxGeometry(2.0, 0.9, 1.3), { at: [0, 0.85, 0], colour: (p, n, out) => blend(out, P.iron, P.ironLight, n.y > 0.5 ? 0.5 : (p.y + 0.5) * 0.2), flat: true });
  const heap = new IcosahedronGeometry(0.85, 1);
  k.add(heap, { at: [0, 1.35, 0], scale: [1.05, 0.5, 0.75], colour: (_p, n, out) => blend(out, P.copper, P.verdigris, Math.max(0, n.y) * 0.3 + h01(seed, 3) * 0.2), flat: true, jitter: 0.1, seed });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.add(new CylinderGeometry(0.34, 0.34, 0.1, lod ? 12 : 7), { at: [sx * 0.7, 0.34, sz * 0.7], rot: [Math.PI / 2, 0, 0], colour: P.iron, flat: true });
  }
  k.limb([1.0, 0.5, 0], [1.9, 0.38, 0], 0.05, 0.05, P.iron, 5);
  k.clearBase();
}

function spoil(k: Kit, world: CollisionWorld, lod: Lod): void {
  for (const [i, s] of vesperPlan().spoil.entries()) {
    const y = world.terrainHeight(s.x, s.z);
    k.setBase(s.x, y, s.z, 0);
    // tailings: a heap of dark chips and pale dust in broken courses, jittered hard so it reads as rubble and not as a pebble
    const tail: ColourFn = (p, n, out) => {
      const c = h01(280 + i, Math.floor(p.x * 2.5), Math.floor(p.y * 2.5), Math.floor(p.z * 2.5));
      blend(out, c > 0.6 ? P.shale : P.scree, c > 0.85 ? P.strataRustDark : P.dust, Math.max(0, n.y) * 0.45 + c * 0.2);
    };
    k.add(new IcosahedronGeometry(1, lod ? 2 : 1), { at: [0, s.height * 0.1, 0], scale: [s.r * 1.1, s.height * 1.1, s.r * 1.1], colour: tail, flat: true, perFace: true, jitter: 0.22, seed: 281 + i });
    k.add(new IcosahedronGeometry(1, 1), { at: [s.r * 0.5, s.height * 0.08, s.r * 0.3], scale: [s.r * 0.55, s.height * 0.55, s.r * 0.5], colour: tail, flat: true, perFace: true, jitter: 0.25, seed: 285 + i });
    k.clearBase();
  }
}

// ---- lamps ----------------------------------------------------------------------------------------------------------------------------------

function lamp(k: Kit, x: number, z: number, gy: number, h: number): void {
  k.limb([x, gy - 0.3, z], [x, gy + h, z], 0.11, 0.08, P.iron, 6);
  k.limb([x, gy + h * 0.5, z], [x + 0.4, gy + h * 0.74, z], 0.03, 0.03, P.iron, 4);
  // the lantern is a cage round a lamp-amber flame (the glow the view adds must be seen through it)
  box(k, [0.34, 0.06, 0.34], [x, gy + h + 0.02, z], P.iron);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([x + sx * 0.14, gy + h + 0.03, z + sz * 0.14], [x + sx * 0.14, gy + h + 0.48, z + sz * 0.14], 0.024, 0.024, P.iron, 4);
  k.add(new CylinderGeometry(0.035, 0.05, 0.14, 5), { at: [x, gy + h + 0.11, z], colour: P.iron, flat: true });   // (the burner the flame sits on: it stood in the air inside the cage)
  k.add(new SphereGeometry(0.1, 6, 4), { at: [x, gy + h + 0.26, z], colour: P.glowLamp });
  pyramid(k, 0.26, 0.28, [x, gy + h + 0.48, z], P.crepe);
}

// ---- needles --------------------------------------------------------------------------------------------------------------------------------

/** A rock needle: a stack of jittered, tapering drums in banded strata (the verticals of the horizon). */
function needle(k: Kit, x: number, y: number, z: number, r: number, h: number, seed: number, lod: Lod): void {
  const rock: ColourFn = (p, n, out) => {
    const band = Math.floor((p.y + 100) / 2.3);
    blend(out, [P.strataRust, P.strataPlum, P.strataBuff, P.strataRustDark, P.strataViolet][((band % 5) + 5) % 5]!, P.strataBone, Math.max(0, n.y - 0.3) * 0.5);
  };
  const segs = lod ? 6 : 4;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const r0 = r * (1.15 - 0.85 * t0 ** 0.8), r1 = r * (1.15 - 0.85 * t1 ** 0.8);
    k.add(new CylinderGeometry(Math.max(0.25, r1), r0, (t1 - t0) * h + 0.2, lod ? 9 : 6, 1), { at: [x + (h01(seed, i) - 0.5) * 0.5, y + ((t0 + t1) / 2) * h, z + (h01(seed, i, 2) - 0.5) * 0.5], colour: rock, flat: true, perFace: true, jitter: 0.18, seed: seed + i });
  }
  k.add(new IcosahedronGeometry(r * 0.38, 0), { at: [x, y + h + 0.1, z], colour: P.strataBone, flat: true, jitter: 0.12, seed });
}

// ---- everything -----------------------------------------------------------------------------------------------------------------------------

export interface VesperSolidParts {
  glows: { x: number; y: number; z: number; lit?: number }[];
  panes: LitPane[];
  /** D-038: the doors drawn, and the roofs of the interiors (collected here, handed to the view by `buildVesperSolid`). */
  marks: DoorMark[];
  roofs: RoofKits;
}

/** The buildings, tents, carts, spoil, lamps and needles (the works: headframe, trestle, wharf, fall, rails are works.ts). */
export function addVesperStructures(k: Kit, world: CollisionWorld, lod: Lod, parts: VesperSolidParts): void {
  const plan: VesperPlan = vesperPlan();
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  const out: VesperOut = { marks: parts.marks, roofs: parts.roofs, panes: parts.panes };
  cloister(k, world, lod, parts.glows, out);
  assay(k, world, lod, out);
  yard(k, world, lod, out);
  for (const t of plan.tents) tent(k, t.x, g(t.x, t.z), t.z, t.yaw, t.kind, lod);
  plan.carts.forEach((c, i) => cart(k, c.x, g(c.x, c.z), c.z, c.yaw, lod, 290 + i));
  spoil(k, world, lod);
  for (const l of plan.lamps) {
    const y = g(l.x, l.z);
    lamp(k, l.x, l.z, y, l.h);
    parts.glows.push({ x: l.x, y: y + l.h + 0.26, z: l.z });
  }
  for (const [i, n] of plan.needles.entries()) needle(k, n.x, g(n.x, n.z) - 1, n.z, n.r, n.height + 1, 300 + i * 7, lod);
  // posts for the free-standing banners and the sign boards (the cloth hangs from them); a banner on a wall hangs from an iron rod on two arms out from it
  for (const b of plan.banners) {
    const y = g(b.x, b.z);
    if (b.wall !== undefined) {
      const nx = Math.cos(b.yaw), nz = Math.sin(b.yaw), rx = nz, rz = -nx;
      const ry = y + b.top + 0.03, cx = b.x + nx * 0.02, cz = b.z + nz * 0.02;   // (the cloth hangs 2 cm out from its line: cloth.ts)
      const half = b.w / 2 + 0.06;
      k.limb([cx - rx * half, ry, cz - rz * half], [cx + rx * half, ry, cz + rz * half], 0.025, 0.025, P.iron, 5);
      for (const s of [-1, 1]) {
        const ax = cx + rx * s * (b.w / 2 - 0.08), az = cz + rz * s * (b.w / 2 - 0.08);
        k.limb([ax - nx * (b.wall + 0.07), ry, az - nz * (b.wall + 0.07)], [ax, ry, az], 0.02, 0.02, P.iron, 4);
      }
      continue;
    }
    k.limb([b.x, y - 0.2, b.z], [b.x, y + b.top + 0.4, b.z], 0.1, 0.075, P.timber, 6);
    k.add(new SphereGeometry(0.14, 5, 4), { at: [b.x, y + b.top + 0.5, b.z], colour: P.glowLamp });
  }
  // D-096: the trig signals (their cairns are solid: VESPER_TRIG.signalR)
  VESPER_TRIG.signals.forEach((s, i) => trigSignal(k, s.x, g(s.x, s.z), s.z, 470 + i * 11, lod));
  // a sign is a board on a post (there was only the post, run up between the two lettered sheets and through their middles): the post stops under the board, braced out to it
  for (const s of plan.signs) {
    const y = g(s.x, s.z);
    k.setBase(s.x, y, s.z, s.yaw);   // (local +x is the board's face normal, as the cloth's decals have it; the board runs along local z)
    k.limb([0, -0.1, 0], [0, 1.6, 0], 0.07, 0.06, P.timber, 5);
    for (const sz of [-1, 1]) k.limb([0, 0.95, 0], [0, 1.6, sz * 0.75], 0.03, 0.03, P.timber, 3);
    box(k, [0.09, 0.52, 2.5], [0, 1.85, 0], P.timber);   // (centred on the decal: cloth.ts letters it at 1.85, 5.5 cm out: 1 cm proud of each face)
    k.clearBase();
  }
}

/**
 * D-096: a trig signal, as the Society's advance party raised it: a dry-stone cairn (inside `VESPER_TRIG.signalR`, the collider), an ash pole bedded in it, and at the head a pair of crossed vanes,
 * whitewashed with a red band, so a surveyor three hundred yards off can lay the cross-hairs on it. The flags the contract flies on it are the dress's (dress.ts).
 */
function trigSignal(k: Kit, x: number, y: number, z: number, seed: number, lod: Lod): void {
  const R = VESPER_TRIG.signalR, H = VESPER_TRIG.signalH;
  // (pale bench stone, whitewashed on top where the surveyors' lime ran: it has to read from across the gorge, as the cairn did for them)
  const rock: ColourFn = (p, n, out) => blend(out, P.strataBuff, P.strataBone, 0.35 + Math.max(0, n.y) * 0.5 + 0.1 * Math.sin(p.x * 13 + p.z * 7));
  // the cairn: a ring of big stones bedded in the ground, a smaller ring on them, a cap stone (each inside the round)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + h01(seed, i) * 0.5;
    k.add(new IcosahedronGeometry(0.2, 0), { at: [x + Math.cos(a) * (R - 0.2), y + 0.1, z + Math.sin(a) * (R - 0.2)], scale: [1, 0.8, 1], colour: rock, flat: true, jitter: 0.05, seed: seed + i });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    k.add(new IcosahedronGeometry(0.16, 0), { at: [x + Math.cos(a) * (R - 0.27), y + 0.36, z + Math.sin(a) * (R - 0.27)], scale: [1, 0.8, 1], colour: rock, flat: true, jitter: 0.05, seed: seed + 7 + i });
  }
  k.add(new IcosahedronGeometry(0.2, lod ? 1 : 0), { at: [x, y + 0.24, z], scale: [1.1, 1.3, 1.1], colour: rock, flat: true, jitter: 0.04, seed: seed + 13 });
  k.add(new IcosahedronGeometry(0.14, 0), { at: [x, y + 0.56, z], scale: [1, 0.7, 1], colour: rock, flat: true, jitter: 0.04, seed: seed + 14 });
  // the pole, and the vanes at its head (two boards, crossed, each with its red band)
  k.limb([x, y + 0.2, z], [x, y + H - 0.05, z], 0.05, 0.04, P.timberLight, 6);
  const red = PALETTE.camp.flagCloth;
  for (const yaw of [0, Math.PI / 2]) {
    // (three rows of faces, coloured face by face in the board's own frame: the middle row is the band)
    k.add(new BoxGeometry(0.62, 0.42, 0.025, 1, 3, 1), { at: [x, y + H - 0.32, z], rot: [0, yaw, 0], colour: (p, _n, out) => out.set(Math.abs(p.y) < 0.07 ? red : P.chalk), flat: true, perFace: true });
  }
}
