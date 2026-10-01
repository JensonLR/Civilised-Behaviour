import type { Obstacle } from "./collision.ts";
import type { AuditDoor, RoomRect } from "./levelAudit.ts";

/**
 * THE LEVEL PLAN'S BUILDING LAYER (D-038, docs/LEVEL_PLAN.md section 4). One declaration per building, read by the collision world, the view and the audit, so
 * "the door you see is the door you walk through" cannot drift: a region lists its `LevelBuilding`s (id, kind, footprint, door) and gets walls with a doorway,
 * a floor, a roof rectangle for the cutaway, and the `AuditDoor`/`RoomRect` the audit reads. Pure data and pure functions: no clock, no Math.random.
 *
 * Frame: a building's local +x is its FRONT (the door side), local +z to its right. World = (x + lx*cos - lz*sin, z + lx*sin + lz*cos) for its collision yaw. The door's
 * outward direction is therefore (cos yaw, sin yaw): `AuditDoor.yaw === building.yaw`.
 */

/** The kinds a building can be (LEVEL_PLAN section 4; `passage` is a gate you walk through, declared by the region that has one). */
export type LevelKind = "interior" | "passage" | "open-front" | "sealed" | "solid" | "tent";

export interface LevelBuilding {
  /** Plan id and audit group (a building's wall boxes all share it). */
  id: string;
  kind: LevelKind;
  /** Centre, collision yaw of the front (+x) and the OUTER half extents. */
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
  /** Highest point above the ground (the ridge or the tower's top): the view stays inside it. */
  height: number;
  /** Floor top above the ground (a plinth or a stilt deck); walls rise `wallH` above it. */
  floor: number;
  wallH: number;
  /** Clear width of the door (0 = none). `sealed` and `interior` buildings have one; `solid`, `tent` and `open-front` do not. */
  door: number;
  doorH: number;
  /** Steps up from the ground to the floor (0 for a plinth the body walks onto). Their landing is 1.0 m deep. */
  steps: number;
  /** A sealed door's notice, in the facade's own voice. */
  sign?: string;
  /** A gate a wagon or a rider passes (the audit holds it to `AUDIT.gateMinWidth`). */
  wide?: boolean;
  /** Wall thickness (default `WALL_T`). */
  t?: number;
  /** The walkable floor, when it is not the footprint inside its walls (an open-front gallery's corridor). */
  rect?: { x: number; z: number; hx: number; hz: number };
}

export const WALL_T = 0.3;
export const DOOR_H = 2.4;
export const LANDING = 1.0;

/** Local -> world for a building's frame. */
export function frameToWorld(b: { x: number; z: number; yaw: number }, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c - lz * s, z: b.z + lx * s + lz * c };
}

/** The door's threshold on the outer face of the front wall, facing out. */
export function doorOf(b: LevelBuilding, leads: AuditDoor["leads"]): AuditDoor {
  const w = frameToWorld(b, b.hx, 0);
  const door: AuditDoor = { id: `${b.id}.door`, building: b.id, x: w.x, z: w.z, yaw: b.yaw, width: b.door, height: b.doorH, leads };
  if (b.wide) door.wide = true;
  if (leads === "interior") {
    const r = roomOf(b);
    door.room = { x: r.x, z: r.z, hx: r.hx, hz: r.hz, yaw: r.yaw, lit: true };
  }
  return door;
}

/** The walkable floor of an interior (inside the walls), world frame: what the audit enters and the cutaway tests. */
export function roomOf(b: LevelBuilding): RoomRect {
  if (b.rect) return { id: b.id, ...b.rect, yaw: b.yaw };
  const t = b.t ?? WALL_T;
  return { id: b.id, x: b.x, z: b.z, hx: b.hx - t, hz: b.hz - t, yaw: b.yaw };
}

/**
 * The solids of an enterable building: back and side walls, the front wall with a doorway `door` wide, a lintel over it, the floor slab, and (when the floor is above
 * 0.3 m) the front steps and a landing. `g` is the terrain height at the building (a pad: the floor never sits on a slope). Walls run to the eave
 * (`floor + wallH`); the roof is the view's.
 */
export function roomObstacles(b: LevelBuilding, g: number, tag: "house" | "stall" = "house"): Obstacle[] {
  const out: Obstacle[] = [];
  const t = b.t ?? WALL_T;
  const y0 = g - 1;
  const yTop = g + b.floor + b.wallH;
  const box = (lx: number, lz: number, ex: number, ez: number, lo: number, hi: number, tg: "house" | "stall" = tag): void => {
    const w = frameToWorld(b, lx, lz);
    out.push({ kind: "box", tag: tg, x: w.x, z: w.z, hx: ex, hz: ez, yaw: b.yaw, y0: lo, y1: hi });
  };
  // the floor slab: a plinth or a deck, walked onto
  box(0, 0, b.hx, b.hz, y0, g + b.floor);
  box(-b.hx + t / 2, 0, t / 2, b.hz, y0, yTop);
  box(0, -b.hz + t / 2, b.hx, t / 2, y0, yTop);
  box(0, b.hz - t / 2, b.hx, t / 2, y0, yTop);
  if (b.door <= 0) box(b.hx - t / 2, 0, t / 2, b.hz, y0, yTop);
  else {
    const side = (b.hz - b.door / 2) / 2;
    box(b.hx - t / 2, -(b.door / 2 + side), t / 2, side, y0, yTop);
    box(b.hx - t / 2, b.door / 2 + side, t / 2, side, y0, yTop);
    // the lintel: the wall closes over the doorway above its clear height (a header you could not jump through anyway)
    box(b.hx - t / 2, 0, t / 2, b.door / 2, g + b.floor + b.doorH, yTop);
  }
  // front steps: each rise at most 0.35; the last is the landing at floor level
  if (b.steps > 0 && b.floor > 0.3) {
    const n = b.steps;
    for (let i = 1; i <= n; i++) {
      const top = (b.floor * (n - i + 1)) / n;   // nearest the door is highest
      const depth = i === 1 ? LANDING : 0.5;
      const off = b.hx + (i === 1 ? LANDING / 2 : LANDING + (i - 2) * 0.5 + 0.25);
      box(off, 0, depth / 2, Math.max(b.door / 2 + 0.5, 1.1), y0, g + top, tag);
    }
  }
  return out;
}

