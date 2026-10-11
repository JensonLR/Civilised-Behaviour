import type { Obstacle } from "./collision.ts";
import { smoothstep } from "./math.ts";
import type { Terrain } from "./terrain.ts";

/**
 * THE BRINE HOUSES' SALT WORKS (D-121): the Saltmarket's own industry, on the empty silt between the main boardwalk and the Long Cut. The owner found the world "very sparse", and the
 * delta's busiest walk (the quay to the Exchange, every visit) crossed sixty metres of bare flat with a lantern every twenty. The Houses live on salt and sell it by auction before it is dry;
 * now you can see where it comes from. A windpump on the Long Cut's bank lifts brine into the RESERVOIR; three rows of CONDENSERS warm it (grey-green, then olive, then rose as it
 * thickens); a row of CRYSTALLISERS crusts over; the last row is RAKED into white windrows (one pan already LIFTED, its salt barrowed off); and in the yard by the bridge the season's
 * salt stands in four heaps, two of them thatched against the rain, each with the pennant of the House that bought it. Every pan is a numbered lot.
 *
 * ONE pure description, read by the terrain (`saltworksPad`: the works stand on levelled ground at the bank's level), the colliders (`saltworksObstacles`, appended last: clay bunds a
 * walker steps onto and walks along, windrows likewise, heaps solid to chest height, the pump, two barrows), the cover (`saltworksClear`: no reed or sedge grows in a worked pan, and the
 * fire finds nothing to burn: the pans are a firebreak), the footsteps (`saltPanAt`: a splash in the brine, a crunch on the crust) and the client's geometry. No seed: the works are built,
 * not grown. Metres; x east, z south (the Exchange is north, the quay south); bunds are axis-aligned.
 */

export type SaltPanState = "reservoir" | "green" | "olive" | "rose" | "crust" | "raked" | "lifted";
/** The brine still stands in these (the footsteps splash); the rest are crust or bare clay. */
export const BRINE_STATES: readonly SaltPanState[] = ["reservoir", "green", "olive", "rose"];

export interface SaltPan {
  id: string;
  /** The pan's floor between its bunds' inner faces (the brine, the crust, the windrows lie here). */
  x0: number; x1: number; z0: number; z1: number;
  state: SaltPanState;
  /** The lot it was sold as (the Houses auction a pan before its salt is dry). */
  lot: number;
  /** Which House bought it: its pennant (0..3). */
  house: number;
}
/** A clay bund: an axis-aligned box `hx` x `hz` (half extents) on the ground, `height` tall; walkable (lower than the step). */
export interface SaltBund { x: number; z: number; hx: number; hz: number; height: number }
/** A windrow: raked salt in a low ridge along x (walkable). */
export interface SaltRow { x: number; z: number; hx: number; hz: number; height: number }
export interface SaltHeap { x: number; z: number; r: number; height: number; capped: boolean; house: number }
/**
 * D-123: a raker's hut in the row between the yard and the Customs Cut: a low reed-walled hut with a thatched ridge (`height` above the ground, kept low: from the boardwalk and
 * the quay the row is under the line), facing the yard. Collision convention: local +x is its front (north, to the heaps), `hx` its half depth and `hz` its half width. The
 * Brinefolk who live in it go in by a low door at the back, on the cut side (not a player's door: the front has a shuttered window and no way in).
 */
export interface SaltHut { id: string; x: number; z: number; yaw: number; hx: number; hz: number; height: number; wall: number }
export interface SaltworksPlan {
  pans: SaltPan[];
  bunds: SaltBund[];
  rows: SaltRow[];
  heaps: SaltHeap[];
  /** D-123: the rakers' row. */
  huts: SaltHut[];
  /** Wooden sluice gates in the bunds, where the brine is let from one row of pans to the next (alternate ends: it zigzags). `along`: the bund runs along x. */
  sluices: { x: number; z: number }[];
  /** The brine pump: a lattice windpump astride the reservoir's north-east corner; its suction pipe runs east over the revetment into the Long Cut. */
  pump: { x: number; z: number; r: number; height: number };
  barrows: { x: number; z: number; yaw: number }[];
  /** Rakes left leaning on the heaps (visual). */
  rakes: { heap: number; yaw: number }[];
  /** The works' notice by the boardwalk: an index into SALTMARKET_SIGNS (the plan's sign list carries it). */
  sign: { x: number; z: number; yaw: number };
}

