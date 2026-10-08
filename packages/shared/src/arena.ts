import { CollisionWorld, type Obstacle } from "./collision.ts";
import { campObstacles } from "./camp.ts";
import { Rng } from "./rng.ts";
import { createTerrain } from "./terrain.ts";
import { HILL, nearTrail, waterEdgeDistance, withLandscape } from "./landscape.ts";
import { VILLAGE_PADS, villageKeepOut, villageObstacles, villagePlan } from "./village.ts";
import { ruinObstacles, ruinPlan } from "./ruins.ts";
import { clearingObstacles } from "./clearing.ts";
import { cannonObstacles } from "./weapons.ts";
import type { Pt } from "./hqRoute.ts";
import { hqLane, hqRoute, hqRouteObstacles } from "./hqRoute.ts";
import { distToPaths } from "./levelPlan.ts";

export const ARENA_RADIUS = 90;

/**
 * Deterministic proving-ground used for M1 movement work and automated tests. Real regions
 * (docs/GDD.md) replace this with authored landmarks + seeded dressing; the collision model
 * stays the same.
 */
let hqLinesCache: Pt[][] | undefined;
export function createArena(seed: number): CollisionWorld {
  // Base noise + the Observatory hill + the stream and its pond (landscape.ts): the SAME terrain on the server and every client.
  const terrain = withLandscape(createTerrain(seed), VILLAGE_PADS);
  const rng = new Rng(seed ^ 0xa5a5a5a5);
  // The authored expedition camp (ruined wall, step-up crates, tents, fire, flag, signpost, luggage, cart, map table, washing...): camp.ts.
  // The Observatory ruin and its aqueduct: ruins.ts. The camp's field cannon: weapons.ts.
  const obstacles: Obstacle[] = [...campObstacles(terrain), ...ruinObstacles(terrain), ...cannonObstacles(terrain)];
  const fixed: readonly Obstacle[] = obstacles.slice(); // (the camp, the Observatory and the cannon, before any dressing)

  const MAX_D = ARENA_RADIUS - 4;
  const tooClose = (x: number, z: number, gap: number): boolean => {
    // Nothing tall stands on a footpath or in the stream (rocks may sit close to the bank; trees keep further back).
    if (nearTrail(x, z, 0.6 + gap * 0.5, "legacy") || waterEdgeDistance(x, z) < 0.5 + gap * 0.8) return true;
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
  // The country's furniture (the well, the pen, the signposts, the footbridge: clearing.ts; the village: village.ts) goes in LAST: nothing above consumes
  // randomness differently for it, so every tree, rock and stump keeps the place it always had; the few that would stand inside a fence or a well are
  // simply not there. (Moving the whole forest whenever a signpost is authored would break every test that fires along a fixed line.)
  const furniture = [...clearingObstacles(terrain), ...villageObstacles(terrain)];
  const hqLines = (): Pt[][] => (hqLinesCache ??= [hqRoute().dock, hqRoute().map, hqLane()]);
  const clashesFurniture = (x: number, z: number, r: number): boolean =>
    villageKeepOut(x, z, r + 0.6) ||
    nearTrail(x, z, r + 0.3, "late") ||
    distToPaths(hqLines(), x, z) < r + 1.4 || // (D-038: the expedition's own walked lines, which the level audit walks on every seed: no tree, rock or stump stands on them)
    furniture.some((f) => {
      const reach = r + (f.kind === "circle" ? f.r : Math.hypot(f.hx, f.hz)) + 0.6;
      return (x - f.x) ** 2 + (z - f.z) ** 2 < reach * reach;
    });

  // Crags: stratified outcrops on the steepest ground (the Observatory hill's flanks, bluffs where the noise folds) and along the map's rim, each with a
  // boulder field spilled at its foot. Also appended with their own stream, after everything else, so no tree or rock has moved.
  const crag = new Rng(seed ^ 0xc1a6);
  const slopeOf = (x: number, z: number): { s: number; gx: number; gz: number } => {
    const h = terrain.height(x, z);
    const gx = (terrain.height(x + 0.7, z) - terrain.height(x - 0.7, z)) / 1.4;
    const gz = (terrain.height(x, z + 0.7) - terrain.height(x, z - 0.7)) / 1.4;
    void h;
    return { s: Math.hypot(gx, gz), gx, gz };
  };
  const cliffs: Obstacle[] = [];
  for (let tries = 0; cliffs.length < 10 && tries < 900; tries++) {
    let x: number;
    let z: number;
    const rim = tries % 3 === 2;
    if (rim) {
      const a = crag.range(0, Math.PI * 2);
      const d = crag.range(72, 85);
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
    } else if (tries % 3 === 0) {
      const a = crag.range(0, Math.PI * 2);
      const d = crag.range(HILL.plateau + 6, HILL.base - 3);
      x = HILL.x + Math.cos(a) * d;
      z = HILL.z + Math.sin(a) * d;
    } else {
      const a = crag.range(0, Math.PI * 2);
      const d = crag.range(26, 80);
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
    }
    if (Math.hypot(x, z) < 22 || Math.hypot(x, z) > MAX_D - 2) continue;
    const sl = slopeOf(x, z);
    if (sl.s < (rim ? 0.09 : 0.3)) continue;
    if (tooClose(x, z, 3.2) || clashesFurniture(x, z, 4.5)) continue;
    if (cliffs.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < 15 * 15)) continue;
    const y = terrain.height(x, z);
    const hx = crag.range(2.3, 3.9);
    const hz = crag.range(0.85, 1.35);
    const yaw = Math.atan2(sl.gx, -sl.gz);
    const h = crag.range(2.5, 4.6);
    // (a crag's footprint is a box, not the point the test above used: on the Observatory hill's flank its end could run into an aqueduct pier, 0.08 m on seed 4910; it simply is not there, and nothing else has moved)
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    if (
      obstacles.some((o) => {
        if (o.tag !== "ruin" || o.kind !== "circle") return false;
        const lx = Math.abs((o.x - x) * cy + (o.z - z) * sy);
        const lz = Math.abs(-(o.x - x) * sy + (o.z - z) * cy);
        return Math.hypot(Math.max(0, lx - hx), Math.max(0, lz - hz)) < o.r + 0.1;
      })
    )
      continue;
    // the face stands on the lowest ground under it and rises to a level crest
    const ends = [terrain.height(x + Math.cos(yaw) * hx, z + Math.sin(yaw) * hx), terrain.height(x - Math.cos(yaw) * hx, z - Math.sin(yaw) * hx)];
    const base = Math.min(y, ...ends);
    cliffs.push({ kind: "box", tag: "cliff", x, z, hx, hz, yaw, y0: base - 2.4, y1: Math.max(y, ...ends) + h });
    // a boulder field at its foot (downslope side) and along both ends
    const n = crag.int(3, 6);
    const dx = sl.s > 0 ? -sl.gx / sl.s : 0;
    const dz = sl.s > 0 ? -sl.gz / sl.s : 1;
    for (let i = 0, placed = 0, t2 = 0; placed < n && t2 < 40; t2++) {
      const along = crag.range(-hx - 1.5, hx + 1.5);
      const out = crag.range(hz + 0.9, hz + 5.5);
      const rx = x + Math.cos(yaw) * along + dx * out;
      const rz = z + Math.sin(yaw) * along + dz * out;
      const r = crag.range(0.45, 1.25) * (1.1 - (out - hz) / 12);
      if (!inside(rx, rz) || tooClose(rx, rz, 0.3) || clashesFurniture(rx, rz, r)) continue;
      rock(rx, rz, r);
      placed++;
      i++;
    }
  }
  obstacles.push(...cliffs);

  const clashes = (o: Obstacle): boolean => clashesFurniture(o.x, o.z, o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz));
  const posts = hqRouteObstacles(terrain); // the way-round-HQ finger-posts go in last (hqRoute.ts)
  // A tree or a boulder is drawn BEFORE the authored things it must not stand in: the camp's props and the cannon (the dressing tests their centres, not a boulder's radius) and the finger-posts
  // (placed after everything). Whatever actually overlaps one is simply not there (found by the level audit on hub seeds 22320 and 29646: a rock in the cannon's carriage, a tree in a finger-post).
  const solids = [...fixed, ...furniture, ...posts];
  // A tree's crown spreads metres past its trunk: one 4.1 m from a cottage reached 0.7 m into its roof. A tree stands a crown's reach from every building, or is not there.
  const buildings = villagePlan(terrain).buildings;
  const crownClash = (o: Obstacle): boolean => o.tag === "tree" && buildings.some((b) => rectDistance(b, o.x, o.z) < TREE_CROWN_REACH);
  // A crag is drawn wider than its footprint (its capstone overhangs, its fallen blocks spill past the ends): one's capstone ran into the aqueduct's span overhead.
  // A crag whose drawn extent comes near a pier, or the span between two, is not there (its boulder field stays: stones on a slope).
  const piers = ruinPlan(terrain).piers;
  const cragClash = (o: Obstacle): boolean => {
    if (o.tag !== "cliff" || o.kind !== "box") return false;
    const drawn = { x: o.x, z: o.z, yaw: o.yaw, hx: o.hx * 1.15 + 0.25, hz: o.hz * 1.4 + 0.25 };
    for (let i = 0; i < piers.length; i++) {
      const p = piers[i]!;
      if (rectDistance(drawn, p.x, p.z) < p.r) return true;
      const q = piers[i + 1];
      if (q) for (let t = 0; t <= 1; t += 0.1) if (rectDistance(drawn, p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t) < AQUEDUCT_HALF) return true;
    }
    return false;
  };
  const kept = obstacles.filter((o) => !((["tree", "rock", "snag", "stump", "log"].includes(o.tag ?? "") && (clashes(o) || crownClash(o) || (o.kind === "circle" && solids.some((f) => circleTouches(o, f))))) || cragClash(o)));
  return new CollisionWorld(terrain, [...kept, ...furniture, ...posts], ARENA_RADIUS);
}

