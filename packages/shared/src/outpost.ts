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
  kessar: { site: { x: 30, z: 72 }, rivalSite: { x: 69, z: 62 }, telegraph: [{ x: 8, z: 60 }, { x: 5, z: 44 }, { x: 4.4, z: 33 }] },
  highmark: { site: { x: -52, z: 98 }, rivalSite: { x: -89, z: 108 } },
};
/** The regions a party can found a post in. */
export const OUTPOST_REGIONS = Object.keys(OUTPOST_SITES) as RegionId[];
/** Kessar's, for the callers that only ever ask about Kessar. */
export const KESSAR_OUTPOST = OUTPOST_SITES.kessar!;

export type OutpostPieceKind =
  | "tent" | "fire" | "hut" | "stall" | "rail" | "well" | "palisade" | "post" | "tower" | "house" | "mill" | "hall" | "bell" | "clock" | "wall" | "stakes" | "sign";

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
  // trading post: a plank hut, a counter, a hitching rail, a well
  out.push(BOX("hut", "trading_post", "house", 10, -9, 0.1, 1.9, 1.5, 3), BOX("stall", "trading_post", "stall", 9, 7, 0, 1.2, 0.6, 1.2), BOX("rail", "trading_post", "fence", 13, -1, 1.5708, 0.9, 0.12, 1.1), CIRCLE("well", "trading_post", "well", -4, 10, 0.8, 1));
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
  // settlement: huts beyond the stockade, a mill, a market hall, the jetty bell post
  for (const [x, z, yaw] of [[-23, -12, 0.2], [-24, 2, -0.1], [24, -10, 0.3], [24, 4, 0], [-15, 14, 0.1]] as const) out.push(BOX("house", "settlement", "house", x, z, yaw, 2, 1.6, 3));
  out.push(CIRCLE("mill", "settlement", "ruin", -27, -4, 2.2, 8), BOX("hall", "settlement", "house", 15, -23, 0, 3.2, 2, 4.2), CIRCLE("bell", "settlement", "pole", -9, 15, 0.2, 3));
  // town: stone houses, a clock tower, a partial wall
  for (const [x, z, yaw] of [[-22, -16, 0.1], [22, -16, -0.2], [-17, -22, 0], [24, 12, 0.1], [-24, 10, 0.3]] as const) out.push(BOX("house", "town", "house", x, z, yaw, 2.4, 2, 5));
  out.push(CIRCLE("clock", "town", "ruin", 9, -27, 1.6, 10));
  for (const [x, z, yaw] of [[-11, -26.5, 0], [28, -3, Math.PI / 2]] as const) out.push(BOX("wall", "town", "wall", x, z, yaw, 2.5, 0.35, 2.4));
  return out;
}
let LOCAL: OutpostPiece[] | undefined;

/** Everything standing at `stage` (cumulative), in world coordinates round the region's foundation site. */
export function outpostPlan(stage: OutpostStage, region: RegionId = "kessar"): OutpostPlan {
  const at = OUTPOST_SITES[region];
  const site = at ? at.site : { x: 0, z: 0 };
  LOCAL ??= localPieces();
  const r = rank(stage);
  const pieces = LOCAL.filter((p) => rank(p.from) <= r && !(p.kind === "stakes" && r > 1)).map((p) => ({ ...p, x: site.x + p.x, z: site.z + p.z }));
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
export function outpostObstacles(stage: OutpostStage, telegraph: boolean, terrain: Terrain, region: RegionId = "kessar"): Obstacle[] {
  const out: Obstacle[] = [];
  const g = (x: number, z: number): number => terrain.height(x, z);
  for (const p of outpostPlan(stage, region).pieces) {
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
export function withOutpost(out: Obstacle[], terrain: Terrain, region: RegionId, opts: { outpost?: OutpostStage; telegraph?: boolean } | undefined, scatterTags: readonly ObstacleTag[]): Obstacle[] {
  const stage = opts?.outpost ?? "none";
  if (stage === "none" || !OUTPOST_SITES[region]) return out;
  const kept = out.filter((o) => !((o.tag !== undefined && scatterTags.includes(o.tag)) && inOutpostRing(o.x, o.z, 0, region)));
  return [...kept, ...outpostObstacles(stage, opts?.telegraph === true, terrain, region)];
}

/** The foundation's footprint, for the scatter keep-out (kessar.ts) and anything that must stay clear of the site at every stage. */
export function inOutpostRing(x: number, z: number, margin = 0, region: RegionId = "kessar"): boolean {
  const at = OUTPOST_SITES[region];
  return !!at && Math.hypot(x - at.site.x, z - at.site.z) < RING_R + margin;
}
