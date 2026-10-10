import type { Obstacle } from "./collision.ts";
import type { Terrain } from "./terrain.ts";

/**
 * The Society's expedition camp at the spawn, as authored data. The SAME numbers make the collision (createArena), the
 * visuals (client landmarks) and the keep-out for props and players (`stores.ts` campProps), so the tent you see is the tent you
 * bump into and nothing ever spawns inside a bell tent. All positions are in the flat spawn clearing (radius 14).
 * Yaw convention is the collision one: local +x = (cos yaw, sin yaw) in (x, z); three.js rotation.y = -yaw.
 */
export const CAMP = {
  /** Two elliptical bell tents west of the spawn, doors (local +x end) facing the fire. */
  tents: [
    { x: -8, z: 3, yaw: 0.28 },
    { x: -8.9, z: -3.8, yaw: -0.2 },
  ],
  tentHalf: { hx: 2, hz: 1.6, height: 2.4 },
  fire: { x: 7, z: -4, r: 0.6, height: 0.45 },
  flag: { x: 2.6, z: -8.4, r: 0.16, height: 6.4 },
  sign: { x: 10.4, z: 0.4, r: 0.18, height: 2.8 },
  luggage: { x: -4.6, z: 8.9, hx: 0.95, hz: 0.55, yaw: 0.5, height: 1.4 },
  cart: { x: 9.6, z: 7.4, hx: 1.45, hz: 0.95, yaw: -0.6, height: 2.0 },
  /** The old authored step-up crates. */
  crates: [
    { x: 4, z: 6, half: 0.6, yaw: 0.3, height: 0.45 },
    { x: 5.35, z: 6.5, half: 0.6, yaw: -0.2, height: 0.9 },
  ],
  /** The ruined wall north of the camp. */
  wall: { x: 0, z: -12, hx: 6, hz: 0.4, height: 2.2 },
  /** The expedition's map table with the survey pinned to it, beside a lantern post. */
  mapTable: { x: -2.4, z: -7.0, hx: 0.85, hz: 0.5, yaw: 0.15, height: 0.92 },
  lanternPost: { x: -0.9, z: -7.7, r: 0.06, height: 2.1 },
  /** A brass telescope on a tripod, trained on the Observatory (yaw is the collision convention: direction (cos, sin) in x/z). */
  scope: { x: 11.6, z: -6.6, r: 0.5, height: 1.5, yaw: -1.173 },
  /** A tea table bearing the gramophone. */
  gramophone: { x: -1.2, z: 9.9, r: 0.42, height: 0.78 },
  /** Two poles and a washing line between them. */
  wash: { a: { x: -11.6, z: -5.8 }, b: { x: -11.4, z: 6.4 }, r: 0.07, height: 2.15 },
  /** Two posts and a hammock slung between them. */
  hammock: { a: { x: -9.4, z: 9.4 }, b: { x: -6.4, z: 11.4 }, r: 0.1, height: 1.95 },
  /**
   * The Expedition's HQ: a striped pavilion (the marquee) north-west of the fire, open at the front (local +x, which faces the camp), with a
   * planning table and camp chairs inside, and outside its mouth a supply pyramid, stencilled crates, the notice board and two flagpoles
   * flying the Society's arms. `hqPlan()` turns these local numbers into world positions; collision, looks and keep-outs all read that.
   */
  hq: { x: -3.35, z: -8.4, yaw: 0, hx: 3.45, hz: 2.6, wall: 2.3, ridge: 3.95 },
  /** Hanging lanterns (world x/z, y above the ground). They glow from dusk. */
  lanterns: [
    { x: -0.58, y: 1.69, z: -7.7 },
    { x: -11.28, y: 1.74, z: -5.8 },
    { x: -11.08, y: 1.74, z: 6.4 },
    { x: -5.45, y: 1.75, z: 3.95 },
    { x: 8.35, y: 2.05, z: 8.3 },
    { x: -9.08, y: 1.54, z: 9.4 },
  ],
} as const;

export interface HqPiece {
  /** World position and collision-convention yaw. */
  x: number;
  z: number;
  yaw: number;
}

