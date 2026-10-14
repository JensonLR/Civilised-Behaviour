import type { Obstacle } from "./collision.ts";
import { fieldThings, type FieldPlot } from "./fields.ts";
import { smoothstep } from "./math.ts";
import type { Terrain } from "./terrain.ts";

/**
 * LAMPSIDE (D-119): the Ward's lower town under Kessar's fort. The owner found the world "very sparse", and the walk from the toll bar to the fort's gate was 40 m of bare sand
 * with a sealed gate at the end: a hill-fort of the Ward of the Nine Lamps with nobody living at its foot. Now the fort road is a street. Five houses face it (ochre
 * sandstone and lime-wash, flat roofs with a parapet or a red-tile hip, each door shut with the Ward's paper seal and a notice in the Kessarine voice), a square on its east
 * side holds the town's well and two stalls, and behind the houses lie walled gardens: young barley and ripe barley under date palms to the west, a date grove to the east.
 * Nine lamps: one by every door, one on each stall, and a post either side of the street where the town begins.
 *
 * ONE pure description, read by the terrain (the town's ground is levelled: `lampsidePad`), the colliders (`lampsideObstacles`, appended after the seeded dressing so nothing
 * else in Kessar moves; the dressing that stood in the town is simply not there), the level plan (the houses are `sealed` buildings), the paint, the scatter (the gardens are
 * field plots on the D-116 rules), the fire (the barley burns) and the client's geometry. Metres; x east, z south (the fort is north, at z = -60); yaw is the collision
 * convention (local +x = (cos yaw, sin yaw)) and a house's local +x is the face its door is in.
 */

export interface LampsideHouse {
  id: string;
  x: number;
  z: number;
  /** Collision yaw of the door's face (0: the door looks east; PI: west). */
  yaw: number;
  /** Half depth (local x, front to back) and half width (local z, along the street). */
  hx: number;
  hz: number;
  /** The walls' top above the ground (a flat roof's parapet included). */
  height: number;
  storeys: 1 | 2;
  roof: "flat" | "tile";
  /** Lime-washed over the stone (true) or the bare coursed sandstone. */
  lime: boolean;
  /** A striped awning over the door. */
  awning: boolean;
  /** The notice on the sealed door (one of `LAMPSIDE_SIGNS`). */
  sign: string;
}

export interface LampsideStall {
  id: string;
  x: number;
  z: number;
  /** Collision yaw of its counter's face (the side the customer stands on). */
  yaw: number;
  hx: number;
  hz: number;
  /** The awning's front edge above the ground. */
  height: number;
}

/** A run of garden wall: a box `hx` long either side of its middle along `yaw`, `LAMPSIDE.wall.half` thick. `piers`: the ends (-1 its start, 1 its end) that stand at a gate. */
export interface LampsideWall {
  x: number;
  z: number;
  yaw: number;
  hx: number;
  piers: (-1 | 1)[];
}

export interface LampsidePlan {
  houses: LampsideHouse[];
  stalls: LampsideStall[];
  well: { x: number; z: number; r: number; height: number };
  /** The two lamp posts where the street begins (one each side). */
  posts: { x: number; z: number }[];
  walls: LampsideWall[];
  /** The gaps the garden walls leave for gates (centre and clear width), for the tests and the paint's paths. */
  gates: { x: number; z: number; width: number }[];
  palms: { x: number; z: number; s: number; yaw: number }[];
}

/** The doors' notices: the town is shut to the Society, politely and in writing. (Lettered on the cloth atlas: at most 36 characters each.) */
export const LAMPSIDE_SIGNS = [
  "GONE TO TRIM THE LAMPS. BACK AT DUSK",
  "NO CALLERS WITHOUT A WARDEN'S CHIT",
  "SOCIETY FORMS ACCEPTED AS KINDLING",
  "ASSESSED, STAMPED AND STILL NOT IN",
  "THE OCCUPANT IS UNSURPRISED",
] as const;

