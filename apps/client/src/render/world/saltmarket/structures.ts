import { BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from "three";
import { pane, type LitPane } from "../litWindows.ts";
import { PALETTE, SALTMARKET, SALTMARKET_ANCHORS, hash3, saltmarketLevel, saltmarketPlan, type CollisionWorld, type SaltmarketBox, type SaltmarketBoat, type SaltmarketHair } from "./shared.ts";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import { SIGN_BOARD } from "./cloth.ts";
import type { Lod } from "../flora.ts";
import { RoofKits, interiorShell, sealedDoor, type DoorMark, type LevelBuilding, type RoofSource, type SealedStyle, type ShellStyle } from "../rooms.ts";

/**
 * Every solid thing in the Saltmarket Delta merged into a few vertex-coloured geometries (one draw and one ink hull each, split four ways over the map so the frustum can cull): the quay and its pontoon, the three
 * bridges and the Customs Bridge's gate, the revetment of piles along the deep cuts (the very boxes the collision world has), the boardwalk planks, the warehouses and huts on stilts, the Customs House, the
 * drop-house, the Exchange (colonnade, roof, tide marks, the rostrum) and its campanile, the cranes, derrick, windpumps, masts and lantern poles (the "hairs" on the line), the boats, the drying racks and salt pans.
 * Everything is placed from `saltmarketPlan()` and the terrain: the pile you see is the pile you bump into. Tarred plank, silvered piling, indigo and brick-coral canvas; palette colours only. Latin-letter signage,
 * no dome, minaret or script.
 */

const P = PALETTE.saltmarket;
const L = SALTMARKET.level;
const h01 = (seed: number, a: number, b = 0, c = 0): number => hash3(seed, Math.round(a * 10), Math.round(b * 10), c) / 4294967296;
const plain = (c: number): ColourFn => (_p, _n, out) => void out.set(c);

/** Vertical planks: each a shade of its own; tops pale, undersides dark. */
const planks = (seed: number, base: number = P.tarPlank, dark: number = P.tarPlankDark, light: number = P.tarPlankLight): ColourFn => (p, n, out) => {
  if (n.y > 0.6) return void out.set(light);
  if (n.y < -0.6) return void out.set(dark);
  const u = Math.abs(n.x) > 0.5 ? p.z : p.x;
  const i = Math.floor(u / 0.26);
  const r = h01(seed, i, Math.round(p.y * 0.4));
  blend(out, base, r > 0.8 ? light : dark, r > 0.8 ? (r - 0.8) * 3 : r * 0.7);
};
/** Silvered piling: weathered grey, dark at the waterline. */
const piling = (seed: number, len = 2): ColourFn => (p, _n, out) => {
  blend(out, P.piling, P.pilingLight, h01(seed, p.x, p.z) * 0.6);
  const low = -len / 2 + 0.5 - p.y;   // the lowest half-metre, at the waterline, is weed-dark
  if (low > 0) blend(out, out.getHex(), P.pilingDark, Math.min(1, low * 1.6));
};
/** Canvas panels along a slope: alternating deep and light bands. */
const canvas = (a: number, b: number, k = 1.5): ColourFn => (p, n, out) => {
  blend(out, a, b, (Math.floor((p.x + p.z * 0.6) * k) & 1) * 0.7 + Math.max(0, n.y) * 0.15);
};
const thatch = (seed: number): ColourFn => (p, n, out) => {
  blend(out, P.thatchDark, P.thatch, Math.max(0, n.y) * 0.5 + h01(seed, p.x * 2.5, p.z * 2.5) * 0.5);
};
const stripes = (a: number, b: number, k = 1.6): ColourFn => (p, _n, out) => out.set(Math.floor((p.x + p.z + 40) * k) % 2 ? a : b);

const box = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true, perFace: typeof colour !== "number" });
};

/** A gable roof: the ridge runs along local x. `hx`/`hz` are half the eave extents, `h` the rise; both gable ends are closed. */
function gable(k: Kit, hx: number, hz: number, h: number, at: V3, colour: ColourFn | number): void {
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

/** A four-sided hipped roof over a rectangle (half extents hx, hz), peak `h` above the eave. */
function hip(k: Kit, hx: number, hz: number, h: number, at: V3, colour: ColourFn | number): void {
  const g = new ConeGeometry(1, h, 4, 1);
  g.rotateY(Math.PI / 4);
  const p = g.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, p.getX(i) * hx * Math.SQRT2);
    p.setZ(i, p.getZ(i) * hz * Math.SQRT2);
  }
  g.computeVertexNormals();
  k.add(g, { at: [at[0], at[1] + h / 2, at[2]], colour, flat: true, perFace: typeof colour !== "number" });
}

/** A pile: a tapered tube from `y0` up to `y1`, silvered. */
const pile = (k: Kit, x: number, z: number, y0: number, y1: number, r = 0.13, seed = 1, radial = 5): void => {
  k.limb([x, y0, z], [x, y1, z], r, r * 0.9, piling(seed, y1 - y0), radial);
};

// ---- stilted houses ----------------------------------------------------------------------------------------------------------------------

type HouseStyle = "warehouse" | "hut" | "customs" | "dropHouse";

/** The warm inside of a stilt house: tarred plank lightened, a floor of silvered boards, a lantern. Never `INTERIOR` black. */
const SHELL: ShellStyle = { outer: P.tarPlank, inner: P.tarPlankLight, floor: P.tarPlankLight, floorDark: P.tarPlank, trim: P.pilingDark, leaf: P.tarPlankDark, strap: P.iron, lamp: P.glowWindow, ceiling: P.thatch };
const SEALED: SealedStyle = { frame: P.pilingDark, door: P.tarPlankDark, board: P.tarPlankLight, boardDark: P.piling, iron: P.iron, brass: P.brass, paper: P.salt, wax: P.coralDark };

/** What `stiltHouse` leaves behind: the doors drawn, the lamps lit inside, the roofs for the cutaway. */
export interface HouseOut {
  marks: DoorMark[];
  lamps: { x: number; y: number; z: number; lit?: number }[];
  roofs: RoofKits;
  /** D-089: the window panes (lit at night by whoever is home). */
  panes: LitPane[];
}

