import type { Obstacle, ObstacleTag } from "./collision.ts";
import type { RegionId } from "./campaignTypes.ts";
import type { Terrain } from "./terrain.ts";
import { OUTPOST_STAGES, type OutpostStage } from "./worldTypes.ts";
import { CAMP } from "./camp.ts";

/**
 * The Society's outpost as ONE pure description (D-035, like `kessarPlan`): the collision world and the view both read `outpostPlan(stage)`, so the hut you see
 * is the hut you bump into. Where it stands: `OUTPOST_SITES`. The delivery yard (`YARD_R` metres round the site) holds NO collider at any stage; stage footprints
 * live in the ring `YARD_R..RING_R`; the seeded scatter keeps out of that ring at every stage above "none" (kessar.ts), so a stage change moves nothing else.
 * Metres; x east, z south; yaw is the collision convention. Fictional cultures only: plank, canvas, stockade, stone, a clock.
 */

export const YARD_R = 5;
export const RING_R = 32;

/**
 * The foundation site and the Syndicate's rival post, per region. Final numbers, proven open, flat, dry and reachable by outpost.test.ts:
 * - Kessar: on the south bank between the landing (0, 88) and the Dry Cut (36, 36), the rival post 40 m east of it; the telegraph runs to the bridge (`telegraph`).
 * - Highmark (D-056): on the grass 56 m west of the Reed Landing, clear of the herds' grounds (the west herd grazes further off for it) and of every story point.
 * Vesper and the Saltmarket have none, on purpose: a full town plan (32 m round) fits nowhere in the gorge or among the canals (`scripts`: the site search of D-056),
 * and the fiction agrees: the Company leases no ground in its gorge and the Consortium's free port lets nobody build a flag.
 */
export const OUTPOST_SITES: Partial<Record<RegionId, { site: { x: number; z: number }; rivalSite: { x: number; z: number }; telegraph?: readonly { x: number; z: number }[] }>> = {
  // (D-091: the wire's first legs stood a pole in the camp's tent and another in a settlement house, and its last in the fingerpost at the abutment: it now
  //  leaves by the stockade's north-west, past the houses, and ends beside the post)
  kessar: { site: { x: 30, z: 72 }, rivalSite: { x: 69, z: 62 }, telegraph: [{ x: 24, z: 62 }, { x: 11, z: 63 }, { x: 5, z: 44 }, { x: 6, z: 34.5 }] },
  highmark: { site: { x: -52, z: 98 }, rivalSite: { x: -89, z: 108 } },
};
/** The regions a party can found a post in. */
export const OUTPOST_REGIONS = Object.keys(OUTPOST_SITES) as RegionId[];
/** Kessar's, for the callers that only ever ask about Kessar. */
export const KESSAR_OUTPOST = OUTPOST_SITES.kessar!;

export type OutpostPieceKind =
  | "tent" | "fire" | "hut" | "stall" | "rail" | "well" | "palisade" | "post" | "tower" | "house" | "mill" | "hall" | "bell" | "clock" | "wall" | "stakes" | "sign"
  | "siding" | "engine" | "buffer" | "tank" | "works" | "spoil" | "crank";

/** D-091: the pieces the industrial age adds, standing only while the post has the tech (the railway at Kessar; the works in its one region). */
export type OutpostTech = "railway" | "works" | "crank";

export interface OutpostPiece {
  kind: OutpostPieceKind;
  /** The stage that first has it (it stays at every later stage). */
  from: OutpostStage;
  x: number;
  z: number;
  yaw: number;
  /** Half extents (box) or radius in hx (circle). */
  hx: number;
  hz: number;
  height: number;
  shape: "box" | "circle";
  tag: ObstacleTag;
  /** False: dressing only (never a collider). */
  solid: boolean;
  /** D-091: stands only while the post has this (and its stage is at least `from`). */
  tech?: OutpostTech;
}

