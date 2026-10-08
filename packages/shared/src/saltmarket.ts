import { ARRIVAL_INLAND } from "./campaignTypes.ts";
import type { UseStation } from "./campaignTypes.ts";
import { CollisionWorld, type Obstacle } from "./collision.ts";
import { distToPaths, inDoorApron, levelOf, planBuilding, roomObstacles, type LevelBuilding, type RegionLevel } from "./levelPlan.ts";
import { TAU, smoothstep } from "./math.ts";
import type { RegionMountSpots } from "./mount.ts";
import type { NavOptions } from "./nav.ts";
import { PropKind, type PropKindId, type PropSpawn } from "./props.ts";
import { Rng, hash3 } from "./rng.ts";
import { createTerrain, type Terrain } from "./terrain.ts";

/**
 * THE SALTMARKET DELTA, region four (D-037; docs/_notes/regions34.md section 4). The delta and wetland trading region of the GDD: braided channels across a flat silt plain, stilted warehouses and a boardwalk
 * network, a floating quay, the Customs House of the Tide Constabulary, a reed cove where cargo is not landed, and the Exchange, a hall that floods at every spring tide and holds its sale regardless. Home
 * power: the Brine Houses (`brine`), a merchant oligarchy that decides by auction. Contract family: the Quiet Barge (`smuggling_run`) and the Auction at High Water (`flooded_market`). Fictional cultures only:
 * the Houses, the Constabulary and the bargemen are institutions with names, never a people.
 *
 * Identity (against Kessar's coast fort, Highmark's terraced capital and Vesper's cleft): a HORIZONTAL region. Its silhouette is a LINE with hairs on it: from the boardwalk the skyline is almost flat
 * (reed beds, low roofs on stilts) broken only by thin verticals (masts, cranes, lantern poles, the Exchange's campanile); most of the view is sky and water-light. Cool, silty, salt-bright.
 *
 * THE PLAN (one pure description the terrain, the colliders, the props and the client's geometry all read, like kessarPlan / highmarkPlan):
 *  - a nearly flat silt plain at `level`; FIVE DEEP CHANNELS cut into it (the Customs Cut across the whole plain, the West Cut and the Long Cut running north from it, each tapering out into the reed flats): a deep
 *    channel's bank is a slope beyond the step limit AND fenced by a piling revetment (`rim`, tag "fence"), because the movement step's slope check is per direction (a diagonal climbs anything), so a bank alone is not
 *    a wall. Water is a TRUE barrier on foot; `deep` closes it in the nav grid. Shallow creeks, basins, the lagoon at the quay and the mud are wadeable.
 *  - THREE BRIDGES carry the boardwalk over the deep channels (the Customs Bridge at the quay's landing, the Cove Bridge over the Long Cut, the Reed Bridge over the West Cut). They are floors like Kessar's bridge,
 *    with long walkable ramps under them (the controller reads the TERRAIN slope).
 *  - the isthmus between the West Cut and the Long Cut is where the Constabulary's patrol walks: cove -> drop crosses it by the boardwalk, or goes round the cuts' northern ends through the wading reed flats.
 *  - `waterDepth(x, z)` is the depth of standing water above the ground (the shader and the Exchange's flood read it; cosmetic, never collision).
 * Metres; x east, z south; yaw is the collision convention (local +x = (cos yaw, sin yaw)). Only the channels' wander, the swell, the reeds and the scatter depend on the seed.
 *
 * FINAL ANCHOR NUMBERS (D4 proved each open and reachable in saltmarket.test.ts; the contract's numbers were nudged <= 8 m, names and signatures untouched): cutterBerth (-44,82) -> (-44,76) (the Customs Cut's
 * north bank is no longer 10 m from it). Everything else as contracted: landing, walk[], exchange, customs, cove, drop, every post in SALTMARKET_SITES, the mount spots and the stations.
 */

export const SALTMARKET_STATUS = { stub: false } as const;

/** What the client's SaltmarketView may cost (main-pass meshes and triangles, per graphics preset; counted in Node). D4 measured 15/19/26/26 meshes and 41k/120k/314k/453k triangles and tightened the contract's numbers to these; never loosen. */
export const SALTMARKET_VIEW_BUDGET = {
  meshes: { test: 18, low: 22, medium: 30, high: 30 },
  triangles: { test: 60_000, low: 140_000, medium: 350_000, high: 500_000 },
} as const;

/** Story coordinates, same frame as KESSAR_ANCHORS. D4 proves each open and reachable (saltmarket.test.ts). */
export const SALTMARKET_ANCHORS = {
  bounds: 150,
  /** Saltmarket Quay: the floating quay on the main channel at the south edge. Everybody arrives here. */
  landing: { x: 0, z: 118 },
  /** The boardwalk from the quay to the Exchange, in walking order (the last is the Exchange's door). */
  walk: [{ x: 0, z: 112 }, { x: 0, z: 92 }, { x: -14, z: 70 }, { x: -10, z: 40 }, { x: 0, z: 12 }, { x: 0, z: -14 }, { x: 0, z: -34 }],
  /** The Exchange: a hall that floods at every spring tide (the flooded market's stage). */
  exchange: { x: 0, z: -44 },
  /** The Customs House and the Constabulary's cutter berth. */
  customs: { x: -34, z: 70 },
  cutterBerth: { x: -44, z: 76 },
  /** The reed cove, where cargo is not landed (the smuggling run's goal). */
  cove: { x: 58, z: -6 },
  /** The drop-house in the west reeds, where the crates are meant to end up. */
  drop: { x: -62, z: -58 },
} as const;

/** Where the people stand (the templates read these; named here so scenario, plan and nav tests agree). */
export const SALTMARKET_SITES = {
  tideReeve: { x: -30, z: 66 },
  /** The Constabulary's customs men: first two at the Customs House door, the others walk the boardwalk. */
  customs: [{ x: -26, z: 70 }, { x: -36, z: 66 }, { x: -30, z: 76 }, { x: -38, z: 72 }],
  bargemen: [{ x: 58, z: -2 }, { x: 54, z: -8 }],
  auctioneer: { x: 0, z: -50 },
  /** The House-Heads with paddles (the Houses decide by auction). */
  houseHeads: [{ x: -10, z: -46 }, { x: 10, z: -46 }, { x: -6, z: -38 }, { x: 6, z: -38 }],
  /** The unmarked crates: where the barge lies at the cove. */
  cargo: { x: 58, z: -6 },
} as const;