/** The furniture of an enterable house, in its frame, floor at `fl`: kept to 1.2 m, with the 1.0 m strip from the door to the middle clear (LEVEL_PLAN section 4). */
function furnish(k: Kit, lb: LevelBuilding, fl: number, lod: Lod): void {
  const { hx, hz } = lb;
  const crate = (x: number, z: number, h = 0.7, w = 0.7): void => box(k, [w, h, w], [x, fl + h / 2, z], P.tarPlankLight);
  const barrel = (x: number, z: number): void => void k.add(new CylinderGeometry(0.3, 0.3, 0.8, lod ? 8 : 6), { at: [x, fl + 0.4, z], colour: P.tarPlank, flat: true });
  const shelf = (x: number, z: number, along: "x" | "z", len: number): void => {
    for (const y of [0.5, 1.0, 1.5]) box(k, along === "x" ? [len, 0.06, 0.35] : [0.35, 0.06, len], [x, fl + y, z], P.tarPlankLight);
    for (const e of [-1, 1]) box(k, [0.08, 1.6, 0.08], along === "x" ? [x + e * len / 2, fl + 0.8, z] : [x, fl + 0.8, z + e * len / 2], P.pilingDark);
  };
  if (lb.id === "warehouse0" || lb.id === "warehouse1") {
    // goods against the walls: crates stacked two high, barrels in a row, a hoist sling over a hatch; the middle and the aisle to the door stay clear
    for (let i = 0; i < 3; i++) crate(-hx + 0.9, -hz + 0.9 + i * 0.85, 0.7 + (i === 1 ? 0.7 : 0));
    for (let i = 0; i < 4; i++) barrel(-hx + 1.0 + i * 0.75, hz - 0.7);
    crate(hx * 0.2, -hz + 0.7, 0.9, 0.8);
    if (lb.id === "warehouse0") {
      // the Brine Counting-Shed: a counting table, a stool and a ledger
      box(k, [1.6, 0.08, 0.8], [-hx * 0.3, fl + 0.9, -hz * 0.45], P.tarPlankLight);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(k, [0.08, 0.9, 0.08], [-hx * 0.3 + sx * 0.7, fl + 0.45, -hz * 0.45 + sz * 0.33], P.pilingDark);
      box(k, [0.4, 0.06, 0.3], [-hx * 0.3, fl + 0.97, -hz * 0.45], P.salt);
    } else {
      // the Society Bonded Shed: the smuggling run's cargo is "inside" — the stencilled stacks and a bonded-stores cage
      for (let i = 0; i < 3; i++) crate(-hx * 0.2 + i * 0.85, -hz + 0.7, 0.7, 0.75);
      box(k, [0.06, 1.4, 1.8], [hx * 0.3, fl + 0.7, hz - 1.0], P.iron);
    }
    return;
  }
  if (lb.id === "customs") {
    // the Constabulary's counting-house: a long desk across the back with the Tide-Reeve's chair, a ledger rack, a stamp and a brass lamp; benches for the parley
    box(k, [0.9, 0.08, 2.4], [-hx + 1.0, fl + 0.95, 0], P.tarPlankLight);
    for (const sz of [-1, 1]) box(k, [0.8, 0.9, 0.08], [-hx + 1.0, fl + 0.47, sz * 1.1], P.tarPlank);
    box(k, [0.4, 0.5, 0.4], [-hx + 0.5, fl + 0.25, -0.2], P.tarPlankDark);
    shelf(-hx + 0.3, hz - 0.5, "z", 1.4);
    box(k, [0.14, 0.14, 0.14], [-hx + 1.0, fl + 1.05, 0.6], P.brass);
    for (const sz of [-1, 1]) box(k, [0.4, 0.4, 1.2], [hx * 0.4, fl + 0.2, sz * (hz - 0.8)], P.tarPlankLight);
    return;
  }
  // the drop house: a bare room, a hatch in the floor with a ring, a crate or two, a lantern on a hook
  box(k, [1.0, 0.04, 1.0], [-hx * 0.35, fl + 0.02, hz * 0.35], P.tarPlankDark);
  k.add(new TorusGeometry(0.09, 0.02, 4, 8), { at: [-hx * 0.35, fl + 0.06, hz * 0.35], rot: [Math.PI / 2, 0, 0], colour: P.iron, flat: true });
  crate(-hx + 0.7, -hz + 0.7);
  crate(-hx + 0.7, -hz + 1.5, 0.5, 0.6);
}

/**
 * A house on stilts, by what the plan says it IS (docs/LEVEL_PLAN.md section 7). `interior`: stilts, a deck with the landing and steps the collision has, hollow walls with a doorway of the declared width, warm inner
 * faces, a lantern, furniture, and a roof drawn into its own kit for the cutaway. `sealed`: a mass with its loading door SHUT (boards, a chain and a seal). `solid`: a mass with no door at all (windows only).
 * `b.height` is the highest point above the ground (the ridge): everything stands inside it. The door is on local +x for every kind.
 */
function stiltHouse(k: Kit, b: SaltmarketBox, gy: number, style: HouseStyle, lb: LevelBuilding, lod: Lod, seed: number, out: HouseOut): void {
  const total = b.height - (style === "customs" ? 0.75 : 0);   // (the Customs House's brass lantern stands on the ridge, inside the collider's top)
  const fy = lb.floor;
  // (a sealed hut's wall stands 2.6 m, tall enough for the door it shows; a solid hut keeps the low reed wall it always had)
  const wallH = lb.kind === "interior" || lb.kind === "sealed" ? (lb.kind === "sealed" ? 2.6 : lb.wallH) : Math.max(1.5, total - fy - (style === "hut" ? Math.min(1.3, total * 0.34) : Math.min(1.2, (total - fy) * 0.34)));
  // the eave sits ON the walls: a box-walled house stands its walls on its 0.16 floor slab (top at fy + 0.08); the interior shell's walls rise from the floor itself (fy .. fy + wallH)
  const eaveY = fy + (lb.kind === "interior" ? 0 : 0.08) + wallH;
  const rise = Math.max(0.5, total - fy - 0.08 - wallH) + (fy + 0.08 + wallH - eaveY);   // (the ridge stays where it was)
  k.setBase(b.x, gy, b.z, b.yaw);
  // stilts: two rows, braced (the front row stops short of the landing)
  const n = Math.max(2, Math.round((b.hx * 2) / 2.4) + 1);
  for (let i = 0; i < n; i++) {
    const x = -b.hx + 0.3 + (i * (b.hx * 2 - 0.6)) / (n - 1);
    for (const z of [-1, 1]) pile(k, x, z * (b.hz - 0.3), -0.5, fy + 0.05, 0.12, seed + i * 3 + (z > 0 ? 1 : 0), lod ? 5 : 4);
  }
  if (lod) for (const s of [-1, 1]) {
    k.limb([-b.hx + 0.3, -0.2, s * (b.hz - 0.3)], [-b.hx + 1.5, fy, s * (b.hz - 0.3)], 0.045, 0.045, P.pilingDark, 4);
    k.limb([b.hx - 0.3, -0.2, s * (b.hz - 0.3)], [b.hx - 1.5, fy, s * (b.hz - 0.3)], 0.045, 0.045, P.pilingDark, 4);
  }
  const roofKit = lb.kind === "interior" ? out.roofs.begin(lb.id) : k;
  if (roofKit !== k) roofKit.setBase(b.x, gy, b.z, b.yaw);
  if (lb.kind === "interior") {
    interiorShell(k, { id: lb.id, hx: b.hx, hz: b.hz, floor: fy, wallH, door: lb.door, doorH: lb.doorH, steps: lb.steps, t: lb.t ?? 0.3 }, { ...SHELL, outer: style === "customs" ? planks(seed, P.coralDark, P.tarPlankDark, P.coralCanvas) : planks(seed) }, lod, out.marks, { x: b.x, y: gy, z: b.z, yaw: b.yaw });
    if (!lod && lb.steps > 0 && fy > 0.3) {
      // the shell draws its steps' side stringers only at lod 1; the cheap shape still needs them, or the treads hang in the air (the same boxes, so the ink hull matches)
      const w = Math.max(lb.door + 1.0, 2.2);
      for (let i = 1; i <= lb.steps; i++) {
        const top = (fy * (lb.steps - i + 1)) / lb.steps;
        const depth = i === 1 ? 1.0 : 0.5;
        const off = b.hx + (i === 1 ? 0.5 : 1.0 + (i - 2) * 0.5 + 0.25);
        for (const sz of [-1, 1]) box(k, [depth, top + 0.3, 0.08], [off, (top - 0.3) / 2, sz * (w / 2 - 0.04)], SHELL.trim);
      }
    }
    const lw = k.worldPoint(-b.hx * 0.15, fy + Math.min(wallH - 0.5, 2.3), 0);
    out.lamps.push({ x: lw[0], y: lw[1], z: lw[2], lit: 0.7 });   // (a lamp in a room burns bright even at noon: it is seen through the door at any hour)
    furnish(k, lb, fy, lod);
  } else {
    // a floor and a mass of wall: the hut's reed matting or the warehouse's planks
    box(k, [b.hx * 2 + 0.3, 0.16, b.hz * 2 + 0.3], [0, fy, 0], P.tarPlankLight);
    const wallCol = style === "hut" ? stripes(P.reed, P.reedDark, 3.4) : planks(seed);
    box(k, [b.hx * 2, wallH, b.hz * 2], [0, fy + 0.08 + wallH / 2, 0], wallCol);
  }
  // the roof (the roof kit: the cutaway lifts it when the viewer is inside)
  if (style === "hut") {
    hip(roofKit, b.hx + 0.5, b.hz + 0.5, rise, [0, eaveY, 0], thatch(seed));
  } else {
    const roofCol = style === "customs" ? canvas(P.indigoCanvas, P.indigoDark, 1.3) : style === "dropHouse" ? canvas(P.tarPlank, P.tarPlankDark, 1.1) : canvas(P.indigoCanvas, P.indigoLight, 1.2);
    box(roofKit, [b.hx * 2 + 0.5, 0.14, b.hz * 2 + 0.5], [0, eaveY + 0.03, 0], P.tarPlankDark);
    gable(roofKit, b.hx + 0.45, b.hz + 0.45, rise, [0, eaveY + 0.08, 0], roofCol);
    box(roofKit, [b.hx * 2 + 0.9, 0.09, 0.2], [0, eaveY + 0.08 + rise + 0.02, 0], P.coralCanvas);   // a coral ridge cap
  }
  if (lb.kind === "interior") {
    // (the roof kit shares the base: re-base it so its parts land on the house)
    // windows: shuttered openings in the long walls, glowing at dusk with the room's lantern
    if (lod) for (const sz of [-1, 1]) for (const sx of [-0.5, 0.35]) {
      box(k, [0.7, 0.6, 0.08], [sx * b.hx * 0.8, fy + 0.08 + wallH * 0.62, sz * (b.hz + 0.02)], P.iron);
      pane(out.panes, k, sx * b.hx * 0.8, fy + 0.08 + wallH * 0.62, sz * (b.hz + 0.06), sz as 1 | -1, 0.54, 0.44, seed);
      box(k, [0.9, 0.08, 0.16], [sx * b.hx * 0.8, fy + 0.08 + wallH * 0.62 - 0.36, sz * (b.hz + 0.05)], P.pilingLight);
    }
    // an awning over the door (coral and salt) and the hoist beam of a warehouse
    if (style === "warehouse" || style === "customs") k.add(new BoxGeometry(1.0, 0.06, Math.max(2.2, lb.door + 0.9)), { at: [b.hx + 0.47, fy + 0.08 + Math.min(wallH, lb.doorH + 0.35), 0], rot: [0, 0, -0.28], colour: stripes(P.coralCanvas, P.salt, 3.4), flat: true, perFace: true });
    if (style === "warehouse") {
      box(k, [1.9, 0.14, 0.14], [b.hx + 0.6, eaveY + 0.1, b.hz * 0.5], P.tarPlankDark);
      k.limb([b.hx + 1.5, eaveY + 0.1, b.hz * 0.5], [b.hx + 1.5, eaveY - 1.4, b.hz * 0.5], 0.012, 0.012, P.rope, 3);
      box(k, [0.2, 0.2, 0.2], [b.hx + 1.5, eaveY - 1.5, b.hz * 0.5], P.iron);
    }
    if (style === "customs") {
      // a brass lantern on the ridge and a plaque of the Constabulary's stamp over the door
      k.limb([0, eaveY + rise + 0.05, 0], [0, eaveY + rise + 0.5, 0], 0.05, 0.05, P.iron, 4);
      k.add(new SphereGeometry(0.2, 6, 5), { at: [0, eaveY + rise + 0.62, 0], colour: P.glowLantern });
      box(k, [0.08, 0.5, 1.6], [b.hx + 0.04, fy + 0.08 + Math.min(wallH - 0.2, lb.doorH + 0.5), 0], P.brass);
    }
  } else if (lb.kind === "sealed") {
    sealedDoor(k, `${lb.id}.door`, b.hx, fy + 0.08, lb.door, lb.doorH, SEALED, lod, out.marks, { x: b.x, y: gy, z: b.z, yaw: b.yaw });
    // a stepless ladder to the door, as on every hut, but pulled up (leaned against the wall beside it): shut means shut
    if (lod) {
      k.limb([b.hx + 0.35, -0.1, b.hz * 0.6], [b.hx + 0.05, fy + 1.4, b.hz * 0.6], 0.03, 0.03, P.tarPlankLight, 4);
      k.limb([b.hx + 0.65, -0.1, b.hz * 0.6], [b.hx + 0.05, fy + 1.4, b.hz * 0.6 + 0.35], 0.03, 0.03, P.tarPlankLight, 4);
    }
    if (lod) for (const sz of [-1, 1]) box(k, [0.08, 0.6, 0.7], [0.3, fy + 0.08 + wallH * 0.62, sz * (b.hz + 0.02)], P.iron);
  } else if (lod) {
    // a solid hut: windows, never a door
    for (const sz of [-1, 1]) box(k, [0.08, 0.6, 0.7], [0.3, fy + 0.08 + wallH * 0.62, sz * (b.hz + 0.02)], P.iron);
    box(k, [0.7, 0.6, 0.08], [b.hx + 0.02, fy + 0.08 + wallH * 0.62, b.hz * 0.4], P.iron);
  }
  k.clearBase();
}

