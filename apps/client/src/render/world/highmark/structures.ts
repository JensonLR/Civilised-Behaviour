import { BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, SphereGeometry } from "three";
import { PALETTE, hash3, type CollisionWorld } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { tent } from "../landmarks.ts";
import { HIGHMARK, HIGHMARK_ANCHORS, HIGHMARK_SITES, highmarkPlan, type HighmarkBox, type HighmarkRound, type HighmarkWall } from "./shared.ts";
import { BELL_GABLE, GATE_MAST, LANTERN_TOWER, PALACE_MAST, TERRACE_MAST, TIER2_PINNACLE, palaceHeights, terraceMasts } from "./skyline.ts";

/**
 * Every solid thing in Highmark merged into ONE vertex-coloured geometry (one draw, one ink hull): the retaining walls of the five terraces and the ramps' sloping side walls (the
 * very boxes the collision world has), the granaries with their verdigris cones, the market stalls and their striped awnings, the guildhall and the court's offices under pitched
 * verdigris roofs, the gatehouse with the Chamberlain's Window, the stepped palace and its bell-gable, the court's sun medallion, the Vacant Chair on its dais, the stag statues, the lamps,
 * the numbered milestones and the Waiting Stones, the Reed Landing's quay and barge, and the drovers' camp. Everything is placed from `highmarkPlan()` and the terrain: the wall you see
 * is the wall you bump into. Masonry is boxes cut into courses (faceted, coloured per triangle): crisp blocks without a texture. Palette colours only.
 * Heraldry (a sun and a stag), Latin-letter signage, no dome, minaret or script.
 */

const P = PALETTE.highmark;
const h01 = (seed: number, a: number, b = 0, c = 0): number => hash3(seed, a, b, c) / 4294967296;
const plain = (c: number): ColourFn => (_p, _n, out) => void out.set(c);

/** Courses of chalk blocks: rows 0.7 m high, blocks ~1.6 m long, each a shade of its own; caps pale, undersides dark. */
const masonry = (seed: number, base: number = P.chalk, shade: number = P.chalkShade): ColourFn => (p, n, out) => {
  if (n.y > 0.6) {
    out.set(P.chalkCap);
    return;
  }
  if (n.y < -0.6) {
    out.set(P.chalkDark);
    return;
  }
  const row = Math.floor(p.y / 0.7);
  const col = Math.floor((p.x + p.z) / 1.6 + (row & 1) * 0.5);
  blend(out, base, shade, h01(seed, row, col) * 0.85);
  if (h01(seed + 7, row, col) > 0.94) blend(out, P.chalkShade, P.chalkDark, 0.5);
};

/** Verdigris roof: dark ribs and light flanks, the weathered green of old copper. */
const roofColour: ColourFn = (p, n, out) => {
  const rib = (Math.floor((p.x + p.z * 0.7) * 1.8) & 1) * 0.28;
  // (deeper than the old verdigris: from the plain a roof is the one dark mass in a white town, and the first value to survive the haze)
  blend(out, P.roofDeep, P.verdigrisDark, Math.max(0, n.y) * 0.55 + rib);
  if (n.y > 0.75) blend(out, out.getHex(), P.verdigris, 0.3);
};

const box = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

function slab(k: Kit, size: V3, at: V3, colour: number | ColourFn, lod: Lod, rot?: V3, coarse = false): void {
  const fine = lod > 0 && !coarse;
  const sx = fine ? Math.min(8, Math.max(1, Math.round(size[0] / 1.6))) : 1;
  const sy = fine ? Math.min(14, Math.max(1, Math.round(size[1] / 0.7))) : 1;
  const sz = fine ? Math.min(8, Math.max(1, Math.round(size[2] / 1.6))) : 1;
  k.add(new BoxGeometry(size[0], size[1], size[2], sx, sy, sz), { at, rot, colour, flat: true, perFace: typeof colour !== "number" });
}

/** A gable roof: the ridge runs along local x. `hx`/`hz` are half the eave extents, `h` the rise; the gable ends are closed. */
function gable(k: Kit, hx: number, hz: number, h: number, at: V3, colour: ColourFn | number = roofColour): void {
  const v = [
    [-hx, 0, -hz], [hx, 0, -hz], [hx, h, 0], [-hx, h, 0],   // back slope (faces -z and up)
    [hx, 0, hz], [-hx, 0, hz], [-hx, h, 0], [hx, h, 0],     // front slope
    [-hx, 0, hz], [-hx, 0, -hz], [-hx, h, 0],               // west gable
    [hx, 0, -hz], [hx, 0, hz], [hx, h, 0],                  // east gable
  ];
  const idx = [0, 3, 2, 0, 2, 1, 4, 7, 6, 4, 6, 5, 8, 10, 9, 11, 13, 12];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(idx.flatMap((i) => v[i]!)), 3));
  g.computeVertexNormals();
  k.add(g, { at, colour, flat: true, perFace: typeof colour !== "number" });
}

/** A pyramid roof (four slopes) over a square footprint of half-side `r`. */
function pyramid(k: Kit, r: number, h: number, at: V3, colour: ColourFn | number = roofColour): void {
  k.add(new ConeGeometry(r * Math.SQRT2, h, 4, 1), { at: [at[0], at[1] + h / 2, at[2]], rot: [0, Math.PI / 4, 0], colour, flat: true, perFace: typeof colour !== "number" });
}

/**
 * A stepped ridge: a row of small blocks along local x that rises to the middle of the run and falls again (crow steps), so a roof's line against the sky is a stair and not a ruler. `len` is the
 * ridge's length, `at` the ridge's midpoint, `step` how much each block rises over the one outside it.
 */
