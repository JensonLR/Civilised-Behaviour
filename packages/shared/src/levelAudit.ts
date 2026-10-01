import type { RegionId } from "./campaignTypes.ts";
import type { CollisionWorld, Obstacle } from "./collision.ts";
import { CHARACTER, FLAG, MOVEMENT, STEP_DT } from "./constants.ts";
import { axisToWire, createCharState, stepCharacter, yawToWire, type CharState, type MoveCommand } from "./movement.ts";
import { PROP_DEFS, type PropKindId, type PropSpawn } from "./props.ts";

/**
 * THE LEVEL AUDIT (D-038, docs/LEVEL_PLAN.md). Pure functions that read a region's authored plan and its real collision world and report what is
 * broken: footprints that intersect, doors that open into walls, doors nobody can reach, props inside walls or in a doorway, spawns that trap you,
 * story points you cannot walk to, paths too narrow to walk. It uses the REAL movement step (`stepCharacter`) wherever a wall or a step could change
 * the answer (the only shortcut is an edge between two cells that are both a body-width clear of every solid and nearly level, which the step
 * provably walks), so "reachable" here means "a player can walk it", not "the geometry looks open".
 *
 * The audit KNOWS NOTHING ABOUT ANY REGION. Each region supplies a `RegionAuditAdapter` (seed -> `RegionAuditInput`) from its own plan; package L writes
 * the five (hub, Kessar, Highmark, Vesper, Saltmarket) in `levelAuditAdapters.ts` and runs `auditRegion` over `AUDIT_SEEDS` as a permanent test.
 * Deterministic, no clock, no Math.random: shared sim rules apply.
 */

// ---- the standard (LEVEL_PLAN.md section 1 states the same numbers; the doc and this table must agree) ------------------------------------------------

export const AUDIT = {
  /** Clear width of a person's door, metres. The body is 0.8 across: 1.3 leaves a hand's width each side; 1.5 is the standard. */
  doorMinWidth: 1.3,
  /** A gate a wagon or a horse and rider passes. */
  gateMinWidth: 2.6,
  /** Clear height of any door (the lintel's underside). */
  doorMinHeight: 2.2,
  /** The apron: the strip in front of a door that must be open ground (depth along the facing, margin each side of the door width). */
  apronDepth: 1.6,
  apronMargin: 0.3,
  /** An interior must hold at least this much walkable floor (flood-filled at `interiorCell`) and be at least this wide in its narrowest clear span. */
  interiorMinArea: 3.0,
  interiorCell: 0.4,
  /** Footprints may touch; they may not intersect by more than this (metres of penetration). */
  overlapTolerance: 0.06,
  /** Two solids must share more than this much height to count as intersecting (one sitting on the other's roof is not). */
  overlapMinHeight: 0.3,
  /** Minimum clear width of a walked path by class (metres): a trodden track, a street, a main road a wagon takes. */
  pathMin: { track: 1.6, street: 2.4, road: 3.6 },
  /** Propspawn clearance beyond its own radius from a wall, a door's apron or a path's edge. */
  propMargin: 0.15,
  /** The flood fill's cell, metres. */
  cell: 1.0,
  /** A walk that loses more height than this in one step has fallen, not walked (one-way drops are not routes). */
  maxDrop: 1.0,
  /** A route that is longer than this multiple of the straight line is a maze (warn). */
  detourWarn: 2.2,
} as const;

/** Seeds every region's audit must pass (the permanent test runs them all). */
export const AUDIT_SEEDS: readonly number[] = [1, 7, 42, 1337, 90210];

// ---- input -------------------------------------------------------------------------------------------------------------------------------------

export type AuditKind = "building" | "wall" | "tower" | "gate" | "stall" | "tent" | "prop" | "fence" | "furniture" | "plinth" | "natural" | "deck" | "sign" | "banner-post";
export type Zone = "hub" | "approach" | "set-piece" | "reward" | "return";

/** One authored solid. `group` ties the parts of one structure together (a building's four wall boxes share a group): parts of a group never flag each other. */
export interface AuditFootprint {
  id: string;
  group: string;
  kind: AuditKind;
  zone?: Zone;
  shape: Obstacle;
}

/**
 * What a door leads to. "interior": a walkable room the audit enters. "passage": an archway or gate you walk THROUGH to the far side (needs `through`).
 * "sealed": a visibly sealed facade (a painted-on or boarded door the view draws shut); collision must hold it shut and the view must not draw a handle.
 */
export type DoorLeads = "interior" | "passage" | "sealed";

export interface AuditDoor {
  id: string;
  /** `AuditFootprint.group` of the building the door is in. */
  building: string;
  /** Centre of the threshold on the wall's outer face, world frame. */
  x: number;
  z: number;
  /** Direction the door faces OUT (collision convention: the outward unit vector is (cos yaw, sin yaw)). */
  yaw: number;
  /** Clear width and height of the opening. */
  width: number;
  height: number;
  leads: DoorLeads;
  /** "interior": a point on the floor inside, and the room's rectangle (world frame, yaw is the room's) for the area and lighting checks. */
  room?: { x: number; z: number; hx: number; hz: number; yaw: number; lit: boolean };
  /** "passage": a point 1.6 m beyond the far side of the arch. */
  through?: { x: number; z: number };
  /** A gate wagons use (width must reach `gateMinWidth`). */
  wide?: boolean;
  /**
   * D-038: the absolute height of the floor or landing the door opens from (a stilt house's deck can stand more than `standY`'s 1.5 m above a sloping bank, and `standY` would then measure the ground
   * beneath it). When given, the apron and the walk start from the surface at that height.
   */
  floorY?: number;
}

