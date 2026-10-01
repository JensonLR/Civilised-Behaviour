import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Euler, ExtrudeGeometry, LatheGeometry, PlaneGeometry, Shape, SphereGeometry, TorusGeometry, Vector2, Vector3 } from "three";
import { GATE_CLOCK_Y, MILL, PALETTE, RIVER, hash3, villagePlan, type Building, type CollisionWorld, type Lantern, type LandscapeTerrain, type VProp, type VillagePlan } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import { crateSlim } from "./objects.ts";
import { RoofKits, type DoorMark, type RoofSource } from "./rooms.ts";
import type { WindowPane } from "./camplife.ts";
import type { Lod } from "./flora.ts";

/**
 * HOLLOWMERE, drawn from `shared/village.ts` (the plan that also makes its collision): stilted river houses, round-roofed granaries on mushroom
 * stones, the terraced meeting hall, cottages, the smithy, the mill with its turning wheel, the gate-tower whose clock tells the hour, market
 * stalls under striped awnings, and everything that makes a place lived in (fences, gardens, washing, drying racks, wells, carts, crates,
 * lamps). ONE merged geometry (one draw, one ink hull); the parts that move (awnings, washing, lamps, the wheel, the punt, the clock's hands) carry
 * an `aSway` value the "village" wind kind understands (0..1 cloth, 2 wheel, 3 punt, 4-7 clock hands).
 *
 * Every wall is a hollow shell with a real doorway, its inner faces painted dark, so the door you walk through opens onto a dark room. Building
 * frame: local +x is the FRONT (door side), +z to the right, y up from the ground; floors and roofs sit at the heights the plan says.
 */

const W = PALETTE.world;
const C = PALETTE.camp;
const M = PALETTE.material;
const f01 = (seed: number, a: number, b = 0, c = 0): number => hash3(seed, a, b, c) / 4294967296;
const WALL_T = 0.28;
// D-038: the inside of a room is warm timber, never black (LEVEL_PLAN section 4, rule 6): the village's rooms are lit by their windows and a lamp
const INTERIOR = new Color(W.vlTimber);
const cStoneDark = new Color(W.vlStoneDark);
const cMoss = new Color(W.moss);

const bx = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3, sway = 0): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true, sway });
};
const cyl = (k: Kit, rt: number, rb: number, h: number, at: V3, colour: number | ColourFn, seg = 8, rot?: V3, sway = 0): void => {
  k.add(new CylinderGeometry(rt, rb, h, seg), { at, rot, colour, flat: true, sway });
};

// ---- styles -----------------------------------------------------------------------------------------------------------------------------

type Roofing = "shingle" | "tile" | "thatch";
interface Style {
  wall: number;
  roof: Roofing;
  door: number;
  shutter: number;
}
const STYLE: Record<string, Style> = {
  "cot-a": { wall: W.vlPlasterOchre, roof: "shingle", door: W.vlDoor, shutter: W.vlShutter },
  "cot-b": { wall: W.vlPlaster, roof: "tile", door: W.vlShutter, shutter: W.vlDoor },
  "cot-c": { wall: W.vlPlasterRose, roof: "thatch", door: W.vlDoor, shutter: W.vlShutter },
  "stilt-w": { wall: W.vlTimberLight, roof: "thatch", door: W.vlDoor, shutter: W.vlShutter },
  "stilt-e": { wall: W.vlTimberLight, roof: "thatch", door: W.vlShutter, shutter: W.vlDoor },
  "gran-a": { wall: W.vlPlaster, roof: "shingle", door: W.vlDoor, shutter: W.vlShutter },
  "gran-b": { wall: W.vlPlasterOchre, roof: "shingle", door: W.vlShutter, shutter: W.vlDoor },
  hall: { wall: W.vlPlasterOchre, roof: "tile", door: W.vlDoor, shutter: W.vlShutter },
  shop: { wall: W.vlStone, roof: "tile", door: W.vlDoor, shutter: W.vlShutter },
  mill: { wall: W.vlPlaster, roof: "tile", door: W.vlDoor, shutter: W.vlShutter },
  gate: { wall: W.vlPlaster, roof: "shingle", door: W.vlDoor, shutter: W.vlShutter },
};
const styleOf = (b: Building): Style => STYLE[b.id] ?? STYLE["cot-a"]!;

// ---- colours ---------------------------------------------------------------------------------------------------------------------------------

/** Lime-wash: a soft mottled wall with a damp, splashed foot and a dirty band under the eaves. `atY` is the piece's height in the building frame. */
const plaster = (base: number, seed: number, atY: number, inward?: readonly [number, number]): ColourFn => (p, n, out) => {
  const y = p.y + atY;
  if (inward && n.x * inward[0] + n.z * inward[1] > 0.55) {
    out.copy(INTERIOR).lerp(cStoneDark, 0.1 + 0.2 * f01(seed, Math.floor(p.x * 3), Math.floor(y * 3)));
    return;
  }
  blend(out, base, W.vlPlasterShade, 0.06 + 0.24 * f01(seed, Math.floor(p.x * 4 + p.z * 4), Math.floor(y * 3.5)));
  if (y < 0.85) out.lerp(cStoneDark, (0.85 - y) * 0.32);
  if (n.y > 0.5) out.multiplyScalar(1.08);
};
const timberC = (base: number = W.vlTimber, seed = 1): ColourFn => (p, _n, out) => {
  blend(out, base, W.vlTimberLight, 0.12 + 0.38 * f01(seed, Math.floor(p.y * 6), Math.floor((p.x + p.z) * 5)));
};
/** River-stone courses: each block its own tone. */
const stoneC = (seed: number, atY = 0, moss = 0.25): ColourFn => (p, n, out) => {
  const t = f01(seed, Math.floor((p.x + p.z) * 3.2), Math.floor((p.y + atY) * 4));
  blend(out, W.vlStone, t < 0.3 ? W.vlStoneDark : W.rockPale, t < 0.3 ? 0.55 : t * 0.4);
  if (p.y + atY < 0.5) out.lerp(cMoss, moss * (0.5 - (p.y + atY)));
  if (n.y > 0.6) out.multiplyScalar(1.1);
};
const inside = (fn: ColourFn, dark = 1): ColourFn => (p, n, out) => {
  if (n.y < -0.3) out.copy(INTERIOR);
  else fn(p, n, out);
  if (dark !== 1 && n.y < -0.3) out.multiplyScalar(dark);
};

const ROOF_COL: Record<Roofing, [number, number, number]> = {
  shingle: [W.vlShingle, W.vlShingleDark, W.verdigrisLight],
  tile: [W.vlTile, W.vlTileDark, W.copper],
  thatch: [W.vlThatch, W.vlThatchDark, W.vlHay],
};

/** One roofing colour by course and column (bonded like brickwork), plus a mossy or streaky fleck; the underside is the dark inside of the roof. */
function roofColour(style: Roofing, seed: number, rows: number, cols: number, length: number, width: number): ColourFn {
  const [a, b, c] = ROOF_COL[style];
  return (p, n, out) => {
    if (n.y < -0.2) {
      out.copy(INTERIOR);
      return;
    }
    const row = Math.floor((p.x / length + 0.5) * rows);
    const col = Math.floor((p.z / width + 0.5) * cols + (row & 1) * 0.5);
    const t = f01(seed, row, col);
    if (style === "thatch") {
      blend(out, a, b, 0.2 + 0.6 * f01(seed, col, Math.floor(row / 2)));
      if (t > 0.9) out.lerp(new Color(c), 0.5);
    } else {
      blend(out, t < 0.5 ? a : b, c, t > 0.86 ? 0.5 : 0.06 + t * 0.12);
      if (style === "shingle" && ((row + col) & 1) === 0) out.multiplyScalar(0.9);
      if (f01(seed + 7, row, col) > 0.93) out.lerp(cMoss, 0.4);
    }
  };
}

// ---- roofs ---------------------------------------------------------------------------------------------------------------------------------

/** A sloping roof plane (faceted courses on top, a thin dark slab under it). `L` runs down the slope, `Wd` along the eave. */
function roofPlane(k: Kit, lod: Lod, style: Roofing, seed: number, L: number, Wd: number, at: V3, rot: V3, thick = 0.1): void {
  const rows = lod ? Math.max(3, Math.round(L / 0.44)) : 1;
  const cols = lod ? Math.max(3, Math.round(Wd / 0.62)) : 1;
  const top = new PlaneGeometry(L, Wd, rows, cols);
  top.rotateX(-Math.PI / 2);
  k.add(top, { at, rot, colour: roofColour(style, seed, rows, cols, L, Wd), perFace: lod === 1, flat: lod === 0, jitter: style === "thatch" && lod ? 0.04 : lod ? 0.008 : 0, seed });
  // the plane's underside slab: a dark board, and (for thatch) a fat rounded eave
  k.add(new BoxGeometry(L, thick, Wd), { at: shift(at, rot, 0, -thick / 2 - 0.04, 0), rot, colour: inside(timberC(W.vlTimber, seed), 1), flat: true });
}

const shiftE = new Euler();
const shiftV = new Vector3();
/** Moves a point along a rotated frame's local axes (rot is the piece's XYZ Euler). */
function shift(at: V3, rot: V3, lx: number, ly: number, lz: number): V3 {
  shiftV.set(lx, ly, lz).applyEuler(shiftE.set(rot[0], rot[1], rot[2]));
  return [at[0] + shiftV.x, at[1] + shiftV.y, at[2] + shiftV.z];
}

/**
 * A gabled roof over a rectangle: the ridge runs along local z (so the eaves are the +x and -x sides and the front door sits under an eave).
 * Gable ends are filled in with lime-wash; the ridge has a cap. `y` is the wall top.
 */
function gableRoof(k: Kit, lod: Lod, b: { hx: number; hz: number }, y: number, rise: number, over: number, style: Roofing, seed: number, wallCol: number, ridgeAlong: "z" | "x" = "z"): void {
  const along = ridgeAlong === "z";
  const hx = along ? b.hx : b.hz; // half-span across the ridge
  const hz = along ? b.hz : b.hx; // half-length along the ridge
  const pitch = Math.atan2(rise, hx);
  const L = (hx + over) / Math.cos(pitch);
  const Wd = 2 * (hz + 0.38);
  const wrap = (v: V3): V3 => (along ? v : [v[2], v[1], v[0]]);
  for (const s of [-1, 1]) {
    const cx = (s * (hx + over)) / 2;
    const cy = y + rise - ((hx + over) * rise) / (2 * hx) + 0.05;
    const rz = -s * pitch;
    if (along) roofPlane(k, lod, style, seed + s, L, Wd, [cx, cy, 0], [0, 0, rz], style === "thatch" ? 0.22 : 0.1);
    else roofPlane(k, lod, style, seed + s, L, Wd, [0, cy, cx], [0, -Math.PI / 2, rz], style === "thatch" ? 0.22 : 0.1);
  }
  // gable-end triangles in lime-wash (the ridge line is a little proud of them)
  const tri = new Shape();
  tri.moveTo(-hx, 0);
  tri.lineTo(hx, 0);
  tri.lineTo(0, rise);
  tri.closePath();
  for (const s of [-1, 1]) {
    const g = new ExtrudeGeometry(tri, { depth: WALL_T, bevelEnabled: false });
    g.translate(0, 0, -WALL_T / 2);
    const inward: [number, number] = along ? [0, -s] : [-s, 0];
    if (along) k.add(g, { at: [0, y, s * (hz - WALL_T / 2)], colour: plaster(wallCol, seed + 3, y, inward), flat: true });
    else k.add(g, { at: [s * (hz - WALL_T / 2), y, 0], rot: [0, Math.PI / 2, 0], colour: plaster(wallCol, seed + 3, y, inward), flat: true });
  }
  // ridge cap
  bx(k, wrap([0.22, 0.14, Wd + 0.06]), wrap([0, y + rise + 0.09, 0]), style === "thatch" ? W.vlThatchDark : W.vlTimber);
  // barge boards on the gable ends
  if (lod) for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      const at = wrap([t * (hx + over) * 0.5, y + rise - ((hx + over) * rise) / (2 * hx) - 0.02, s * (hz + 0.38)]);
      if (along) bx(k, [L, 0.13, 0.05], at, W.vlTimber, [0, 0, -t * pitch]);
      else bx(k, [L, 0.13, 0.05], at, W.vlTimber, [0, -Math.PI / 2, -t * pitch]);
    }
  }
}