function crest(k: Kit, len: number, at: V3, colour: number, lod: Lod, step = 0.28): void {
  const n = Math.max(3, Math.round(len / 1.4)) | 1; // (odd: one block at the middle)
  const w = len / n;
  for (let i = 0; i < n; i++) {
    const rise = Math.min(i, n - 1 - i);
    const h = 0.3 + rise * step;
    box(k, [w * 0.82, h, 0.34], [at[0] - len / 2 + w * (i + 0.5), at[1] + h / 2, at[2]], i % 2 ? colour : P.chalkCap);
  }
  if (lod) k.add(new SphereGeometry(0.2, 6, 4), { at: [at[0], at[1] + 0.3 + Math.floor(n / 2) * step + 0.2, at[2]], colour: P.sunGold });
}

/** A spire: a slim square cone on a plinth, a gilt ball at the tip. `h` is the spire's own height; the plinth stands under it. */
function spire(k: Kit, at: V3, plinth: number, h: number, r: number, roof: number): void {
  if (plinth > 0) box(k, [r * 2.2, plinth, r * 2.2], [at[0], at[1] + plinth / 2, at[2]], P.chalkCap);
  pyramid(k, r, h, [at[0], at[1] + plinth, at[2]], roof);
  k.add(new SphereGeometry(0.2, 6, 4), { at: [at[0], at[1] + plinth + h + 0.05, at[2]], colour: P.sunGold });
}

/** A banner mast: a slim pole from `base` to `base + height`, a crossbar under the tip where the cloth hangs from, and a gilt ball. */
function mast(k: Kit, x: number, base: number, z: number, height: number, bar: number): void {
  k.limb([x, base - 0.2, z], [x, base + height, z], 0.1, 0.07, P.timber, 6);
  box(k, [bar, 0.09, 0.09], [x, base + height - 0.35, z], P.timber);
  k.add(new SphereGeometry(0.17, 5, 4), { at: [x, base + height + 0.12, z], colour: P.sunGold });
}

/** The sun of the Crown: a gilt disc with sixteen rays, standing on a wall face (local +z is the face's normal). */
function sun(k: Kit, x: number, y: number, z: number, yaw: number, r: number, lod: Lod): void {
  k.setBase(x, y, z, yaw);
  k.add(new CylinderGeometry(r, r, 0.08, lod ? 20 : 10), { rot: [Math.PI / 2, 0, 0], colour: P.sunGold, flat: true });
  const rays = lod ? 16 : 8;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    k.add(new ConeGeometry(r * 0.2, r * 0.62, 3, 1), { at: [Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3, 0], rot: [0, 0, a - Math.PI / 2], colour: P.sunGold, flat: true });
  }
  k.clearBase();
}

/** A stag statue on a plinth: body, four legs, a raised neck and head, and branching antlers (the Crown's other beast). */
function stag(k: Kit, x: number, y: number, z: number, yaw: number, s: number, colour: number): void {
  k.setBase(x, y, z, yaw);
  k.add(new SphereGeometry(0.55 * s, 8, 6), { at: [0, 1.15 * s, 0], scale: [1.5, 0.82, 0.8], colour, flat: true });
  for (const [lx, lz] of [[-0.62, -0.22], [-0.62, 0.22], [0.62, -0.22], [0.62, 0.22]] as const) k.limb([lx * s, 1.0 * s, lz * s], [lx * s * 1.05, 0.05 * s, lz * s], 0.075 * s, 0.045 * s, colour, 5);
  k.limb([0.6 * s, 1.3 * s, 0], [1.0 * s, 2.0 * s, 0], 0.17 * s, 0.11 * s, colour, 6);
  k.add(new SphereGeometry(0.17 * s, 6, 5), { at: [1.12 * s, 2.08 * s, 0], scale: [1.5, 1, 0.9], colour, flat: true });
  for (const sz of [-1, 1]) {
    k.limb([1.0 * s, 2.2 * s, sz * 0.1 * s], [0.85 * s, 2.95 * s, sz * 0.3 * s], 0.035 * s, 0.02 * s, colour, 4);
    k.limb([0.92 * s, 2.55 * s, sz * 0.2 * s], [1.3 * s, 2.9 * s, sz * 0.38 * s], 0.025 * s, 0.015 * s, colour, 4);
    k.limb([0.88 * s, 2.8 * s, sz * 0.28 * s], [0.62 * s, 3.25 * s, sz * 0.3 * s], 0.02 * s, 0.012 * s, colour, 4);
  }
  k.clearBase();
}

// ---- walls ------------------------------------------------------------------------------------------------------------------------

/** One wall piece: a retaining wall box from below the lower terrace to the parapet, or a ramp's side wall with a sloping top. */
function wall(k: Kit, w: HighmarkWall, lod: Lod, seed: number): void {
  const bottom = w.lo - 0.7;
  if (!w.ramp) {
    const top = w.hi + HIGHMARK.parapet;
    k.setBase(w.x, 0, w.z, w.yaw);
    slab(k, [w.hx * 2, top - bottom, w.hz * 2 + 0.3], [0, (top + bottom) / 2, 0], masonry(seed), lod);
    // the piping of the cake: a verdigris coping along every terrace edge, so each tier reads from the grass as a tier
    box(k, [w.hx * 2 + 0.1, 0.22, w.hz * 2 + 0.6], [0, top + 0.1, 0], P.verdigris);
    // a battered footing: the ground mesh's quad that spans the riser is hidden behind a stone plinth, so no tooth of grass climbs the wall
    box(k, [w.hx * 2 + 0.1, 1.5, w.hz * 2 + 1.3], [0, w.lo + 0.05, 0], P.chalkShade);
    k.clearBase();
    return;
  }
  // a ramp's side wall: its top follows the ramp (local +x runs outward, the ramp falls that way)
  const slope = (HIGHMARK.heights[1]! - HIGHMARK.heights[0]!) / HIGHMARK.rampRun;
  const g = new BoxGeometry(w.hx * 2, 1, w.hz * 2 + 0.1, 1, 1, 1);
  const p = g.attributes.position as BufferAttribute;
  const top = w.hi + HIGHMARK.sideWall;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const up = p.getY(i) > 0;
    p.setY(i, up ? top - slope * x : bottom);
  }
  g.computeVertexNormals();
  k.setBase(w.x, 0, w.z, w.yaw);
  k.add(g, { colour: masonry(seed), flat: true, perFace: true });
  k.clearBase();
}

