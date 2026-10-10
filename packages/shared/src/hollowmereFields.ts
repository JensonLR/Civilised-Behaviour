import type { FieldPlot, Orchard } from "./fields.ts";

/**
 * D-117: Hollowmere's worked land. The owner found the country "very sparse": south of the camp the arena was eighty metres of seeded forest scatter with nothing a
 * person had done to it. The village now farms it: the mill's barley beside the west track, mown hay south of the sheep's grazing, a field of young barley, a stubble field
 * with its stooks still standing and a ploughed one, all in the south-west; and an orchard east of the coast road with its hives. One list, read by the ground's paint, the
 * grass (which does not grow on a field), the fire (the crops burn as they do at Highmark), the scatter (the barley, the ridges, the stooks) and the world's obstacles
 * (arena.ts appends them after the dressing, so no tree or rock has moved: the dressing that stood in a field is simply not there).
 *
 * The rectangles were chosen on the terrain (`createArena`): every one is off the footpaths, out of the water and the village, inside the arena with room, and on ground
 * no steeper than 0.21. The sheep grazing at (-8.5, 25) and the deer at (47, 9) keep their ground.
 */
export const HOLLOWMERE_FIELDS: readonly FieldPlot[] = [
  { id: "barley.mill", x0: -58, x1: -36, z0: 14, z1: 34, row: 0.9, crop: "barley" },
  { id: "hay.south", x0: -34, x1: -15, z0: 30, z1: 52, row: 1.4, crop: "hay" },
  { id: "green.south", x0: -60, x1: -40, z0: 42, z1: 60, row: 0.8, crop: "green" },
  { id: "stubble.far", x0: -36, x1: -12, z0: 56, z1: 76, row: 1.1, crop: "stubble" },
  { id: "fallow.west", x0: -78, x1: -62, z0: 16, z1: 32, row: 1.2, crop: "fallow" },
];

export const HOLLOWMERE_ORCHARD: Orchard = { id: "orchard", x0: 28, x1: 56, z0: 20, z1: 44, pitch: 5.5, hives: 3 };