/** What the smuggling run and the market add to the places (named here so the template, the plan, the nav tests and the view agree). */
export const SALTMARKET_SPOTS = {
  /** The drop-house's door: INTERACT with a crate here (the barge's cargo is delivered). */
  dropDoor: { x: -62.5, z: -58 },
  /** The barge's plug, aft of the cargo: INTERACT with empty hands to scuttle her. */
  plug: { x: 66.5, z: -6 },
  /** The signal lantern on the cove's post: lit, it draws the patrol to the cutter berth for a while. */
  lantern: { x: 52, z: -12 },
  /** The Syndicate's factor, at the Exchange's rail. */
  factor: { x: 12, z: -52 },
} as const;

// ---- the plan -------------------------------------------------------------------------------------------------------------------------

export const SALTMARKET = {
  /** Plank, deck and bank level (every abutment, the quay and the sites are pinned to it). */
  level: 0.4,
  /** Standing water's surface. */
  waterY: 0.1,
  /** Beds: the lagoon at the quay (wadeable), a shallow creek, a deep channel. */
  lagoonBed: -0.7,
  shallowBed: -0.35,
  deepBed: -2.3,
  /** Horizontal run of a deep channel's bank (steeper than the step's slope limit: a wall), and under a bridge (a long walkable ramp). */
  deepRun: 1.1,
  bridgeRun: 3.8,
  deckHalf: 2.4,
  rimHalf: 0.3,
  rimHeight: 1.5,
  parapet: 1.15,
} as const;
const L = SALTMARKET.level;

export interface SaltmarketChannel {
  id: string;
  /** "x": the channel runs east-west and its centreline is z(x). "z": north-south, x(z). */
  axis: "x" | "z";
  /** Centreline = c + amp * sin(u * k + phase) (pinned straight near the bridges). */
  c: number;
  amp: number;
  k: number;
  /** The parameter range the channel exists over, and how fast it tapers out at each end. */
  lo: number;
  hi: number;
  fadeLo: number;
  fadeHi: number;
  /** Half-width of the water and of the bed's flat. */
  half: number;
  /** Bed below the bank (positive), and the run of the bank. */
  carve: number;
  run: number;
  deep: boolean;
  /** Parameter values where a bridge crosses (the centreline is straight there and the bank is a long ramp). */
  bridges: readonly number[];
}

const DEEP = SALTMARKET.level - SALTMARKET.deepBed;
const SHALLOW = SALTMARKET.level - SALTMARKET.shallowBed;
/** The channels, in carving order. The three deep ones are fenced; the rest are creeks you can wade. */
export const SALTMARKET_CHANNELS: readonly SaltmarketChannel[] = [
  { id: "customs", axis: "x", c: 92, amp: 2.4, k: 0.05, lo: -170, hi: 170, fadeLo: 8, fadeHi: 8, half: 4.5, carve: DEEP, run: SALTMARKET.deepRun, deep: true, bridges: [0] },
  { id: "west", axis: "z", c: -54, amp: 2.4, k: 0.07, lo: -52, hi: 100, fadeLo: 22, fadeHi: 6, half: 3.5, carve: DEEP, run: SALTMARKET.deepRun, deep: true, bridges: [-24] },
  { id: "long", axis: "z", c: 36, amp: 2.4, k: 0.06, lo: -56, hi: 100, fadeLo: 26, fadeHi: 6, half: 3.5, carve: DEEP, run: SALTMARKET.deepRun, deep: true, bridges: [-6] },
  // shallow creeks and braids (wadeable, with a long gentle bank): the reed flats' veins
  { id: "creekW1", axis: "z", c: -84, amp: 7, k: 0.04, lo: -100, hi: 70, fadeLo: 24, fadeHi: 24, half: 2.2, carve: SHALLOW, run: 4, deep: false, bridges: [] },
  { id: "creekW2", axis: "x", c: 22, amp: 4, k: 0.06, lo: -126, hi: -58, fadeLo: 8, fadeHi: 8, half: 1.8, carve: SHALLOW, run: 3.5, deep: false, bridges: [] },
  { id: "creekW3", axis: "x", c: -34, amp: 5, k: 0.05, lo: -130, hi: -62, fadeLo: 14, fadeHi: 6, half: 2.4, carve: SHALLOW, run: 4, deep: false, bridges: [] },
  { id: "creekE1", axis: "x", c: 36, amp: 4, k: 0.055, lo: 44, hi: 140, fadeLo: 6, fadeHi: 22, half: 2.4, carve: SHALLOW, run: 4, deep: false, bridges: [] },
  { id: "creekE2", axis: "z", c: 92, amp: 6, k: 0.05, lo: -80, hi: 42, fadeLo: 22, fadeHi: 8, half: 2.2, carve: SHALLOW, run: 4, deep: false, bridges: [] },
  { id: "creekN1", axis: "x", c: -92, amp: 4, k: 0.045, lo: -70, hi: 80, fadeLo: 24, fadeHi: 24, half: 3, carve: SHALLOW, run: 4.5, deep: false, bridges: [] },
  { id: "creekN2", axis: "z", c: 20, amp: 5, k: 0.05, lo: -128, hi: -84, fadeLo: 4, fadeHi: 4, half: 2.2, carve: SHALLOW, run: 4, deep: false, bridges: [] },
];

/** Round basins (the cove's bay, reed ponds): wadeable. */
export const SALTMARKET_BASINS: readonly { id: string; x: number; z: number; r: number; run: number; carve: number }[] = [
  { id: "cove", x: 74, z: -9, r: 11, run: 5, carve: SHALLOW + 0.1 },
  { id: "westPond", x: -96, z: -26, r: 14, run: 6, carve: SHALLOW },
  { id: "eastPond", x: 98, z: 56, r: 12, run: 6, carve: SHALLOW },
  { id: "northPond", x: 38, z: -98, r: 14, run: 6, carve: SHALLOW },
  { id: "saltPan", x: -92, z: 60, r: 8, run: 4, carve: 0.6 },
];