export interface HqPlan {
  /** The pavilion: back and north sides are canvas, the front and the south side stand open (rolled up). */
  marquee: HqPiece & { hx: number; hz: number; wall: number; ridge: number };
  /** Camp chairs round the survey table (which is `CAMP.mapTable`, now under the ridge), and the strongbox at the back. */
  chairs: (HqPiece & { r: number })[];
  chest: HqPiece & { hx: number; hz: number; height: number };
  /** The supply pyramid: tiers of crates (bottom row first), barrels beside it. */
  pyramid: { tiers: (HqPiece & { hx: number; hz: number; y0: number; y1: number })[]; barrels: (HqPiece & { r: number; height: number })[] };
  /** Stencilled crates about the marquee: `stencil` indexes STENCIL_TEXT. */
  crates: (HqPiece & { half: number; height: number; stencil: number })[];
  /** The notice board on two posts, facing the camp (`w` x `h` is the board itself, `y` its centre's height). */
  notice: HqPiece & { hx: number; height: number; w: number; h: number; y: number };
  /** Two flagpoles either side of the mouth, flying the Society's arms. */
  poles: (HqPiece & { r: number; height: number })[];
  /** Lamps hanging from the ridge (world x/z and height above the ground). */
  lamps: { x: number; z: number; y: number }[];
}

/** Local (lx forward from the marquee's centre, lz to its right) -> world, with a yaw offset. */
function hqAt(lx: number, lz: number, dyaw = 0): HqPiece {
  const h = CAMP.hq;
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  return { x: h.x + lx * c - lz * s, z: h.z + lx * s + lz * c, yaw: h.yaw + dyaw };
}

let hqCached: HqPlan | undefined;
export function hqPlan(): HqPlan {
  if (hqCached) return hqCached;
  const h = CAMP.hq;
  const plan: HqPlan = {
    marquee: { ...hqAt(0, 0), hx: h.hx, hz: h.hz, wall: h.wall, ridge: h.ridge },
    chairs: [
      { ...hqAt(-0.6, 1.5, 0.3), r: 0.3 },
      { ...hqAt(1.35, 0.5, -0.5), r: 0.3 },
      { ...hqAt(0.2, -0.75, 0.15), r: 0.3 },
    ],
    chest: { ...hqAt(-h.hx + 0.6, -h.hz + 0.75), hx: 0.55, hz: 0.32, height: 0.62 },
    pyramid: {
      tiers: [
        { ...hqAt(-h.hx + 0.65, 1.55, Math.PI / 2 * 0), hx: 0.4, hz: 1.05, y0: 0, y1: 0.66 },
        { ...hqAt(-h.hx + 0.65, 1.55), hx: 0.4, hz: 0.7, y0: 0.66, y1: 1.32 },
        { ...hqAt(-h.hx + 0.65, 1.55), hx: 0.4, hz: 0.35, y0: 1.32, y1: 1.98 },
      ],
      barrels: [
        { ...hqAt(-h.hx + 0.6, 0.35), r: 0.33, height: 0.9 },
        { ...hqAt(-h.hx + 0.65, -0.4), r: 0.33, height: 0.9 },
      ],
    },
    crates: [
      { ...hqAt(3.9, 1.0, 0.25), half: 0.38, height: 0.7, stencil: 0 },
      { ...hqAt(4.35, 1.9, -0.2), half: 0.4, height: 0.75, stencil: 1 },
      { ...hqAt(-1.9, -h.hz + 0.6, 0.05), half: 0.4, height: 0.75, stencil: 3 },
      { ...hqAt(-1.1, -h.hz + 0.55, 0.3), half: 0.34, height: 0.5, stencil: 2 },
      { ...hqAt(-h.hx - 0.55, 0.6, 0.5), half: 0.36, height: 0.68, stencil: 1 },
    ],
    notice: { ...hqAt(7.0, -2.65, Math.PI / 2), hx: 1.0, height: 2.25, w: 1.9, h: 0.95, y: 1.5 },
    poles: [
      { ...hqAt(h.hx + 0.5, -h.hz + 0.35), r: 0.07, height: 4.7 },
      { ...hqAt(h.hx + 0.5, h.hz - 0.35), r: 0.07, height: 4.7 },
    ],
    lamps: [{ ...hqAt(0.2, 0.2), y: 2.6 } as { x: number; z: number; y: number }],
  };
  hqCached = plan;
  return plan;
}

