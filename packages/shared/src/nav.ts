import type { CollisionWorld, Obstacle } from "./collision.ts";
import { CHARACTER } from "./constants.ts";
import { NAV, type NavApi, type NavPath } from "./expeditionTypes.ts";
import { hyp } from "./math.ts";

/**
 * A small navigation grid over a region's REAL `CollisionWorld` (D-034). Not a navmesh: one static world and one collapsed bridge, so a 2 m grid
 * rebuilt in a few tens of milliseconds is enough. A cell is `open` when a body of radius `clearance` stands there under the shared movement rules
 * (`resolveXZ` does not move it; the walking surface is the ground height, with bridge/jetty/weir obstacles as floors; deep water is closed), and an
 * edge between neighbours exists when the shared step's slope and step-up limits allow the walk and nothing thin lies between the centres.
 * `NavQuery` is the allocation-free A*, line-of-sight, cover and flank service built on it. Pure and deterministic: no clocks, no randomness.
 */

export interface NavOptions {
  /** Half-extent of the square the grid covers (default: the world's `boundsRadius`). */
  bounds?: number;
  cell?: number;
  clearance?: number;
  /** Deep water: where this says so (given the cell centre and its walking surface) the cell is closed. Default: nothing is deep. Kessar closes the gorge bed and keeps the ford. */
  deep?: (x: number, z: number, surf: number) => boolean;
  /** Cells not connected, through walkable edges, to one of these points are closed (a sealed courtyard is not somewhere anyone can path to). Default: none are pruned. */
  roots?: readonly { x: number; z: number }[];
  /** Cache key for `deep`/`roots` (they are functions/points: callers that vary them per world pass a distinct tag). */
  tag?: string;
}

export interface NavGrid {
  readonly world: CollisionWorld;
  readonly cell: number;
  /** Cells per side. Cell (i, j) has its centre at (origin + (i + 0.5) * cell, origin + (j + 0.5) * cell); its index is j * n + i. */
  readonly n: number;
  readonly origin: number;
  readonly clearance: number;
  readonly open: Uint8Array;
  /** 1 where an obstacle at least 1.1 m tall touches the cell: blocks sight and bullets. */
  readonly tall: Uint8Array;
  /** 1 where an open cell has a closed neighbour (paths keep off it a little). */
  readonly near: Uint8Array;
  /** Walking surface height of each open cell. */
  readonly h: Float32Array;
  /** Bit d set: a body may walk from this cell to its neighbour in direction d (see DX, DZ). */
  readonly edges: Uint8Array;
  readonly openCount: number;
}

/** Neighbour directions, clockwise from +x: E, SE, S, SW, W, NW, N, NE (z grows southward). */
export const NAV_DX: readonly number[] = [1, 1, 0, -1, -1, -1, 0, 1];
export const NAV_DZ: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];

/** Obstacle tags that are floors (a walker stands ON them), as in villagerNav. */
const FLOOR_TAGS: ReadonlySet<string> = new Set(["bridge", "jetty", "weir"]);
const TALL_M = 1.1;
const SLOPE_LIMIT = CHARACTER.maxSlope * 0.8;
const BODY_HEIGHT = 1.7;
const SQRT2 = Math.SQRT2;

const probe = { x: 0, z: 0 };

/** Does the obstacle's footprint, grown by `margin`, touch the square of half-size `half` around (cx, cz)? Exact for circles, conservative for rotated boxes. */
function touches(o: Obstacle, cx: number, cz: number, half: number, margin: number): boolean {
  if (o.kind === "circle") {
    const dx = Math.max(Math.abs(cx - o.x) - half, 0);
    const dz = Math.max(Math.abs(cz - o.z) - half, 0);
    const r = o.r + margin;
    return dx * dx + dz * dz <= r * r;
  }
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const dx = cx - o.x;
  const dz = cz - o.z;
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const reach = half * (Math.abs(c) + Math.abs(s)) + margin;
  return Math.abs(lx) <= o.hx + reach && Math.abs(lz) <= o.hz + reach;
}