/** Where the ground is pinned flat at `level` (the quay, the bridges' approaches, the sites). */
const FLAT: readonly { x: number; z: number; r: number; blend: number }[] = [
  { x: 0, z: 116, r: 12, blend: 9 }, { x: 0, z: 92, r: 14, blend: 8 }, { x: 36, z: -6, r: 12, blend: 8 }, { x: -54, z: -24, r: 12, blend: 8 },
  { x: -36, z: 70, r: 13, blend: 8 }, { x: -44, z: 76, r: 7, blend: 6 }, { x: 0, z: -46, r: 25, blend: 10 }, { x: 60, z: -6, r: 10, blend: 8 }, { x: -64, z: -58, r: 10, blend: 8 },
  { x: -14, z: 70, r: 6, blend: 6 },
];

const SHORE_Z = 124;
/** Parameter of the lagoon's shore at x (the quay's south): the plain ends in a wide wading lagoon. */
const shoreZ = (x: number): number => SHORE_Z + 4 * Math.sin(x * 0.045);

/** Per-seed phase of each channel's wander. */
const phaseOf = (seed: number, i: number): number => (hash3(seed >>> 0, i, 0x5a17) / 4294967296) * TAU;

/** A channel's centreline coordinate (z for "x"-axis channels, x for "z"-axis ones) at parameter `u`, for `seed`. */
export function saltmarketCentre(ch: SaltmarketChannel, seed: number, u: number): number {
  const i = SALTMARKET_CHANNELS.indexOf(ch);
  let a = ch.amp;
  for (const b of ch.bridges) a *= smoothstep(4, 14, Math.abs(u - b));
  return ch.c + a * Math.sin(u * ch.k + phaseOf(seed, i));
}
/** How much of the channel's depth exists at `u` (1 along its length, 0 beyond its ends). */
export const saltmarketMask = (ch: SaltmarketChannel, u: number): number => smoothstep(ch.lo, ch.lo + ch.fadeLo, u) * (1 - smoothstep(ch.hi - ch.fadeHi, ch.hi, u));
/** The bank's run at `u` (long and gentle under a bridge). */
export function saltmarketRun(ch: SaltmarketChannel, u: number): number {
  let r = ch.run;
  for (const b of ch.bridges) r = Math.max(r, SALTMARKET.bridgeRun + (ch.run - SALTMARKET.bridgeRun) * smoothstep(3, 6.5, Math.abs(u - b)));
  return r;
}

export interface SaltmarketTerrain extends Terrain {
  /** Depth of standing water above the ground at (x, z), metres; 0 on dry land (the channels). */
  waterDepth(x: number, z: number): number;
}

/** The ground: a low silt swell pinned flat at the quay, the bridges and the sites; the channels cut in; the lagoon shelving away at the quay. Pure, allocation-free. */
export function createSaltmarketTerrain(seed: number): SaltmarketTerrain {
  const base = createTerrain(seed, { amplitude: 0.3, wavelength: 56, flatRadius: 0, blend: 1 });
  const phases = SALTMARKET_CHANNELS.map((_, i) => phaseOf(seed, i));
  const height = (x: number, z: number): number => {
    let flat = 0;
    for (let i = 0; i < FLAT.length; i++) {
      const f = FLAT[i]!;
      const v = 1 - smoothstep(f.r, f.r + f.blend, Math.hypot(x - f.x, z - f.z));
      if (v > flat) flat = v;
    }
    let h = L + base.height(x, z) * (1 - flat);
    let carve = 0;
    // the Customs Cut's centreline at this x: the two northern cuts END in it (a deep tail running on south of it would have no revetment: the rim stops at the Customs Cut's north lip)
    const cc = SALTMARKET_CHANNELS[0]!;
    const custC = cc.c + cc.amp * smoothstep(4, 14, Math.abs(x - cc.bridges[0]!)) * Math.sin(x * cc.k + phases[0]!);
    for (let i = 0; i < SALTMARKET_CHANNELS.length; i++) {
      const ch = SALTMARKET_CHANNELS[i]!;
      const x_ = ch.axis === "x";
      const u = x_ ? x : z;
      if (u < ch.lo || u > ch.hi) continue;
      if (!x_ && ch.deep && u > custC) continue;
      const m = saltmarketMask(ch, u);
      if (m <= 0) continue;
      let a = ch.amp;
      for (let b = 0; b < ch.bridges.length; b++) a *= smoothstep(4, 14, Math.abs(u - ch.bridges[b]!));
      const centre = ch.c + a * Math.sin(u * ch.k + phases[i]!);
      const dd = Math.abs((x_ ? z : x) - centre) - ch.half;
      const run = ch.deep ? saltmarketRun(ch, u) : ch.run;
      if (dd >= run) continue;
      const t = dd <= 0 ? 0 : dd / run;
      const c = ch.carve * m * (1 - smoothstep(0, 1, t));
      if (c > carve) carve = c;
    }
    for (let i = 0; i < SALTMARKET_BASINS.length; i++) {
      const b = SALTMARKET_BASINS[i]!;
      const d = Math.hypot(x - b.x, z - b.z) - b.r;
      if (d >= b.run) continue;
      const c = b.carve * (1 - smoothstep(0, 1, d <= 0 ? 0 : d / b.run));
      if (c > carve) carve = c;
    }
    h -= carve;
    // the lagoon: the plain shelves into a wide wading shallows south of the quay (never deeper than a wade)
    const sh = shoreZ(x);
    if (z > sh) h += (SALTMARKET.lagoonBed - h) * smoothstep(sh, sh + 9, z);
    return h;
  };
  const waterDepth = (x: number, z: number): number => {
    const d = SALTMARKET.waterY - height(x, z);
    return d > 0 ? d : 0;
  };
  return { height, waterDepth };
}

// ---- the authored things --------------------------------------------------------------------------------------------------------------

