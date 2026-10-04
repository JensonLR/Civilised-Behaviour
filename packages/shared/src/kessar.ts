import { ARRIVAL_INLAND } from "./campaignTypes.ts";
import { CollisionWorld, type Obstacle } from "./collision.ts";
import { KESSAR_ANCHORS as A, KESSAR_SITES as SITES, type BridgeState } from "./campaignTypes.ts";
import { segmentDistance } from "./landscape.ts";
import { lerp, smoothstep } from "./math.ts";
import { propRadius } from "./levelAudit.ts";
import { levelOf, planBuilding, roomObstacles, type LevelBuilding, type RegionLevel } from "./levelPlan.ts";
import { PropKind, type PropSpawn } from "./props.ts";
import { Rng } from "./rng.ts";
import { createTerrain, type Terrain } from "./terrain.ts";
import { withOutpost } from "./outpost.ts";
import type { OutpostStage } from "./worldTypes.ts";

/**
 * KESSAR REACH, region 1: the authored plan (ONE pure description the terrain, the colliders, the props and the client's geometry all read, like
 * village.ts). A sun-bleached coast (the landing and its pier on the south shore), a road north to a stone bridge over a gorge, the Ward's toll
 * bar on the north abutment, a shallow ford downstream, and behind the crossing a sandstone hill-capital with a curtain wall, round towers, a
 * gatehouse and a keep. The Syndicate's camp sits by the road, the Society's powder cart on the south bank.
 * Metres; x east, z south; yaw is the collision convention (local +x = (cos yaw, sin yaw)). Fictional cultures only: nine lamps and chevrons,
 * Latin-letter signage, pyramid and flat roofs, no domes, minarets or scripts.
 * Everything is deterministic; only the ground swell and the scrub depend on the seed.
 */

export const KESSAR = {
  /** Bank and deck level (every abutment is pinned to it, so the deck needs no ramp). */
  level: 0.5,
  /** The gorge: bed below the bank at the bridge, and at the ford. */
  gorgeDepth: 4.2,
  fordDepth: 0.9,
  /** Horizontal run of the gorge wall (steeper than the movement step's slope limit wherever the gorge is deep: a wall, not an invisible wall). */
  wallRun: 2.0,
  fordX: 46,
  /** Water above the bed. */
  waterDepth: 0.7,
  seaLevel: -0.3,
  seabed: -0.95,
  hillRise: 10,
  hillPlateau: 16,
  hillRadius: 34,
  wallHeight: 7.5,
  deckHalf: 3.6,
  parapetHeight: 1.15,
  /** The rim wall along the gorge: the movement step's slope limit is per direction (a diagonal climbs anything), so the gorge is fenced by a real wall. */
  rimHeight: 1.6,
  rimHalf: 0.3,
} as const;

// ---- the river -------------------------------------------------------------------------------------------------------------------------

/** Centreline z of the river at x: straight at the bridge, meandering downstream. */
export function kessarRiverZ(x: number): number {
  return A.river.z + 1.6 * Math.sin(x * 0.04) * smoothstep(10, 30, Math.abs(x));
}

/** Half-width of the channel at x: 4.4 at the bridge, 9 at the ford and beyond (A.river.halfWidth). */
export function kessarRiverHalf(x: number): number {
  return 4.4 + (A.river.halfWidth - 4.4) * smoothstep(12, 40, Math.abs(x));
}

/**
 * Horizontal run of the gorge wall at x. Under the bridge it is a long, walkable ramp (the controller's slope check reads the TERRAIN, so a deck over a
 * steep bank would be a wall to a walker), shrinking to a cliff a few metres either side of the deck.
 */
export function kessarWallRun(x: number): number {
  return lerp(5.6, KESSAR.wallRun, smoothstep(3.4, 6, Math.abs(x)));
}

/** Depth of the bed below the banks at x: a gorge everywhere but the ford. */
export function kessarRiverDepth(x: number): number {
  return lerp(KESSAR.gorgeDepth, KESSAR.fordDepth, 1 - smoothstep(10, 18, Math.abs(x - KESSAR.fordX)));
}

/** Water surface height at x (the bed plus a wade). */
export function kessarWaterY(x: number): number {
  return KESSAR.level - kessarRiverDepth(x) + KESSAR.waterDepth;
}

const SHORE_Z = 96;

export interface KessarTerrain extends Terrain {
  /** Depth of standing water (river or sea) above the ground at (x, z), metres; 0 on dry land. */
  waterDepth(x: number, z: number): number;
}

const disc = (x: number, z: number, cx: number, cz: number, r: number, blend: number): number => 1 - smoothstep(r, r + blend, Math.hypot(x - cx, z - cz));

