import { ARRIVAL_INLAND } from "./campaignTypes.ts";
import type { ResolutionId } from "./campaignTypes.ts";
import { CollisionWorld, type Obstacle } from "./collision.ts";
import { segmentDistance } from "./landscape.ts";
import { TAU, angleDelta, smoothstep } from "./math.ts";
import type { NavOptions } from "./nav.ts";
import { distToPaths, levelOf, planBuilding, roomObstacles, type LevelBuilding, type RegionLevel } from "./levelPlan.ts";
import type { AuditDoor } from "./levelAudit.ts";
import { PropKind, type PropKindId, type PropSpawn } from "./props.ts";
import { Rng, hash3, hashFloat } from "./rng.ts";
import { withOutpost } from "./outpost.ts";
import type { OutpostStage } from "./worldTypes.ts";
import { createTerrain, type Terrain } from "./terrain.ts";

/**
 * HIGHMARK, region two (D-036; docs/_notes/ship.md section 2). The savannah and highland kingdom of the GDD: a wide golden grassland with herds, a processional road
 * that climbs five terraces to a hill-capital of its own look (chalk-white stepped walls, verdigris roofs; NOT Kessar's ochre curtain wall), and a court whose chair is
 * empty because the King has been "pending" for six years. Fictional cultures only: heraldry is a sun and a stag, signage is Latin letters, no domes or minarets.
 *
 * THE PLAN (one pure description the terrain, the colliders, the props and the client's geometry all read, like kessar.ts and village.ts):
 *  - the hill is FIVE concentric terraces round `HIGHMARK.centre`: the granary (r 62..74), the market (50..62), the guild (38..50), the court terrace (20..38) and the plateau (r < 20),
 *    each 2.2 m above the one below. Every riser is a TRUE WALL (a chalk retaining wall a walker bumps into, parapet 1.6 m) except where the Processional Road crosses it on a ramp
 *    (slope 0.31, six metres wide, walled both sides). The ramps alternate round the hill (south, east, west, south, east) so the road is a switchback: it is the only shallow way up.
 *  - the gatehouse (the Chamberlain's Window) straddles the top of the fourth ramp: the only door into the court terrace.
 *  - below: golden grass swell pinned flat at the foot of the hill, the road, the landing and the drovers' camp; a slow river along the south edge; the Reed Landing quay.
 * Metres; x east, z south; yaw is the collision convention (local +x = (cos yaw, sin yaw)). Only the swell, the scrub and the herds depend on the seed.
 *
 * FINAL ANCHOR NUMBERS (package G proved each open and reachable in highmark.test.ts; the contract's numbers were nudged <= 8 m, names and signatures untouched):
 * hillRadius 66 -> 74; gate (0,-58) kept; guards 0/1 (-5,-60)/(5,-60) -> (-2.5,-61)/(2.5,-61); Grange delegates (-40,-34)/(-44,-30)/(-36,-30) -> (-37,-40)/(-40,-36)/(-34,-36);
 * envoy (38,-40) -> (31,-39); road waypoints: the switchback is spelled out (the last is the gate). Landing, waiting stones, court, chamberlain, claimants, guards 2/3, drovers: as contracted.
 */

export const HIGHMARK_STATUS = { stub: false } as const;

/** What the client's HighmarkView may cost (main-pass meshes and triangles, per graphics preset; counted in Node like kessar.test.ts). Package G may tighten, never loosen. */
export const HIGHMARK_VIEW_BUDGET = {
  meshes: { test: 22, low: 28, medium: 44, high: 44 },
  triangles: { test: 120_000, low: 170_000, medium: 440_000, high: 540_000 },
} as const;

/** The endings of the succession dispute that Kessar's contracts do not have ("abandoned" is shared). Tests that script Kessar's resolutions exclude these; package G's tests script these. */
export const HIGHMARK_RESOLUTIONS = ["backed_elder", "backed_younger", "regency", "usurped", "crown_sold"] as const satisfies readonly ResolutionId[];

/** Story coordinates, same frame as KESSAR_ANCHORS. G proves each open and reachable (highmark.test.ts). */
export const HIGHMARK_ANCHORS = {
  bounds: 150,
  /** The Reed Landing: a barge quay on the slow river along the south edge. Everybody arrives here. */
  landing: { x: 0, z: 118 },
  /**
   * The Processional Road's waypoints from the landing to the capital's gate, in walking order: across the grass to the first ramp, then the switchback (the arcs of the three
   * lower terraces are straight chords here; `highmarkRoad()` is the smooth polyline the view paints and the herds keep off). The last is the gate.
   */
  road: [
    { x: 0, z: 112 }, { x: 0, z: 84 }, { x: -4, z: 62 }, { x: 0, z: 36 }, { x: 4, z: 8 }, { x: 0, z: -14 }, { x: 0, z: -25.5 },
    { x: 28.7, z: -31.6 }, { x: 45.3, z: -42 }, { x: 39.5, z: -48.9 },
    { x: 0, z: -36.5 }, { x: -38.2, z: -50.4 }, { x: -31.8, z: -58.1 },
    { x: -6.6, z: -49 }, { x: 0, z: -58 },
  ],
  /** Where petitioners queue and a clerk hands out numbered tickets (a story point; the contract's first stop). */
  waitingStones: { x: -4, z: 62 },
  /** The wide grass the herds drift over, either side of the road. */
  herdGround: { x: 0, z: 40, r: 80 },
  /** The capital: a hill of five terraces, a plateau court on top, a gate in the fourth wall. `gate` and `court` are where you walk; `x,z` is the hill's centre. */
  capital: { x: 0, z: -96, hillRadius: 74, plateauRadius: 20, gate: { x: 0, z: -58 }, court: { x: 0, z: -92 } },
} as const;