export interface SaltmarketBox { x: number; z: number; yaw: number; hx: number; hz: number; /** Height of the highest point (the ridge) above the ground: the colliders and the view both stay inside it. */ height: number }
export interface SaltmarketWallSeg { x: number; z: number; yaw: number; hx: number; hz: number }
export type SaltmarketHairKind = "crane" | "mast" | "lantern" | "windpump" | "flagpole" | "derrick" | "campanile";
/** A thin vertical: the "hairs" on the line. `r` is its collision radius (a box's half-side for a crane or a campanile), `height` above the ground. */
export interface SaltmarketHair { x: number; z: number; kind: SaltmarketHairKind; r: number; height: number }
export interface SaltmarketBridge {
  id: string;
  /** The channel it crosses and the parameter value where it does. */
  channel: string;
  at: number;
  /** The deck's centre, half length (along the crossing), half width, and its yaw (0: runs along z, PI/2 along x). */
  x: number; z: number; hl: number; yaw: number;
}
export interface SaltmarketBoat { x: number; z: number; yaw: number; kind: "barge" | "cutter" | "skiff" | "lighter" }
export interface SaltmarketSign { x: number; z: number; yaw: number; text: number }
export interface SaltmarketBanner { x: number; z: number; yaw: number; top: number; w: number; h: number; kind: "house" | "customs" | "syndicate" | "society" }

/** Signage: Latin capitals, the Houses' wit. Authored copy: the view letters these; `SALTMARKET_SIGNS` (saltmarketText.ts) is the text. */
export interface SaltmarketPlan {
  /** Plank paths (visual: laid on the ground, 2.4 m wide), in walking order. */
  boardwalks: { id: string; pts: { x: number; z: number }[] }[];
  bridges: SaltmarketBridge[];
  /** The quay: planks over the lagoon from z0 to z1 (a floor), bollards. */
  quay: { x: number; z0: number; z1: number; half: number; bollards: { x: number; z: number }[] };
  /** Warehouses and huts on stilts (solid). */
  houses: SaltmarketBox[];
  customsHouse: SaltmarketBox;
  dropHouse: SaltmarketBox;
  exchange: { x: number; z: number; hx: number; hz: number; pillars: { x: number; z: number }[]; backWall: SaltmarketWallSeg; rostrum: SaltmarketBox; eave: number; backH: number };
  hairs: SaltmarketHair[];
  boats: SaltmarketBoat[];
  signs: SaltmarketSign[];
  banners: SaltmarketBanner[];
  /** The cove's plank pier (a floor into the bay) and the cutter berth's (visual: beyond the revetment). */
  covePier: { x0: number; x1: number; z: number; half: number };
  berthPier: { x: number; z0: number; z1: number; half: number };
  /** Drying racks, salt pans and fish traps: dressing the view draws, never collision. */
  racks: { x: number; z: number; yaw: number; len: number }[];
  saltPans: { x: number; z: number; hx: number; hz: number }[];
  /** Lanterns along the boardwalks (lit at dusk): the poles are the `lantern` hairs and these low ones. */
  lamps: { x: number; z: number; h: number }[];
}

/**
 * D-038: the warehouses (2-4 were raised from 3.1-3.2 m to 4.4-4.5 m so a door 2.4 m high fits under the eave). 0 and 1 are the two quayside sheds the plan makes enterable (`interior`: the Brine Counting-Shed and the Society Bonded Shed, a door 1.5 m wide up a three-step landing, a lit floor);
 * 2-4 are shuttered stilt warehouses with the loading door chained (`sealed`); 5-7 are reed-cutters' huts with no door at all (`solid`). `height` is the highest point (the ridge) above the ground.
 * Shed 1 faces WEST (yaw PI) so its door looks at the boardwalk instead of the open silt.
 */
const HOUSES: readonly SaltmarketBox[] = [
  // the quay row: two warehouses south of the Customs Cut (the Houses' goods wait here for the tide)
  { x: -44, z: 108, yaw: 0, hx: 6.5, hz: 4, height: 5.1 },
  { x: 46, z: 110, yaw: Math.PI, hx: 6, hz: 4, height: 5.3 },
  // reed-cutters' stilt huts on the isthmus and beyond: low, thatched, the roof hardly above a standing walker's eye
  // (hut 2 faces SE, at the boardwalk's first bend: the raised 4.4 m ridge seen broadside from the walk cost the skyline three bins of open horizon, edge-on it costs none: `saltmarket.test.ts` measures it)
  { x: -26, z: -2, yaw: 1.2, hx: 2.6, hz: 2, height: 4.4 },
  { x: 20, z: -26, yaw: 0.5, hx: 2.6, hz: 2.0, height: 4.5 },
  { x: 70, z: -22, yaw: 0.25, hx: 3.2, hz: 2.4, height: 4.5 },
  { x: 96, z: 30, yaw: -0.4, hx: 2.8, hz: 2.2, height: 3.1 },
  { x: -92, z: 22, yaw: 0.2, hx: 3.0, hz: 2.4, height: 3.2 },
  { x: -80, z: -92, yaw: -0.3, hx: 2.6, hz: 2.0, height: 3.0 },
];

let cachedPlan: SaltmarketPlan | undefined;