// ---- quay, bridges, planks ------------------------------------------------------------------------------------------------------------

function quay(k: Kit, lod: Lod): void {
  const q = saltmarketPlan().quay;
  const len = q.z1 - q.z0;
  const n = Math.round(len / 0.55);   // (placement never depends on `lod`: the ink hull is the same shapes in fewer facets, or it would draw black where the mesh is not)
  for (let i = 0; i < n; i++) {
    const z = q.z0 + (i + 0.5) * (len / n);
    box(k, [q.half * 2, 0.14, (len / n) * 0.9], [q.x, L - 0.06, z], i % 3 === 0 ? P.tarPlankLight : i % 3 === 1 ? P.tarPlank : P.tarPlankDark);
  }
  // the pontoon: drums lashed under the planks, and the piles that hold the floating quay to the lagoon's bed
  for (const s of [-1, 1]) {
    for (let z = q.z0 + 0.8; z < q.z1; z += 2.2) {
      k.add(new CylinderGeometry(0.34, 0.34, 1.7, lod ? 8 : 6), { at: [q.x + s * (q.half - 0.5), SALTMARKET.waterY - 0.02, z], rot: [Math.PI / 2, 0, 0], colour: P.tarPlankDark, flat: true });
      pile(k, q.x + s * (q.half + 0.15), z + 1.1, -1.4, L + 0.85, 0.1, 40 + Math.round(z), 5);
    }
    box(k, [0.12, 0.1, len], [q.x + s * (q.half + 0.02), L + 0.02, (q.z0 + q.z1) / 2], P.pilingDark);
  }
  for (const b of q.bollards) {
    k.limb([b.x, L - 0.3, b.z], [b.x, L + 0.8, b.z], 0.18, 0.15, P.iron, 7);
    k.add(new SphereGeometry(0.19, 6, 4), { at: [b.x, L + 0.82, b.z], colour: P.iron });
  }
  // a pole at the seaward end with a lantern, and ropes to the barge cleats
  const endZ = q.z1 - 0.3;
  k.limb([q.x - q.half + 0.15, L, endZ], [q.x - q.half + 0.15, L + 3.0, endZ], 0.09, 0.07, P.tarPlankDark, 5);
  k.add(new SphereGeometry(0.16, 6, 5), { at: [q.x - q.half + 0.15, L + 3.1, endZ], colour: P.glowLantern });
}

/** A plank pier over shallow water: planks at the bank level, two rows of piles, a bollard at the end. Runs along local z from z0 to z1 at (x, ·) when `alongX` is false, else along x. */
function pier(k: Kit, x0: number, z0: number, x1: number, z1: number, half: number, lod: Lod, seed: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(z1 - z0, x1 - x0);
  k.setBase((x0 + x1) / 2, 0, (z0 + z1) / 2, yaw);
  const n = Math.round(len / 0.5);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    box(k, [(len / n) * 0.88, 0.12, half * 2], [x, L - 0.06, 0], i % 3 === 0 ? P.tarPlankLight : i % 3 === 1 ? P.tarPlank : P.tarPlankDark);
  }
  for (const s of [-1, 1]) {
    box(k, [len, 0.14, 0.14], [0, L - 0.19, s * (half - 0.05)], P.tarPlankDark);   // (top at L - 0.12: the planks' underside)
    for (let x = -len / 2 + 0.4; x <= len / 2; x += 2.0) pile(k, x, s * (half + 0.12), -1.6, L + 0.55, 0.1, seed + Math.round(x), 5);
  }
  k.limb([len / 2 - 0.1, L, 0], [len / 2 - 0.1, L + 0.8, 0], 0.16, 0.14, P.iron, 6);
  k.clearBase();
  void lod;
}