/** Where the succession dispute's people stand (G's template reads these; they are named here so the scenario, the plan and the nav tests agree). */
export const HIGHMARK_SITES = {
  chamberlain: { x: 0, z: -84 },
  claimants: { elder: { x: -12, z: -90 }, younger: { x: 12, z: -90 } },
  /** The Grange's delegates (the Reapers' Compact: one scythe, one vote) wait on the granary terrace. */
  grange: [{ x: -37, z: -40 }, { x: -40, z: -36 }, { x: -34, z: -36 }],
  /** The Syndicate's envoy, with a cheque for the Crown's concession, at the foot of the market terrace. */
  envoy: { x: 31, z: -39 },
  /** Court guards: first two always (the gate's), the other two flank the Chamberlain on the plateau. */
  guards: [{ x: -2.5, z: -61 }, { x: 2.5, z: -61 }, { x: -8, z: -82 }, { x: 8, z: -82 }],
  /** Herders' camp (a fire, two shelters) at the edge of the grass: a quiet place for the opening. */
  drovers: { x: -52, z: 50 },
  /**
   * D-042, the Reapers' Strike (docs/_notes/reapers.md): the barley is the grass west of the road; the Compact's picket line and the Steward (come down to shout at it) stand at
   * its east edge; the royal bushel sits on the granary scale up the hill, by the first granary; the Syndicate's strike-breakers land at the quay and march to the barley.
   */
  strike: {
    barley: { x: -30, z: 40, r: 14 },
    /** D-046: the barley as a FIELD you can see (presentation: the ground's furrows, the planted rows): inside `barley`, so what reads as the barley is where the rules count it; rows run north-south. */
    field: { x0: -40, x1: -21, z0: 35, z1: 50, row: 0.9 },
    foreperson: { x: -20, z: 30 }, pickets: [{ x: -24, z: 33 }, { x: -17, z: 34 }],
    steward: { x: -12, z: 26 },
    scale: { x: -42, z: -43 },
    breakers: [{ x: -3, z: 112 }, { x: 3, z: 112 }, { x: -5, z: 108 }, { x: 5, z: 108 }],
  },
} as const;

// ---- the plan ---------------------------------------------------------------------------------------------------------------------------

const DEG = Math.PI / 180;

export const HIGHMARK = {
  /** Grass level (the foot of the hill, the landing, the road and the camp are pinned to it). */
  level: 0.5,
  centre: { x: 0, z: -96 },
  /** Riser radii, outermost first: the granary's outer wall, the market's, the guild's, the court terrace's (the gatehouse stands here), the plateau's. */
  radii: [74, 62, 50, 38, 20],
  /** Height of the ground beyond the hill and of each terrace above it: grass, granary, market, guild, court terrace, plateau. */
  heights: [0.5, 2.7, 4.9, 7.1, 9.3, 11.5],
  /** Where each riser's ramp crosses it, degrees from south (0) towards east (+): the switchback. */
  rampDeg: [0, 40, -40, 0, 30],
  /** A ramp runs this far OUTSIDE its riser (radially), and is this wide either side of its axis. */
  rampRun: 7,
  rampHalf: 3,
  wallHalf: 0.6,
  /** The retaining wall rises this far above the terrace it holds up, and the ramp's side walls this far above the ramp. */
  parapet: 1.6,
  sideWall: 1.5,
  /** Half the width of the painted road. */
  roadHalf: 2.6,
  river: { z: 136, half: 9.5, depth: 1.6, bank: 7, water: -0.35 },
  /** Wall chord length (metres). */
  chord: 4,
} as const;

const C = HIGHMARK.centre;
const RADII = HIGHMARK.radii;
const LV = HIGHMARK.heights;
const RUN = HIGHMARK.rampRun;
const HW = HIGHMARK.rampHalf;
const RAMP_TH: readonly number[] = HIGHMARK.rampDeg.map((d) => d * DEG);

/** A point on the hill: radius r from its centre, `deg` degrees from south towards east. */
export const hillPoint = (r: number, deg: number): { x: number; z: number; th: number } => {
  const th = deg * DEG;
  return { x: C.x + r * Math.sin(th), z: C.z + r * Math.cos(th), th };
};

export interface HighmarkTerrain extends Terrain {
  /** Depth of standing water (the river along the south edge) above the ground at (x, z), metres; 0 on dry land. */
  waterDepth(x: number, z: number): number;
}

/** Centreline z of the river at x. */
export const highmarkRiverZ = (x: number): number => HIGHMARK.river.z + 2.2 * Math.sin(x * 0.035);

/** Depth of the river bed below the bank at (x, z), metres (0 on the bank). */
function riverDepth(x: number, z: number): number {
  const R = HIGHMARK.river;
  const d = Math.abs(z - highmarkRiverZ(x));
  return R.depth * (1 - smoothstep(R.half - 2, R.half + R.bank, d));
}

/**
 * The ground: golden swell pinned flat at the hill's foot, the landing, the camp and the road's start; five terraces of the hill with their ramps; the river's bed.
 * Terrace risers are a step in the height (the wall that stands on each is the obstacle); a ramp is a plane. Pure and allocation-free.
 */
export function createHighmarkTerrain(seed: number): HighmarkTerrain {
  const base = createTerrain(seed, { amplitude: 2.4, wavelength: 56, flatRadius: 0, blend: 1 });
  const L = HIGHMARK.level;
  const L0 = HIGHMARK_ANCHORS.landing;
  const D0 = HIGHMARK_SITES.drovers;
  const height = (x: number, z: number): number => {
    const dx = x - C.x;
    const dz = z - C.z;
    const r = Math.hypot(dx, dz);
    let h: number;
    if (r < RADII[0]!) {
      let j = 0;
      while (j < 5 && r < RADII[j]!) j++;
      h = LV[j]!;
    } else {
      const m = smoothstep(RADII[0]! + RUN + 2, RADII[0]! + RUN + 24, r) * (1 - smoothstep(86, 104, z))
        * smoothstep(8, 22, Math.hypot(x - L0.x, z - L0.z)) * smoothstep(7, 15, Math.hypot(x - D0.x, z - D0.z));
      h = L + base.height(x, z) * m;
      h -= riverDepth(x, z);
    }
    if (r < RADII[0]! + RUN) {
      const th = Math.atan2(dx, dz);
      for (let k = 0; k < 5; k++) {
        const rk = RADII[k]!;
        if (r <= rk || r > rk + RUN) continue;
        const a = angleDelta(RAMP_TH[k]!, th);
        if (Math.abs(a) >= Math.PI / 2 || Math.abs(r * Math.sin(a)) > HW) continue;
        const lo = LV[k]!;
        h = LV[k + 1]! - (LV[k + 1]! - lo) * ((r - rk) / RUN);
        break;
      }
    }
    return h;
  };
  const waterDepth = (x: number, z: number): number => {
    if (z < HIGHMARK.river.z - HIGHMARK.river.half - HIGHMARK.river.bank - 4) return 0;
    const d = HIGHMARK.level + HIGHMARK.river.water - height(x, z);
    return d > 0 ? d : 0;
  };
  return { height, waterDepth };
}

