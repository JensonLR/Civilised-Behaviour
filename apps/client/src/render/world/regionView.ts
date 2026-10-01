import type { Group, Scene, Vector3 } from "three";
import type { DayState, RegionDress } from "@cb/shared";
import type { HqHistoryPiece } from "@cb/shared";
import type { CollisionWorld } from "@cb/shared";
import { WorldView, type WorldDetail, type WorldStats } from "./WorldView.ts";
import { KessarView } from "./kessar/KessarView.ts";
import type { RegionId } from "./kessar/shared.ts";

/**
 * What the Stage needs of the scenery of the region it is in, whichever region that is: the root to hide while shaders link, the draw and triangle
 * counts, the day's light, the wind clock, the grass benders, and a way to free it all. `WorldView` (Hollowmere) already has exactly this surface.
 */
export interface RegionView {
  readonly root: Group;
  readonly stats: WorldStats;
  applyDay(d: DayState): void;
  update(t: number, cam?: { x: number; y?: number; z: number }, worldSec?: number): void;
  setPushers(list: readonly { x: number; z: number }[], n?: number): void;
  /** D-035: what the Society and the Syndicate have built (Kessar swaps its outpost group in place; no collision). */
  applyDress?(d: RegionDress): void;
  /** D-035: what HQ keeps of the campaign, on the planning table, the strongbox and the marquee's back wall (Hollowmere). */
  applyHistory?(pieces: readonly HqHistoryPiece[]): void;
  dispose(): void;
}

/** Builds the scenery for a region from the same deterministic world the server simulates. Hollowmere is the existing WorldView, unchanged. */
export function createRegionView(id: RegionId, scene: Scene, world: CollisionWorld, detail: WorldDetail, sun: Vector3): RegionView {
  return id === "kessar" ? new KessarView(scene, world, detail, sun) : new WorldView(scene, world, detail, sun);
}