function bridges(kitAt: (x: number, z: number) => Kit, lod: Lod): void {
  const plan = saltmarketPlan();
  const hd = SALTMARKET.deckHalf;
  for (const b of plan.bridges) {
    const k = kitAt(b.x, b.z);
    const along = b.yaw === 0;
    k.setBase(b.x, 0, b.z, b.yaw === 0 ? 0 : -Math.PI / 2);
    // local frame: the deck runs along local z (length 2*hl), 2*hd wide across local x; its planks run on under the rails (the parapet's collider) so the rail posts stand through their ends
    const n = Math.round((b.hl * 2) / 0.5);
    for (let i = 0; i < n; i++) {
      const z = -b.hl + (i + 0.5) * ((b.hl * 2) / n);
      box(k, [hd * 2 + 0.6, 0.16, ((b.hl * 2) / n) * 0.9], [0, L - 0.08, z], i % 4 === 0 ? P.tarPlankLight : i % 4 === 2 ? P.tarPlankDark : P.tarPlank);
    }
    // under-deck beams and bents of piles into the water
    for (const s of [-1, 1]) box(k, [0.22, 0.44, b.hl * 2], [s * (hd - 0.2), L - 0.38, 0], P.tarPlankDark);   // (top at L - 0.16: the planks' underside)
    for (let z = -b.hl + 1.2; z < b.hl; z += 3.4) for (const s of [-1, 1]) pile(k, s * (hd - 0.2), z, -2.2, L - 0.1, 0.14, 60 + Math.round(z), 5);
    // rails: posts and two rope-and-plank rails, 1.15 high like the parapet that blocks
    for (const s of [-1, 1]) {
      const x = s * (hd + 0.3);
      // (each post is driven into the bed and passes through the deck planks' ends)
      for (let z = -b.hl; z <= b.hl + 0.01; z += 1.6) k.limb([x, -1.6, z], [x, L + SALTMARKET.parapet + 0.08, z], 0.07, 0.06, P.pilingLight, 5);
      box(k, [0.14, 0.1, b.hl * 2], [x, L + SALTMARKET.parapet + 0.05, 0], P.tarPlankLight);
      box(k, [0.08, 0.08, b.hl * 2], [x, L + SALTMARKET.parapet * 0.55, 0], P.tarPlank);
    }
    // the gate of the Customs Bridge: two tall posts, a lintel and the Constabulary's brass eye
    if (along && b.id === "customsBridge") {
      const gz = b.hl - 1.0;
      for (const s of [-1, 1]) k.limb([s * (hd + 0.8), -2.2, gz], [s * (hd + 0.8), L + 3.4, gz], 0.2, 0.17, planks(77), 6);   // (driven into the bed beside the deck)
      box(k, [hd * 2 + 2.2, 0.34, 0.34], [0, L + 3.3, gz], planks(78));
      box(k, [hd * 2 + 2.4, 0.12, 0.5], [0, L + 3.55, gz], P.coralCanvas);
      k.add(new CylinderGeometry(0.4, 0.4, 0.1, lod ? 14 : 8), { at: [0, L + 3.3, gz + 0.22], rot: [Math.PI / 2, 0, 0], colour: P.brass, flat: true });
      k.add(new SphereGeometry(0.17, 6, 5), { at: [0, L + 3.3, gz + 0.3], colour: P.iron });
      for (const s of [-1, 1]) {
        k.limb([s * (hd + 0.8), L + 3.1, gz], [s * (hd + 0.8), L + 2.6, gz], 0.015, 0.015, P.iron, 3);
        k.add(new SphereGeometry(0.15, 6, 5), { at: [s * (hd + 0.8), L + 2.5, gz], colour: P.glowLantern });
      }
    } else if (lod) {
      // the lesser bridges: a pair of lantern posts at the south-or-east end
      const gz = b.hl - 0.6;
      for (const s of [-1, 1]) {
        k.limb([s * (hd + 0.55), -1.6, gz], [s * (hd + 0.55), L + 2.4, gz], 0.09, 0.07, P.tarPlankDark, 5);   // (driven into the bed beside the deck)
        k.add(new SphereGeometry(0.14, 6, 5), { at: [s * (hd + 0.55), L + 2.5, gz], colour: P.glowLantern });
      }
    }
    k.clearBase();
  }
}

/** The revetment: a row of piles along each fence box the world has, with a wale and a cap plank. */
function revetment(kitAt: (x: number, z: number) => Kit, world: CollisionWorld, lod: Lod): void {
  for (const o of world.obstacles) {
    if (o.tag !== "fence" || o.kind !== "box") continue;
    const k = kitAt(o.x, o.z);
    const top = o.y1;
    k.setBase(o.x, 0, o.z, o.yaw);
    const len = o.hx * 2;
    const m = Math.max(2, Math.round(len / 1.15));
    for (let i = 0; i < m; i++) {
      const x = -o.hx + (i + 0.5) * (len / m);
      pile(k, x, 0, top - 2.2, top + 0.12 + h01(5, o.x + i, o.z) * 0.12, 0.15, 90 + i, lod ? 5 : 4);
    }
    box(k, [len, 0.16, 0.2], [0, top - 0.55, o.hz * 0.4], P.tarPlankDark);
    box(k, [len, 0.1, 0.34], [0, top + 0.06, 0], P.tarPlankLight);
    k.clearBase();
  }
}

// ---- the Exchange --------------------------------------------------------------------------------------------------------------------------

/** The Exchange's hanging lanterns: across the front between the pillars (at x = ±5, ±10, ±15), a little inside the front beam's face. */
const EXCHANGE_LANTERN_X = [-7.5, -3, 3, 7.5] as const;
const EXCHANGE_LANTERN_IN = 0.15;

function exchange(k: Kit, world: CollisionWorld, lod: Lod): void {
  const ex = saltmarketPlan().exchange;
  const y0 = world.terrainHeight(ex.x, ex.z);
  const hx = ex.hx;
  const zf = SALTMARKET_ANCHORS.exchange.z + 11, zb = ex.backWall.z + 0.5;
  const cz = (zf + zb) / 2, hz = (zf - zb) / 2;
  k.setBase(ex.x, y0, cz, 0);
  // the floor: planks, laid in a herringbone of two shades, a dais of three steps for the rostrum
  for (let i = 0; i < 18; i++) {
    const z = -hz + (i + 0.5) * ((hz * 2) / 18);
    box(k, [hx * 2 + 1.2, 0.1, (hz * 2) / 18 * 0.94], [0, 0.04, z], i % 2 ? P.tarPlankLight : P.tarPlank);
  }
  // the back wall: tarred plank under louvres, a coral frieze
  box(k, [hx * 2 + 0.4, ex.backH, 1.0], [0, ex.backH / 2, -hz - 0.0], planks(11));
  box(k, [hx * 2 + 0.5, 0.5, 1.1], [0, ex.backH - 0.4, -hz], P.coralCanvas);
  if (lod) for (let i = -5; i <= 5; i++) box(k, [0.9, 0.7, 0.1], [i * 2.7, ex.backH * 0.55, -hz + 0.55], P.tarPlankDark);
  // the colonnade: tarred timber pillars on stone footings, a tide mark at the height of the highest flood, coral capitals; beams across
  for (const p of ex.pillars) {
    const px = p.x - ex.x, pz = p.z - cz;
    k.limb([px, 0, pz], [px, ex.eave, pz], 0.62, 0.52, (pp, _n, out) => {
      if (pp.y < 0.35) out.set(P.pilingDark);
      else if (pp.y < 1.55) blend(out, P.tarPlankDark, P.pilingDark, 0.5);
      else if (pp.y < 1.7) out.set(P.salt);   // the salt line of the highest tide
      else out.set(P.tarPlank);
    }, lod ? 10 : 6);
    k.add(new CylinderGeometry(0.78, 0.7, 0.3, lod ? 10 : 6), { at: [px, ex.eave - 0.15, pz], colour: P.coralCanvas, flat: true });
    k.add(new CylinderGeometry(0.76, 0.76, 0.28, lod ? 10 : 6), { at: [px, 0.14, pz], colour: P.pilingLight, flat: true });
  }
  const beamY = ex.eave + 0.15;
  box(k, [hx * 2 + 1.4, 0.5, 0.5], [0, beamY, hz], P.tarPlankDark);
  for (const s of [-1, 1]) box(k, [0.5, 0.5, hz * 2 + 1.4], [s * hx, beamY, 0], P.tarPlankDark);
  // the roof: a low hip of indigo canvas with coral ribs, its ridge no higher than the stilted houses'
  // a boarded ceiling under the roof (the hall is seen from below: nothing in it is open to the sky)
  box(k, [hx * 2 + 2.6, 0.1, hz * 2 + 2.0], [0, ex.eave + 0.33, 0], planks(13, P.tarPlankDark, P.tarPlankDark, P.tarPlank));
  for (let b = -hx; b <= hx + 0.1; b += 5) box(k, [0.3, 0.28, hz * 2 + 1.6], [b, ex.eave + 0.22, 0], P.tarPlankDark);
  const ridge = 1.5;
  hip(k, hx + 1.4, hz + 1.1, ridge, [0, ex.eave + 0.38, 0], canvas(P.indigoCanvas, P.indigoLight, 1.0));
  for (const s of [-1, 1]) box(k, [0.3, 0.14, hz * 2 + 1.5], [s * (hx * 0.55), ex.eave + 0.55, 0], P.coralCanvas);
  box(k, [2.2, 0.5, 2.2], [0, ex.eave + 0.38 + ridge, 0], P.tarPlankDark);
  k.add(new SphereGeometry(0.26, 6, 5), { at: [0, ex.eave + 0.38 + ridge + 0.36, 0], colour: P.brass });
  // lanterns hanging between the pillars, each on a cord from the underside of the front beam (the lit points come from the view)
  if (lod) for (const x of EXCHANGE_LANTERN_X) {
    k.limb([x, beamY - 0.2, hz - EXCHANGE_LANTERN_IN], [x, ex.eave - 0.9, hz - EXCHANGE_LANTERN_IN], 0.012, 0.012, P.rope, 3);
    k.add(new SphereGeometry(0.2, 6, 5), { at: [x, ex.eave - 1.0, hz - EXCHANGE_LANTERN_IN], colour: P.glowLantern });
  }
  // the rostrum: a dais, a lectern, the Auctioneer's hammer block and a gilt-edged board with the lot
  const r = ex.rostrum;
  k.clearBase();
  k.setBase(r.x, y0, r.z, 0);
  box(k, [r.hx * 2 + 1.2, 0.3, r.hz * 2 + 1.0], [0, 0.15, 0], P.tarPlankLight);
  box(k, [r.hx * 2, r.height - 0.2, r.hz * 2], [0, 0.3 + (r.height - 0.2) / 2, 0], planks(14));
  box(k, [r.hx * 2 + 0.2, 0.1, r.hz * 2 + 0.2], [0, r.height + 0.15, 0], P.tarPlankLight);
  box(k, [0.9, 1.0, 0.1], [0, r.height + 0.7, -0.3], P.tarPlankDark);
  box(k, [0.8, 0.8, 0.06], [0, r.height + 0.75, -0.25], P.indigoCanvas);
  k.add(new CylinderGeometry(0.1, 0.1, 0.14, 8), { at: [0.5, r.height + 0.27, 0.1], colour: P.brass, flat: true });
  k.clearBase();
  // benches for the Houses (the paddles' row), and the Syndicate's rail on the east
  k.setBase(ex.x, y0, cz, 0);
  for (const [bx, bz] of [[-10, -4], [10, -4], [-6, 3], [6, 3]] as const) {
    if (!lod && bz > 0) continue;
    box(k, [3.0, 0.1, 0.7], [bx, 0.55, bz], P.tarPlankLight);
    for (const s of [-1, 1]) box(k, [0.12, 0.55, 0.6], [bx + s * 1.3, 0.28, bz], P.tarPlankDark);
  }
  k.clearBase();
}

