import { HIGHMARK, HILL, VESPER_ROAD_HALF, highmarkRoadDistance, saltmarketPlan, trailSample, vesperRoadDistance, waterField, type TrailSample, type WaterField } from "@cb/shared";

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

/** Half the drawn width of the Saltmarket's boardwalks (2.4 m planks: saltmarket/structures.ts), with a hand's breadth of margin. */
const WALK_HALF = 1.25;
let walks: { x: number; z: number }[][] | undefined;

/**
 * The surface under a foot in `region` (D-058). In Hollowmere: `surfaceAt`. Everywhere else the region's OWN ground, never Hollowmere's: `surfaceAt` reads the hub's stream, hill and
 * footpaths, so a walker on Kessar's beach where the hub's stream would run was heard splashing, and on Highmark's grass where the hub's paths would lie was heard on dirt. Real
 * water is the region's (`waterDepth` from its terrain); the Saltmarket's plank boardwalks lie flat on the silt (heard, and printed, as mud until now); Highmark's and Vesper's roads
 * are dirt. Allocation-free after the first call.
 */
export function regionSurfaceAt(region: string, x: number, z: number, aboveGround = 0, waterDepth = 0): Surface {
  if (aboveGround > 0.25) return "wood";
  if (region === "hollowmere") return surfaceAt(x, z, aboveGround);
  if (waterDepth > WADE) return "water";
  switch (region) {
    case "kessar":
      return "sand";
    case "saltmarket":
      walks ??= saltmarketPlan().boardwalks.map((w) => w.pts);
      return nearPaths(walks, x, z, WALK_HALF) ? "plank" : "mud";
    case "vesper":
      return vesperRoadDistance(x, z) < VESPER_ROAD_HALF ? "dirt" : "stone";
    case "highmark":
      return highmarkRoadDistance(x, z) < HIGHMARK.roadHalf ? "dirt" : "grass";
    default:
      return "grass";
  }
}

/** Standing water deeper than this (m) is heard as water. */
const WADE = 0.06;

/** True when (x, z) lies within `r` of any segment of the polylines (squared distances: no square root, no allocation). */
function nearPaths(paths: readonly (readonly { x: number; z: number }[])[], x: number, z: number, r: number): boolean {
  const r2 = r * r;
  for (const pl of paths) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i]!, b = pl[i + 1]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const ex = x - (a.x + dx * t), ez = z - (a.z + dz * t);
      if (ex * ex + ez * ez < r2) return true;
    }
  }
  return false;
}
