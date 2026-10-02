import type { BufferGeometry } from "three";
import type { CollisionWorld } from "./shared.ts";
import { Kit } from "../kit.ts";
import { RoofKits, type DoorMark, type RoofSource } from "../rooms.ts";
import type { Lod } from "../flora.ts";
import { addVesperStructures } from "./structures.ts";
import { addVesperWorks } from "./works.ts";

/**
 * Everything solid and built in Vesper Gorge, merged into ONE vertex-coloured geometry (one draw, one ink hull): the buildings and small things (structures.ts) and the works (works.ts). `lod` 0 is the
 * cheap shape the ink hull and the low preset use. The lamps' positions come back for the glow.
 */
export function buildVesperSolid(world: CollisionWorld, lod: Lod): { geometry: BufferGeometry | undefined; glows: { x: number; y: number; z: number; lit?: number }[]; marks: DoorMark[]; roofs: RoofSource | undefined } {
  const k = new Kit();
  const parts = { glows: [] as { x: number; y: number; z: number; lit?: number }[], marks: [] as DoorMark[], roofs: new RoofKits() };
  addVesperStructures(k, world, lod, parts);
  addVesperWorks(k, world, lod, parts);
  k.clearBase();
  return { geometry: k.build(), glows: parts.glows, marks: parts.marks, roofs: parts.roofs.finish() };
}