export const LAMPSIDE = {
  /** The town's ground, levelled to the bank's level (`KESSAR.level`): this rectangle, easing into the swell round it over `blend`. */
  pad: { x0: -41.5, x1: 36.5, z0: -29.5, z1: -3, blend: 8 },
  /** The street and the square: packed earth, no scrub (the paint and the cover read it). */
  street: { x0: -5.6, x1: 16, z0: -28, z1: -3 },
  /** Garden walls: mud brick on a stone footing, `height` above the ground; a gate's piers stand `pier` high; runs are cut every `run` metres so each sits on its own ground. */
  wall: { half: 0.24, height: 1.15, pier: 1.45, pierHalf: 0.32, run: 4 },
  /** The doors: a person's door, sealed. */
  door: { width: 1.4, height: 2.25 },
  /** The red-tile hip's rise above the eaves. */
  roofRise: 2.3,
  /** Date palms: the trunk's collision radius and height at scale 1 (as the shore's palms, kessarPlan). */
  palm: { r: 0.3, height: 7.5 },
} as const;

/** The gardens behind the houses: their walls (rectangles) and the gates through them. */
const GARDENS = [
  { id: "west", x0: -40, x1: -16.5, z0: -27, z1: -6, gates: [{ side: "s", at: -28, width: 2.4 }, { side: "e", at: -11.7, width: 2.2 }, { side: "e", at: -20.6, width: 2.2 }] },
  { id: "east", x0: 17.5, x1: 35, z0: -25, z1: -6, gates: [{ side: "w", at: -10.9, width: 2.2 }, { side: "s", at: 23.8, width: 2.4 }] },
] as const;

/** What grows in the gardens (D-116's plots: the paint, the drills and the barley, the fire). */
export const LAMPSIDE_GARDENS: readonly FieldPlot[] = [
  { id: "lampside.green", x0: -38.6, x1: -29.6, z0: -25.6, z1: -7.4, row: 0.8, crop: "green" },
  { id: "lampside.barley", x0: -26.4, x1: -17.9, z0: -25.6, z1: -7.4, row: 0.9, crop: "barley" },
  { id: "lampside.grove", x0: 19, x1: 33.6, z0: -23.6, z1: -7.4, row: 0.8, crop: "green" },
];

/** A gate in a walled plot: on its north, south, east or west side, `at` the x (n, s) or z (e, w) of its middle, `width` clear. */
export interface PlotGate {
  side: "n" | "s" | "e" | "w";
  at: number;
  width: number;
}

/**
 * The walls round a rectangular plot (Lampside's gardens, D-119; the Relic Works' ageing yard, D-129), pushed onto `walls`, with a gap at each of `gates` (pushed onto `gates`).
 * Each solid stretch is cut into runs of at most `LAMPSIDE.wall.run` metres so each sits on its own ground, a pier at every run end that meets a gate. The north and south sides
 * run the full width and over the corners, the east and west sides fit between them: no two runs overlap and no corner is notched.
 */
export function walledPlot(g: { x0: number; x1: number; z0: number; z1: number; gates: readonly PlotGate[] }, walls: LampsideWall[], gates: { x: number; z: number; width: number }[]): void {
  const W = LAMPSIDE.wall;
  // a side of a plot from (ax, az) to (bx, bz), with gaps at `cuts` (distance along the side, width)
  const side = (ax: number, az: number, bx: number, bz: number, cuts: { at: number; width: number }[]): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const yaw = Math.atan2(uz, ux);
    const spans: [number, number, boolean, boolean][] = [];
    let t = 0;
    let fromGate = false;
    for (const c of [...cuts].sort((a, b) => a.at - b.at)) {
      spans.push([t, c.at - c.width / 2, fromGate, true]);
      gates.push({ x: ax + ux * c.at, z: az + uz * c.at, width: c.width });
      t = c.at + c.width / 2;
      fromGate = true;
    }
    spans.push([t, len, fromGate, false]);
    for (const [s0, s1, pierA, pierB] of spans) {
      const n = Math.max(1, Math.ceil((s1 - s0) / W.run));
      for (let i = 0; i < n; i++) {
        const a = s0 + ((s1 - s0) * i) / n;
        const b = s0 + ((s1 - s0) * (i + 1)) / n;
        const m = (a + b) / 2;
        const piers: (-1 | 1)[] = [];
        if (i === 0 && pierA) piers.push(-1);
        if (i === n - 1 && pierB) piers.push(1);
        walls.push({ x: ax + ux * m, z: az + uz * m, yaw, hx: (b - a) / 2, piers });
      }
    }
  };
  const cut = (s: string, along: (v: number) => number): { at: number; width: number }[] => g.gates.filter((q) => q.side === s).map((q) => ({ at: along(q.at), width: q.width }));
  const h = W.half;
  side(g.x0 - h, g.z1, g.x1 + h, g.z1, cut("s", (v) => v - (g.x0 - h)));
  side(g.x0 - h, g.z0, g.x1 + h, g.z0, cut("n", (v) => v - (g.x0 - h)));
  side(g.x0, g.z0 + h, g.x0, g.z1 - h, cut("w", (v) => v - (g.z0 + h)));
  side(g.x1, g.z0 + h, g.x1, g.z1 - h, cut("e", (v) => v - (g.z0 + h)));
}