function campanile(k: Kit, h: SaltmarketHair, gy: number, lod: Lod): void {
  const r = h.r;
  k.setBase(h.x, gy, h.z, 0);
  // a tarred timber stair-tower on four stout stilts: stages that step in, a bell loft, a coral cap and a brass heron vane
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pile(k, sx * (r - 0.25), sz * (r - 0.25), -0.5, 1.2, 0.2, 100 + sx + sz, 6);
  box(k, [r * 2 + 0.2, 0.2, r * 2 + 0.2], [0, 1.2, 0], P.tarPlankDark);
  const stages = [[1.3, 5.2, 1.0], [5.2, 8.6, 0.84], [8.6, 11.0, 0.7]] as const;   // (the first stands on the platform's top, 1.3)
  stages.forEach(([a, b, s], i) => {
    box(k, [r * 2 * s, b - a, r * 2 * s], [0, (a + b) / 2, 0], planks(120 + i));
    box(k, [r * 2 * s + 0.35, 0.18, r * 2 * s + 0.35], [0, b, 0], i === 1 ? P.coralCanvas : P.tarPlankLight);
    if (lod) for (const f of [0, 1, 2, 3]) {
      const a2 = (f * Math.PI) / 2;
      box(k, [0.5, 0.9, 0.1], [Math.sin(a2) * r * s * 1.0, (a + b) / 2, Math.cos(a2) * r * s * 1.0], P.iron);
    }
  });
  // the bell loft: an open arcade, a bronze bell, then a pyramid of indigo canvas with coral hips
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * 0.62, 11.0, sz * 0.62], [sx * 0.62, 12.8, sz * 0.62], 0.12, 0.1, P.tarPlankLight, 5);
  k.add(new CylinderGeometry(0.26, 0.5, 0.8, lod ? 10 : 6), { at: [0, 11.9, 0], colour: P.brass, flat: true });
  box(k, [2.0, 0.16, 2.0], [0, 12.85, 0], P.tarPlankDark);
  // the bell's headstock under the deck and its iron hanger
  box(k, [1.36, 0.14, 0.18], [0, 12.7, 0], P.tarPlankDark);
  k.limb([0, 12.22, 0], [0, 12.66, 0], 0.06, 0.06, P.iron, 4);
  const pg = new ConeGeometry(1.7, 1.6, 4, 1);
  k.add(pg, { at: [0, 13.7, 0], rot: [0, Math.PI / 4, 0], colour: canvas(P.indigoCanvas, P.indigoDark, 2), flat: true, perFace: true });
  k.limb([0, 14.4, 0], [0, 14.0, 0], 0.03, 0.03, P.iron, 3);
  k.clearBase();
}

// ---- the hairs ------------------------------------------------------------------------------------------------------------------------------