/** A four-sided hip roof (or a pyramid when `top` is 0): `hx`/`hz` are the eave half-extents, rising `rise` to a ridge/apex of half-size `top`. */
function hipRoof(k: Kit, lod: Lod, hx: number, hz: number, y: number, rise: number, top: number, style: Roofing, seed: number, at: V3 = [0, 0, 0]): void {
  const g = new CylinderGeometry(Math.SQRT2 * top, Math.SQRT2, rise, 4, lod ? Math.max(2, Math.round(rise / 0.42)) : 1, false);
  g.rotateY(Math.PI / 4);
  g.scale(hx, 1, hz);
  const [a, b, c] = ROOF_COL[style];
  k.add(g, {
    at: [at[0], y + rise / 2 + at[1], at[2]],
    colour: (p, n, out) => {
      if (n.y < -0.9) {
        out.copy(INTERIOR);
        return;
      }
      const row = Math.floor((p.y + rise / 2) / 0.4);
      const col = Math.floor((Math.atan2(p.z, p.x) + Math.PI) * 5 + (row & 1) * 0.5) + Math.floor((Math.abs(p.x) + Math.abs(p.z)) * 3);
      const t = f01(seed, row, col);
      blend(out, t < 0.5 ? a : b, c, t > 0.88 ? 0.5 : 0.06 + t * 0.1);
      if (style === "shingle" && ((row + col) & 1) === 0) out.multiplyScalar(0.9);
    },
    perFace: lod === 1,
    flat: lod === 0,
    jitter: lod ? 0.01 : 0,
    seed,
  });
}

// ---- walls, doors, windows -----------------------------------------------------------------------------------------------------------------

/**
 * The four walls of a shell, a doorway `dw` wide on the front (0 = solid front, -1 = open front) with wall closed over it above `doorTop`,
 * inner faces dark. Heights are absolute (building frame). `wallCol(inward, centreY)` makes the colour function for a wall whose inside faces `inward`.
 */
function shell(k: Kit, b: { hx: number; hz: number }, y0: number, y1: number, dw: number, wallCol: (inward: readonly [number, number], atY: number) => ColourFn, doorTop = -1, t = WALL_T): void {
  const h = y1 - y0;
  const cy = (y0 + y1) / 2;
  const wall = (lx: number, lz: number, ex: number, ez: number, inw: readonly [number, number], ya = y0, yb = y1): void => {
    bx(k, [ex * 2, yb - ya, ez * 2], [lx, (ya + yb) / 2, lz], wallCol(inw, (ya + yb) / 2));
  };
  void h;
  void cy;
  wall(-b.hx + t / 2, 0, t / 2, b.hz, [1, 0]);
  wall(0, -b.hz + t / 2, b.hx, t / 2, [0, 1]);
  wall(0, b.hz - t / 2, b.hx, t / 2, [0, -1]);
  if (dw < 0) return;
  if (dw === 0) {
    wall(b.hx - t / 2, 0, t / 2, b.hz, [-1, 0]);
    return;
  }
  const side = (b.hz - dw / 2) / 2;
  wall(b.hx - t / 2, -(dw / 2 + side), t / 2, side, [-1, 0]);
  wall(b.hx - t / 2, dw / 2 + side, t / 2, side, [-1, 0]);
  if (doorTop > 0 && doorTop < y1) wall(b.hx - t / 2, 0, t / 2, dw / 2, [-1, 0], doorTop, y1);
}

/** A doorway's dressing: timber frame, a lintel with the sun-disc every Hollowmere door wears, and a plank leaf hung ajar into the dark. */
function doorway(k: Kit, lod: Lod, hx: number, floor: number, dw: number, dh: number, leaf: number, seed: number, disc = true): void {
  if (markSink) {
    const m = k.worldPoint(hx, floor, 0);
    markSink.push({ id: `${markFor}.door`, leads: "interior", leaf: true, x: m[0], y: m[1], z: m[2], yaw: k.yaw, width: dw });
  }
  if (!lod) return;
  const post = 0.13;
  for (const s of [-1, 1]) bx(k, [0.16, dh + 0.06, post], [hx + 0.03, floor + dh / 2, s * (dw / 2 + post / 2 - 0.02)], timberC(W.vlTimber, seed));
  bx(k, [0.2, 0.2, dw + post * 2 + 0.08], [hx + 0.04, floor + dh + 0.1, 0], timberC(W.vlTimber, seed + 1));
  if (disc) {
    // the sun-disc: a gilt plate on a blue lintel board
    bx(k, [0.06, 0.38, dw + 0.5], [hx + 0.02, floor + dh + 0.42, 0], W.vlDoor);
    const d = new CylinderGeometry(0.15, 0.15, 0.05, 10);
    d.rotateZ(Math.PI / 2);
    k.add(d, { at: [hx + 0.07, floor + dh + 0.42, 0], colour: W.vlHeraldGold, flat: true });
    if (lod) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      bx(k, [0.03, 0.05, 0.04], [hx + 0.07, floor + dh + 0.42 + Math.cos(a) * 0.19, Math.sin(a) * 0.19], W.vlHeraldGold, [a, 0, 0]);
    }
  }
  // the leaf hangs open into the room from the right-hand post, planked and iron-strapped
  const lw = dw * 0.92;
  const ang = 1.15;
  const hinge: V3 = [hx - WALL_T / 2 - 0.03, floor, dw / 2 - 0.02];
  const cx = hinge[0] - Math.sin(ang) * (lw / 2);
  const cz = hinge[2] - Math.cos(ang) * (lw / 2);
  bx(k, [lw, dh - 0.12, 0.06], [cx, floor + (dh - 0.12) / 2 + 0.02, cz], (p, _n, out) => blend(out, leaf, W.vlTimber, 0.15 + 0.35 * f01(seed, Math.floor(p.x * 9))), [0, ang, 0]);
  if (lod) for (const y of [0.35, dh - 0.45]) bx(k, [lw * 0.94, 0.09, 0.07], [cx, floor + y, cz], C.iron, [0, ang, 0]);
}

/** A window in a wall whose OUTER face is at `face` along the axis (fx, fz): dark glass, a frame, a sill, and a pair of shutters folded back. */
let paneSink: WindowPane[] | undefined;
/** D-038: the doors the village drew (`doorway` pushes one per call; the building being drawn names it). */
let markSink: DoorMark[] | undefined;
let markFor = "";

function windowOn(k: Kit, lod: Lod, fx: number, fz: number, lx: number, lz: number, y: number, w: number, h: number, shutter: number, seed: number, box = false): void {
  if (!lod) return; // (details do not carry an ink line)
  if (paneSink) {
    // remember where the glass is, so the lantern-glass mesh can light it at night
    const wp = k.worldPoint(lx + fx * 0.04, y, lz + fz * 0.04);
    paneSink.push({ x: wp[0], y: wp[1], z: wp[2], yaw: k.yaw + Math.atan2(fz, fx), w, h, lit: f01(seed, 71) < 0.62 });
  }
  const yawAng = Math.atan2(fz, fx);
  // local frame of the window: +u along the wall (perpendicular to the facing), n outward
  const nx = fx;
  const nz = fz;
  const ux = -fz;
  const uz = fx;
  const at = (u: number, n: number, yy: number): V3 => [lx + ux * u + nx * n, yy, lz + uz * u + nz * n];
  const rotY: V3 = [0, -yawAng, 0];
  // a dark pane set into the wall face
  bx(k, [0.06, h, w], at(0, 0.01, y), W.vlSoot, rotY);
  for (const s of [-1, 1]) {
    bx(k, [0.09, h + 0.1, 0.07], at(s * (w / 2 + 0.035), 0.04, y), timberC(W.vlTimber, seed), rotY);
  }
  bx(k, [0.09, 0.07, w + 0.14], at(0, 0.04, y + h / 2 + 0.035), timberC(W.vlTimber, seed), rotY);
  bx(k, [0.16, 0.07, w + 0.2], at(0, 0.08, y - h / 2 - 0.035), W.vlStone, rotY);
  if (lod) bx(k, [0.05, h, 0.03], at(0, 0.02, y), W.vlTimber, rotY);
  // shutters, folded back against the wall
  for (const s of [-1, 1]) bx(k, [0.05, h + 0.02, w * 0.5], at(s * (w / 2 + w * 0.27), 0.07, y), (p, _n, out) => blend(out, shutter, W.vlTimber, 0.1 + 0.3 * f01(seed + 5, Math.floor(p.z * 8))), rotY);
  if (box) {
    // a window box full of blooms
    bx(k, [0.22, 0.14, w + 0.16], at(0, 0.16, y - h / 2 - 0.16), timberC(W.vlTimber, seed + 2), rotY);
    if (lod) for (let i = 0; i < 6; i++) {
      const u = -w / 2 + (w * (i + 0.5)) / 6;
      const col = [W.bloomRed, W.bloomYellow, W.bloomWhite, W.bloomPink, W.bloomViolet][(seed + i) % 5]!;
      k.add(new SphereGeometry(0.06 + f01(seed, i) * 0.03, 5, 4), { at: at(u, 0.16, y - h / 2 - 0.05), colour: col, flat: true });
    }
  }
}

/** A rectangular footing: courses of river stone from below ground up to the floor, and plank floor inside. */
function footing(k: Kit, lod: Lod, hx: number, hz: number, floor: number, seed: number, cx = 0, depth = 0.7, floorCol: number = W.vlTimberLight, floorInset = WALL_T): void {
  const g = new BoxGeometry(hx * 2 + 0.16, floor + depth, hz * 2 + 0.16, lod ? Math.max(2, Math.round(hx * 2.4)) : 1, lod ? 2 : 1, lod ? Math.max(2, Math.round(hz * 2.4)) : 1);
  k.add(g, {
    at: [cx, (floor - depth) / 2, 0],
    colour: (p, n, out) => {
      if (n.y > 0.7) {
        const inner = Math.abs(p.x) < hx - floorInset + 0.02 && Math.abs(p.z) < hz - floorInset + 0.02;
        if (inner) blend(out, floorCol, W.vlTimber, 0.15 + 0.5 * f01(seed, Math.floor(p.z * 5), Math.floor(p.x * 0.7)));
        else stoneC(seed, 0)(p, n, out);
        return;
      }
      stoneC(seed, 0)(p, n, out);
    },
    perFace: lod === 1,
    flat: lod === 0,
    jitter: lod ? 0.018 : 0,
    seed,
  });
}

// ---- the buildings ---------------------------------------------------------------------------------------------------------------------------

function chimney(k: Kit, lod: Lod, x: number, z: number, y0: number, y1: number, seed: number, wide = 0.6): void {
  k.add(new BoxGeometry(wide, y1 - y0, wide, 1, lod ? 3 : 1, 1), { at: [x, (y0 + y1) / 2, z], colour: stoneC(seed, y0, 0.05), perFace: lod === 1, flat: lod === 0, jitter: lod ? 0.012 : 0, seed });
  bx(k, [wide + 0.16, 0.12, wide + 0.16], [x, y1 + 0.02, z], W.vlStoneDark);
  if (lod) {
    for (const s of [-1, 1]) cyl(k, 0.09, 0.11, 0.3, [x + s * wide * 0.22, y1 + 0.2, z], W.vlTileDark, 6);
  }
}

