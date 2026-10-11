import type { Obstacle } from "./collision.ts";
import type { Terrain } from "./terrain.ts";

/**
 * THE STAITHE (D-126): the gorge's mouth, where everybody lands. The walk from the wharf up the ore road to the cloister and the Assay House was sixty metres of bare floor
 * between boulders: the first thing a party saw of Vesper was nothing. Now the landing has its hamlet, every part of it one of the gorge's institutions at work on the
 * new arrival. West of the road, a step from the wharf, the Lamentation Guild's Receiving House measures everybody who comes ashore (coffins in four sizes stand ready at
 * its gable, a measuring post by its door, the Guild's crepe hung out to dry behind it). East of the road the Lower Gallery Company weighs its ore at a weigh-house with a
 * steelyard on a gallows, and lets bunks by the hour in a row of three plank bunkhouses. Every door is sealed with a notice in the gorge's voice.
 *
 * ONE pure description, read by the colliders (`staitheObstacles`, appended after the gorge's seeded boulders so nothing else in Vesper moves; the boulders that stood in the
 * hamlet are simply not there: `inStaithe`), the level plan (the houses are `sealed` buildings), the cloth's plaques and the client's geometry. The ground is not levelled
 * (the floor falls 3 cm a metre here); each house stands on a plinth sunk to its lowest corner. Metres; x east, z south (the gorge's head is north); yaw is the collision
 * convention (local +x = (cos yaw, sin yaw)) and a house's local +x is the face its door is in: 0 looks east, PI looks west.
 */

export type StaitheHouseKind = "receiving" | "weigh" | "bunk";

export interface StaitheHouse {
  id: string;
  kind: StaitheHouseKind;
  x: number;
  z: number;
  /** Collision yaw of the door's face (0: the door looks east; PI: west). */
  yaw: number;
  /** Half depth (local x, front to back) and half width (local z, along the road). */
  hx: number;
  hz: number;
  /** The walls' top above the ground (the eaves). */
  wallH: number;
  /** The gable's rise above the eaves (the ridge runs along local z, front to back is the roof's fall). */
  rise: number;
  /** The notice on the sealed door (one of `STAITHE_SIGNS`). */
  sign: string;
}

/** The doors' notices, in the gorge's voice (lettered on the cloth atlas's plaque strips: keep them short). */
export const STAITHE_SIGNS = [
  "MEASURED ON ARRIVAL. NO OBLIGATION",
  "WEIGHED TWICE. DISPUTED THRICE.",
  "BUNKS LET BY THE HOUR",
  "SLEEP AT OWN RISK. RISK EXTRA.",
  "NO SINGING: THE GUILD OWNS HYMNS",
] as const;

export interface StaithePlan {
  houses: StaitheHouse[];
  /** The Receiving House's coffins, stood upright against its south gable: one solid, `n` of them side by side, `h` tall. */
  coffins: { x: number; z: number; hx: number; hz: number; h: number; n: number };
  /** The Guild's measuring post on the Receiving House's front, beside its door (notched in the Guild's own units). */
  post: { x: number; z: number; r: number; h: number };
  /** The crepe line: two posts behind the Receiving House and the black cloths hung between them. */
  line: { x: number; z0: number; z1: number; r: number; h: number; cloths: number };
  /** The weigh-house's steelyard: a gallows post off the house's road-side corner, its arm over a hanging pan. Solid as one round (`r`, about the pan). */
  gallows: { x: number; z: number; panX: number; r: number; h: number };
}

let cached: StaithePlan | undefined;