export function saltmarketPlan(): SaltmarketPlan {
  if (cachedPlan) return cachedPlan;
  const A = SALTMARKET_ANCHORS;
  const cx = (id: string): SaltmarketChannel => SALTMARKET_CHANNELS.find((c) => c.id === id)!;
  void cx;
  const boardwalks: SaltmarketPlan["boardwalks"] = [
    { id: "main", pts: [{ x: 0, z: 119 }, { x: 0, z: 112 }, { x: 0, z: 104 }, { x: 0, z: 80 }, { x: -4, z: 78 }, { x: -14, z: 70 }, { x: -12, z: 55 }, { x: -10, z: 40 }, { x: -4, z: 26 }, { x: 0, z: 12 }, { x: 0, z: -14 }, { x: 0, z: -34 }] },
    { id: "cove", pts: [{ x: 0, z: 12 }, { x: 14, z: 6 }, { x: 26, z: -2 }, { x: 31, z: -6 }, { x: 41, z: -6 }, { x: 50, z: -6 }, { x: 58, z: -6 }] },
    { id: "drop", pts: [{ x: 0, z: -14 }, { x: -18, z: -18 }, { x: -34, z: -22 }, { x: -49, z: -24 }, { x: -59, z: -24 }, { x: -65.5, z: -24 }, { x: -67, z: -33 }, { x: -69, z: -46 }, { x: -64, z: -52 }, { x: -61.8, z: -58 }] },
    { id: "customs", pts: [{ x: -14, z: 70 }, { x: -26, z: 70 }, { x: -34, z: 70 }, { x: -40, z: 73 }, { x: -44, z: 76 }] },
    // D-038: the spurs that carry the plank walk to the three doors a visitor is meant to use (each ends a landing's depth short of the steps)
    { id: "customsDoor", pts: [{ x: -40, z: 73 }, { x: -40, z: 67.4 }] },
    { id: "shedW", pts: [{ x: 0, z: 108 }, { x: -12, z: 108 }, { x: -24, z: 108 }, { x: -34.4, z: 108 }] },
    { id: "shedE", pts: [{ x: 0, z: 110 }, { x: 12, z: 110 }, { x: 24, z: 110 }, { x: 36.4, z: 110 }] },
  ];
  const bridges: SaltmarketBridge[] = [
    { id: "customsBridge", channel: "customs", at: 0, x: 0, z: 92, hl: 0, yaw: 0 },
    { id: "coveBridge", channel: "long", at: -6, x: 36, z: -6, hl: 0, yaw: Math.PI / 2 },
    { id: "reedBridge", channel: "west", at: -24, x: -54, z: -24, hl: 0, yaw: Math.PI / 2 },
  ].map((b) => {
    const ch = SALTMARKET_CHANNELS.find((c) => c.id === b.channel)!;
    return { ...b, hl: ch.half + SALTMARKET.bridgeRun + 0.3 + ch.amp * 0 };
  });
  const quay = { x: 0, z0: 120, z1: 134, half: 1.7, bollards: [{ x: -2.3, z: 122 }, { x: 2.3, z: 122 }, { x: -2.3, z: 132 }, { x: 2.3, z: 132 }] };
  // (the Customs House turns its door to the boardwalk (south, +z): local +x is the front, so it is yawed a quarter turn)
  const customsHouse: SaltmarketBox = { x: -40, z: 61, yaw: Math.PI / 2, hx: 3.0, hz: 4.2, height: 5.6 };
  const dropHouse: SaltmarketBox = { x: -69, z: -58, yaw: 0, hx: 4.5, hz: 3.2, height: 4.3 };
  const E = A.exchange;
  const hx = 15, hz = 13;
  const zf = E.z + 11, zb = E.z - 15;   // the hall: front colonnade at z = -33, back wall at z = -59
  const pillars: { x: number; z: number }[] = [];
  for (const x of [-15, -10, -5, 5, 10, 15]) pillars.push({ x, z: zf });
  for (const s of [-1, 1]) for (const z of [-39.5, -46, -52.5]) pillars.push({ x: s * hx, z });
  const exchange = {
    x: E.x, z: E.z - 2, hx, hz, pillars,
    backWall: { x: E.x, z: zb - 0.5, yaw: 0, hx, hz: 0.5 },
    rostrum: { x: 0, z: -53.4, yaw: 0, hx: 1.6, hz: 0.7, height: 1.1 },
    eave: 3.6, backH: 4.0,
  };
  void hz;
  const hairs: SaltmarketHair[] = [
    { x: 21, z: -35, kind: "campanile", r: 1.4, height: 14 },
    { x: -34.4, z: 61, kind: "flagpole", r: 0.28, height: 7.6 },
    { x: -31, z: 106, kind: "crane", r: 0.7, height: 11 },
    { x: 32.5, z: 106.5, kind: "crane", r: 0.7, height: 11 },
    { x: 54, z: -1, kind: "derrick", r: 0.6, height: 9 },
    { x: -90, z: -11, kind: "windpump", r: 1.0, height: 12 },
    { x: -59.5, z: -55, kind: "mast", r: 0.4, height: 8 },
  ];
  const boats: SaltmarketBoat[] = [
    { x: 66, z: -9.6, yaw: 0, kind: "barge" },
    { x: -44, z: 92, yaw: Math.PI / 2, kind: "cutter" },
    { x: 8, z: 128, yaw: 0.1, kind: "lighter" },
    { x: -10, z: 130, yaw: -0.2, kind: "skiff" },
    { x: 20, z: 94, yaw: Math.PI / 2, kind: "skiff" },
    { x: 52, z: -48, yaw: 1.4, kind: "skiff" },
    { x: -54, z: 40, yaw: 0, kind: "skiff" },
  ];
  const signs: SaltmarketSign[] = [
    { x: 3.9, z: 117, yaw: Math.PI / 2, text: 0 },
    { x: -28, z: 73, yaw: Math.PI / 2, text: 1 },
    { x: 5.5, z: -28, yaw: Math.PI / 2, text: 2 },
    { x: 4.4, z: 104, yaw: Math.PI / 2, text: 3 },
  ];
  const banners: SaltmarketBanner[] = [
    { x: -33.1, z: 60.2, yaw: Math.PI / 2, top: 7.3, w: 2.0, h: 3.0, kind: "customs" },
    { x: 21, z: -33.4, yaw: Math.PI / 2, top: 12.8, w: 2.2, h: 4, kind: "house" },
    // (from a rod under the ceiling's overhang, in front of the ceiling joists' tails: the joists run 0.8 past the front beam's middle (z -33), to -32.2, under
    // boards that reach -32.0 with their underside at 3.6 + 0.28. It hung on the beam's face, and the middle joist's tail ran 0.55 m out through the cloth)
    { x: 0, z: -32.17, yaw: Math.PI / 2, top: 3.82, w: 4.0, h: 1.8, kind: "house" },
    { x: 8, z: 104, yaw: Math.PI / 2, top: 5.4, w: 1.8, h: 2.8, kind: "society" },
    { x: 18.2, z: -50, yaw: Math.PI / 2, top: 4.4, w: 1.6, h: 2.6, kind: "syndicate" },   // (on the sand off the Exchange's east side, its pole 0.9 m clear of the roof's eave: it stood inside the hall at x 14 and its pole came up through the roof)
  ];
  const racks = [
    { x: 54, z: 20, yaw: 0.2, len: 7 }, { x: 62, z: 16, yaw: 0.35, len: 6 }, { x: -76, z: 6, yaw: -0.2, len: 7 }, { x: 12, z: -64, yaw: 0.1, len: 8 }, { x: -30, z: -36, yaw: 0.4, len: 6 },
  ];
  const saltPans = [{ x: -92, z: 60, hx: 7, hz: 5 }, { x: 70, z: 44, hx: 6, hz: 5 }, { x: 88, z: 8, hx: 5, hz: 4 }];
  // lanterns beside the plank paths, every ~20 m, alternating sides (never on the planks; the bridges carry their own at the rails)
  const lamps: { x: number; z: number; h: number }[] = [];
  for (const b of boardwalks) {
    let acc = 8, side = 1;
    for (let i = 0; i + 1 < b.pts.length; i++) {
      const p0 = b.pts[i]!, p1 = b.pts[i + 1]!;
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const nx = -(p1.z - p0.z) / len, nz = (p1.x - p0.x) / len;
      for (; acc < len; acc += 20) {
        const x = p0.x + ((p1.x - p0.x) * acc) / len + nx * 2.3 * side, z = p0.z + ((p1.z - p0.z) * acc) / len + nz * 2.3 * side;
        side = -side;
        // keep clear of the channels, the bridges' approaches, the Exchange and the quay
        if (b.id === "main" && ((z > 78 && z < 108) || z < -30)) continue;
        if (Math.hypot(x - A.walk[3].x, z - A.walk[3].z) < 12) continue;   // (the walker's own eye-level view of a lantern is not a skyline)
        if (Math.hypot(x - 36, z + 6) < 9 || Math.hypot(x + 54, z + 24) < 9 || Math.hypot(x - 59, z + 6) < 6 || Math.hypot(x + 62, z + 58) < 6) continue;
        // (D-038: nor beside another plank walk, which is where the spurs leave the main one)
        if (distToPaths(boardwalks.filter((o) => o !== b).map((o) => o.pts), x, z) < 2.6) continue;
        lamps.push({ x: Math.round(x * 2) / 2, z: Math.round(z * 2) / 2, h: 2.7 });
      }
      acc -= len;
    }
  }
  for (const [x, z] of [[-3.6, 104], [3.6, 104], [-3.6, 112], [3.6, 112], [-3.6, 90], [3.6, 90]] as const) lamps.push({ x, z, h: 2.7 });
  cachedPlan = {
    boardwalks, bridges, quay, houses: HOUSES.map((h) => ({ ...h })), customsHouse, dropHouse, exchange, hairs, boats, signs, banners,
    covePier: { x0: 60, x1: 69, z: -6, half: 1.1 }, berthPier: { x: -44, z0: 79, z1: 90, half: 1.1 }, racks, saltPans, lamps,
  };
  return cachedPlan;
}