// ---- the hill's buildings --------------------------------------------------------------------------------------------------------

function granary(k: Kit, g: HighmarkRound, gy: number, lod: Lod, seed: number): void {
  k.setBase(g.x, gy, g.z, 0);
  const radial = lod ? 14 : 8;
  k.add(new CylinderGeometry(g.r, g.r * 1.05, g.height + 0.7, radial, lod ? 5 : 1), { at: [0, (g.height - 0.7) / 2, 0], colour: masonry(seed), flat: true, perFace: true });
  k.add(new CylinderGeometry(g.r + 0.2, g.r + 0.2, 0.3, radial), { at: [0, g.height - 0.15, 0], colour: P.chalkCap, flat: true });
  k.add(new ConeGeometry(g.r + 0.75, 2.5, radial, 1), { at: [0, g.height + 1.1, 0], colour: roofColour, flat: true, perFace: true });
  k.add(new SphereGeometry(0.22, 6, 4), { at: [0, g.height + 2.45, 0], colour: P.sunGold });
  // a plank door and a window slit; sacks at the foot
  box(k, [1.1, 2.0, 0.2], [g.r - 0.05, 0.9, 0], P.timber, [0, 0, 0]);
  if (lod) {
    box(k, [0.2, 0.5, 0.12], [0, g.height - 1.2, g.r - 0.05], P.iron);
    for (let i = 0; i < 3; i++) k.add(new SphereGeometry(0.34, 6, 4), { at: [g.r * 0.6 + i * 0.35, 0.28, g.r * 0.7 - i * 0.2], scale: [1, 0.8, 1], colour: P.grangeWheat, flat: true });
  }
  k.clearBase();
}

function stall(k: Kit, s: HighmarkBox, gy: number, lod: Lod, i: number): void {
  k.setBase(s.x, gy, s.z, s.yaw);
  box(k, [s.hx * 2, 0.95, s.hz * 1.4], [0, 0.48, 0], P.timber);
  box(k, [s.hx * 2 + 0.1, 0.1, s.hz * 1.5], [0, 0.97, 0], P.timberLight);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * (s.hx - 0.1), 0, sz * (s.hz - 0.1)], [sx * (s.hx - 0.1), s.height, sz * (s.hz - 0.1)], 0.06, 0.05, P.timber, 5);
  // the awning: a tilted slab striped crown-red and cream, with a scalloped front board
  const stripes: ColourFn = (p, _n, out) => out.set(Math.floor((p.x + s.hx + 10) * 1.6 + i) % 2 ? P.crownCream : P.crownRed);
  k.add(new BoxGeometry(s.hx * 2 + 0.7, 0.07, s.hz * 2 + 0.7, lod ? 6 : 1, 1, 1), { at: [0, s.height + 0.1, 0], rot: [0.16, 0, 0], colour: stripes, flat: true, perFace: true });
  box(k, [s.hx * 2 + 0.7, 0.22, 0.05], [0, s.height - 0.1, s.hz + 0.38], stripes);
  // the goods: grain sacks, a crate, a basket, a stack of loaves: a different stall each time
  const goods = [P.grangeWheat, P.hide, P.crownCream, P.grassGoldPale] as const;
  for (let g = 0; g < (lod ? 4 : 2); g++) {
    const gx = -s.hx + 0.4 + g * ((s.hx * 2 - 0.8) / 3);
    if ((g + i) % 2) k.add(new SphereGeometry(0.28, 6, 4), { at: [gx, 1.2, 0], scale: [1, 0.8, 1], colour: goods[(g + i) % 4]!, flat: true });
    else box(k, [0.45, 0.3, 0.4], [gx, 1.17, 0], goods[(g + i) % 4]!);
  }
  k.clearBase();
}