/** A named place the party must be able to walk to from the landing (a story anchor, a station, a parley spot, a pickup). */
export interface AuditPoint {
  id: string;
  x: number;
  z: number;
  /** Nobody may be asked to walk here if it is not reachable. false = decorative or optional (reported, not an error). */
  mustReach: boolean;
  zone?: Zone;
}

export type PathClass = keyof typeof AUDIT.pathMin;
/** A walked route (a road, a street, a ramp, a gangway). Width is measured by probing sideways with the real body, every metre along it. */
export interface AuditRoute {
  id: string;
  class: PathClass;
  points: readonly { x: number; z: number }[];
  /** Override of AUDIT.pathMin for this route (a deliberate squeeze, such as a stair, a gangway or a plank). Never below 1.2. */
  minWidth?: number;
}

export interface AuditProp {
  id: string;
  x: number;
  z: number;
  /** Footprint radius; `propRadius(kind)` for a PropSpawn. */
  r: number;
}

export interface RegionAuditInput {
  region: RegionId;
  seed: number;
  world: CollisionWorld;
  footprints: readonly AuditFootprint[];
  doors: readonly AuditDoor[];
  points: readonly AuditPoint[];
  routes: readonly AuditRoute[];
  props: readonly AuditProp[];
  /** `regionSpawn(region, i, count)` for every count 1..4 and every i < count (deduplicated by the adapter or not: duplicates are fine). */
  spawns: readonly { x: number; z: number }[];
  /** Pairs `[groupA, groupB]` allowed to intersect (a bridge's parapet and its deck; a gate's arch and its towers). Keep this list short and commented in the adapter. */
  allowOverlap?: readonly (readonly [string, string])[];
  /** Region-wide switches. */
  options?: { cell?: number; maxCells?: number; skipFlood?: boolean };
}

/** `seed -> input`: one per region, written by package L (levelAuditAdapters.ts). Must not mutate shared caches. */
export type RegionAuditAdapter = (seed: number) => RegionAuditInput;
export type RegionAuditAdapters = Record<RegionId, RegionAuditAdapter>;

/** Radius of a spawned prop's footprint, metres (the half-diagonal of a box, the radius of a cylinder). */
export function propRadius(kind: number): number {
  const d = PROP_DEFS[kind as PropKindId];
  if (!d) return 0.5;
  return d.shape === "box" ? Math.hypot(d.half[0], d.half[2]) : d.half[0];
}
export const auditPropsFromSpawns = (spawns: readonly PropSpawn[]): AuditProp[] => spawns.map((p, i) => ({ id: `prop${i}:${PROP_DEFS[p.kind as PropKindId]?.name ?? p.kind}`, x: p.x, z: p.z, r: propRadius(p.kind) }));

/** Footprints from collision obstacles, grouped by the caller's rule (the adapter knows which obstacles are one building). */
export function footprintsFromObstacles(obstacles: readonly Obstacle[], groupOf: (o: Obstacle, i: number) => { id: string; group: string; kind: AuditKind; zone?: Zone } | undefined): AuditFootprint[] {
  const out: AuditFootprint[] = [];
  obstacles.forEach((o, i) => {
    const g = groupOf(o, i);
    if (g) out.push({ ...g, shape: o });
  });
  return out;
}

// ---- output ------------------------------------------------------------------------------------------------------------------------------------

export type FindingKind =
  | "footprint-overlap"
  | "door-floating" | "door-too-narrow" | "door-too-low" | "door-apron-blocked" | "door-unreachable" | "door-into-wall" | "sealed-door-passable" | "door-bad-leads"
  | "interior-too-small" | "interior-unreachable" | "interior-unlit"
  | "prop-in-wall" | "prop-on-door-apron" | "prop-on-path"
  | "stuck-spawn" | "unreachable-point" | "route-blocked" | "path-too-narrow" | "detour";

export interface Finding {
  kind: FindingKind;
  severity: "error" | "warn";
  region: RegionId;
  /** The id of the thing at fault (a door, a footprint, a prop, a route, a point). */
  subject: string;
  other?: string;
  at: { x: number; z: number };
  detail: string;
}

export interface AuditStats {
  footprints: number;
  doors: number;
  props: number;
  cellsVisited: number;
  pointsReached: number;
  pointsTotal: number;
  ms: number;
}
export interface AuditReport {
  region: RegionId;
  seed: number;
  findings: Finding[];
  stats: AuditStats;
}

export const errorsOf = (r: AuditReport): Finding[] => r.findings.filter((f) => f.severity === "error");
export const countByKind = (r: AuditReport): Partial<Record<FindingKind, number>> => {
  const out: Partial<Record<FindingKind, number>> = {};
  for (const f of r.findings) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
};
export function formatReport(r: AuditReport, max = 40): string {
  const lines = [`${r.region} seed ${r.seed}: ${r.findings.length} findings (${errorsOf(r).length} errors), ${r.stats.cellsVisited} cells, ${r.stats.pointsReached}/${r.stats.pointsTotal} points`];
  for (const f of r.findings.slice(0, max)) lines.push(`  ${f.severity.toUpperCase()} ${f.kind} ${f.subject}${f.other ? ` / ${f.other}` : ""} @ ${f.at.x.toFixed(1)},${f.at.z.toFixed(1)}: ${f.detail}`);
  if (r.findings.length > max) lines.push(`  ... ${r.findings.length - max} more`);
  return lines.join("\n");
}

/**
 * The permanent test's gate: errors must equal the ratchet's allowance (never more). `allowed` is a per-region map of finding kind -> count that package L
 * lowers to empty as it fixes things; the final state is `{}` and any error fails the build. Warnings never fail but are listed.
 */