// ---- the level plan (D-038; docs/LEVEL_PLAN.md section 7) ------------------------------------------------------------------------------------

/**
 * Every building of the delta and what it IS: the two quayside sheds, the Customs counting-house and the drop house are walkable rooms (walls with a 1.5 m doorway, a deck on stilts up a landing and steps, a
 * lit floor, a roof the cutaway lifts); three shuttered warehouses are `sealed` (the loading door is chained and says why); three huts are `solid` (no door drawn). The collision, the view and the audit read this.
 */
export const SALTMARKET_SEALED_SIGNS = ["CLOSED FOR TIDE", "BONDED. CHAIN BY ORDER.", "LOT WITHDRAWN"] as const;

let cachedLevel: RegionLevel | undefined;
export function saltmarketLevel(): RegionLevel {
  if (cachedLevel) return cachedLevel;
  const p = saltmarketPlan();
  const at = (b: SaltmarketBox): { x: number; z: number; yaw: number; hx: number; hz: number } => ({ x: b.x, z: b.z, yaw: b.yaw, hx: b.hx, hz: b.hz });
  const H = p.houses;
  const buildings: LevelBuilding[] = [
    planBuilding("warehouse0", "interior", at(H[0]!), { height: H[0]!.height, floor: 0.9, wallH: 2.9, steps: 3 }),
    planBuilding("warehouse1", "interior", at(H[1]!), { height: H[1]!.height, floor: 0.9, wallH: 3.0, steps: 3 }),
    ...[2, 3, 4].map((i) => planBuilding(`warehouse${i}`, "sealed", at(H[i]!), { height: H[i]!.height, floor: 0.9, wallH: H[i]!.height - 0.9, sign: SALTMARKET_SEALED_SIGNS[i - 2] })),
    ...[5, 6, 7].map((i) => planBuilding(`warehouse${i}`, "solid", at(H[i]!), { height: H[i]!.height, floor: 0.9, wallH: H[i]!.height - 0.9 })),
    planBuilding("customs", "interior", at(p.customsHouse), { height: p.customsHouse.height, floor: 0.9, wallH: 2.8, steps: 3 }),
    planBuilding("dropHouse", "interior", at(p.dropHouse), { height: p.dropHouse.height, floor: 0.6, wallH: 2.8, steps: 2 }),
  ];
  cachedLevel = levelOf(buildings);
  return cachedLevel;
}

// ---- colliders ------------------------------------------------------------------------------------------------------------------------

/**
 * The revetment of every deep channel: a row of piling-and-plank wall boxes along both lips, from where the channel is deep to where it tapers into the flats, broken only at the bridges (whose rails meet it
 * exactly). Depends on the seed (the channels wander); everything else in the plan does not.
 */