function inside(o: Obstacle, x: number, z: number, margin = 0): boolean {
  if (o.kind === "circle") return (x - o.x) ** 2 + (z - o.z) ** 2 <= (o.r + margin) ** 2;
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const dx = x - o.x;
  const dz = z - o.z;
  return Math.abs(dx * c + dz * s) <= o.hx + margin && Math.abs(-dx * s + dz * c) <= o.hz + margin;
}

/** How many of a 3 x 3 spread of sample points over the cell (centre (cx, cz)) lie inside the obstacle grown by `margin`. */
function coverage(o: Obstacle, cx: number, cz: number, cell: number, margin: number): number {
  const d = cell / 3;
  let n = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (inside(o, cx + i * d, cz + j * d, margin)) n++;
  return n;
}

const extent = (o: Obstacle): number => (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz));

const cache = new WeakMap<CollisionWorld, { key: string; grid: NavGrid }>();

/** Builds (or returns the cached) grid for `world`. A new world (the bridge fell) is a new grid: call again. */
export function buildNavGrid(world: CollisionWorld, opts: NavOptions = {}): NavGrid {
  const bounds = opts.bounds ?? world.boundsRadius;
  const cell = opts.cell ?? NAV.cell;
  const clearance = opts.clearance ?? NAV.clearance;
  const deep = opts.deep;
  const key = `${bounds}|${cell}|${clearance}|${opts.tag ?? ""}`;
  const hit = cache.get(world);
  if (hit && hit.key === key) return hit.grid;

  const n = Math.ceil((2 * bounds) / cell);
  const origin = -bounds;
  const total = n * n;
  const half = cell / 2;
  const open = new Uint8Array(total);
  const tall = new Uint8Array(total);
  const near = new Uint8Array(total);
  const touch = new Uint8Array(total);
  const floor = new Float32Array(total).fill(-Infinity);
  const h = new Float32Array(total);
  const edges = new Uint8Array(total);
  const cx = (i: number): number => origin + (i + 0.5) * cell;
  const cellRange = (o: Obstacle, margin: number, cb: (i: number, j: number) => void): void => {
    const e = extent(o) + margin + half;
    const i0 = Math.max(0, Math.floor((o.x - e - origin) / cell));
    const i1 = Math.min(n - 1, Math.floor((o.x + e - origin) / cell));
    const j0 = Math.max(0, Math.floor((o.z - e - origin) / cell));
    const j1 = Math.min(n - 1, Math.floor((o.z + e - origin) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cb(i, j);
  };

  // 1. floors, tall cells, and the cells an obstacle might touch (the only ones that need a real collision probe)
  for (const o of world.obstacles) {
    const isFloor = o.tag !== undefined && FLOOR_TAGS.has(o.tag);
    if (isFloor) {
      cellRange(o, 0, (i, j) => {
        const k = j * n + i;
        if (inside(o, cx(i), cx(j)) && o.y1 > floor[k]!) floor[k] = o.y1;
      });
    }
    const top = o.y1 - world.terrainHeight(o.x, o.z);
    // sight is blocked where an obstacle covers a good part of a cell (2 or more of 9 sample points, the obstacle grown 0.35 m): a rock grazing a cell's corner
    // must not hide whoever is standing 1.4 m clear of it, and a thin wall (a band 1.3 m wide) still catches a whole row of samples
    if (!isFloor && top >= TALL_M) cellRange(o, 0.4, (i, j) => { if (coverage(o, cx(i), cx(j), cell, 0.35) >= 2) tall[j * n + i] = 1; });
    cellRange(o, clearance, (i, j) => { if (touches(o, cx(i), cx(j), half, clearance)) touch[j * n + i] = 1; });
  }

  // 2. open cells and their walking surface
  const limit = bounds - clearance;
  const raised = new Uint8Array(total);
  let openCount = 0;
  for (let j = 0; j < n; j++) {
    const z = cx(j);
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = cx(i);
      if (Math.hypot(x, z) > Math.min(limit, world.boundsRadius - clearance)) continue;
      const th = world.terrainHeight(x, z);
      const fl = floor[k]!;
      const feet = fl > th ? fl : th;
      const surf = world.groundHeight(x, z, feet);
      if (deep !== undefined && deep(x, z, surf)) continue;
      if (touch[k] === 1) {
        probe.x = x;
        probe.z = z;
        if (world.resolveXZ(probe, surf, clearance, BODY_HEIGHT)) continue;
      }
      open[k] = 1;
      h[k] = surf;
      if (surf > th + 0.02) raised[k] = 1;
      openCount++;
    }
  }

  // 3. edges: orthogonal first (slope or step-up, and a collision probe at the midpoint where something is near), then diagonals through them
  const edgeOk = (a: number, b: number, dist: number): boolean => {
    if (open[a] === 0 || open[b] === 0) return false;
    const dh = Math.abs(h[b]! - h[a]!);
    if (raised[a] === 1 || raised[b] === 1) {
      if (dh > CHARACTER.stepHeight) return false;
    } else if (dh > SLOPE_LIMIT * dist) return false;
    if (touch[a] === 1 || touch[b] === 1) {
      const ia = a % n, ja = (a - ia) / n, ib = b % n, jb = (b - ib) / n;
      probe.x = (cx(ia) + cx(ib)) / 2;
      probe.z = (cx(ja) + cx(jb)) / 2;
      if (world.resolveXZ(probe, Math.max(h[a]!, h[b]!), clearance, BODY_HEIGHT)) return false;
    }
    return true;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (open[k] === 0) continue;
      for (let d = 0; d < 8; d += 2) {
        const ni = i + NAV_DX[d]!, nj = j + NAV_DZ[d]!;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const b = nj * n + ni;
        // symmetric: decided once from the lower index so a->b and b->a always agree
        if (b < k) {
          if ((edges[b]! & (1 << ((d + 4) & 7))) !== 0) edges[k] = edges[k]! | (1 << d);
        } else if (edgeOk(k, b, cell)) {
          edges[k] = edges[k]! | (1 << d);
          edges[b] = edges[b]! | (1 << ((d + 4) & 7));
        }
      }
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (open[k] === 0) continue;
      for (let d = 1; d < 8; d += 2) {
        const ni = i + NAV_DX[d]!, nj = j + NAV_DZ[d]!;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const b = nj * n + ni;
        if (b < k) {
          if ((edges[b]! & (1 << ((d + 4) & 7))) !== 0) edges[k] = edges[k]! | (1 << d);
          continue;
        }
        // both orthogonal neighbours must be walkable from k and lead on to b (no cutting a corner of a wall)
        const dx = NAV_DX[d]!, dz = NAV_DZ[d]!;
        const dA = dx > 0 ? 0 : 4; // horizontal leg
        const dB = dz > 0 ? 2 : 6; // vertical leg
        if ((edges[k]! & (1 << dA)) === 0 || (edges[k]! & (1 << dB)) === 0) continue;
        if (!edgeOk(k, b, cell * SQRT2)) continue;
        edges[k] = edges[k]! | (1 << d);
        edges[b] = edges[b]! | (1 << ((d + 4) & 7));
      }
    }
  }
  if (opts.roots !== undefined && opts.roots.length > 0) {
    // prune islands: only what the roots can walk to stays open
    const seen = new Uint8Array(total);
    const stack: number[] = [];
    for (const r of opts.roots) {
      let k = Math.floor((r.z - origin) / cell) * n + Math.floor((r.x - origin) / cell);
      if (k < 0 || k >= total || open[k] === 0) {
        // snap to the nearest open cell
        let bestD = Infinity;
        for (let q = 0; q < total; q++) {
          if (open[q] === 0) continue;
          const d = (cx(q % n) - r.x) ** 2 + (cx(Math.floor(q / n)) - r.z) ** 2;
          if (d < bestD) { bestD = d; k = q; }
        }
      }
      if (k >= 0 && k < total && open[k] === 1 && seen[k] === 0) { seen[k] = 1; stack.push(k); }
    }
    while (stack.length > 0) {
      const k = stack.pop()!;
      const i = k % n, j = (k - i) / n;
      for (let d = 0; d < 8; d++) {
        if ((edges[k]! & (1 << d)) === 0) continue;
        const b = (j + NAV_DZ[d]!) * n + i + NAV_DX[d]!;
        if (seen[b] === 0) { seen[b] = 1; stack.push(b); }
      }
    }
    openCount = 0;
    for (let k = 0; k < total; k++) {
      if (open[k] === 1 && seen[k] === 0) { open[k] = 0; edges[k] = 0; }
      else if (open[k] === 1) openCount++;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (open[k] === 0) continue;
      for (let d = 0; d < 8; d++) {
        const ni = i + NAV_DX[d]!, nj = j + NAV_DZ[d]!;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n || open[nj * n + ni] === 0) {
          near[k] = 1;
          break;
        }
      }
    }
  }

  const grid: NavGrid = { world, cell, n, origin, clearance, open, tall, near, h, edges, openCount };
  cache.set(world, { key, grid });
  return grid;
}