/** The ground: a low swell pinned flat at the river, the customs yard, the landing and the camp; the hill; the gorge; the shelving sea. Pure. */
export function createKessarTerrain(seed: number): KessarTerrain {
  const base = createTerrain(seed, { amplitude: 2.6, wavelength: 52, flatRadius: 0, blend: 1 });
  const L = KESSAR.level;
  const F = A.fort;
  const height = (x: number, z: number): number => {
    let h = base.height(x, z);
    const zc = kessarRiverZ(x);
    const ad = Math.abs(z - zc);
    const w = kessarRiverHalf(x);
    const run = kessarWallRun(x);
    const reach = w + run;
    let flat = 1 - smoothstep(reach + 1, reach + 16, ad);
    flat = Math.max(flat, disc(x, z, 0, 6, 12, 14), disc(x, z, A.landing.x, A.landing.z, 9, 9), disc(x, z, A.rivalCamp.x, A.rivalCamp.z, 9, 9), disc(x, z, A.powder.x, A.powder.z, 7, 8));
    h += (L - h) * flat;
    const hd = Math.hypot(x - F.x, z - F.z);
    if (hd < KESSAR.hillRadius) h += (L + KESSAR.hillRise - h) * (1 - smoothstep(KESSAR.hillPlateau, KESSAR.hillRadius, hd));
    if (ad < reach) {
      const t = ad <= w ? 0 : (ad - w) / run;
      h -= kessarRiverDepth(x) * (1 - smoothstep(0, 1, t));
    }
    if (z > SHORE_Z) h += (KESSAR.seabed - h) * smoothstep(SHORE_Z, SHORE_Z + 10, z);
    return h;
  };
  const waterDepth = (x: number, z: number): number => {
    const h = height(x, z);
    let d = 0;
    if (z > SHORE_Z - 4) d = KESSAR.seaLevel - h;
    if (Math.abs(z - kessarRiverZ(x)) < kessarRiverHalf(x) + kessarWallRun(x)) d = Math.max(d, kessarWaterY(x) - h);
    return d > 0 ? d : 0;
  };
  return { height, waterDepth };
}

// ---- roads -----------------------------------------------------------------------------------------------------------------------------

const ROADS: readonly (readonly number[])[] = [
  [0, 100, 0, 31],
  [0, 9, 0, -26],
  [0, -26, 0, -34],
  [0, 74, -20, 60, -34, 52],
  [0, 38, 24, 37, 46, 35],
];

/** 0..1 closeness to a worn track: landing -> bridge -> the fort's gate, a branch to the Syndicate's camp, another along the south bank to the ford. */
export function kessarRoad(x: number, z: number): number {
  let best = 0;
  for (const r of ROADS) {
    for (let i = 0; i + 3 < r.length; i += 2) {
      const d = segmentDistance(x, z, r[i]!, r[i + 1]!, r[i + 2]!, r[i + 3]!);
      const v = 1 - smoothstep(1.3, 2.8, d);
      if (v > best) best = v;
    }
  }
  return best;
}

// ---- the plan --------------------------------------------------------------------------------------------------------------------------

export interface WallSeg {
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
}
export interface KessarBox {
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
  /** Height above the ground at its centre. */
  height: number;
}
export interface KessarBanner {
  x: number;
  z: number;
  /** Faces the direction (cos yaw, sin yaw). */
  yaw: number;
  /** Top edge above the ground, width, drop. */
  top: number;
  w: number;
  h: number;
  kind: "ward" | "syndicate" | "society";
}
export interface KessarSign {
  x: number;
  z: number;
  yaw: number;
  /** Index into KESSAR_SIGNS. */
  text: number;
}

export const KESSAR_SIGNS = [
  "TOLL BAR: ALL CROSSINGS ARE EXCEPTIONAL",
  "MIND THE EDGE AND THE FEE",
  "THE FORD (WET, UNLICENSED, UNAPPROVED)",
  "SOCIETY LANDING: HAVE FORM 7 READY",
  "SYNDICATE SURVEY IN PROGRESS. GO AWAY.",
  "THE GATE OPENS WHEN THE LAMPS AGREE",
] as const;

export interface KessarSites {
  camp: { wagon: { x: number; z: number; yaw: number }; tents: { x: number; z: number; yaw: number }[]; fire: { x: number; z: number }; posts: { x: number; z: number }[]; flag: { x: number; z: number } };
  /** The Dry Cut: where the convoy's wagon is wrecked if it burns, and the Syndicate's keg lies. */
  cut: { x: number; z: number; yaw: number; keg: { x: number; z: number } };
  /** Marker Stone No. 4 stands IN the ford, a flag on each bank. */
  ford: { marker: { x: number; z: number }; flags: { x: number; z: number; yaw: number; kind: "ward" | "syndicate" }[] };
}