/** The camp's collidable landmarks (tagged so the renderer knows what each one is). Deterministic, allocation only at build time. */
export function campObstacles(terrain: Terrain): Obstacle[] {
  const out: Obstacle[] = [];
  const ground = (x: number, z: number): number => terrain.height(x, z);
  const w = CAMP.wall;
  out.push({ kind: "box", tag: "wall", x: w.x, z: w.z, hx: w.hx, hz: w.hz, yaw: 0, y0: ground(w.x, w.z) - 1, y1: ground(w.x, w.z) + w.height });
  for (const c of CAMP.crates) {
    const y = ground(c.x, c.z);
    out.push({ kind: "box", tag: "crate", x: c.x, z: c.z, hx: c.half, hz: c.half, yaw: c.yaw, y0: y - 0.5, y1: y + c.height });
  }
  const th = CAMP.tentHalf;
  for (const t of CAMP.tents) {
    const y = ground(t.x, t.z);
    out.push({ kind: "box", tag: "tent", x: t.x, z: t.z, hx: th.hx, hz: th.hz, yaw: t.yaw, y0: y - 0.5, y1: y + th.height });
  }
  const f = CAMP.fire;
  out.push({ kind: "circle", tag: "fire", x: f.x, z: f.z, r: f.r, y0: ground(f.x, f.z) - 0.5, y1: ground(f.x, f.z) + f.height });
  const fl = CAMP.flag;
  out.push({ kind: "circle", tag: "flag", x: fl.x, z: fl.z, r: fl.r, y0: ground(fl.x, fl.z) - 1, y1: ground(fl.x, fl.z) + fl.height });
  const sg = CAMP.sign;
  out.push({ kind: "circle", tag: "sign", x: sg.x, z: sg.z, r: sg.r, y0: ground(sg.x, sg.z) - 1, y1: ground(sg.x, sg.z) + sg.height });
  const lg = CAMP.luggage;
  out.push({ kind: "box", tag: "luggage", x: lg.x, z: lg.z, hx: lg.hx, hz: lg.hz, yaw: lg.yaw, y0: ground(lg.x, lg.z) - 0.5, y1: ground(lg.x, lg.z) + lg.height });
  const ct = CAMP.cart;
  out.push({ kind: "box", tag: "cart", x: ct.x, z: ct.z, hx: ct.hx, hz: ct.hz, yaw: ct.yaw, y0: ground(ct.x, ct.z) - 0.5, y1: ground(ct.x, ct.z) + ct.height });
  const mt = CAMP.mapTable;
  out.push({ kind: "box", tag: "table", x: mt.x, z: mt.z, hx: mt.hx, hz: mt.hz, yaw: mt.yaw, y0: ground(mt.x, mt.z) - 0.5, y1: ground(mt.x, mt.z) + mt.height });
  const sc = CAMP.scope;
  out.push({ kind: "circle", tag: "scope", x: sc.x, z: sc.z, r: sc.r, y0: ground(sc.x, sc.z) - 0.5, y1: ground(sc.x, sc.z) + sc.height });
  const gr = CAMP.gramophone;
  out.push({ kind: "circle", tag: "table", x: gr.x, z: gr.z, r: gr.r, y0: ground(gr.x, gr.z) - 0.5, y1: ground(gr.x, gr.z) + gr.height });
  const poles: { x: number; z: number; r: number; height: number }[] = [
    { ...CAMP.wash.a, r: CAMP.wash.r, height: CAMP.wash.height },
    { ...CAMP.wash.b, r: CAMP.wash.r, height: CAMP.wash.height },
    { ...CAMP.hammock.a, r: CAMP.hammock.r, height: CAMP.hammock.height },
    { ...CAMP.hammock.b, r: CAMP.hammock.r, height: CAMP.hammock.height },
    CAMP.lanternPost,
  ];
  for (const p of poles) out.push({ kind: "circle", tag: "pole", x: p.x, z: p.z, r: p.r, y0: ground(p.x, p.z) - 1, y1: ground(p.x, p.z) + p.height });
  // The hammock's sagging cloth is as large as a settee: a low box between the posts (too tall to step onto, easy to jump).
  const ha = CAMP.hammock.a;
  const hb = CAMP.hammock.b;
  const hmx = (ha.x + hb.x) / 2;
  const hmz = (ha.z + hb.z) / 2;
  out.push({ kind: "box", tag: "hammock", x: hmx, z: hmz, hx: Math.hypot(hb.x - ha.x, hb.z - ha.z) / 2 - 0.35, hz: 0.42, yaw: Math.atan2(hb.z - ha.z, hb.x - ha.x), y0: ground(hmx, hmz) - 0.5, y1: ground(hmx, hmz) + 1.1 });
  hqObstacles(out, ground);
  return out;
}

