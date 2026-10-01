import type { FolkBudget } from "./villagers.ts";

/**
 * What the village crowd costs in DRAW CALLS now that levels 1 and 2 are merged (D-036, package Q; the triangles are `FOLK_TRIS` and did not change). Main pass, counted in Node by
 * `folkMerged.test.ts` against the real roster rigs: a full-detail person is the rig's bone meshes, the face's parts and (where ink is on) a hull per bone; a person at either crowd
 * level is ONE skinned mesh (`merged` in packages/procedural `rig.ts`). Shadow casters come on top inside the shadow frustum, as before. These are MEASURED ceilings (the test fails when
 * a rig grows past them), not hopes.
 */
export const FOLK_DRAWS = { lod0: 28, lod0Ink: 41, lod1: 1, lod2: 1 } as const;

/** Main-pass meshes for a crowd with `lod[l]` people at level `l` (`planLods`' own counts) under `budget`'s ink setting. */
export function crowdDraws(budget: FolkBudget, lod: readonly [number, number, number]): number {
  return lod[0] * (budget.outlines ? FOLK_DRAWS.lod0Ink : FOLK_DRAWS.lod0) + lod[1] * FOLK_DRAWS.lod1 + lod[2] * FOLK_DRAWS.lod2;
}