export interface KessarPlan {
  fort: {
    x: number;
    z: number;
    wallR: number;
    wall: WallSeg[];
    towers: { x: number; z: number; r: number; height: number }[];
    bastions: KessarBox[];
    door: KessarBox;
    keep: KessarBox;
    halls: KessarBox[];
    cannons: { x: number; z: number; yaw: number }[];
  };
  bridge: { x: number; z0: number; z1: number; piers: { x: number; z: number; r: number }[] };
  /** The rim wall along both lips of the gorge (none at the bridge or the ford), and the two broken abutment stubs that seal the gap when the span is down. */
  rim: WallSeg[];
  stubs: WallSeg[];
  toll: { posts: { x: number; z: number }[]; booth: KessarBox; desk: KessarBox };
  pier: { x: number; z0: number; z1: number; half: number };
  boat: { x: number; z: number; yaw: number };
  camp: { tents: { x: number; z: number; yaw: number }[]; wagon: { x: number; z: number; yaw: number }; flag: { x: number; z: number }; crates: { x: number; z: number; yaw: number; half: number; height: number }[] };
  cart: { x: number; z: number; yaw: number };
  /** The three newer sites (D-034): the deserters' camp at Hangman's Orchard, the Dry Cut, and Marker Stone No. 4 in the ford. Additive; nothing above moved. */
  sites: KessarSites;
  banners: KessarBanner[];
  signs: KessarSign[];
  palms: { x: number; z: number; s: number; yaw: number }[];
}

let cached: KessarPlan | undefined;

