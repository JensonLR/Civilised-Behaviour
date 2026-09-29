import { CHARACTER } from "./constants.ts";
import type { Terrain } from "./terrain.ts";

/**
 * Static-world collision used by the character movement layer on BOTH client and server.
 *
 * Deliberate design (docs/DECISIONS.md D-006): the player controller queries analytic shapes
 * plus the deterministic terrain function instead of a Rapier world, so prediction replay is
 * cheap, allocation-free and bit-identical on both sides. Rapier owns the *dynamic* world
 * (props, ragdolls, vehicles), which the controller never has to replay.
 */
/**
 * What an obstacle IS, so the renderer can dress it (a tree, a tent, a signpost). Purely descriptive: collision ignores it, and an
 * untagged obstacle falls back to `classifyObstacle` in worldgen.ts (circle >= 5 m tall = tree, otherwise a rock).
 */
export type ObstacleTag = "tree" | "snag" | "rock" | "wall" | "crate" | "tent" | "fire" | "flag" | "sign" | "luggage" | "cart" | "ruin" | "table" | "scope" | "pole" | "hammock" | "stump" | "log";

export interface CircleObstacle {
  kind: "circle";
  tag?: ObstacleTag;
  x: number;
  z: number;
  r: number;
  /** World-space bottom and top of the solid. */
  y0: number;
  y1: number;
}

export interface BoxObstacle {
  kind: "box";
  tag?: ObstacleTag;
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
  y0: number;
  y1: number;
}

export type Obstacle = CircleObstacle | BoxObstacle;

export interface Vec2 {
  x: number;
  z: number;
}

const CELL = 8;
const cellKey = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);

export class CollisionWorld {
  readonly terrain: Terrain;
  readonly obstacles: readonly Obstacle[];
  /** Playable radius around the origin; positions are clamped inside. */
  readonly boundsRadius: number;
  private readonly grid = new Map<number, Obstacle[]>();

  constructor(terrain: Terrain, obstacles: readonly Obstacle[], boundsRadius: number) {
    this.terrain = terrain;
    this.obstacles = obstacles;
    this.boundsRadius = boundsRadius;
    for (const o of obstacles) this.insert(o);
  }

  private insert(o: Obstacle): void {
    const ext = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
    const minX = Math.floor((o.x - ext) / CELL);
    const maxX = Math.floor((o.x + ext) / CELL);
    const minZ = Math.floor((o.z - ext) / CELL);
    const maxZ = Math.floor((o.z + ext) / CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = cellKey(cx, cz);
        let bucket = this.grid.get(key);
        if (!bucket) {
          bucket = [];
          this.grid.set(key, bucket);
        }
        bucket.push(o);
      }
    }
  }

  terrainHeight(x: number, z: number): number {
    return this.terrain.height(x, z);
  }

  /**
   * Height a character standing at (x, z) with feet at `feetY` would rest on: terrain, or the
   * top of an obstacle that is low enough to step onto.
   */
  groundHeight(x: number, z: number, feetY: number): number {
    let h = this.terrain.height(x, z);
    const bucket = this.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (bucket) {
      for (const o of bucket) {
        if (o.y1 > h && o.y1 <= feetY + CHARACTER.stepHeight && insideFootprint(o, x, z, 0)) h = o.y1;
      }
    }
    return h;
  }

  /**
   * Pushes (pos.x, pos.z) out of every obstacle the character (feet at `feetY`) cannot step
   * onto, then clamps to the world bounds. Mutates `pos`; returns true if anything moved it.
   */
  resolveXZ(pos: Vec2, feetY: number, radius: number, height: number): boolean {
    let moved = false;
    for (let pass = 0; pass < 3; pass++) {
      let passMoved = false;
      const cx = Math.floor(pos.x / CELL);
      const cz = Math.floor(pos.z / CELL);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const bucket = this.grid.get(cellKey(ix, iz));
          if (!bucket) continue;
          for (const o of bucket) {
            if (feetY >= o.y1 - CHARACTER.stepHeight || feetY + height <= o.y0) continue;
            if (pushOut(o, pos, radius)) passMoved = true;
          }
        }
      }
      const d = Math.hypot(pos.x, pos.z);
      const limit = this.boundsRadius - radius;
      if (d > limit) {
        pos.x *= limit / d;
        pos.z *= limit / d;
        passMoved = true;
      }
      if (!passMoved) break;
      moved = true;
    }
    return moved;
  }

  /** Iterates obstacles near a point (debug view, AI cover queries). */
  forEachNear(x: number, z: number, cb: (o: Obstacle) => void): void {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const seen = new Set<Obstacle>();
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const bucket = this.grid.get(cellKey(ix, iz));
        if (!bucket) continue;
        for (const o of bucket) {
          if (seen.has(o)) continue;
          seen.add(o);
          cb(o);
        }
      }
    }
  }
}

function insideFootprint(o: Obstacle, x: number, z: number, margin: number): boolean {
  if (o.kind === "circle") {
    const dx = x - o.x;
    const dz = z - o.z;
    const r = o.r + margin;
    return dx * dx + dz * dz <= r * r;
  }
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const dx = x - o.x;
  const dz = z - o.z;
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  return Math.abs(lx) <= o.hx + margin && Math.abs(lz) <= o.hz + margin;
}

function pushOut(o: Obstacle, pos: Vec2, radius: number): boolean {
  if (o.kind === "circle") {
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const min = o.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      pos.x = o.x + min;
      return true;
    }
    pos.x = o.x + (dx / d) * min;
    pos.z = o.z + (dz / d) * min;
    return true;
  }
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const dx = pos.x - o.x;
  const dz = pos.z - o.z;
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const cx = Math.max(-o.hx, Math.min(o.hx, lx));
  const cz = Math.max(-o.hz, Math.min(o.hz, lz));
  let nx = lx - cx;
  let nz = lz - cz;
  const d2 = nx * nx + nz * nz;
  let plx: number;
  let plz: number;
  if (d2 > 1e-10) {
    if (d2 >= radius * radius) return false;
    const d = Math.sqrt(d2);
    nx /= d;
    nz /= d;
    plx = cx + nx * radius;
    plz = cz + nz * radius;
  } else {
    // Centre is inside the box: exit through the nearest face.
    const px = o.hx - Math.abs(lx);
    const pz = o.hz - Math.abs(lz);
    if (px < pz) {
      plx = Math.sign(lx || 1) * (o.hx + radius);
      plz = lz;
    } else {
      plx = lx;
      plz = Math.sign(lz || 1) * (o.hz + radius);
    }
  }
  pos.x = o.x + plx * c - plz * s;
  pos.z = o.z + plx * s + plz * c;
  return true;
}