function hall(k: Kit, b: HighmarkBox, gy: number, lod: Lod, seed: number, big: boolean): void {
  k.setBase(b.x, gy, b.z, b.yaw);
  slab(k, [b.hx * 2, b.height + 0.7, b.hz * 2], [0, (b.height - 0.7) / 2, 0], masonry(seed), lod);
  box(k, [b.hx * 2 + 0.3, 0.25, b.hz * 2 + 0.3], [0, b.height - 0.05, 0], P.chalkCap);
  gable(k, b.hx + 0.5, b.hz + 0.55, big ? 3.2 : 2.5, [0, b.height + 0.05, 0]);
  crest(k, (b.hx + 0.5) * 2 - 1.2, [0, b.height + 0.05 + (big ? 3.2 : 2.5), 0], P.verdigrisLight, lod);
  // windows (dark, lit at dusk by the lamps), a door on the face the road passes (local +z), a gilt sun over it
  const n = Math.max(2, Math.round(b.hx / 1.7));
  for (let i = 0; i < n; i++) {
    const x = -b.hx + ((i + 0.5) * b.hx * 2) / n;
    if (i === Math.floor(n / 2)) continue;
    box(k, [0.7, 1.1, 0.12], [x, b.height * 0.55, b.hz + 0.02], P.iron);
    box(k, [0.9, 0.12, 0.2], [x, b.height * 0.55 - 0.62, b.hz + 0.06], P.chalkCap);
  }
  const d = Math.floor(n / 2);
  const dx = -b.hx + ((d + 0.5) * b.hx * 2) / n;
  box(k, [1.4, 2.4, 0.16], [dx, 1.1, b.hz + 0.03], P.timber);
  box(k, [1.7, 0.25, 0.3], [dx, 2.45, b.hz + 0.08], P.chalkCap);
  if (lod) {
    for (const sx of [-1, 1]) k.limb([dx + sx * 0.95, 0, b.hz + 0.4], [dx + sx * 0.95, 2.4, b.hz + 0.4], 0.09, 0.08, P.chalkCap, 6);
    if (big) k.add(new CylinderGeometry(0.28, 0.32, 1.6, 6), { at: [b.hx * 0.6, b.height + 2.2, 0], colour: masonry(seed + 3), flat: true });
  }
  k.clearBase();
  if (big) sun(k, b.x - Math.sin(b.yaw) * (b.hz + 0.1), gy + b.height * 0.8, b.z + Math.cos(b.yaw) * (b.hz + 0.1), b.yaw, 0.4, 0);
}

// ---- the gatehouse -------------------------------------------------------------------------------------------------------------------

function gatehouse(k: Kit, world: CollisionWorld, lod: Lod): void {
  const plan = highmarkPlan();
  const gate = plan.gate;
  const y = (x: number, z: number): number => world.terrainHeight(x, z);
  for (const [i, t] of gate.towers.entries()) {
    const gy = y(t.x, t.z);
    k.setBase(t.x, gy, t.z, 0);
    slab(k, [t.hx * 2, t.height + 0.7, t.hz * 2], [0, (t.height - 0.7) / 2, 0], masonry(40 + i), lod);
    box(k, [t.hx * 2 + 0.4, 0.3, t.hz * 2 + 0.4], [0, t.height - 0.1, 0], P.chalkCap);
    pyramid(k, t.hx + 0.5, 4.2, [0, t.height + 0.05, 0]);
    k.add(new SphereGeometry(0.26, 6, 4), { at: [0, t.height + 4.4, 0], colour: P.sunGold });
    // a mast over the roof's tip: the Crown's cloth flies from it, higher than anything else on the gate
    mast(k, 0, t.height + 0.05 + 4.2, 0, 0.2 + GATE_MAST.height, 2.9);
    // merlons round the tower's parapet: a toothed rim under the pyramid, the stair a gate has against the sky
    if (lod) for (let m = -2; m <= 2; m++) for (const sz of [-1, 1]) box(k, [0.55, 0.5, 0.4], [m * 0.95, t.height + 0.4, sz * (t.hz + 0.05)], P.chalkCap);
    if (lod) {
      for (let r = 0; r < 2; r++) box(k, [0.3, 0.9, 0.12], [-0.9 + r * 1.8, t.height * 0.6, t.hz + 0.03], P.iron);
      box(k, [t.hx * 2 + 0.2, 0.22, t.hz * 2 + 0.2], [0, t.height * 0.4, 0], P.chalkCap);
    }
    k.clearBase();
  }
  // the lintel and its arch: a chalk block high enough to walk under, a cornice, the sun of the Crown on its face
  const l = gate.lintel;
  const gy = gate.y;
  k.setBase(l.x, gy, l.z, 0);
  slab(k, [l.hx * 2, l.height - 3.6, l.hz * 2], [0, 3.6 + (l.height - 3.6) / 2, 0], masonry(51), lod);
  box(k, [l.hx * 2 + 0.5, 0.3, l.hz * 2 + 0.5], [0, l.height + 0.1, 0], P.chalkCap);
  gable(k, l.hx + 0.3, l.hz + 0.5, 1.6, [0, l.height + 0.25, 0]);
  crest(k, l.hx * 2, [0, l.height + 0.25 + 1.6, 0], P.verdigrisLight, lod);
  k.clearBase();
  sun(k, l.x, gy + 5.0, l.z + l.hz + 0.06, 0, 0.62, lod);
  // the Chamberlain's Window: a counter in the inner face of the west tower, a brass grille, a ledge, a bell-pull and a number lamp
  {
    const t = gate.towers[0]!;
    k.setBase(t.x + t.hx, gate.y + 0.95, gate.z - 1.9, -Math.PI / 2);   // the inner face of the west tower, a step past the arch: where a petitioner stands
    box(k, [2.3, 1.7, 0.2], [0, 0.85, 0.02], P.chalkDark);
    box(k, [1.8, 1.3, 0.12], [0, 0.85, 0.12], P.iron);
    for (let i = -3; i <= 3; i++) k.limb([i * 0.24, 0.25, 0.2], [i * 0.24, 1.45, 0.2], 0.018, 0.018, P.bell, 4);
    box(k, [2.6, 0.14, 0.7], [0, -0.05, 0.3], P.chalkCap);
    box(k, [2.2, 0.1, 0.42], [0, 0.16, 0.25], P.timberLight);
    k.limb([1.35, 1.4, 0.2], [1.35, 0.1, 0.2], 0.02, 0.02, P.iron, 4);
    k.add(new SphereGeometry(0.1, 5, 4), { at: [1.35, 0.1, 0.22], colour: P.bell });
    k.clearBase();
  }
}

// ---- the palace ----------------------------------------------------------------------------------------------------------------------