export type AuditAllowance = Partial<Record<FindingKind, number>>;
export function overAllowance(r: AuditReport, allowed: AuditAllowance = {}): Finding[] {
  const left: AuditAllowance = { ...allowed };
  const over: Finding[] = [];
  for (const f of errorsOf(r)) {
    const n = left[f.kind] ?? 0;
    if (n > 0) left[f.kind] = n - 1;
    else over.push(f);
  }
  return over;
}

// ---- geometry ----------------------------------------------------------------------------------------------------------------------------------

const boundR = (o: Obstacle): number => (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz));

/** Penetration depth (metres) of two obstacle footprints in plan: 0 when they only touch or are apart. Exact (separating axes). */
export function penetration(a: Obstacle, b: Obstacle): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  const rs = boundR(a) + boundR(b);
  if (d2 >= rs * rs) return 0;
  if (a.kind === "circle" && b.kind === "circle") return Math.max(0, a.r + b.r - Math.sqrt(d2));
  if (a.kind === "circle" && b.kind === "box") return circleBox(a.x, a.z, a.r, b);
  if (a.kind === "box" && b.kind === "circle") return circleBox(b.x, b.z, b.r, a);
  if (a.kind !== "box" || b.kind !== "box") return 0;
  // box-box: the four edge normals
  let depth = Infinity;
  for (const [o, p] of [[a, b], [b, a]] as const) {
    const c = Math.cos(o.yaw);
    const s = Math.sin(o.yaw);
    for (const [ax, az, ext] of [[c, s, o.hx], [-s, c, o.hz]] as const) {
      const t = Math.abs((p.x - o.x) * ax + (p.z - o.z) * az);
      const pc = Math.cos(p.yaw);
      const ps = Math.sin(p.yaw);
      const rp = Math.abs(ax * pc + az * ps) * p.hx + Math.abs(-ax * ps + az * pc) * p.hz;
      const ov = ext + rp - t;
      if (ov <= 0) return 0;
      if (ov < depth) depth = ov;
    }
  }
  return Number.isFinite(depth) ? depth : 0;
}

function circleBox(cx: number, cz: number, r: number, b: Extract<Obstacle, { kind: "box" }>): number {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const lx = (cx - b.x) * c + (cz - b.z) * s;
  const lz = -(cx - b.x) * s + (cz - b.z) * c;
  const qx = Math.max(-b.hx, Math.min(b.hx, lx));
  const qz = Math.max(-b.hz, Math.min(b.hz, lz));
  const dist = Math.hypot(lx - qx, lz - qz);
  if (dist > 1e-9) return Math.max(0, r - dist);
  return r + Math.min(b.hx - Math.abs(lx), b.hz - Math.abs(lz));
}

/** True when (x, z) is inside the obstacle's plan shape grown by `margin`. */
export function insideShape(o: Obstacle, x: number, z: number, margin = 0): boolean {
  if (o.kind === "circle") return (x - o.x) ** 2 + (z - o.z) ** 2 <= (o.r + margin) ** 2;
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const lx = (x - o.x) * c + (z - o.z) * s;
  const lz = -(x - o.x) * s + (z - o.z) * c;
  return Math.abs(lx) <= o.hx + margin && Math.abs(lz) <= o.hz + margin;
}

/** Distance from a point to the boundary of a box obstacle's plan (negative inside). */
function boxEdgeDistance(b: Extract<Obstacle, { kind: "box" }>, x: number, z: number): number {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const lx = Math.abs((x - b.x) * c + (z - b.z) * s);
  const lz = Math.abs(-(x - b.x) * s + (z - b.z) * c);
  const ox = lx - b.hx;
  const oz = lz - b.hz;
  return ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz);
}

// ---- the real step ------------------------------------------------------------------------------------------------------------------------------

const _st: CharState = createCharState(0, 0, { groundHeight: () => 0 } as unknown as CollisionWorld);
const _cmd: MoveCommand = { moveF: 127, moveR: 0, yaw: 0, buttons: 0 };

/** Where a person standing at (x, z) rests: the steppable top at the point (a pier, a plinth, a floor), never a roof. */
export function standY(world: CollisionWorld, x: number, z: number, hint?: number): number {
  if (hint !== undefined) return world.groundHeight(x, z, hint);
  const t = world.terrainHeight(x, z);
  const up = world.groundHeight(x, z, 1e6);
  return up - t > CHARACTER.stepHeight * 3 ? t : up;
}

/** True when a person's body fits at (x, z) (standing at `y`): nothing pushes it out and it is inside the world. */
export function isOpen(world: CollisionWorld, x: number, z: number, y: number, radius: number = CHARACTER.radius): boolean {
  const p = { x, z };
  return !world.resolveXZ(p, y, radius, CHARACTER.height);
}

export interface WalkResult {
  ok: boolean;
  /** Where the walk ended and how close it got to the target. */
  x: number;
  y: number;
  z: number;
  closest: number;
  ticks: number;
  /** The walk fell more than AUDIT.maxDrop (a drop, not a route). */
  fell: boolean;
}

/**
 * Walks a body from (ax, az) at run speed toward (bx, bz), re-aiming each tick, with the SAME `stepCharacter` the server and the prediction use.
 * Stops at the target, when stalled against something, or when the budget runs out. `ok` = got within `tol` of the target without falling.
 */