/** True if (x, z) is inside (or within `margin` metres of) any obstacle footprint. */
export function insideObstacle(o: Obstacle, x: number, z: number, margin: number): boolean {
  const dx = x - o.x;
  const dz = z - o.z;
  if (o.kind === "circle") return dx * dx + dz * dz <= (o.r + margin) * (o.r + margin);
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  return Math.abs(dx * c + dz * s) <= o.hx + margin && Math.abs(-dx * s + dz * c) <= o.hz + margin;
}

let cachedCamp: Obstacle[] | undefined;
const flatTerrain: Terrain = { height: () => 0 };

/** Keep-out test for anything that spawns on the ground near the camp (props, players): heights do not matter, footprints do. */
export function inCampFootprint(x: number, z: number, margin: number): boolean {
  cachedCamp ??= campObstacles(flatTerrain);
  for (const o of cachedCamp) if (insideObstacle(o, x, z, margin)) return true;
  return false;
}

/** The HQ's solid parts: the marquee's back and north canvas (front and south stand open: walk in), chairs, the strongbox, the supply pyramid, crates, the notice board, the flagpoles. */
function hqObstacles(out: Obstacle[], ground: (x: number, z: number) => number): void {
  const p = hqPlan();
  const m = p.marquee;
  const g0 = ground(m.x, m.z);
  const c = Math.cos(m.yaw);
  const s = Math.sin(m.yaw);
  const at = (lx: number, lz: number): { x: number; z: number } => ({ x: m.x + lx * c - lz * s, z: m.z + lx * s + lz * c });
  const wallBox = (lx: number, lz: number, hx: number, hz: number): void => {
    const w = at(lx, lz);
    out.push({ kind: "box", tag: "marquee", x: w.x, z: w.z, hx, hz, yaw: m.yaw, y0: g0 - 0.6, y1: g0 + m.wall });
  };
  wallBox(-m.hx + 0.05, 0, 0.05, m.hz); // back
  wallBox(0, -m.hz + 0.05, m.hx, 0.05); // north side
  for (const q of p.poles) out.push({ kind: "circle", tag: "hq", x: q.x, z: q.z, r: q.r, y0: ground(q.x, q.z) - 1, y1: ground(q.x, q.z) + q.height });
  for (const q of p.chairs) out.push({ kind: "circle", tag: "hq", x: q.x, z: q.z, r: q.r, y0: ground(q.x, q.z) - 0.5, y1: ground(q.x, q.z) + 0.45 });
  const ch = p.chest;
  out.push({ kind: "box", tag: "hq", x: ch.x, z: ch.z, hx: ch.hx, hz: ch.hz, yaw: ch.yaw, y0: ground(ch.x, ch.z) - 0.5, y1: ground(ch.x, ch.z) + ch.height });
  for (const q of p.pyramid.tiers) out.push({ kind: "box", tag: "hq", x: q.x, z: q.z, hx: q.hx, hz: q.hz, yaw: q.yaw, y0: ground(q.x, q.z) - 0.5, y1: ground(q.x, q.z) + q.y1 });
  for (const q of p.pyramid.barrels) out.push({ kind: "circle", tag: "hq", x: q.x, z: q.z, r: q.r, y0: ground(q.x, q.z) - 0.5, y1: ground(q.x, q.z) + q.height });
  for (const q of p.crates) out.push({ kind: "box", tag: "hq", x: q.x, z: q.z, hx: q.half, hz: q.half, yaw: q.yaw, y0: ground(q.x, q.z) - 0.5, y1: ground(q.x, q.z) + q.height });
  const n = p.notice;
  out.push({ kind: "box", tag: "hq", x: n.x, z: n.z, hx: 0.08, hz: n.hx, yaw: n.yaw, y0: ground(n.x, n.z) - 1, y1: ground(n.x, n.z) + n.height });
}