export function staithePlan(): StaithePlan {
  if (cached) return cached;
  const W = Math.PI;
  const S = STAITHE_SIGNS;
  const houses: StaitheHouse[] = [
    // the Guild's, west of the road a step from the wharf, its door to the road (the arrival's view runs past its front)
    { id: "receiving", kind: "receiving", x: -11, z: 99, yaw: 0, hx: 1.8, hz: 2.3, wallH: 3.0, rise: 1.3, sign: S[0] },
    // the Company's, east of the road, doors to the road: the weigh-house, then the Rows up the gorge
    { id: "weigh", kind: "weigh", x: 8.8, z: 89, yaw: W, hx: 1.5, hz: 1.8, wallH: 3.0, rise: 0.9, sign: S[1] },
    { id: "bunk0", kind: "bunk", x: 13, z: 82, yaw: W, hx: 2.5, hz: 2.1, wallH: 2.9, rise: 1.2, sign: S[2] },
    { id: "bunk1", kind: "bunk", x: 13.4, z: 76, yaw: W, hx: 2.5, hz: 2.1, wallH: 2.9, rise: 1.2, sign: S[3] },
    { id: "bunk2", kind: "bunk", x: 13, z: 70, yaw: W, hx: 2.5, hz: 2.1, wallH: 2.9, rise: 1.2, sign: S[4] },
  ];
  const r = houses[0]!;
  cached = {
    houses,
    coffins: { x: r.x, z: r.z + r.hz + 0.22, hx: 1.3, hz: 0.2, h: 2.0, n: 4 },
    post: { x: r.x + r.hx + 0.11, z: r.z - 2.0, r: 0.09, h: 2.3 },   // (fixed to the front wall between the north crepe and the corner)
    line: { x: r.x - r.hx - 2.8, z0: r.z - 2.6, z1: r.z + 2.6, r: 0.08, h: 2.4, cloths: 5 },
    gallows: { x: 5.75, z: 86.0, panX: 6.1, r: 0.6, h: 2.6 },   // (free-standing off the corner, a body's width from it: never a squeeze between them)
  };
  return cached;
}

/** A house's highest point above the ground (its ridge). */
export const staitheTop = (h: StaitheHouse): number => h.wallH + h.rise;

/** The hamlet's ground: the west yard (the Receiving House, its coffins, post and line) and the east yard (the weigh-house, its gallows, the Rows). */
const YARDS = [
  { x0: -16.2, x1: -8.2, z0: 95.6, z1: 102.4 },
  { x0: 5.6, x1: 16.6, z0: 67.4, z1: 91.4 },
] as const;

/** True when a circle (x, z, r) reaches into either of the hamlet's yards grown by `margin`. The seeded boulders that did are not there any more. */
export function inStaithe(x: number, z: number, r: number, margin: number): boolean {
  const m = r + margin;
  for (const y of YARDS) if (x > y.x0 - m && x < y.x1 + m && z > y.z0 - m && z < y.z1 + m) return true;
  return false;
}

/** Everything solid in the Staithe (no random draws: appended after the gorge's seeded boulders). */
export function staitheObstacles(terrain: Terrain): Obstacle[] {
  const p = staithePlan();
  const g = (x: number, z: number): number => terrain.height(x, z);
  const out: Obstacle[] = [];
  for (const h of p.houses) {
    const y = g(h.x, h.z);
    out.push({ kind: "box", tag: "house", x: h.x, z: h.z, hx: h.hx, hz: h.hz, yaw: h.yaw, y0: y - 1, y1: y + staitheTop(h) });
  }
  const c = p.coffins;
  out.push({ kind: "box", tag: "crate", x: c.x, z: c.z, hx: c.hx, hz: c.hz, yaw: 0, y0: g(c.x, c.z) - 1, y1: g(c.x, c.z) + c.h });
  out.push({ kind: "circle", tag: "pole", x: p.post.x, z: p.post.z, r: p.post.r, y0: g(p.post.x, p.post.z) - 0.5, y1: g(p.post.x, p.post.z) + p.post.h });
  for (const z of [p.line.z0, p.line.z1]) out.push({ kind: "circle", tag: "pole", x: p.line.x, z, r: p.line.r, y0: g(p.line.x, z) - 0.5, y1: g(p.line.x, z) + p.line.h });
  const gl = p.gallows;
  out.push({ kind: "circle", tag: "pole", x: gl.x, z: gl.z, r: gl.r, y0: g(gl.x, gl.z) - 0.5, y1: g(gl.x, gl.z) + gl.h });
  return out;
}
