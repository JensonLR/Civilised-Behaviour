import { CollisionWorld, type Obstacle } from "./collision.ts";
import { campObstacles } from "./camp.ts";
import { Rng } from "./rng.ts";
import { createTerrain } from "./terrain.ts";
import { HILL, nearTrail, waterEdgeDistance, withLandscape } from "./landscape.ts";
import { ruinObstacles } from "./ruins.ts";
import { clearingObstacles } from "./clearing.ts";
import { cannonObstacles } from "./weapons.ts";

export const ARENA_RADIUS = 90;

/**
 * Deterministic proving-ground used for M1 movement work and automated tests. Real regions
 * (docs/GDD.md) replace this with authored landmarks + seeded dressing; the collision model
 * stays the same.
 */
export function createArena(seed: number): CollisionWorld {
  // Base noise + the Observatory hill + the stream and its pond (landscape.ts): the SAME terrain on the server and every client.
  const terrain = withLandscape(createTerrain(seed));
  const rng = new Rng(seed ^ 0xa5a5a5a5);
  // The authored expedition camp (ruined wall, step-up crates, tents, fire, flag, signpost, luggage, cart, map table, washing...): camp.ts.
  // The Observatory ruin and its aqueduct: ruins.ts. The camp's field cannon: weapons.ts.
  const obstacles: Obstacle[] = [...campObstacles(terrain), ...ruinObstacles(terrain), ...cannonObstacles(terrain)];

  const MAX_D = ARENA_RADIUS - 4;
  const tooClose = (x: number, z: number, gap: number): boolean => {
    // Nothing tall stands on a footpath or in the stream (rocks may sit close to the bank; trees keep further back).
    if (nearTrail(x, z, 0.6 + gap * 0.5) || waterEdgeDistance(x, z) < 0.5 + gap * 0.8) return true;
    // The Observatory's plateau is paved and colonnaded: no timber or boulders up there.
    if ((x - HILL.x) ** 2 + (z - HILL.z) ** 2 < 13 * 13) return true;
    for (const o of obstacles) {
      const dx = o.x - x;
      const dz = o.z - z;
      const r = (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + gap;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };
  const tree = (x: number, z: number): void => {
    const y = terrain.height(x, z);
    obstacles.push({ kind: "circle", tag: "tree", x, z, r: rng.range(0.25, 0.5), y0: y - 1, y1: y + 6 });
  };
  const rock = (x: number, z: number, r: number): void => {
    const y = terrain.height(x, z);
    obstacles.push({ kind: "circle", tag: "rock", x, z, r, y0: y - 1.2, y1: y + r * 1.4 });
  };
  const snag = (x: number, z: number): void => {
    const y = terrain.height(x, z);
    obstacles.push({ kind: "circle", tag: "snag", x, z, r: rng.range(0.2, 0.32), y0: y - 1, y1: y + rng.range(5, 6) });
  };
  const polar = (cx: number, cz: number, spread: number): [number, number] => {
    const a = rng.range(0, Math.PI * 2);
    const d = spread * Math.sqrt(rng.next());
    return [cx + Math.cos(a) * d, cz + Math.sin(a) * d];
  };
  const inside = (x: number, z: number): boolean => Math.hypot(x, z) >= 16 && Math.hypot(x, z) <= MAX_D;

  // Seeded dressing, outside the spawn clearing. Groves and rocky outcrops read as places; lone trees and boulders fill the gaps.
  for (let g = 0; g < 8; g++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(26, 78);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    const count = rng.int(5, 9);
    for (let i = 0, tries = 0; i < count && tries < 40; tries++) {
      const [x, z] = polar(cx, cz, 9);
      if (!inside(x, z) || tooClose(x, z, 1.6)) continue;
      tree(x, z);
      i++;
    }
  }
  for (let k = 0; k < 7; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(30, 80);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    if (!inside(cx, cz) || tooClose(cx, cz, 1.4)) continue; // an outcrop never sits on a path, in the stream or on the Observatory's plateau
    rock(cx, cz, rng.range(1.4, 2.2));
    for (let i = 0, n = rng.int(2, 4), tries = 0; i < n && tries < 20; tries++) {
      const [x, z] = polar(cx, cz, 4.2);
      if (!inside(x, z) || tooClose(x, z, 0.2)) continue;
      rock(x, z, rng.range(0.5, 1.2));
      i++;
    }
    if (rng.chance(0.7)) {
      const [x, z] = polar(cx, cz, 5.5);
      if (inside(x, z) && !tooClose(x, z, 0.8)) snag(x, z);
    }
  }
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(16, MAX_D);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (tooClose(x, z, 1.2)) continue;
    if (rng.chance(0.55)) tree(x, z);
    else rock(x, z, rng.range(0.5, 1.6));
  }
  // Felled timber beside the groves, appended last with its own stream so it never moves a tree or a rock: stumps (low enough to
  // step onto) and fallen logs (jump them). Collidable, tagged, and identical on the server and every client.
  const wood = new Rng(seed ^ 0x51fe7a3);
  const trees = obstacles.filter((o) => o.tag === "tree");
  for (let i = 0, made = 0, tries = 0; made < 16 && tries < 160 && trees.length > 0; tries++) {
    const t = trees[Math.floor(wood.next() * trees.length)]!;
    const a = wood.range(0, Math.PI * 2);
    const d = wood.range(2.4, 5.4);
    const x = t.x + Math.cos(a) * d;
    const z = t.z + Math.sin(a) * d;
    const stump = i++ % 2 === 0;
    if (!inside(x, z) || tooClose(x, z, stump ? 0.9 : 1.7)) continue;
    const y = terrain.height(x, z);
    if (stump) obstacles.push({ kind: "circle", tag: "stump", x, z, r: wood.range(0.34, 0.55), y0: y - 1, y1: y + wood.range(0.34, 0.5) });
    else {
      const s = wood.range(0.75, 1.1);
      obstacles.push({ kind: "box", tag: "log", x, z, hx: wood.range(0.85, 1.25) * s, hz: 0.46 * s, yaw: wood.range(0, Math.PI), y0: y - 1, y1: y + 0.92 * s });
    }
    made++;
  }
  // The country's furniture (the well, the pen, the signposts, the footbridge: clearing.ts) goes in LAST: nothing above consumes randomness
  // differently for it, so every tree, rock and stump keeps the place it always had; the few that would stand inside a fence or a well are
  // simply not there. (Moving the whole forest whenever a signpost is authored would break every test that fires along a fixed line.)
  const furniture = clearingObstacles(terrain);
  const clashes = (o: Obstacle): boolean =>
    furniture.some((f) => {
      const reach = (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + (f.kind === "circle" ? f.r : Math.hypot(f.hx, f.hz)) + 0.6;
      return (o.x - f.x) ** 2 + (o.z - f.z) ** 2 < reach * reach;
    });
  const kept = obstacles.filter((o) => !(["tree", "rock", "snag", "stump", "log"].includes(o.tag ?? "") && clashes(o)));
  return new CollisionWorld(terrain, [...kept, ...furniture], ARENA_RADIUS);
}

/** Deterministic spawn ring around the origin for up to `count` players. */
export function spawnPoint(index: number, count = 4): { x: number; z: number } {
  const a = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 4;
  return { x: Math.cos(a) * 3, z: Math.sin(a) * 3 };
}