function palace(k: Kit, world: CollisionWorld, lod: Lod): void {
  const p = highmarkPlan();
  const b = p.palace;
  const gy = world.terrainHeight(b.x, b.z);
  k.setBase(b.x, gy, b.z, 0);
  // three tiers like a wedding cake from the grassland: the base, a narrower hall above it, a belvedere above that; each tier has a chalk cap, a verdigris cornice and its own roof
  slab(k, [b.hx * 2, b.height + 0.7, b.hz * 2], [0, (b.height - 0.7) / 2, 0], masonry(70), lod);
  box(k, [b.hx * 2 + 0.5, 0.3, b.hz * 2 + 0.5], [0, b.height - 0.1, 0], P.chalkCap);
  box(k, [b.hx * 2 + 0.55, 0.18, b.hz * 2 + 0.55], [0, b.height * 0.55, 0], P.verdigris);
  const t2 = { hx: b.hx * 0.72, hz: b.hz * 0.75, h: 4.2 };
  slab(k, [t2.hx * 2, t2.h, t2.hz * 2], [0, b.height + t2.h / 2, -0.2], masonry(71), lod);
  box(k, [t2.hx * 2 + 0.4, 0.28, t2.hz * 2 + 0.4], [0, b.height + t2.h - 0.05, -0.2], P.chalkCap);
  box(k, [t2.hx * 2 + 0.45, 0.16, t2.hz * 2 + 0.45], [0, b.height + t2.h * 0.5, -0.2], P.verdigris);
  const t3 = { hx: b.hx * 0.42, hz: b.hz * 0.55, h: 3.2 };
  slab(k, [t3.hx * 2, t3.h, t3.hz * 2], [0, b.height + t2.h + t3.h / 2, -0.4], masonry(72), lod);
  box(k, [t3.hx * 2 + 0.35, 0.26, t3.hz * 2 + 0.35], [0, b.height + t2.h + t3.h - 0.05, -0.4], P.chalkCap);
  gable(k, t3.hx + 0.5, t3.hz + 0.6, 2.4, [0, b.height + t2.h + t3.h + 0.05, -0.4]);
  // pitched roofs over the lower tiers' set-backs (the cake's piped icing): a verdigris hip at each end. The west end of tier two carries the lit tower instead of its hip.
  for (const s of [-1, 1]) {
    pyramid(k, 1.5, 2.2, [s * (b.hx - 1.8), b.height + 0.1, b.hz - 1.5]);
    if (s === 1) pyramid(k, 1.2, 1.8, [s * (t2.hx - 1.4), b.height + t2.h + 0.1, -0.2]);
  }
  crest(k, (t3.hx + 0.5) * 2 - 0.8, [0, b.height + t2.h + t3.h + 0.05 + 2.4, -0.4], P.verdigrisLight, lod);
  // pinnacles on tier two's four corners, masts (and their gilt balls) on the base's two front corners: the vertical teeth of the skyline
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const P2 = TIER2_PINNACLE;
    spire(k, [sx * (t2.hx - P2.inset), b.height + t2.h + 0.05, -0.2 + sz * (t2.hz - P2.inset)], P2.plinth, P2.spire, 0.5, P.verdigrisDark);
  }
  for (const sx of [-1, 1]) mast(k, sx * (b.hx - PALACE_MAST.inset), b.height, b.hz - PALACE_MAST.inset, PALACE_MAST.height, 3.0);
  // the bell-gable: a slim tower on the ridge with an open arch, a bronze bell and a pitched roof (taller than it was: 4.2 m of posts, a 3 m roof)
  const bell = { y: b.height + t2.h + t3.h + 2.4 + 0.05 };
  k.setBase(b.x, gy + bell.y, b.z - 0.4, 0);
  const BG = BELL_GABLE;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * 0.9, 0, sz * 0.9], [sx * 0.9, BG.posts, sz * 0.9], 0.2, 0.17, P.chalkCap, 6);
  box(k, [2.4, 0.22, 2.4], [0, BG.posts + 0.1, 0], P.chalkCap);
  box(k, [2.0, 0.18, 2.0], [0, BG.posts * 0.5, 0], P.verdigris);
  k.add(new CylinderGeometry(0.34, 0.62, 0.9, lod ? 10 : 6), { at: [0, BG.posts * 0.55, 0], colour: P.bell, flat: true });
  k.limb([0, BG.posts, 0], [0, BG.posts * 0.55 + 0.45, 0], 0.06, 0.06, P.iron, 4);
  pyramid(k, 1.45, BG.cap, [0, BG.posts + 0.2, 0], P.roofDeep);
  k.add(new SphereGeometry(BG.finial, 6, 4), { at: [0, BG.posts + 0.2 + BG.cap + 0.05, 0], colour: P.sunGold });
  k.clearBase();
  // the lit tower: a slim chalk shaft on tier two's west end, a gallery, a glazed lantern room (its glass is the view's own mesh, dark by day and lit at the harvest bell hour), a deep verdigris
  // cap and a gilt spire. The tallest thing in the capital by eight metres: the one the eye finds from the plain.
  const T = LANTERN_TOWER;
  const tb = b.height + t2.h + 0.28;
  k.setBase(b.x + T.dx, gy + tb, b.z + T.dz, 0);
  slab(k, [T.half * 2, T.shaft, T.half * 2], [0, T.shaft / 2, 0], masonry(75), lod);
  for (const y of [3.2, 6.4]) box(k, [T.half * 2 + 0.25, 0.2, T.half * 2 + 0.25], [0, y, 0], P.verdigris);
  for (const y of [1.8, 4.8, 8.0]) box(k, [0.22, 0.9, 0.1], [0, y, T.half + 0.02], P.iron);
  box(k, [T.half * 2 + 0.9, 0.3, T.half * 2 + 0.9], [0, T.shaft + 0.1, 0], P.chalkCap);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.limb([sx * (T.half - 0.1), T.shaft + 0.25, sz * (T.half - 0.1)], [sx * (T.half - 0.1), T.shaft + 0.25 + T.room, sz * (T.half - 0.1)], 0.13, 0.11, P.chalkCap, 6);
  }
  box(k, [T.half * 2 + 0.5, 0.22, T.half * 2 + 0.5], [0, T.shaft + 0.25 + T.room + 0.1, 0], P.chalkCap);
  pyramid(k, T.half + 0.55, T.cap, [0, T.shaft + 0.25 + T.room + 0.2, 0], P.roofDeep);
  const spireBase = T.shaft + 0.25 + T.room + 0.2 + T.cap;
  k.limb([0, spireBase - 0.2, 0], [0, spireBase + T.spire, 0], 0.09, 0.04, P.iron, 5);
  k.add(new SphereGeometry(0.2, 6, 4), { at: [0, spireBase + T.spire + 0.1, 0], colour: P.sunGold });
  k.clearBase();
  // the front: a flight of steps, a colonnade of slim columns, the great door, and the Crown's sun over it
  k.setBase(b.x, gy, b.z + b.hz, 0);
  for (let i = 0; i < 4; i++) box(k, [5.4 - i * 0.5, 0.2, 1.6 - i * 0.28], [0, 0.1 + i * 0.2, 1.1 - i * 0.14], P.chalkCap);
  box(k, [2.2, 3.2, 0.2], [0, 1.6 + 0.8, 0.04], P.timber);
  for (let i = -2; i <= 2; i++) if (i !== 0) k.limb([i * 3.1, 0.8, 0.9], [i * 3.1, b.height - 0.3, 0.9], 0.24, 0.2, P.chalkCap, lod ? 8 : 6);
  box(k, [b.hx * 2 + 0.3, 0.3, 1.4], [0, b.height - 0.05, 0.6], P.chalkCap);
  k.clearBase();
  sun(k, b.x, gy + b.height * 0.74, b.z + b.hz + 0.12, 0, 0.55, lod);
  // the Vacant Chair on its dais, the plinths with their stags, the sun medallion's rays
  const th = p.throne;
  const ty = world.terrainHeight(th.x, th.z);
  k.setBase(th.x, ty, th.z, 0);
  box(k, [2.6, 0.3, 2.2], [0, 0.15, 0], P.chalkShade);
  box(k, [1.8, 0.18, 1.5], [0, 0.36, 0], P.crownRed);
  box(k, [1.1, 0.5, 1.0], [0, 0.55, 0.0], P.sunGold);
  box(k, [1.0, 0.1, 0.9], [0, 0.85, 0.05], P.crownRed);
  box(k, [1.0, 1.4, 0.16], [0, 1.4, -0.38], P.sunGold);
  for (const sx of [-1, 1]) box(k, [0.14, 0.55, 0.8], [sx * 0.52, 1.0, 0], P.sunGold);
  k.add(new SphereGeometry(0.1, 6, 4), { at: [0, 2.2, -0.38], colour: P.sunGold });
  k.clearBase();
  for (const [i, pl] of p.plinths.entries()) {
    const py = world.terrainHeight(pl.x, pl.z);
    k.setBase(pl.x, py, pl.z, 0);
    k.add(new CylinderGeometry(pl.r, pl.r * 1.15, 1.2, lod ? 10 : 6), { at: [0, 0.5, 0], colour: masonry(80 + i), flat: true, perFace: true });
    k.add(new CylinderGeometry(pl.r * 1.2, pl.r * 1.2, 0.2, lod ? 10 : 6), { at: [0, 1.15, 0], colour: P.chalkCap, flat: true });
    k.clearBase();
    stag(k, pl.x, py + 1.25, pl.z, i === 0 ? 0.6 : Math.PI - 0.6, 0.62, P.stagBrown);
  }
  // the court's sun medallion: sixteen gilt rays round the pale disc the ground is painted with
  const c = HIGHMARK_ANCHORS.capital.court;
  const cy = world.terrainHeight(c.x, c.z);
  k.setBase(c.x, cy + 0.03, c.z, 0);
  const rays = lod ? 16 : 8;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    k.add(new ConeGeometry(0.34, 1.7, 3, 1), { at: [Math.cos(a) * 5.7, 0.02, Math.sin(a) * 5.7], rot: [0, -a, -Math.PI / 2], colour: P.sunGold, flat: true });
  }
  k.add(new CylinderGeometry(1.1, 1.1, 0.05, lod ? 18 : 8), { at: [0, 0.02, 0], colour: P.sunGold, flat: true });
  k.clearBase();
}