function hair(k: Kit, h: SaltmarketHair, gy: number, lod: Lod, i: number): void {
  const y = gy;
  switch (h.kind) {
    case "crane": {
      // a timber quay crane: a square mast, a raking jib, a counterweight, a hoist rope and a hook
      k.setBase(h.x, y, h.z, 0.4 * (i % 2 ? 1 : -1));
      box(k, [h.r * 1.6, h.height - 0.6, h.r * 1.6], [0, (h.height - 0.6) / 2 - 0.3, 0], planks(130 + i, P.pilingDark, P.tarPlankDark, P.piling));
      box(k, [h.r * 2.2, 0.3, h.r * 2.2], [0, 0.0, 0], P.pilingLight);
      k.limb([0, h.height - 1.2, 0], [4.2, h.height - 3.8, 0], 0.17, 0.11, P.tarPlankDark, 5);
      k.limb([0, h.height - 1.2, 0], [-1.8, h.height - 2.2, 0], 0.14, 0.1, P.tarPlankDark, 5);
      box(k, [0.7, 0.7, 0.7], [-1.9, h.height - 2.4, 0], P.iron);
      k.limb([4.1, h.height - 3.8, 0], [4.1, h.height - 8.4, 0], 0.012, 0.012, P.rope, 3);
      box(k, [0.18, 0.28, 0.18], [4.1, h.height - 8.52, 0], P.iron);   // (its top in the rope's end)
      // a kingpost on the mast's head (to the plan's height) carries the stay to the jib's tip
      k.limb([0, h.height - 0.7, 0], [0, h.height, 0], 0.09, 0.07, P.tarPlankDark, 4);
      k.limb([0, h.height - 0.2, 0], [4.1, h.height - 3.75, 0], 0.012, 0.012, P.rope, 3);
      k.clearBase();
      break;
    }
    case "derrick": {
      // the cove's cargo boom: a mast, a boom out over the water, a block and a lantern
      k.setBase(h.x, y, h.z, -0.3);
      k.limb([0, -0.3, 0], [0, h.height, 0], 0.17, 0.1, planks(140, P.tarPlankLight, P.tarPlankDark, P.pilingLight), 5);
      k.limb([0, h.height - 1.0, 0], [3.8, h.height - 2.6, 0], 0.1, 0.07, P.tarPlankDark, 5);
      k.limb([3.7, h.height - 2.6, 0], [3.7, h.height - 5.6, 0], 0.012, 0.012, P.rope, 3);
      box(k, [0.22, 0.22, 0.22], [3.7, h.height - 5.7, 0], P.iron);
      for (const s of [-1, 1]) k.limb([0, h.height - 1.4, 0], [s * 1.6, -0.2, 0.8 * s], 0.012, 0.012, P.rope, 3);
      k.add(new SphereGeometry(0.15, 6, 5), { at: [0, h.height + 0.12, 0], colour: P.glowLantern });
      k.clearBase();
      break;
    }
    case "windpump": {
      // a lattice tower (four tapering legs, braced), a wheel of twenty blades and a tail vane: the delta's salt pumps
      k.setBase(h.x, y, h.z, 0.3);
      const top = h.height - 1.0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * 1.1, -0.3, sz * 1.1], [sx * 0.35, top, sz * 0.35], 0.07, 0.05, P.pilingDark, 4);
      for (let t = 1.2; t < top; t += 2.2) {
        const s = 1.1 - (t / top) * 0.75;
        for (const [ax, az, bx, bz] of [[-s, -s, s, -s], [s, -s, s, s], [s, s, -s, s], [-s, s, -s, -s]] as const) k.limb([ax, t, az], [bx, t, bz], 0.03, 0.03, P.pilingDark, 3);
      }
      box(k, [0.7, 0.6, 0.7], [0, top + 0.3, 0], P.iron);
      const blades = 14;
      for (let b = 0; b < blades; b++) {
        const a = (b / blades) * Math.PI * 2;
        k.limb([0.4, top + 0.3, 0], [0.4, top + 0.3 + Math.cos(a) * 1.55, Math.sin(a) * 1.55], 0.05, 0.03, b % 2 ? P.pilingLight : P.pilingDark, 3);
      }
      k.add(new CylinderGeometry(1.55, 1.55, 0.03, lod ? 18 : 10, 1, true), { at: [0.4, top + 0.3, 0], rot: [0, 0, Math.PI / 2], colour: P.pilingDark, flat: true });
      k.limb([0, top + 0.3, 0], [-3.0, top + 0.3, 0], 0.04, 0.04, P.pilingDark, 3);
      box(k, [1.4, 0.8, 0.04], [-3.2, top + 0.4, 0], P.coralCanvas);
      k.clearBase();
      break;
    }
    case "flagpole": {
      k.limb([h.x, y - 0.2, h.z], [h.x, y + h.height, h.z], 0.14, 0.07, planks(150, P.pilingLight, P.pilingDark, P.pilingLight), 6);
      k.add(new SphereGeometry(0.14, 6, 5), { at: [h.x, y + h.height + 0.1, h.z], colour: P.brass });
      break;
    }
    case "mast": {
      // a stump of a ship's mast on a pile bundle at the drop-house: a yard, a ladder of battens, a lantern at the head
      k.setBase(h.x, y, h.z, 0);
      k.limb([0, -0.4, 0], [0, h.height, 0], 0.2, 0.1, planks(160, P.tarPlankLight, P.tarPlankDark, P.pilingLight), 6);
      k.limb([-1.5, h.height - 2.0, 0], [1.5, h.height - 2.0, 0], 0.07, 0.07, P.tarPlankDark, 4);
      for (let t = 1; t < h.height - 2; t += 0.9) box(k, [0.5, 0.05, 0.05], [0, t, 0], P.rope);
      for (const s of [-1, 1]) k.limb([0, 0.0, 0], [s * 0.7, -0.4, s * 0.5], 0.08, 0.08, P.pilingDark, 4);
      k.add(new SphereGeometry(0.16, 6, 5), { at: [0, h.height + 0.14, 0], colour: P.glowLantern });   // (seated on the masthead)
      k.clearBase();
      break;
    }
    case "lantern": {
      k.limb([h.x, y - 0.2, h.z], [h.x, y + h.height, h.z], 0.1, 0.07, P.tarPlankDark, 5);
      k.add(new SphereGeometry(0.18, 6, 5), { at: [h.x, y + h.height + 0.1, h.z], colour: P.glowLantern });
      break;
    }
    case "campanile":
      campanile(k, h, y, lod);
      break;
  }
}

// ---- boats, racks, pans, lamps ----------------------------------------------------------------------------------------------------

/** A hull: a rounded-bilge box tapered to a bow and a stern. */
function hull(len: number, beam: number, depth: number, sheer: number): BufferGeometry {
  const g = new BoxGeometry(beam, depth, len, 1, 1, 8);
  const p = g.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = Math.abs(p.getZ(i)) / (len / 2);
    const taper = 1 - Math.pow(t, 2.6) * 0.82;
    const bottom = p.getY(i) < 0;
    p.setX(i, p.getX(i) * taper * (bottom ? 0.62 : 1));
    if (!bottom) p.setY(i, p.getY(i) + sheer * Math.pow(t, 2) * (p.getZ(i) > 0 ? 1.3 : 0.7));
  }
  g.computeVertexNormals();
  return g;
}

function boat(k: Kit, b: SaltmarketBoat, lod: Lod, i: number): void {
  const wy = SALTMARKET.waterY;
  const bob = h01(170, i) * 0.1;
  k.setBase(b.x, wy + bob, b.z, b.yaw);
  const hullCol = (a: number, c: number): ColourFn => (p, n, out) => blend(out, a, c, n.y > 0.5 ? 0.5 : Math.max(0, -p.y) * 0.7);
  if (b.kind === "barge") {
    // a long flat barge, low in the water, a tarpaulin over four crates' worth of cargo, a stubby mast with a furled sail and a lantern at the bow
    k.add(hull(9.5, 3.0, 1.1, 0.3), { at: [0, 0.2, 0], colour: hullCol(P.tarPlankDark, P.tarPlank), flat: true });
    box(k, [2.5, 0.08, 8.3], [0, 0.76, 0], P.tarPlankLight);
    k.add(new BoxGeometry(2.3, 1.1, 4.0), { at: [0, 1.3, 0.9], colour: canvas(P.indigoDark, P.indigoCanvas, 1.8), flat: true, perFace: true });
    k.add(new CylinderGeometry(0.62, 0.62, 2.3, 8, 1, false, 0, Math.PI), { at: [0, 1.75, 0.9], rot: [0, 0, Math.PI / 2], colour: P.indigoCanvas, flat: true });
    k.limb([0, 0.8, -2.6], [0, 5.4, -2.6], 0.12, 0.08, P.tarPlankLight, 6);
    k.limb([-1.5, 4.3, -2.6], [1.7, 4.3, -2.6], 0.07, 0.07, P.tarPlankLight, 5);
    k.add(new CylinderGeometry(0.22, 0.22, 3.0, 8), { at: [0.1, 4.3, -2.6], rot: [0, 0, Math.PI / 2], colour: P.salt, flat: true });
    box(k, [0.5, 0.5, 0.5], [0, 0.95, 4.2], P.tarPlankLight);
    k.add(new SphereGeometry(0.14, 6, 5), { at: [0, 1.32, 4.2], colour: P.glowLantern });   // (seated on the box, top 1.2)
    for (const s of [-1, 1]) k.limb([s * 1.4, 0.8, 3.4], [s * 2.0, 0.9, 5.6], 0.02, 0.02, P.rope, 3);
  } else if (b.kind === "cutter") {
    // the Constabulary's cutter: a trim hull in indigo with a coral wale, a short mast, a brass lantern and a tarred wheelhouse
    k.add(hull(8.0, 2.6, 1.2, 0.5), { at: [0, 0.2, 0], colour: hullCol(P.indigoDark, P.indigoCanvas), flat: true });
    box(k, [2.7, 0.14, 7.0], [0, 0.55, 0], P.coralCanvas);
    box(k, [2.0, 0.08, 6.4], [0, 0.82, 0], P.tarPlankLight);
    box(k, [1.6, 1.3, 1.8], [0, 1.5, 0.4], P.tarPlank);
    gable(k, 1.0, 1.2, 0.4, [0, 2.1, 0.4], P.indigoCanvas);
    k.limb([0, 0.8, -1.8], [0, 5.0, -1.8], 0.1, 0.07, P.tarPlankLight, 6);
    box(k, [0.9, 0.6, 0.04], [0.5, 4.5, -1.8], P.coralCanvas);
    k.add(new SphereGeometry(0.14, 6, 5), { at: [0, 5.1, -1.8], colour: P.glowLantern });
    k.add(new SphereGeometry(0.16, 6, 5), { at: [0, 0.95, 3.4], colour: P.brass });
  } else if (b.kind === "lighter") {
    k.add(hull(6.2, 2.4, 0.9, 0.2), { at: [0, 0.15, 0], colour: hullCol(P.tarPlank, P.tarPlankLight), flat: true });
    box(k, [2.0, 0.07, 5.4], [0, 0.55, 0], P.tarPlankLight);
    // six crates: four on the deck (top 0.585), two stacked on them
    for (let c = 0; c < 6; c++) box(k, [0.8, 0.6, 0.8], [(c % 2) * 0.95 - 0.5, 0.885 + (c > 3 ? 0.6 : 0), -1.6 + (c > 3 ? c - 4 : Math.floor(c / 2)) * 1.0], c % 3 ? P.tarPlankLight : P.tarPlank);
  } else {
    k.add(hull(3.8, 1.3, 0.6, 0.2), { at: [0, 0.1, 0], colour: hullCol(P.tarPlankDark, P.pilingLight), flat: true });
    box(k, [0.9, 0.05, 0.2], [0, 0.32, 0.6], P.tarPlankLight);
    box(k, [0.9, 0.05, 0.2], [0, 0.32, -0.6], P.tarPlankLight);
    k.limb([0.0, 0.35, 1.4], [0.9, 0.5, 2.1], 0.02, 0.02, P.tarPlankLight, 3);
  }
  void lod;
  k.clearBase();
}

