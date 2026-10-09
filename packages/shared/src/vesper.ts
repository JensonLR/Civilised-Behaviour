import { ARRIVAL_INLAND } from "./campaignTypes.ts";
import type { UseStation } from "./campaignTypes.ts";
import { CollisionWorld, type Obstacle } from "./collision.ts";
import { segmentDistance } from "./landscape.ts";
import { TAU, smoothstep } from "./math.ts";
import type { RegionMountSpots } from "./mount.ts";
import type { NavOptions } from "./nav.ts";
import { levelOf, planBuilding, roomObstacles, type LevelBuilding, type RegionLevel } from "./levelPlan.ts";
import { PropKind, type PropSpawn } from "./props.ts";
import { Rng } from "./rng.ts";
import { createTerrain, valueNoise, type Terrain } from "./terrain.ts";

/**
 * VESPER GORGE, region three (D-037; docs/_notes/regions34.md section 3, docs/_notes/vesper.md). The arid canyon and mineral frontier of the GDD: a dry river's gorge of banded red-violet strata, an ore
 * road up the gorge floor, an iron headframe and an ore trestle, the Assay House where claims are registered, the Long Cloister (the Low Vesper Lamentation Guild's seat, cut into the west cliff), a
 * pegging ground on the west bench and, at the head of the gorge, the Lower Gallery's adit (collapsed behind a rock fall). Home power: the Lamentation Guild (`choir`). Contract family: the Lower Gallery
 * (`mine_rescue`) and the Claim Race (`claim_race`). Fictional cultures only: the miners, the mourners and the clerks are institutions with names, never a people.
 *
 * IDENTITY (against Kessar's coast fort and Highmark's terraced capital): a NEGATIVE-SPACE region. Its silhouette is a CLEFT, not a mass: two cliff walls of banded strata, 30-45 m high, 30-50 m either side
 * of a dry riverbed that climbs to a head wall; most of the horizon is rock and the sky is a strip. `skylineFrom` measures it (vesper.test.ts): from the middle of the road more than 80% of the horizon is
 * walled, from the landing a needle of rock stands against the sky.
 *
 * THE PLAN (one pure description the terrain, the colliders, the props and the client's geometry all read, like kessarPlan / highmarkPlan):
 *  - the gorge floor climbs 3.5% from the landing to the head; the ore road follows its centreline `vesperRoadX(z)`; a dry bed meanders across it (wadeable, 0.5 m deep).
 *  - two benches: the WEST bench (+2.5 m: the Long Cloister, the dirge-master's ground, the pegging ground) and the EAST bench (+2 m: the Assay House). Their feet are TRUE WALLS: beyond `xW(z)` / `xE(z)`
 *    the ground climbs at slope 2.2 (the controller's limit is 1.2), banded with strata ledges, up to a mesa rim 30-45 m above. No collider is needed for a cliff: the heightfield refuses the climb.
 *  - the headframe terrace (+6 m above the floor) is reached only by the east ramp (slope 0.38); the ORE TRESTLE leaves it westward as a floor (a deck box, like Kessar's bridge) six metres over the road
 *    to the tipple ledge on the far wall: the only way onto that ledge.
 *  - the Lower Gallery: the gorge ends in a pocket behind a ROCK FALL (a solid plug across the whole width at z = -96); the eleven miners stand in the pocket. The collision world never changes with
 *    the scenario: the scenery may show the fall opening (`applyScenario`), the walls stay.
 * Metres; x east, z south; yaw is the collision convention. Only the strata noise, the boulders and the scatter depend on the seed.
 *
 * FINAL ANCHOR NUMBERS (every contract number was proved open and reachable in vesper.test.ts; nudged <= 8 m, names and signatures untouched): cloister (-46,44) -> (-40,44); pegging (-42,-30) -> (-38,-30);
 * dirge-master (-40,40) -> (-34,40); mourners (-36,44)/(-44,38) -> (-30,44)/(-38,38); rival surveyors (-30,-34)/(-34,-28) -> (-26,-34)/(-30,-28); the four pegs moved +4 in x; everything else as contracted.
 * (The Syndicate's claim guards stand at the headframe, as contracted; the Company's watch is the foreman.)
 */

export const VESPER_STATUS = { stub: false } as const;   // flipped with REGIONS.vesper.reachable as package C3's last act (D-037)

/** What the client's VesperView may cost (main-pass meshes and triangles, per graphics preset; counted in Node). Package C3 may tighten, never loosen. */
export const VESPER_VIEW_BUDGET: { readonly meshes: Readonly<Record<"test" | "low" | "medium" | "high", number>>; readonly triangles: Readonly<Record<"test" | "low" | "medium" | "high", number>> } = {
  // (declared with a wide type, not `as const`: the contract's tests range over both regions' budgets, so a tightened literal here must not narrow what the other region's may be)
  meshes: { test: 22, low: 28, medium: 44, high: 44 },
  triangles: { test: 120_000, low: 170_000, medium: 440_000, high: 540_000 },
};

/** Story coordinates, same frame as KESSAR_ANCHORS. C3 proves each open and reachable (vesper.test.ts). */
export const VESPER_ANCHORS = {
  bounds: 150,
  /** Staithe Landing: an ore-barge wharf at the gorge mouth on the dry-season river. Everybody arrives here. */
  landing: { x: 0, z: 118 },
  /** The ore road from the landing up the gorge floor to the adit, in walking order (the last is the adit's mouth). */
  road: [{ x: 0, z: 112 }, { x: 0, z: 84 }, { x: -6, z: 50 }, { x: 0, z: 16 }, { x: 8, z: -20 }, { x: 4, z: -54 }, { x: 0, z: -84 }],
  /** The Lower Gallery's mouth (collapsed): the mine rescue's stage. The rock fall is a few metres beyond it. */
  adit: { x: 0, z: -92 },
  /** The ore trestle's foot, at the headframe (the winding gear stands a few metres east of it). */
  headframe: { x: 20, z: -66 },
  /** The Assay House, where claims are registered (the claim race's finish). */
  assay: { x: 30, z: 18 },
  /** The pegging ground on the west bench: four open pegs, one afternoon. */
  pegging: { x: -38, z: -30 },
  /** The Long Cloister, cut into the west cliff: the Guild's seat. */
  cloister: { x: -40, z: 44 },
} as const;