export function kessarPlan(): KessarPlan {
  if (cached) return cached;
  const F = A.fort;
  const R = F.wallRadius;
  const N = 24;
  const at = (i: number): { x: number; z: number; th: number } => {
    const th = Math.PI / 2 + (i * Math.PI * 2) / N;
    return { x: F.x + Math.cos(th) * R, z: F.z + Math.sin(th) * R, th };
  };
  const chord = 2 * R * Math.sin(Math.PI / N);
  const wall: WallSeg[] = [];
  for (let i = 2; i <= N - 2; i++) {
    const p = at(i);
    wall.push({ x: p.x, z: p.z, yaw: p.th + Math.PI / 2, hx: chord / 2 + 0.35, hz: 1 });
  }
  const towers = [3, 9, 15, 21].map((i) => {
    const p = at(i);
    return { x: p.x, z: p.z, r: 3.2, height: 12 };
  });
  const bastions: KessarBox[] = [1, N - 1].map((i) => {
    const p = at(i);
    return { x: p.x, z: p.z, yaw: p.th + Math.PI / 2, hx: 2.6, hz: 2.6, height: 10 };
  });
  const gate0 = at(0);
  const door: KessarBox = { x: gate0.x, z: gate0.z, yaw: 0, hx: 3.0, hz: 0.6, height: 5 };
  const keep: KessarBox = { x: F.x, z: F.z - 6, yaw: 0, hx: 6.5, hz: 6, height: 16 };
  const halls: KessarBox[] = [
    { x: F.x - 12, z: F.z + 2, yaw: 0, hx: 4, hz: 2.6, height: 5 },
    { x: F.x + 12, z: F.z + 2, yaw: 0, hx: 4, hz: 2.6, height: 6 },
    { x: F.x, z: F.z + 11, yaw: 0, hx: 3.4, hz: 3, height: 4.4 },
  ];
  const cannons = [6, 8, 16, 18].map((i) => {
    const p = at(i);
    return { x: F.x + Math.cos(p.th) * (R - 0.4), z: F.z + Math.sin(p.th) * (R - 0.4), yaw: p.th };
  });
  const bx = A.bridge.x;
  const z0 = A.bridge.z - A.bridge.length / 2;
  const z1 = A.bridge.z + A.bridge.length / 2;
  const banners: KessarBanner[] = [
    // (flat on each bastion's outer face, which faces out from the fort's centre: a banner square to the road would cut into one corner of it and stand off the other)
    ...bastions.map((b): KessarBanner => {
      const th = Math.atan2(b.z - F.z, b.x - F.x);
      return { x: b.x + Math.cos(th) * (b.hz + 0.06), z: b.z + Math.sin(th) * (b.hz + 0.06), yaw: th, top: 9, w: 2.2, h: 4.4, kind: "ward" };
    }),
    { x: keep.x, z: keep.z + keep.hz + 0.08, yaw: Math.PI / 2, top: 15, w: 3.4, h: 6.5, kind: "ward" },
    ...towers.map((t): KessarBanner => {
      const th = Math.atan2(t.z - F.z, t.x - F.x);
      return { x: t.x + Math.cos(th) * (t.r + 0.06), z: t.z + Math.sin(th) * (t.r + 0.06), yaw: th, top: t.height - 0.8, w: 1.5, h: 3.2, kind: "ward" };
    }),
    { x: bx + 5.2, z: A.tollBar.z - 1.2, yaw: Math.PI / 2, top: 4.6, w: 1.6, h: 2.8, kind: "ward" },
    { x: -34 + 3.2, z: A.rivalCamp.z - 2.4, yaw: Math.PI / 2, top: 5.6, w: 1.8, h: 3, kind: "syndicate" },
    { x: 4.4, z: A.landing.z - 1.6, yaw: Math.PI / 2, top: 4.6, w: 1.5, h: 2.6, kind: "society" },
  ];
  const signs: KessarSign[] = [
    { x: -3.5, z: 5.6, yaw: Math.PI / 2, text: 0 },
    { x: 4.6, z: 33.2, yaw: Math.PI / 2, text: 1 },
    { x: 37.5, z: 35, yaw: Math.PI / 2, text: 2 },
    { x: -4.4, z: 85.8, yaw: Math.PI / 2, text: 3 },
    { x: -38.5, z: 58, yaw: Math.PI / 2, text: 4 },
    { x: 4.6, z: -30.5, yaw: Math.PI / 2, text: 5 },
  ];
  // palms: a fringe on the shore, a few at the river's edge and round the Syndicate's camp (authored; no seed)
  const palms: KessarPlan["palms"] = [];
  const spots: [number, number][] = [
    [-9, 92], [-13, 86], [9.5, 90.5], [14, 84], [-22, 94], [24, 93], [-31, 91], [33, 88],
    [-44, 47], [-24, 44], [-33, 60], [-42, 57],
    [-16, 36.5], [18, 36], [26, 38.5], [56, 35], [62, 37],
    [14, 6], [-16, 4],
  ];
  spots.forEach(([x, z], i) => palms.push({ x, z, s: 0.85 + ((i * 37) % 10) / 30, yaw: (i * 2.399) % (Math.PI * 2) }));
  const rim: WallSeg[] = [];
  const lip = (x: number, side: number): { x: number; z: number } => ({ x, z: kessarRiverZ(x) + side * (kessarRiverHalf(x) + kessarWallRun(x) + 0.15 + KESSAR.rimHalf) });
  for (const side of [-1, 1]) {
    for (let x = -124; x < 124; ) {
      const step = Math.abs(x) < 16 ? 1 : 4;
      const a = lip(x, side);
      const b = lip(x + step, side);
      x += step;
      const mx = (a.x + b.x) / 2;
      if (Math.abs(mx) < 3.7 || Math.abs(mx - KESSAR.fordX) < 13.5 || Math.hypot(a.x, a.z) > A.bounds + 10) continue;
      rim.push({ x: mx, z: (a.z + b.z) / 2, yaw: Math.atan2(b.z - a.z, b.x - a.x), hx: Math.hypot(b.x - a.x, b.z - a.z) / 2 + 0.3, hz: KESSAR.rimHalf });
    }
  }
  const stubs: WallSeg[] = [-1, 1].map((side) => ({ x: bx, z: lip(bx, side).z, yaw: 0, hx: 4.2, hz: KESSAR.rimHalf }));
  cached = {
    fort: { x: F.x, z: F.z, wallR: R, wall, towers, bastions, door, keep, halls, cannons },
    bridge: { x: bx, z0, z1, piers: [{ x: bx - 2.1, z: A.bridge.z, r: 0.9 }, { x: bx + 2.1, z: A.bridge.z, r: 0.9 }] },
    rim,
    stubs,
    toll: {
      posts: [{ x: bx - 3.9, z: 7 }, { x: bx + 3.9, z: 7 }],
      // (D-038: the toll booth is the region's one walkable interior, 4.8 x 4.0, its door facing the customs yard; nudged 2.8 m from (-6.6, 6.4) to keep the sentries' posts and the parley spot clear of it)
      booth: { x: -8.8, z: 4.6, yaw: 0, hx: 2.4, hz: 2.0, height: 3.6 },
      desk: { x: 5.4, z: 5.0, yaw: 0.2, hx: 0.8, hz: 0.5, height: 0.9 },
    },
    pier: { x: A.landing.x, z0: SHORE_Z - 4, z1: SHORE_Z + 16, half: 1.6 },
    boat: { x: 4.6, z: SHORE_Z + 9, yaw: 0 },
    camp: {
      tents: [
        { x: -38, z: 49, yaw: 0.3 },
        { x: -29, z: 46.5, yaw: -0.25 },
        { x: -36, z: 55.5, yaw: 0.1 },
      ],
      // (D-038: the wagon moved 3.5 m north, off the worn track into the camp, which it narrowed to a squeeze)
      wagon: { x: -26, z: 50.4, yaw: -0.5 },
      flag: { x: -31, z: 50 },
      crates: [
        { x: -32.5, z: 55.5, yaw: 0.4, half: 0.45, height: 0.8 },
        { x: -31.6, z: 56.6, yaw: -0.3, half: 0.4, height: 0.6 },
      ],
    },
    cart: { x: 14, z: 44, yaw: 0.35 },
    sites: {
      camp: {
        // the cage wagon stands behind the cage point (KESSAR_SITES.hostage.cage is its door); three tents round a fire; posts are where the deserters carouse
        wagon: { x: SITES.hostage.cage.x, z: SITES.hostage.cage.z - 2.4, yaw: 0 },
        tents: [{ x: 62.5, z: -20.5, yaw: 0.35 }, { x: 81, z: -22.5, yaw: -0.3 }, { x: 72, z: -31.5, yaw: 0.1 }],
        fire: { x: 71.5, z: -25.5 },
        posts: SITES.hostage.posts.map((p) => ({ x: p.x, z: p.z })),
        flag: { x: 69, z: -12 },
      },
      cut: { x: SITES.convoy.cut.x, z: SITES.convoy.cut.z, yaw: Math.atan2(32 - 37, 46 - 24), keg: { x: SITES.convoy.cut.x + 2.4, z: SITES.convoy.cut.z - 2.6 } },
      ford: {
        marker: { x: SITES.border.marker.x, z: SITES.border.marker.z },
        flags: [{ x: 52, z: 10, yaw: Math.PI / 2, kind: "ward" }, { x: 39, z: 32, yaw: -Math.PI / 2, kind: "syndicate" }],
      },
    },
    banners,
    signs,
    palms,
  };
  return cached;
}