function rack(k: Kit, r: { x: number; z: number; yaw: number; len: number }, gy: number, lod: Lod, i: number): void {
  k.setBase(r.x, gy, r.z, r.yaw);
  const n = Math.max(2, Math.round(r.len / 2.4));
  for (let j = 0; j <= n; j++) k.limb([-r.len / 2 + (j * r.len) / n, -0.2, 0], [-r.len / 2 + (j * r.len) / n, 1.9, 0], 0.06, 0.05, P.tarPlankLight, 4);
  box(k, [r.len, 0.07, 0.07], [0, 1.85, 0], P.tarPlankDark);
  box(k, [r.len, 0.07, 0.07], [0, 1.2, 0], P.tarPlankDark);
  // the catch: strings of salted fish in two tones
  if (lod) for (let j = 0; j < Math.round(r.len * 1.2); j++) {
    const x = -r.len / 2 + 0.3 + j * 0.72;
    if (x > r.len / 2 - 0.2) break;
    k.add(new SphereGeometry(0.11, 5, 4), { at: [x, 1.6, 0.04], scale: [0.55, 1.5, 0.35], colour: (j + i) % 3 ? P.siltPale : P.salt, flat: true });
    k.limb([x, 1.84, 0.01], [x, 1.7, 0.04], 0.008, 0.008, P.rope, 3);   // the twine it hangs by, from the top rail
  }
  k.clearBase();
}

function saltPan(k: Kit, p: { x: number; z: number; hx: number; hz: number }, gy: number): void {
  // a low mud bund round a pan of crystallised salt
  k.setBase(p.x, gy, p.z, 0);
  for (const s of [-1, 1]) {
    box(k, [p.hx * 2 + 0.6, 0.22, 0.45], [0, 0.04, s * (p.hz + 0.1)], P.mudDark);
    box(k, [0.45, 0.22, p.hz * 2 + 0.6], [s * (p.hx + 0.1), 0.04, 0], P.mudDark);
  }
  k.add(new BoxGeometry(p.hx * 2, 0.08, p.hz * 2), { at: [0, 0.04, 0], colour: (pp, n, out) => blend(out, P.salt, P.saltShade, Math.max(0, h01(190, pp.x * 1.2, pp.z * 1.2) - 0.35) * 1.5), flat: true, perFace: true });
  // a rake and a heap
  k.limb([p.hx - 1.2, 0.05, 0.5], [p.hx - 2.8, 1.4, 0.2], 0.03, 0.03, P.tarPlankLight, 4);
  k.add(new ConeGeometry(0.9, 0.7, 6, 1), { at: [-p.hx + 1.2, 0.35, -p.hz + 1.0], colour: P.salt, flat: true });
  k.clearBase();
}

function lamp(k: Kit, x: number, z: number, gy: number, h: number): void {
  k.limb([x, gy - 0.3, z], [x, gy + h, z], 0.1, 0.07, P.tarPlankDark, 5);
  k.limb([x, gy + h * 0.6, z], [x + 0.4, gy + h * 0.86, z], 0.03, 0.03, P.iron, 4);
  box(k, [0.3, 0.05, 0.3], [x, gy + h + 0.02, z], P.iron);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([x + sx * 0.12, gy + h + 0.03, z + sz * 0.12], [x + sx * 0.12, gy + h + 0.42, z + sz * 0.12], 0.02, 0.02, P.iron, 3);
  k.add(new SphereGeometry(0.1, 6, 4), { at: [x, gy + h + 0.22, z], colour: P.glowLantern });
  const cap = new ConeGeometry(0.24, 0.26, 6, 1);
  k.add(cap, { at: [x, gy + h + 0.55, z], colour: P.coralDark, flat: true });
}

// ---- assembly ------------------------------------------------------------------------------------------------------------------------------

export interface SaltmarketSolid {
  /** One geometry per quarter of the map (so the frustum can cull); undefined where a quarter has nothing. */
  geometries: (BufferGeometry | undefined)[];
  /** Where the lanterns burn (the view adds a point of light at each): the street's, and one hung inside every room. */
  lamps: { x: number; y: number; z: number; lit?: number }[];
  /** D-038: the doors drawn (one per declared door), and the roofs of the interiors (the cutaway's). */
  marks: DoorMark[];
  roofs: RoofSource | undefined;
  /** D-089: the houses' window panes. */
  panes: LitPane[];
}