function cottage(k: Kit, kr: Kit, lod: Lod, b: Building, st: Style): void {
  const s = b.spec;
  const seed = Math.floor(b.x * 7 + b.z * 13);
  footing(k, lod, b.hx, b.hz, s.floor, seed);
  const y0 = s.floor;
  const y1 = s.floor + s.wall;
  shell(k, b, y0, y1, s.door, (inw, cy) => plaster(st.wall, seed, cy, inw), y0 + 2.4);
  // timber framing: a plate under the eaves and corner posts
  if (lod) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(k, [0.2, s.wall, 0.2], [sx * (b.hx - 0.04), y0 + s.wall / 2, sz * (b.hz - 0.04)], timberC(W.vlTimber, seed));
    bx(k, [b.hx * 2 + 0.16, 0.16, 0.14], [0, y1 - 0.08, b.hz + 0.02], timberC(W.vlTimber, seed + 1));
    bx(k, [b.hx * 2 + 0.16, 0.16, 0.14], [0, y1 - 0.08, -b.hz - 0.02], timberC(W.vlTimber, seed + 1));
    for (const sx of [-1, 1]) bx(k, [0.14, 0.16, b.hz * 2 + 0.16], [sx * (b.hx + 0.02), y1 - 0.08, 0], timberC(W.vlTimber, seed + 2));
  }
  doorway(k, lod, b.hx, y0, s.door, 2.4, st.door, seed);
  windowOn(k, lod, 1, 0, b.hx, s.door / 2 + 0.95, y0 + 1.35, 0.5, 0.62, st.shutter, seed + 3, true);
  windowOn(k, lod, 1, 0, b.hx, -s.door / 2 - 0.95, y0 + 1.35, 0.5, 0.62, st.shutter, seed + 4, false);
  windowOn(k, lod, 0, 1, -0.3, b.hz, y0 + 1.35, 0.55, 0.62, st.shutter, seed + 5, true);
  windowOn(k, lod, 0, -1, 0.4, -b.hz, y0 + 1.35, 0.55, 0.62, st.shutter, seed + 6, false);
  gableRoof(kr, lod, b, y1, 1.55, 0.5, st.roof, seed + 10, st.wall);   // (the roof is its own piece: the cutaway lifts it)
  chimney(k, lod, -b.hx * 0.4, 0.6, y1 - 0.3, y1 + 2.0, seed + 11);
  // the room: a table, a stool and a bed on the floor (dark; you see them from the door)
  if (lod) {
    bx(k, [0.9, 0.06, 0.7], [-0.4, y0 + 0.74, -0.8], timberC(W.vlTimberLight, seed), undefined);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(k, [0.06, 0.72, 0.06], [-0.4 + sx * 0.38, y0 + 0.37, -0.8 + sz * 0.28], W.vlTimber);
    bx(k, [1.9, 0.3, 0.85], [-b.hx + 1.25, y0 + 0.2, b.hz - 0.7], (_p, _n, out) => out.set(W.vlTimberLight).multiplyScalar(0.6));
    bx(k, [1.75, 0.08, 0.75], [-b.hx + 1.25, y0 + 0.38, b.hz - 0.7], (_p, _n, out) => out.set(M.linen).multiplyScalar(0.55));
  }
  // ivy climbing the side wall
  if (lod) for (let i = 0; i < 5; i++) k.add(new SphereGeometry(0.28 + f01(seed, i) * 0.14, 5, 4), { at: [-b.hx * 0.3 - i * 0.16, y0 + 0.5 + i * 0.5 + f01(seed, i, 2) * 0.3, -b.hz - 0.12], scale: [1, 1, 0.5], colour: i % 2 ? W.vine : W.vineLight, flat: true });
}

function stilt(k: Kit, kr: Kit, lod: Lod, b: Building, st: Style): void {
  const s = b.spec;
  const seed = Math.floor(b.x * 5 + b.z * 11);
  const fl = s.floor;
  // stilts, cross-braces and a boarded crawl-space
  const posts: [number, number][] = [];
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) posts.push([sx * (b.hx - 0.15), sz * (b.hz - 0.15)]);
  for (const sz of [-1, 1]) posts.push([b.hx + 1.05, sz * (b.hz - 0.15)]);
  for (const [px, pz] of posts) cyl(k, 0.13, 0.17, fl + 0.9, [px, (fl - 0.9) / 2 - 0.05, pz], (p, _n, out) => blend(out, W.vlTimber, W.moss, Math.max(0, 0.5 - (p.y + fl / 2) * 0.8) * 0.4), 7);
  if (lod) {
    for (const sz of [-1, 1]) {
      k.limb([-b.hx + 0.1, 0.1, sz * (b.hz - 0.2)], [b.hx - 0.1, fl - 0.15, sz * (b.hz - 0.2)], 0.035, 0.035, W.vlTimber, 4);
      k.limb([b.hx - 0.1, 0.1, sz * (b.hz - 0.2)], [-b.hx + 0.1, fl - 0.15, sz * (b.hz - 0.2)], 0.035, 0.035, W.vlTimber, 4);
    }
  }
  const lattice: ColourFn = (p, _n, out) => blend(out, W.vlTimber, W.vlTimberLight, ((Math.floor(p.x * 5) + Math.floor(p.y * 5)) & 1) * 0.5 + 0.1);
  bx(k, [0.06, fl - 0.05, b.hz * 2 - 0.3], [-b.hx + 0.1, (fl - 0.05) / 2 - 0.3, 0], lattice);
  for (const sz of [-1, 1]) bx(k, [b.hx * 2 - 0.3, fl - 0.05, 0.06], [0, (fl - 0.05) / 2 - 0.3, sz * (b.hz - 0.1)], lattice);
  // the deck, its planks and a porch
  const deckHx = b.hx + 0.6;
  k.add(new BoxGeometry(deckHx * 2, 0.16, b.hz * 2 + 0.2, lod ? 1 : 1, 1, lod ? 8 : 1), {
    at: [0.6, fl - 0.08, 0],
    colour: (p, n, out) => {
      blend(out, W.vlTimberLight, W.vlTimber, 0.15 + 0.5 * f01(seed, Math.floor(p.z * 5.5), Math.floor(p.x * 0.9)));
      if (n.y < -0.5) out.multiplyScalar(0.7);
    },
    flat: true,
  });
  // steps
  b.steps.forEach((top, i) => bx(k, [0.5, 0.12 + Math.max(0, top - b.ground) * 0.0, 1.1], [b.hx + 1.2 + 0.25 + i * 0.5, top - b.ground - 0.06, 0], timberC(W.vlTimberLight, seed + i)));
  const lowest = (b.steps[b.steps.length - 1] ?? fl) - b.ground;
  for (const sz of [-1, 1]) k.limb([b.hx + 1.15, fl - 0.1, sz * 0.56], [b.hx + 1.2 + 0.25 + b.steps.length * 0.5, lowest - 0.2, sz * 0.56], 0.04, 0.04, W.vlTimber, 4);
  // walls of upright weatherboard, doorway, a window each side
  const boards = (inw: readonly [number, number], cy: number): ColourFn => (p, n, out) => {
    if (n.x * inw[0] + n.z * inw[1] > 0.55) {
      out.copy(INTERIOR);
      return;
    }
    blend(out, st.wall, W.vlTimber, 0.1 + 0.4 * f01(seed, Math.floor((p.x + p.z) * 7)) + (((Math.floor((p.x + p.z) * 7)) & 1) ? 0.08 : 0));
    void cy;
  };
  shell(k, b, fl, fl + s.wall, s.door, (inw, cy) => boards(inw, cy), fl + 2.4);
  doorway(k, lod, b.hx, fl, s.door, 2.4, st.door, seed, true);
  windowOn(k, lod, 1, 0, b.hx, s.door / 2 + 0.8, fl + 1.3, 0.42, 0.5, st.shutter, seed + 3, true);
  windowOn(k, lod, 0, 1, 0.2, b.hz, fl + 1.3, 0.5, 0.5, st.shutter, seed + 4, false);
  windowOn(k, lod, 0, -1, 0.2, -b.hz, fl + 1.3, 0.5, 0.5, st.shutter, seed + 5, true);
  // a steep thatched roof, ridge along the door axis, hanging low over the porch
  gableRoof(kr, lod, b, fl + s.wall, 1.9, 0.55, st.roof, seed + 10, st.wall, "x");
  // porch: two posts and a small lean-to over it
  for (const sz of [-1, 1]) cyl(k, 0.06, 0.07, 2.2, [b.hx + 1.1, fl + 1.1, sz * (b.hz - 0.2)], timberC(W.vlTimber, seed + 8), 6);
  roofPlane(k, lod, st.roof, seed + 20, 1.7, b.hz * 2 + 0.3, [b.hx + 0.75, fl + s.wall - 0.02, 0], [0, Math.PI / 2, 0.16], 0.16);
  for (const sz of [-1, 1]) k.limb([b.hx + 1.1, fl + 2.15, sz * (b.hz - 0.2)], [b.hx, fl + 2.55, sz * (b.hz - 0.2)], 0.03, 0.03, W.vlTimber, 4);
  // railing along the deck's front edge
  if (lod) for (const sz of [-1, 1]) bx(k, [0.05, 0.05, 1.5], [b.hx + 1.15, fl + 0.85, sz * (b.hz * 0.5 + 0.35)], W.vlTimber);
  // a mooring rope and a net draped over the rail
  if (lod) bx(k, [0.5, 0.5, 0.03], [b.hx + 1.16, fl + 0.55, -b.hz + 0.55], M.rope, [0, 0, 0.05]);
}

function granary(k: Kit, lod: Lod, b: Building, st: Style): void {
  const s = b.spec;
  const seed = Math.floor(b.x * 3 + b.z * 17);
  const r = b.hx;
  // mushroom stones: a tapering stem with a wide cap, so no rat can climb them
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const px = Math.cos(a) * (r - 0.2);
    const pz = Math.sin(a) * (r - 0.2);
    cyl(k, 0.14, 0.22, s.floor + 0.05, [px, (s.floor - 0.6) / 2, pz], stoneC(seed + i, 0), 7);
    cyl(k, 0.34, 0.3, 0.14, [px, s.floor - 0.06, pz], stoneC(seed + i + 9, 0), 8);
  }
  // floor frame
  cyl(k, r + 0.12, r + 0.12, 0.18, [0, s.floor + 0.09, 0], timberC(W.vlTimber, seed), 14);
  // the drum: lime-wash between timber staves
  k.add(new CylinderGeometry(r, r + 0.04, s.wall, lod ? 16 : 10, lod ? 3 : 1), {
    at: [0, s.floor + 0.18 + s.wall / 2, 0],
    colour: (p, n2, out) => {
      const y = p.y + s.wall / 2;
      blend(out, st.wall, W.vlPlasterShade, 0.06 + 0.25 * f01(seed, Math.floor(y * 3), Math.floor(Math.atan2(p.z, p.x) * 3)));
      if (y < 0.4) out.lerp(cStoneDark, (0.4 - y) * 0.5);
      void n2;
    },
    flat: true,
  });
  if (lod) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    bx(k, [0.09, s.wall, 0.12], [Math.cos(a) * (r + 0.03), s.floor + 0.18 + s.wall / 2, Math.sin(a) * (r + 0.03)], timberC(W.vlTimber, seed), [0, -a, 0]);
  }
  for (const y of [s.floor + 0.3, s.floor + 0.18 + s.wall - 0.1]) k.add(new TorusGeometry(r + 0.04, 0.05, 4, lod ? 20 : 10), { at: [0, y, 0], rot: [Math.PI / 2, 0, 0], colour: W.vlTimber, flat: true });
  // the hatch on the front, up a ladder
  bx(k, [0.08, 1.0, 0.8], [r + 0.02, s.floor + 1.1, 0], W.vlDoor, undefined);
  const disc = new CylinderGeometry(0.13, 0.13, 0.05, 10);
  disc.rotateZ(Math.PI / 2);
  k.add(disc, { at: [r + 0.08, s.floor + 1.1, 0], colour: W.vlHeraldGold, flat: true });
  for (const sz of [-1, 1]) k.limb([r + 0.5, 0, sz * 0.32], [r + 0.08, s.floor + 1.25, sz * 0.32], 0.035, 0.035, W.vlTimber, 4);
  if (lod) for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    bx(k, [0.03, 0.03, 0.64], [r + 0.5 - 0.42 * t, t * (s.floor + 1.15) + 0.05, 0], W.vlTimber);
  }
  // the dome: a bulb of shingles in rings
  const prof: Vector2[] = [];
  const top = s.floor + 0.18 + s.wall;
  const pts: [number, number][] = [[r + 0.55, 0], [r + 0.5, 0.12], [r + 0.42, 0.42], [r + 0.2, 0.9], [r - 0.15, 1.35], [r - 0.6, 1.72], [r - 1.05, 1.96], [0.35, 2.15], [0.12, 2.35]];
  for (const [rr, yy] of pts) prof.push(new Vector2(Math.max(0.05, rr), yy));
  const dome = new LatheGeometry(prof, lod ? 16 : 9);
  const [a1, a2, a3] = ROOF_COL[st.roof];
  k.add(dome, {
    at: [0, top - 0.08, 0],
    colour: (p, nn, out) => {
      if (nn.y < -0.5) {
        out.copy(INTERIOR);
        return;
      }
      const row = Math.floor(p.y / 0.26);
      const col = Math.floor((Math.atan2(p.z, p.x) + Math.PI) * 4.6 + (row & 1) * 0.5);
      const t = f01(seed, row, col);
      blend(out, t < 0.5 ? a1 : a2, a3, t > 0.86 ? 0.5 : 0.05 + t * 0.12);
      if (((row + col) & 1) === 0) out.multiplyScalar(0.92);
    },
    perFace: lod === 1,
    flat: lod === 0,
    jitter: lod ? 0.01 : 0,
    seed,
  });
  k.limb([0, top + 2.2, 0], [0, top + 3.0, 0], 0.03, 0.02, W.vlTimber, 4);
  k.add(new SphereGeometry(0.11, 6, 4), { at: [0, top + 2.35, 0], colour: W.vlHeraldGold, flat: true });
  // a little round window under the dome
  const win = new CylinderGeometry(0.18, 0.18, 0.06, 10);
  win.rotateZ(Math.PI / 2);
  k.add(win, { at: [r + 0.02, top - 0.55, 0], colour: W.vlSoot, flat: true });
}