// ---- queries ------------------------------------------------------------------------------------------------------------------------------

const D_ORTH = 1;
const NEAR_PENALTY = 0.35;

export class NavQuery implements NavApi {
  private readonly stamp: Uint32Array;
  private readonly done: Uint32Array;
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly heapKey: Float32Array;
  private readonly heapNode: Int32Array;
  private heapN = 0;
  private gen = 0;
  private readonly raw: Int32Array;
  private readonly pulled: Int32Array;
  /** Expansions of the last `path` call (for tests and budgets). */
  lastExpansions = 0;

  constructor(readonly grid: NavGrid) {
    const total = grid.n * grid.n;
    this.stamp = new Uint32Array(total);
    this.done = new Uint32Array(total);
    this.g = new Float32Array(total);
    this.parent = new Int32Array(total);
    this.heapKey = new Float32Array(NAV.expansionCap * 8 + 64);
    this.heapNode = new Int32Array(NAV.expansionCap * 8 + 64);
    this.raw = new Int32Array(NAV.expansionCap + 16);
    this.pulled = new Int32Array(NAV.expansionCap + 16);
  }

  /** Cell index of a world point, or -1 outside the grid. */
  cellAt(x: number, z: number): number {
    const gr = this.grid;
    const i = Math.floor((x - gr.origin) / gr.cell);
    const j = Math.floor((z - gr.origin) / gr.cell);
    return i < 0 || j < 0 || i >= gr.n || j >= gr.n || !Number.isFinite(x + z) ? -1 : j * gr.n + i;
  }