// ---- the road ---------------------------------------------------------------------------------------------------------------------------

let cachedRoad: { x: number; z: number }[] | undefined;

/**
 * The Processional Road from the landing to the court, as a dense polyline (the view paints it, the herds keep off it, the tests walk it): the grass road to the first ramp,
 * up it, along the granary terrace to the second, along the market terrace to the third, along the guild terrace to the fourth and the gate, along the court terrace to the fifth
 * and straight across the plateau to the court.
 */
export function highmarkRoad(): readonly { x: number; z: number }[] {
  if (cachedRoad) return cachedRoad;
  const out: { x: number; z: number }[] = [];
  const A = HIGHMARK_ANCHORS;
  for (let i = 0; i < 6; i++) out.push({ x: A.road[i]!.x, z: A.road[i]!.z });
  const ramp = (k: number): void => {
    const th = RAMP_TH[k]!;
    const u = { x: Math.sin(th), z: Math.cos(th) };
    for (const r of [RADII[k]! + RUN + 0.5, RADII[k]! + RUN * 0.5, RADII[k]! - 0.5]) out.push({ x: C.x + u.x * r, z: C.z + u.z * r });
  };
  const arc = (r: number, d0: number, d1: number): void => {
    const n = Math.max(2, Math.ceil(Math.abs(d1 - d0) / 8));
    for (let i = 0; i <= n; i++) {
      const p = hillPoint(r, d0 + ((d1 - d0) * i) / n);
      out.push({ x: p.x, z: p.z });
    }
  };
  // ramp 1 (south), the granary terrace east to ramp 2, the market terrace west to ramp 3, the guild terrace to ramp 4 (south, the gate), the court terrace east to ramp 5, the plateau
  ramp(0);
  arc(70.5, 0, 40);
  const r2 = RADII[1]! + RUN + 0.5;
  arc(r2, 40, 40);
  ramp(1);
  arc(59.5, 40, -40);
  const r3 = RADII[2]! + RUN + 0.5;
  arc(r3, -40, -40);
  ramp(2);
  arc(47.5, -40, 0);
  ramp(3);
  arc(33, 0, 30);
  ramp(4);
  out.push({ x: C.x, z: HIGHMARK_ANCHORS.capital.court.z });
  cachedRoad = dedupe(out);
  return cachedRoad;
}

function dedupe(p: { x: number; z: number }[]): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const q of p) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l.x - q.x, l.z - q.z) > 0.2) out.push(q);
  }
  return out;
}

/** 0..1 closeness to the road (1 on the carriageway, 0 beyond its verge): the view's paint, the scatter's keep-out and the herds' check. */
export function highmarkRoadness(x: number, z: number): number {
  const road = highmarkRoad();
  let best = Infinity;
  for (let i = 0; i + 1 < road.length; i++) {
    const a = road[i]!, b = road[i + 1]!;
    const d = segmentDistance(x, z, a.x, a.z, b.x, b.z);
    if (d < best) best = d;
  }
  return 1 - smoothstep(HIGHMARK.roadHalf - 0.6, HIGHMARK.roadHalf + 1.4, best);
}

/** Distance from (x, z) to the road polyline. */
export function highmarkRoadDistance(x: number, z: number): number {
  const road = highmarkRoad();
  let best = Infinity;
  for (let i = 0; i + 1 < road.length; i++) {
    const d = segmentDistance(x, z, road[i]!.x, road[i]!.z, road[i + 1]!.x, road[i + 1]!.z);
    if (d < best) best = d;
  }
  return best;
}

// ---- the authored things ------------------------------------------------------------------------------------------------------------------

export interface HighmarkBox { x: number; z: number; yaw: number; hx: number; hz: number; height: number }
export interface HighmarkRound { x: number; z: number; r: number; height: number }
export interface HighmarkWall {
  x: number; z: number; yaw: number; hx: number; hz: number;
  /** The terrace below the wall and the one it holds up (absolute heights). A ramp's side wall is tagged `ramp` and `hi` is its surface at its centre. */
  lo: number; hi: number; ramp: boolean;
}
/** `top` is the cloth's top edge in metres above the ground where it hangs. */
export interface HighmarkBanner { x: number; z: number; yaw: number; top: number; w: number; h: number; kind: "crown" | "grange" | "syndicate" }
export interface HighmarkSign { x: number; z: number; yaw: number; text: number }

/** Signage: Latin letters, satire at the institutions of a court that has been waiting six years for a signature. */
export const HIGHMARK_SIGNS = [
  "REED LANDING. PLEASE TAKE A NUMBER.",
  "PETITIONERS WAIT HERE. THE WAIT IS THE POINT.",
  "GRANARY TERRACE. GRAIN FIRST, GRIEVANCES LATER.",
  "MARKET TERRACE. CHEQUES ACCEPTED AT THE CHEQUE STALL.",
  "GUILD TERRACE. ASSAYERS OF THE KING'S PENDING.",
  "CHAMBERLAIN'S WINDOW. FORM 11. FORM 11 IS AT THE OTHER WINDOW.",
  "THE COURT IS OPEN. THE CHAIR IS NOT.",
] as const;