/** Where the people stand (the templates read these; named here so scenario, plan and nav tests agree). */
export const VESPER_SITES = {
  foreman: { x: -6, z: -82 },
  dirgeMaster: { x: -34, z: 40 },
  assayer: { x: 30, z: 22 },
  /** The eleven miners, in three groups behind the fall (they are in the dead-end pocket: nobody reaches them by walking). */
  miners: [{ x: -3, z: -101 }, { x: 0, z: -102 }, { x: 3, z: -101 }],
  mourners: [{ x: -30, z: 44 }, { x: -38, z: 38 }],
  /** The Syndicate's surveyors at the pegging ground. */
  rivalSurveyors: [{ x: -26, z: -34 }, { x: -30, z: -28 }],
  /** The four pegs of the open claim (clockwise from the north-west). */
  claimPegs: [{ x: -44, z: -36 }, { x: -32, z: -36 }, { x: -32, z: -24 }, { x: -44, z: -24 }],
  /** The Syndicate's claim guards at the headframe (they come down the road when the whistle goes). */
  guards: [{ x: 22, z: -62 }, { x: 30, z: -62 }, { x: 22, z: -70 }, { x: 30, z: -70 }],
  /**
   * D-044, the Winding Engine: the Syndicate has leased the Company's winding house (31, -77) and is driving a cross-cut with it. The boiler's feed is at the house's west wall,
   * its engineer stands by the gauge, a guard walks a beat along the terrace; the grit is the tailings heap below the trestle on the ore road.
   */
  engine: {
    boiler: { x: 26.6, z: -77 }, engineer: { x: 25.4, z: -73 }, yard: { x: 25, z: -70 },
    beat: [{ x: 24, z: -60 }, { x: 23, z: -80 }],
    grit: [{ x: 10.5, z: -44 }, { x: 12, z: -45.4 }],
  },
} as const;

/**
 * D-096, the Triangulation: the Society's three trig stations (each in sight of the other two over the gorge, proven by a ray through the world on every seed the tests take: the assay bench,
 * the west bench by the pegging ground, the headframe terrace at the head of the east ramp), the theodolite in its case on the wharf, and the Syndicate's railway surveyors at their own instrument
 * on the west bench (the claim race's surveyors' ground).
 */
export const VESPER_TRIG = {
  stations: [{ x: 34, z: 27 }, { x: -40, z: -31 }, { x: 26, z: -57 }],
  /**
   * The signals themselves, two paces off each station (where the instrument is set up), away from the road and the pegs: a dry-stone cairn, a pole and a whitewashed vane, raised
   * by last season's advance party and standing in every visit (solid: `signalR` round, `signalH` tall). The contract's dress flies the flags on them (client vesper/dress.ts).
   */
  signals: [{ x: 35.6, z: 28.6 }, { x: -42.2, z: -31 }, { x: 23.8, z: -57 }],
  signalR: 0.45, signalH: 3.6,
  theodolite: { x: 3, z: 111 },
  surveyors: [{ x: -26, z: -34 }, { x: -30, z: -28 }],
} as const;

/** What the Lower Gallery's template places: the shoring timber, the powder keg, and where the fall is dug and blown. */
export const VESPER_STOCK = {
  /** Five crates of pit-prop timber in the Company's yard (three shore the fall). */
  timber: [{ x: -12, z: -74 }, { x: -10, z: -72.4 }, { x: -14.2, z: -72.2 }, { x: -12.4, z: -76.4 }, { x: -9.4, z: -75.4 }],
  /** One barrel of blasting powder by the magazine. */
  keg: { x: -18.4, z: -75.6 },
  /** Where the party works the fall by hand (dig, shore), and where a keg goes off (the plug itself). */
  dig: { x: 0, z: -93 },
  blast: { x: 0, z: -96.6 },
} as const;

// ---- the shape of the gorge ----------------------------------------------------------------------------------------------------------------

const FLOOR_Z0 = 118;
/** The gorge floor climbs this much per metre towards the head. */
const FLOOR_SLOPE = 0.035;
/** The terraces' height (absolute): the headframe terrace, the trestle deck and the tipple ledge are one level. */
export const VESPER_TERRACE_Y = 12.4;
const RISE_SLOPE = 2.2;
const HEAD_Z = -112;
const TRESTLE_Z = -66;

/** Knots, nearest the landing first (z descending). */
const ROAD_Z = [118, 112, 84, 50, 16, -20, -54, -84, -140] as const;
const ROAD_X = [0, 0, 0, -6, 0, 8, 4, 0, 0] as const;
/** The west cliff's foot (x) and the east's, by z. */
const XW_Z = [150, 118, 100, 80, 68, 62, 24, 12, -12, -30, -48, -56, -62, -76, -92, -112, -140] as const;
const XW_X = [-62, -34, -33, -36, -50, -53, -53, -46, -48, -52, -52, -48, -44, -30, -14, -12, -12] as const;
const XE_Z = [150, 118, 100, 76, 56, 40, 28, 12, 0, -20, -40, -54, -66, -80, -92, -112, -140] as const;
const XE_X = [62, 34, 30, 28, 32, 40, 47, 47, 40, 34, 36, 40, 40, 34, 14, 12, 12] as const;
/** The cliffs' height above their foot, by z. */
const H_Z = [150, 132, 118, 100, 80, 40, -10, -50, -90, -140] as const;
const H_H = [3, 8, 14, 24, 32, 38, 42, 40, 38, 38] as const;

/** Smooth interpolation of descending-z knots (clamped at the ends). Allocation-free. */
function knot(zs: readonly number[], vs: readonly number[], z: number): number {
  if (z >= zs[0]!) return vs[0]!;
  const n = zs.length;
  for (let i = 1; i < n; i++) {
    if (z >= zs[i]!) {
      const a = zs[i - 1]!, b = zs[i]!;
      const t = (a - z) / (a - b);
      const s = t * t * (3 - 2 * t);
      return vs[i - 1]! + (vs[i]! - vs[i - 1]!) * s;
    }
  }
  return vs[n - 1]!;
}

/** x of the ore road (and of the gorge's centreline) at z. */
export const vesperRoadX = (z: number): number => knot(ROAD_Z, ROAD_X, z);
/** x of the west cliff's foot at z, and of the east's. */
export const vesperWestFoot = (z: number): number => knot(XW_Z, XW_X, z);
export const vesperEastFoot = (z: number): number => knot(XE_Z, XE_X, z);
/** Height of the cliffs above their foot at z. */
export const vesperCliffHeight = (z: number): number => knot(H_Z, H_H, z);
/** The gorge floor's height at z on the road (no noise, no bed): what a person on the road stands on. */
export const vesperFloorY = (z: number): number => FLOOR_SLOPE * (FLOOR_Z0 - z);
/** The plan's own measure of how steep a wall is where it begins (slope at the toe). */
export const VESPER_WALL_SLOPE = RISE_SLOPE;

