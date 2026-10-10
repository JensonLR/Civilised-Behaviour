import type { RegionId } from "./campaignTypes.ts";
import type { CollisionWorld } from "./collision.ts";
import { HIGHMARK, HIGHMARK_SITES, highmarkRoadness } from "./highmark.ts";
import { KESSAR, kessarRiverHalf, kessarRiverZ, kessarRoad, kessarWallRun } from "./kessar.ts";
import { smoothstep } from "./math.ts";
import { SALTMARKET } from "./saltmarket.ts";
import { valueNoise } from "./terrain.ts";
import { vesperRoadX, vesperRoadness } from "./vesper.ts";
import { coverDensity } from "./worldgen.ts";

/**
 * Where plants grow, region by region: 0..1 cover (grass tufts, scrub, sedge). The renderers' scatters strew their grass by these, and since D-103 the fire's fuel map reads the
 * same numbers, so flames run where grass is drawn and stop on roads, sand, water, hills and bare patches. Pure and deterministic (moved here from the client's ground modules,
 * which re-export them). Hollowmere's is `coverDensity` (worldgen.ts).
 */

/** Vesper's pool at the head of the gorge (no plants round it; its paint is the client's). */
export const VESPER_POOL = { x: 0, z: 134, r: 7 } as const;

/** Plant cover 0..1 (grass tufts, bushes): scrub patches on the swells, none on roads, sand, in the gorge or on the fort's hill. Mirrors the paint. */
export function kessarCover(x: number, z: number, h: number, slope: number): number {
  const n1 = valueNoise(211, x / 13, z / 13);
  const n2 = valueNoise(223, x / 4, z / 4);
  const patch = smoothstep(0.42, 0.62, n1 + (n2 - 0.5) * 0.25);
  const beach = smoothstep(84, 94, z);
  const road = kessarRoad(x, z);
  const yard = 1 - smoothstep(9, 15, Math.hypot(x, z - 6));
  const gorge = 1 - smoothstep(0, 4.5, Math.abs(z - kessarRiverZ(x)) - kessarRiverHalf(x) - kessarWallRun(x) + 4.5);
  const v = patch * (1 - beach) * (1 - road * 1.4) * (1 - yard) * (1 - gorge) * (1 - smoothstep(0.3, 0.6, slope)) * (1 - smoothstep(KESSAR.level + 2, KESSAR.level + 4, h));
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** D-046: 1 inside the barley field (HIGHMARK_SITES.strike.field), easing to 0 over a metre and a half outside it. */
export function highmarkFieldMask(x: number, z: number): number {
  const f = HIGHMARK_SITES.strike.field;
  const out = Math.max(f.x0 - x, x - f.x1, f.z0 - z, z - f.z1, 0);
  return 1 - smoothstep(0, 1.5, out);
}

/** Plant cover 0..1 (grass tufts, bushes): the savannah, in patches; none on the road, the hill, the bank or in the water. Mirrors the paint. */
export function highmarkCover(x: number, z: number, h: number, slope: number, water = 0): number {
  const n1 = valueNoise(311, x / 15, z / 15);
  const n2 = valueNoise(323, x / 4.2, z / 4.2);
  const patch = 0.45 + 0.55 * smoothstep(0.22, 0.52, n1 + (n2 - 0.5) * 0.3);
  const road = highmarkRoadness(x, z);
  const hill = 1 - smoothstep(HIGHMARK.radii[0]! + HIGHMARK.rampRun + 3, HIGHMARK.radii[0]! + HIGHMARK.rampRun + 10, Math.hypot(x - HIGHMARK.centre.x, z - HIGHMARK.centre.z));
  const bank = smoothstep(HIGHMARK.river.z - HIGHMARK.river.half - HIGHMARK.river.bank - 2, HIGHMARK.river.z - HIGHMARK.river.half - 4, z);
  const v = patch * (1 - road * 1.4) * (1 - hill) * (1 - bank) * (1 - smoothstep(0.35, 0.7, slope)) * (water > 0 ? 0 : 1) * (1 - highmarkFieldMask(x, z));   // (the field grows barley, not wild grass)
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Plant cover 0..1 (reeds, sedge): thick at the water's edge and in the shallows, thinning on the dry plain; none on the planks' ground, the quay's apron, deep water or the sites. Mirrors the paint. */
export function saltmarketCover(x: number, z: number, h: number, slope: number, water = 0): number {
  const n1 = valueNoise(411, x / 17, z / 17);
  const n2 = valueNoise(423, x / 5.1, z / 5.1);
  const wet = 1 - smoothstep(0.05, 0.5, Math.abs(h - SALTMARKET.waterY - 0.15));   // near the waterline, either side
  const patch = 0.3 + 0.7 * smoothstep(0.3, 0.6, n1 + (n2 - 0.5) * 0.3);
  const v = (0.18 + 0.82 * wet) * patch * (1 - smoothstep(0.35, 0.7, slope)) * (water > 0.55 ? 0 : 1);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Plant cover 0..1 (dry tufts, thorn scrub, snags): sparse, on the floor and the benches, never on the road, the bed, the cliffs or the scree. Mirrors the paint. */
export function vesperCover(x: number, z: number, h: number, slope: number, floorY: number): number {
  const n1 = valueNoise(411, x / 14, z / 14);
  const n2 = valueNoise(413, x / 4.1, z / 4.1);
  const patch = 0.25 + 0.75 * smoothstep(0.42, 0.7, n1 + (n2 - 0.5) * 0.3);
  const road = vesperRoadness(x, z);
  const bedU = 4.5 * Math.sin(z * 0.045 + 0.7);
  const bed = 1 - smoothstep(1.6, 4.6, Math.abs(x - vesperRoadX(z) - bedU));
  const rel = h - floorY;
  const v = patch * (1 - road * 1.4) * (1 - bed * 0.85) * (1 - smoothstep(0.2, 0.55, slope)) * (rel > 14 ? 0 : 1) * (Math.hypot(x - VESPER_POOL.x, z - VESPER_POOL.z) < VESPER_POOL.r + 2 ? 0 : 1);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const SLOPE_E = 0.6;

/**
 * D-103: a region's plant cover at (x, z), measured as its scatter measures it (the slope over 0.6 m, the standing water, Vesper's canyon floor). Hollowmere's adds its meadow
 * rule (`coverDensity`). Highmark's barley field counts as cover here (the scatter plants it as its own crop): it burns like the rest.
 */
export function regionCover(region: RegionId, world: CollisionWorld, x: number, z: number): number {
  const t = world.terrain as { height(x: number, z: number): number; waterDepth?: (x: number, z: number) => number; floor?: (x: number, z: number) => number };
  const h = t.height(x, z);
  const slope = Math.hypot(t.height(x + SLOPE_E, z) - h, t.height(x, z + SLOPE_E) - h) / SLOPE_E;
  const water = t.waterDepth?.(x, z) ?? 0;
  switch (region) {
    case "kessar":
      return kessarCover(x, z, h, slope);
    case "highmark":
      return water > 0 ? 0 : Math.max(highmarkCover(x, z, h, slope, water), highmarkFieldMask(x, z));
    case "saltmarket":
      return saltmarketCover(x, z, h, slope, water);
    case "vesper":
      return vesperCover(x, z, h, slope, t.floor?.(x, z) ?? h);
    default:
      return coverDensity(x, z, slope);
  }
}