export interface HighmarkPlan {
  /** Retaining walls (risers) and the ramps' side walls, as colliders and as the view's chalk. */
  walls: HighmarkWall[];
  granaries: HighmarkRound[];
  stalls: HighmarkBox[];
  well: HighmarkRound;
  halls: HighmarkBox[];
  gate: { towers: HighmarkBox[]; lintel: HighmarkBox; x: number; z: number; y: number };
  palace: HighmarkBox;
  throne: HighmarkBox;
  plinths: HighmarkRound[];
  /** Lamp posts: lit at dusk (the harvest bell hour). */
  lamps: { x: number; z: number; h: number }[];
  /** Numbered milestones along the road, then the Waiting Stones. */
  milestones: { x: number; z: number; n: number }[];
  waitingStones: { x: number; z: number }[];
  quay: { x: number; z0: number; z1: number; half: number; boat: { x: number; z: number; yaw: number }; bollards: { x: number; z: number }[] };
  camp: { tents: { x: number; z: number; yaw: number }[]; fire: { x: number; z: number }; flag: { x: number; z: number } };
  banners: HighmarkBanner[];
  signs: HighmarkSign[];
}

let cachedPlan: HighmarkPlan | undefined;

const tangentYaw = (deg: number): number => -deg * DEG;
const radialYaw = (deg: number): number => Math.PI / 2 - deg * DEG;

/** x of the grass road at z (the road from the landing to the first ramp is a polyline monotone in z). */
function grassRoadX(z: number): number {
  const w = HIGHMARK_ANCHORS.road;
  for (let i = 0; i + 1 < 6; i++) {
    const a = w[i]!, b = w[i + 1]!;
    if (z <= a.z && z >= b.z) return a.x + ((b.x - a.x) * (a.z - z)) / (a.z - b.z || 1);
  }
  return 0;
}

/** The worn tracks off the processional (D-038: authored here so the seeded scrub keeps clear of them and the audit walks them): the drovers' track, threading the Waiting Stones' gap. */
export const HIGHMARK_TRACKS: readonly (readonly { x: number; z: number }[])[] = [[{ x: -4, z: 62 }, { x: -12, z: 62.3 }, { x: -52, z: 50 }]];