// ---- the level plan (D-038; docs/LEVEL_PLAN.md section 7) -----------------------------------------------------------------------------------

/**
 * What every building of Kessar IS. The toll booth is the one walkable room (the reward beside the set-piece); the fort's gate is `sealed` (the portcullis is down and chained, the Ward's paper seal across it:
 * the gate "opens when the lamps agree"); the two bastions are `solid`; every tent is `tent` (its flap tied shut, a bedroll or a boot outside). The keep and the halls inside the curtain are drawn only (no collision,
 * not reachable): they are backdrop and are not listed.
 */
let cachedLevel: RegionLevel | undefined;
export function kessarLevel(): RegionLevel {
  if (cachedLevel) return cachedLevel;
  const p = kessarPlan();
  const bo = p.toll.booth;
  const bx = (b: KessarBox): { x: number; z: number; yaw: number; hx: number; hz: number } => ({ x: b.x, z: b.z, yaw: b.yaw, hx: b.hx, hz: b.hz });
  const g = p.fort.door;
  const buildings: LevelBuilding[] = [
    planBuilding("toll.booth", "interior", bx(bo), { height: bo.height, floor: 0.2, wallH: 2.6 }),
    // the gate: a wall box 6 wide and 1.2 thick facing south; its door is the sealed portcullis (3.6 clear, a wagon's width)
    planBuilding("fort.gate", "sealed", { x: g.x, z: g.z, yaw: Math.PI / 2, hx: g.hz, hz: g.hx }, { height: g.height, floor: 0, wallH: g.height, door: 3.6, doorH: 3.4, wide: true, sign: KESSAR_SIGNS[5] }),
    ...p.fort.bastions.map((b, i) => planBuilding(`fort.bastion${i}`, "solid", bx(b), { height: b.height, floor: 0, wallH: b.height })),
    ...p.camp.tents.map((t, i) => planBuilding(`syndicate.tent${i}`, "tent", { x: t.x, z: t.z, yaw: t.yaw, hx: 2, hz: 1.6 }, { height: 2.4, floor: 0, wallH: 2.4 })),
    ...p.sites.camp.tents.map((t, i) => planBuilding(`orchard.tent${i}`, "tent", { x: t.x, z: t.z, yaw: t.yaw, hx: 2, hz: 1.6 }, { height: 2.4, floor: 0, wallH: 2.4 })),
  ];
  cachedLevel = levelOf(buildings);
  return cachedLevel;
}