// ---- lamps, stones, quay, camp ----------------------------------------------------------------------------------------------------

function lamp(k: Kit, x: number, z: number, gy: number, h: number): void {
  k.limb([x, gy - 0.3, z], [x, gy + h, z], 0.12, 0.09, P.iron, 6);
  k.limb([x, gy + h * 0.55, z], [x + 0.45, gy + h * 0.78, z], 0.03, 0.03, P.iron, 4);
  // the lantern is a cage (four corner posts, a floor and a verdigris cap) round a gilt flame, not a solid box: the point of light the view adds must be seen through it
  box(k, [0.36, 0.06, 0.36], [x, gy + h + 0.02, z], P.iron);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([x + sx * 0.15, gy + h + 0.03, z + sz * 0.15], [x + sx * 0.15, gy + h + 0.5, z + sz * 0.15], 0.025, 0.025, P.iron, 4);
  k.add(new SphereGeometry(0.11, 6, 4), { at: [x, gy + h + 0.26, z], colour: P.lampGlow });
  pyramid(k, 0.28, 0.3, [x, gy + h + 0.5, z], P.verdigrisDark);
}

const NUMERALS = ["I", "II", "III", "IV", "V"] as const;
function milestone(k: Kit, x: number, z: number, gy: number, n: number, lod: Lod): void {
  k.setBase(x, gy, z, 0);
  k.add(new CylinderGeometry(0.22, 0.34, 1.3, 4, 1), { at: [0, 0.55, 0], rot: [0, Math.PI / 4, 0], colour: masonry(90 + n), flat: true, perFace: true });
  k.add(new ConeGeometry(0.3, 0.32, 4, 1), { at: [0, 1.38, 0], rot: [0, Math.PI / 4, 0], colour: P.verdigris, flat: true });
  if (lod) for (let i = 0; i < Math.min(5, n); i++) box(k, [0.05, 0.4, 0.05], [-0.18 + i * 0.09, 0.85, 0.27], P.chalkDark, [0, 0, 0]);
  void NUMERALS;
  k.clearBase();
}