function hall(k: Kit, kr: Kit, lod: Lod, b: Building, st: Style): void {
  const s = b.spec;
  const seed = 900;
  const fl = s.floor;
  // the terrace: a stone plinth under floor and porch, a wide low step, then the porch
  k.add(new BoxGeometry(b.hx * 2 + 1.2, fl + 0.7, b.hz * 2 + 0.3, lod ? 8 : 1, lod ? 2 : 1, lod ? 10 : 1), {
    at: [0.6, (fl - 0.7) / 2, 0],
    colour: (p, n, out) => {
      if (n.y > 0.7) {
        const inner = p.x < b.hx - 0.6 - WALL_T + 0.02 && p.x > -b.hx - 0.6 + WALL_T - 0.02 && Math.abs(p.z) < b.hz - WALL_T;
        if (inner) blend(out, W.vlTimberLight, W.vlTimber, 0.15 + 0.5 * f01(seed, Math.floor(p.z * 4), Math.floor(p.x * 0.7)));
        else blend(out, W.vlCobble, W.vlCobbleDark, 0.15 + 0.5 * f01(seed, Math.floor(p.x * 2), Math.floor(p.z * 2)));
        return;
      }
      stoneC(seed, 0)(p, n, out);
    },
    perFace: lod === 1,
    flat: lod === 0,
    jitter: lod ? 0.02 : 0,
    seed,
  });
  k.add(new BoxGeometry(1.1, fl - 0.45 + 0.7, 7.2, 2, 2, 8), {
    at: [b.hx + 1.3 + 0.55, (fl - 0.45 - 0.7) / 2, 0],
    colour: (p, n, out) => (n.y > 0.7 ? blend(out, W.vlCobble, W.vlCobbleDark, 0.2 + 0.4 * f01(seed + 2, Math.floor(p.z * 2))) : stoneC(seed + 1, 0)(p, n, out)),
    perFace: lod === 1,
    flat: lod === 0,
    jitter: lod ? 0.02 : 0,
    seed: seed + 1,
  });
  // tier one: broad walls with a great double doorway between timber posts
  const y0 = fl;
  const y1 = fl + s.wall;
  shell(k, b, y0, y1, s.door, (inw, cy) => plaster(st.wall, seed, cy, inw), y0 + 3.0);
  // timber frame with cross-bracing panels on the long sides
  if (lod) for (const sz of [-1, 1]) {
    for (let i = -3; i <= 3; i++) bx(k, [0.14, s.wall, 0.14], [i * (b.hx * 0.3), y0 + s.wall / 2, sz * (b.hz + 0.0)], timberC(W.vlTimber, seed + i + 4));
    bx(k, [b.hx * 2 + 0.2, 0.2, 0.16], [0, y1 - 0.1, sz * (b.hz + 0.02)], timberC(W.vlTimber, seed + 2));
    bx(k, [b.hx * 2 + 0.2, 0.16, 0.16], [0, y0 + 0.9, sz * (b.hz + 0.02)], timberC(W.vlTimber, seed + 3));
  }
  for (const sx of [-1, 1]) bx(k, [0.16, 0.2, b.hz * 2 + 0.2], [sx * (b.hx + 0.02), y1 - 0.1, 0], timberC(W.vlTimber, seed + 2));
  // the double door, standing open into the great room
  doorway(k, lod, b.hx, y0, s.door, 3.0, st.door, seed + 20, true);
  bx(k, [0.16, 0.2, s.door + 0.6], [b.hx + 0.05, y0 + 3.15, 0], W.vlHeraldGold);
  for (const sz of [-1, 1]) {
    windowOn(k, lod, 1, 0, b.hx, sz * (s.door / 2 + 1.5), y0 + 1.9, 0.6, 1.0, st.shutter, seed + 5 + sz, false);
    for (const lx of [-2.4, 0, 2.4]) windowOn(k, lod, 0, sz, lx, sz * b.hz, y0 + 1.9, 0.6, 1.0, st.shutter, seed + 9 + lx, lx === 0);
  }
  // roof tier one: a broad hip
  hipRoof(kr, lod, b.hx + 0.65, b.hz + 0.65, y1 - 0.05, 1.5, 0.62, st.roof, seed + 30);
  // tier two: a clerestory drum with slit windows and its own roof
  const hx2 = b.hx * 0.55;
  const hz2 = b.hz * 0.5;
  const t2 = y1 + 1.35;
  bx(kr, [hx2 * 2, 1.4, hz2 * 2], [0, y1 + 0.75, 0], plaster(st.wall, seed + 40, y1 + 0.75, undefined));
  bx(kr, [hx2 * 2 + 0.16, 0.14, hz2 * 2 + 0.16], [0, y1 + 1.5, 0], W.vlTimber);
  if (lod) for (const sz of [-1, 1]) for (let i = -2; i <= 2; i++) bx(kr, [0.4, 0.5, 0.06], [i * (hx2 * 0.4), y1 + 0.85, sz * (hz2 + 0.02)], W.vlSoot);
  hipRoof(kr, lod, hx2 + 0.55, hz2 + 0.55, t2 + 0.1, 1.2, 0.42, st.roof, seed + 31);
  // tier three: a cupola with a gilded finial and a flag
  bx(kr, [1.3, 0.9, 1.3], [0, t2 + 1.55, 0], plaster(st.wall, seed + 41, t2 + 1.55, undefined));
  hipRoof(kr, lod, 1.1, 1.1, t2 + 1.9, 1.0, 0.0, st.roof, seed + 32);
  kr.limb([0, t2 + 2.85, 0], [0, t2 + 4.0, 0], 0.03, 0.02, W.vlTimber, 4);
  kr.add(new SphereGeometry(0.1, 6, 4), { at: [0, t2 + 3.9, 0], colour: W.vlHeraldGold, flat: true });
  // benches on the porch, either side of the doors
  for (const sg of [-1, 1]) {
    bx(k, [0.46, 0.06, 1.6], [b.hx + 0.6, fl + 0.42, sg * (s.door / 2 + 1.9)], timberC(W.vlTimberLight, seed + 51));
    for (const zz of [-1, 1]) bx(k, [0.4, 0.4, 0.06], [b.hx + 0.6, fl + 0.2, sg * (s.door / 2 + 1.9) + zz * 0.65], W.vlTimber);
  }
  // the great room within: benches, the dais with a chair, roof posts
  const benchTop = fl + 0.44;
  for (const lx of [-1.0, 1.2]) for (const sg of [-1, 1]) {
    bx(k, [0.56, 0.06, 2.4], [lx, benchTop - 0.03, sg * 2.2], timberC(W.vlTimberLight, seed + 50));
    for (const zz of [-1, 1]) bx(k, [0.5, 0.4, 0.06], [lx, fl + 0.2, sg * 2.2 + zz * 1.0], W.vlTimber);
  }
  bx(k, [1.8, 0.3, 5.2], [-b.hx + 1.0, fl + 0.15, 0], (p, n, out) => (n.y > 0.5 ? blend(out, W.vlTimberLight, W.vlTimber, 0.3) : out.set(W.vlTimber)));
  bx(k, [0.6, 0.9, 0.6], [-b.hx + 0.85, fl + 0.75, 0], W.vlTimber);
  bx(k, [0.12, 1.4, 0.7], [-b.hx + 0.55, fl + 1.0, 0], W.vlTimber);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(k, 0.13, 0.16, s.wall, [sx * 1.2 - 0.4, fl + s.wall / 2, sz * 3.6], timberC(W.vlTimber, seed + 60), 7);
  // painted banner of the village on the back wall (the cloth is in the banners mesh); a brass gong
  k.add(new TorusGeometry(0.34, 0.04, 4, 12), { at: [-b.hx + 0.35, fl + 1.9, 2.4], rot: [0, Math.PI / 2, 0], colour: C.brass, flat: true });
  cyl(k, 0.3, 0.3, 0.05, [-b.hx + 0.36, fl + 1.9, 2.4], (_p, _n, out) => out.set(C.brass).multiplyScalar(0.85), 12, [0, 0, Math.PI / 2]);
}

function workshop(k: Kit, lod: Lod, b: Building, st: Style): void {
  const s = b.spec;
  const seed = 1200;
  const fl = s.floor;
  // flagged floor and stone footing
  k.add(new BoxGeometry(b.hx * 2, fl + 0.6, b.hz * 2, lod ? 4 : 1, 1, lod ? 5 : 1), {
    at: [0, (fl - 0.6) / 2, 0],
    colour: (p, n, out) => (n.y > 0.6 ? blend(out, W.vlCobble, W.vlSoot, 0.25 + 0.4 * f01(seed, Math.floor(p.x * 1.6), Math.floor(p.z * 1.6))) : stoneC(seed, 0)(p, n, out)),
    perFace: lod === 1,
    flat: lod === 0,
    jitter: lod ? 0.015 : 0,
    seed,
  });
  const y0 = fl;
  const y1 = fl + s.wall;
  // three stone walls to shoulder height, timber above; the front is open under a deep porch
  const stoneWall = (inw: readonly [number, number], cy: number): ColourFn => (p, n, out) => {
    if (n.x * inw[0] + n.z * inw[1] > 0.55) {
      out.copy(INTERIOR).lerp(new Color(W.vlSoot), 0.6);
      return;
    }
    stoneC(seed + 3, cy - 1.0, 0.1)(p, n, out);
  };
  shell(k, b, y0, y0 + 1.5, -1, (inw, cy) => stoneWall(inw, cy));
  shell(k, b, y0 + 1.5, y1, -1, (inw) => (p, n, out) => {
    if (n.x * inw[0] + n.z * inw[1] > 0.55) out.copy(INTERIOR).lerp(new Color(W.vlSoot), 0.5);
    else blend(out, W.vlTimberLight, W.vlTimber, 0.15 + 0.5 * f01(seed, Math.floor((p.x + p.z) * 5)));
  });
  // the open front: two posts and a beam, a deep lean of roof over the anvil
  for (const sz of [-1, 1]) cyl(k, 0.11, 0.13, s.wall + 0.05, [b.hx - 0.1, y0 + s.wall / 2, sz * (b.hz - 0.15)], timberC(W.vlTimber, seed + 1), 7);
  bx(k, [0.2, 0.22, b.hz * 2 + 0.1], [b.hx - 0.1, y1 - 0.11, 0], timberC(W.vlTimber, seed + 2));
  gableRoof(k, lod, b, y1, 1.35, 0.7, st.roof, seed + 10, W.vlPlaster, "x");
  // the forge: hearth, hood, chimney; glowing coals; a bellows
  const fx = -b.hx + 0.85;
  const fz = -b.hz + 1.0;
  bx(k, [1.7, 1.15, 1.5], [fx, y0 + 0.575, fz], stoneC(seed + 4, 0, 0));
  bx(k, [1.3, 0.05, 1.1], [fx, y0 + 1.16, fz], (_p, _n, out) => out.set(C.ember).multiplyScalar(1.0));
  bx(k, [0.7, 0.03, 0.5], [fx + 0.1, y0 + 1.2, fz], (_p, _n, out) => out.set(C.flameMid));
  k.add(new CylinderGeometry(0.3, 0.75, 1.4, 4), { at: [fx, y0 + 1.95, fz], rot: [0, Math.PI / 4, 0], colour: stoneC(seed + 5, 0, 0), flat: true });
  chimney(k, lod, fx, fz, y0 + 2.5, y1 + 4.0, seed + 6, 0.85);
  // anvil on a block, water trough, tools on the wall
  cyl(k, 0.24, 0.28, 0.5, [0.6, y0 + 0.25, -0.9], timberC(W.vlTimber, seed + 7), 7);
  bx(k, [0.6, 0.14, 0.22], [0.6, y0 + 0.58, -0.9], C.iron);
  bx(k, [0.3, 0.16, 0.24], [0.6, y0 + 0.72, -0.9], C.iron);
  k.add(new ConeGeometry(0.06, 0.32, 5), { at: [0.98, y0 + 0.68, -0.9], rot: [0, 0, -Math.PI / 2], colour: C.iron, flat: true });
  if (lod) for (let i = 0; i < 6; i++) {
    const zz = -b.hz + 1.9 + i * 0.28;
    bx(k, [0.05, 0.5 + f01(seed, i) * 0.3, 0.06], [-b.hx + 0.2, y0 + 1.9, zz], C.iron, [0, 0, 0.05 * i]);
  }
  bx(k, [0.06, 0.6, 3.6], [-b.hx + 0.18, y0 + 1.9, 0.6], W.vlTimber);
  // a workbench with a vice and a bench of horseshoes along the right wall
  bx(k, [0.8, 0.95, 2.0], [b.hx - 0.7, y0 + 0.475, b.hz - 1.5], timberC(W.vlTimberLight, seed + 9));
  if (lod) for (let i = 0; i < 4; i++) k.add(new TorusGeometry(0.11, 0.02, 4, 8, Math.PI * 1.6), { at: [-b.hx + 0.2, y0 + 1.4, -b.hz + 1.9 + i * 0.3], rot: [0, Math.PI / 2, 0], colour: C.iron, flat: true });
  // the sign hangs from a bracket: the board itself is in the banners mesh
  k.limb([b.hx + 0.05, y1 - 0.4, -0.7], [b.hx + 0.5, y1 - 0.4, -0.7], 0.025, 0.025, C.iron, 4);
}