const STRATA_P = 6;
/** The height a cliff has risen `d` metres beyond its foot (cliff height `H`): a steep face, banded into ledges every `STRATA_P` metres. */
function rise(d: number, H: number): number {
  if (d <= 0) return 0;
  const a = RISE_SLOPE * d;
  const b = a >= 6 * H ? H : H * Math.tanh(a / H);
  return b + 0.9 * Math.sin((TAU * b) / STRATA_P);
}

const FLAT_PIN = 26;

export interface VesperTerrain extends Terrain {
  /** Height of the gorge floor under (x, z) before benches, cliffs and terraces (the floor, the dry bed, the basin): the view paints from it. */
  floor(x: number, z: number): number;
}

/**
 * The ground: the floor climbing to the head, the dry bed, two benches, the headframe terrace with its ramp, the tipple ledge, the basin at the wharf, then the cliffs (steep, banded) and the head wall.
 * Pure and allocation-free; the seed moves only the strata noise and the roughness of the rim.
 */
export function createVesperTerrain(seed: number): VesperTerrain {
  const base = createTerrain(seed, { amplitude: 0.4, wavelength: 56, flatRadius: 0, blend: 1 });
  const L = VESPER_ANCHORS.landing;
  const floor = (x: number, z: number): number => {
    const u = x - vesperRoadX(z);
    const bedU = 4.5 * Math.sin(z * 0.045 + 0.7);
    const bd = Math.abs(u - bedU);
    const pin = smoothstep(14, FLAT_PIN, Math.hypot(x - L.x, z - L.z));
    const bed = -0.5 * (1 - smoothstep(1.5, 4.5, bd)) * pin;
    // the basin at the wharf: the barge's pool
    const basin = -1.2 * smoothstep(124, 133, z) * (1 - smoothstep(7, 12, Math.abs(x)));
    return vesperFloorY(z) + bed + basin + base.height(x, z) * pin;
  };
  const height = (x: number, z: number): number => {
    const fl = floor(x, z);
    const u = x - vesperRoadX(z);
    const au = Math.abs(u);
    let h = fl;
    // the benches: the west is the Guild's and the claim-pegs'; the east is the Assay House's
    if (u < 0) h += 2.5 * smoothstep(-62, -50, z) * (1 - smoothstep(66, 78, z)) * smoothstep(13, 19, au);
    else h += 2.0 * smoothstep(-2, 8, z) * (1 - smoothstep(46, 56, z)) * smoothstep(13, 19, au);
    // the headframe terrace: reached by the east ramp (slope 0.38) and by nothing else; its walls are 6 m tall
    if (z < -39 && x > 15.5) {
      const t = Math.min(1, Math.max(0, (-40 - z) / 18));
      const tgt = fl + (VESPER_TERRACE_Y - fl) * t;
      const tz = smoothstep(-58, -62, z);
      const m = smoothstep(16.5, 18.5, x) * (1 - smoothstep(29.5, 31.5, x) * (1 - tz));
      if (m > 0) h = Math.max(h, h + (tgt - h) * m);
    }
    // the tipple ledge on the west wall, at the trestle's far end (no way up except the deck)
    if (x < -29 && z > -74 && z < -54) {
      const m = (1 - smoothstep(-32, -30, x)) * smoothstep(-74, -72, z) * (1 - smoothstep(-56, -54, z));
      if (m > 0) h = Math.max(h, h + (VESPER_TERRACE_Y - h) * m);
    }
    // the deck's two landings. The shared step's slope check reads the TERRAIN, not the deck a walker stands on, so where the deck passes over ground that RISES in the direction of travel the ground itself
    // must be a gentle ramp (0.8) under it: a strip as wide as the deck, hidden by it (its underside stops a walker below at head height; the strips' sides are the same walls as the faces).
    if (z > -68.6 && z < -63.4 && (x > 7 || x < -23)) {
      const mz = smoothstep(-68.6, -67.6, z) * (1 - smoothstep(-64.4, -63.4, z));
      const t = x > 0 ? Math.min(1, Math.max(0, (x - 7.5) / 8)) : Math.min(1, Math.max(0, (-24 - x) / 7.5));
      const tgt = fl + (VESPER_TERRACE_Y - fl) * t;
      if (mz > 0 && tgt > h) h = h + (tgt - h) * mz;
    }
    // the cliffs and the head wall
    const dW = vesperWestFoot(z) - x;
    const dE = x - vesperEastFoot(z);
    const d = dW > dE ? dW : dE;
    const hh = vesperCliffHeight(z);
    let r = d > 0 ? rise(d, hh) : 0;
    if (z < HEAD_Z) {
      const rh = rise(HEAD_Z - z, hh);
      if (rh > r) r = rh;
    }
    if (r > 0) {
      const n = valueNoise(seed + 77, x / 13, z / 13) - 0.5;
      r += n * 3.2 * smoothstep(3, 16, Math.max(d, HEAD_Z - z));
    }
    return h + r;
  };
  return { height, floor };
}

// ---- the road -------------------------------------------------------------------------------------------------------------------------

/** Half the width of the ore road, and the tracks that branch off it. */
export const VESPER_ROAD_HALF = 2.6;
/** The side tracks: from the road to the Assay House, the Long Cloister and the pegging ground. */
export const vesperTracks = (): readonly { ax: number; az: number; bx: number; bz: number }[] => TRACKS;
const TRACKS = [
  { ax: 0, az: 18, bx: 30, bz: 18 },
  { ax: -5, az: 44, bx: -40, bz: 44 },
  { ax: 7, az: -30, bx: -38, bz: -30 },
] as const;

function trackDistance(x: number, z: number): number {
  let best = Infinity;
  for (const t of TRACKS) best = Math.min(best, segmentDistance(x, z, t.ax, t.az, t.bx, t.bz));
  return best;
}

/** Distance from (x, z) to the ore road (the centreline from the landing to the adit) or to a side track. */
export function vesperRoadDistance(x: number, z: number): number {
  const zc = z > 114 ? 114 : z < -92 ? -92 : z;
  let best = Math.hypot(x - vesperRoadX(zc), z - zc) * 0.99;
  for (const t of TRACKS) {
    const d = segmentDistance(x, z, t.ax, t.az, t.bx, t.bz);
    if (d < best) best = d;
  }
  return best;
}
/** 0..1 closeness to the road (1 on the carriageway, 0 beyond its verge): the view's paint, the scatter's keep-out. */
export const vesperRoadness = (x: number, z: number): number => 1 - smoothstep(VESPER_ROAD_HALF - 0.6, VESPER_ROAD_HALF + 1.4, vesperRoadDistance(x, z));