  private cx(i: number): number {
    return this.grid.origin + (i + 0.5) * this.grid.cell;
  }

  open(x: number, z: number): boolean {
    const k = this.cellAt(x, z);
    return k >= 0 && this.grid.open[k] === 1;
  }

  /** Nearest open cell centre to (x, z) within `rings` cells (the point itself when its cell is open). */
  private nearestCell(x: number, z: number, rings: number): number {
    const gr = this.grid;
    const k0 = this.cellAt(x, z);
    if (k0 >= 0 && gr.open[k0] === 1) return k0;
    const i0 = Math.floor((x - gr.origin) / gr.cell), j0 = Math.floor((z - gr.origin) / gr.cell);
    if (!Number.isFinite(i0 + j0)) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= rings; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= gr.n || j >= gr.n) continue;
          const k = j * gr.n + i;
          if (gr.open[k] === 0) continue;
          const d = (this.cx(i) - x) ** 2 + (this.cx(j) - z) ** 2;
          if (d < bestD) { bestD = d; best = k; }
        }
      }
      if (best >= 0) return best; // the first ring with an open cell holds the nearest (to within a cell)
    }
    return best;
  }

  nearestOpen(x: number, z: number, out: { x: number; z: number }): boolean {
    const k = this.nearestCell(x, z, 6);
    if (k < 0) return false;
    const gr = this.grid;
    if (k === this.cellAt(x, z)) {
      out.x = x;
      out.z = z;
    } else {
      out.x = this.cx(k % gr.n);
      out.z = this.cx(Math.floor(k / gr.n));
    }
    return true;
  }

  /** True when no tall obstacle lies between the two points (the start and end cells never block: someone hugging a wall can still see along it). */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    const gr = this.grid;
    const inv = 1 / gr.cell;
    const ux = (ax - gr.origin) * inv, uz = (az - gr.origin) * inv;
    const vx = (bx - gr.origin) * inv, vz = (bz - gr.origin) * inv;
    if (!Number.isFinite(ux + uz + vx + vz)) return false;
    let i = Math.floor(ux), j = Math.floor(uz);
    const ei = Math.floor(vx), ej = Math.floor(vz);
    const dx = vx - ux, dz = vz - uz;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tdz = dz === 0 ? Infinity : Math.abs(1 / dz);
    let tx = dx === 0 ? Infinity : (dx > 0 ? i + 1 - ux : ux - i) * tdx;
    let tz = dz === 0 ? Infinity : (dz > 0 ? j + 1 - uz : uz - j) * tdz;
    let steps = Math.abs(ei - i) + Math.abs(ej - j) + 1;
    const n = gr.n;
    while (steps-- > 0 && (i !== ei || j !== ej)) {
      if (tx < tz) { tx += tdx; i += sx; } else { tz += tdz; j += sz; }
      if (i === ei && j === ej) break;
      if (i >= 0 && j >= 0 && i < n && j < n && gr.tall[j * n + i] === 1) return false;
    }
    return true;
  }

  /** Straight walk between two cells along the grid line, every step an existing edge. */
  private lineClear(a: number, b: number): boolean {
    const gr = this.grid;
    const n = gr.n;
    let i = a % n, j = (a - i) / n;
    const ei = b % n, ej = (b - ei) / n;
    const dx = Math.abs(ei - i), dz = Math.abs(ej - j);
    const sx = ei > i ? 1 : -1, sz = ej > j ? 1 : -1;
    let ix = 0, iz = 0;
    while (ix < dx || iz < dz) {
      const decision = (1 + 2 * ix) * dz - (1 + 2 * iz) * dx;
      let d: number;
      if (decision === 0) { d = sx > 0 ? (sz > 0 ? 1 : 7) : sz > 0 ? 3 : 5; ix++; iz++; }
      else if (decision < 0) { d = sx > 0 ? 0 : 4; ix++; }
      else { d = sz > 0 ? 2 : 6; iz++; }
      const k = j * n + i;
      if ((gr.edges[k]! & (1 << d)) === 0) return false;
      i += NAV_DX[d]!;
      j += NAV_DZ[d]!;
    }
    return true;
  }

  private push(node: number, key: number): void {
    let c = this.heapN++;
    const hk = this.heapKey, hn = this.heapNode;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hk[p]! < key || (hk[p] === key && hn[p]! <= node)) break;
      hk[c] = hk[p]!;
      hn[c] = hn[p]!;
      c = p;
    }
    hk[c] = key;
    hn[c] = node;
  }

  private pop(): number {
    const hk = this.heapKey, hn = this.heapNode;
    const top = hn[0]!;
    const n = --this.heapN;
    if (n > 0) {
      const key = hk[n]!, node = hn[n]!;
      let c = 0;
      for (;;) {
        let l = 2 * c + 1;
        if (l >= n) break;
        const r = l + 1;
        if (r < n && (hk[r]! < hk[l]! || (hk[r] === hk[l] && hn[r]! < hn[l]!))) l = r;
        if (hk[l]! > key || (hk[l] === key && hn[l]! >= node)) break;
        hk[c] = hk[l]!;
        hn[c] = hn[l]!;
        c = l;
      }
      hk[c] = key;
      hn[c] = node;
    }
    return top;
  }

  /**
   * A* from (sx, sz) to (tx, tz) over the grid, string-pulled. Waypoints EXCLUDE the start and end at the target (or the nearest open cell to it).
   * `out.complete` is false when the expansion cap was hit (the path leads to the explored cell nearest the target) or the waypoint list is full.
   * Returns false (out.n = 0) when the start or the goal cannot be placed on the grid.
   */
  path(sx: number, sz: number, tx: number, tz: number, out: NavPath): boolean {
    out.n = 0;
    out.complete = false;
    const gr = this.grid;
    const n = gr.n;
    const s = this.nearestCell(sx, sz, 4);
    const goal = this.nearestCell(tx, tz, 6);
    if (s < 0 || goal < 0) return false;
    const gi = goal % n, gj = (goal - gi) / n;
    const goalExact = this.cellAt(tx, tz) === goal;
    if (s === goal) {
      out.x[0] = goalExact ? tx : this.cx(gi);
      out.z[0] = goalExact ? tz : this.cx(gj);
      out.n = 1;
      out.complete = true;
      this.lastExpansions = 0;
      return true;
    }
    const gen = ++this.gen;
    const { stamp, done, g, parent } = this;
    const edges = gr.edges, nearA = gr.near;
    this.gi = gi;
    this.gj = gj;
    this.heapN = 0;
    stamp[s] = gen;
    g[s] = 0;
    parent[s] = -1;
    this.push(s, this.heur(s));
    let best = s;
    let bestH = this.heur(s);
    let expansions = 0;
    let found = false;
    while (this.heapN > 0) {
      const k = this.pop();
      if (done[k] === gen) continue;
      done[k] = gen;
      if (k === goal) { found = true; break; }
      if (++expansions > NAV.expansionCap) break;
      const hk = this.heur(k);
      if (hk < bestH) { bestH = hk; best = k; }
      const ki = k % n, kj = (k - ki) / n;
      const e = edges[k]!;
      for (let d = 0; d < 8; d++) {
        if ((e & (1 << d)) === 0) continue;
        const b = (kj + NAV_DZ[d]!) * n + ki + NAV_DX[d]!;
        if (done[b] === gen) continue;
        const step = (d & 1) === 0 ? D_ORTH : SQRT2 * D_ORTH;
        const ng = g[k]! + step + (nearA[b] === 1 ? NEAR_PENALTY : 0);
        if (stamp[b] !== gen || ng < g[b]!) {
          stamp[b] = gen;
          g[b] = ng;
          parent[b] = k;
          if (this.heapN < this.heapKey.length - 1) this.push(b, ng + this.heur(b));
        }
      }
    }
    this.lastExpansions = expansions;
    const end = found ? goal : best;
    // raw cell chain end -> start, reversed into `raw`
    let len = 0;
    for (let k = end; k >= 0 && len < this.raw.length; k = parent[k]!) this.raw[len++] = k;
    for (let a = 0, b = len - 1; a < b; a++, b--) {
      const t = this.raw[a]!;
      this.raw[a] = this.raw[b]!;
      this.raw[b] = t;
    }
    // string pull: from each anchor jump to the farthest cell the walker can reach in a straight line
    let np = 0;
    let anchor = 0;
    const last = len - 1;
    while (anchor < last) {
      let j = last;
      while (j > anchor + 1 && !this.lineClear(this.raw[anchor]!, this.raw[j]!)) j--;
      this.pulled[np++] = this.raw[j]!;
      anchor = j;
    }
    let complete = found;
    const cap = Math.min(NAV.pathMax, out.x.length, out.z.length);
    if (np > cap) {
      np = cap;
      complete = false;
    }
    for (let a = 0; a < np; a++) {
      const k = this.pulled[a]!;
      out.x[a] = this.cx(k % n);
      out.z[a] = this.cx(Math.floor(k / n));
    }
    if (found && goalExact && np > 0 && np <= cap) {
      out.x[np - 1] = tx;
      out.z[np - 1] = tz;
    }
    out.n = np;
    out.complete = complete;
    return np > 0;
  }

  /**
   * The nearest open cell within `radius` of (fx, fz) that a tall obstacle shields from the threat at (thx, thz): a tall cell lies within two cells
   * toward the threat and nothing tall lets the threat see it. Writes the cell centre to `out`.
   */
  cover(fx: number, fz: number, thx: number, thz: number, radius: number, out: { x: number; z: number }): boolean {
    const gr = this.grid;
    const n = gr.n;
    const f = this.cellAt(fx, fz);
    if (f < 0) return false;
    const fi = f % n, fj = (f - fi) / n;
    const R = Math.max(1, Math.ceil(radius / gr.cell));
    let bestD = Infinity;
    let found = false;
    for (let dj = -R; dj <= R; dj++) {
      const j = fj + dj;
      if (j < 0 || j >= n) continue;
      for (let di = -R; di <= R; di++) {
        const i = fi + di;
        if (i < 0 || i >= n) continue;
        const k = j * n + i;
        if (gr.open[k] === 0 || gr.tall[k] === 1) continue;
        const x = this.cx(i), z = this.cx(j);
        const d = hyp(x - fx, z - fz);
        if (d > radius || d >= bestD) continue;
        const ux = thx - x, uz = thz - z;
        const ul = Math.sqrt(ux * ux + uz * uz);
        if (ul < gr.cell * 2) continue;
        const nx = ux / ul, nz = uz / ul;
        let shield = false;
        for (let s = 1; s <= 2 && !shield; s++) {
          const ci = Math.floor((x + nx * s * gr.cell - gr.origin) / gr.cell), cj = Math.floor((z + nz * s * gr.cell - gr.origin) / gr.cell);
          if (ci >= 0 && cj >= 0 && ci < n && cj < n && gr.tall[cj * n + ci] === 1) shield = true;
        }
        if (!shield || this.los(x, z, thx, thz)) continue;
        bestD = d;
        out.x = x;
        out.z = z;
        found = true;
      }
    }
    return found;
  }

  /** A point `dist` from the target, 70 degrees (then nearby angles) round from the bearing target -> f on `side`, open and in sight of the target. */
  flank(fx: number, fz: number, tx: number, tz: number, side: 1 | -1, dist: number, out: { x: number; z: number }): boolean {
    const bearing = Math.atan2(fz - tz, fx - tx);
    let fallback = false;
    for (let a = 0; a < 5; a++) {
      const off = (70 + (a === 0 ? 0 : a === 1 ? -20 : a === 2 ? 20 : a === 3 ? -40 : 40)) * (Math.PI / 180) * side;
      const px = tx + Math.cos(bearing + off) * dist;
      const pz = tz + Math.sin(bearing + off) * dist;
      if (!this.nearestOpen(px, pz, out)) continue;
      if (this.los(out.x, out.z, tx, tz)) return true;
      if (!fallback) {
        // keep the first open candidate in case nothing sees the target
        fallback = true;
        this.fbX = out.x;
        this.fbZ = out.z;
      }
    }
    if (!fallback) return false;
    out.x = this.fbX;
    out.z = this.fbZ;
    return true;
  }

  private fbX = 0;
  private fbZ = 0;
  private gi = 0;
  private gj = 0;

  private heur(k: number): number {
    const n = this.grid.n;
    const dx = Math.abs((k % n) - this.gi), dz = Math.abs(Math.floor(k / n) - this.gj);
    return D_ORTH * (dx + dz) + (SQRT2 - 2 * D_ORTH) * Math.min(dx, dz);
  }
}

/** Allocates a path buffer for `NavApi.path` (NAV.pathMax waypoints). Do this once per walker, never per tick. */
export function newNavPath(): NavPath {
  return { n: 0, x: new Float32Array(NAV.pathMax), z: new Float32Array(NAV.pathMax), complete: false };
}