function mill(k: Kit, kr: Kit, lod: Lod, b: Building, st: Style): void {
  const s = b.spec;
  const seed = 1500;
  const fl = s.floor;
  footing(k, lod, b.hx, b.hz, fl, seed, 0, 1.0);
  const y0 = fl;
  const midY = fl + 2.7;
  const y1 = fl + s.wall;
  // lower storey in river-stone (the wet wall, with the doorway), upper in lime-wash
  shell(k, b, y0, midY, s.door, (inw, cy) => (p, n, out) => {
    if (n.x * inw[0] + n.z * inw[1] > 0.55) out.copy(INTERIOR).lerp(cStoneDark, 0.2);
    else stoneC(seed + 1, cy - 0.6, 0.35)(p, n, out);
  }, y0 + 2.4);
  shell(k, b, midY, y1, 0, (inw, cy) => plaster(st.wall, seed + 2, cy, inw));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(k, [0.2, s.wall, 0.2], [sx * (b.hx - 0.04), y0 + s.wall / 2, sz * (b.hz - 0.04)], timberC(W.vlTimber, seed));
  for (const sz of [-1, 1]) bx(k, [b.hx * 2 + 0.16, 0.16, 0.14], [0, midY, sz * (b.hz + 0.02)], timberC(W.vlTimber, seed + 1));
  bx(k, [0.14, 0.16, b.hz * 2 + 0.16], [b.hx + 0.02, midY, 0], timberC(W.vlTimber, seed + 1));
  doorway(k, lod, b.hx, y0, s.door, 2.4, st.door, seed, true);
  windowOn(k, lod, 1, 0, b.hx, s.door / 2 + 1.0, y0 + 2.9, 0.5, 0.6, st.shutter, seed + 4, false);
  windowOn(k, lod, 1, 0, b.hx, -s.door / 2 - 1.0, y0 + 2.9, 0.5, 0.6, st.shutter, seed + 5, true);
  windowOn(k, lod, 0, 1, 0.4, b.hz, y0 + 2.9, 0.5, 0.6, st.shutter, seed + 6, false);
  // the hoist door in the gable, with a beam and pulley
  gableRoof(kr, lod, b, y1, 1.9, 0.5, st.roof, seed + 10, st.wall);
  bx(k, [0.06, 0.9, 0.7], [b.hx + 0.02, y1 + 0.6, 0], W.vlDoor);
  k.limb([b.hx - 0.2, y1 + 1.2, 0], [b.hx + 1.0, y1 + 1.25, 0], 0.05, 0.05, W.vlTimber, 5);
  k.limb([b.hx + 0.95, y1 + 1.2, 0], [b.hx + 0.95, y1 + 0.2, 0], 0.01, 0.01, C.rope, 3);
  bx(k, [0.16, 0.14, 0.14], [b.hx + 0.95, y1 + 0.1, 0], W.vlHay);
  chimney(k, lod, -b.hx * 0.5, -b.hz * 0.4, y1 - 0.4, y1 + 2.1, seed + 12);
  // inside: the runner stone on its bed, a hopper above it, sacks
  cyl(k, 0.8, 0.8, 0.28, [0.2, fl + 0.14, 0.9], (p, _n, out) => blend(out, W.rock, W.rockPale, 0.3 + 0.3 * f01(seed, Math.floor(p.x * 7))), 12);
  cyl(k, 0.06, 0.06, 0.45, [0.2, fl + 0.5, 0.9], C.iron, 5);
  k.add(new ConeGeometry(0.55, 0.75, 4), { at: [0.2, fl + 2.4, 0.9], rot: [Math.PI, Math.PI / 4, 0], colour: timberC(W.vlTimber, seed + 9), flat: true });
  // outside the door: sacks (props), and the sluice board beside the wheel
  // the wheel is built in world terms in `millWheel`
}

/** The mill wheel (kin 2): a rim of paddles on spokes, about the axle along local +x of the building that carries it. Built in the building's frame, axle at local (-hx - 0.5, y, 0). */
export function millWheel(k: Kit, lod: Lod, plan: VillagePlan): void {
  const w = plan.wheel;
  const mill = plan.buildings.find((q) => q.kind === "mill")!;
  const yaw = mill.yaw;
  k.setBase(w.x, w.y, w.z, yaw); // local +x = the axle (pointing up the bank, away from the water)
  const R = w.r;
  const KIN = 2;
  const wood: ColourFn = (p, _n, out) => blend(out, W.vlTimber, W.vlTimberLight, 0.2 + 0.4 * f01(31, Math.floor(p.y * 7), Math.floor(p.z * 7)));
  const seg = lod ? 12 : 8;
  // two rims, either side
  for (const sx of [-0.3, 0.3]) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      k.limb([sx, Math.sin(a0) * R, Math.cos(a0) * R], [sx, Math.sin(a1) * R, Math.cos(a1) * R], 0.06, 0.06, wood, 4, false, KIN);
    }
    // spokes
    const spokes = lod ? 8 : 6;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      k.limb([sx, 0, 0], [sx, Math.sin(a) * R, Math.cos(a) * R], 0.05, 0.045, wood, 4, false, KIN);
    }
  }
  // paddles across the rim
  const paddles = lod ? 12 : 8;
  for (let i = 0; i < paddles; i++) {
    const a = (i / paddles) * Math.PI * 2;
    k.add(new BoxGeometry(0.62, 0.34, 0.06), { at: [0, Math.sin(a) * (R + 0.04), Math.cos(a) * (R + 0.04)], rot: [-a + Math.PI / 2, 0, 0], colour: wood, flat: true, sway: KIN });
  }
  // the axle, through the wall
  k.add(new CylinderGeometry(0.1, 0.1, w.axleLen + 0.6, 7), { at: [0.3, 0, 0], rot: [0, 0, Math.PI / 2], colour: C.iron, flat: true, sway: KIN });
  k.add(new CylinderGeometry(0.2, 0.2, 0.7, 8), { at: [0, 0, 0], rot: [0, 0, Math.PI / 2], colour: timberC(W.vlTimber, 9), flat: true, sway: KIN });
  k.clearBase();
  // the sluice: a timber trough leading water to the wheel is implied by the weir upstream; a bracket holds the wheel's bearing
  k.setBase(mill.x, mill.ground, mill.z, yaw);
  bx(k, [0.5, 0.4, 0.5], [-mill.hx - 0.28, w.y - mill.ground - 0.2, 0.52 + 0.0], stoneC(77, 1.0, 0.2));
  bx(k, [0.5, 0.4, 0.5], [-mill.hx - 0.28, w.y - mill.ground - 0.2, -0.52], stoneC(78, 1.0, 0.2));
  k.clearBase();
}

/** The gate: two piers with a semicircular arch between them carrying a tower, a clock on each face, a belfry and a verdigris spire. */
function gateTower(k: Kit, lod: Lod, b: Building, plan: VillagePlan): void {
  const s = b.spec;
  // D-038: the clock gate is a PASSAGE (the arch you walk through): it is drawn open, with no leaf
  if (markSink) {
    const m = k.worldPoint(b.hx, 0, 0);
    markSink.push({ id: "gate.passage", leads: "passage", leaf: false, x: m[0], y: m[1], z: m[2], yaw: k.yaw, width: s.door });
  }
  const seed = 1800;
  const pier = s.door / 2 + 0.7;
  const archTop = 3.7;
  const towerTop = s.wall;
  // piers of squared river-stone
  for (const sg of [-1, 1]) {
    k.add(new BoxGeometry(b.hx * 2, archTop, 1.4, lod ? 4 : 1, lod ? 6 : 1, 2), { at: [0, archTop / 2 - 0.05, sg * pier], colour: stoneC(seed + sg, 0, 0.3), perFace: lod === 1, flat: lod === 0, jitter: lod ? 0.02 : 0, seed: seed + sg });
    bx(k, [b.hx * 2 + 0.2, 0.22, 1.6], [0, 0.11, sg * pier], W.vlStoneDark);
  }
  // the arch: wedges round a half-circle, springing where the piers' straight faces end
  const r = s.door / 2;
  const spring = 2.05;
  const rm = r + 0.25;
  const n = lod ? 11 : 7;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI;
    const w = ((Math.PI * rm) / n) * 1.06;
    bx(k, [b.hx * 2 + 0.06, 0.5, w], [0, spring + Math.sin(a) * rm, -Math.cos(a) * rm], stoneC(seed + i + 10, 3, 0), [a - Math.PI / 2, 0, 0]);
  }
  // (a solid keystone at the crown)
  bx(k, [b.hx * 2 + 0.1, 0.62, 0.34], [0, spring + rm, 0], W.vlStone);
  // the tower: lime-wash over the arch, stone quoins, a band of stone, the clock stage, the belfry
  const bodyY = archTop - 0.1;
  const bodyH = towerTop - 3.0 - bodyY; // (3.0 m are left for the belfry and the spire's foot)
  k.add(new BoxGeometry(b.hx * 2, bodyH, (pier + 0.7) * 2, 1, lod ? 4 : 1, 1), { at: [0, bodyY + bodyH / 2, 0], colour: plaster(W.vlPlaster, seed + 30, bodyY + bodyH / 2), flat: true });
  for (const sx of [-1, 1]) for (const sg of [-1, 1]) for (let i = 0; i < (lod ? 7 : 3); i++) bx(k, [0.4, 0.34, 0.4], [sx * (b.hx - 0.16), bodyY + 0.3 + i * (bodyH / 7), sg * (pier + 0.5)], stoneC(seed + i, 5, 0));
  bx(k, [b.hx * 2 + 0.3, 0.24, (pier + 0.7) * 2 + 0.3], [0, bodyY + bodyH * 0.55, 0], W.vlStone);
  bx(k, [b.hx * 2 + 0.3, 0.24, (pier + 0.7) * 2 + 0.3], [0, bodyY + bodyH, 0], W.vlStone);
  // clock faces on the ±x faces (the dial itself is in the banners mesh); brass surround, hands are the moving parts
  const clockY = GATE_CLOCK_Y;
  for (const sg of [-1, 1]) {
    const tor = new TorusGeometry(0.74, 0.07, 6, 20);
    tor.rotateY(Math.PI / 2);
    k.add(tor, { at: [sg * (b.hx + 0.03), clockY, 0], colour: C.brass, flat: true });
  }
  // hands: hour (short) and minute (long), one pair per face, each with its own kin id
  const hands = (face: 1 | -1, kinHour: number, kinMinute: number): void => {
    const x = face * (b.hx + 0.09);
    k.add(new BoxGeometry(0.04, 0.4, 0.12), { at: [x, clockY + 0.2, 0], colour: W.vlSoot, flat: true, sway: kinHour });
    k.add(new BoxGeometry(0.03, 0.62, 0.08), { at: [x + face * 0.03, clockY + 0.31, 0], colour: W.vlSoot, flat: true, sway: kinMinute });
    k.add(new SphereGeometry(0.06, 6, 4), { at: [x + face * 0.05, clockY, 0], colour: C.brass, flat: true, sway: kinHour });
  };
  hands(1, 4, 5);
  hands(-1, 6, 7);
  // the belfry: an open arcaded stage with a bell, under a verdigris spire
  const bellY = bodyY + bodyH + 0.12;
  const belfryH = 2.4;
  for (const sx of [-1, 1]) for (const sg of [-1, 1]) bx(k, [0.36, belfryH, 0.36], [sx * (b.hx - 0.2), bellY + belfryH / 2, sg * (pier + 0.5)], stoneC(seed + 40, 8, 0));
  for (const sg of [-1, 1]) bx(k, [b.hx * 2, 0.3, 0.36], [0, bellY + belfryH - 0.15, sg * (pier + 0.5)], W.vlStone);
  for (const sx of [-1, 1]) bx(k, [0.36, 0.3, (pier + 0.5) * 2], [sx * (b.hx - 0.2), bellY + belfryH - 0.15, 0], W.vlStone);
  k.add(new CylinderGeometry(0.1, 0.42, 0.7, 10, 1, true), { at: [0, bellY + 1.3, 0], colour: C.brass, flat: true });
  k.limb([0, bellY + belfryH - 0.2, 0], [0, bellY + 1.66, 0], 0.03, 0.03, C.iron, 4);
  hipRoof(k, lod, b.hx + 0.3, pier + 0.9, bellY + belfryH - 0.05, 2.5, 0, "shingle", seed + 50);
  k.limb([0, bellY + belfryH + 2.3, 0], [0, bellY + belfryH + 3.4, 0], 0.035, 0.02, C.iron, 4);
  bx(k, [0.5, 0.18, 0.04], [0.28, bellY + belfryH + 3.2, 0], C.iron); // the vane
  k.add(new SphereGeometry(0.1, 6, 4), { at: [0, bellY + belfryH + 2.35, 0], colour: W.vlHeraldGold, flat: true });
  // the shrine: a niche in the south pier's face with a little painted figure and a shelf of candles
  const nz = -(pier + 0.7);
  bx(k, [0.9, 1.5, 0.3], [0, 1.25, nz + 0.05], W.vlSoot);
  bx(k, [1.2, 0.14, 0.5], [0, 0.45, nz - 0.1], W.vlStone);
  bx(k, [1.2, 0.14, 0.4], [0, 2.1, nz - 0.05], W.vlStone);
  k.add(new SphereGeometry(0.16, 6, 5), { at: [0, 1.2, nz + 0.12], colour: W.vlPlasterRose, flat: true });
  k.add(new ConeGeometry(0.22, 0.6, 6), { at: [0, 0.9, nz + 0.12], colour: W.vlHeraldBlue, flat: true });
  if (lod) for (let i = 0; i < 5; i++) cyl(k, 0.025, 0.028, 0.13, [-0.36 + i * 0.18, 0.59, nz - 0.1], W.vlAwningCream, 5);
  // hooks for the lamps under the arch are in the lamp list
  void plan;
}

