import { ARENA_RADIUS, createArena, spawnPoint } from "./arena.ts";
import { CAMP, hqPlan } from "./camp.ts";
import { KESSAR_ANCHORS as A, REGION_IDS, SAIL_SECONDS, isRegionId, type RegionId, type UseStation } from "./campaignTypes.ts";
import type { CollisionWorld } from "./collision.ts";
import { CHARACTER } from "./constants.ts";
import { kessarNavOptions } from "./garrison.ts";
import { HIGHMARK_ANCHORS as H, HIGHMARK_SITES as HS, createHighmarkWorld, highmarkProps, highmarkNavOptions, highmarkSpawn } from "./highmark.ts";
import { createKessarWorld, kessarProps, kessarSpawn } from "./kessar.ts";
import { SALTMARKET_ANCHORS as SM, SALTMARKET_STATIONS, createSaltmarketWorld, saltmarketNavOptions, saltmarketProps, saltmarketSpawn } from "./saltmarket.ts";
import { VESPER_ANCHORS as V, VESPER_STATIONS, createVesperWorld, vesperNavOptions, vesperProps, vesperSpawn } from "./vesper.ts";
import type { NavOptions } from "./nav.ts";
import { JETTY } from "./landscape.ts";
import { angleDelta } from "./math.ts";
import { INTERACT, type PropSpawn } from "./props.ts";
import { campProps } from "./stores.ts";
import { OUTPOST_SITES, YARD_R } from "./outpost.ts";
import type { RegionWorldOpts } from "./worldTypes.ts";

/**
 * The regions of the campaign and the four questions the rest of the game asks of one: what is it (REGIONS), what does it look like to walk on
 * (createRegionWorld), where do people arrive and what lies about (regionSpawn, regionProps) and what can be used (stationsFor, findStation).
 * Hollowmere's answers are the arena's, unchanged: nothing here touches createArena's output.
 */

export interface RegionDef {
  id: RegionId;
  name: string;
  blurb: string;
  bounds: number;
  sailSeconds: number;
  /**
   * D-036: can a party SAIL here? false = the region exists in the contract (ids, worlds, stations, a dev start `?region=<id>`) but is not on the map room's chart and the
   * travel machine refuses it. The package that builds a region flips it to true as its LAST act (together with its STATUS flag: `VESPER_STATUS.stub`, `SALTMARKET_STATUS.stub`), when its acceptance tests pass.
   */
  reachable: boolean;
}

export const REGIONS: Record<RegionId, RegionDef> = {
  hollowmere: {
    id: "hollowmere",
    name: "Hollowmere Depot",
    blurb: "Home. The Society's depot, the notice board, the cannon and a village that has learned to smile at invoices.",
    bounds: ARENA_RADIUS,
    sailSeconds: SAIL_SECONDS,
    reachable: true,
  },
  kessar: {
    id: "kessar",
    name: "Kessar Reach",
    blurb: "An ochre coast, one stone bridge and a hill-fort whose Ward of the Nine Lamps charges a toll to be crossed. A rival syndicate has also noticed the bridge.",
    bounds: A.bounds,
    sailSeconds: SAIL_SECONDS,
    reachable: true,
  },
  highmark: {
    id: "highmark",
    name: "Highmark",
    blurb: "A golden grassland, a processional road and a hill-capital built like a wedding cake. The King has been pending for six years; two heirs have opinions about the chair.",
    bounds: H.bounds,
    sailSeconds: SAIL_SECONDS,
    reachable: true,
  },
  // D-037: regions three and four exist in the contract (ids, worlds, stations, a dev start `?region=<id>`) and flip `reachable` together with their STATUS flag, as each package's LAST act
  vesper: {
    id: "vesper",
    name: "Vesper Gorge",
    blurb: "A dry canyon of red-violet rock, with an iron mine headframe and a cloister cut into the cliff. The Low Vesper Lamentation Guild runs the funerals, the records and, quietly, the mine.",
    bounds: V.bounds,
    sailSeconds: SAIL_SECONDS,
    reachable: true,
  },
  saltmarket: {
    id: "saltmarket",
    name: "Saltmarket Delta",
    blurb: "Braided channels, stilted warehouses and an exchange that floods at every spring tide and holds its sale regardless. The Brine Houses own the tides by deed; everything else is a lot.",
    bounds: SM.bounds,
    sailSeconds: SAIL_SECONDS,
    reachable: true,
  },
};

