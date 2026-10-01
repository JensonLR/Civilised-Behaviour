import { BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, SphereGeometry } from "three";
import { PALETTE, hash3, type CollisionWorld } from "./shared.ts";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";
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

/** The gallery: a long block cut into the cliff, seven arches, black crepe swagged between pilasters, a flat roof with a parapet and a bell-gable. Arch lamps are returned for the glow. */
function cloister(k: Kit, world: CollisionWorld, lod: Lod, glows: { x: number; y: number; z: number }[]): void {
  const c = vesperPlan().cloister;
  const gy = world.terrainHeight(c.x, c.z);
  const f = frame(c, "e");   // the door side looks east, to the road: local +z is world +x
  k.setBase(c.x, gy, c.z, f.yaw);   // local x runs along the gorge (world z), local z across it
  const L = f.lx, D = f.lz, H = c.height;
  slab(k, [L * 2, H + 0.8, D * 2], [0, (H - 0.8) / 2, 0], stone(210), lod);
  // cornice and parapet
  box(k, [L * 2 + 0.5, 0.3, D * 2 + 0.7], [0, H - 0.05, 0.1], P.chalk);
  box(k, [L * 2 + 0.2, 0.55, 0.3], [0, H + 0.4, D - 0.1], P.strataBone);
  box(k, [L * 2 + 0.2, 0.55, 0.3], [0, H + 0.4, -D + 0.1], P.strataBone);
  // the arches: dark mouths with a half-round head, pilasters between them, a stone sill and the dirge's step
  const n = c.arches;
  const pitch = (L * 2 - 1.6) / n;
  for (let i = 0; i < n; i++) {
    const x = -L + 0.8 + (i + 0.5) * pitch;
    const w = pitch * 0.62;
    const hArch = 3.7;
    box(k, [w, hArch, 0.5], [x, hArch / 2, D - 0.15], P.crepe);
    const head = new CylinderGeometry(w / 2, w / 2, 0.5, lod ? 12 : 7, 1, false, 0, Math.PI);
    k.add(head, { at: [x, hArch, D - 0.15], rot: [Math.PI / 2, 0, 0], colour: P.crepe, flat: true });
    box(k, [w + 0.5, 0.18, 0.9], [x, 0.09, D + 0.3], P.chalk);
    // the voussoirs: a ring of pale stones round the head
    if (lod) for (let s = 0; s < 5; s++) {
      const a = Math.PI * (s / 4);
      k.add(new BoxGeometry(0.34, 0.5, 0.62), { at: [x + Math.cos(a) * (w / 2 + 0.25), hArch + Math.sin(a) * (w / 2 + 0.25), D - 0.1], rot: [0, 0, a - Math.PI / 2], colour: P.chalk, flat: true });
    }
    // crepe: a long black swag hung across the mouth and two streamers either side
    box(k, [w + 0.1, 0.5, 0.12], [x, hArch - 0.5, D + 0.26], P.crepeFold, [0, 0, (i % 2 ? 0.05 : -0.05)]);
    for (const s of [-1, 1]) box(k, [0.16, 2.1, 0.09], [x + s * (w / 2 + 0.34), hArch - 1.5, D + 0.38], P.crepe, [0, 0, s * 0.04]);
    glows.push({ x: c.x + D - 0.4, y: gy + 2.1, z: c.z - x });   // (local +x runs along world -z)
  }
  for (let i = 0; i <= n; i++) {
    const x = -L + 0.8 + i * pitch;
    k.limb([x, 0, D + 0.1], [x, H - 0.2, D + 0.1], 0.3, 0.26, P.chalk, lod ? 8 : 5);
    k.add(new SphereGeometry(0.2, 6, 4), { at: [x, H - 0.1, D + 0.1], colour: P.strataBone, flat: true });
  }
  // the steps in front of the middle arches
  for (let i = 0; i < 3; i++) box(k, [pitch * 3, 0.2, 1.4 - i * 0.4], [0, 0.1 + i * 0.2, D + 0.9 + (2 - i) * 0.0 + 0.4], P.chalk);
  k.clearBase();
  // the bell-gable: a slim tower on the roof with an open belfry and a bell of copper, a crepe-black roof
  k.setBase(c.x, gy + H + 0.7, c.z, f.yaw);
  box(k, [2.6, 4.2, 2.6], [0, 2.1, 0], stone(215));
  box(k, [3.0, 0.3, 3.0], [0, 4.3, 0], P.chalk);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * 1.05, 4.4, sz * 1.05], [sx * 1.05, 7.0, sz * 1.05], 0.24, 0.2, P.chalk, 6);
  k.add(new CylinderGeometry(0.46, 0.8, 1.2, lod ? 10 : 6), { at: [0, 5.9, 0], colour: P.copper, flat: true });
  k.limb([0, 7.0, 0], [0, 6.5, 0], 0.06, 0.06, P.iron, 4);
  pyramid(k, 1.75, 2.6, [0, 7.05, 0], P.crepe);
  k.add(new SphereGeometry(0.2, 6, 4), { at: [0, 9.8, 0], colour: P.guildSilver });
  k.clearBase();
}

// ---- the Assay House ------------------------------------------------------------------------------------------------------------------