export interface OutpostPlan {
  stage: OutpostStage;
  site: { x: number; z: number };
  pieces: OutpostPiece[];
  /** The gate of the stockade faces north (toward the bridge): its centre. */
  gate: { x: number; z: number } | undefined;
}

const rank = (s: OutpostStage): number => OUTPOST_STAGES.indexOf(s);
const BOX = (kind: OutpostPieceKind, from: OutpostStage, tag: ObstacleTag, dx: number, dz: number, yaw: number, hx: number, hz: number, height: number, solid = true): OutpostPiece =>
  ({ kind, from, tag, x: dx, z: dz, yaw, hx, hz, height, shape: "box", solid });
const CIRCLE = (kind: OutpostPieceKind, from: OutpostStage, tag: ObstacleTag, dx: number, dz: number, r: number, height: number, solid = true): OutpostPiece =>
  ({ kind, from, tag, x: dx, z: dz, yaw: 0, hx: r, hz: r, height, shape: "circle", solid });

/** Local (dx east, dz south of the site) description of every piece at every stage; `outpostPlan` filters it and offsets it to the world. */
function localPieces(): OutpostPiece[] {
  const out: OutpostPiece[] = [];
  // the foundation: stakes and string round the yard (dressing only, so the yard stays free)
  out.push(BOX("stakes", "none", "fence", 0, 0, 0, 3.2, 3.2, 0.7, false));
  // the name board on its pole at the north of the yard, from the foundation to the town (dressing: the client letters it with the post's name and stage)
  out.push(BOX("sign", "none", "fence", 0, -3.6, 0, 0.7, 0.03, 1.75, false));
  // camp
  out.push(BOX("tent", "camp", "tent", -10, -6, 0.3, 2, 1.6, 2.4), BOX("tent", "camp", "tent", -11, 5, -0.2, 2, 1.6, 2.4), CIRCLE("fire", "camp", "fire", -7, -0.5, 0.55, 0.5));
  // trading post: a plank hut, a counter, a hitching rail, a well (D-091: the hut stood at 10, -9, where the stockade's north-east tower went up through its corner)
  out.push(BOX("hut", "trading_post", "house", 9, -8, 0.1, 1.9, 1.5, 3), BOX("stall", "trading_post", "stall", 9, 7, 0, 1.2, 0.6, 1.2), BOX("rail", "trading_post", "fence", 13, -1, 1.5708, 0.9, 0.12, 1.1), CIRCLE("well", "trading_post", "well", -4, 10, 0.8, 1));
  // fortified outpost: a stockade at 17 m with its gate to the north, two towers, a gatepost each side
  const N = 36;
  const R = 17;
  const chord = 2 * R * Math.sin(Math.PI / N);
  for (let i = 0; i < N; i++) {
    const th = (i * Math.PI * 2) / N + Math.PI / N;   // segment centre angle: 0 = +x (east), -pi/2 = north
    const north = Math.abs(Math.atan2(Math.sin(th + Math.PI / 2), Math.cos(th + Math.PI / 2)));
    if (north < 0.12) continue;                         // the gate gap: two segments, about 6 m
    out.push(BOX("palisade", "fortified_outpost", "wall", Math.cos(th) * R, Math.sin(th) * R, th + Math.PI / 2, chord / 2 - 0.05, 0.22, 3.4));
  }
  out.push(CIRCLE("tower", "fortified_outpost", "ruin", Math.cos(-Math.PI / 4) * R, Math.sin(-Math.PI / 4) * R, 1.4, 6.5), CIRCLE("tower", "fortified_outpost", "ruin", Math.cos((3 * Math.PI) / 4) * R, Math.sin((3 * Math.PI) / 4) * R, 1.4, 6.5));
  out.push(CIRCLE("post", "fortified_outpost", "pole", -3.2, -R, 0.28, 3.6), CIRCLE("post", "fortified_outpost", "pole", 3.2, -R, 0.28, 3.6));
  // settlement: huts beyond the stockade, a mill, a market hall, the jetty bell post (D-091: the south-west hut stood at -15, 14, against the stockade's tower and
  // through its wall; it steps 2 m south, not west, where Kessar's shore palm stands)
  for (const [x, z, yaw] of [[-23, -12, 0.2], [-24, 2, -0.1], [24, -10, 0.3], [24, 4, 0], [-15, 16, 0.1]] as const) out.push(BOX("house", "settlement", "house", x, z, yaw, 2, 1.6, 3));
  out.push(CIRCLE("mill", "settlement", "ruin", -27, -4, 2.2, 8), BOX("hall", "settlement", "house", 15, -23, 0, 3.2, 2, 4.2), CIRCLE("bell", "settlement", "pole", -9, 15, 0.2, 3));
  // town: stone houses, a clock tower, a partial wall (D-091: the first stood 9 cm off the settlement's north-west hut, a sliver of a gap; it steps back from it)
  for (const [x, z, yaw] of [[-22.5, -16.6, 0.1], [22, -16, -0.2], [-17, -22, 0], [24, 12, 0.1], [-24, 10, 0.3]] as const) out.push(BOX("house", "town", "house", x, z, yaw, 2.4, 2, 5));
  out.push(CIRCLE("clock", "town", "ruin", 9, -27, 1.6, 10));
  for (const [x, z, yaw] of [[-11, -26.5, 0], [28, -3, Math.PI / 2]] as const) out.push(BOX("wall", "town", "wall", x, z, yaw, 2.5, 0.35, 2.4));
  // D-091, the railway (a Kessar town): nine yards of siding east of the stockade, between the huts, with its tank engine, a buffer stop at each end and a water
  // tank on legs at the north end. The line is "to follow"; the siding is what has arrived. The track is dressing (it is walked over); the rest is solid.
  const RAIL_X = 20.5;
  out.push(BOX("siding", "town", "fence", RAIL_X, -3, 0, SIDING.half, 4.5, 0.2, false));
  out.push(BOX("engine", "town", "cart", RAIL_X, -2.6, 0, 0.95, 2.5, 3.4), BOX("buffer", "town", "fence", RAIL_X, -7.2, 0, 0.9, 0.25, 1.1), BOX("buffer", "town", "fence", RAIL_X, 1.2, 0, 0.9, 0.25, 1.1));
  out.push(CIRCLE("tank", "town", "well", 19.5, -10.5, 1.2, 6));
  // D-091, the works (latched by a settlement whose priority is extraction, in that region): a brick engine-house north of the gate, west of the road, its chimney
  // rising out of its west gable, and the spoil heap beside it. It stands, as it pays (`worksDay`), while its post is a trading post or better.
  out.push(BOX("works", "trading_post", "house", -5.5, -22.5, 0, 2.2, 1.6, 4.2), CIRCLE("spoil", "trading_post", "ruin", -11, -21, 1.4, 1.2));
  for (const p of out) if (p.kind === "siding" || p.kind === "engine" || p.kind === "buffer" || p.kind === "tank") p.tech = "railway";
  for (const p of out) if (p.kind === "works" || p.kind === "spoil") p.tech = "works";
  // D-092, the crank gun: inside the stockade, north-east of the yard, its barrels trained on the gate (the carriage is the collider; the gun itself is a
  // replicated fixture, drawn and worked like the camp's cannon)
  const gun = CIRCLE("crank", "fortified_outpost", "cannon", CRANK_AT.x, CRANK_AT.z, 1.0, 1.4);   // (round its pivot: the wheels, the short trail and the spare hoppers)
  gun.tech = "crank";
  out.push(gun);
  return out;
}