/** The road as a polyline for the view's rails and the tests (landing to adit, every 6 m). */
export function vesperRoad(): readonly { x: number; z: number }[] {
  if (cachedRoad) return cachedRoad;
  const out: { x: number; z: number }[] = [];
  for (let z = 114; z > -92; z -= 6) out.push({ x: vesperRoadX(z), z });
  out.push({ x: vesperRoadX(-92), z: -92 });
  cachedRoad = out;
  return out;
}
let cachedRoad: { x: number; z: number }[] | undefined;

// ---- the authored things --------------------------------------------------------------------------------------------------------------

export interface VesperBox { x: number; z: number; yaw: number; hx: number; hz: number; height: number }
export interface VesperRound { x: number; z: number; r: number; height: number }
/** A hanging cloth: `top` is its top edge above the ground where it hangs; yaw is the direction its face looks (collision yaw: +x at 0). */
/** A banner: free-standing on its own post, or hung from an iron rod on arms `wall` metres out from a wall (billowing away from it, never into it). */
export interface VesperBanner { x: number; z: number; yaw: number; top: number; w: number; h: number; kind: "guild" | "syndicate" | "company"; wall?: number }
export interface VesperSign { x: number; z: number; yaw: number; text: number }

export interface VesperPlan {
  /** The Long Cloister: a gallery of arches along the foot of the west cliff, with a bell-gable. */
  cloister: VesperBox & { arches: number };
  assay: VesperBox;
  /** The Assay House's furnace stack. */
  chimney: VesperRound;
  /** The Company's yard at the head: the foreman's office, the powder magazine, the timber stack. */
  office: VesperBox;
  magazine: VesperBox;
  timberStack: VesperBox;
  /** The winding house and the headframe over the Lower Gallery's shaft (the headframe is a lattice; its footprint is the collider). */
  winding: VesperBox;
  headframe: VesperBox & { y: number };
  /** The ore trestle: a deck from the headframe west across the gorge to the tipple ledge, on piles; the deck's top is `y`. */
  trestle: { z: number; x0: number; x1: number; hz: number; y: number; piles: { x: number; z: number }[] };
  tipple: VesperBox;
  /** The rock fall across the gorge: a plug (collider) the view buries in rubble. */
  fall: { x: number; z: number; hx: number; hz: number; height: number };
  /** Lamp posts: lit at dusk. */
  lamps: { x: number; z: number; h: number }[];
  signs: VesperSign[];
  banners: VesperBanner[];
  /** The pegs, the surveyors' tents, the claim guards' tents, the camp fire. */
  pegs: { x: number; z: number }[];
  tents: { x: number; z: number; yaw: number; kind: "syndicate" | "company" | "guild" }[];
  /** Ore carts on the road's verge. */
  carts: { x: number; z: number; yaw: number }[];
  /** Spoil heaps (decor with a collider): at the adit and the headframe. */
  spoil: VesperRound[];
  /** Rock needles on the plateau beyond the rim: the horizon's verticals (unreachable). `height` is above the ground they stand on. */
  needles: VesperRound[];
  wharf: { x: number; z0: number; z1: number; half: number; y: number; barge: { x: number; z: number; yaw: number }; bollards: { x: number; z: number }[]; pool: { x: number; z: number; r: number; y: number } };
}

/** Signage: Latin letters, satire at the institutions of a gorge that bills per outcome. */
export const VESPER_SIGN_TEXT_KEYS = 6;

let cachedPlan: VesperPlan | undefined;