/** The grid: bund centre-lines along x (west to east) and along z (north to south). The first row is the reservoir; the yard lies south of the last line. */
const XL = [3, 10.4, 17.6, 25] as const;
const ZL = [18, 27, 35, 43, 51, 59, 67] as const;
export const SALTWORKS = {
  /** The works' outer bounds (the bunds' centre-lines, then the yard to `yardZ1`). */
  x0: XL[0], x1: XL[3], z0: ZL[0], z1: ZL[6], yardZ1: 77,
  /** D-123: the rakers' row's back (the huts and the path behind them, short of the Customs Cut's revetment). */
  rowZ1: 82.8,
  /** D-123: a hut: half depth (north-south) and half width, walls and ridge (the ridge low enough to keep the delta's line: `saltworks.test.ts` measures it). */
  hut: { hx: 1.5, hz: 2.0, wall: 1.75, ridge: 2.6, z: 80.4, xs: [8.4, 13.4, 18.4, 23.4] },   // (the walls high enough that a Brinefolk leaning on the front stands clear of the eave)
  /** A bund's collider half-width and height (its drawn base is a little wider, its top a little narrower: a clay bank). */
  bund: { half: 0.3, height: 0.24, base: 0.38, top: 0.24 },
  /** The windrows: half-width and height. */
  row: { half: 0.3, height: 0.22, pitch: 1.5 },
  /** The ground is levelled over the works and this far round them, easing out over `blend`. */
  pad: { margin: 2, blend: 6 },
  /** No plant grows this far round the works (the bunds' outer faces), easing out over `fade`. */
  clear: { margin: 1.4, fade: 2.5 },
  /** Heaps: the angle the salt stands at (rise over run), and the colliders' share of the cone (a wide low ring to chest height, a narrow one to the shoulder). */
  heap: { slope: 1 / 1.15, lowR: 0.85, lowH: 0.4, highR: 0.42, highH: 0.9 },
} as const;

/** The pans' states, north (the reservoir, fed first) to south (the raked pans by the yard), three a row after the reservoir. */
const ROWS: readonly (readonly SaltPanState[])[] = [
  ["reservoir"],
  ["green", "green", "green"],
  ["olive", "olive", "olive"],
  ["rose", "rose", "rose"],
  ["crust", "crust", "crust"],
  ["raked", "lifted", "raked"],
];

let cached: SaltworksPlan | undefined;