/** The regions a party may sail to (D-036): the chart, the map room's list and the travel machine all read this, never REGION_IDS. */
export const isReachableRegion = (v: unknown): v is RegionId => isRegionId(v) && REGIONS[v].reachable;
export const reachableRegions = (): RegionId[] => REGION_IDS.filter((id) => REGIONS[id].reachable);

/** Where the ship puts everybody ashore (the integrator's landfall: manifest effects, kegs, hands, horses are placed around it). Hollowmere's is the jetty's foot. */
export function regionLanding(id: RegionId): { x: number; z: number } {
  return id === "kessar" ? { x: A.landing.x, z: A.landing.z } : id === "highmark" ? { x: H.landing.x, z: H.landing.z } : id === "vesper" ? { x: V.landing.x, z: V.landing.z }
    : id === "saltmarket" ? { x: SM.landing.x, z: SM.landing.z } : { x: JETTY.x0, z: JETTY.z0 };
}

/** D-047: where the hired hands stand at home, a step inland of the jetty's foot (the jetty's own end puts part of their ring over the pond); proven open by Followers.test.ts. */
export const HUB_CREW_SPOT = { x: JETTY.x0 - 1.5, z: JETTY.z0 + 1 } as const;

/** Navigation options of a region's nav grid (Kessar closes the gorge and prunes the sealed courtyard; Highmark the river). Hollowmere: none. */
export function regionNavOptions(id: RegionId, world: CollisionWorld): NavOptions {
  return id === "kessar" ? kessarNavOptions(world) : id === "highmark" ? highmarkNavOptions(world) : id === "vesper" ? vesperNavOptions(world) : id === "saltmarket" ? saltmarketNavOptions(world) : {};
}

/** The collision world of a region. `opts` (bridge, outpost stage, telegraph) matter where they exist (the bridge to Kessar, the outpost to Kessar and Highmark): the world is a pure function of (seed, those). */
export function createRegionWorld(id: RegionId, seed: number, opts?: RegionWorldOpts): CollisionWorld {
  return id === "kessar" ? createKessarWorld(seed, opts?.bridge ?? "intact", { outpost: opts?.outpost, telegraph: opts?.telegraph, rivalPost: opts?.rivalPost, railway: opts?.railway, works: opts?.works, crank: opts?.crank })
    : id === "highmark" ? createHighmarkWorld(seed, { outpost: opts?.outpost, telegraph: opts?.telegraph, works: opts?.works, crank: opts?.crank })
    : id === "vesper" ? createVesperWorld(seed) : id === "saltmarket" ? createSaltmarketWorld(seed) : createArena(seed);
}

/** Where player `index` of `count` arrives. */
export function regionSpawn(id: RegionId, index: number, count = 4): { x: number; z: number } {
  return id === "kessar" ? kessarSpawn(index, count) : id === "highmark" ? highmarkSpawn(index, count) : id === "vesper" ? vesperSpawn(index, count) : id === "saltmarket" ? saltmarketSpawn(index, count) : spawnPoint(index, count);
}

/** The props a region starts with (the integrator spawns them in the physics world). */
export function regionProps(id: RegionId, seed: number, world: CollisionWorld): PropSpawn[] {
  return id === "kessar" ? kessarProps(seed, world) : id === "highmark" ? highmarkProps(seed, world) : id === "vesper" ? vesperProps(seed, world) : id === "saltmarket" ? saltmarketProps(seed, world) : campProps(seed, world);
}

// ---- stations: the places you can USE (map table, notice board, the dock, the pier, the Warden) ------------------------------------------------------