// ---- colliders -------------------------------------------------------------------------------------------------------------------------

const ROCK_TAG = "rock" as const;

/**
 * Everything solid in Kessar. The bridge follows `bridge`: intact and rigged are the same walkable deck; collapsed has NO deck and no parapets
 * (whoever stood on it falls to the bed) but keeps the pier stumps, and rubble lies in the water. Appended with its own random streams so a
 * collapsed world differs from an intact one ONLY at the bridge.
 */
export function kessarObstacles(terrain: Terrain, seed: number, bridge: BridgeState, opts?: { outpost?: OutpostStage; telegraph?: boolean }): Obstacle[] {
  const plan = kessarPlan();
  const g = (x: number, z: number): number => terrain.height(x, z);
  const out: Obstacle[] = [];
  const box = (tag: Obstacle["tag"], x: number, z: number, hx: number, hz: number, yaw: number, h: number, y0 = -1): void => {
    const y = g(x, z);
    out.push({ kind: "box", tag, x, z, hx, hz, yaw, y0: y + y0, y1: y + h });
  };
  const circle = (tag: Obstacle["tag"], x: number, z: number, r: number, h: number): void => {
    const y = g(x, z);
    out.push({ kind: "circle", tag, x, z, r, y0: y - 1, y1: y + h });
  };
  const L = KESSAR.level;

  // the bridge
  const b = plan.bridge;
  const zMid = (b.z0 + b.z1) / 2;
  const hz = (b.z1 - b.z0) / 2;
  const bed = L - KESSAR.gorgeDepth;
  if (bridge !== "collapsed") {
    out.push({ kind: "box", tag: "bridge", x: b.x, z: zMid, hx: KESSAR.deckHalf, hz, yaw: 0, y0: L - 0.8, y1: L });
    for (const s of [-1, 1]) out.push({ kind: "box", tag: "wall", x: b.x + s * (KESSAR.deckHalf + 0.3), z: zMid, hx: 0.3, hz, yaw: 0, y0: L - 0.8, y1: L + KESSAR.parapetHeight });
    for (const p of b.piers) out.push({ kind: "circle", tag: "bridge", x: p.x, z: p.z, r: p.r, y0: bed - 1, y1: L - 0.8 });
  } else {
    for (const p of b.piers) out.push({ kind: "circle", tag: "bridge", x: p.x, z: p.z, r: p.r, y0: bed - 1, y1: L - 2.4 });
    const rub = new Rng(seed ^ 0x4b17ab1e);
    for (let i = 0; i < 7; i++) {
      const x = b.x + rub.range(-4.5, 4.5);
      const z = A.bridge.z + rub.range(-4.5, 4.5);
      if (b.piers.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 1.3)) continue;
      const r = rub.range(0.5, 1.1);
      out.push({ kind: "circle", tag: ROCK_TAG, x, z, r, y0: bed - 1, y1: bed + r * 1.4 });
    }
  }

  // the rim wall along the gorge (and, once the span is down, the broken abutments that close the gap)
  const rimY0 = L - KESSAR.gorgeDepth - 1;
  for (const w of [...plan.rim, ...(bridge === "collapsed" ? plan.stubs : [])]) out.push({ kind: "box", tag: "wall", x: w.x, z: w.z, hx: w.hx, hz: w.hz, yaw: w.yaw, y0: rimY0, y1: L + KESSAR.rimHeight });

  // the toll station
  for (const p of plan.toll.posts) circle("pole", p.x, p.z, 0.22, 2.7);
  for (const b of kessarLevel().buildings) if (b.id === "toll.booth") out.push(...roomObstacles(b, g(b.x, b.z)));
  const de = plan.toll.desk;
  box("stall", de.x, de.z, de.hx, de.hz, de.yaw, de.height);
  for (const s of plan.signs) circle("sign", s.x, s.z, 0.12, 2);

  // the fort: curtain wall, towers, gatehouse. Sealed (the courtyard is scenery this slice), so the wall is a true wall.
  const f = plan.fort;
  for (const w of f.wall) box("wall", w.x, w.z, w.hx, w.hz, w.yaw, KESSAR.wallHeight);
  for (const t of f.towers) circle("ruin", t.x, t.z, t.r, t.height);
  for (const t of f.bastions) box("house", t.x, t.z, t.hx, t.hz, t.yaw, t.height);
  box("wall", f.door.x, f.door.z, f.door.hx, f.door.hz, f.door.yaw, f.door.height);

  // the Syndicate's camp and the Society's powder cart
  for (const t of plan.camp.tents) box("tent", t.x, t.z, 2, 1.6, t.yaw, 2.4);
  box("cart", plan.camp.wagon.x, plan.camp.wagon.z, 1.45, 0.95, plan.camp.wagon.yaw, 2);
  circle("flag", plan.camp.flag.x, plan.camp.flag.z, 0.16, 6);
  for (const c of plan.camp.crates) box("crate", c.x, c.z, c.half, c.half, c.yaw, c.height);
  box("cart", plan.cart.x, plan.cart.z, 1.45, 0.95, plan.cart.yaw, 2);

  // the landing: a plank pier over the wading water (walkable: its top is the bank level), bollards, a moored boat (not solid)
  const pr = plan.pier;
  out.push({ kind: "box", tag: "jetty", x: pr.x, z: (pr.z0 + pr.z1) / 2, hx: pr.half, hz: (pr.z1 - pr.z0) / 2, yaw: 0, y0: KESSAR.seabed - 1, y1: L });

  // palms
  for (const p of plan.palms) circle("pole", p.x, p.z, 0.3, 7.5 * p.s);

  // the three newer sites (D-034): a cage wagon, three tents and a fire at Hangman's Orchard; Marker Stone No. 4 and a flag each side of the ford.
  // Appended with no random draws at all, so the seeded dressing below differs only where it must keep clear of them.
  const sc = plan.sites.camp;
  box("cart", sc.wagon.x, sc.wagon.z, 1.45, 0.95, sc.wagon.yaw, 2.2);
  for (const t of sc.tents) box("tent", t.x, t.z, 2, 1.6, t.yaw, 2.4);
  circle("flag", sc.flag.x, sc.flag.z, 0.16, 5);
  circle("fire", sc.fire.x, sc.fire.z, 0.55, 0.5);
  circle("ruin", plan.sites.ford.marker.x, plan.sites.ford.marker.z, 0.45, 1.5);
  for (const f of plan.sites.ford.flags) circle("flag", f.x, f.z, 0.16, 5);

  // seeded dressing: scrub trees, boulders and outcrops, kept off the roads, the river, the hill, the shore and every story anchor
  const anchors: [number, number][] = [
    [A.landing.x, A.landing.z], [A.tollBar.x, A.tollBar.z], [A.wardenPost.x, A.wardenPost.z], [A.pier.x, A.pier.z], ...A.sentries.map((s): [number, number] => [s.x, s.z]),
    [A.ford.x, A.ford.z], [A.fort.gate.x, A.fort.gate.z], [A.rivalCamp.x, A.rivalCamp.z], [A.rivalParley.x, A.rivalParley.z], [A.powder.x, A.powder.z],
    ...kessarSitePoints().map((p): [number, number] => [p.x, p.z]),
  ];
  const rng = new Rng(seed ^ 0x6b355a7);
  const free = (x: number, z: number, gap: number): boolean => {
    if (Math.hypot(x, z) > A.bounds - 6) return false;
    if (z > SHORE_Z - 3) return false;
    if (Math.abs(z - kessarRiverZ(x)) < kessarRiverHalf(x) + kessarWallRun(x) + 3) return false;
    if (Math.hypot(x - A.fort.x, z - A.fort.z) < KESSAR.hillRadius + 1) return false;
    if (kessarRoad(x, z) > 0.02) return false;
    for (const [ax, az] of anchors) if (Math.hypot(ax - x, az - z) < 5 + gap) return false;
    if (Math.abs(x) < 14 && z > -2 && z < 12) return false; // the customs yard stays open
    for (const o of out) {
      const r = (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + gap;
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < r * r) return false;
    }
    return true;
  };
  for (let i = 0, tries = 0; i < 34 && tries < 600; tries++) {
    const x = rng.range(-A.bounds + 8, A.bounds - 8);
    const z = rng.range(-A.bounds + 8, SHORE_Z - 6);
    if (!free(x, z, 2.2)) continue;
    const y = g(x, z);
    out.push({ kind: "circle", tag: "tree", x, z, r: rng.range(0.28, 0.45), y0: y - 1, y1: y + rng.range(5.2, 6.4) });
    i++;
  }
  for (let k = 0, tries = 0; k < 14 && tries < 400; tries++) {
    const cx = rng.range(-A.bounds + 10, A.bounds - 10);
    const cz = rng.range(-A.bounds + 10, SHORE_Z - 8);
    if (!free(cx, cz, 1.6)) continue;
    const r0 = rng.range(1.3, 2.1);
    if (!free(cx, cz, 1.6 + r0 * 0.6)) continue;   // (D-038: a boulder's own radius counts, or it sinks into a neighbour)
    const y = g(cx, cz);
    out.push({ kind: "circle", tag: ROCK_TAG, x: cx, z: cz, r: r0, y0: y - 1.2, y1: y + r0 * 1.4 });
    for (let j = 0, n = rng.int(2, 4), t2 = 0; j < n && t2 < 20; t2++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(2, 4.2);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (!free(x, z, 0.3)) continue;
      const r = rng.range(0.5, 1.1);
      if (!free(x, z, 0.3 + r)) continue;
      const yy = g(x, z);
      out.push({ kind: "circle", tag: ROCK_TAG, x, z, r, y0: yy - 1.2, y1: yy + r * 1.4 });
      j++;
    }
    k++;
  }
  // D-035: the Society's outpost. The seeded dressing above is computed exactly as before at EVERY stage; a stage above "none" then clears the scatter out of the outpost's
  // ring (the same set at every stage, so a stage change moves nothing else) and appends its own colliders, which draw no random numbers. "none" is today's world, byte for byte.
  return withOutpost(out, terrain, "kessar", opts, ["tree", ROCK_TAG]);
}