export function saltworksPlan(): SaltworksPlan {
  if (cached) return cached;
  const B = SALTWORKS.bund;
  const pans: SaltPan[] = [];
  const bunds: SaltBund[] = [];
  // the long bunds run the works' width along every z line (each meets the next row's cross-bunds); the cross-bunds stand between them, 6 mm lower so their tops never fight
  for (const z of ZL) bunds.push({ x: (XL[0] + XL[3]) / 2, z, hx: (XL[3] - XL[0]) / 2 + B.half, hz: B.half, height: B.height });
  ROWS.forEach((states, r) => {
    const z0 = ZL[r]!, z1 = ZL[r + 1]!;
    const cols = states.length === 1 ? [XL[0], XL[3]] : [...XL];
    for (const x of cols) bunds.push({ x, z: (z0 + z1) / 2, hx: B.half, hz: (z1 - z0) / 2, height: B.height - 0.006 });
    for (let c = 0; c + 1 < cols.length; c++) {
      const lot = pans.length + 1;
      pans.push({ id: `pan${lot}`, x0: cols[c]! + B.half, x1: cols[c + 1]! - B.half, z0: z0 + B.half, z1: z1 - B.half, state: states[c]!, lot, house: (lot * 7 + r) % 4 });
    }
  });
  // the windrows: the raked pans' salt in ridges along x, a pitch apart, clear of the bunds by a rake's width
  const R = SALTWORKS.row;
  const rows: SaltRow[] = [];
  for (const p of pans) {
    if (p.state !== "raked") continue;
    const n = Math.floor((p.z1 - p.z0 - 1.2) / R.pitch) + 1;
    const span = (n - 1) * R.pitch;
    for (let i = 0; i < n; i++) rows.push({ x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2 - span / 2 + i * R.pitch, hx: (p.x1 - p.x0) / 2 - 0.6, hz: R.half, height: R.height });
  }
  // the season's salt in the yard: four heaps along the barrow way, the steepest a wet heap can stand
  const heaps: SaltHeap[] = [];
  const hs = [2.0, 2.4, 1.6, 2.2];
  let x = XL[0] + 0.3;
  hs.forEach((h, i) => {
    const r = h / SALTWORKS.heap.slope;
    x += r;
    heaps.push({ x: +x.toFixed(2), z: 72.4, r: +r.toFixed(2), height: h, capped: i === 1 || i === 3, house: [2, 0, 3, 1][i]! });
    x += r + 1.0;
  });
  // sluices: from the reservoir into the first condensers at the east end, then alternately west and east (the brine zigzags south)
  const sluices: SaltworksPlan["sluices"] = [];
  for (let r = 1; r < ROWS.length; r++) {
    const c = r % 2 === 1 ? 2 : 0;
    sluices.push({ x: (XL[c]! + XL[c + 1]!) / 2, z: ZL[r]! });
  }
  // D-123: the rakers' row, facing the heaps across the front lane, its backs to the Customs Cut
  const H = SALTWORKS.hut;
  const huts: SaltHut[] = H.xs.map((x, i) => ({ id: `hut${i}`, x, z: H.z, yaw: -Math.PI / 2, hx: H.hx, hz: H.hz, height: H.ridge, wall: H.wall }));
  cached = {
    pans, bunds, rows, heaps, huts, sluices,
    pump: { x: XL[3], z: ZL[0], r: 1.0, height: 10 },   // (on the reservoir's north-east corner: from the boardwalk it stands in line with the cove's derrick, a hair on the line that shuts no more of the horizon)
    barrows: [{ x: 9.1, z: 68.9, yaw: 0.25 }, { x: 20.1, z: 76.1, yaw: Math.PI + 0.4 }],
    rakes: [{ heap: 0, yaw: -0.6 }, { heap: 2, yaw: 2.4 }],
    sign: { x: 4.6, z: 79.2, yaw: Math.PI / 2 },
  };
  return cached;
}

/** The pan whose floor (x, z) is on, if any. */
export function saltPanAt(x: number, z: number): SaltPan | undefined {
  if (x < SALTWORKS.x0 || x > SALTWORKS.x1 || z < SALTWORKS.z0 || z > SALTWORKS.z1) return undefined;
  for (const p of saltworksPlan().pans) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return p;
  return undefined;
}

/** Distance outside the works' rectangle (the bunds' outer faces, the yard to its south edge): 0 inside. */
function outside(x: number, z: number): number {
  const W = SALTWORKS, h = W.bund.base;
  const dx = Math.max(W.x0 - h - x, 0, x - W.x1 - h);
  const dz = Math.max(W.z0 - h - z, 0, z - W.rowZ1);
  return Math.hypot(dx, dz);
}

/** 1 where the ground is levelled for the works (the pans, the yard and a margin round them), easing to 0. */
export const saltworksPad = (x: number, z: number): number => 1 - smoothstep(SALTWORKS.pad.margin, SALTWORKS.pad.margin + SALTWORKS.pad.blend, outside(x, z));