function assay(k: Kit, world: CollisionWorld, lod: Lod): void {
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
    box(k, [1.0, 0.12, 0.24], [x, 4.15, hz + 0.08], P.chalk);
    if (lod) for (let s = -1; s <= 1; s++) k.limb([x + s * 0.24, 4.3, hz + 0.14], [x + s * 0.24, 5.4, hz + 0.14], 0.02, 0.02, P.iron, 4);
  }
  const d = Math.floor(n / 2);
  const dx = -hx + ((d + 0.5) * hx * 2) / n;
  box(k, [1.5, 2.5, 0.2], [dx, 1.2, hz + 0.04], P.timber);
  box(k, [2.1, 0.16, 0.9], [dx, 2.75, hz + 0.4], P.iron, [0.18, 0, 0]);
  for (let i = 0; i < 3; i++) box(k, [2.4, 0.2, 1.3 - i * 0.3], [dx, 0.1 + i * 0.2, hz + 0.9 - i * 0.12], P.chalk);
  // the counter: a hatch with a brass grille and a shelf (where a claim is presented)
  box(k, [1.9, 1.1, 0.2], [dx - 3.3, 1.6, hz + 0.04], P.crepe);
  box(k, [2.4, 0.12, 0.7], [dx - 3.3, 1.05, hz + 0.4], P.timberLight);
  if (lod) for (let i = -3; i <= 3; i++) k.limb([dx - 3.3 + i * 0.24, 1.1, hz + 0.16], [dx - 3.3 + i * 0.24, 2.1, hz + 0.16], 0.02, 0.02, P.copper, 4);
  k.clearBase();
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

function yard(k: Kit, world: CollisionWorld, lod: Lod): void {
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
    gable(k, hx + 0.5, hz + 0.6, 1.5, [0, H + 0.25, 0]);
    box(k, [1.1, 2.2, 0.16], [0.9, 1.4, hz + 0.02], P.timberLight);
    box(k, [1.5, 0.9, 0.12], [-1.5, 2.1, hz + 0.02], P.crepe);
    box(k, [1.9, 0.1, 0.5], [-1.5, 1.6, hz + 0.3], P.timberLight);
    box(k, [3.4, 0.16, 1.5], [0.2, 0.15, hz + 0.9], P.timber);
    for (const sx of [-1, 1]) k.limb([sx * 1.55 + 0.2, 0.2, hz + 1.5], [sx * 1.55 + 0.2, 2.7, hz + 1.5], 0.07, 0.06, P.timber, 5);
    box(k, [3.6, 0.14, 1.8], [0.2, 2.75, hz + 0.9], P.iron, [0.1, 0, 0]);
    k.limb([-hx + 0.8, H + 0.5, -0.5], [-hx + 0.8, H + 2.1, -0.5], 0.14, 0.12, P.iron, 6);
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
    box(k, [1.3, 1.9, 0.18], [0, 0.95, hz + 0.02], P.iron);
    for (let i = 0; i < 3; i++) box(k, [1.3, 0.1, 0.22], [0, 0.4 + i * 0.6, hz + 0.05], P.ironLight);
    box(k, [0.6, 0.6, 0.1], [hx - 0.7, 1.6, hz + 0.02], P.companyRed);
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
    gable(k, hx + 0.5, hz + 0.5, 1.8, [0, H + 0.05, 0]);
    box(k, [2.2, 1.7, 0.14], [0, 2.7, hz + 0.02], P.crepe);
    k.add(new CylinderGeometry(1.1, 1.1, 0.14, lod ? 14 : 8, 1, false, 0, Math.PI), { at: [0, 3.55, hz + 0.02], rot: [Math.PI / 2, 0, 0], colour: P.crepe, flat: true });
    box(k, [1.2, 2.1, 0.14], [hx - 1.0, 1.1, hz + 0.02], P.timberLight);
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
  box(k, [0.05, 1.5, 1.0], [hx + 0.03, 0.75, 0], P.crepe);
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
  glows: { x: number; y: number; z: number }[];
}

/** The buildings, tents, carts, spoil, lamps and needles (the works: headframe, trestle, wharf, fall, rails are works.ts). */
export function addVesperStructures(k: Kit, world: CollisionWorld, lod: Lod, parts: VesperSolidParts): void {
  const plan: VesperPlan = vesperPlan();
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  cloister(k, world, lod, parts.glows);
  assay(k, world, lod);
  yard(k, world, lod);
  for (const t of plan.tents) tent(k, t.x, g(t.x, t.z), t.z, t.yaw, t.kind, lod);
  plan.carts.forEach((c, i) => cart(k, c.x, g(c.x, c.z), c.z, c.yaw, lod, 290 + i));
  spoil(k, world, lod);
  for (const l of plan.lamps) {
    const y = g(l.x, l.z);
    lamp(k, l.x, l.z, y, l.h);
    parts.glows.push({ x: l.x, y: y + l.h + 0.26, z: l.z });
  }
  for (const [i, n] of plan.needles.entries()) needle(k, n.x, g(n.x, n.z) - 1, n.z, n.r, n.height + 1, 300 + i * 7, lod);
  // posts for the free-standing banners and the sign boards (the cloth hangs from them)
  for (const b of plan.banners) {
    if (b.top > 6.2 || b.kind === "company") continue;
    const y = g(b.x, b.z);
    k.limb([b.x, y - 0.2, b.z], [b.x, y + b.top + 0.4, b.z], 0.1, 0.075, P.timber, 6);
    k.add(new SphereGeometry(0.14, 5, 4), { at: [b.x, y + b.top + 0.5, b.z], colour: P.glowLamp });
  }
  for (const s of plan.signs) {
    const y = g(s.x, s.z);
    k.limb([s.x, y - 0.1, s.z], [s.x, y + 2.15, s.z], 0.07, 0.06, P.timber, 5);
  }
  void box;
}