function waitingStone(k: Kit, x: number, z: number, gy: number, i: number): void {
  k.setBase(x, gy, z, h01(95, i) * 3);
  k.add(new SphereGeometry(0.62, 8, 6), { at: [0, 0.2, 0], scale: [1, 0.78, 1.15], colour: masonry(96 + i, P.chalkShade, P.chalkDark), flat: true, perFace: true });
  box(k, [0.7, 0.07, 0.7], [0, 0.82, 0], P.chalkCap);
  k.clearBase();
}

function quay(k: Kit, lod: Lod, y: number): void {
  const q = highmarkPlan().quay;
  const len = q.z1 - q.z0;
  const planks = Math.round(len / 0.55);
  for (let i = 0; i < (lod ? planks : Math.round(planks / 3)); i++) {
    const w = lod ? 0.5 : 1.55;
    const z = q.z0 + (i + 0.5) * (lod ? 0.55 : 1.65);
    box(k, [q.half * 2, 0.14, w], [q.x, HIGHMARK.level - 0.05, z], i % 3 === 0 ? P.timberLight : P.timber);
  }
  for (const s of [-1, 1]) for (let z = q.z0 + 0.5; z < q.z1; z += 3.2) k.limb([q.x + s * (q.half + 0.05), -2, z], [q.x + s * (q.half + 0.05), HIGHMARK.level + 0.9, z], 0.1, 0.09, P.timber, 5);
  for (const b of q.bollards) k.limb([b.x, y - 0.4, b.z], [b.x, y + 0.9, b.z], 0.2, 0.17, P.iron, 7);
  // the barge: a long timber hull, a stubby mast with the sail furled on its boom, crates and sacks; ropes to the quay
  const bt = q.boat;
  k.setBase(bt.x, HIGHMARK.level + HIGHMARK.river.water + 0.05, bt.z, bt.yaw);
  const hull = new BoxGeometry(2.7, 0.9, 7.4, 1, 1, 6);
  const hp = hull.attributes.position as BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    const zz = hp.getZ(i);
    const taper = 1 - Math.pow(Math.abs(zz) / 3.7, 3) * 0.7;
    if (hp.getY(i) < 0) hp.setX(i, hp.getX(i) * taper * 0.85);
    else hp.setX(i, hp.getX(i) * taper);
    if (Math.abs(zz) > 3.6) hp.setY(i, hp.getY(i) + (hp.getY(i) > 0 ? 0.3 : 0));
  }
  k.add(hull, { at: [0, 0, 0], colour: (p, n, out) => blend(out, P.hull, P.timber, n.y > 0.5 ? 0.45 : Math.max(0, -p.y) * 0.6), flat: true });
  box(k, [2.1, 0.08, 6.4], [0, 0.45, 0], P.timberLight);
  k.limb([0, 0.45, -0.6], [0, 4.2, -0.6], 0.1, 0.07, P.timber, 6);
  k.limb([-1.4, 3.3, -0.6], [1.5, 3.3, -0.6], 0.07, 0.07, P.timber, 5);
  k.add(new CylinderGeometry(0.2, 0.2, 2.8, 8), { at: [0, 3.15, -0.6], rot: [0, 0, Math.PI / 2], colour: P.crownCream, flat: true });
  box(k, [0.7, 0.5, 0.7], [0.5, 0.78, 1.6], P.timberLight);
  box(k, [0.6, 0.45, 0.6], [-0.5, 0.75, 2.1], P.timber);
  k.add(new SphereGeometry(0.34, 6, 4), { at: [0.3, 0.75, 2.6], scale: [1, 0.8, 1], colour: P.grangeWheat, flat: true });
  k.clearBase();
}

