import type { Obstacle } from "./collision.ts";
import { LAMPSIDE, houseTop, walledPlot, STALL, type LampsideHouse, type LampsideStall, type LampsideWall } from "./lampside.ts";
import { smoothstep } from "./math.ts";
import type { Terrain } from "./terrain.ts";

/**
 * THE RELIC WORKS (D-129): Kessar's west beach. The Society comes to Kessar for antiquities, and the Kessarine of the shore, who know a market when one lands on their beach,
 * make them. The owner found the world sparse; the beach west of the landing was forty metres of bare sand between the pier and the Syndicate's camp, the first thing a party
 * saw of Kessar after the boat. Now the shore has a trade. A workshop throws pots in the old styles (its door sealed with the Ward's paper and a notice), a square kiln fires
 * them, and behind the works a walled ageing yard keeps them buried in raised beds, row on row, until they are old enough to be discovered. Beside the road up from the landing
 * a stall sells the finished article to the new arrivals, provenance extra: jars, figurines, tablets, and the bust of an ancient king who wears, by happy chance, a pith helmet.
 * The joke is the Society's appetite for the past and its eye for a bargain; the Kessarine are the ones who know exactly what they are doing.
 *
 * ONE pure description, as Lampside's (D-119) and the Staithe's (D-126): read by the terrain (the works and the stall stand on levelled ground: `relicPad`), the colliders
 * (`relicObstacles`, appended after Kessar's seeded dressing with no random draws, so nothing else in Kessar moves; the dressing that stood in its yards is simply not there:
 * `inRelicWorks`), the level plan (the works is a `sealed` building), the cloth's boards and plaque and the client's geometry. The works is a Lampside house by its type, drawn
 * by the same hand; the ageing yard is walled as Lampside's gardens are. Metres; x east, z south (the sea is south, past z = 96); yaw is the collision convention (local +x =
 * (cos yaw, sin yaw)) and a house's or a stall's local +x is its front.
 */

/** The works' door notice (a plaque on the cloth atlas: at most 36 characters). */
export const RELIC_SIGNS = ["ANTIQUITIES MADE TO ORDER. ANY AGE"] as const;

/** The two signboards (lettered on the cloth atlas after Kessar's own boards): the stall's, turned to the landing, and the ageing yard's, at its gate. */
export const RELIC_BOARDS = ["GENUINE ANTIQUITIES. FRESH TODAY", "AGEING IN PROGRESS. DO NOT DISCOVER"] as const;

export interface RelicBoard {
  x: number;
  z: number;
  /** The board's face looks along (cos yaw, sin yaw); it is lettered on both faces. */
  yaw: number;
  /** Index into `RELIC_BOARDS`. */
  text: number;
}

/** A raised bed of the ageing yard: sand heaped `height` high over the buried pots (walkable: under the step), its long side along z. */
export interface RelicBed {
  x: number;
  z: number;
  hx: number;
  hz: number;
  height: number;
}

export interface RelicPlan {
  /** The workshop: a Lampside house by type (single storey, flat roof, lime-wash, an awning over its sealed door), its door to the road. */
  works: LampsideHouse;
  /** The kiln north of the works: a square of mud brick, its firing mouth to the east, a flue at its back. Solid to `height`; the flue rises to `flue`. */
  kiln: { x: number; z: number; half: number; height: number; flue: number };
  /** The ageing yard behind the works: its walls (Lampside's garden walls) and its gate, facing the works' back door. */
  yard: { x0: number; x1: number; z0: number; z1: number; walls: LampsideWall[]; gates: { x: number; z: number; width: number }[] };
  beds: RelicBed[];
  /** The drying shelf of new pots against the works' south gable (solid, a crate's height). */
  shelf: { x: number; z: number; hx: number; hz: number; height: number };
  /** The stall by the road: Lampside's stall by type, its counter to the road. */
  stall: LampsideStall;
  boards: RelicBoard[];
}

/** The levelled ground: the works' yard (house, kiln, ageing yard) and the stall's patch by the road, each easing into the swell over its `blend`. */
const PADS = [
  { x0: -41.5, x1: -20.5, z0: 70, z1: 87, blend: 8 },
  { x0: -13, x1: -8.5, z0: 73, z1: 81.5, blend: 4 },
] as const;

let cached: RelicPlan | undefined;

