import { insideObstacle } from "./camp.ts";
import type { CollisionWorld, Obstacle } from "./collision.ts";
import { JETTY, TRAILS, waterEdgeDistance } from "./landscape.ts";
import { toWorld, villagePlan, type Building, type VillagePlan } from "./village.ts";

/**
 * Where Hollowmere's people can walk and where they stand: a walking graph laid on the village's own footpaths (the street, the lanes and the
 * doorstep lanes are trails, so the ground under them is already trodden and cleared), a set of named STATIONS at real features of the village
 * plan (each door, the well, the benches, the awnings, the jetty, the anvil, the sacks, the gate ...), and routes between stations resampled
 * every half metre with the ground height the shared movement layer would give a walker (steps up to a porch, the jetty deck, the weir's walkway).
 *
 * Everything is validated against the SAME `CollisionWorld` the players use: a graph edge, a station and every route sample must be a place a
 * character (radius `FOLK_RADIUS`) could stand under the shared step rules, out of the water. Whatever fails is simply not built; the schedule
 * then falls back to another station. Pure and deterministic given the world; server-safe (nothing here is ever sent).
 */

/** Clearance radius of a villager against the world (a player's is 0.4; villagers are scenery and slim through a stall). */
export const FOLK_RADIUS = 0.26;
/** Spacing of route samples, metres. */
const DS = 0.5;
/** The open-ground grid over the village core (metres). */
const GRID = { x0: -47, x1: 13, z0: -70, z1: -26, step: 2 };

/** Obstacle tags that are FLOORS or stairs (walk on them under the step rule) rather than things in the way. */
const SURFACE_TAGS: ReadonlySet<string> = new Set(["house", "jetty", "weir", "bridge"]);

const face = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
const faceTo = (x: number, z: number, tx: number, tz: number): number => face(tx - x, tz - z);
/** The character facing that looks along a collision-convention yaw (local +x). */
const outward = (yaw: number): number => face(Math.cos(yaw), Math.sin(yaw));

export interface Station {
  key: string;
  x: number;
  z: number;
  /** Height the feet stand at. */
  y: number;
  /** Character facing (radians, 0 = -Z). */
  facing: number;
  /** Reachable and standable in this world. */
  ok: boolean;
  /** Under a roof: rain does not move whoever is here. */
  sheltered: boolean;
  /** A seat: the body sits on a bench here (feet on the ground beside it). */
  seat: boolean;
  /** Inside a building: whoever is here is out of sight. */
  hidden: boolean;
  /** Graph node of this station. */
  node: number;
}

interface StationDef {
  key: string;
  x: number;
  z: number;
  facing: number;
  /** Height hint for the first standing test (a deck or a porch), default the ground. */
  y?: number;
  sheltered?: boolean;
  seat?: boolean;
  hidden?: boolean;
  /** Other station whose position is reached first (the way in through a door). */
  parent?: string;
  /** Points to walk through on the way in from the network (a garden gate, a stall's open side), nearest the station last. */
  via?: readonly (readonly [number, number])[];
  /** How far a spur from the network may be. */
  reach?: number;
}

export interface Route {
  /** Metres. */
  len: number;
  /** Samples: x, z, ground height, and how far a walker may stray sideways (0 in a lane, up to ~0.45 in the street). */
  n: number;
  x: Float32Array;
  z: Float32Array;
  y: Float32Array;
  clear: Float32Array;
  /** Arclengths before which (`hideUntil`) or after which (`hideFrom`) the walker is inside a building and out of sight. */
  hideUntil: number;
  hideFrom: number;
}

interface Edge {
  to: number;
  /** Metres. */
  len: number;
  /** What routing pays for it: the length, dearer on open ground so people keep to the street when the detour is small. */
  cost: number;
}

export interface Nav {
  readonly world: CollisionWorld;
  readonly stations: Station[];
  readonly index: ReadonlyMap<string, number>;
  /** The route between two stations by index, or undefined when there is none (built on first use, cached). */
  route(a: number, b: number): Route | undefined;
  /** Walking distance between two stations in metres (Infinity if cut off), without building the route. */
  distance(a: number, b: number): number;
  /** Graph size, for tests and stats. */
  readonly nodeCount: number;
}

// ---- standing tests --------------------------------------------------------------------------------------------------------------

const probe = { x: 0, z: 0 };