export function highmarkPlan(): HighmarkPlan {
  if (cachedPlan) return cachedPlan;
  const A = HIGHMARK_ANCHORS;
  // ---- walls: every riser, minus the ramp's window; the ramps' side walls
  const walls: HighmarkWall[] = [];
  const bound = A.bounds + 6;
  for (let k = 0; k < 5; k++) {
    const rk = RADII[k]!;
    const th0 = RAMP_TH[k]!;
    const gap = Math.asin((HW + 2 * HIGHMARK.wallHalf) / rk);
    const span = TAU - 2 * gap;
    const n = Math.ceil((span * rk) / HIGHMARK.chord);
    const chord = 2 * rk * Math.sin(span / (2 * n));
    for (let i = 0; i < n; i++) {
      const th = th0 + gap + ((i + 0.5) * span) / n;
      const x = C.x + rk * Math.sin(th);
      const z = C.z + rk * Math.cos(th);
      if (Math.hypot(x, z) > bound) continue;
      walls.push({ x, z, yaw: -th, hx: chord / 2 + 0.25, hz: HIGHMARK.wallHalf, lo: LV[k]!, hi: LV[k + 1]!, ramp: false });
    }
    // the ramp's side walls: four boxes a side along the run
    const ux = Math.sin(th0), uz = Math.cos(th0);
    const vx = Math.cos(th0), vz = -Math.sin(th0);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const r = rk + ((i + 0.5) * RUN) / 4;
        const off = side * (HW + HIGHMARK.wallHalf);
        const x = C.x + ux * r + vx * off;
        const z = C.z + uz * r + vz * off;
        if (Math.hypot(x, z) > bound) continue;
        const surf = LV[k + 1]! - (LV[k + 1]! - LV[k]!) * ((r - rk) / RUN);
        walls.push({ x, z, yaw: Math.atan2(uz, ux), hx: RUN / 8 + 0.1, hz: HIGHMARK.wallHalf, lo: LV[k]!, hi: surf, ramp: true });
      }
    }
  }

  // ---- the hill's buildings
  // (D-038: the granaries stand at r 66, not 65: at 65 their round flanks sank 0.2 m into the market's retaining wall)
  const granaries: HighmarkRound[] = [-45, -58, -71].map((d) => ({ ...hillPoint(66, d), r: 2.6, height: 5 }));
  const stalls: HighmarkBox[] = [-25, -14, -3, 8, 19].map((d, i) => {
    const p = hillPoint(52.8, d);
    return { x: p.x, z: p.z, yaw: tangentYaw(d), hx: 1.5, hz: 1.0, height: 2.4 + (i % 2) * 0.3 };
  });
  const wp = hillPoint(54, 55);
  const well: HighmarkRound = { x: wp.x, z: wp.z, r: 1.3, height: 1.1 };
  const halls: HighmarkBox[] = [];
  const hall = (r: number, d: number, hx: number, hz: number, height: number): void => {
    const p = hillPoint(r, d);
    halls.push({ x: p.x, z: p.z, yaw: tangentYaw(d), hx, hz, height });
  };
  hall(44.2, 42, 6.5, 3.4, 6.5);    // the guildhall
  hall(44.2, -68, 5.5, 3.0, 5.5);   // the assay office
  hall(29, -25, 4.5, 2.6, 5);       // the Chamberlain's office
  hall(29, -60, 4.5, 2.6, 5);
  hall(29, 65, 4.5, 2.6, 5);
  hall(29, 110, 4.5, 2.6, 5);
  hall(29, -110, 4.5, 2.6, 5);

  // the gatehouse: two towers flank the ramp's top, a lintel crosses it high enough to walk under
  const g = A.capital.gate;
  const gateY = LV[4]!;
  const towerX = HW + 2 * HIGHMARK.wallHalf + 2.6;
  const gate = {
    towers: [-1, 1].map((s): HighmarkBox => ({ x: s * towerX, z: g.z, yaw: 0, hx: 2.6, hz: 3.2, height: 9 })),
    lintel: { x: 0, z: g.z, yaw: 0, hx: HW + 2 * HIGHMARK.wallHalf, hz: 2, height: 6.2 },
    x: g.x, z: g.z, y: gateY,
  };
  const palace: HighmarkBox = { x: 0, z: -108, yaw: 0, hx: 10, hz: 4, height: 7.5 };
  const throne: HighmarkBox = { x: 0, z: -101.5, yaw: 0, hx: 0.55, hz: 0.55, height: 1.7 };
  const plinths: HighmarkRound[] = [-7, 7].map((x) => ({ x, z: -99, r: 0.8, height: 3 }));

  // lamps: along the road's terraces and on the plateau
  const lamps: { x: number; z: number; h: number }[] = [];
  const lampAt = (r: number, d: number): void => {
    const p = hillPoint(r, d);
    lamps.push({ x: p.x, z: p.z, h: 3.2 });
  };
  for (const d of [8, 22, 34]) lampAt(67.2, d);
  for (const d of [30, 5, -20]) lampAt(56.2, d);
  for (const d of [-30, -15]) lampAt(44.6, d);
  for (const d of [8, 20]) lampAt(30.4, d);
  for (const [x, z] of [[-6, -88], [6, -88], [-6, -96], [6, -96]] as const) lamps.push({ x, z, h: 3.4 });
  for (const s of [-1, 1]) lamps.push({ x: s * 5.4, z: g.z + 6.6, h: 3.4 });
  // two at the Reed Landing, either side of the road just ahead of where a party lands: everybody arrives here, and at night it was the darkest place in the
  // region (behind the arrival ring they stood beside the camera and blocked the first view)
  for (const s of [-1, 1]) lamps.push({ x: s * 2.7, z: 109.8, h: 3.2 });

  // milestones every ~26 m from the quay to the first ramp (I..V) on the road's east verge; the Waiting Stones on its west one
  const milestones = [96, 70, 44, 18, -8].map((z, i) => ({ x: grassRoadX(z) + 4.2, z, n: i + 1 }));
  const waitingStones = [57, 60.5, 64, 67.5].map((z) => ({ x: -8.6, z }));

  const quay = {
    x: 0, z0: 119.5, z1: 133.5, half: 1.7,
    boat: { x: 5.4, z: 128, yaw: 0.08 },
    bollards: [{ x: -2.3, z: 121.5 }, { x: 2.3, z: 121.5 }, { x: -2.3, z: 131.5 }, { x: 2.3, z: 131.5 }],
  };
  const D = HIGHMARK_SITES.drovers;
  const camp = {
    tents: [{ x: D.x - 5.5, z: D.z - 4, yaw: 0.3 }, { x: D.x - 6, z: D.z + 4.5, yaw: -0.25 }],
    fire: { x: D.x + 2, z: D.z + 3 },
    flag: { x: D.x + 5, z: D.z - 3 },
  };

  const banners: HighmarkBanner[] = [
    { x: gate.towers[0]!.x, z: g.z + 3.25, yaw: Math.PI / 2, top: 8.2, w: 2.2, h: 4.2, kind: "crown" },
    { x: gate.towers[1]!.x, z: g.z + 3.25, yaw: Math.PI / 2, top: 8.2, w: 2.2, h: 4.2, kind: "crown" },
    { x: 0, z: palace.z + palace.hz + 0.08, yaw: Math.PI / 2, top: 6.8, w: 3.2, h: 5.4, kind: "crown" },
    { x: granaries[0]!.x + 2.7, z: granaries[0]!.z + 0.5, yaw: 0, top: 5.4, w: 1.6, h: 3.4, kind: "grange" },
    { x: HIGHMARK_SITES.envoy.x + 4, z: HIGHMARK_SITES.envoy.z + 2.5, yaw: Math.PI / 2, top: 4.6, w: 1.7, h: 3, kind: "syndicate" },
    { x: HIGHMARK_SITES.grange[0]!.x - 3.5, z: HIGHMARK_SITES.grange[0]!.z - 2, yaw: Math.PI / 2, top: 4.4, w: 1.5, h: 3, kind: "grange" },
  ];
  const signs: HighmarkSign[] = [
    { x: 3.9, z: 113.5, yaw: Math.PI / 2, text: 0 },
    { x: -6.2, z: 72, yaw: Math.PI / 2, text: 1 },
    ...[
      { p: hillPoint(72.8, 14), text: 2 }, { p: hillPoint(56.4, 22), text: 3 }, { p: hillPoint(43.8, -22), text: 4 },
    ].map(({ p, text }): HighmarkSign => ({ x: p.x, z: p.z, yaw: -p.th + Math.PI / 2, text })),
    { x: -7.6, z: g.z + 6.6, yaw: Math.PI / 2, text: 5 },
    { x: 7.5, z: -92, yaw: Math.PI / 2, text: 6 },
  ];
  cachedPlan = { walls, granaries, stalls, well, halls, gate, palace, throne, plinths, lamps, milestones, waitingStones, quay, camp, banners, signs };
  return cachedPlan;
}

// ---- the level plan (D-038; docs/LEVEL_PLAN.md section 7) ----------------------------------------------------------------------------------------

/** The sealed facades' notices, in the capital's own voice (the Grange's halls, the assay office, the Chamberlain's offices, the palace). */
export const HIGHMARK_SEALED_SIGNS = {
  grange: "SHUTTERS NAILED. HARVEST IN PROGRESS.",
  assay: "CLOSED PENDING THE ASSAY",
  chamberlain: "FORM 11 IS AT THE OTHER WINDOW",
  palace: "THE KING IS PENDING",
} as const;

let cachedLevel: RegionLevel | undefined;
/**
 * What every building of the capital IS. hall0 (the guildhall of the guild terrace) is the Grange Assembly Hall: the one walkable interior, a double door 2.4 m wide at its end, benches, the harvest bell on a beam.
 * The other six halls and the palace are `sealed` (a door painted or sealed shut on the long face the road passes, with its notice); the two gate towers are `solid` and the lintel between them is a `passage`
 * (8.4 m clear, 3.6 m under the lintel). The granaries are round stores with a hatch up a ladder and no ground door; the stalls are open-front.
 */