/** A market stall: four poles, a striped awning that breathes in the wind, a counter with goods, a sign board on the front. */
function stall(k: Kit, lod: Lod, b: Building, i: number): void {
  const seed = 2100 + i * 13;
  const cols = [[W.vlAwningRed, W.vlAwningCream], [W.vlAwningBlue, W.vlAwningCream], [W.vlAwningOchre, W.vlAwningRed], [W.vlShutter, W.vlAwningCream]][i % 4]!;
  const hx = b.hx;
  const hz = b.hz;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(k, 0.06, 0.07, 2.4, [sx * (hx - 0.12), 1.2, sz * (hz - 0.12)], timberC(W.vlTimber, seed + sx), 6);
  // the awning: a sloping striped sheet, lower at the front (+x), with a scalloped valance; it moves (sway weight rises toward the front edge)
  const sheet = new BoxGeometry(hx * 2 + 0.7, 0.06, hz * 2 + 0.5, 1, 1, 12);
  k.add(sheet, {
    at: [0, 2.42, 0],
    rot: [0, 0, 0.16],
    colour: (p, n, out) => {
      const stripe = Math.floor((p.z + hz + 0.25) / 0.27) & 1;
      out.set(cols[stripe]!);
      if (n.y < -0.5) out.multiplyScalar(0.7);
    },
    flat: true,
    sway: (p) => 0.18 + 0.5 * Math.max(0, p.x / (hx + 0.35) + 0.5),
  });
  if (lod) for (let j = 0; j < 12; j++) {
    const z = -hz - 0.25 + ((hz * 2 + 0.5) * (j + 0.5)) / 12;
    k.add(new ConeGeometry(0.135, 0.22, 3), { at: [hx + 0.3, 2.2, z], rot: [0, 0, Math.PI], colour: cols[j & 1]!, flat: true, sway: 0.65 });
  }
  // the counter (planks on trestles) and goods
  bx(k, [0.64, 0.08, hz * 2 - 0.5], [hx - 0.42, 0.92, 0], timberC(W.vlTimberLight, seed));
  for (const sz of [-1, 1]) bx(k, [0.5, 0.86, 0.08], [hx - 0.42, 0.43, sz * (hz - 0.4)], W.vlTimber);
  bx(k, [0.06, 0.4, hz * 2 - 0.5], [hx - 0.1, 0.72, 0], cols[0]!);
  const goods: number[] = [[W.vlLeafy, W.vlGourd, W.bloomRed, W.vlHay][i % 4]!, W.vlGourd, W.vlLeafy, W.berry];
  const cnt = lod ? 9 : 3;
  for (let j = 0; j < cnt; j++) {
    const z = -hz + 0.5 + ((hz * 2 - 1) * (j + 0.5)) / cnt;
    k.add(new SphereGeometry(0.11 + 0.03 * f01(seed, j), 6, 5), { at: [hx - 0.42 + (f01(seed, j, 2) - 0.5) * 0.3, 1.04, z], colour: goods[j % goods.length]!, flat: true });
  }
  // a basket and a hanging string of onions from the front pole
  if (lod) {
    cyl(k, 0.2, 0.15, 0.22, [hx - 0.5, 0.11, hz - 0.4], W.vlHay, 8);
    for (let j = 0; j < 4; j++) k.add(new SphereGeometry(0.06, 5, 4), { at: [hx - 0.1, 2.0 - j * 0.1, -hz + 0.18], colour: W.vlPlasterRose, flat: true, sway: 0.3 });
  }
  // sign board hung under the awning's edge
  bx(k, [0.05, 0.36, hz * 2 - 0.4], [hx + 0.2, 2.0, 0], W.vlTimber, undefined, 0.15);
}

// ---- props ---------------------------------------------------------------------------------------------------------------------------------

function barrel(k: Kit, x: number, y: number, z: number, s: number, seed: number, lod: Lod): void {
  const g = new CylinderGeometry(0.29 * s, 0.29 * s, 0.9 * s, lod ? 9 : 6, 2);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const v = p.getY(i) / (0.45 * s);
    const bulge = 1 + 0.12 * (1 - v * v);
    p.setX(i, p.getX(i) * bulge);
    p.setZ(i, p.getZ(i) * bulge);
  }
  k.add(g, { at: [x, y + 0.45 * s, z], colour: (q, n, out) => blend(out, PALETTE.props.barrel, PALETTE.props.barrelDark, (Math.floor(Math.atan2(q.z, q.x) * 5) & 1) * 0.3 + 0.1), flat: true });
  if (lod) for (const h of [-0.28, 0.28]) k.add(new TorusGeometry(0.3 * s, 0.018, 3, 9), { at: [x, y + 0.45 * s + h * s, z], rot: [Math.PI / 2, 0, 0], colour: C.iron, flat: true });
  void seed;
}

function propMesh(k: Kit, lod: Lod, p: VProp, y: number): void {
  // (the ink hull only needs the big simple forms: small clutter has no hull)
  if (!lod && (p.kind === "woodpile" || p.kind === "skep" || p.kind === "sack" || p.kind === "rack" || p.kind === "trough" || p.kind === "scarecrow")) return;
  const s = p.s;
  k.setBase(p.x, y, p.z, p.yaw);
  const seed = p.v;
  switch (p.kind) {
    case "barrel":
      barrel(k, 0, 0, 0, s, seed, lod);
      break;
    case "crate":
      if (lod) {
        k.setBase(p.x, y + 0.3 * s, p.z, p.yaw);
        crateSlim(k, 0.68 * s, 0.6 * s, 0.68 * s);
      } else bx(k, [0.68 * s, 0.6 * s, 0.68 * s], [0, 0.3 * s, 0], PALETTE.props.crate);
      break;
    case "sack":
      k.add(new SphereGeometry(0.34, 7, 5), { at: [0, 0.22, 0], scale: [0.9, 0.7, 0.8], colour: (q, _n, out) => blend(out, C.sack, M.linen, 0.1 + 0.3 * f01(seed, Math.floor(q.y * 8))), flat: true, jitter: 0.02, seed });
      bx(k, [0.16, 0.06, 0.16], [0, 0.44, 0], C.strap);
      break;
    case "bale":
      k.add(new CylinderGeometry(0.56 * s, 0.56 * s, 0.85 * s, lod ? 12 : 8), { at: [0, 0.425 * s, 0], colour: (q, _n, out) => blend(out, W.vlHay, W.vlThatchDark, 0.15 + 0.4 * f01(seed, Math.floor(q.x * 9), Math.floor(q.z * 9))), flat: true, jitter: 0.02, seed });
      for (const yy of [0.2, 0.65]) k.add(new TorusGeometry(0.565 * s, 0.014, 3, 14), { at: [0, yy * s, 0], rot: [Math.PI / 2, 0, 0], colour: C.rope, flat: true });
      break;
    case "well": {
      // a village well: a wide ring of river-stone, two posts, a tiled hood, a rope and a bucket
      for (let c = 0; c < 2; c++) {
        const n = 14;
        for (let i = 0; i < n; i++) {
          const a = ((i + c * 0.5) / n) * Math.PI * 2;
          bx(k, [0.5, 0.42, 0.22], [Math.cos(a) * 0.82, 0.21 + c * 0.42, Math.sin(a) * 0.82], stoneC(seed + i + c * 20, 0, 0.2), [0, -a + Math.PI / 2, 0]);
        }
      }
      cyl(k, 0.7, 0.7, 0.03, [0, 0.1, 0], W.wellWater, 10);
      for (const sg of [-1, 1]) cyl(k, 0.07, 0.08, 2.1, [0, 1.05, sg * 0.86], timberC(W.vlTimber, seed), 6);
      bx(k, [0.12, 0.12, 1.85], [0, 2.05, 0], timberC(W.vlTimber, seed + 1));
      hipRoofSimple(k, lod, 1.0, 0.9, 2.1, 0.75, W.vlTile, W.vlTileDark, seed);
      k.limb([0, 2.0, 0.1], [0, 1.0, 0.1], 0.012, 0.012, C.rope, 3);
      barrel(k, 0, 0.75, 0.1, 0.4, seed, 0);
      break;
    }
    case "cart": {
      // a farm cart: a plank bed on two big wheels, shafts, a heap of hay
      bx(k, [2.3, 0.14, 1.4], [0, 0.72, 0], timberC(W.vlTimberLight, seed));
      for (const sz of [-1, 1]) bx(k, [2.3, 0.4, 0.06], [0, 0.99, sz * 0.7], timberC(W.vlTimber, seed + 1));
      bx(k, [0.06, 0.4, 1.4], [-1.15, 0.99, 0], timberC(W.vlTimber, seed + 2));
      for (const sz of [-1, 1]) {
        const tor = new TorusGeometry(0.62, 0.06, 4, lod ? 16 : 9);
        tor.rotateX(0);
        k.add(tor, { at: [0.1, 0.62, sz * 0.86], colour: timberC(W.vlTimber, seed + 3), flat: true });
        if (lod) for (let i = 0; i < 4; i++) k.limb([0.1, 0.62, sz * 0.86], [0.1 + Math.cos(i * 0.785) * 0.6, 0.62 + Math.sin(i * 0.785) * 0.6, sz * 0.86], 0.035, 0.035, W.vlTimber, 4);
      }
      k.limb([0.1, 0.62, -0.86], [0.1, 0.62, 0.86], 0.05, 0.05, W.vlTimber, 5);
      for (const sz of [-1, 1]) k.limb([1.1, 0.75, sz * 0.5], [2.5, 0.48, sz * 0.4], 0.05, 0.04, W.vlTimber, 4);
      k.add(new SphereGeometry(0.7, 7, 5), { at: [-0.2, 1.05, 0], scale: [1.3, 0.55, 0.95], colour: W.vlHay, flat: true, jitter: 0.06, seed });
      break;
    }
    case "rack": {
      // a drying rack: two posts, three poles, fish or net hung on them
      for (const sg of [-1, 1]) k.limb([0, -0.1, sg * 1.2 * s], [0, 2.05, sg * 1.2 * s], 0.06, 0.05, timberC(W.vlTimber, seed), 5);
      for (const yy of [1.95, 1.4]) bx(k, [0.06, 0.06, 2.55 * s], [0, yy, 0], timberC(W.vlTimberLight, seed + 1));
      if (lod) for (let i = 0; i < 9; i++) {
        const z = -1.05 * s + (2.1 * s * i) / 8;
        const fish = new ConeGeometry(0.06, 0.4, 4);
        k.add(fish, { at: [0.03, 1.72, z], rot: [0, 0, Math.PI], colour: (i & 1 ? W.waterGlint : W.waterDeep), flat: true, sway: 0.25 });
      } else bx(k, [0.03, 0.4, 2.0], [0.03, 1.7, 0], W.waterDeep);
      bx(k, [0.03, 0.75, 1.2 * s], [-0.03, 1.0, 0.6 * s], M.rope, undefined, 0.35); // a net
      break;
    }
    case "bench":
      bx(k, [0.42, 0.06, 1.4 * s], [0, 0.44, 0], timberC(W.vlTimberLight, seed));
      for (const sg of [-1, 1]) bx(k, [0.36, 0.42, 0.06], [0, 0.21, sg * 0.56 * s], W.vlTimber);
      break;
    case "post": {
      // a lamp post: a tapering post with a curved arm and a hook
      k.limb([0, -0.2, 0], [0, 2.6 * s, 0], 0.09, 0.06, timberC(W.vlTimber, seed), 6);
      k.limb([0, 2.55 * s, 0], [0.34, 2.75 * s, 0], 0.03, 0.025, C.iron, 4);
      k.add(new SphereGeometry(0.09, 5, 4), { at: [0, 2.62 * s, 0], colour: W.vlHeraldGold, flat: true });
      if (Math.abs(p.yaw) > 0.001 && p.s < 1) {
        // (a post that carries a washing line has crossbars)
        bx(k, [0.5, 0.05, 0.05], [0, 2.3, 0], W.vlTimber);
      }
      break;
    }
    case "woodpile": {
      // split logs, ends toward the viewer; the pile leans against a wall
      const rows = 4;
      for (let r2 = 0; r2 < rows; r2++) {
        const n2 = 6 - r2;
        for (let i = 0; i < n2; i++) {
          const x = (-0.75 * s + (1.5 * s * (i + 0.5)) / 6) + r2 * 0.13;
          const cut = new CylinderGeometry(0.11, 0.11, 0.75, 5);
          cut.rotateX(Math.PI / 2);
          k.add(cut, { at: [x, 0.11 + r2 * 0.2, 0], colour: (q, n, out) => (Math.abs(n.z) > 0.9 ? blend(out, W.logCut, W.ringDark, 0.3 + 0.5 * f01(seed, i, r2)) : blend(out, W.trunk, W.barkLight, f01(seed + 1, i, r2) * 0.6)), flat: true });
        }
      }
      break;
    }
    case "skep": {
      // a straw beehive: coiled rings tapering to a knob, on a stone
      bx(k, [0.55, 0.14, 0.55], [0, 0.07, 0], W.vlStone);
      for (let i = 0; i < 4; i++) k.add(new TorusGeometry(0.22 - i * 0.04, 0.06, 3, 8), { at: [0, 0.22 + i * 0.1, 0], rot: [Math.PI / 2, 0, 0], colour: (i & 1 ? W.vlHay : W.vlThatch), flat: true });
      k.add(new SphereGeometry(0.06, 5, 4), { at: [0, 0.63, 0], colour: W.vlThatchDark, flat: true });
      break;
    }
    case "scarecrow":
      k.limb([0, 0, 0], [0, 1.8, 0], 0.04, 0.035, W.vlTimber, 4);
      bx(k, [1.2, 0.05, 0.05], [0, 1.45, 0], W.vlTimber);
      bx(k, [0.4, 0.6, 0.2], [0, 1.25, 0], W.vlAwningRed);
      k.add(new SphereGeometry(0.15, 6, 5), { at: [0, 1.75, 0], colour: W.vlHay, flat: true });
      k.add(new CylinderGeometry(0.22, 0.22, 0.03, 8), { at: [0, 1.88, 0], colour: W.vlTimber, flat: true });
      k.add(new CylinderGeometry(0.11, 0.13, 0.16, 8), { at: [0, 1.96, 0], colour: W.vlTimber, flat: true });
      break;
    case "trough":
      bx(k, [1.6, 0.4, 0.55], [0, 0.2, 0], timberC(W.vlTimber, seed));
      bx(k, [1.44, 0.04, 0.4], [0, 0.4, 0], W.wellWater);
      break;
    case "anvil":
    case "millstone":
    case "stone":
      break;
  }
  k.clearBase();
}