/** The things that are simply in the way (everything but floors and stairs), in a coarse hash of 4 m cells so a standing test costs almost nothing. */
const CELL = 4;
const strictCache = new WeakMap<CollisionWorld, Map<number, Obstacle[]>>();
const cellOf = (cx: number, cz: number): number => (cx + 512) * 1024 + (cz + 512);
function strictGrid(world: CollisionWorld): Map<number, Obstacle[]> {
  const hit = strictCache.get(world);
  if (hit) return hit;
  const grid = new Map<number, Obstacle[]>();
  for (const o of world.obstacles) {
    if (o.tag !== undefined && SURFACE_TAGS.has(o.tag)) continue;
    const ext = (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + 0.6;
    for (let cx = Math.floor((o.x - ext) / CELL); cx <= Math.floor((o.x + ext) / CELL); cx++) {
      for (let cz = Math.floor((o.z - ext) / CELL); cz <= Math.floor((o.z + ext) / CELL); cz++) {
        const key = cellOf(cx, cz);
        const list = grid.get(key);
        if (list) list.push(o);
        else grid.set(key, [o]);
      }
    }
  }
  strictCache.set(world, grid);
  return grid;
}

/**
 * The height a walker with feet at `feetY` would stand at at (x, z) if it may stand there (clear of everything under the shared step rules, out of
 * the water unless something carries it), or undefined. `ignore` lets a seat sit on its bench.
 */
export function standingHeight(world: CollisionWorld, x: number, z: number, feetY: number, r = FOLK_RADIUS, ignore?: (o: Obstacle) => boolean): number | undefined {
  const list = strictGrid(world).get(cellOf(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (list) {
    for (const o of list) {
      if (ignore && ignore(o)) continue;
      if (insideObstacle(o, x, z, r)) return undefined;
    }
  }
  probe.x = x;
  probe.z = z;
  if (world.resolveXZ(probe, feetY, r, 1.7)) return undefined;
  const gy = world.groundHeight(x, z, feetY);
  const th = world.terrainHeight(x, z);
  if (gy <= th + 0.04 && waterEdgeDistance(x, z) < 0.3) return undefined; // in the water, and nothing carries the walker
  return gy;
}

/** True if a walker can go straight from a to b (every 0.45 m standable, the ground height followed from `y0`). */
function segmentOk(world: CollisionWorld, ax: number, az: number, ay: number, bx: number, bz: number, r = FOLK_RADIUS, ignore?: (o: Obstacle) => boolean): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / 0.45));
  let y = ay;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const h = standingHeight(world, ax + (bx - ax) * t, az + (bz - az) * t, y, r, ignore);
    if (h === undefined) return false;
    if (Math.abs(h - y) > 0.62) return false;
    y = h;
  }
  return true;
}

// ---- the graph ---------------------------------------------------------------------------------------------------------------------

/** Footpaths that make the network (the village's street and lanes, the doorstep lanes, the fishing path north of the stream). */
const NAV_TRAILS = ["village", "village-west", "mill-lane", "ferry-lane", "hall-steps", "door-cot-a", "door-shop", "door-gran-a", "door-gran-b", "door-cot-b", "door-cot-c", "door-stilt-w", "door-stilt-e", "footbridge"];

class Graph {
  x: number[] = [];
  z: number[] = [];
  y: number[] = [];
  clear: number[] = [];
  adj: Edge[][] = [];
  add(x: number, z: number, y: number, clear = 0): number {
    this.x.push(x);
    this.z.push(z);
    this.y.push(y);
    this.clear.push(clear);
    this.adj.push([]);
    return this.x.length - 1;
  }
  link(a: number, b: number, factor = 1): void {
    const len = Math.hypot(this.x[a]! - this.x[b]!, this.z[a]! - this.z[b]!);
    this.adj[a]!.push({ to: b, len, cost: len * factor });
    this.adj[b]!.push({ to: a, len, cost: len * factor });
  }
}

