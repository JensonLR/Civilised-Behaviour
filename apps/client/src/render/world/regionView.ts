import type { Group, Scene, Vector3 } from "three";
import type { DayState, RegionDress, ScenarioView } from "@cb/shared";
import type { HqHistoryPiece } from "@cb/shared";
import type { CollisionWorld } from "@cb/shared";
import { WorldView, type WorldDetail, type WorldStats } from "./WorldView.ts";
import { HighmarkView } from "./highmark/HighmarkView.ts";
import { KessarView } from "./kessar/KessarView.ts";
import { SaltmarketView } from "./saltmarket/SaltmarketView.ts";
import { VesperView } from "./vesper/VesperView.ts";
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
  /**
   * D-037: the contract being played, as the server last published it (`undefined` when none): its phase, objectives, `resolution`, and the timer `endsAtWorldMs` (the same world clock `update`'s `worldSec`
   * counts, in ms). A region's scenery may SHOW it (the Lower Gallery's fall opening, the Exchange's water rising towards high water) but never decides it: the collision world is a pure function of the
   * seed and never changes with a scenario, and nothing here is replicated. Called on every scenario revision and again on every rebuild.
   */
  applyScenario?(v: ScenarioView | undefined): void;
  /**
   * D-038 (docs/LEVEL_PLAN.md section 4, rule 7): where the local player stands, once a frame. A region with walkable interiors lifts the roof of the room the viewer is in (the third-person camera never sits under
   * a ceiling) and puts it back when they leave. The integrator calls it from Game.ts with the local player's x and z.
   */
  setViewer?(x: number, z: number): void;
  /** D-035: what HQ keeps of the campaign, on the planning table, the strongbox and the marquee's back wall (Hollowmere). */
  applyHistory?(pieces: readonly HqHistoryPiece[]): void;
  dispose(): void;
}

/**
 * Builds the scenery for a region from the same deterministic world the server simulates. Hollowmere is the existing WorldView, unchanged. `seed` (D-036) is the room's world seed (D-037: the later regions take it too): Highmark's
 * herds graze as a pure function of (seed, world clock), so the integrator hands the same seed the server built the world from (absent: 7, the arena's default).
 */
export function createRegionView(id: RegionId, scene: Scene, world: CollisionWorld, detail: WorldDetail, sun: Vector3, seed?: number): RegionView {
  return id === "kessar" ? new KessarView(scene, world, detail, sun) : id === "highmark" ? new HighmarkView(scene, world, detail, sun, seed ?? 7)
    : id === "vesper" ? new VesperView(scene, world, detail, sun, seed ?? 7) : id === "saltmarket" ? new SaltmarketView(scene, world, detail, sun, seed ?? 7) : new WorldView(scene, world, detail, sun);
}