/** How far a tree's crown reaches from its trunk, with a roof's overhang: no tree stands nearer a building's walls than this. */
const TREE_CROWN_REACH = 4.8;
/** Half the width of the aqueduct's channel between its piers (m), with a hand to spare. */
const AQUEDUCT_HALF = 1.1;

/** Plan distance from (x, z) to a building's footprint (0 inside it), its yaw as `toWorld` reads it. */
function rectDistance(b: { x: number; z: number; yaw: number; hx: number; hz: number }, x: number, z: number): number {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const lx = Math.abs((x - b.x) * c + (z - b.z) * s) - b.hx;
  const lz = Math.abs(-(x - b.x) * s + (z - b.z) * c) - b.hz;
  return Math.hypot(Math.max(0, lx), Math.max(0, lz));
}

/** True if the round obstacle `c` intersects the solid `f` (a standing thing of the camp, the village or the route) by any amount. */
function circleTouches(c: Extract<Obstacle, { kind: "circle" }>, f: Obstacle): boolean {
  if (f.tag === "tree" || f.tag === "rock" || f.tag === "snag" || f.tag === "stump" || f.tag === "log") return false;
  if (f.kind === "circle") return (c.x - f.x) ** 2 + (c.z - f.z) ** 2 < (c.r + f.r) ** 2;
  const cy = Math.cos(f.yaw);
  const sy = Math.sin(f.yaw);
  const lx = Math.abs((c.x - f.x) * cy + (c.z - f.z) * sy);
  const lz = Math.abs(-(c.x - f.x) * sy + (c.z - f.z) * cy);
  return Math.hypot(Math.max(0, lx - f.hx), Math.max(0, lz - f.hz)) < c.r;
}

/** Deterministic spawn ring around the origin for up to `count` players. */
export function spawnPoint(index: number, count = 4): { x: number; z: number } {
  const a = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 4;
  return { x: Math.cos(a) * 3, z: Math.sin(a) * 3 };
}