/** Every story point of the newer sites, named (the dressing keeps clear of them and the tests prove each is open and reachable). */
export function kessarSitePoints(): { id: string; x: number; z: number }[] {
  const H = SITES.hostage, C = SITES.convoy, B = SITES.border;
  return [
    { id: "hostage.cage", ...H.cage }, ...H.posts.map((p, i) => ({ id: `hostage.post${i}`, ...p })), { id: "hostage.lookout", ...H.lookout },
    ...C.route.map((p, i) => ({ id: `convoy.route${i}`, ...p })), { id: "convoy.cut", ...C.cut },
    { id: "border.marker", ...B.marker }, ...B.ward.map((p, i) => ({ id: `border.ward${i}`, ...p })), ...B.rival.map((p, i) => ({ id: `border.rival${i}`, ...p })),
  ];
}

/** Kessar's collision world. `bridge: "collapsed"` rebuilds it without the deck (the integrator swaps worlds after the charge goes off). */
export function createKessarWorld(seed: number, bridge: BridgeState = "intact", opts?: { outpost?: OutpostStage; telegraph?: boolean }): CollisionWorld {
  const terrain = createKessarTerrain(seed);
  return new CollisionWorld(terrain, kessarObstacles(terrain, seed, bridge, opts), A.bounds);
}