/** Where the crank gun stands, relative to the site (the gate is at 0, -17). */
const CRANK_AT = { x: 5.5, z: -11.5 } as const;

/** The crank gun's place in `region` and its rest heading (0 = -Z), trained on the middle of the gate. Undefined where the region has no site. */
export function crankSpot(region: RegionId): { x: number; z: number; yaw: number } | undefined {
  const at = OUTPOST_SITES[region];
  if (!at) return undefined;
  return { x: at.site.x + CRANK_AT.x, z: at.site.z + CRANK_AT.z, yaw: Math.atan2(CRANK_AT.x - 0, CRANK_AT.z - -17) };
}

/** The siding's track: the rails stand `gauge` either side of its centre line, on sleepers `half` wide (the piece's hx). */
export const SIDING = { gauge: 0.72, half: 1.1 } as const;
let LOCAL: OutpostPiece[] | undefined;

/**
 * Everything standing at `stage` (cumulative), in world coordinates round the region's foundation site; with `tech`, the industrial age's pieces the post has
 * (D-091: the caller decides where each stands: `regionWorldOpts` and `regionDressOf` only ever ask for the railway at Kessar and the works in its own region).
 */
export function outpostPlan(stage: OutpostStage, region: RegionId = "kessar", tech?: Partial<Record<OutpostTech, boolean>>): OutpostPlan {
  const at = OUTPOST_SITES[region];
  const site = at ? at.site : { x: 0, z: 0 };
  LOCAL ??= localPieces();
  const r = rank(stage);
  const pieces = LOCAL.filter((p) => rank(p.from) <= r && !(p.kind === "stakes" && r > 1) && (p.tech === undefined || tech?.[p.tech] === true)).map((p) => ({ ...p, x: site.x + p.x, z: site.z + p.z }));
  const gate = r >= rank("fortified_outpost") ? { x: site.x, z: site.z - 17 } : undefined;
  return { stage, site, pieces, gate };
}