/** Every station of the village, from the plan. Positions are ideals; `buildNav` nudges each to free ground and drops what cannot be reached. */
function stationDefs(plan: VillagePlan, terrainY: (x: number, z: number) => number): StationDef[] {
  const out: StationDef[] = [];
  const B = (id: string): Building => plan.buildings.find((b) => b.id === id)!;
  const at = (b: Building, lx: number, lz: number): { x: number; z: number } => toWorld(b, lx, lz);
  const add = (d: StationDef): void => void out.push(d);

  // ---- homes: the doorstep, and the room inside (out of sight) ------------------------------------------------------------------
  for (const id of ["cot-a", "cot-b", "cot-c", "stilt-w", "stilt-e", "mill", "hall"]) {
    const b = B(id);
    const step = at(b, b.hx + (b.kind === "hall" ? 1.0 : b.kind === "stilt" ? 0.75 : 0.7), 0);
    add({ key: `step:${id}`, x: step.x, z: step.z, facing: outward(b.yaw), y: b.floorY, reach: 3.2 });
    const inside = at(b, b.hx - (b.kind === "hall" ? 2.4 : 1.15), b.kind === "hall" ? 1.4 : 0);
    add({ key: `in:${id}`, x: inside.x, z: inside.z, facing: outward(b.yaw) + Math.PI, y: b.floorY, hidden: true, parent: `step:${id}`, sheltered: true });
  }
  // the hall's terrace, either side of its doors (a place to stand and a shelter)
  {
    const hall = B("hall");
    // (the porch benches either side of the doors: a seat under the roof)
    for (const [k, s] of [["a", -1], ["b", 1]] as const) {
      const p = at(hall, hall.hx + 0.6, s * (hall.spec.door / 2 + 1.9));
      add({ key: `porch:hall:${k}`, x: p.x, z: p.z, facing: outward(hall.yaw), y: hall.floorY, sheltered: true, seat: true, reach: 6 });
    }
  }

  // ---- the plaza, the well, the benches, the cart ------------------------------------------------------------------------------
  const plaza = { x: -21, z: -57.6 };
  add({ key: "plaza", x: plaza.x, z: plaza.z, facing: faceTo(plaza.x, plaza.z, -21, -65), reach: 5 });
  const well = plan.props.find((p) => p.kind === "well")!;
  {
    const dx = plaza.x - well.x;
    const dz = plaza.z - well.z;
    const d = Math.hypot(dx, dz);
    const wx = well.x + (dx / d) * 1.5;
    const wz = well.z + (dz / d) * 1.5;
    add({ key: "well", x: wx, z: wz, facing: faceTo(wx, wz, well.x, well.z), reach: 6 });
  }
  for (const [i, bench] of plan.props.filter((p) => p.kind === "bench").entries()) {
    const ax = Math.cos(bench.yaw);
    const az = Math.sin(bench.yaw);
    let nx = -az;
    let nz = ax;
    if ((plaza.x - bench.x) * nx + (plaza.z - bench.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    for (const [k, s] of [[1, -0.36], [2, 0.36]] as const) {
      add({ key: `bench:${i}:${k}`, x: bench.x + ax * s, z: bench.z + az * s, facing: face(nx, nz), seat: true, reach: 4 });
    }
  }
  const cart = plan.props.filter((p) => p.kind === "cart" && Math.abs(p.x + 24.4) < 0.5)[0];
  if (cart) add({ key: "cart", x: cart.x + 1.7, z: cart.z - 0.4, facing: faceTo(cart.x + 1.7, cart.z - 0.4, cart.x, cart.z), reach: 5 });
  // conversation spots: pairs stand a metre apart facing each other (a = west/south of b)
  for (const [i, c] of ([[-21, -58.6, 0.25], [-16.1, -57.2, 1.4], [-6.6, -50.6, 0.3], [-1.6, -43.6, 2], [-22.9, -44.2, 0.1], [-35.8, -49.0, 0.6]] as const).entries()) {
    const [cx, cz, a] = c;
    const ux = Math.cos(a) * 0.55;
    const uz = Math.sin(a) * 0.55;
    add({ key: `chat:${i}:a`, x: cx - ux, z: cz - uz, facing: faceTo(cx - ux, cz - uz, cx + ux, cz + uz), reach: 5 });
    add({ key: `chat:${i}:b`, x: cx + ux, z: cz + uz, facing: faceTo(cx + ux, cz + uz, cx - ux, cz - uz), reach: 5 });
  }

  // ---- the market stalls: the seller behind the counter (come in by the open side), the customer in front ---------------------------
  for (let n = 1; n <= 4; n++) {
    const b = B(`stall-${n}`);
    const p = at(b, 0.055, 0);
    const side = at(b, 0.055, -(b.hz + 0.9)); // (in by the side with no crate in the way)
    add({ key: `stall:${n}`, x: p.x, z: p.z, facing: outward(b.yaw), sheltered: true, via: [[side.x, side.z]], reach: 6 });
    const f = at(b, b.hx + 0.95, 0);
    add({ key: `front:${n}`, x: f.x, z: f.z, facing: outward(b.yaw) + Math.PI, reach: 5 });
  }

  // ---- the water: the jetty, the punt, the weir -------------------------------------------------------------------------------------
  {
    const j = plan.jetty;
    const ux = Math.cos(j.yaw);
    const uz = Math.sin(j.yaw);
    const alongAt = (l: number, side = 0): { x: number; z: number } => ({ x: j.x0 + ux * l - uz * side, z: j.z0 + uz * l + ux * side });
    const mid = alongAt(j.length * 0.55);
    add({ key: "jetty-mid", x: mid.x, z: mid.z, y: j.deckY, facing: faceTo(mid.x, mid.z, plan.punt.x, plan.punt.z), reach: 4 });
    const end = alongAt(j.length - 0.75);
    add({ key: "jetty-end", x: end.x, z: end.z, y: j.deckY, facing: face(ux, uz), reach: 5 });
    const foot = alongAt(-0.6);
    add({ key: "ferry-foot", x: foot.x, z: foot.z, facing: face(ux, uz), reach: 3 });
    void JETTY;
  }
  {
    const w = plan.weir;
    const ux = Math.cos(w.yaw);
    const uz = Math.sin(w.yaw);
    // the walkway crosses the stream; the fisher stands on it, a little off the middle, looking upstream
    add({ key: "weir", x: w.x + ux * 0.9, z: w.z + uz * 0.9, y: w.walkY, facing: face(-uz, ux), via: [[w.x + ux * 3.6, w.z + uz * 3.6], [w.x + ux * 2.2, w.z + uz * 2.2]], reach: 10 });
  }

  // ---- the smithy, the trough, the mill yard --------------------------------------------------------------------------------------
  {
    const shop = B("shop");
    const anvil = plan.props.find((p) => p.kind === "anvil")!;
    const a = at(shop, 1.5, -0.9);
    add({ key: "anvil", x: a.x, z: a.z, facing: faceTo(a.x, a.z, anvil.x, anvil.z), sheltered: true, reach: 6 });
    const f = at(shop, -0.3, 1.2);
    add({ key: "smithy:a", x: f.x, z: f.z, facing: outward(shop.yaw), sheltered: true, reach: 6 });
    const g = at(shop, 0.5, 2.3);
    add({ key: "smithy:b", x: g.x, z: g.z, facing: outward(shop.yaw), sheltered: true, reach: 6 });
    const front = at(shop, shop.hx + 1.0, 0.3);
    add({ key: "smithy-front", x: front.x, z: front.z, facing: outward(shop.yaw), reach: 4 });
  }
  {
    const tr = plan.props.find((p) => p.kind === "trough")!;
    const nx = Math.cos(tr.yaw + Math.PI / 2);
    const nz = Math.sin(tr.yaw + Math.PI / 2);
    const tx = tr.x + nx * 0.85;
    const tz = tr.z + nz * 0.85;
    add({ key: "trough", x: tx, z: tz, facing: faceTo(tx, tz, tr.x, tr.z), reach: 5 });
  }
  {
    const mill = B("mill");
    const sacks = plan.props.filter((p) => p.kind === "sack" && Math.hypot(p.x - mill.x, p.z - mill.z) < 6);
    const sx = sacks.reduce((s, p) => s + p.x, 0) / Math.max(1, sacks.length);
    const sz = sacks.reduce((s, p) => s + p.z, 0) / Math.max(1, sacks.length);
    const mc = plan.props.find((p) => p.kind === "cart" && Math.hypot(p.x - mill.x, p.z - mill.z) < 6);
    const px = sx + Math.cos(mill.yaw) * 0.2;
    const pz = sz + Math.sin(mill.yaw) * 0.2;
    // in front of the sack pile, on the side away from the wall (D-038: the pile now stands to the right of the door, so "beside" would be on the sacks)
    const ox = px + Math.cos(mill.yaw) * 1.2;
    const oz = pz + Math.sin(mill.yaw) * 1.2;
    add({ key: "mill-sacks", x: ox, z: oz, facing: faceTo(ox, oz, sx, sz), reach: 5 });
    if (mc) {
      const cx = mc.x + Math.cos(mc.yaw + Math.PI / 2) * 1.6;
      const cz = mc.z + Math.sin(mc.yaw + Math.PI / 2) * 1.6;
      add({ key: "mill-cart", x: cx, z: cz, facing: faceTo(cx, cz, mc.x, mc.z), reach: 6 });
    }
  }

  // ---- the gate ----------------------------------------------------------------------------------------------------------------------
  {
    const gate = B("gate");
    const cy = Math.cos(gate.yaw);
    const sy = Math.sin(gate.yaw);
    const out1 = at(gate, -(gate.hx + 1.5), 1.35);
    add({ key: "gate-out", x: out1.x, z: out1.z, facing: face(-cy, -sy), reach: 4 });
    const in1 = at(gate, gate.hx + 1.5, -1.35);
    add({ key: "gate-in", x: in1.x, z: in1.z, facing: face(cy, sy), reach: 4 });
    const look = at(gate, -(gate.hx + 3.6), 0.5);
    add({ key: "gate-look", x: look.x, z: look.z, facing: face(cy, sy), reach: 4 });
    for (const [k, l] of [["a", -0.9], ["b", 0.2], ["c", 1.2]] as const) {
      const p = at(gate, l, 0.85 * (k === "b" ? -1 : 1));
      add({ key: `arch:${k}`, x: p.x, z: p.z, facing: face(-cy, -sy), sheltered: true, reach: 4 });
    }
  }

  // ---- gardens, washing lines, hives ------------------------------------------------------------------------------------------------
  for (const [i, g] of plan.gardens.entries()) {
    const c = Math.cos(g.yaw);
    const s = Math.sin(g.yaw);
    const loc = (lx: number, lz: number): { x: number; z: number } => ({ x: g.x + lx * c - lz * s, z: g.z + lx * s + lz * c });
    const inner = loc(0.5, -g.hz + 1.6);
    const gate = loc(0, -g.hz - 0.9);
    add({ key: `garden:${i}`, x: inner.x, z: inner.z, facing: face(-s, c), via: [[gate.x, gate.z]], reach: 8 });
    const far = loc(-0.9, g.hz - 1.2);
    add({ key: `garden:${i}:b`, x: far.x, z: far.z, facing: face(s, -c), via: [[gate.x, gate.z], [inner.x, inner.z]], reach: 8 });
  }
  for (const [i, l] of plan.lines.entries()) {
    const mx = (l.a.x + l.b.x) / 2;
    const mz = (l.a.z + l.b.z) / 2;
    const dx = l.b.x - l.a.x;
    const dz = l.b.z - l.a.z;
    const d = Math.hypot(dx, dz) || 1;
    // stand on the side of the line away from the nearest building
    let nx = -dz / d;
    let nz = dx / d;
    let near = plan.buildings[0]!;
    let best = Infinity;
    for (const b of plan.buildings) {
      const q = Math.hypot(b.x - mx, b.z - mz);
      if (q < best) {
        best = q;
        near = b;
      }
    }
    if ((near.x - mx) * nx + (near.z - mz) * nz > 0) {
      nx = -nx;
      nz = -nz;
    }
    add({ key: `wash:${i}`, x: mx + nx * 0.85, z: mz + nz * 0.85, facing: face(-nx, -nz), reach: 7 });
  }
  for (const [i, p] of plan.props.filter((q) => q.kind === "skep").entries()) {
    // approach a hive from the side it faces (away from the wall it stands by), a metre off
    add({ key: `hive:${i}`, x: p.x + Math.cos(p.yaw + 2.4) * 1.05, z: p.z + Math.sin(p.yaw + 2.4) * 1.05, facing: face(-Math.cos(p.yaw + 2.4), -Math.sin(p.yaw + 2.4)), reach: 7 });
  }
  // ---- the lamp posts along the way in ------------------------------------------------------------------------------------------------
  for (const [i, p] of plan.props.filter((q) => q.kind === "post" && q.s > 1.05).entries()) {
    add({ key: `lamp:${i}`, x: p.x - 0.75, z: p.z, facing: face(1, 0), reach: 4 });
  }
  void terrainY;
  return out;
}

/** Builds the network, the stations and (lazily) the routes between them for a world. */
export function buildNav(world: CollisionWorld, why?: Map<string, string>): Nav {
  const plan = villagePlan(world.terrain);
  const g = new Graph();
  const groundAt = (x: number, z: number): number => world.terrainHeight(x, z);

  // trail vertices become nodes; consecutive vertices are joined where a walker could pass
  const starts: number[] = [];
  const ends: number[] = [];
  const owner: number[] = [];
  NAV_TRAILS.forEach((name, ti) => {
    const t = TRAILS.find((q) => q.name === name);
    if (!t) return;
    const clear = Math.max(0, Math.min(0.45, t.width / 2 - 0.55));
    let prev = -1;
    for (let i = 0; i + 1 < t.line.length; i += 2) {
      const x = t.line[i]!;
      const z = t.line[i + 1]!;
      const y = groundAt(x, z);
      if (standingHeight(world, x, z, y) === undefined) {
        prev = -1;
        continue;
      }
      const id = g.add(x, z, y, clear);
      owner.push(ti);
      if (prev >= 0 && segmentOk(world, g.x[prev]!, g.z[prev]!, g.y[prev]!, x, z)) g.link(prev, id);
      if (i === 0) starts.push(id);
      prev = id;
    }
    if (prev >= 0) ends.push(prev);
  });
  // junctions: an endpoint joins the nearest node of another trail within a few metres
  for (const id of [...starts, ...ends]) {
    let best = -1;
    let bd = 3.4;
    for (let j = 0; j < g.x.length; j++) {
      if (owner[j] === owner[id]) continue;
      const d = Math.hypot(g.x[j]! - g.x[id]!, g.z[j]! - g.z[id]!);
      if (d < bd && segmentOk(world, g.x[id]!, g.z[id]!, g.y[id]!, g.x[j]!, g.z[j]!)) {
        bd = d;
        best = j;
      }
    }
    if (best >= 0) g.link(id, best);
  }

  // open ground: a coarse grid over the village so people can cross the plaza, the yards and the gardens, not only the paths
  const trailCount = g.x.length;
  const gridIdx = new Map<number, number>();
  for (let gx = GRID.x0; gx <= GRID.x1; gx += GRID.step) {
    for (let gz = GRID.z0; gz <= GRID.z1; gz += GRID.step) {
      const y0 = groundAt(gx, gz);
      const h = standingHeight(world, gx, gz, y0);
      if (h === undefined) continue;
      const id = g.add(gx, gz, h, 0);
      owner.push(-2);
      gridIdx.set(Math.round((gx - GRID.x0) / GRID.step) * 1000 + Math.round((gz - GRID.z0) / GRID.step), id);
    }
  }
  for (const [key, id] of gridIdx) {
    const ix = Math.floor(key / 1000);
    const iz = key % 1000;
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
      const j = gridIdx.get((ix + dx) * 1000 + iz + dz);
      if (j !== undefined && segmentOk(world, g.x[id]!, g.z[id]!, g.y[id]!, g.x[j]!, g.z[j]!)) g.link(id, j, 1.4);
    }
  }
  // the paths meet the grid wherever they pass close to it
  for (let i = 0; i < trailCount; i++) {
    let joined = 0;
    const near: { j: number; d: number }[] = [];
    for (let j = trailCount; j < g.x.length; j++) {
      const d = Math.hypot(g.x[j]! - g.x[i]!, g.z[j]! - g.z[i]!);
      if (d < GRID.step * 1.2) near.push({ j, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (const c of near) {
      if (joined >= 2) break;
      if (segmentOk(world, g.x[i]!, g.z[i]!, g.y[i]!, g.x[c.j]!, g.z[c.j]!)) {
        g.link(i, c.j, 1.4);
        joined++;
      }
    }
  }
  const networkNodes = g.x.length;

  // stations: nudge each to standable ground, then connect it (through its way-in points) to the network
  const defs = stationDefs(plan, groundAt);
  const stations: Station[] = [];
  const index = new Map<string, number>();
  const benchIgnore = (sx: number, sz: number) => (o: Obstacle): boolean => o.tag === "vprop" && Math.hypot(o.x - sx, o.z - sz) < 1.4;
  for (const d of defs) {
    const hint = d.y ?? groundAt(d.x, d.z);
    const ignore = d.seat ? benchIgnore(d.x, d.z) : undefined;
    let px = d.x;
    let pz = d.z;
    let py: number | undefined = standingHeight(world, px, pz, hint, FOLK_RADIUS, ignore);
    if (py === undefined && !d.hidden) {
      // a spiral of small nudges
      search: for (let ring = 1; ring <= 4; ring++) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + ring * 0.4;
          const qx = d.x + Math.cos(a) * ring * 0.3;
          const qz = d.z + Math.sin(a) * ring * 0.3;
          const h = standingHeight(world, qx, qz, hint, FOLK_RADIUS, ignore);
          if (h !== undefined) {
            px = qx;
            pz = qz;
            py = h;
            break search;
          }
        }
      }
    }
    const idx = stations.length;
    if (py === undefined) why?.set(d.key, `not standable near (${d.x.toFixed(2)}, ${d.z.toFixed(2)})`);
    const st: Station = { key: d.key, x: px, z: pz, y: py ?? hint, facing: d.facing, ok: py !== undefined, sheltered: d.sheltered ?? false, seat: d.seat ?? false, hidden: d.hidden ?? false, node: -1 };
    if (d.seat && py !== undefined) st.y = d.y ?? groundAt(px, pz);
    stations.push(st);
    index.set(d.key, idx);
    if (!st.ok) continue;
    st.node = g.add(px, pz, st.y, 0);
    owner.push(-1);
    // the chain in: parent station, or the network via the way-in points
    if (d.parent) {
      const p = stations[index.get(d.parent) ?? -1];
      if (!p || !p.ok || !segmentOk(world, p.x, p.z, p.y, px, pz)) {
        why?.set(d.key, `no way in from ${d.parent}`);
        st.ok = false;
        continue;
      }
      g.link(st.node, p.node);
      continue;
    }
    let last = st.node;
    for (const [vx, vz] of [...(d.via ?? [])].reverse()) {
      const vy = groundAt(vx, vz);
      const vh = standingHeight(world, vx, vz, vy);
      if (vh === undefined) continue;
      const vid = g.add(vx, vz, vh, 0);
      owner.push(-1);
      if (segmentOk(world, g.x[last]!, g.z[last]!, g.y[last]!, vx, vz, d.seat ? 0.12 : FOLK_RADIUS)) {
        g.link(last, vid);
        last = vid;
      } else {
        g.adj.pop();
        g.x.pop();
        g.z.pop();
        g.y.pop();
        g.clear.pop();
        owner.pop();
      }
    }
    // to the nearest reachable network node (trail nodes only) within reach; a seat accepts the last metre through its bench
    const reach = d.reach ?? 5;
    const cands: { j: number; d: number }[] = [];
    for (let j = 0; j < networkNodes; j++) {
      const dd = Math.hypot(g.x[j]! - g.x[last]!, g.z[j]! - g.z[last]!);
      if (dd <= reach) cands.push({ j, d: dd });
    }
    cands.sort((a, b) => a.d - b.d);
    let linked = false;
    for (const c of cands.slice(0, 14)) {
      if (segmentOk(world, g.x[last]!, g.z[last]!, g.y[last]!, g.x[c.j]!, g.z[c.j]!, d.seat && last === st.node ? 0.12 : FOLK_RADIUS, d.seat && last === st.node ? ignore : undefined)) {
        g.link(last, c.j);
        linked = true;
        break;
      }
    }
    if (!linked) {
      st.ok = false;
      why?.set(d.key, `no clear line to the network within ${reach} m from (${g.x[last]!.toFixed(1)}, ${g.z[last]!.toFixed(1)}); ${cands.length} candidates, nearest ${cands[0]?.d.toFixed(1)}`);
    }
  }

  // ---- routes (single-source shortest paths, cached per source) ------------------------------------------------------------------------
  const trees = new Map<number, { dist: Float64Array; prev: Int32Array }>();
  const tree = (src: number): { dist: Float64Array; prev: Int32Array } => {
    const hit = trees.get(src);
    if (hit) return hit;
    const n = g.x.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    // a small binary heap of [dist, node]
    const heap: [number, number][] = [[0, src]];
    dist[src] = 0;
    const push = (item: [number, number]): void => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p]![0] <= heap[i]![0]) break;
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    while (heap.length > 0) {
      const [d, u] = pop();
      if (d > dist[u]!) continue;
      for (const e of g.adj[u]!) {
        const nd = d + e.cost;
        if (nd < dist[e.to]!) {
          dist[e.to] = nd;
          prev[e.to] = u;
          push([nd, e.to]);
        }
      }
    }
    const t = { dist, prev };
    trees.set(src, t);
    return t;
  };

  const routes = new Map<number, Route | null>();
  const route = (a: number, b: number): Route | undefined => {
    const key = a * 4096 + b;
    const hit = routes.get(key);
    if (hit !== undefined) return hit ?? undefined;
    const sa = stations[a];
    const sb = stations[b];
    let made: Route | undefined;
    if (sa && sb && sa.ok && sb.ok) {
      if (a === b) made = single(sa);
      else {
        const t = tree(sa.node);
        if (t.dist[sb.node]! < Infinity) {
          const nodes: number[] = [];
          for (let u = sb.node; u >= 0; u = t.prev[u]!) nodes.push(u);
          nodes.reverse();
          made = resample(world, g, nodes, sa, sb, stations, index);
        }
      }
    }
    routes.set(key, made ?? null);
    return made;
  };
  const distance = (a: number, b: number): number => {
    const sa = stations[a];
    const sb = stations[b];
    if (!sa || !sb || !sa.ok || !sb.ok) return Infinity;
    return a === b ? 0 : tree(sa.node).dist[sb.node]!;
  };
  return { world, stations, index, route, distance, nodeCount: g.x.length };
}