export function walkTo(world: CollisionWorld, ax: number, ay: number | undefined, az: number, bx: number, bz: number, tol = 0.3): WalkResult {
  const s = _st;
  s.x = ax;
  s.z = az;
  s.y = ay ?? standY(world, ax, az);
  s.vx = s.vy = s.vz = 0;
  s.facing = 0;
  s.flags = FLAG.GROUNDED;
  s.stumble = 0;
  s.wounds = 0;
  s.missing = 0;
  const dist0 = Math.hypot(bx - ax, bz - az);
  const maxTicks = Math.ceil(dist0 / (MOVEMENT.runSpeed * 0.5 * STEP_DT)) + 24;
  let closest = dist0;
  let ey = s.y;
  let still = 0;
  let ticks = 0;
  let lastX = s.x;
  let lastZ = s.z;
  // a FALL is height lost while airborne (a lip, a gap), not the net descent of a long gentle slope: track the height at the last tick the body stood on something (D-038 fix)
  let standing = s.y;
  let fellFar = 0;
  for (; ticks < maxTicks; ticks++) {
    const dx = bx - s.x;
    const dz = bz - s.z;
    const d = Math.hypot(dx, dz);
    if (d < closest) {
      closest = d;
      ey = s.y;
    }
    if (d <= Math.min(tol, 0.15)) break;
    _cmd.yaw = yawToWire(Math.atan2(-dx, -dz));
    _cmd.moveF = axisToWire(Math.min(1, d / 0.6));
    stepCharacter(s, _cmd, STEP_DT, world);
    if ((s.flags & FLAG.GROUNDED) !== 0) standing = s.y;
    else if (standing - s.y > fellFar) fellFar = standing - s.y;
    if (ticks % 6 === 5) {
      still = Math.hypot(s.x - lastX, s.z - lastZ) < 0.04 ? still + 1 : 0;
      lastX = s.x;
      lastZ = s.z;
      if (still >= 2) break;
    }
  }
  const d = Math.hypot(bx - s.x, bz - s.z);
  if (d < closest) {
    closest = d;
    ey = s.y;
  }
  const fell = fellFar > AUDIT.maxDrop;
  return { ok: closest <= tol && !fell, x: s.x, y: ey, z: s.z, closest, ticks, fell };
}

// ---- flood fill ---------------------------------------------------------------------------------------------------------------------------------

export interface FloodOptions {
  cell?: number;
  /** World rectangle to fill (default: the world's playable disc's bounding box). */
  bounds?: { x0: number; z0: number; x1: number; z1: number };
  maxCells?: number;
  /** Radius of the body used for openness (default CHARACTER.radius). */
  radius?: number;
  /** Optional `y` hint per start (a pier or a deck), else `standY`. */
  startY?: number;
}

/** A reachability field: which cells of a grid a person can walk to from the starts, by the real step. */
export class Reach {
  readonly cell: number;
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly state: Uint8Array; // 0 unvisited, 1 reached, 2 blocked
  readonly y: Float32Array;
  readonly steps: Float32Array; // path length in metres from the nearest start
  visited = 0;
  constructor(
    readonly world: CollisionWorld,
    b: { x0: number; z0: number; x1: number; z1: number },
    cell: number,
  ) {
    this.cell = cell;
    this.x0 = b.x0;
    this.z0 = b.z0;
    this.nx = Math.max(1, Math.ceil((b.x1 - b.x0) / cell) + 1);
    this.nz = Math.max(1, Math.ceil((b.z1 - b.z0) / cell) + 1);
    this.state = new Uint8Array(this.nx * this.nz);
    this.y = new Float32Array(this.nx * this.nz);
    this.steps = new Float32Array(this.nx * this.nz).fill(Infinity);
  }
  index(x: number, z: number): number {
    const ix = Math.round((x - this.x0) / this.cell);
    const iz = Math.round((z - this.z0) / this.cell);
    return ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz ? -1 : iz * this.nx + ix;
  }
  /** Reached at (x, z) or any cell within `slack` metres (default one cell and a half: a point need not sit on a cell centre). */
  reached(x: number, z: number, slack = this.cell * 1.5): boolean {
    return this.nearest(x, z, slack) >= 0;
  }
  /** Index of the closest reached cell within `slack` metres of the point, or -1. */
  nearest(x: number, z: number, slack = this.cell * 1.5): number {
    const r = Math.ceil(slack / this.cell);
    const ci = Math.round((x - this.x0) / this.cell);
    const cj = Math.round((z - this.z0) / this.cell);
    let best = -1;
    let bd = slack * slack;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const k = j * this.nx + i;
        if (this.state[k] !== 1) continue;
        const d = (this.x0 + i * this.cell - x) ** 2 + (this.z0 + j * this.cell - z) ** 2;
        if (d <= bd) {
          bd = d;
          best = k;
        }
      }
    }
    return best;
  }
  /** Walked path length (metres) from the starts to the cell nearest (x, z), or Infinity. */
  distanceTo(x: number, z: number, slack = this.cell * 1.5): number {
    const k = this.nearest(x, z, slack);
    return k < 0 ? Infinity : this.steps[k]!;
  }
}

const DIRS: readonly (readonly [number, number, number])[] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/**
 * Breadth-first flood fill from `starts` over a grid, deciding each edge with the real movement step (see the file header for the one shortcut).
 * 8-connected, so diagonals through a gap a body fits count. Cells are blocked if a body does not fit there at its resting height.
 */