let cached: LampsidePlan | undefined;

export function lampsidePlan(): LampsidePlan {
  if (cached) return cached;
  const E = Math.PI;
  const S = LAMPSIDE_SIGNS;
  const houses: LampsideHouse[] = [
    // the west side of the street, doors east onto it
    { id: "w1", x: -9.0, z: -7.4, yaw: 0, hx: 3.4, hz: 2.8, height: 3.6, storeys: 1, roof: "flat", lime: true, awning: true, sign: S[0] },
    { id: "w2", x: -9.6, z: -16.2, yaw: 0, hx: 3.8, hz: 3.0, height: 5.8, storeys: 2, roof: "tile", lime: false, awning: false, sign: S[1] },
    { id: "w3", x: -8.8, z: -24.4, yaw: 0, hx: 3.0, hz: 2.4, height: 3.4, storeys: 1, roof: "flat", lime: false, awning: false, sign: S[2] },
    // the east side, doors west
    { id: "e1", x: 9.4, z: -7.0, yaw: E, hx: 3.2, hz: 2.6, height: 5.6, storeys: 2, roof: "tile", lime: true, awning: false, sign: S[3] },
    { id: "e2", x: 9.0, z: -15.4, yaw: E, hx: 2.8, hz: 3.2, height: 3.4, storeys: 1, roof: "flat", lime: false, awning: true, sign: S[4] },
  ];
  // the square north of e2: the well in its middle, a stall on its east side (counter west) and one on its north (counter south, toward the street's end)
  const stalls: LampsideStall[] = [
    { id: "stall.e", x: 14.4, z: -21.6, yaw: E, hx: 0.7, hz: 1.3, height: 2.3 },
    { id: "stall.n", x: 9.8, z: -27.4, yaw: Math.PI / 2, hx: 0.7, hz: 1.3, height: 2.3 },
  ];
  const walls: LampsideWall[] = [];
  const gates: LampsidePlan["gates"] = [];
  for (const g of GARDENS) walledPlot(g, walls, gates);
  // the date palms: a row down the middle of each plot in the west garden, a grove of nine in the east (each a hand off its line and its own size). None stands in line
  // with a gate: the way in from each gate is clear to the path between the plots (the barley's row is set between the two east gates, the grove's rows and columns either
  // side of its gates).
  const palms: LampsidePlan["palms"] = [];
  const spots: [number, number][] = [
    [-34.2, -11], [-34.2, -16.5], [-34.2, -22], [-22.2, -9], [-22.2, -16.2], [-22.2, -23.5],
    [21.2, -8.6], [26.3, -8.6], [31.4, -8.6], [21.2, -14.2], [26.3, -14.2], [31.4, -14.2], [21.2, -19.8], [26.3, -19.8], [31.4, -19.8],
  ];
  spots.forEach(([x, z], i) => palms.push({ x: x + (((i * 7) % 5) - 2) * 0.12, z: z + (((i * 3) % 5) - 2) * 0.12, s: 0.82 + ((i * 41) % 11) / 30, yaw: (i * 2.399) % (Math.PI * 2) }));
  cached = {
    houses,
    stalls,
    well: { x: 10.6, z: -23.2, r: 0.95, height: 0.85 },
    posts: [{ x: -4.3, z: -3.4 }, { x: 4.7, z: -3.4 }],
    walls,
    gates,
    palms,
  };
  return cached;
}

/** A stall's counter (its depth from the customer's face) and its backboard (from the back), metres: the gap between is the stallholder's (`stallKeeper`). */
export const STALL = { counter: 0.6, back: 0.1 } as const;