/** The telegraph's poles: from the foundation along the region's line (Kessar: the south-bank track to the bridge's south abutment), one every ~16 m, set off the road. None where the region has no line. */
export function telegraphPoles(region: RegionId = "kessar"): { x: number; z: number }[] {
  const at = OUTPOST_SITES[region];
  if (!at?.telegraph) return [];
  const path = [at.site, ...at.telegraph];
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 16));
    for (let k = i === 0 ? 1 : 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  out.push(path[path.length - 1]!);
  // the first pole stands outside the yard
  return out.filter((p) => Math.hypot(p.x - at.site.x, p.z - at.site.z) > YARD_R + 2);
}

/**
 * Colliders for `stage` (and the telegraph's poles when `telegraph`): what `createKessarWorld(seed, bridge, { outpost, telegraph })` appends AFTER its own seeded dressing.
 * The yard is free of colliders at every stage, and nothing here draws a random number.
 */
export function outpostObstacles(stage: OutpostStage, telegraph: boolean, terrain: Terrain, region: RegionId = "kessar", tech?: Partial<Record<OutpostTech, boolean>>): Obstacle[] {
  const out: Obstacle[] = [];
  const g = (x: number, z: number): number => terrain.height(x, z);
  for (const p of outpostPlan(stage, region, tech).pieces) {
    if (!p.solid) continue;
    const y = g(p.x, p.z);
    if (p.shape === "circle") out.push({ kind: "circle", tag: p.tag, x: p.x, z: p.z, r: p.hx, y0: y - 1, y1: y + p.height });
    else out.push({ kind: "box", tag: p.tag, x: p.x, z: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw, y0: y - 0.6, y1: y + p.height });
  }
  if (telegraph) for (const q of telegraphPoles(region)) out.push({ kind: "circle", tag: "pole", x: q.x, z: q.z, r: 0.16, y0: g(q.x, q.z) - 1, y1: g(q.x, q.z) + 7 });
  return out;
}

/**
 * The Syndicate's own post (Kessar), as colliders: its flagpole, its board's pole and its tent; at two posts the plank hut and the counter. The view (`outpost.ts` in the client)
 * draws exactly these, at these places and turns; it stood drawn and walk-through (a player could stand inside the Syndicate's hut). Appended after everything else, so a world
 * without the post is the old world, byte for byte. Pure: no randomness.
 */
