import { ARENA_RADIUS, createArena, spawnPoint } from "./arena.ts";
import { CAMP, hqPlan } from "./camp.ts";
import { KESSAR_ANCHORS as A, SAIL_SECONDS, type BridgeState, type RegionId, type UseStation } from "./campaignTypes.ts";
import type { CollisionWorld } from "./collision.ts";
import { CHARACTER } from "./constants.ts";
import { createKessarWorld, kessarProps, kessarSpawn } from "./kessar.ts";
import { JETTY } from "./landscape.ts";
import { angleDelta } from "./math.ts";
import { INTERACT, scatterProps, type PropSpawn } from "./props.ts";

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
}

export const REGIONS: Record<RegionId, RegionDef> = {
  hollowmere: {
    id: "hollowmere",
    name: "Hollowmere Depot",
    blurb: "Home. The Society's depot, the notice board, the cannon and a village that has learned to smile at invoices.",
    bounds: ARENA_RADIUS,
    sailSeconds: SAIL_SECONDS,
  },
  kessar: {
    id: "kessar",
    name: "Kessar Reach",
    blurb: "An ochre coast, one stone bridge and a hill-fort whose Ward of the Nine Lamps charges a toll to be crossed. A rival syndicate has also noticed the bridge.",
    bounds: A.bounds,
    sailSeconds: SAIL_SECONDS,
  },
};

/** The collision world of a region. `opts.bridge` only matters to Kessar (a collapsed bridge has no deck). */
export function createRegionWorld(id: RegionId, seed: number, opts?: { bridge?: BridgeState }): CollisionWorld {
  return id === "kessar" ? createKessarWorld(seed, opts?.bridge ?? "intact") : createArena(seed);
}

/** Where player `index` of `count` arrives. */
export function regionSpawn(id: RegionId, index: number, count = 4): { x: number; z: number } {
  return id === "kessar" ? kessarSpawn(index, count) : spawnPoint(index, count);
}

/** The props a region starts with (the integrator spawns them in the physics world). */
export function regionProps(id: RegionId, seed: number, world: CollisionWorld): PropSpawn[] {
  return id === "kessar" ? kessarProps(seed, world) : scatterProps(seed, world.terrain, 14);
}

// ---- stations: the places you can USE (map table, notice board, the dock, the pier, the Warden) ------------------------------------------------------

const HOLLOWMERE_STATIONS: readonly UseStation[] = [
  { id: "map", kind: "map", x: CAMP.mapTable.x, z: CAMP.mapTable.z, r: 2.4, prompt: "Consult the map room" },
  { id: "paper", kind: "paper", x: hqPlan().notice.x, z: hqPlan().notice.z, r: 2.4, prompt: "Read the notice board" },
  { id: "dock", kind: "dock", x: JETTY.x0, z: JETTY.z0, r: 3, prompt: "Take the boat: the map room" },
  { id: "loadout", kind: "loadout", x: hqPlan().pyramid.tiers[0]!.x, z: hqPlan().pyramid.tiers[0]!.z, r: 2.4, prompt: "Draw up the supply manifest" },
];

const KESSAR_STATIONS: readonly UseStation[] = [
  { id: "pier", kind: "pier", x: A.pier.x, z: A.pier.z, r: 2.2, prompt: "Inspect the pier" },
  { id: "warden", kind: "warden", x: A.wardenPost.x, z: A.wardenPost.z, r: 2.6, prompt: "Parley with the Warden" },
  { id: "dock", kind: "dock", x: A.landing.x, z: A.landing.z, r: 4, prompt: "Take the boat home" },
];

export function stationsFor(id: RegionId): UseStation[] {
  return [...(id === "kessar" ? KESSAR_STATIONS : HOLLOWMERE_STATIONS)];
}

/**
 * The station a player at (x, z) facing `facing` (0 = -Z, as movement.ts) would use: inside its radius and, beyond arm's reach, inside the frontal
 * cone (the same rule as props, INTERACT). The nearest and most centred wins. Pure, allocation-free; the returned object is shared, do not mutate it.
 */
export function findStation(id: RegionId, x: number, z: number, facing: number): UseStation | undefined {
  const list = id === "kessar" ? KESSAR_STATIONS : HOLLOWMERE_STATIONS;
  let best: UseStation | undefined;
  let bestScore = Infinity;
  for (let i = 0; i < list.length; i++) {
    const s = list[i]!;
    const dx = s.x - x;
    const dz = s.z - z;
    const dist = Math.hypot(dx, dz);
    if (dist > s.r) continue;
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