export function vesperPlan(): VesperPlan {
  if (cachedPlan) return cachedPlan;
  const A = VESPER_ANCHORS;
  const S = VESPER_SITES;
  const T = VESPER_TERRACE_Y;
  const cloister = { x: -47.5, z: 44, yaw: 0, hx: 5.5, hz: 18, height: 7.2, arches: 7 };
  const assay: VesperBox = { x: 39, z: 16, yaw: 0, hx: 5.5, hz: 5, height: 6.4 };
  const chimney: VesperRound = { x: 43.5, z: 10, r: 0.9, height: 17 };
  // (D-038: the office moved 4 m east and 3 m south: at (-19,-84) its north-west corner stood in the cliff's foot, on a 3.5 m slope)
  const office: VesperBox = { x: -15, z: -81, yaw: 0, hx: 3.6, hz: 3, height: 3.6 };
  const magazine: VesperBox = { x: -24, z: -73, yaw: 0, hx: 2.4, hz: 2, height: 2.6 };
  const timberStack: VesperBox = { x: -22, z: -78.4, yaw: 0.1, hx: 1.8, hz: 1.2, height: 1.4 };
  const winding: VesperBox = { x: 31, z: -77, yaw: 0, hx: 3, hz: 3, height: 4.4 };
  const headframe = { x: A.headframe.x + 6, z: A.headframe.z, yaw: 0, hx: 2.4, hz: 2.4, height: 24, y: T };
  const trestle = { z: TRESTLE_Z, x0: -34, x1: headframe.x - headframe.hx, hz: 1.5, y: T, piles: [] as { x: number; z: number }[] };
  for (let x = 10; x >= -26; x -= 9) for (const s of [-1, 1]) trestle.piles.push({ x, z: TRESTLE_Z + s * 1.15 });
  // (D-038: the tipple moved 2.8 m south, onto the ledge's flat: its north half stood on the cliff's slope)
  const tipple: VesperBox = { x: -38, z: -63.2, yaw: 0, hx: 3, hz: 3.2, height: 5.2 };
  const fall = { x: 0, z: -96, hx: 16, hz: 1.9, height: 6 };

  const lamps: { x: number; z: number; h: number }[] = [];
  for (const z of [100, 76, 52, 28, 4, -20, -44, -70]) {
    const x = vesperRoadX(z);
    for (const [lx, lz] of [[x + 4.4, z], [vesperRoadX(z - 14) - 4.4, z - 14]] as const) if (trackDistance(lx, lz) > 3.2) lamps.push({ x: lx, z: lz, h: 3.4 });
  }
  lamps.push({ x: -31, z: 52, h: 3.2 }, { x: -31, z: 34, h: 3.2 }, { x: 33, z: 22, h: 3.2 }, { x: -36, z: -22, h: 3.2 }, { x: -12.5, z: -87.6, h: 3.4 }, { x: 6, z: -90, h: 3.4 }, { x: -6, z: -90, h: 3.4 });

  const signs: VesperSign[] = [
    { x: 4.4, z: 112.5, yaw: Math.PI / 2, text: 0 },
    { x: -25, z: 49, yaw: 0, text: 1 },
    { x: 26, z: 12, yaw: Math.PI, text: 2 },
    { x: 5.3, z: -88, yaw: Math.PI / 2, text: 3 },
    { x: -13, z: -22, yaw: 0, text: 4 },
    { x: -8.6, z: -86.6, yaw: 0, text: 5 },
  ];
  // the Guild's two great banners hang on the faces of the cloister's second and seventh piers, in front of their pilasters (they hung at z 33 and 55, across
  // a pilaster each: the column ran down through the cloth). A pier is 2.4 m across; its pilaster is a 0.3 m column on its face, so the rod stands 0.5 m out.
  const pierZ = (i: number): number => cloister.z - cloister.hz + CLOISTER.pierW / 2 + i * (CLOISTER.pierW + CLOISTER.archClear);
  const banners: VesperBanner[] = [
    { x: CLOISTER.frontX + 0.5, z: pierZ(1), yaw: 0, top: 6.6, w: 2.2, h: 4.8, kind: "guild", wall: 0.5 },
    { x: CLOISTER.frontX + 0.5, z: pierZ(6), yaw: 0, top: 6.6, w: 2.2, h: 4.8, kind: "guild", wall: 0.5 },
    { x: S.dirgeMaster.x + 3.6, z: S.dirgeMaster.z - 2.6, yaw: Math.PI / 2, top: 4.6, w: 1.6, h: 3.1, kind: "guild" },
    // (D-038: hung beside the office's door, no longer across it)
    { x: office.x + office.hx + 0.08, z: office.z + 2.1, yaw: 0, top: 3.4, w: 1.5, h: 2.4, kind: "company", wall: 0.08 },
    { x: S.rivalSurveyors[0]!.x - 3.4, z: S.rivalSurveyors[0]!.z - 3.2, yaw: Math.PI / 2, top: 4.8, w: 1.9, h: 3.2, kind: "syndicate" },
    { x: S.guards[1]!.x + 3.5, z: S.guards[1]!.z + 1, yaw: Math.PI / 2, top: 5.2, w: 1.9, h: 3.2, kind: "syndicate" },
  ];
  const tents: VesperPlan["tents"] = [
    { x: -23, z: -42, yaw: 0.3, kind: "syndicate" }, { x: -17, z: -35, yaw: -0.25, kind: "syndicate" },
    { x: 22.5, z: -84.5, yaw: 0.2, kind: "syndicate" },
  ];
  const carts = [{ x: vesperRoadX(-34) + 5.6, z: -34, yaw: 0.3 }, { x: vesperRoadX(22) - 5.6, z: 22, yaw: -0.2 }, { x: vesperRoadX(66) + 5.6, z: 66, yaw: 0.1 }];
  const spoil: VesperRound[] = [{ x: 9.5, z: -88, r: 2.6, height: 2.2 }, { x: 12, z: -78, r: 2.0, height: 1.6 }, { x: -9.5, z: -91, r: 1.8, height: 1.4 }];
  // needles: two stand just past the rim near the mouth, so the skyline from the landing carries a vertical; the rest stand along the plateau
  const needles: VesperRound[] = [
    { x: 74, z: 92, r: 3.2, height: 24 }, { x: -70, z: 100, r: 2.6, height: 19 }, { x: 66, z: 40, r: 2.8, height: 22 }, { x: -82, z: 20, r: 3.0, height: 21 },
    { x: 60, z: -30, r: 2.6, height: 18 }, { x: -72, z: -62, r: 3.0, height: 24 }, { x: 52, z: -118, r: 3.4, height: 22 },
  ];
  const wharf = {
    x: 0, z0: 119.5, z1: 133.5, half: 1.7, y: 0,
    barge: { x: 4.6, z: 130, yaw: 0.06 },
    bollards: [{ x: -2.3, z: 121.5 }, { x: 2.3, z: 121.5 }, { x: -2.3, z: 131.5 }, { x: 2.3, z: 131.5 }],
    pool: { x: 0, z: 134, r: 8, y: -1.1 },
  };
  cachedPlan = {
    cloister, assay, chimney, office, magazine, timberStack, winding, headframe, trestle, tipple, fall, lamps, signs, banners,
    pegs: S.claimPegs.map((p) => ({ x: p.x, z: p.z })), tents, carts, spoil, needles, wharf,
  };
  return cachedPlan;
}

// ---- the level plan (D-038; docs/LEVEL_PLAN.md section 7) ------------------------------------------------------------------------------------

/** The Long Cloister's gallery, built from the plan's box: a back mass (the cliff's own rock), a colonnade of eight broad piers with seven arches 2.4 m clear between them, and a corridor 3.1 m deep behind. */
export const CLOISTER = {
  /** The back mass's front face and the piers' two faces (x), the corridor between them. */
  backX: -46, pierIn: -42.9, frontX: -42,
  arches: 7, archClear: 2.4, pierW: 2.4,
  /** The records room at the north end: z0..z1, and the corridor's two ends. */
  recordsZ0: 26, recordsZ1: 33.2, southEnd: 61.7,
} as const;

/** The sealed facades' notices (the Guild's, the Company's), in the gorge's voice. */
export const VESPER_SEALED_SIGNS = { assay: "CLAIMS WINDOW: SEE WINDOW", office: "CLOSED. THE LEDGER IS OPEN.", magazine: "NO NAMING OF POWDER" } as const;

let cachedLevel: RegionLevel | undefined;
/**
 * What every building of the gorge IS. The Long Cloister is `open-front`: seven arches open onto a lit gallery (the hero reward) with the Records Room (an `interior`, a door 1.5 m wide) at its north end; the Assay House,
 * the Company's office and the magazine are `sealed` (iron grille, locked, padlocked: each with its notice); the winding house and the tipple are `solid`; the Syndicate's three tents are `tent`s.
 */