/** Where a stall's keeper stands, behind the counter (in the stall's own frame: `lx` from its middle toward the customer's side). */
export const stallKeeper = (s: LampsideStall): number => (s.hx - STALL.counter + (-s.hx + STALL.back)) / 2;

/** A house's highest point above the ground (the tile hip's ridge, or the flat roof's parapet). */
export const houseTop = (h: LampsideHouse): number => h.height + (h.roof === "tile" ? LAMPSIDE.roofRise : 0);

/** 1 inside the town's levelled ground, easing to 0 over `LAMPSIDE.pad.blend` outside it (createKessarTerrain pins the bank's level under it). */
export function lampsidePad(x: number, z: number): number {
  const p = LAMPSIDE.pad;
  const out = Math.max(p.x0 - x, x - p.x1, p.z0 - z, z - p.z1, 0);
  return 1 - smoothstep(0, p.blend, out);
}

/** 0..1: the street and the square (packed earth: no scrub, the road's paint), easing out over a metre and a half. */
export function lampsideStreet(x: number, z: number): number {
  const s = LAMPSIDE.street;
  const out = Math.max(s.x0 - x, x - s.x1, s.z0 - z, z - s.z1, 0);
  return 1 - smoothstep(0, 1.5, out);
}

/** True when a circle (x, z, r) reaches into the town: its houses, square and gardens, grown by `margin`. The seeded dressing that did is not there any more. */
export function inLampside(x: number, z: number, r: number, margin: number): boolean {
  const p = LAMPSIDE.pad;
  const m = r + margin;
  return x > p.x0 - m && x < p.x1 + m && z > p.z0 - m && z < p.z1 + m;
}

/** Everything solid in Lampside (no random draws: appended after Kessar's seeded dressing). */
export function lampsideObstacles(terrain: Terrain): Obstacle[] {
  const plan = lampsidePlan();
  const g = (x: number, z: number): number => terrain.height(x, z);
  const out: Obstacle[] = [];
  for (const h of plan.houses) {
    const y = g(h.x, h.z);
    out.push({ kind: "box", tag: "house", x: h.x, z: h.z, hx: h.hx, hz: h.hz, yaw: h.yaw, y0: y - 1, y1: y + houseTop(h) });
  }
  // a stall is its counter on the customer's side and its backboard, with the stallholder's standing room between (D-120: 0.7 m, room for a seller and not for a
  // player); the posts and the awning stand over it
  for (const s of plan.stalls) {
    const y = g(s.x, s.z);
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const part = (lx: number, half: number, top: number): void => void out.push({ kind: "box", tag: "stall", x: s.x + c * lx, z: s.z + sn * lx, hx: half, hz: s.hz, yaw: s.yaw, y0: y - 1, y1: y + top });
    part(s.hx - STALL.counter / 2, STALL.counter / 2, 1.05);
    part(-s.hx + STALL.back / 2, STALL.back / 2, s.height + 0.3);
  }
  const w = plan.well;
  out.push({ kind: "circle", tag: "well", x: w.x, z: w.z, r: w.r, y0: g(w.x, w.z) - 1, y1: g(w.x, w.z) + w.height });
  for (const p of plan.posts) out.push({ kind: "circle", tag: "pole", x: p.x, z: p.z, r: 0.12, y0: g(p.x, p.z) - 0.5, y1: g(p.x, p.z) + 3.2 });
  const W = LAMPSIDE.wall;
  for (const s of plan.walls) {
    const y = g(s.x, s.z);
    out.push({ kind: "box", tag: "wall", x: s.x, z: s.z, hx: s.hx, hz: W.half, yaw: s.yaw, y0: y - 1, y1: y + (s.piers.length > 0 ? W.pier : W.height) });
  }
  for (const p of plan.palms) {
    const y = g(p.x, p.z);
    out.push({ kind: "circle", tag: "pole", x: p.x, z: p.z, r: LAMPSIDE.palm.r, y0: y - 1, y1: y + LAMPSIDE.palm.height * p.s });
  }
  // the gardens' scarecrows (D-116: what stands in a field is solid)
  for (const plot of LAMPSIDE_GARDENS) for (const t of fieldThings(plot)) {
    const y = g(t.x, t.z);
    out.push({ kind: "circle", tag: "scarecrow", x: t.x, z: t.z, r: t.r, y0: y - 1, y1: y + t.height });
  }
  return out;
}