export function floodFill(world: CollisionWorld, starts: readonly { x: number; z: number; y?: number }[], opts: FloodOptions = {}): Reach {
  const cell = opts.cell ?? AUDIT.cell;
  const R = opts.radius ?? CHARACTER.radius;
  const b = opts.bounds ?? { x0: -world.boundsRadius, z0: -world.boundsRadius, x1: world.boundsRadius, z1: world.boundsRadius };
  const reach = new Reach(world, b, cell);
  const maxCells = opts.maxCells ?? 2_000_000;
  // "clear" cache: 1 = no solid within R + a cell and a half, 2 = something near
  const near = new Uint8Array(reach.state.length);
  const clearR = R + cell * 0.8;
  const isClear = (k: number, x: number, z: number, y: number): boolean => {
    let v = near[k]!;
    if (v === 0) {
      const p = { x, z };
      v = world.resolveXZ(p, y, clearR, CHARACTER.height) ? 2 : 1;
      near[k] = v;
    }
    return v === 1;
  };
  const queue: number[] = [];
  for (const s of starts) {
    const k = reach.index(s.x, s.z);
    if (k < 0 || reach.state[k] === 1) continue;
    const y = s.y ?? standY(world, s.x, s.z);
    if (!isOpen(world, s.x, s.z, y, R)) continue;
    reach.state[k] = 1;
    reach.y[k] = y;
    reach.steps[k] = 0;
    queue.push(k);
  }
  let head = 0;
  while (head < queue.length && reach.visited < maxCells) {
    const k = queue[head++]!;
    reach.visited++;
    const ix = k % reach.nx;
    const iz = (k - ix) / reach.nx;
    const px = reach.x0 + ix * cell;
    const pz = reach.z0 + iz * cell;
    const py = reach.y[k]!;
    for (const [dx, dz, len] of DIRS) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= reach.nx || jz >= reach.nz) continue;
      const j = jz * reach.nx + jx;
      if (reach.state[j] !== 0) continue;
      const tx = reach.x0 + jx * cell;
      const tz = reach.z0 + jz * cell;
      if (Math.hypot(tx, tz) > world.boundsRadius - R) {
        reach.state[j] = 2;
        continue;
      }
      // the resting height at the target: the steppable surface from where we stand
      const ty = world.groundHeight(tx, tz, py);
      const rise = ty - py;
      let ok: boolean;
      if (rise > CHARACTER.stepHeight + 1e-3 || py - ty > AUDIT.maxDrop) ok = false;
      else {
        // The shortcut: both cells rest on bare terrain, a body-width clear of every solid, and the ground between them is gentle. The step provably walks it.
        const pt0 = world.terrainHeight(px, pz);
        const tt0 = world.terrainHeight(tx, tz);
        const bare = Math.abs(py - pt0) < 0.05 && Math.abs(ty - tt0) < 0.05 && Math.abs(tt0 - pt0) <= cell * len * CHARACTER.maxSlope * 0.5;
        if (bare && isClear(k, px, pz, py) && isClear(j, tx, tz, ty)) ok = true;
        else if (!isOpen(world, tx, tz, ty, R)) ok = false;
        else ok = walkTo(world, px, py, pz, tx, tz, Math.max(0.25, cell * 0.3)).ok;
      }
      if (!ok) {
        // a blocked diagonal or an obstructed cell may still be reached from another side: only mark it blocked when the target itself is not open
        if (!isOpen(world, tx, tz, ty, R)) reach.state[j] = 2;
        continue;
      }
      reach.state[j] = 1;
      reach.y[j] = ty;
      reach.steps[j] = reach.steps[k]! + len * cell;
      queue.push(j);
    }
  }
  return reach;
}

// ---- checks ------------------------------------------------------------------------------------------------------------------------------------

const pt = (x: number, z: number): { x: number; z: number } => ({ x, z });