export function vesperLevel(): RegionLevel {
  if (cachedLevel) return cachedLevel;
  const p = vesperPlan();
  const c = p.cloister;
  const C = CLOISTER;
  const at = (b: VesperBox, yaw = b.yaw): { x: number; z: number; yaw: number; hx: number; hz: number } => ({ x: b.x, z: b.z, yaw, hx: yaw === b.yaw ? b.hx : b.hx, hz: b.hz });
  const gz0 = C.recordsZ1, gz1 = C.southEnd;
  const buildings: LevelBuilding[] = [
    planBuilding("cloister", "open-front", at(c), { height: c.height, floor: 0, wallH: c.height, rect: { x: (C.backX + C.pierIn) / 2, z: (gz0 + gz1) / 2, hx: (C.pierIn - C.backX) / 2, hz: (gz1 - gz0) / 2 } }),
    planBuilding("records", "interior", { x: (C.backX + C.pierIn) / 2, z: (C.recordsZ0 + C.recordsZ1) / 2, yaw: Math.PI / 2, hx: (C.recordsZ1 - C.recordsZ0) / 2, hz: (C.pierIn - C.backX) / 2 }, { height: 7.2, floor: 0.25, wallH: 6.9 }),
    planBuilding("assay", "sealed", at(p.assay, Math.PI), { height: p.assay.height, floor: 0, wallH: p.assay.height, sign: VESPER_SEALED_SIGNS.assay }),
    planBuilding("office", "sealed", at(p.office), { height: p.office.height, floor: 0, wallH: p.office.height, sign: VESPER_SEALED_SIGNS.office }),
    planBuilding("magazine", "sealed", at(p.magazine), { height: p.magazine.height, floor: 0, wallH: p.magazine.height, sign: VESPER_SEALED_SIGNS.magazine }),
    planBuilding("winding", "solid", at(p.winding), { height: p.winding.height, floor: 0, wallH: p.winding.height }),
    planBuilding("tipple", "solid", at(p.tipple), { height: p.tipple.height, floor: 0, wallH: p.tipple.height }),
    ...p.tents.map((t, i) => planBuilding(`syndicate.tent${i}`, "tent", { x: t.x, z: t.z, yaw: t.yaw, hx: 2, hz: 1.6 }, { height: 2.4, floor: 0, wallH: 2.4 })),
  ];
  cachedLevel = levelOf(buildings);
  return cachedLevel;
}

/** The solids of the Long Cloister: back mass, eight piers, the corridor's south end, and the records room (its own walls, a lintel over its door). */
function cloisterObstacles(terrain: Terrain, out: Obstacle[]): void {
  const c = vesperPlan().cloister;
  const C = CLOISTER;
  const g = (x: number, z: number): number => terrain.height(x, z);
  const box = (x: number, z: number, hx: number, hz: number, h: number): void => {
    const y = g(x, z);
    out.push({ kind: "box", tag: "house", x, z, hx, hz, yaw: 0, y0: y - 1, y1: y + h });
  };
  const z0 = c.z - c.hz, z1 = c.z + c.hz;
  // the cliff's mass behind the gallery (the cloister is cut into it)
  box((c.x - c.hx + C.backX) / 2, c.z, (C.backX - (c.x - c.hx)) / 2, c.hz, c.height);
  // the colonnade: eight broad piers, an arch between each pair
  const pitch = C.pierW + C.archClear;
  for (let i = 0; i <= C.arches; i++) box((C.pierIn + C.frontX) / 2, z0 + C.pierW / 2 + i * pitch, (C.frontX - C.pierIn) / 2, C.pierW / 2, c.height);
  // the corridor's south end
  box((C.backX + C.pierIn) / 2, z1 - 0.15, (C.pierIn - C.backX) / 2, 0.15, c.height);
  // the records room at the north end
  const rec = vesperLevel().buildings.find((b) => b.id === "records")!;
  out.push(...roomObstacles(rec, g(rec.x, rec.z)));
}

// ---- colliders --------------------------------------------------------------------------------------------------------------------------

/**
 * Everything solid in the gorge: the buildings, the headframe, the trestle (deck, rails, piles), the rock fall, the lamps, signs, pegs, tents, carts, spoil, the wharf, the needles, then the seeded
 * boulders of the floor and the benches on their own Rng stream. The cliffs have no collider: the ground itself is the wall.
 */