export function relicPlan(): RelicPlan {
  if (cached) return cached;
  const works: LampsideHouse = { id: "works", x: -24, z: 79, yaw: 0, hx: 2.4, hz: 3.4, height: 3.6, storeys: 1, roof: "flat", lime: true, awning: true, sign: RELIC_SIGNS[0] };
  // the ageing yard: 9.5 x 12 within its walls, a gate in the east wall opposite the works' back door (a lane of 3.9 between them)
  const yard = { x0: -40, x1: -30.5, z0: 73.5, z1: 85.5 };
  const walls: LampsideWall[] = [];
  const gates: { x: number; z: number; width: number }[] = [];
  walledPlot({ ...yard, gates: [{ side: "e", at: works.z + 0.5, width: 2.2 }] }, walls, gates);
  // two beds along the yard, a lane of 2.0 either side of each (the east lane 2.2, onto the gate) and 1.56 at their ends
  const inner = yard.x0 + LAMPSIDE.wall.half;
  const beds: RelicBed[] = [0, 1].map((i) => ({ x: inner + 2.0 + 0.7 + i * 3.4, z: (yard.z0 + yard.z1) / 2, hx: 0.7, hz: 4.2, height: 0.35 }));
  cached = {
    works,
    kiln: { x: works.x, z: works.z - works.hz - 2.3 - 0.9, half: 0.9, height: 1.9, flue: 3.6 },
    yard: { ...yard, walls, gates },
    beds,
    shelf: { x: works.x + 0.2, z: works.z + works.hz + 0.27, hx: 1.5, hz: 0.25, height: 0.95 },
    stall: { id: "relic.stall", x: -11, z: 75.5, yaw: 0, hx: 0.7, hz: 1.5, height: 2.3 },
    boards: [
      // turned to the landing, a step south of the stall (the party reads it as it comes up the beach)
      { x: -9.8, z: 79.6, yaw: Math.atan2(6.4, 9.8), text: 0 },
      // at the yard's gate, a body's width clear of its wall, facing the lane behind the works
      { x: yard.x1 + 1.5, z: works.z - 2.6, yaw: 0, text: 1 },
    ],
  };
  return cached;
}

/** 1 on the Relic Works' levelled ground, easing to 0 over each pad's blend outside it (createKessarTerrain pins the bank's level under it). */
export function relicPad(x: number, z: number): number {
  let best = 0;
  for (const p of PADS) {
    const out = Math.max(p.x0 - x, x - p.x1, p.z0 - z, z - p.z1, 0);
    best = Math.max(best, 1 - smoothstep(0, p.blend, out));
  }
  return best;
}

/** 0..1: the works' worked ground and the stall's patch (packed earth: no scrub, a road's paint), easing out over a metre and a half. */
export function relicGround(x: number, z: number): number {
  let best = 0;
  for (const p of PADS) {
    const out = Math.max(p.x0 - x, x - p.x1, p.z0 - z, z - p.z1, 0);
    best = Math.max(best, 1 - smoothstep(0, 1.5, out));
  }
  return best;
}

/** True when a circle (x, z, r) reaches into the works' yard or the stall's patch, grown by `margin`. The seeded dressing that did is not there any more. */
export function inRelicWorks(x: number, z: number, r: number, margin: number): boolean {
  const m = r + margin;
  for (const p of PADS) if (x > p.x0 - m && x < p.x1 + m && z > p.z0 - m && z < p.z1 + m) return true;
  return false;
}

/** Everything solid in the Relic Works (no random draws: appended after Kessar's seeded dressing). */
export function relicObstacles(terrain: Terrain): Obstacle[] {
  const p = relicPlan();
  const g = (x: number, z: number): number => terrain.height(x, z);
  const out: Obstacle[] = [];
  const h = p.works;
  out.push({ kind: "box", tag: "house", x: h.x, z: h.z, hx: h.hx, hz: h.hz, yaw: h.yaw, y0: g(h.x, h.z) - 1, y1: g(h.x, h.z) + houseTop(h) });
  const k = p.kiln;
  out.push({ kind: "box", tag: "ruin", x: k.x, z: k.z, hx: k.half, hz: k.half, yaw: 0, y0: g(k.x, k.z) - 1, y1: g(k.x, k.z) + k.height });
  const sh = p.shelf;
  out.push({ kind: "box", tag: "crate", x: sh.x, z: sh.z, hx: sh.hx, hz: sh.hz, yaw: 0, y0: g(sh.x, sh.z) - 1, y1: g(sh.x, sh.z) + sh.height });
  const W = LAMPSIDE.wall;
  for (const s of p.yard.walls) {
    const y = g(s.x, s.z);
    out.push({ kind: "box", tag: "wall", x: s.x, z: s.z, hx: s.hx, hz: W.half, yaw: s.yaw, y0: y - 1, y1: y + (s.piers.length > 0 ? W.pier : W.height) });
  }
  for (const b of p.beds) out.push({ kind: "box", tag: "bund", x: b.x, z: b.z, hx: b.hx, hz: b.hz, yaw: 0, y0: g(b.x, b.z) - 1, y1: g(b.x, b.z) + b.height });
  // the stall as Lampside's: its counter on the customer's side and its backboard, the keeper's standing room between
  const s = p.stall;
  const y = g(s.x, s.z);
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  const part = (lx: number, half: number, top: number): void => void out.push({ kind: "box", tag: "stall", x: s.x + c * lx, z: s.z + sn * lx, hx: half, hz: s.hz, yaw: s.yaw, y0: y - 1, y1: y + top });
  part(s.hx - STALL.counter / 2, STALL.counter / 2, 1.05);
  part(-s.hx + STALL.back / 2, STALL.back / 2, s.height + 0.3);
  for (const b of p.boards) out.push({ kind: "circle", tag: "sign", x: b.x, z: b.z, r: 0.12, y0: g(b.x, b.z) - 0.5, y1: g(b.x, b.z) + 2 });
  return out;
}