/** Everything solid in the delta, merged four ways. `lod` 0 is the cheap shape the ink hull and the low preset use. */
export function buildSaltmarketSolid(world: CollisionWorld, lod: Lod): SaltmarketSolid {
  const plan = saltmarketPlan();
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  const kits = [new Kit(), new Kit(), new Kit(), new Kit()];
  const kitAt = (x: number, z: number): Kit => kits[(x >= 0 ? 1 : 0) + (z >= -10 ? 2 : 0)]!;
  const lamps: { x: number; y: number; z: number; lit?: number }[] = [];

  quay(kitAt(0, 125), lod);
  bridges(kitAt, lod);
  const cp = plan.covePier;
  pier(kitAt(cp.x0, cp.z), cp.x0, cp.z, cp.x1, cp.z, cp.half, lod, 500);
  // the cutter berth's pier lies beyond the revetment (nobody walks it: the Constabulary's own), south from the berth to the Customs Cut's water
  const bp = plan.berthPier;
  pier(kitAt(bp.x, bp.z0), bp.x, bp.z0, bp.x, bp.z1, bp.half, lod, 520);
  revetment(kitAt, world, lod);
  const level = saltmarketLevel();
  const lbOf = (id: string): LevelBuilding => level.buildings.find((x) => x.id === id)!;
  const houseOut: HouseOut = { marks: [], lamps, roofs: new RoofKits(), panes: [] };
  plan.houses.forEach((b, i) => stiltHouse(kitAt(b.x, b.z), b, g(b.x, b.z), i < 2 ? "warehouse" : "hut", lbOf(`warehouse${i}`), lod, 200 + i * 7, houseOut));
  stiltHouse(kitAt(plan.customsHouse.x, plan.customsHouse.z), plan.customsHouse, g(plan.customsHouse.x, plan.customsHouse.z), "customs", lbOf("customs"), lod, 300, houseOut);
  stiltHouse(kitAt(plan.dropHouse.x, plan.dropHouse.z), plan.dropHouse, g(plan.dropHouse.x, plan.dropHouse.z), "dropHouse", lbOf("dropHouse"), lod, 310, houseOut);
  exchange(kitAt(plan.exchange.x, plan.exchange.z), world, lod);
  plan.hairs.forEach((h, i) => hair(kitAt(h.x, h.z), h, g(h.x, h.z), lod, i));
  plan.boats.forEach((b, i) => boat(kitAt(b.x, b.z), b, lod, i));
  plan.racks.forEach((r, i) => rack(kitAt(r.x, r.z), r, g(r.x, r.z), lod, i));
  plan.saltPans.forEach((p) => saltPan(kitAt(p.x, p.z), p, g(p.x, p.z)));
  for (const l of plan.lamps) {
    const y = g(l.x, l.z);
    lamp(kitAt(l.x, l.z), l.x, l.z, y, l.h);
    lamps.push({ x: l.x, y: y + l.h + 0.22, z: l.z });
  }
  // the signboards: a board between two posts (the lettering is the cloth mesh's decal on each face). There was no board: the two lettered sheets hung
  // 11 cm apart in the air, and from above you looked down between them onto the far one's mirrored back.
  for (const sg of plan.signs) {
    const y = g(sg.x, sg.z);
    const rx = Math.sin(sg.yaw), rz = -Math.cos(sg.yaw);
    const k = kitAt(sg.x, sg.z);
    const post = SIGN_BOARD.w / 2 + 0.05;   // (just outside the board's ends, which sink a little into them: the posts no longer cross the lettering)
    for (const side of [-1, 1]) k.limb([sg.x + rx * side * post, y - 0.3, sg.z + rz * side * post], [sg.x + rx * side * post, y + 2.2, sg.z + rz * side * post], 0.07, 0.06, P.tarPlankDark, 5);
    k.limb([sg.x - rx * (post + 0.08), y + 2.15, sg.z - rz * (post + 0.08)], [sg.x + rx * (post + 0.08), y + 2.15, sg.z + rz * (post + 0.08)], 0.05, 0.05, P.tarPlankLight, 4);
    k.add(new BoxGeometry(SIGN_BOARD.w, SIGN_BOARD.h, SIGN_BOARD.d), { at: [sg.x, y + SIGN_BOARD.y, sg.z], rot: [0, Math.PI / 2 - sg.yaw, 0], colour: P.tarPlankDark });
  }
  // free-standing banners hang from a pole (the Houses' and the Constabulary's hang on the Exchange's beam, the campanile and the flagpole)
  // every cloth hangs from a rod along its top edge (the cloth's frame: `n` its face, `r` along it, as `buildSaltmarketCloth` lays it), and the rod is held by something standing
  for (const b of plan.banners) {
    const y = g(b.x, b.z);
    const k = kitAt(b.x, b.z);
    const nx = Math.cos(b.yaw), nz = Math.sin(b.yaw), rx = nz, rz = -nx;
    const top = y + b.top + 0.03;   // (the rod's underside on the cloth's top edge)
    const along = (s: number, out = 0.02): V3 => [b.x + rx * s + nx * out, top, b.z + rz * s + nz * out];
    if (b.kind === "society" || b.kind === "syndicate") {
      // a free-standing pole at the near edge, the rod out from it
      const px = b.x - rx * (b.w / 2 + 0.1), pz = b.z - rz * (b.w / 2 + 0.1);
      k.limb([px, y - 0.2, pz], [px, y + b.top + 0.4, pz], 0.09, 0.06, P.tarPlankDark, 5);
      k.add(new SphereGeometry(0.13, 5, 4), { at: [px, y + b.top + 0.5, pz], colour: P.brass });
      k.limb([px, top, pz], along(b.w / 2 + 0.06), 0.03, 0.03, P.tarPlankDark, 4);
      continue;
    }
    // on a hair (the Constabulary's on the flagpole, a House's on the campanile): a rod along the top edge and iron arms back to the hair
    const hostHair = plan.hairs.find((h) => (h.kind === "flagpole" || h.kind === "campanile") && Math.hypot(h.x - b.x, h.z - b.z) < h.r + 3);
    if (!hostHair) continue;   // (the Exchange's House banner hangs on the colonnade's front beam: the beam is its rod)
    k.limb(along(-b.w / 2 - 0.06), along(b.w / 2 + 0.06), 0.03, 0.03, P.tarPlankDark, 4);
    if (hostHair.kind === "flagpole") {
      // a gaff arm from the pole to the rod's near end
      const near = along(-b.w / 2 - 0.02);
      k.limb([hostHair.x, top, hostHair.z], near, 0.035, 0.03, P.iron, 4);
    } else {
      // two arms straight back into the bell loft's deck (its edge is 1.0 from the tower's axis, its underside at 12.77)
      const back = (b.x - hostHair.x) * nx + (b.z - hostHair.z) * nz - 0.9;   // from the cloth's plane to 0.1 inside the deck's edge
      for (const s of [-0.75, 0.75]) {
        const a = along(s, 0);
        k.limb(a, [a[0] - nx * back, top, a[2] - nz * back], 0.03, 0.03, P.iron, 4);
      }
    }
  }
  // the lanterns on the hairs, the quay's lamp, the bridges' and the Exchange's: the points of light the view adds
  for (const h of plan.hairs) if (h.kind === "lantern") lamps.push({ x: h.x, y: g(h.x, h.z) + h.height + 0.1, z: h.z });
  lamps.push({ x: plan.quay.x - plan.quay.half + 0.15, y: L + 3.1, z: plan.quay.z1 - 0.3 });
  const customs = plan.bridges[0]!;
  for (const s of [-1, 1]) lamps.push({ x: customs.x + s * (SALTMARKET.deckHalf + 0.8), y: L + 2.5, z: customs.z + customs.hl - 1.0 });
  for (const x of EXCHANGE_LANTERN_X) lamps.push({ x, y: g(plan.exchange.x, plan.exchange.z) + plan.exchange.eave - 1.0, z: SALTMARKET_ANCHORS.exchange.z + 11 - EXCHANGE_LANTERN_IN });
  plan.boats.filter((b) => b.kind === "barge" || b.kind === "cutter").forEach((b) => lamps.push({ x: b.x, y: SALTMARKET.waterY + 1.45, z: b.z + (b.kind === "barge" ? 4.2 : 3.4) }));
  return { geometries: kits.map((k) => k.build()), lamps, marks: houseOut.marks, roofs: houseOut.roofs.finish(), panes: houseOut.panes };
}

/** The boardwalk's planks, as their own merged geometries: a plank is only 3 vertices of cost per 0.46 m, but a path across a quarter of the map is never culled whole. */
export function buildSaltmarketPlanks(world: CollisionWorld, lod: Lod): (BufferGeometry | undefined)[] {
  const plan = saltmarketPlan();
  const kits = [new Kit(), new Kit(), new Kit(), new Kit()];
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  const bridgeRects = plan.bridges.map((b) => (b.yaw === 0 ? { x0: b.x - SALTMARKET.deckHalf - 0.6, x1: b.x + SALTMARKET.deckHalf + 0.6, z0: b.z - b.hl, z1: b.z + b.hl } : { x0: b.x - b.hl, x1: b.x + b.hl, z0: b.z - SALTMARKET.deckHalf - 0.6, z1: b.z + SALTMARKET.deckHalf + 0.6 }));
  const quay = plan.quay;
  const skip = (x: number, z: number): boolean => bridgeRects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) || (Math.abs(x - quay.x) < quay.half + 0.2 && z > quay.z0 - 0.5) || (x > plan.covePier.x0 - 0.2 && x < plan.covePier.x1 && Math.abs(z - plan.covePier.z) < 1.4);
  plan.boardwalks.forEach((w, wi) => {
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const a = w.pts[i]!, b = w.pts[i + 1]!;
      const k = kits[(((a.x + b.x) / 2 >= 0 ? 1 : 0) + ((a.z + b.z) / 2 >= -10 ? 2 : 0))]!;
      // planks across the path; the stringers on either side
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const yaw = Math.atan2(dz, dx);
      const step = lod ? 0.46 : 1.4;
      const n = Math.max(1, Math.floor(len / step));
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n;
        const cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
        if (skip(cx, cz)) continue;
        const y = g(cx, cz) + 0.07;
        const r = h01(400 + wi, j, Math.round(cx), i);
        k.setBase(cx, y, cz, yaw);
        box(k, [(len / n) * 0.82, 0.08, 2.4], [0, 0, 0], r > 0.78 ? P.tarPlankLight : r < 0.28 ? P.tarPlankDark : P.tarPlank);
        if (lod && j % 6 === 0) for (const s of [-1, 1]) k.limb([0, -0.25, s * 1.3], [0, 0.4, s * 1.3], 0.07, 0.06, P.pilingDark, 4);
        k.clearBase();
      }
    }
  });
  return kits.map((k) => k.build());
}