function camp(k: Kit, world: CollisionWorld, lod: Lod): void {
  const c = highmarkPlan().camp;
  for (const t of c.tents) {
    k.setBase(t.x, world.terrainHeight(t.x, t.z), t.z, t.yaw);
    tent(k, lod);
  }
  const fy = world.terrainHeight(c.fire.x, c.fire.z);
  k.setBase(c.fire.x, fy, c.fire.z, 0);
  for (let i = 0; i < (lod ? 9 : 6); i++) {
    const a = (i / (lod ? 9 : 6)) * Math.PI * 2;
    k.add(new SphereGeometry(0.2, 5, 4), { at: [Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62], scale: [1, 0.7, 1], colour: PALETTE.camp.fireStone, flat: true });
  }
  k.add(new CylinderGeometry(0.55, 0.6, 0.06, 10), { at: [0, 0.03, 0], colour: PALETTE.camp.ash, flat: true });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    k.limb([Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5], [-Math.cos(a) * 0.5, 0.2, -Math.sin(a) * 0.5], 0.07, 0.07, i === 0 ? PALETTE.camp.charred : PALETTE.camp.log, 5);
  }
  k.add(new SphereGeometry(0.16, 5, 4), { at: [0, 0.14, 0], colour: PALETTE.camp.ember, flat: true });
  k.clearBase();
  // the herders' stick: a flagpole with a rag of hide, a drying rack
  const fg = world.terrainHeight(c.flag.x, c.flag.z);
  k.limb([c.flag.x, fg - 0.2, c.flag.z], [c.flag.x, fg + 5, c.flag.z], 0.1, 0.07, P.timber, 6);
  k.setBase(c.flag.x, fg + 4.1, c.flag.z, 0);
  box(k, [0.04, 0.9, 1.5], [0.05, 0, 0.8], P.hide);
  box(k, [0.05, 0.25, 1.5], [0.05, 0.1, 0.8], P.hideDark);
  k.clearBase();
}

/** Free-standing banner poles (the Grange's and the Syndicate's hang from one; the Crown's hang on the walls). */
function poles(k: Kit, world: CollisionWorld): void {
  for (const b of highmarkPlan().banners) {
    if (b.kind === "crown") continue;
    const y = world.terrainHeight(b.x, b.z);
    k.limb([b.x, y - 0.2, b.z], [b.x, y + b.top + 0.4, b.z], 0.11, 0.08, P.timber, 6);
    k.add(new SphereGeometry(0.16, 5, 4), { at: [b.x, y + b.top + 0.5, b.z], colour: P.sunGold });
  }
  // the terraces' masts (skyline.ts): a pole on every riser's coping, flying the cloth the skyline adds
  for (const m of terraceMasts()) mast(k, m.x, m.base, m.z, TERRACE_MAST.height, 2.1);
}

/** The market's well and the guild terrace's lamps are drawn here too. */
function wellAt(k: Kit, world: CollisionWorld, lod: Lod): void {
  const w = highmarkPlan().well;
  const y = world.terrainHeight(w.x, w.z);
  k.setBase(w.x, y, w.z, 0);
  k.add(new CylinderGeometry(w.r, w.r + 0.1, w.height, lod ? 12 : 8, 1, true), { at: [0, w.height / 2, 0], colour: masonry(120), flat: true });
  k.add(new CylinderGeometry(w.r + 0.15, w.r + 0.15, 0.2, lod ? 12 : 8), { at: [0, w.height, 0], colour: P.chalkCap, flat: true });
  k.add(new CylinderGeometry(w.r - 0.1, w.r - 0.1, 0.05, 8), { at: [0, w.height - 0.25, 0], colour: P.iron });
  for (const s of [-1, 1]) k.limb([s * (w.r + 0.05), w.height, 0], [s * (w.r + 0.05), w.height + 1.9, 0], 0.07, 0.06, P.timber, 5);
  box(k, [w.r * 2 + 0.5, 0.1, 0.12], [0, w.height + 1.9, 0], P.timber);
  pyramid(k, w.r + 0.4, 0.6, [0, w.height + 1.95, 0], P.verdigrisDark);
  k.clearBase();
}

/** Where the lit tower's glazed room is (world coordinates) and how big: the view draws its glass as a mesh of its own, because that glass is what the day turns on and off. */
export interface LanternRoom {
  x: number;
  y: number;
  z: number;
  /** Half the width (x and z) and the height of the glass. */
  half: number;
  height: number;
}

export function lanternRoom(world: CollisionWorld): LanternRoom {
  const b = highmarkPlan().palace;
  const T = LANTERN_TOWER;
  const H = palaceHeights();
  const gy = world.terrainHeight(b.x, b.z);
  return { x: b.x + T.dx, y: gy + H.base + H.t2 + 0.28 + T.shaft + 0.25 + T.room / 2, z: b.z + T.dz, half: T.half - 0.26, height: T.room - 0.12 };
}

/** Everything solid in Highmark, merged. `lod` 0 is the cheap shape the ink hull and the low preset use. */
export function buildHighmarkSolid(world: CollisionWorld, lod: Lod): { geometry: BufferGeometry | undefined; lamps: { x: number; y: number; z: number }[]; lantern: LanternRoom } {
  const plan = highmarkPlan();
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  const k = new Kit();
  plan.walls.forEach((w, i) => wall(k, w, lod, 10 + (i % 17)));
  plan.granaries.forEach((s, i) => granary(k, s, g(s.x, s.z), lod, 30 + i));
  plan.stalls.forEach((s, i) => stall(k, s, g(s.x, s.z), lod, i));
  wellAt(k, world, lod);
  plan.halls.forEach((b, i) => hall(k, b, g(b.x, b.z), lod, 100 + i * 5, i === 0));
  gatehouse(k, world, lod);
  palace(k, world, lod);
  // lamps: a post, a lantern and the point of light the view adds
  const lamps: { x: number; y: number; z: number }[] = [];
  for (const l of plan.lamps) {
    const y = g(l.x, l.z);
    lamp(k, l.x, l.z, y, l.h);
    lamps.push({ x: l.x, y: y + l.h + 0.2, z: l.z });
  }
  plan.milestones.forEach((m) => milestone(k, m.x, m.z, g(m.x, m.z), m.n, lod));
  plan.waitingStones.forEach((s, i) => waitingStone(k, s.x, s.z, g(s.x, s.z), i));
  quay(k, lod, HIGHMARK.level);
  camp(k, world, lod);
  poles(k, world);
  void HIGHMARK_SITES;
  k.clearBase();
  return { geometry: k.build(), lamps, lantern: lanternRoom(world) };
}