export function vesperObstacles(terrain: Terrain, seed: number): Obstacle[] {
  const plan = vesperPlan();
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
  cloisterObstacles(terrain, out);
  box("house", plan.assay.x, plan.assay.z, plan.assay.hx, plan.assay.hz, 0, plan.assay.height);
  circle("pole", plan.chimney.x, plan.chimney.z, plan.chimney.r, plan.chimney.height);
  for (const b of [plan.office, plan.magazine, plan.winding, plan.tipple]) box("house", b.x, b.z, b.hx, b.hz, b.yaw, b.height);
  box("crate", plan.timberStack.x, plan.timberStack.z, plan.timberStack.hx, plan.timberStack.hz, plan.timberStack.yaw, plan.timberStack.height);
  const h = plan.headframe;
  out.push({ kind: "box", tag: "house", x: h.x, z: h.z, hx: h.hx, hz: h.hz, yaw: h.yaw, y0: h.y - 1, y1: h.y + h.height });
  // the trestle: a deck (a floor, like Kessar's bridge), rails along its edges, piles under it
  const t = plan.trestle;
  const xm = (t.x0 + t.x1) / 2, hx = (t.x1 - t.x0) / 2;
  // (the deck is NOT tagged "bridge": the nav grid is one layer and treats a bridge as a floor over its footprint, which would cut the ore road where it passes under the trestle. Players stand on it all
  // the same: the shared step takes the top of any solid low enough to step onto. Its piles are poles, for the same reason.)
  out.push({ kind: "box", tag: "wall", x: xm, z: t.z, hx, hz: t.hz, yaw: 0, y0: t.y - 0.8, y1: t.y });
  // (the rails stop at the terrace's edge, x = 15: the deck's first metres are terrace ground, where a walker steps onto it)
  const rx0 = t.x0 + 0.2, rx1 = 15;
  for (const s of [-1, 1]) out.push({ kind: "box", tag: "wall", x: (rx0 + rx1) / 2, z: t.z + s * (t.hz - 0.06), hx: (rx1 - rx0) / 2, hz: 0.07, yaw: 0, y0: t.y, y1: t.y + 1.1 });
  for (const p of t.piles) out.push({ kind: "circle", tag: "pole", x: p.x, z: p.z, r: 0.45, y0: g(p.x, p.z) - 1, y1: t.y - 0.8 });
  // the fall: a solid plug across the whole width of the gorge's head (the cliffs beyond its ends are the ground itself)
  const f = plan.fall;
  const fy = g(f.x, f.z);
  out.push({ kind: "box", tag: "rock", x: f.x, z: f.z, hx: f.hx, hz: f.hz, yaw: 0, y0: fy - 2, y1: fy + f.height });
  for (const s of plan.spoil) circle("rock", s.x, s.z, s.r, s.height);
  for (const l of plan.lamps) circle("pole", l.x, l.z, 0.18, l.h);
  for (const s of plan.signs) circle("sign", s.x, s.z, 0.12, 2);
  for (const s of VESPER_TRIG.signals) circle("pole", s.x, s.z, VESPER_TRIG.signalR, VESPER_TRIG.signalH);   // D-096: the trig signals (their cairns)
  for (const k of plan.tents) box("tent", k.x, k.z, 2, 1.6, k.yaw, 2.4);
  for (const k of plan.carts) circle("cart", k.x, k.z, 1.1, 1.3);
  for (const b of plan.banners) if (b.kind === "syndicate" || b.kind === "guild") if (b.top < 6) circle("flag", b.x, b.z, 0.15, b.top);
  // the wharf: planks over the basin's rim (walkable: the top is the landing's level), bollards
  const q = plan.wharf;
  out.push({ kind: "box", tag: "jetty", x: q.x, z: (q.z0 + q.z1) / 2, hx: q.half, hz: (q.z1 - q.z0) / 2, yaw: 0, y0: q.y - 3, y1: q.y });
  for (const b of q.bollards) circle("pole", b.x, b.z, 0.2, 0.9);
  // the needles stand on the plateau, far from anywhere a person can reach
  for (const n of plan.needles) circle("rock", n.x, n.z, n.r, n.height);

  // THE CLIFFS' COLLIDERS. The heightfield alone refuses a grounded walker (slope 2.2 against the controller's 1.2), but the shared step lets an AIRBORNE one land on whatever the ground is by the time
  // he stops rising, so a run of jumps would climb any slope. A cliff is therefore also a row of slim solids buried in its toe (their near face a few centimetres inside the foot, 3 m tall: out of
  // reach of a jump, under the visible rock): the wall you see is the wall you bump into. The same for the terrace's and the tipple ledge's six-metre faces.
  const wallSeg = (tag: Obstacle["tag"], ax: number, az: number, bx: number, bz: number, outX: number, outZ: number, hz: number, y1: (cx: number, cz: number) => number, y0: (cx: number, cz: number) => number): void => {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    let nx = dz / len, nz = -dx / len;
    if (nx * outX + nz * outZ < 0) { nx = -nx; nz = -nz; }
    const cx = (ax + bx) / 2 + nx * (hz - 0.05), cz = (az + bz) / 2 + nz * (hz - 0.05);
    out.push({ kind: "box", tag, x: cx, z: cz, hx: len / 2 + 0.4, hz, yaw: Math.atan2(dz, dx), y0: y0(cx, cz), y1: y1(cx, cz) });
  };
  const rock = (cx: number, cz: number): number => g(cx, cz) + 3;
  const deep = (cx: number, cz: number): number => g(cx, cz) - 2;
  for (const [foot, side] of [[vesperWestFoot, -1], [vesperEastFoot, 1]] as const) {
    let px = foot(140) + side * 0.3, pz = 140;
    for (let z = 137; z >= HEAD_Z + 0.5; z -= 3) {
      const x = foot(z) + side * 0.3;
      wallSeg("cliff", px, pz, x, z, side, 0, 1, rock, deep);
      px = x;
      pz = z;
    }
    wallSeg("cliff", px, pz, foot(HEAD_Z) + side * 0.3, HEAD_Z, side, 0, 1, rock, deep);
  }
  wallSeg("cliff", vesperWestFoot(HEAD_Z), HEAD_Z - 0.3, vesperEastFoot(HEAD_Z), HEAD_Z - 0.3, 0, -1, 1, rock, deep);
  // the terrace, the ramp's sides and the ledge: parapet-high walls on the edge of each (the face below them is the visible rock)
  const T = VESPER_TERRACE_Y;
  const edge = (ax: number, az: number, bx: number, bz: number, inX: number, inZ: number): void =>
    wallSeg("wall", ax, az, bx, bz, -inX, -inZ, 0.7, (cx, cz) => Math.max(g(cx + inX * 1.7, cz + inZ * 1.7), g(cx + inX * 2.5, cz + inZ * 2.5)) + 0.6, (cx, cz) => g(cx - inX * 1.7, cz - inZ * 1.7) - 1);
  // (the terrace's west face has a gap where the deck leaves it, z -68..-64)
  for (let z = -46; z > -64; z -= 3) edge(17, z, 17, Math.max(-64, z - 3), 1, 0);
  for (let z = -68; z > -92; z -= 3) edge(17, z, 17, Math.max(-92, z - 3), 1, 0);
  for (let z = -46; z > -59; z -= 3) edge(31, z, 31, Math.max(-59, z - 3), -1, 0);
  for (let x = 31; x < 41; x += 3) edge(x, -59.6, Math.min(41, x + 3), -59.6, 0, -1);
  // the tipple ledge: its east face (with the deck's gap), south face and north face
  for (let z = -72; z < -55; z += 3) {
    const a = z, b = Math.min(-55, z + 3);
    if (b <= -68) edge(-31, a, -31, b, -1, 0);
    else if (a >= -64) edge(-31, a, -31, b, -1, 0);
  }
  for (let x = -44; x < -31; x += 3) edge(x, -55.2, Math.min(-31, x + 3), -55.2, 0, -1);
  for (let x = -44; x < -33; x += 3) edge(x, -72.8, Math.min(-33, x + 3), -72.8, 0, 1);

  // seeded boulders: the floor and the benches, kept off the road, the buildings and every story point
  const sites = vesperSitePoints();
  const rng = new Rng(seed ^ 0x7e5b3a1);
  const mounts = VESPER_MOUNT_SPOTS;
  const spots = [...mounts.horses, mounts.wagon];
  const free = (x: number, z: number, gap: number): boolean => {
    if (Math.hypot(x, z) > VESPER_ANCHORS.bounds - 6) return false;
    if (x < vesperWestFoot(z) + 3 || x > vesperEastFoot(z) - 3) return false;
    if (z < -108 || z > 108) return false;
    if (vesperRoadDistance(x, z) < VESPER_ROAD_HALF + 1.8 + gap) return false;
    for (const s of sites) if (Math.hypot(s.x - x, s.z - z) < 5 + gap) return false;
    for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < 5 + gap) return false;
    if (Math.abs(g(x + 1, z) - g(x - 1, z)) + Math.abs(g(x, z + 1) - g(x, z - 1)) > 1.1) return false;
    // not on the terrace or the ledge (their edges are walls) and not under the trestle
    if (z < -39 && x > 12) return false;
    if (x < -27 && z < -52 && z > -76) return false;
    if (Math.abs(z - TRESTLE_Z) < 4 && x < 18 && x > -34) return false;
    for (const o of out) {
      if (o.tag === "rock" && o.x > 60) continue;
      const r = (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + gap;
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < r * r) return false;
    }
    return true;
  };
  for (let i = 0, tries = 0; i < 46 && tries < 900; tries++) {
    const z = rng.range(-106, 106);
    const x = rng.range(vesperWestFoot(z) + 3, vesperEastFoot(z) - 3);
    if (!free(x, z, 1.6)) continue;
    const r = rng.range(0.55, 1.5);
    const y = g(x, z);
    out.push({ kind: "circle", tag: "rock", x, z, r, y0: y - 1.2, y1: y + r * rng.range(1.1, 1.7) });
    i++;
  }
  return out;
}