/** The landing: a ring of up to four on the beach (never on the pier). */
export function kessarSpawn(index: number, count = 4): { x: number; z: number } {
  const a = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 4;
  // (D-070: the ring stands ARRIVAL_INLAND metres up the beach from the landing: on the landing itself the camera, behind the party, hung over the pier's first planks and the first
  // frame of every expedition was a slab of timber. Still within the dock's proposal reach, so a party can sail straight back)
  return { x: A.landing.x + Math.cos(a) * 2.6, z: A.landing.z - ARRIVAL_INLAND + Math.sin(a) * 2.6 };
}

/**
 * Props: the Society's powder (three barrels by the cart on the south bank: the trick resolution's ingredient), and stores on the beach and at the
 * camp. Deterministic; none on the deck, the pier, the water or inside anything solid.
 */
export function kessarProps(seed: number, world: CollisionWorld): PropSpawn[] {
  const out: PropSpawn[] = [];
  const p = A.powder;
  for (const [dx, dz, yaw] of [[-0.9, -0.8, 0.4], [0.3, -1.5, 1.9], [1.1, -0.4, 3.0]] as const) out.push({ kind: PropKind.BARREL, x: p.x + dx, z: p.z + dz, yaw });
  const rng = new Rng(seed ^ 0x57042);
  const kinds = [PropKind.CRATE, PropKind.CRATE, PropKind.BOTTLE, PropKind.CHAIR, PropKind.BARREL, PropKind.CRATE, PropKind.BOTTLE];
  const pos = { x: 0, z: 0 };
  for (let i = 0, tries = 0; i < 9 && tries < 200; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(4.5, 11);
    const x = A.landing.x + Math.cos(a) * d;
    const z = A.landing.z + Math.sin(a) * d;
    pos.x = x;
    pos.z = z;
    const y = world.terrainHeight(x, z);
    if (z > SHORE_Z - 3 || kessarRoad(x, z) > 0.05 || world.resolveXZ(pos, y, propRadius(kinds[i % kinds.length]!) + 0.2, 1.2)) continue;   // (D-038: stores lie beside the road, never on it)
    out.push({ kind: kinds[i % kinds.length]!, x, z, yaw: rng.range(0, Math.PI * 2) });
    i++;
  }
  return out;
}