export function highmarkLevel(): RegionLevel {
  if (cachedLevel) return cachedLevel;
  const p = highmarkPlan();
  const H = p.halls;
  // a sealed hall's door is on its long outward face: rotate the frame a quarter turn so local +x is the face the road passes
  const facade = (b: HighmarkBox): { x: number; z: number; yaw: number; hx: number; hz: number } => ({ x: b.x, z: b.z, yaw: b.yaw + Math.PI / 2, hx: b.hz, hz: b.hx });
  const signOf = (i: number): string => (i === 1 ? HIGHMARK_SEALED_SIGNS.assay : i >= 2 ? HIGHMARK_SEALED_SIGNS.chamberlain : HIGHMARK_SEALED_SIGNS.grange);
  const buildings: LevelBuilding[] = [
    planBuilding("hall0", "interior", { x: H[0]!.x, z: H[0]!.z, yaw: H[0]!.yaw, hx: H[0]!.hx, hz: H[0]!.hz }, { height: H[0]!.height, floor: 0.3, wallH: 4.4, door: 2.4, doorH: 3.0 }),
    ...H.slice(1).map((b, i) => planBuilding(`hall${i + 1}`, "sealed", facade(b), { height: b.height, floor: 0, wallH: b.height, sign: signOf(i + 1) })),
    planBuilding("palace", "sealed", { x: p.palace.x, z: p.palace.z, yaw: Math.PI / 2, hx: p.palace.hz, hz: p.palace.hx }, { height: p.palace.height, floor: 0.8, wallH: p.palace.height, door: 3.2, doorH: 4.0, sign: HIGHMARK_SEALED_SIGNS.palace }),
    ...p.gate.towers.map((t, i) => planBuilding(`gate.tower${i}`, "solid", { x: t.x, z: t.z, yaw: t.yaw, hx: t.hx, hz: t.hz }, { height: t.height, floor: 0, wallH: t.height })),
  ];
  const l = p.gate.lintel;
  // the passage: the road runs south to north through it; the threshold is on the lintel's south face, `through` is 1.6 m beyond its north face
  const passage: AuditDoor = { id: "gate.passage", building: "gate", x: l.x, z: l.z + l.hz, yaw: Math.PI / 2, width: l.hx * 2, height: 3.6, leads: "passage", through: { x: l.x, z: l.z - l.hz - 1.6 }, wide: true };
  cachedLevel = levelOf(buildings, [passage]);
  return cachedLevel;
}

// ---- colliders ----------------------------------------------------------------------------------------------------------------------------

/** Everything solid in Highmark: the walls, the ramps' sides, the buildings, the gatehouse, the court's furniture, the milestones, the camp, the quay, then the seeded scrub on its own Rng stream. */
export function highmarkObstacles(terrain: Terrain, seed: number, opts?: { outpost?: OutpostStage; telegraph?: boolean; works?: boolean }): Obstacle[] {
  const plan = highmarkPlan();
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
  // walls: from below the lower terrace to the parapet on the upper one (a ramp's side: to the ramp's surface plus a rail)
  for (const w of plan.walls) {
    out.push({ kind: "box", tag: "wall", x: w.x, z: w.z, hx: w.hx, hz: w.hz, yaw: w.yaw, y0: w.lo - 1.5, y1: w.hi + (w.ramp ? HIGHMARK.sideWall : HIGHMARK.parapet) });
  }
  for (const s of plan.granaries) circle("house", s.x, s.z, s.r, s.height);
  // the stalls are OPEN (D-038): a counter table across the middle (a body walks behind it) and the four awning poles; the awning is the view's, high above any head
  for (const s of plan.stalls) {
    box("stall", s.x, s.z, s.hx, s.hz * 0.7, s.yaw, 0.95);
    const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = sx * (s.hx - 0.1), lz = sz * (s.hz - 0.1);
      circle("pole", s.x + lx * c - lz * n, s.z + lx * n + lz * c, 0.07, s.height);
    }
  }
  circle("well", plan.well.x, plan.well.z, plan.well.r, plan.well.height);
  // the halls: hall0 is a room (walls with a double doorway, a plinth floor); the others are solid masses with a sealed facade
  const lvl = highmarkLevel();
  plan.halls.forEach((h, i) => {
    const b = i === 0 ? lvl.buildings.find((x) => x.id === "hall0") : undefined;
    if (b) out.push(...roomObstacles(b, g(b.x, b.z)));
    else box("house", h.x, h.z, h.hx, h.hz, h.yaw, h.height);
  });
  for (const t of plan.gate.towers) box("house", t.x, t.z, t.hx, t.hz, t.yaw, t.height);
  {
    const l = plan.gate.lintel;
    out.push({ kind: "box", tag: "wall", x: l.x, z: l.z, hx: l.hx, hz: l.hz, yaw: l.yaw, y0: plan.gate.y + 3.6, y1: plan.gate.y + l.height });
  }
  box("house", plan.palace.x, plan.palace.z, plan.palace.hx, plan.palace.hz, plan.palace.yaw, plan.palace.height);
  box("table", plan.throne.x, plan.throne.z, plan.throne.hx, plan.throne.hz, plan.throne.yaw, plan.throne.height);
  for (const p of plan.plinths) circle("ruin", p.x, p.z, p.r, p.height);
  for (const l of plan.lamps) circle("pole", l.x, l.z, 0.18, l.h);
  for (const m of plan.milestones) circle("waypost", m.x, m.z, 0.24, 1.3);
  for (const s of plan.waitingStones) circle("waypost", s.x, s.z, 0.5, 1);
  for (const s of plan.signs) circle("sign", s.x, s.z, 0.12, 2);
  // the free-standing banners (the Grange's and the Syndicate's) hang from a pole; the Crown's hang on the walls
  for (const b of plan.banners) if (b.kind !== "crown") circle("flag", b.x, b.z, 0.15, b.top);
  // the quay: planks over the wading water (walkable: the top is the bank level), bollards
  const q = plan.quay;
  out.push({ kind: "box", tag: "jetty", x: q.x, z: (q.z0 + q.z1) / 2, hx: q.half, hz: (q.z1 - q.z0) / 2, yaw: 0, y0: HIGHMARK.level - HIGHMARK.river.depth - 1, y1: HIGHMARK.level });
  for (const b of q.bollards) circle("pole", b.x, b.z, 0.2, 0.9);
  // the drovers' camp
  for (const t of plan.camp.tents) box("tent", t.x, t.z, 2, 1.6, t.yaw, 2.4);
  circle("fire", plan.camp.fire.x, plan.camp.fire.z, 0.55, 0.5);
  circle("flag", plan.camp.flag.x, plan.camp.flag.z, 0.16, 5);

  // seeded dressing: acacia flats and termite mounds, kept off the road, the hill, the river, the herds' ground centres and every story point
  const sites = highmarkSitePoints();
  const rng = new Rng(seed ^ 0x6b1a7c3);
  const plan2 = herdPlan(seed);
  const free = (x: number, z: number, gap: number): boolean => {
    if (Math.hypot(x, z) > A_BOUNDS - 6) return false;
    if (z > HIGHMARK.river.z - HIGHMARK.river.half - HIGHMARK.river.bank - 3) return false;
    if (Math.hypot(x - C.x, z - C.z) < RADII[0]! + RUN + 5) return false;
    if (highmarkRoadDistance(x, z) < HIGHMARK.roadHalf + 2.6 + gap) return false;
    if (distToPaths(HIGHMARK_TRACKS, x, z) < 2.6 + gap) return false;
    for (const s of sites) if (Math.hypot(s.x - x, s.z - z) < 6 + gap) return false;
    for (const h of plan2.herds) if (Math.hypot(h.cx - x, h.cz - z) < h.r * 0.6) return false;
    for (const o of out) {
      if (o.tag === "wall") continue;
      const r = (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + gap;
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < r * r) return false;
    }
    return true;
  };
  for (let i = 0, tries = 0; i < 38 && tries < 700; tries++) {
    const x = rng.range(-A_BOUNDS + 8, A_BOUNDS - 8);
    const z = rng.range(-A_BOUNDS + 8, 112);
    if (!free(x, z, 2.4)) continue;
    const y = g(x, z);
    out.push({ kind: "circle", tag: "tree", x, z, r: rng.range(0.3, 0.46), y0: y - 1, y1: y + rng.range(5, 6.6) });
    i++;
  }
  for (let k = 0, tries = 0; k < 16 && tries < 500; tries++) {
    const x = rng.range(-A_BOUNDS + 10, A_BOUNDS - 10);
    const z = rng.range(-A_BOUNDS + 10, 108);
    if (!free(x, z, 1.8)) continue;
    const r = rng.range(0.7, 1.4);
    const y = g(x, z);
    out.push({ kind: "circle", tag: "rock", x, z, r, y0: y - 1.2, y1: y + r * 1.5 });   // a termite mound
    k++;
  }
  // D-056: the Society's outpost on the grass west of the landing (the dressing above is the same at every stage; a stage clears it out of the ring and adds its own)
  return withOutpost(out, terrain, "highmark", opts, ["tree", "rock"]);
}