/** Intersecting footprints of different groups (sweep over x). Parts of one group, allowed pairs and mere contact never flag. */
export function footprintOverlaps(region: RegionId, fps: readonly AuditFootprint[], allow: readonly (readonly [string, string])[] = []): Finding[] {
  const out: Finding[] = [];
  const ok = new Set(allow.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const order = fps.map((f, i) => ({ f, i, lo: f.shape.x - boundR(f.shape), hi: f.shape.x + boundR(f.shape) })).sort((a, b) => a.lo - b.lo);
  for (let a = 0; a < order.length; a++) {
    const A = order[a]!;
    for (let b = a + 1; b < order.length && order[b]!.lo < A.hi; b++) {
      const B = order[b]!;
      if (A.f.group === B.f.group || ok.has(`${A.f.group}|${B.f.group}`)) continue;
      const sa = A.f.shape;
      const sb = B.f.shape;
      if (Math.min(sa.y1, sb.y1) - Math.max(sa.y0, sb.y0) < AUDIT.overlapMinHeight) continue;
      const depth = penetration(sa, sb);
      if (depth <= AUDIT.overlapTolerance) continue;
      const soft = A.f.kind === "natural" && B.f.kind === "natural";
      out.push({ kind: "footprint-overlap", severity: soft ? "warn" : "error", region, subject: A.f.id, other: B.f.id, at: pt((sa.x + sb.x) / 2, (sa.z + sb.z) / 2), detail: `${A.f.kind} and ${B.f.kind} intersect by ${depth.toFixed(2)} m` });
    }
  }
  return out;
}

/** The strip in front of a door (world-frame OBB): depth along the facing, the door's width plus margins across. */
export function doorApron(d: AuditDoor): Extract<Obstacle, { kind: "box" }> {
  const depth = AUDIT.apronDepth;
  const c = Math.cos(d.yaw);
  const s = Math.sin(d.yaw);
  return { kind: "box", x: d.x + c * (depth / 2 + 0.02), z: d.z + s * (depth / 2 + 0.02), hx: depth / 2, hz: d.width / 2 + AUDIT.apronMargin, yaw: d.yaw, y0: -1e3, y1: 1e3 };
}

/** The point `m` metres out from the threshold (m > 0) or in (m < 0), on the door's axis. */
export const doorAxisPoint = (d: AuditDoor, m: number): { x: number; z: number } => pt(d.x + Math.cos(d.yaw) * m, d.z + Math.sin(d.yaw) * m);

export interface DoorCheckContext {
  region: RegionId;
  world: CollisionWorld;
  footprints: readonly AuditFootprint[];
  /** Reachability from the spawns (undefined to skip the "unreachable apron" check). */
  reach?: Reach;
}

/** Everything the audit says about one door. */
export function checkDoor(d: AuditDoor, ctx: DoorCheckContext): Finding[] {
  const { region, world } = ctx;
  const out: Finding[] = [];
  const add = (kind: FindingKind, detail: string, severity: "error" | "warn" = "error", other?: string): void => {
    out.push({ kind, severity, region, subject: d.id, other, at: pt(d.x, d.z), detail });
  };
  const min = d.wide ? AUDIT.gateMinWidth : AUDIT.doorMinWidth;
  if (d.width < min - 1e-6) add("door-too-narrow", `clear width ${d.width.toFixed(2)} m < ${min} m`);
  if (d.height < AUDIT.doorMinHeight - 1e-6) add("door-too-low", `clear height ${d.height.toFixed(2)} m < ${AUDIT.doorMinHeight} m`);
  if ((d.leads === "interior" && !d.room) || (d.leads === "passage" && !d.through)) add("door-bad-leads", `leads "${d.leads}" but no ${d.leads === "interior" ? "room" : "through point"} given`);

  // the door must be IN a wall: its threshold on the boundary of its building's footprint
  const parts = ctx.footprints.filter((f) => f.group === d.building && f.shape.kind === "box");
  if (parts.length === 0) add("door-floating", `no footprint in group "${d.building}"`);
  else {
    const edge = Math.min(...parts.map((f) => Math.abs(boxEdgeDistance(f.shape as Extract<Obstacle, { kind: "box" }>, d.x, d.z))));
    const nearCircle = ctx.footprints.some((f) => f.group === d.building && f.shape.kind === "circle" && Math.abs(Math.hypot(d.x - f.shape.x, d.z - f.shape.z) - f.shape.r) < 0.5);
    if (edge > d.width / 2 + 0.5 && !nearCircle) add("door-floating", `threshold is ${edge.toFixed(2)} m from the building's walls`);
  }

  // the apron outside must be open ground and free of other solids
  const out1 = doorAxisPoint(d, 1.0);
  const oy = d.floorY !== undefined ? world.groundHeight(out1.x, out1.z, d.floorY) : standY(world, out1.x, out1.z);
  if (!isOpen(world, out1.x, out1.z, oy)) add("door-apron-blocked", "no room to stand 1 m outside the door");
  const ap = doorApron(d);
  for (const f of ctx.footprints) {
    if (f.group === d.building) continue;
    if (f.kind === "deck" || f.kind === "natural" && f.shape.y1 - world.terrainHeight(f.shape.x, f.shape.z) < 0.3) continue;
    if (penetration(ap, f.shape) > 0.05 && f.shape.y1 - world.terrainHeight(f.shape.x, f.shape.z) > CHARACTER.stepHeight) add("door-apron-blocked", `${f.kind} "${f.id}" stands in the doorway's apron`, "error", f.id);
  }
  if (ctx.reach && !ctx.reach.reached(out1.x, out1.z, 1.6)) {
    // (D-038: the 1 m flood cannot take a stair of 0.5 m treads one cell at a time, so before calling a door unreachable walk it with the real step from the nearest reached cell)
    // (from the reached cell nearest a point 4 m out on the door's axis, to that point, and then straight in up the stair: the way a person approaches)
    const far = doorAxisPoint(d, 4);
    const k = ctx.reach.nearest(far.x, far.z, 4);
    let ok = false;
    if (k >= 0) {
      const sx = ctx.reach.x0 + (k % ctx.reach.nx) * ctx.reach.cell;
      const sz = ctx.reach.z0 + Math.floor(k / ctx.reach.nx) * ctx.reach.cell;
      const leg = walkTo(world, sx, ctx.reach.y[k]!, sz, far.x, far.z, 0.6);
      if (leg.ok) ok = walkTo(world, leg.x, leg.y, leg.z, out1.x, out1.z, 0.4).ok;
    }
    if (!ok) add("door-unreachable", "the ground outside the door cannot be walked to from the landing");
  }

  // walk it with the real step
  if (d.leads === "interior" && d.room) {
    const r = d.room;
    const w = walkTo(world, out1.x, oy, out1.z, r.x, r.z, 0.35);
    if (!w.ok) add("door-into-wall", `a body cannot walk from the door to the room's floor (got ${w.closest.toFixed(2)} m short): the doorway is blocked, too narrow or not cut in the wall`);
    else {
      // the room: flood the floor at a fine cell and count it
      const f = floodFill(world, [{ x: r.x, z: r.z, y: w.y }], { cell: AUDIT.interiorCell, bounds: roomBounds(r), radius: CHARACTER.radius });
      let n = 0;
      for (let i = 0; i < f.state.length; i++) if (f.state[i] === 1 && insideRoom(r, f.x0 + (i % f.nx) * f.cell, f.z0 + Math.floor(i / f.nx) * f.cell)) n++;
      const area = n * AUDIT.interiorCell * AUDIT.interiorCell;
      if (area < AUDIT.interiorMinArea) add("interior-too-small", `only ${area.toFixed(1)} m2 of floor a body can stand on (< ${AUDIT.interiorMinArea} m2)`);
      if (!r.lit) add("interior-unlit", "the room has no lamp, window or skylight (the view must light every walkable interior)");
    }
  } else if (d.leads === "passage" && d.through) {
    const w = walkTo(world, out1.x, oy, out1.z, d.through.x, d.through.z, 0.4);
    if (!w.ok) add("door-into-wall", `a body cannot walk through the arch (got ${w.closest.toFixed(2)} m short)`);
  } else if (d.leads === "sealed") {
    // a sealed door must really be shut: walking at it from the apron must NOT carry a body through the wall
    const inside = doorAxisPoint(d, -1.2);
    const w = walkTo(world, out1.x, oy, out1.z, inside.x, inside.z, 0.5);
    if (w.ok) add("sealed-door-passable", "declared sealed (the view paints it shut) but a body walks straight through it");
  }
  return out;
}

const roomBounds = (r: NonNullable<AuditDoor["room"]>): { x0: number; z0: number; x1: number; z1: number } => {
  const e = Math.hypot(r.hx, r.hz) + 0.5;
  return { x0: r.x - e, z0: r.z - e, x1: r.x + e, z1: r.z + e };
};
const insideRoom = (r: NonNullable<AuditDoor["room"]>, x: number, z: number): boolean => {
  const c = Math.cos(r.yaw);
  const s = Math.sin(r.yaw);
  return Math.abs((x - r.x) * c + (z - r.z) * s) <= r.hx && Math.abs(-(x - r.x) * s + (z - r.z) * c) <= r.hz;
};

/** Props inside a wall or any solid, in a doorway's apron, or standing on a path. */
export function checkProps(region: RegionId, world: CollisionWorld, props: readonly AuditProp[], doors: readonly AuditDoor[], routes: readonly AuditRoute[]): Finding[] {
  const out: Finding[] = [];
  const aprons = doors.map((d) => ({ d, a: doorApron(d) }));
  for (const p of props) {
    const y = standY(world, p.x, p.z);
    const q = { x: p.x, z: p.z };
    if (world.resolveXZ(q, y, p.r + AUDIT.propMargin * 0.5, 1.0) && Math.hypot(q.x - p.x, q.z - p.z) > 0.02) out.push({ kind: "prop-in-wall", severity: "error", region, subject: p.id, at: pt(p.x, p.z), detail: `overlaps a solid (pushed ${Math.hypot(q.x - p.x, q.z - p.z).toFixed(2)} m to clear)` });
    const circle: Obstacle = { kind: "circle", x: p.x, z: p.z, r: p.r + AUDIT.propMargin, y0: -1e3, y1: 1e3 };
    for (const { d, a } of aprons) if (penetration(circle, a) > 0) out.push({ kind: "prop-on-door-apron", severity: "error", region, subject: p.id, other: d.id, at: pt(p.x, p.z), detail: `stands in the apron of door "${d.id}"` });
    for (const r of routes) {
      const half = Math.max(r.minWidth ?? AUDIT.pathMin[r.class], 1.2) / 2;
      const d = distToPolyline(r.points, p.x, p.z);
      if (d < half * 0.6 + p.r) out.push({ kind: "prop-on-path", severity: "warn", region, subject: p.id, other: r.id, at: pt(p.x, p.z), detail: `${d.toFixed(2)} m from the centreline of ${r.class} "${r.id}"` });
    }
  }
  return out;
}

export function distToPolyline(pts: readonly { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return pts.length === 1 ? Math.hypot(x - pts[0]!.x, z - pts[0]!.z) : best;
}

/** Clear width of the passage across the direction (nx, nz) at (x, z): the span a body's sides fit between (its centre's travel plus the body's width). Capped near `cap`. */
export function clearWidth(world: CollisionWorld, x: number, z: number, nx: number, nz: number, cap = 8, step = 0.1, hint?: number): number {
  // `hint` is the height the walker stands at where the measurement starts: a deck or a bridge over a deep cut is a surface, and `standY` alone would measure the bed beneath it (D-038 fix: the route check passes it)
  const y = hint !== undefined ? world.groundHeight(x, z, hint) : standY(world, x, z);
  let total = 0;
  for (const sgn of [1, -1]) {
    let w = 0;
    while (w < cap / 2) {
      const px = x + nx * sgn * (w + step);
      const pz = z + nz * sgn * (w + step);
      if (!isOpen(world, px, pz, world.groundHeight(px, pz, y + CHARACTER.stepHeight))) break;
      w += step;
    }
    total += w;
  }
  return total + 2 * CHARACTER.radius; // the passage a body's SIDES see, not the range its centre can travel
}

/** Walks every route end to end with the real step (every segment), and measures its width every metre. */
export function checkRoute(region: RegionId, world: CollisionWorld, r: AuditRoute): Finding[] {
  const out: Finding[] = [];
  const need = Math.max(r.minWidth ?? AUDIT.pathMin[r.class], 1.2);
  let y: number | undefined;
  for (let i = 0; i + 1 < r.points.length; i++) {
    const a = r.points[i]!;
    const b = r.points[i + 1]!;
    const yStart = y;
    const w = walkTo(world, a.x, y, a.z, b.x, b.z, 0.5);
    if (!w.ok) {
      out.push({ kind: "route-blocked", severity: "error", region, subject: r.id, at: pt(a.x, a.z), detail: `segment ${i} (${a.x.toFixed(0)},${a.z.toFixed(0)} -> ${b.x.toFixed(0)},${b.z.toFixed(0)}) cannot be walked${w.fell ? " (a drop)" : `: stops ${w.closest.toFixed(1)} m short`}` });
      return out;
    }
    y = w.y;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / (len || 1);
    const nz = (b.x - a.x) / (len || 1);
    let worst = Infinity;
    let wx = a.x;
    let wz = a.z;
    for (let m = 0.5; m < len; m += 1) {
      const px = a.x + ((b.x - a.x) * m) / len;
      const pz = a.z + ((b.z - a.z) * m) / len;
      const cw = clearWidth(world, px, pz, nx, nz, Math.max(need * 2, 6), 0.1, yStart === undefined ? w.y : Math.min(yStart, w.y));
      if (cw < worst) {
        worst = cw;
        wx = px;
        wz = pz;
      }
    }
    if (worst < need - 0.1) out.push({ kind: "path-too-narrow", severity: "error", region, subject: r.id, at: pt(wx, wz), detail: `${r.class} is ${worst.toFixed(2)} m wide here (needs ${need} m)` });
  }
  return out;
}

/** Fewer reachable cells than this from the first spawn means the landing is a pocket, not a region (at the standard 1 m cell, 400 m2). */
export const MIN_REGION_CELLS = 400;

/**
 * A spawn is stuck when no body fits there, or it is not in the first spawn's walkable region (a sealed pocket), or the first spawn's region is only a
 * pocket (`MIN_REGION_CELLS`). `reach` must be the flood from the FIRST spawn (the landing), which `auditRegion` does.
 */
export function checkSpawns(region: RegionId, world: CollisionWorld, spawns: readonly { x: number; z: number }[], reach: Reach | undefined, minCells = MIN_REGION_CELLS): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  spawns.forEach((s, i) => {
    const key = `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const y = standY(world, s.x, s.z);
    if (!isOpen(world, s.x, s.z, y)) out.push({ kind: "stuck-spawn", severity: "error", region, subject: `spawn${i}`, at: pt(s.x, s.z), detail: "a body does not fit here (inside a wall, a prop or the water's edge)" });
    else if (reach && !reach.reached(s.x, s.z, 1.5)) out.push({ kind: "stuck-spawn", severity: "error", region, subject: `spawn${i}`, at: pt(s.x, s.z), detail: "a body fits but cannot walk to the first spawn's region (a sealed pocket)" });
    else if (reach && i === 0 && reach.visited < minCells) out.push({ kind: "stuck-spawn", severity: "error", region, subject: `spawn${i}`, at: pt(s.x, s.z), detail: `the landing's region is only ${reach.visited} cells (< ${minCells}): the party starts in a pocket` });
  });
  return out;
}

// ---- the audit ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Runs every check on a region. `reach` is flood-filled from the spawns (unless `options.skipFlood`); story points and door aprons must be in it.
 * `ms` is wall time of the CALLER's choosing (the audit reads no clock): pass `now` from the test if you want it recorded.
 */
export function auditRegion(input: RegionAuditInput, now: () => number = () => 0): AuditReport {
  const t0 = now();
  const { region, world } = input;
  const findings: Finding[] = [];
  findings.push(...footprintOverlaps(region, input.footprints, input.allowOverlap));
  let reach: Reach | undefined;
  if (!input.options?.skipFlood) reach = floodFill(world, input.spawns.slice(0, 1), { cell: input.options?.cell ?? AUDIT.cell, maxCells: input.options?.maxCells });
  findings.push(...checkSpawns(region, world, input.spawns, reach));
  for (const d of input.doors) findings.push(...checkDoor(d, { region, world, footprints: input.footprints, reach }));
  findings.push(...checkProps(region, world, input.props, input.doors, input.routes));
  for (const r of input.routes) findings.push(...checkRoute(region, world, r));
  let reached = 0;
  if (reach) {
    const first = input.spawns[0];
    for (const p of input.points) {
      const hit = reach.reached(p.x, p.z, 2.2);
      if (hit) {
        reached++;
        // a maze: the walked distance is more than detourWarn times the straight line from the first spawn
        if (first) {
          const straight = Math.hypot(p.x - first.x, p.z - first.z);
          const walked = reach.distanceTo(p.x, p.z, 2.2);
          if (straight > 20 && walked > straight * AUDIT.detourWarn) findings.push({ kind: "detour", severity: "warn", region, subject: p.id, at: pt(p.x, p.z), detail: `${walked.toFixed(0)} m to walk, ${straight.toFixed(0)} m as the crow flies (x${(walked / straight).toFixed(1)})` });
        }
      } else findings.push({ kind: "unreachable-point", severity: p.mustReach ? "error" : "warn", region, subject: p.id, at: pt(p.x, p.z), detail: "cannot be walked to from the landing" });
    }
  }
  return {
    region,
    seed: input.seed,
    findings,
    stats: { footprints: input.footprints.length, doors: input.doors.length, props: input.props.length, cellsVisited: reach?.visited ?? 0, pointsReached: reached, pointsTotal: input.points.length, ms: now() - t0 },
  };
}

// ---- rooms (the view and the audit read the same rectangles) -----------------------------------------------------------------------------------

/** A walkable interior's floor rectangle (world frame). The audit's `door.room` is one; the view uses `roomAt` to hide the roof and light the room while a player is inside it. */
export interface RoomRect {
  id: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
}

/** The room containing (x, z) (grown by `margin` metres), or undefined. Pure and cheap: call it once a frame for the local player. */
export function roomAt(rooms: readonly RoomRect[], x: number, z: number, margin = 0): RoomRect | undefined {
  for (const r of rooms) {
    const c = Math.cos(r.yaw);
    const s = Math.sin(r.yaw);
    if (Math.abs((x - r.x) * c + (z - r.z) * s) <= r.hx + margin && Math.abs(-(x - r.x) * s + (z - r.z) * c) <= r.hz + margin) return r;
  }
  return undefined;
}
