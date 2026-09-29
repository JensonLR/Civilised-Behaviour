import { CollisionWorld, type Obstacle } from "./collision.ts";
import { Rng } from "./rng.ts";
import { createTerrain } from "./terrain.ts";

export const ARENA_RADIUS = 90;

/**
 * Deterministic proving-ground used for M1 movement work and automated tests. Real regions
 * (docs/GDD.md) replace this with authored landmarks + seeded dressing; the collision model
 * stays the same.
 */
export function createArena(seed: number): CollisionWorld {
  const terrain = createTerrain(seed);
  const rng = new Rng(seed ^ 0xa5a5a5a5);
  const obstacles: Obstacle[] = [];

  // Authored: a low stone wall ring with a gap, and a few standable crates by the spawn.
  const wallY = terrain.height(0, -12);
  obstacles.push({ kind: "box", x: 0, z: -12, hx: 6, hz: 0.4, yaw: 0, y0: wallY - 1, y1: wallY + 2.2 });
  obstacles.push({ kind: "box", x: 4, z: 6, hx: 0.6, hz: 0.6, yaw: 0.3, y0: terrain.height(4, 6) - 0.5, y1: terrain.height(4, 6) + 0.45 });
  obstacles.push({ kind: "box", x: 5.2, z: 6.4, hx: 0.6, hz: 0.6, yaw: -0.2, y0: terrain.height(5.2, 6.4) - 0.5, y1: terrain.height(5.2, 6.4) + 0.9 });

  // Seeded dressing: boulders and trunks scattered outside the spawn clearing.
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(16, ARENA_RADIUS - 4);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const y = terrain.height(x, z);
    if (rng.chance(0.55)) {
      const r = rng.range(0.25, 0.5);
      obstacles.push({ kind: "circle", x, z, r, y0: y - 1, y1: y + 6 });
    } else {
      const r = rng.range(0.8, 2.2);
      obstacles.push({ kind: "circle", x, z, r, y0: y - 2, y1: y + r * 1.4 });
    }
  }
  return new CollisionWorld(terrain, obstacles, ARENA_RADIUS);
}

/** Deterministic spawn ring around the origin for up to `count` players. */
export function spawnPoint(index: number, count = 4): { x: number; z: number } {
  const a = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 4;
  return { x: Math.cos(a) * 3, z: Math.sin(a) * 3 };
}