const A_BOUNDS = HIGHMARK_ANCHORS.bounds;

export function createHighmarkWorld(seed: number, opts?: { outpost?: OutpostStage; telegraph?: boolean; works?: boolean }): CollisionWorld {
  const terrain = createHighmarkTerrain(seed);
  return new CollisionWorld(terrain, highmarkObstacles(terrain, seed, opts), HIGHMARK_ANCHORS.bounds);
}

/** The landing: a ring of up to four on the quay-side bank (never in the water, never on the planks). */
export function highmarkSpawn(index: number, count = 4): { x: number; z: number } {
  const a = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 4;
  const L = HIGHMARK_ANCHORS.landing;
  return { x: L.x + Math.cos(a) * 2.6, z: L.z - 1.4 - ARRIVAL_INLAND + Math.sin(a) * 1.2 } /* (D-070: up the shore, off the jetty's first planks) */;
}

/** The props a visit starts with: stores at the landing and in the drovers' camp, a stool or two at the Waiting Stones. Deterministic, never in anything solid. */
export function highmarkProps(seed: number, world: CollisionWorld): PropSpawn[] {
  const out: PropSpawn[] = [];
  const rng = new Rng(seed ^ 0x41a3c0de);
  const pos = { x: 0, z: 0 };
  const L = HIGHMARK_ANCHORS.landing;
  const D = HIGHMARK_SITES.drovers;
  // the grain: three barrels stencilled for the Reapers' Assembly at the quay and three at the drovers' camp (a barrel carried to a delegate is that delegate's vote)
  for (const [dx, dz] of [[-5.6, -5], [-6.6, -6.3], [-4.9, -6.4]] as const) out.push({ kind: PropKind.BARREL, x: L.x + dx, z: L.z + dz, yaw: rng.range(0, TAU) });
  for (const [dx, dz] of [[5, 6], [6.2, 5], [4, 7.2]] as const) out.push({ kind: PropKind.BARREL, x: D.x + dx, z: D.z + dz, yaw: rng.range(0, TAU) });
  const spots: { x: number; z: number; r: number; n: number; kinds: PropKindId[] }[] = [
    { x: L.x, z: L.z - 6, r: 6, n: 5, kinds: [PropKind.CRATE, PropKind.BARREL, PropKind.CRATE, PropKind.BOTTLE, PropKind.CRATE] },
    { x: D.x + 2, z: D.z + 3, r: 4.5, n: 4, kinds: [PropKind.BARREL, PropKind.BOTTLE, PropKind.CHAIR, PropKind.CRATE] },
    { x: -6, z: 62, r: 3.5, n: 2, kinds: [PropKind.CHAIR, PropKind.CHAIR] },
  ];
  for (const s of spots) {
    for (let i = 0, tries = 0; i < s.n && tries < 80; tries++) {
      const a = rng.range(0, TAU);
      const d = rng.range(1.8, s.r);
      const x = s.x + Math.cos(a) * d;
      const z = s.z + Math.sin(a) * d;
      pos.x = x;
      pos.z = z;
      if (world.resolveXZ(pos, world.terrainHeight(x, z), 0.6, 1.2) || highmarkRoadDistance(x, z) < 1.6) continue;
      out.push({ kind: s.kinds[i % s.kinds.length]!, x, z, yaw: rng.range(0, TAU) });
      i++;
    }
  }
  // the court's furniture: two benches' worth of chairs for the petitioners, on the court terrace by the gate
  const gp = HIGHMARK_ANCHORS.capital.gate;
  for (const [dx, dz] of [[-6, -5], [6, -5]] as const) {
    const x = gp.x + dx, z = gp.z + dz;
    pos.x = x;
    pos.z = z;
    if (!world.resolveXZ(pos, world.terrainHeight(x, z), 0.6, 1.2)) out.push({ kind: PropKind.CHAIR, x, z, yaw: rng.range(0, TAU) });
  }
  return out;
}