export function rivalPostObstacles(stage: number, terrain: Terrain, region: RegionId = "kessar"): Obstacle[] {
  const at = OUTPOST_SITES[region]?.rivalSite;
  if (!at || !(stage >= 1)) return [];
  const g = (x: number, z: number): number => terrain.height(x, z);
  const th = CAMP.tentHalf;
  const out: Obstacle[] = [
    { kind: "circle", tag: "pole", x: at.x, z: at.z, r: 0.12, y0: g(at.x, at.z) - 1, y1: g(at.x, at.z) + 5 },
    { kind: "circle", tag: "pole", x: at.x + 2, z: at.z - 3, r: 0.08, y0: g(at.x + 2, at.z - 3) - 1, y1: g(at.x + 2, at.z - 3) + 1.6 },
    { kind: "box", tag: "tent", x: at.x - 5, z: at.z + 2, hx: th.hx, hz: th.hz, yaw: 0.3, y0: g(at.x - 5, at.z + 2) - 0.6, y1: g(at.x - 5, at.z + 2) + th.height },
  ];
  if (stage >= 2) {
    out.push({ kind: "box", tag: "house", x: at.x + 7, z: at.z + 3, hx: 1.7, hz: 1.4, yaw: -0.2, y0: g(at.x + 7, at.z + 3) - 0.6, y1: g(at.x + 7, at.z + 3) + 3 });
    out.push({ kind: "box", tag: "stall", x: at.x + 7, z: at.z - 3, hx: 1.2, hz: 0.55, yaw: 0, y0: g(at.x + 7, at.z - 3) - 0.6, y1: g(at.x + 7, at.z - 3) + 1.1 });
  }
  return out;
}

/**
 * A region's obstacles with its outpost: the seeded scatter (`scatterTags`) is cleared out of the ring and the stage's colliders appended (the same set cleared at every stage
 * above "none", so a stage change moves nothing else). "none" returns `out` untouched: the plain world, byte for byte. Shared by every region with a site (D-056).
 */
export function withOutpost(out: Obstacle[], terrain: Terrain, region: RegionId, opts: { outpost?: OutpostStage; telegraph?: boolean; railway?: boolean; works?: boolean; crank?: boolean } | undefined, scatterTags: readonly ObstacleTag[]): Obstacle[] {
  const stage = opts?.outpost ?? "none";
  if (stage === "none" || !OUTPOST_SITES[region]) return out;
  const kept = out.filter((o) => !((o.tag !== undefined && scatterTags.includes(o.tag)) && inOutpostRing(o.x, o.z, 0, region)));
  return [...kept, ...outpostObstacles(stage, opts?.telegraph === true, terrain, region, { railway: opts?.railway === true, works: opts?.works === true, crank: opts?.crank === true })];
}

/**
 * The road (Kessar; D-035's levels): a ribbon of road paint up the middle of the post, out through the stockade's gate and north to the south-bank track that
 * runs west to the bridge and the landing (level 1), widened at level 2. A ground overlay, never a collider. (D-091: it used to run south-west under the
 * stockade's wall, a hut and a town house to the landing, and at level 2 north-west under the wall again and through another house.)
 */
export function outpostRoad(level: 0 | 1 | 2): { path: { x: number; z: number }[]; half: number } | undefined {
  if (level === 0) return undefined;
  const S = KESSAR_OUTPOST.site;
  return { path: [{ x: S.x, z: S.z - 4.6 }, { x: S.x, z: S.z - 35.5 }], half: level >= 2 ? 1.7 : 1.1 };
}

/** The foundation's footprint, for the scatter keep-out (kessar.ts) and anything that must stay clear of the site at every stage. */
export function inOutpostRing(x: number, z: number, margin = 0, region: RegionId = "kessar"): boolean {
  const at = OUTPOST_SITES[region];
  return !!at && Math.hypot(x - at.site.x, z - at.site.z) < RING_R + margin;
}