/** The floor-plan extent of everything the building puts on the ground (walls, steps and landing): the footprint a neighbour must stay clear of. */
export function reachOf(b: LevelBuilding): { front: number } {
  return { front: b.steps > 0 && b.floor > 0.3 ? LANDING + (b.steps - 1) * 0.5 : 0 };
}

/** What a region declares: every building with its kind, and (derived) the doors and rooms the audit and the view read. */
export interface RegionLevel {
  buildings: LevelBuilding[];
  /** One per `interior`, `sealed` and `passage` building (the audit's `AuditDoor`s). */
  doors: AuditDoor[];
  /** One per `interior` (the cutaway's and the lamp's rectangle). */
  rooms: RoomRect[];
}

/** Derives the doors and rooms from the buildings. A `passage` building brings its own door (its `through` point is the region's to give). */
export function levelOf(buildings: LevelBuilding[], passages: AuditDoor[] = []): RegionLevel {
  const doors: AuditDoor[] = [];
  const rooms: RoomRect[] = [];
  for (const b of buildings) {
    if (b.kind === "interior") {
      doors.push(doorOf(b, "interior"));
      rooms.push(roomOf(b));
    } else if (b.kind === "open-front" && b.rect) rooms.push(roomOf(b));
    else if (b.kind === "sealed") doors.push(doorOf(b, "sealed"));
  }
  doors.push(...passages);
  return { buildings, doors, rooms };
}

/** A building record with the usual defaults (a 1.5 m door 2.4 m high, no steps). */
export function planBuilding(id: string, kind: LevelKind, at: { x: number; z: number; yaw: number; hx: number; hz: number }, o: Partial<LevelBuilding> & { height: number }): LevelBuilding {
  const hasDoor = kind === "interior" || kind === "sealed";
  return { id, kind, ...at, floor: 0, wallH: o.height, door: hasDoor ? 1.5 : 0, doorH: DOOR_H, steps: 0, ...o };
}

/** True when (x, z) lies in a door's apron (1.6 m deep, the door's width plus 0.3 each side), grown by `pad`: spawned props and scatter keep out of it. */
export function inDoorApron(doors: readonly { x: number; z: number; yaw: number; width: number }[], x: number, z: number, pad = 0.6): boolean {
  for (const d of doors) {
    const c = Math.cos(d.yaw);
    const s = Math.sin(d.yaw);
    const along = (x - d.x) * c + (z - d.z) * s;
    const across = -(x - d.x) * s + (z - d.z) * c;
    if (along > -pad && along < 1.6 + pad && Math.abs(across) < d.width / 2 + 0.3 + pad) return true;
  }
  return false;
}

/** Distance from (x, z) to the nearest segment of any polyline. */
export function distToPaths(paths: readonly (readonly { x: number; z: number }[])[], x: number, z: number): number {
  let best = Infinity;
  for (const pl of paths) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i]!;
      const b = pl[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d < best) best = d;
    }
  }
  return best;
}

/** Is the point inside the building's outer footprint grown by `m` (frame: local +x = front)? `front` extends the front by the steps and landing. */
export function insideBuilding(b: Pick<LevelBuilding, "x" | "z" | "yaw" | "hx" | "hz">, x: number, z: number, m: number, front = 0): boolean {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const lx = (x - b.x) * c + (z - b.z) * s;
  const lz = -(x - b.x) * s + (z - b.z) * c;
  return lx >= -b.hx - m && lx <= b.hx + m + front && Math.abs(lz) <= b.hz + m;
}

/** The id of the building whose walls, floor, steps or landing the point is part of (a building's solids all share one id), or undefined. */
export function buildingIdAt(level: RegionLevel, x: number, z: number, m = 0.5, front = 1.8): string | undefined {
  for (const b of level.buildings) if (insideBuilding(b, x, z, m, front)) return b.id;
  return undefined;
}

/**
 * The spread of terrain height under a building's footprint (the four corners, the four edge midpoints, the centre and the front steps' end), metres: a floor sits on a PAD, so this should be small (docs/LEVEL_PLAN.md
 * section 1; the permanent test holds every building to `PAD_MAX`). A building half in a cliff or on a bank has a large one.
 */
export function padSpread(terrainHeight: (x: number, z: number) => number, b: Pick<LevelBuilding, "x" | "z" | "yaw" | "hx" | "hz">, front = 0): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [fx, fz] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]] as const) {
    const p = frameToWorld(b, fx * b.hx, fz * b.hz);
    const h = terrainHeight(p.x, p.z);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  if (front > 0) {
    const p = frameToWorld(b, b.hx + front, 0);
    const h = terrainHeight(p.x, p.z);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return hi - lo;
}

/** The most terrain height a building's footprint may span (tents: `TENT_PAD_MAX`). */
export const PAD_MAX = 0.6;
export const TENT_PAD_MAX = 0.8;