export function saltmarketRim(seed: number): SaltmarketWallSeg[] {
  const out: SaltmarketWallSeg[] = [];
  for (const ch of SALTMARKET_CHANNELS) {
    if (!ch.deep) continue;
    const x_ = ch.axis === "x";
    const win = SALTMARKET.deckHalf + 0.3 + 0.3 + 0.05;   // rails' outer edge: the rim starts exactly there
    const lipAt = (u: number, side: number): { x: number; z: number } => {
      const c = saltmarketCentre(ch, seed, u);
      const off = side * (ch.half + saltmarketRun(ch, u) + 0.15 + SALTMARKET.rimHalf);
      return x_ ? { x: u, z: c + off } : { x: c + off, z: u };
    };
    let capU: number | undefined;   // where the revetment begins at the channel's tapering end: a cap closes it (otherwise the taper is a ramp INTO deep water between the two rims)
    for (const side of [-1, 1]) {
      // sample parameters: regular steps plus the bridge windows' edges
      const us: number[] = [];
      // the "customs" cut runs the whole plain; the two northern cuts run on to the Customs Cut's NORTH rim as it is for this seed (it wanders), and end in it
      const u0 = x_ ? -156 : ch.lo;
      let u1 = 156;
      if (!x_) {
        const cc = SALTMARKET_CHANNELS[0]!;
        u1 = 84;
        for (let k = 0; k < 3; k++) u1 = saltmarketCentre(cc, seed, lipAt(u1, side).x) - (cc.half + saltmarketRun(cc, lipAt(u1, side).x) + 0.15 + SALTMARKET.rimHalf);
      }
      for (let u = u0; u < u1 - 0.5; u += 6) us.push(u);
      us.push(u1);
      for (const b of ch.bridges) us.push(b - win, b + win);
      us.sort((a, b) => a - b);
      for (let i = 0; i + 1 < us.length; i++) {
        const ua = us[i]!, ub = us[i + 1]!;
        if (ub - ua < 0.2) continue;
        const mid = (ua + ub) / 2;
        if (ch.bridges.some((b) => Math.abs(mid - b) < win - 0.01)) continue;
        if (saltmarketMask(ch, ua) < 0.34 && saltmarketMask(ch, ub) < 0.34) continue;
        const a = lipAt(ua, side), b = lipAt(ub, side);
        if (Math.hypot(a.x, a.z) > SALTMARKET_ANCHORS.bounds + 8 && Math.hypot(b.x, b.z) > SALTMARKET_ANCHORS.bounds + 8) continue;
        out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(b.z - a.z, b.x - a.x), hx: Math.hypot(b.x - a.x, b.z - a.z) / 2 + 0.25, hz: SALTMARKET.rimHalf });
        if (!x_ && (capU === undefined || ua < capU)) capU = ua;
      }
    }
    if (capU !== undefined) {
      const a = lipAt(capU, -1), b = lipAt(capU, 1);
      out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(b.z - a.z, b.x - a.x), hx: Math.hypot(b.x - a.x, b.z - a.z) / 2 + 0.25, hz: SALTMARKET.rimHalf });
    }
  }
  return out;
}

/** Everything solid in the delta: the quay and the cove pier (floors), the three bridges, the revetment, the warehouses, the Customs House, the Exchange's colonnade, the hairs, the signs, the bollards. */
export function saltmarketObstacles(terrain: Terrain, seed: number): Obstacle[] {
  const plan = saltmarketPlan();
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
  // the quay: planks over the wading lagoon (a floor: its top is the bank level), bollards
  const q = plan.quay;
  out.push({ kind: "box", tag: "jetty", x: q.x, z: (q.z0 + q.z1) / 2, hx: q.half, hz: (q.z1 - q.z0) / 2, yaw: 0, y0: SALTMARKET.lagoonBed - 1, y1: L });
  for (const b of q.bollards) circle("pole", b.x, b.z, 0.2, 0.9);
  // the cove's pier: planks over the bay's shallows
  const cp = plan.covePier;
  out.push({ kind: "box", tag: "jetty", x: (cp.x0 + cp.x1) / 2, z: cp.z, hx: (cp.x1 - cp.x0) / 2, hz: cp.half, yaw: 0, y0: SALTMARKET.shallowBed - 1, y1: L });
  // the bridges: a deck, parapets, and no piers (the span is all one plank)
  for (const b of plan.bridges) {
    const along = b.yaw === 0 ? { hx: SALTMARKET.deckHalf, hz: b.hl } : { hx: b.hl, hz: SALTMARKET.deckHalf };
    out.push({ kind: "box", tag: "bridge", x: b.x, z: b.z, hx: along.hx, hz: along.hz, yaw: 0, y0: L - 0.8, y1: L });
    for (const s of [-1, 1]) {
      const off = s * (SALTMARKET.deckHalf + 0.3);
      if (b.yaw === 0) out.push({ kind: "box", tag: "wall", x: b.x + off, z: b.z, hx: 0.3, hz: b.hl, yaw: 0, y0: L - 0.8, y1: L + SALTMARKET.parapet });
      else out.push({ kind: "box", tag: "wall", x: b.x, z: b.z + off, hx: b.hl, hz: 0.3, yaw: 0, y0: L - 0.8, y1: L + SALTMARKET.parapet });
    }
  }
  // the revetment along the deep channels
  for (const w of saltmarketRim(seed)) out.push({ kind: "box", tag: "fence", x: w.x, z: w.z, hx: w.hx, hz: w.hz, yaw: w.yaw, y0: L - 3.4, y1: L + SALTMARKET.rimHeight });
  // buildings: the enterable ones are rooms (walls with a doorway, a deck up steps); the sealed and the solid are boxes to the ridge (the stilts and the floor are drawn; the view and the ink read the same box)
  for (const b of saltmarketLevel().buildings) {
    if (b.kind === "interior") out.push(...roomObstacles(b, g(b.x, b.z)));
    else box("house", b.x, b.z, b.hx, b.hz, b.yaw, b.height);
  }
  // the Exchange: a colonnade, a back wall, the rostrum (the hall is open at the front; the roof is the view's)
  const ex = plan.exchange;
  for (const p of ex.pillars) circle("ruin", p.x, p.z, 0.7, ex.eave);
  box("wall", ex.backWall.x, ex.backWall.z, ex.backWall.hx, ex.backWall.hz, ex.backWall.yaw, ex.backH);
  box("table", ex.rostrum.x, ex.rostrum.z, ex.rostrum.hx, ex.rostrum.hz, ex.rostrum.yaw, ex.rostrum.height);
  // the hairs
  for (const h of plan.hairs) {
    if (h.kind === "crane" || h.kind === "campanile" || h.kind === "derrick") box("pole", h.x, h.z, h.r, h.r, 0, h.height);
    else circle("pole", h.x, h.z, h.r, h.height);
  }
  for (const s of plan.signs) circle("sign", s.x, s.z, 0.12, 2);
  for (const l of plan.lamps) circle("pole", l.x, l.z, 0.14, l.h);
  return out;
}