export function createVesperWorld(seed: number): CollisionWorld {
  const terrain = createVesperTerrain(seed);
  return new CollisionWorld(terrain, vesperObstacles(terrain, seed), VESPER_ANCHORS.bounds);
}

/** The landing: a ring of up to four on the wharf-side bank (never on the planks). */
export function vesperSpawn(index: number, count = 4): { x: number; z: number } {
  const a = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 4;
  const L = VESPER_ANCHORS.landing;
  return { x: L.x + Math.cos(a) * 2.6, z: L.z - 1.4 - ARRIVAL_INLAND + Math.sin(a) * 1.2 } /* (D-070: up the shore, off the jetty's first planks) */;
}

/**
 * The props a visit starts with: ore crates and a bottle or two at the landing, chairs (a funeral's worth) in front of the Long Cloister, crates at the Assay House and the pegging ground.
 * Deterministic, never in anything solid; no barrel (the only powder in the gorge is the Company's keg, which the Lower Gallery's template places).
 */
export function vesperProps(seed: number, world: CollisionWorld): PropSpawn[] {
  const out: PropSpawn[] = [];
  const rng = new Rng(seed ^ 0x51c0ffe);
  const pos = { x: 0, z: 0 };
  const L = VESPER_ANCHORS.landing;
  const spots: { x: number; z: number; r: number; n: number; kinds: PropSpawn["kind"][] }[] = [
    { x: L.x - 2, z: L.z - 7, r: 6, n: 5, kinds: [PropKind.CRATE, PropKind.CRATE, PropKind.BOTTLE, PropKind.CRATE, PropKind.BOTTLE] },
    { x: -33, z: 46, r: 4, n: 4, kinds: [PropKind.CHAIR, PropKind.CHAIR, PropKind.CHAIR, PropKind.BOTTLE] },
    { x: 30, z: 25, r: 4, n: 3, kinds: [PropKind.CRATE, PropKind.CRATE, PropKind.CHAIR] },
    { x: -30, z: -30, r: 5, n: 3, kinds: [PropKind.CRATE, PropKind.CHAIR, PropKind.BOTTLE] },
    { x: 4, z: -48, r: 4, n: 2, kinds: [PropKind.CRATE, PropKind.CRATE] },
  ];
  for (const s of spots) {
    for (let i = 0, tries = 0; i < s.n && tries < 80; tries++) {
      const a = rng.range(0, TAU);
      const d = rng.range(1.8, s.r);
      const x = s.x + Math.cos(a) * d;
      const z = s.z + Math.sin(a) * d;
      pos.x = x;
      pos.z = z;
      if (world.resolveXZ(pos, world.terrainHeight(x, z), 0.6, 1.2) || vesperRoadDistance(x, z) < 1.6) continue;
      let near = false;
      for (const p of vesperSitePoints()) if (Math.hypot(p.x - x, p.z - z) < 1.6) near = true;
      if (near) continue;
      out.push({ kind: s.kinds[i % s.kinds.length]!, x, z, yaw: rng.range(0, TAU) });
      i++;
    }
  }
  return out;
}

/** Every story point of the region, named (the scatter keeps clear of them and the tests prove each is open and reachable). */
export function vesperSitePoints(): { id: string; x: number; z: number }[] {
  const A = VESPER_ANCHORS, S = VESPER_SITES, K = VESPER_STOCK;
  return [
    { id: "landing", ...A.landing }, { id: "adit", ...A.adit }, { id: "headframe", ...A.headframe }, { id: "assay", ...A.assay }, { id: "pegging", ...A.pegging }, { id: "cloister", ...A.cloister },
    { id: "foreman", ...S.foreman }, { id: "dirgeMaster", ...S.dirgeMaster }, { id: "assayer", ...S.assayer },
    ...S.miners.map((p, i) => ({ id: `miners${i}`, ...p })), ...S.mourners.map((p, i) => ({ id: `mourners${i}`, ...p })),
    ...S.rivalSurveyors.map((p, i) => ({ id: `surveyor${i}`, ...p })), ...S.claimPegs.map((p, i) => ({ id: `peg${i}`, ...p })), ...S.guards.map((p, i) => ({ id: `guard${i}`, ...p })),
    ...K.timber.map((p, i) => ({ id: `timber${i}`, ...p })), { id: "keg", ...K.keg }, { id: "dig", ...K.dig },
    { id: "engine.boiler", ...S.engine.boiler }, { id: "engine.engineer", ...S.engine.engineer }, { id: "engine.yard", ...S.engine.yard },
    ...S.engine.beat.map((p, i) => ({ id: `engine.beat${i}`, ...p })), ...S.engine.grit.map((p, i) => ({ id: `engine.grit${i}`, ...p })),
    // D-096: the trig stations and the theodolite's case (the surveyors stand on the claim race's spots, already here)
    ...VESPER_TRIG.stations.map((p, i) => ({ id: `trig.station${i}`, ...p })), { id: "trig.theodolite", ...VESPER_TRIG.theodolite },
  ];
}

/** Navigation options (the nav grid): rooted at the landing (the pocket behind the fall is sealed: it prunes itself). */
export function vesperNavOptions(_world: CollisionWorld): NavOptions {
  return { tag: "vesper", roots: [VESPER_ANCHORS.landing] };
}

/** Where the manifest's horses and wagon are put at landfall: a ring behind the landing, on the open wharf-side ground (z <= 108). */
export const VESPER_MOUNT_SPOTS: RegionMountSpots = {
  horses: [{ x: -5, z: 108, yaw: 0.4 }, { x: 5, z: 108, yaw: -0.4 }],
  wagon: { x: 0, z: 102, yaw: 0 },
};

/** The HUD's prompts and the server's "post" use points (acted on through the scenario). */
export const VESPER_STATIONS: readonly UseStation[] = [
  { id: "dock", kind: "dock", x: VESPER_ANCHORS.landing.x, z: VESPER_ANCHORS.landing.z, r: 4, prompt: "Take the ore barge home" },
  { id: "foreman", kind: "post", x: VESPER_SITES.foreman.x, z: VESPER_SITES.foreman.z, r: 2.6, prompt: "Speak to the foreman" },
  { id: "dirge_master", kind: "post", x: VESPER_SITES.dirgeMaster.x, z: VESPER_SITES.dirgeMaster.z, r: 2.6, prompt: "Call on the Dirge-Master" },
  { id: "assayer", kind: "post", x: VESPER_SITES.assayer.x, z: VESPER_SITES.assayer.z, r: 2.6, prompt: "Present a claim at the Assay House" },
];