/** Every story point of the region, named (the scatter keeps clear of them and the tests prove each is open and reachable). */
export function highmarkSitePoints(): { id: string; x: number; z: number }[] {
  const A = HIGHMARK_ANCHORS, S = HIGHMARK_SITES;
  return [
    { id: "landing", ...A.landing }, { id: "waitingStones", ...A.waitingStones }, { id: "gate", ...A.capital.gate }, { id: "court", ...A.capital.court },
    { id: "chamberlain", ...S.chamberlain }, { id: "claimant.elder", ...S.claimants.elder }, { id: "claimant.younger", ...S.claimants.younger },
    ...S.grange.map((p, i) => ({ id: `grange${i}`, ...p })), { id: "envoy", ...S.envoy }, ...S.guards.map((p, i) => ({ id: `guard${i}`, ...p })), { id: "drovers", ...S.drovers },
    // D-042: the Reapers' Strike
    { id: "strike.barley", x: S.strike.barley.x, z: S.strike.barley.z }, { id: "strike.foreperson", ...S.strike.foreperson }, ...S.strike.pickets.map((p, i) => ({ id: `strike.picket${i}`, ...p })),
    { id: "strike.steward", ...S.strike.steward }, { id: "strike.scale", ...S.strike.scale }, ...S.strike.breakers.map((p, i) => ({ id: `strike.breaker${i}`, ...p })),
  ];
}

/** Navigation options (the nav grid): deep water closed, rooted at the landing (the terraces are islands unless the road climbs them). */
export function highmarkNavOptions(world: CollisionWorld): NavOptions {
  const wd = (world.terrain as Partial<HighmarkTerrain>).waterDepth;
  return { tag: "highmark", roots: [HIGHMARK_ANCHORS.landing], deep: wd === undefined ? undefined : (x, z) => wd(x, z) > 0.9 };
}

// ---- herds (scenery, a pure function of seed and clock: no server state, nothing hits them) -------------------------------------------------------

export interface HerdPlan {
  /** Herds in drift order; each animal belongs to one. */
  herds: { cx: number; cz: number; r: number; speed: number; n: number }[];
  seed: number;
}
export const HERD_CAP = 96;

const HERD_BASE: readonly { cx: number; cz: number; r: number; n: number }[] = [
  { cx: -46, cz: 24, r: 15, n: 26 }, { cx: 50, cz: 52, r: 17, n: 24 }, { cx: -100, cz: 62, r: 13, n: 20 }, { cx: 48, cz: 88, r: 12, n: 22 },
];

/** Four herds, 92 animals in all: grazing drift deterministic from (seed, worldSec), their ground always >= 28 m from the road and well off the hill (and, D-056, off the outpost's ground: the west herd grazes beyond it). */
export function herdPlan(seed: number): HerdPlan {
  const rng = new Rng(seed ^ 0x4e7d5);
  const herds = HERD_BASE.map((h) => ({ cx: h.cx + rng.range(-3, 3), cz: h.cz + rng.range(-3, 3), r: h.r, speed: rng.range(0.3, 0.5), n: h.n }));
  return { herds, seed: seed >>> 0 };
}

/** Where animal `i` of the plan is at `worldSec` (writes `out`; allocation-free; false when `i` is out of range). */
export function herdAt(plan: HerdPlan, i: number, worldSec: number, out: { x: number; z: number; yaw: number }): boolean {
  if (!(i >= 0)) return false;
  let k = 0, base = 0;
  const herds = plan.herds;
  while (k < herds.length && i >= base + herds[k]!.n) {
    base += herds[k]!.n;
    k++;
  }
  if (k >= herds.length) return false;
  const h = herds[k]!;
  const j = Math.floor(i) - base;
  const s = plan.seed;
  const ang = j * 2.399963 + hashFloat(s, k, j, 1) * 0.9;
  const rad = h.r * 0.8 * Math.sqrt((j + 0.5) / h.n);
  const ph = hashFloat(s, k, 77, 2) * TAU;
  const pj = hashFloat(s, k, j, 3) * TAU;
  const w = (worldSec * h.speed) / h.r;
  const cx = h.cx + h.r * 0.35 * Math.sin(w * 0.9 + ph);
  const cz = h.cz + h.r * 0.3 * Math.cos(w * 0.7 + ph);
  out.x = cx + Math.cos(ang) * rad + 0.9 * Math.sin(worldSec * 0.31 + pj);
  out.z = cz + Math.sin(ang) * rad + 0.9 * Math.cos(worldSec * 0.27 + pj * 1.3);
  // heading: the herd's drift plus the animal's own sway
  const vx = h.r * 0.35 * Math.cos(w * 0.9 + ph) * 0.9 * (h.speed / h.r) + 0.9 * 0.31 * Math.cos(worldSec * 0.31 + pj);
  const vz = -h.r * 0.3 * Math.sin(w * 0.7 + ph) * 0.7 * (h.speed / h.r) - 0.9 * 0.27 * Math.sin(worldSec * 0.27 + pj * 1.3);
  out.yaw = Math.atan2(vz, vx);
  return true;
}

/** Total animals in a plan. */
export const herdCount = (plan: HerdPlan): number => {
  let n = 0;
  for (const h of plan.herds) n += h.n;
  return n;
};

/** A stable per-animal variety number in [0, 1) for the view (a tint, a size). */
export const herdVariety = (plan: HerdPlan, i: number): number => hash3(plan.seed, i, 0x4e1) / 4294967296;