const HOLLOWMERE_STATIONS: readonly UseStation[] = [
  { id: "map", kind: "map", x: CAMP.mapTable.x, z: CAMP.mapTable.z, r: 2.4, prompt: "Open the map" },
  { id: "paper", kind: "paper", x: hqPlan().notice.x, z: hqPlan().notice.z, r: 2.4, prompt: "Read the notice board" },
  { id: "dock", kind: "dock", x: JETTY.x0, z: JETTY.z0, r: 3, prompt: "Choose where to sail" },
  { id: "loadout", kind: "loadout", x: hqPlan().pyramid.tiers[0]!.x, z: hqPlan().pyramid.tiers[0]!.z, r: 2.4, prompt: "Open the supplies" },
];

const KESSAR_STATIONS: readonly UseStation[] = [
  { id: "pier", kind: "pier", x: A.pier.x, z: A.pier.z, r: 2.2, prompt: "Inspect the pier" },
  { id: "warden", kind: "warden", x: A.wardenPost.x, z: A.wardenPost.z, r: 2.6, prompt: "Talk to the Warden" },
  { id: "dock", kind: "dock", x: A.landing.x, z: A.landing.z, r: 4, prompt: "Take the boat home" },
  // D-035: the foundation of the Society's outpost. Acted on server-side by INTERACT while carrying a prop (no sheet); the client words its prompt from the settlements state.
  { id: "foundation", kind: "foundation", x: OUTPOST_SITES.kessar!.site.x, z: OUTPOST_SITES.kessar!.site.z, r: YARD_R - 1, prompt: "Deliver a crate to the foundation" },
];

// D-036: Highmark's court. The people are the scenario's (NPC rows); these are the HUD's prompts and the server's "court" use points (kind "court", acted on through the scenario).
const HIGHMARK_STATIONS: readonly UseStation[] = [
  { id: "dock", kind: "dock", x: H.landing.x, z: H.landing.z, r: 4, prompt: "Take the barge home" },
  // D-056: the Society's second foundation, on the grass west of the landing (acted on exactly as Kessar's)
  { id: "foundation", kind: "foundation", x: OUTPOST_SITES.highmark!.site.x, z: OUTPOST_SITES.highmark!.site.z, r: YARD_R - 1, prompt: "Deliver a crate to the foundation" },
  { id: "chamberlain", kind: "court", x: HS.chamberlain.x, z: HS.chamberlain.z, r: 2.6, prompt: "Talk to the Chamberlain" },
  { id: "elder", kind: "court", x: HS.claimants.elder.x, z: HS.claimants.elder.z, r: 2.6, prompt: "Talk to Princess Orla" },
  { id: "younger", kind: "court", x: HS.claimants.younger.x, z: HS.claimants.younger.z, r: 2.6, prompt: "Talk to Prince Dunstan" },
];

const stationList = (id: RegionId): readonly UseStation[] =>
  id === "kessar" ? KESSAR_STATIONS : id === "highmark" ? HIGHMARK_STATIONS : id === "vesper" ? VESPER_STATIONS : id === "saltmarket" ? SALTMARKET_STATIONS : HOLLOWMERE_STATIONS;

export function stationsFor(id: RegionId): UseStation[] {
  return [...stationList(id)];
}

/**
 * The station a player at (x, z) facing `facing` (0 = -Z, as movement.ts) would use: inside its radius and, beyond arm's reach, inside the frontal
 * cone (the same rule as props, INTERACT). The nearest and most centred wins. Pure, allocation-free; the returned object is shared, do not mutate it.
 */
export function findStation(id: RegionId, x: number, z: number, facing: number): UseStation | undefined {
  const list = stationList(id);
  let best: UseStation | undefined;
  let bestScore = Infinity;
  for (let i = 0; i < list.length; i++) {
    const s = list[i]!;
    const dx = s.x - x;
    const dz = s.z - z;
    // (a square root of a sum, never Math.hypot: that builtin boxed both arguments and its result, 38 B for every station on every call, 304 B a lookup at the depot: findStationAlloc.test.ts)
    const d2 = dx * dx + dz * dz;
    if (d2 > s.r * s.r) continue;
    const dist = Math.sqrt(d2);
    const off = Math.abs(angleDelta(facing, Math.atan2(-dx, -dz)));
    if (dist > CHARACTER.radius + 0.35 && off > INTERACT.cone) continue;
    const score = dist + off * 0.6;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