export function createSaltmarketWorld(seed: number): CollisionWorld {
  const terrain = createSaltmarketTerrain(seed);
  return new CollisionWorld(terrain, saltmarketObstacles(terrain, seed), SALTMARKET_ANCHORS.bounds);
}

/** The landing: a ring of up to four on the quay's dry apron (never on the planks). */
export function saltmarketSpawn(index: number, count = 4): { x: number; z: number } {
  const a = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 4;
  const L0 = SALTMARKET_ANCHORS.landing;
  return { x: L0.x + Math.cos(a) * 2.6, z: L0.z - 1.4 - ARRIVAL_INLAND + Math.sin(a) * 1.2 } /* (D-070: up the shore, off the jetty's first planks) */;
}

/**
 * The props a visit starts with: stores at the landing (barrels, bottles, a chair or two) and by the huts. NEVER a crate: the unmarked crates are the smuggling run's (its template places them at the cove), and any
 * crate delivered to the drop-house counts, so the quay must not hand them out. Deterministic, dry, never inside anything solid.
 */
export function saltmarketProps(seed: number, world: CollisionWorld): PropSpawn[] {
  const out: PropSpawn[] = [];
  const rng = new Rng(seed ^ 0x5a17c0de);
  const pos = { x: 0, z: 0 };
  const wd = (world.terrain as Partial<SaltmarketTerrain>).waterDepth;
  const L0 = SALTMARKET_ANCHORS.landing;
  const doors = saltmarketLevel().doors;
  const walks = saltmarketPlan().boardwalks.map((b) => b.pts);
  const spots: { x: number; z: number; r: number; n: number; kinds: PropKindId[] }[] = [
    { x: L0.x, z: L0.z - 7, r: 6, n: 5, kinds: [PropKind.BARREL, PropKind.BOTTLE, PropKind.BARREL, PropKind.CHAIR, PropKind.BOTTLE] },
    { x: -26, z: -2, r: 5, n: 2, kinds: [PropKind.BARREL, PropKind.BOTTLE] },
    { x: -14, z: 58, r: 4, n: 2, kinds: [PropKind.CHAIR, PropKind.BOTTLE] },
  ];
  for (const s of spots) {
    for (let i = 0, tries = 0; i < s.n && tries < 80; tries++) {
      const a = rng.range(0, TAU);
      const d = rng.range(2.4, s.r);
      const x = s.x + Math.cos(a) * d;
      const z = s.z + Math.sin(a) * d;
      pos.x = x;
      pos.z = z;
      if (world.resolveXZ(pos, world.terrainHeight(x, z), 0.6, 1.2) || (wd !== undefined && wd(x, z) > 0)) continue;
      if (inDoorApron(doors, x, z, 0.9) || distToPaths(walks, x, z) < 1.5) continue;   // (D-038: never in a doorway, never on the planks)
      out.push({ kind: s.kinds[i % s.kinds.length]!, x, z, yaw: rng.range(0, TAU) });
      i++;
    }
  }
  return out;
}

/** Every story point of the region, named (the scatter keeps clear of them and the tests prove each is open and reachable). */
export function saltmarketSitePoints(): { id: string; x: number; z: number }[] {
  const A = SALTMARKET_ANCHORS, S = SALTMARKET_SITES, P = SALTMARKET_SPOTS;
  return [
    { id: "landing", ...A.landing }, { id: "exchange", ...A.exchange }, { id: "customs", ...A.customs }, { id: "cutterBerth", ...A.cutterBerth }, { id: "cove", ...A.cove }, { id: "drop", ...A.drop },
    { id: "tideReeve", ...S.tideReeve }, { id: "auctioneer", ...S.auctioneer },
    ...S.customs.map((p, i) => ({ id: `customs${i}`, ...p })), ...S.bargemen.map((p, i) => ({ id: `bargeman${i}`, ...p })), ...S.houseHeads.map((p, i) => ({ id: `houseHead${i}`, ...p })),
    { id: "dropDoor", ...P.dropDoor }, { id: "plug", ...P.plug }, { id: "lantern", ...P.lantern }, { id: "factor", ...P.factor },
    ...A.walk.map((p, i) => ({ id: `walk${i}`, ...p })),
  ];
}

/** Navigation options (the nav grid): deep water closed, rooted at the landing. */
export function saltmarketNavOptions(world: CollisionWorld): NavOptions {
  const wd = (world.terrain as Partial<SaltmarketTerrain>).waterDepth;
  return { tag: "saltmarket", roots: [SALTMARKET_ANCHORS.landing], deep: wd === undefined ? undefined : (x, z, surf) => wd(x, z) > 0.9 && surf < SALTMARKET.waterY + 0.3 };
}

/** Where the manifest's horses and wagon are put at landfall: a ring behind the quay, on the boardwalk's dry end (z <= 108). D4 proves each open (mount.test.ts runs every region in REGION_IDS). */
export const SALTMARKET_MOUNT_SPOTS: RegionMountSpots = {
  horses: [{ x: -5, z: 108, yaw: 0.4 }, { x: 5, z: 108, yaw: -0.4 }],
  wagon: { x: 0, z: 102, yaw: 0 },
};

/** The HUD's prompts and the server's "post" use points (acted on through the scenario). */
export const SALTMARKET_STATIONS: readonly UseStation[] = [
  { id: "dock", kind: "dock", x: SALTMARKET_ANCHORS.landing.x, z: SALTMARKET_ANCHORS.landing.z, r: 4, prompt: "Take the barge home" },
  { id: "tide_reeve", kind: "post", x: SALTMARKET_SITES.tideReeve.x, z: SALTMARKET_SITES.tideReeve.z, r: 2.6, prompt: "Declare yourself to the Tide-Reeve" },
  { id: "auctioneer", kind: "post", x: SALTMARKET_SITES.auctioneer.x, z: SALTMARKET_SITES.auctioneer.z, r: 2.6, prompt: "Address the Auctioneer" },
  { id: "house_head", kind: "post", x: SALTMARKET_SITES.houseHeads[0].x, z: SALTMARKET_SITES.houseHeads[0].z, r: 2.6, prompt: "Catch a House-Head's eye" },
];