function single(s: Station): Route {
  return { len: 0, n: 1, x: Float32Array.of(s.x), z: Float32Array.of(s.z), y: Float32Array.of(s.y), clear: Float32Array.of(0), hideUntil: -1, hideFrom: Infinity };
}

/** A node path -> evenly spaced samples with the ground height a walker would follow. */
function resample(world: CollisionWorld, g: Graph, nodes: number[], from: Station, to: Station, stations: Station[], index: ReadonlyMap<string, number>): Route {
  const px: number[] = [];
  const pz: number[] = [];
  const pc: number[] = [];
  for (const u of nodes) {
    px.push(g.x[u]!);
    pz.push(g.z[u]!);
    pc.push(g.clear[u]!);
  }
  const seg: number[] = [0];
  for (let i = 1; i < px.length; i++) seg.push(seg[i - 1]! + Math.hypot(px[i]! - px[i - 1]!, pz[i]! - pz[i - 1]!));
  const len = seg[seg.length - 1]!;
  const n = Math.max(2, Math.ceil(len / DS) + 1);
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const y = new Float32Array(n);
  const clear = new Float32Array(n);
  let k = 0;
  let cy = from.y;
  for (let i = 0; i < n; i++) {
    const s = (len * i) / (n - 1);
    while (k + 2 < seg.length && seg[k + 1]! < s) k++;
    const span = seg[k + 1]! - seg[k]! || 1;
    const t = Math.min(1, Math.max(0, (s - seg[k]!) / span));
    x[i] = px[k]! + (px[k + 1]! - px[k]!) * t;
    z[i] = pz[k]! + (pz[k + 1]! - pz[k]!) * t;
    clear[i] = (pc[k]! + (pc[k + 1]! - pc[k]!) * t) * Math.min(1, s / 2) * Math.min(1, (len - s) / 2);
    cy = world.groundHeight(x[i]!, z[i]!, Math.max(cy, world.terrainHeight(x[i]!, z[i]!)));   // (feet are never below the ground at the new point: a sample half a metre on, up a slope, is a step of the SLOPE's rise, not the last sample's stale height + a tread)
    y[i] = cy;
  }
  // round the corners (the grid's octagonal turns): each sample moves toward its neighbours' average if it can stand there, then the heights are followed again
  if (n > 4) {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i + 1 < n; i++) {
        const sx = x[i]! * 0.5 + (x[i - 1]! + x[i + 1]!) * 0.25;
        const sz = z[i]! * 0.5 + (z[i - 1]! + z[i + 1]!) * 0.25;
        if (Math.abs(sx - x[i]!) + Math.abs(sz - z[i]!) < 1e-4) continue;
        if (standingHeight(world, sx, sz, y[i]!) !== undefined) {
          x[i] = sx;
          z[i] = sz;
        }
      }
    }
    cy = from.y;
    for (let i = 0; i < n; i++) {
      cy = world.groundHeight(x[i]!, z[i]!, Math.max(cy, world.terrainHeight(x[i]!, z[i]!)));   // (feet are never below the ground at the new point: a sample half a metre on, up a slope, is a step of the SLOPE's rise, not the last sample's stale height + a tread)
      y[i] = cy;
    }
  }
  // how far a walker may stray to either side (they keep to one side of the road): only as far as both sides are still standable
  for (let i = 1; i + 1 < n; i++) {
    if (clear[i]! <= 0) continue;
    const tx = x[i + 1]! - x[i - 1]!;
    const tz = z[i + 1]! - z[i - 1]!;
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl;
    const nz = tx / tl;
    let c = clear[i]!;
    while (c > 0.04 && (standingHeight(world, x[i]! + nx * c, z[i]! + nz * c, y[i]!) === undefined || standingHeight(world, x[i]! - nx * c, z[i]! - nz * c, y[i]!) === undefined)) c -= 0.06;
    clear[i] = Math.max(0, c);
  }
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i + 1 < n; i++) clear[i] = Math.min(clear[i]!, clear[i - 1]! === 0 && i === 1 ? 0 : clear[i - 1]!, clear[i + 1]!);
  // smooth the heights (a stair becomes a ramp), keeping the ends on their stations
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i + 1 < n; i++) y[i] = y[i]! * 0.5 + (y[i - 1]! + y[i + 1]!) * 0.25;
  }
  y[0] = from.y;
  y[n - 1] = to.y;
  let hideUntil = -1;
  let hideFrom = Infinity;
  const door = (s: Station): number => {
    const parent = stations[index.get(s.key.replace(/^in:/, "step:")) ?? -1];
    return parent ? Math.hypot(parent.x - s.x, parent.z - s.z) : 1.5;
  };
  if (to.hidden) hideFrom = Math.max(0, len - door(to) + 0.55);
  if (from.hidden) hideUntil = Math.max(0, door(from) - 0.55);
  return { len, n, x, z, y, clear, hideUntil, hideFrom };
}

/** A point at arclength `s` along a route (clamped), written into `out` with the unit tangent. */
export function routePoint(r: Route, s: number, out: { x: number; z: number; y: number; tx: number; tz: number; clear: number }): void {
  if (r.n <= 1 || r.len <= 0) {
    out.x = r.x[0]!;
    out.z = r.z[0]!;
    out.y = r.y[0]!;
    out.tx = 0;
    out.tz = -1;
    out.clear = 0;
    return;
  }
  const f = Math.min(r.n - 1 - 1e-6, Math.max(0, (s / r.len) * (r.n - 1)));
  const i = Math.floor(f);
  const t = f - i;
  out.x = r.x[i]! + (r.x[i + 1]! - r.x[i]!) * t;
  out.z = r.z[i]! + (r.z[i + 1]! - r.z[i]!) * t;
  out.y = r.y[i]! + (r.y[i + 1]! - r.y[i]!) * t;
  out.clear = r.clear[i]! + (r.clear[i + 1]! - r.clear[i]!) * t;
  const dx = r.x[i + 1]! - r.x[i]!;
  const dz = r.z[i + 1]! - r.z[i]!;
  const d = Math.hypot(dx, dz) || 1;
  out.tx = dx / d;
  out.tz = dz / d;
}