/** 1 where nothing grows (the worked ground and a margin round it), easing to 0: the scatter, the ground's paint and the fire read it. */
export const saltworksClear = (x: number, z: number): number => 1 - smoothstep(SALTWORKS.clear.margin, SALTWORKS.clear.margin + SALTWORKS.clear.fade, outside(x, z));

/** True if a thing of radius `r` at (x, z) stands on the works' ground (or within `margin` of it). */
export const inSaltworks = (x: number, z: number, r = 0, margin = 0): boolean => outside(x, z) <= r + margin;

/** Points of the works a body must be able to walk to (the level audit's): the yard by the heaps, the reservoir's floor, the lifted pan, the towpath along the revetment. */
export function saltworksPoints(): { id: string; x: number; z: number }[] {
  return [
    { id: "saltworks.yard", x: 14.4, z: 68.6 },
    { id: "saltworks.reservoir", x: 9, z: 22.5 },
    { id: "saltworks.lifted", x: 14, z: 63 },
    { id: "saltworks.towpath", x: 26.8, z: 45 },
  ];
}

/** The pump's suction pipe: where it leaves the tower and the height it crosses the towpath and the revetment at (above the ground). */
export const SALTWORKS_PIPE = { y: 2.15, r: 0.09 } as const;

/**
 * Everything solid of the works, appended after the rest of the delta: the bunds and the windrows (floors a walker steps onto), the heaps (a wide ring to chest height and a narrow one to
 * the shoulder: the cone's own shape, near enough for a bullet), the pump, the barrows, and (D-123) the rakers' huts, boxes to the ridge. Tags: `bund` and `salt` are new (earth to a bullet); the pump is a `pole`, a barrow a `cart`.
 */
export function saltworksObstacles(terrain: Terrain): Obstacle[] {
  const plan = saltworksPlan();
  const g = (x: number, z: number): number => terrain.height(x, z);
  const out: Obstacle[] = [];
  for (const b of plan.bunds) {
    const y = g(b.x, b.z);
    out.push({ kind: "box", tag: "bund", x: b.x, z: b.z, hx: b.hx, hz: b.hz, yaw: 0, y0: y - 0.3, y1: y + b.height });
  }
  for (const w of plan.rows) {
    const y = g(w.x, w.z);
    out.push({ kind: "box", tag: "salt", x: w.x, z: w.z, hx: w.hx, hz: w.hz, yaw: 0, y0: y - 0.1, y1: y + w.height });
  }
  const H = SALTWORKS.heap;
  for (const h of plan.heaps) {
    const y = g(h.x, h.z);
    out.push({ kind: "circle", tag: "salt", x: h.x, z: h.z, r: h.r * H.lowR, y0: y - 0.3, y1: y + h.height * H.lowH });
    out.push({ kind: "circle", tag: "salt", x: h.x, z: h.z, r: h.r * H.highR, y0: y + h.height * H.lowH - 0.05, y1: y + h.height * H.highH });
  }
  const p = plan.pump;
  out.push({ kind: "circle", tag: "pole", x: p.x, z: p.z, r: p.r, y0: g(p.x, p.z) - 1, y1: g(p.x, p.z) + p.height });
  for (const b of plan.barrows) {
    const y = g(b.x, b.z);
    out.push({ kind: "box", tag: "cart", x: b.x, z: b.z, hx: 0.85, hz: 0.36, yaw: b.yaw, y0: y - 0.2, y1: y + 0.72 });
  }
  for (const h of plan.huts) {
    const y = g(h.x, h.z);
    out.push({ kind: "box", tag: "house", x: h.x, z: h.z, hx: h.hx, hz: h.hz, yaw: h.yaw, y0: y - 0.3, y1: y + h.height });
  }
  return out;
}