/** A little four-sided hood (a roof over a well, a shrine): pyramid of scaled courses. */
function hipRoofSimple(k: Kit, lod: Lod, hx: number, hz: number, y: number, rise: number, a: number, b: number, seed: number): void {
  const g = new CylinderGeometry(0.06, Math.SQRT2, rise, 4, lod ? 3 : 1);
  g.rotateY(Math.PI / 4);
  g.scale(hx, 1, hz);
  k.add(g, {
    at: [0, y + rise / 2, 0],
    colour: (p, n, out) => {
      if (n.y < -0.9) return void out.copy(INTERIOR);
      const row = Math.floor((p.y + rise / 2) / 0.24);
      const col = Math.floor((Math.atan2(p.z, p.x) + Math.PI) * 4 + (row & 1) * 0.5);
      blend(out, f01(seed, row, col) < 0.5 ? a : b, W.copper, 0.06);
    },
    perFace: lod === 1,
    flat: lod === 0,
    seed,
  });
}

// ---- lamps, fences, gardens, washing ----------------------------------------------------------------------------------------------------------

const LAMP_SWING = 0.5;

function lamp(k: Kit, world: CollisionWorld, l: Lantern, lod: Lod): void {
  if (l.kind !== 0 || !lod) return; // a forge's coals and a shrine's candles are their own light
  const g = world.terrainHeight(l.x, l.z);
  const y = g + l.y;
  const armY = y + 0.5;
  if (l.mount === 0) {
    // a bracket from the wall to the lamp, braced underneath
    k.limb([l.x + l.ax * 0.34, armY - 0.05, l.z + l.az * 0.34], [l.x, armY, l.z], 0.018, 0.014, C.iron, 4);
    k.limb([l.x + l.ax * 0.34, armY - 0.42, l.z + l.az * 0.34], [l.x + l.ax * 0.3, armY, l.z + l.az * 0.3], 0.016, 0.012, C.iron, 4);
  } else if (l.mount === 1) k.limb([l.x - 0.34, armY - 0.05, l.z], [l.x, armY, l.z], 0.014, 0.012, C.iron, 4);
  else k.limb([l.x, armY, l.z], [l.x, armY + 0.3, l.z], 0.008, 0.008, C.iron, 3);
  k.limb([l.x, armY, l.z], [l.x, y + 0.24, l.z], 0.005, 0.005, C.iron, 3, false, (t) => t * LAMP_SWING);
  k.add(new ConeGeometry(0.11, 0.1, 6), { at: [l.x, y + 0.2, l.z], colour: C.brass, flat: true, sway: LAMP_SWING });
  k.add(new CylinderGeometry(0.085, 0.09, 0.03, 6), { at: [l.x, y - 0.155, l.z], colour: C.brass, flat: true, sway: LAMP_SWING });
  if (lod) for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.limb([l.x + Math.cos(a) * 0.09, y - 0.14, l.z + Math.sin(a) * 0.09], [l.x + Math.cos(a) * 0.085, y + 0.16, l.z + Math.sin(a) * 0.085], 0.006, 0.006, C.brass, 3, false, LAMP_SWING);
  }
}

/** Post-and-rail fences and their posts (matching the collision boxes). */
function fences(k: Kit, world: CollisionWorld, plan: VillagePlan, lod: Lod): void {
  const placed = new Set<string>();
  const post = (x: number, z: number, y: number, seed: number): void => {
    const key = `${Math.round(x * 8)},${Math.round(z * 8)}`;
    if (placed.has(key)) return;
    placed.add(key);
    const h = 0.95 + f01(600, seed) * 0.12;
    k.limb([x, y - 0.35, z], [x, y + h, z], 0.06, 0.05, timberC(W.vlTimber, seed), lod ? 5 : 4);
    if (lod) k.add(new ConeGeometry(0.075, 0.08, 5), { at: [x, y + h + 0.03, z], colour: timberC(W.vlTimber, seed + 1), flat: true });
  };
  plan.fences.forEach((f, i) => {
    const y = world.terrainHeight(f.x, f.z);
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    post(f.x - c * f.hx, f.z - s * f.hx, world.terrainHeight(f.x - c * f.hx, f.z - s * f.hx), i * 2);
    post(f.x + c * f.hx, f.z + s * f.hx, world.terrainHeight(f.x + c * f.hx, f.z + s * f.hx), i * 2 + 1);
    k.setBase(f.x, y, f.z, f.yaw);
    for (const [yy, t] of [[0.34, 0.01], [0.68, -0.012]] as const) bx(k, [f.hx * 2 + 0.05, 0.06, 0.045], [0, yy, 0], timberC(W.vlTimberLight, i), [0, 0, t * (f01(602, i) - 0.5) * 8]);
    k.clearBase();
  });
}

const CROP_COL: [number, number][] = [[W.vlLeafy, W.vlGourd], [W.vine, W.vineLight], [W.vlGourd, W.vlLeafy], [W.bloomRed, W.bloomYellow], [W.fern, W.reed]];

function gardens(k: Kit, world: CollisionWorld, plan: VillagePlan, lod: Lod): void {
  plan.gardens.forEach((g, gi) => {
    const y = world.terrainHeight(g.x, g.z);
    k.setBase(g.x, y, g.z, g.yaw);
    const [c0, c1] = CROP_COL[g.crop % 5]!;
    // raised beds in rows with a path between
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const z = -g.hz + 0.55 + ((g.hz * 2 - 1.1) * (r + 0.5)) / rows;
      const bedH = g.hx * 2 - 0.8;
      bx(k, [bedH, 0.12, (g.hz * 2 - 1.1) / rows - 0.35], [0, 0.05, z], (_p, _n, out) => out.set(W.vlSoil).multiplyScalar(0.9 + 0.2 * f01(gi, r)));
      const n = lod ? 6 : 0;
      for (let i = 0; i < n; i++) {
        const x = -bedH / 2 + 0.3 + ((bedH - 0.6) * (i + 0.5)) / n;
        const col = (i + r) % 3 === 0 ? c1 : c0;
        if (g.crop === 1) {
          // bean poles: a tepee of canes with a green cloud
          if (i % 2 === 0) {
            k.limb([x - 0.14, 0, z], [x, 1.4, z], 0.015, 0.012, W.vlTimber, 3);
            k.limb([x + 0.14, 0, z], [x, 1.4, z], 0.015, 0.012, W.vlTimber, 3);
            k.add(new SphereGeometry(0.2, 5, 4), { at: [x, 0.8, z], scale: [0.8, 1.6, 0.8], colour: col, flat: true, jitter: 0.03, seed: i + r });
          }
        } else if (g.crop === 3) {
          for (let j = 0; j < 3; j++) k.add(new SphereGeometry(0.06, 5, 4), { at: [x + (j - 1) * 0.1, 0.34 + f01(gi, i, j) * 0.1, z + (f01(gi, r, i + j) - 0.5) * 0.3], colour: [W.bloomRed, W.bloomYellow, W.bloomWhite, W.bloomViolet][(i + j + r) % 4]!, flat: true });
          k.add(new SphereGeometry(0.17, 5, 4), { at: [x, 0.2, z], scale: [1, 0.6, 1], colour: W.fern, flat: true });
        } else {
          k.add(new SphereGeometry(g.crop === 0 ? 0.19 : 0.15, 6, 4), { at: [x, 0.22, z], scale: [1, g.crop === 2 ? 0.8 : 0.85, 1], colour: col, flat: true, jitter: 0.02, seed: i * 3 + r });
        }
      }
    }
    k.clearBase();
  });
}

/** Washing lines with laundry (sway), between the posts the plan placed. */
function washing(k: Kit, world: CollisionWorld, plan: VillagePlan, lod: Lod): void {
  if (!lod) return;
  plan.lines.forEach((l, li) => {
    const ya = world.terrainHeight(l.a.x, l.a.z) + l.h;
    const yb = world.terrainHeight(l.b.x, l.b.z) + l.h;
    const sag = 0.3;
    const pt = (t: number): V3 => [l.a.x + (l.b.x - l.a.x) * t, ya + (yb - ya) * t - sag * 4 * t * (1 - t), l.a.z + (l.b.z - l.a.z) * t];
    const segs = lod ? 8 : 4;
    for (let i = 0; i < segs; i++) k.limb(pt(i / segs), pt((i + 1) / segs), 0.008, 0.008, C.rope, 3);
    const yaw = Math.atan2(l.b.z - l.a.z, l.b.x - l.a.x);
    const cols = [M.linen, PALETTE.cloth[1]!, PALETTE.cloth[11]!, W.vlAwningCream, PALETTE.cloth[4]!, M.cream];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.7) / (n + 0.3);
      const p = pt(t);
      const w = 0.32 + 0.3 * f01(l.v, i);
      const h = 0.4 + 0.4 * f01(l.v, i, 2);
      k.setBase(p[0], p[1], p[2], yaw);
      const col = cols[(l.v + i) % cols.length]!;
      bx(k, [w, h, 0.02], [0, -h / 2 - 0.01, 0], (q, _n, out) => blend(out, col, M.soot, 0.05 + Math.abs(q.y) * 0.06), [(f01(l.v, i, 3) - 0.5) * 0.2, 0, 0], 0);
      k.clearBase();
    }
    void li;
  });
}

