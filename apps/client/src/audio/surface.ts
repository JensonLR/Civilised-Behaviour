import { HILL, trailSample, waterField, type TrailSample, type WaterField } from "@cb/shared";

export type Surface = "grass" | "dirt" | "stone" | "wood" | "water" | "mud" | "sand" | "plank";

const trail: TrailSample = { wear: 0, shoulder: 0, rut: 0 };
const water: WaterField = { q: 0, s: 0, pond: false };

/**
 * What a foot lands on at (x, z), from the same shared landscape functions the ground is painted with, so the sound and the picture agree:
 * the stream's wet channel, the Observatory's paved plateau, the worn footpaths (dirt), a raised object underfoot (crates, planks: wood) and
 * otherwise grass. `aboveGround` is the character's height over the terrain. Allocation-free.
 */
export function surfaceAt(x: number, z: number, aboveGround = 0): Surface {
  if (aboveGround > 0.25) return "wood";
  waterField(x, z, water);
  if (water.q < 0.75) return "water";
  if (Math.hypot(x - HILL.x, z - HILL.z) < HILL.plateau) return "stone";
  trailSample(x, z, trail);
  if (trail.wear > 0.4 || trail.rut > 0.3) return "dirt";
  return "grass";
}

/**
 * What the ground is in each region, where the Hollowmere landscape functions have nothing to say (D-038): Kessar's shore is sand, the Saltmarket's delta is mud, Vesper's canyon floor is stone and
 * dust. Only the soft grounds change (`grass` and `dirt`); water, wood and planks are what they are everywhere.
 */
export function regionSurface(region: string, base: Surface): Surface {
  if (base !== "grass" && base !== "dirt") return base;
  switch (region) {
    case "kessar":
      return "sand";
    case "saltmarket":
      return "mud";
    case "vesper":
      return base === "dirt" ? "dirt" : "stone";
    default:
      return base;
  }
}