// ---- the water's edge: jetty, punt, weir, stepping stones -------------------------------------------------------------------------------------

/** A plank pier on posts, a punt moored beside it (kin 3: it bobs), the low timber weir with its walkway, and stepping stones below the mill. */
function waterside(k: Kit, world: CollisionWorld, plan: VillagePlan, lod: Lod): void {
  const j = plan.jetty;
  const seed = 3100;
  // -- the jetty: local +x runs out over the pond; y = 0 is the deck top
  k.setBase(j.x0, j.deckY, j.z0, j.yaw);
  const L = j.length;
  const planks = Math.round(L / 0.28);
  k.add(new BoxGeometry(L, 0.09, j.width, planks, 1, 1), {
    at: [L / 2, -0.045, 0],
    colour: (p, n, out) => {
      if (n.y < 0.5) {
        out.set(W.vlTimber);
        return;
      }
      blend(out, W.plank, W.plankDark, 0.1 + 0.6 * f01(seed, Math.floor((p.x + L / 2) / (L / planks))));
    },
    perFace: lod === 1,
    flat: lod === 0,
    jitter: lod ? 0.006 : 0,
    seed,
  });
  for (const sg of [-1, 1]) bx(k, [L, 0.2, 0.12], [L / 2, -0.2, sg * (j.width / 2 - 0.12)], timberC(W.vlTimber, seed + 1));
  const posts = Math.max(3, Math.round(L / 1.5));
  for (let i = 0; i <= posts; i++) {
    const x = (L * i) / posts;
    for (const sg of [-1, 1]) cyl(k, 0.09, 0.11, 2.0 + (i === posts ? 0.3 : 0), [x, -0.95 + (i === posts ? 0.12 : 0.0) , sg * (j.width / 2 - 0.08)], (p, _n, out) => blend(out, W.vlTimber, W.moss, Math.max(0, 0.5 - (p.y + 1.0) * 0.6) * 0.5), 6);
  }
  // cleats, a coil of rope, an upturned bucket, and a short ladder over the end into the water
  bx(k, [0.24, 0.07, 0.07], [L * 0.62, 0.1, j.width / 2 - 0.14], W.vlTimber);
  bx(k, [0.24, 0.07, 0.07], [L * 0.62, 0.1, -j.width / 2 + 0.14], W.vlTimber);
  if (lod) {
    k.add(new TorusGeometry(0.15, 0.04, 4, 10), { at: [L * 0.35, 0.05, j.width / 2 - 0.3], rot: [Math.PI / 2, 0, 0], colour: C.rope, flat: true });
    for (const sg of [-1, 1]) k.limb([L + 0.02, 0.0, sg * 0.28], [L + 0.02, -1.0, sg * 0.28], 0.025, 0.025, W.vlTimber, 4);
    for (let i = 0; i < 4; i++) bx(k, [0.04, 0.04, 0.56], [L + 0.02, -0.2 - i * 0.22, 0], W.vlTimber);
  }
  // a stone footing where the pier meets the bank
  bx(k, [0.8, 0.5, j.width + 0.3], [-0.2, -0.3, 0], stoneC(seed + 2, 0, 0.3));
  k.clearBase();
  // -- the punt: flat-bottomed, raked ends, a pole lying across its thwarts. Everything in it carries kin 3.
  const p = plan.punt;
  k.setBase(p.x, p.waterY - 0.12, p.z, p.yaw);
  const K = 3;
  const hullC: ColourFn = (q, n, out) => {
    if (n.y > 0.6 && q.y > 0.05) out.copy(INTERIOR).lerp(new Color(W.vlTimber), 0.55);
    else blend(out, W.vlAwningBlue, W.vlTimber, 0.25 + 0.35 * f01(seed + 3, Math.floor(q.x * 5)));
  };
  bx(k, [3.0, 0.06, 0.74], [0, 0.05, 0], timberC(W.vlTimber, seed + 4), undefined, K);
  for (const sg of [-1, 1]) {
    k.add(new BoxGeometry(3.3, 0.36, 0.05), { at: [0, 0.23, sg * 0.42], rot: [-sg * 0.22, 0, 0], colour: hullC, flat: true, sway: K });
    // rake the ends: a raised prow and stern
    k.add(new BoxGeometry(0.5, 0.3, 0.05), { at: [1.62, 0.32, sg * 0.36], rot: [-sg * 0.2, 0, 0.5], colour: hullC, flat: true, sway: K });
    k.add(new BoxGeometry(0.5, 0.3, 0.05), { at: [-1.62, 0.32, sg * 0.36], rot: [-sg * 0.2, 0, -0.5], colour: hullC, flat: true, sway: K });
  }
  bx(k, [0.06, 0.34, 0.7], [1.86, 0.28, 0], timberC(W.vlTimber, seed + 5), [0, 0, 0.55], K);
  bx(k, [0.06, 0.34, 0.7], [-1.86, 0.28, 0], timberC(W.vlTimber, seed + 5), [0, 0, -0.55], K);
  for (const x of [-0.9, 0.2]) bx(k, [0.24, 0.05, 0.86], [x, 0.3, 0], timberC(W.vlTimberLight, seed + 6), undefined, K);
  k.limb([-1.2, 0.36, 0.2], [1.6, 0.4, -0.3], 0.028, 0.024, W.vlTimberLight, 4, false, K);
  // a rolled blanket, a basket, a fishing rod
  k.add(new CylinderGeometry(0.11, 0.11, 0.6, 7), { at: [0.9, 0.38, 0.05], rot: [Math.PI / 2, 0, 0.3], colour: W.vlAwningRed, flat: true, sway: K });
  cyl(k, 0.17, 0.13, 0.2, [-0.5, 0.42, -0.1], W.vlHay, 8, undefined, K);
  k.clearBase();
  // -- the weir: a log crest on piles across the stream, a sloped apron of boards downstream, a plank walkway over the crest. Local +x runs across the stream, +z upstream.
  const w = plan.weir;
  k.setBase(w.x, w.crestY, w.z, w.yaw);
  const H = w.half;
  cyl(k, 0.17, 0.17, H * 2, [0, 0.03, 0], (q, _n, out) => blend(out, W.vlTimber, W.vlTimberLight, 0.3 + 0.3 * f01(seed + 7, Math.floor(q.y * 3))), 7, [0, 0, Math.PI / 2]);
  const piles = Math.round(H * 2 / 0.7);
  for (let i = 0; i <= piles; i++) {
    const x = -H + (H * 2 * i) / piles;
    cyl(k, 0.07, 0.08, 1.1, [x, -0.3, 0.32], timberC(W.vlTimber, seed + 8 + i), 5);
    if (lod) cyl(k, 0.06, 0.07, 0.9, [x + 0.15, -0.5, -0.5], timberC(W.vlTimber, seed + 30 + i), 5);
  }
  // the apron: boards tilted down the chute
  k.add(new BoxGeometry(H * 2, 0.06, 1.3), { at: [0, -0.16, -0.72], rot: [0.22, 0, 0], colour: timberC(W.vlTimber, seed + 9), flat: true });
  // the walkway and its rail
  const wy = w.walkY - w.crestY;
  k.add(new BoxGeometry(H * 2 + 0.6, 0.08, 0.84, lod ? 12 : 1, 1, 1), { at: [0, wy - 0.04, 0], colour: (q, n, out) => (n.y > 0.5 ? blend(out, W.plank, W.plankDark, 0.1 + 0.6 * f01(seed + 10, Math.floor((q.x + H) * 3.2))) : out.set(W.vlTimber)), perFace: lod === 1, flat: lod === 0, seed: seed + 10 });
  for (const sx of [-1, 1]) {
    bx(k, [1.0, 0.7, 1.1], [sx * (H + 0.7), wy - 0.35, 0], stoneC(seed + 11 + sx, 0, 0.3)); // abutments
    cyl(k, 0.05, 0.06, 0.8, [sx * (H + 0.25), wy + 0.4, 0.4], timberC(W.vlTimber, seed + 12), 5);
    cyl(k, 0.05, 0.06, 0.8, [sx * (H + 0.25), wy + 0.4, -0.4], timberC(W.vlTimber, seed + 13), 5);
    bx(k, [0.06, 0.06, 0.9], [sx * (H + 0.25), wy + 0.75, 0], W.vlTimber);
  }
  k.clearBase();
  // -- stepping stones across the stream below the mill
  const lt = world.terrain as Partial<LandscapeTerrain>;
  if (typeof lt.channelLevel === "function") {
    const top = lt.channelLevel(MILL.s + 5.2) - RIVER.freeboard + 0.1;
    for (const st of plan.stones) {
      k.add(new CylinderGeometry(st.r, st.r * 1.08, 0.5, 7), { at: [st.x, top - 0.25, st.z], rot: [0, st.yaw, 0], colour: (q, n, out) => (n.y > 0.5 ? blend(out, W.rockPale, W.pebble, 0.2 + 0.5 * f01(seed, Math.floor(q.x * 9))) : blend(out, W.rockDark, W.boulder, 0.4)), flat: true });
    }
  }
}

// ---- assembly ---------------------------------------------------------------------------------------------------------------------------------

/** Where a sway-carrying hanging sign or awning belongs is handled by the pieces themselves; this puts everything together. Undefined off the arena. */
export function buildVillage(world: CollisionWorld, lod: Lod, stats?: Record<string, number>, panes?: WindowPane[], roofsOut?: { roofs?: RoofSource; marks?: DoorMark[] }): BufferGeometry | undefined {
  if (world.obstacles.length === 0) return undefined;
  paneSink = panes;
  const marks: DoorMark[] = [];
  markSink = marks;
  const plan = villagePlan(world.terrain);
  const k = new Kit({ sway: true });
  const roofKits = new RoofKits();
  let last = 0;
  const mark = (name: string): void => {
    if (!stats) return;
    const t = k.triangles;
    stats[name] = (stats[name] ?? 0) + (t - last);
    last = t;
  };
  for (const b of plan.buildings) {
    k.setBase(b.x, b.ground, b.z, b.yaw);
    const st = styleOf(b);
    markFor = b.id;
    // D-038: the roofs of the rooms (cottages, stilt houses, the mill, the hall) are their own pieces, lifted while the viewer is inside
    const roomy = roofsOut !== undefined && (b.kind === "cottage" || b.kind === "stilt" || b.kind === "mill" || b.kind === "hall");
    const kr = roomy ? roofKits.begin(b.id, { sway: true }) : k;
    if (roomy) kr.setBase(b.x, b.ground, b.z, b.yaw);
    switch (b.kind) {
      case "cottage":
        cottage(k, kr, lod, b, st);
        break;
      case "stilt":
        stilt(k, kr, lod, b, st);
        break;
      case "granary":
        granary(k, lod, b, st);
        break;
      case "hall":
        hall(k, kr, lod, b, st);
        break;
      case "workshop":
        workshop(k, lod, b, st);
        break;
      case "mill":
        mill(k, kr, lod, b, st);
        break;
      case "clock":
        gateTower(k, lod, b, plan);
        break;
      case "stall":
        stall(k, lod, b, Number(b.id.slice(-1)) - 1);
        break;
    }
    k.clearBase();
    mark(b.kind);
  }
  millWheel(k, lod, plan);
  mark("wheel");
  waterside(k, world, plan, lod);
  mark("waterside");
  for (const p of plan.props) {
    propMesh(k, lod, p, world.terrainHeight(p.x, p.z));
    mark(`prop-${p.kind}`);
  }
  k.clearBase();
  fences(k, world, plan, lod);
  mark("fences");
  gardens(k, world, plan, lod);
  mark("gardens");
  washing(k, world, plan, lod);
  mark("washing");
  for (const l of plan.lanterns) lamp(k, world, l, lod);
  mark("lamps");
  paneSink = undefined;
  markSink = undefined;
  if (roofsOut) {
    roofsOut.roofs = roofKits.finish();
    roofsOut.marks = marks;
  }
  return k.build();
}

export { LAMP_SWING };
