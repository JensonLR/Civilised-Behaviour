import { BoxGeometry, BufferAttribute, BufferGeometry, Group, HemisphereLight, SphereGeometry, type Material, type Mesh, type MeshToonMaterial, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { roomAt, saltmarketLevel, type RoomRect } from "@cb/shared";
import type { Lod } from "./flora.ts";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import { makeSolid } from "./toon.ts";
import type { WorldInkClass } from "@cb/procedural/three";

/**
 * ROOMS AND DOORS FOR EVERY REGION VIEW (D-038, docs/LEVEL_PLAN.md section 4): what a view needs to draw "the door you see is the door you walk through".
 *  - `interiorShell`: the hollow walls of an enterable building (a doorway of the declared width, warm inner faces, a floor, the frame, an open leaf, the landing and steps the collision has);
 *  - `sealedDoor`: a door that is SHUT (boards, a hasp and padlock, a chain, the Chamberlain's paper seal): no leaf, nothing you could imagine turning;
 *  - `tentFlap`: a tent's door, tied shut, with a bedroll or a boot outside;
 *  - `RoofSet`: the roofs of a region's interiors as ONE mesh (and one ink hull), each hidden by rewriting the index while the viewer stands in its room (the cutaway);
 *  - `doorGroups`: a `door:<id>` group per drawn door with `userData` that says what was drawn (the test reads it).
 * Frames: everything is in the building's own frame (local +x is the front, the door side), the base already set on the Kit.
 */

/**
 * The level plan's types as the client reaches them (`levelPlan.ts` is not in the shared package's index yet: the integrator adds `export * from "./levelPlan.ts"`, after which these two can be imported by
 * name; until then they are read off the region plan functions, which are exported).
 */
export type RegionLevel = ReturnType<typeof saltmarketLevel>;
export type LevelBuilding = RegionLevel["buildings"][number];

// ---- door marks ---------------------------------------------------------------------------------------------------------------------------------

export type DoorLeads = "interior" | "passage" | "sealed";
/** What the drawing code did for one door: filled by `interiorShell` / `sealedDoor`, turned into groups by `doorGroups`. */
export interface DoorMark {
  id: string;
  leads: DoorLeads;
  /** A leaf was drawn (an open door swung back): true for an `interior`, never for a `sealed` door or a passage. */
  leaf: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
}

/** One empty group per drawn door at its threshold (zero draw cost): `userData = { doorId, leads, leaf }`. */
export function doorGroups(parent: Object3D, marks: readonly DoorMark[]): Group[] {
  return marks.map((m) => {
    const g = new Group();
    g.name = `door:${m.id}`;
    g.position.set(m.x, m.y, m.z);
    g.rotation.y = -m.yaw;
    g.userData = { doorId: m.id, leads: m.leads, leaf: m.leaf, width: m.width };
    parent.add(g);
    return g;
  });
}

// ---- drawing ------------------------------------------------------------------------------------------------------------------------------------

export interface ShellStyle {
  /** Outer wall: a palette colour or a colour function (it is given the face normal, so the inner face can differ). */
  outer: number | ColourFn;
  /** Inner faces: warm lime-wash, plank or matting: never `INTERIOR` black. */
  inner: number;
  floor: number;
  floorDark: number;
  trim: number;
  leaf: number;
  strap: number;
  /** A warm lamp colour (the glass of the lantern hung inside). */
  lamp: number;
  /** The colour of the underside of the roof: warm wood or plaster. */
  ceiling: number;
}

const bx = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true, perFace: typeof colour !== "number" });
};

/** A colour function that paints the face looking toward `inward` (a unit vector in the frame's x/z) with `inner` and every other face with `outer`. */
function twoSided(outer: number | ColourFn, inner: number, inward: readonly [number, number]): ColourFn {
  return (p, n, out) => {
    if (n.x * inward[0] + n.z * inward[1] > 0.55) out.set(inner);
    else if (typeof outer === "number") out.set(outer);
    else outer(p, n, out);
  };
}

export interface ShellSpec {
  id: string;
  /** Outer half extents, floor top and wall height above the building's ground, door clear width and height, steps up to the floor. */
  hx: number;
  hz: number;
  floor: number;
  wallH: number;
  door: number;
  doorH: number;
  steps: number;
  /** Wall thickness (the collision's). */
  t: number;
}

/**
 * The hollow walls of an enterable building, its floor, the doorway's frame and an open leaf, the front landing and steps, and a hung lantern: drawn in the frame of a base the caller set at
 * (x, ground, z, yaw). The floor top is `floor` above the base. `marks` receives the door. The roof is NOT drawn here (it is the region's own, into the `RoofSet`).
 */
export function interiorShell(k: Kit, s: ShellSpec, st: ShellStyle, lod: Lod, marks: DoorMark[], at: { x: number; y: number; z: number; yaw: number }): { lamp: V3 } {
  const { hx, hz, t, floor, wallH, door, doorH } = s;
  const y0 = floor;
  const y1 = floor + wallH;
  const wall = (lx: number, lz: number, ex: number, ez: number, inward: readonly [number, number], ya = y0, yb = y1): void => {
    bx(k, [ex * 2, yb - ya, ez * 2], [lx, (ya + yb) / 2, lz], twoSided(st.outer, st.inner, inward));
  };
  // the floor slab: planks inside, the outer edge in the wall colour
  k.add(new BoxGeometry(hx * 2, floor + 0.5, hz * 2), {
    at: [0, (floor - 0.5) / 2, 0],
    colour: (p, n, out) => {
      if (n.y > 0.6) blend(out, st.floor, st.floorDark, (Math.floor(p.z * 3.3) & 1) * 0.4 + 0.05);
      else if (typeof st.outer === "number") out.set(st.floorDark);
      else st.outer(p, n, out);
    },
    flat: true,
    perFace: true,
  });
  wall(-hx + t / 2, 0, t / 2, hz, [1, 0]);
  wall(0, -hz + t / 2, hx, t / 2, [0, 1]);
  wall(0, hz - t / 2, hx, t / 2, [0, -1]);
  const side = (hz - door / 2) / 2;
  wall(hx - t / 2, -(door / 2 + side), t / 2, side, [-1, 0]);
  wall(hx - t / 2, door / 2 + side, t / 2, side, [-1, 0]);
  wall(hx - t / 2, 0, t / 2, door / 2, [-1, 0], y0 + doorH, y1);
  // the doorway: a frame, a header, and the leaf swung back against the inside of the wall
  for (const sz of [-1, 1]) bx(k, [t + 0.1, doorH, 0.12], [hx - t / 2, y0 + doorH / 2, sz * (door / 2 + 0.06)], st.trim);
  bx(k, [t + 0.14, 0.16, door + 0.36], [hx - t / 2, y0 + doorH + 0.08, 0], st.trim);
  const ang = 1.25;
  const lw = door * 0.95;
  const cx = hx - t - 0.04 - Math.sin(ang) * (lw / 2);
  const cz = door / 2 - 0.04 - Math.cos(ang) * (lw / 2);
  bx(k, [lw, doorH - 0.12, 0.06], [cx, y0 + (doorH - 0.12) / 2 + 0.02, cz], (p, _n, out) => blend(out, st.leaf, st.trim, 0.2 + 0.3 * (((Math.floor(p.x * 9) % 3) + 3) % 3) / 3), [0, ang, 0]);
  if (lod) for (const y of [0.4, doorH - 0.5]) bx(k, [lw * 0.94, 0.08, 0.07], [cx, y0 + y, cz], st.strap, [0, ang, 0]);
  // the landing and the steps down (the collision's): the landing is 1.0 deep at floor height, each tread 0.5 deep
  if (s.steps > 0 && floor > 0.3) {
    for (let i = 1; i <= s.steps; i++) {
      const top = (floor * (s.steps - i + 1)) / s.steps;
      const depth = i === 1 ? 1.0 : 0.5;
      const off = hx + (i === 1 ? 0.5 : 1.0 + (i - 2) * 0.5 + 0.25);
      bx(k, [depth, 0.1, Math.max(door + 1.0, 2.2)], [off, top - 0.05, 0], i === 1 ? st.floor : st.floorDark);
      if (lod) for (const sz of [-1, 1]) bx(k, [depth, top + 0.3, 0.08], [off, (top - 0.3) / 2, sz * (Math.max(door + 1.0, 2.2) / 2 - 0.04)], st.trim);
    }
  }
  // a lantern hung inside, a hand off the ceiling: its glass is the warm point the view lights at dusk
  const lampAt: V3 = [-hx * 0.15, y0 + Math.min(wallH - 0.5, 2.3), 0];
  k.limb([lampAt[0], y1 - 0.05, lampAt[2]], [lampAt[0], lampAt[1] + 0.2, lampAt[2]], 0.012, 0.012, st.strap, 3);
  k.add(new SphereGeometry(0.13, 6, 4), { at: lampAt, colour: st.lamp });
  const m = k.worldPoint(hx, y0, 0);
  marks.push({ id: `${s.id}.door`, leads: "interior", leaf: true, x: m[0], y: m[1], z: m[2], yaw: at.yaw, width: door });
  const lw2 = k.worldPoint(lampAt[0], lampAt[1], lampAt[2]);
  return { lamp: lw2 as unknown as V3 };
}

export interface SealedStyle {
  frame: number;
  door: number;
  board: number;
  boardDark: number;
  iron: number;
  brass: number;
  paper: number;
  wax: number;
}

/**
 * A door that is SHUT, in the frame of a building whose front (+x) face is at `hx`: the door slab sunk in its frame, planks nailed across it (three level, two crossed), a hasp and a padlock, a chain
 * slung between two staples, and a paper seal with a blob of wax. No handle, no leaf, no lit window, no worn path. The notice is the cloth mesh's plaque. `marks` receives the door (`leaf: false`) at `threshold`
 * (default `hx`: the wall's outer face).
 */
export function sealedDoor(k: Kit, id: string, hx: number, floor: number, width: number, height: number, st: SealedStyle, lod: Lod, marks: DoorMark[], at: { x: number; y: number; z: number; yaw: number }, threshold = hx): void {
  const y0 = floor;
  const w = width;
  bx(k, [0.12, height, w], [hx + 0.02, y0 + height / 2, 0], st.door);
  for (const sz of [-1, 1]) bx(k, [0.2, height + 0.1, 0.14], [hx + 0.05, y0 + height / 2, sz * (w / 2 + 0.07)], st.frame);
  bx(k, [0.22, 0.18, w + 0.4], [hx + 0.05, y0 + height + 0.09, 0], st.frame);
  // planks across: three level, two crossed
  for (const y of [0.35, height * 0.5, height - 0.4]) bx(k, [0.07, 0.2, w + 0.36], [hx + 0.1, y0 + y, 0], (p, _n, out) => blend(out, st.board, st.boardDark, ((Math.floor(p.z * 4) % 2) + 2) % 2 * 0.5));
  const ang = Math.atan2(height - 0.8, w);
  const dl = Math.hypot(w, height - 0.8) + 0.2;
  for (const s of [-1, 1]) bx(k, [0.07, dl, 0.17], [hx + 0.15, y0 + height / 2, 0], st.board, [s * (Math.PI / 2 - ang), 0, 0]);
  if (lod) {
    // nail heads at the crossings
    for (const sz of [-1, 1]) for (const y of [0.35, height - 0.4]) k.add(new SphereGeometry(0.035, 4, 3), { at: [hx + 0.15, y0 + y, sz * (w / 2 - 0.1)], colour: st.iron });
    // a hasp and a padlock
    bx(k, [0.06, 0.34, 0.12], [hx + 0.16, y0 + height * 0.5 - 0.18, w * 0.18], st.iron);
    bx(k, [0.1, 0.16, 0.12], [hx + 0.19, y0 + height * 0.5 - 0.42, w * 0.18], st.brass);
    // the chain: two sagging runs between staples
    for (const [a, b] of [[-w / 2 - 0.1, 0.0], [0.0, w / 2 + 0.1]] as const) {
      k.limb([hx + 0.2, y0 + height * 0.5 + 0.45, a], [hx + 0.22, y0 + height * 0.5 + 0.25, (a + b) / 2], 0.018, 0.018, st.iron, 3);
      k.limb([hx + 0.22, y0 + height * 0.5 + 0.25, (a + b) / 2], [hx + 0.2, y0 + height * 0.5 + 0.45, b], 0.018, 0.018, st.iron, 3);
    }
    // the paper seal: a cream sheet and a red blob, tacked over the crossed planks
    bx(k, [0.03, 0.5, 0.38], [hx + 0.2, y0 + height * 0.5 + 0.7, -w * 0.22], st.paper, [0.1, 0, 0]);
    k.add(new SphereGeometry(0.06, 5, 4), { at: [hx + 0.23, y0 + height * 0.5 + 0.55, -w * 0.22], colour: st.wax });
  }
  const m = k.worldPoint(threshold, y0, 0);   // (the door's threshold is on the collision's wall face; a portcullis may stand proud of it)
  marks.push({ id, leads: "sealed", leaf: false, x: m[0], y: m[1], z: m[2], yaw: at.yaw, width });
}

export interface TentFlapStyle {
  canvas: number;
  canvasDark: number;
  rope: number;
  roll: number;
  boot: number;
}

/**
 * A tent's door TIED SHUT, on the front (+x) end of a ridge tent whose end is at `hx`: a canvas panel across the opening, two ties, a bedroll against the wall and, on alternate tents, a boot. Nobody walks in:
 * the tent is a small solid box.
 */
export function tentFlap(k: Kit, hx: number, doorH: number, w: number, st: TentFlapStyle, seed: number): void {
  bx(k, [0.05, doorH, w], [hx + 0.02, doorH / 2, 0], (p, _n, out) => blend(out, st.canvas, st.canvasDark, 0.2 + 0.3 * (((Math.floor(p.z * 5) % 2) + 2) % 2)));
  for (const y of [doorH * 0.3, doorH * 0.65]) {
    k.limb([hx + 0.06, y, -w * 0.28], [hx + 0.12, y - 0.04, w * 0.28], 0.016, 0.016, st.rope, 3);
    bx(k, [0.05, 0.1, 0.1], [hx + 0.1, y - 0.04, 0], st.rope);
  }
  // a bedroll leaning by the door and (some) a boot beside it
  k.limb([hx + 0.35, 0.05, w * 0.4], [hx + 0.35, 0.05, w * 0.4 + 0.8], 0.14, 0.14, st.roll, 6, true);
  if (seed % 2 === 0) bx(k, [0.16, 0.2, 0.3], [hx + 0.5, 0.1, -w * 0.3], st.boot, [0, 0.4, 0]);
}

// ---- the cutaway --------------------------------------------------------------------------------------------------------------------------------

/** One roof's triangles inside a merged geometry: `first` triangle and `count` triangles. */
export type TriRanges = Readonly<Record<string, readonly [first: number, count: number]>>;

/** A geometry made of several roofs plus where each one is (triangles): what a builder hands the `RoofSet`. */
export interface RoofSource {
  geometry: BufferGeometry;
  ranges: TriRanges;
}

/**
 * Builds a `RoofSource` from per-roof geometries (non-indexed, in order): merged into one, with the triangle ranges recorded. Undefined when there is nothing.
 */
export function mergeRoofs(parts: readonly { id: string; geometry: BufferGeometry }[]): RoofSource | undefined {
  const list = parts.filter((p) => p.geometry.attributes.position!.count > 0);
  if (list.length === 0) return undefined;
  const ranges: Record<string, readonly [number, number]> = {};
  let first = 0;
  for (const p of list) {
    const n = p.geometry.attributes.position!.count / 3;
    ranges[p.id] = [first, n];
    first += n;
  }
  const merged = mergeGeometries(list.map((p) => p.geometry), false);
  if (!merged) return undefined;
  for (const p of list) p.geometry.dispose();
  return { geometry: merged, ranges };
}

class Cut {
  private readonly total: number;
  private readonly index: BufferAttribute;
  constructor(readonly geometry: BufferGeometry, private readonly ranges: TriRanges) {
    this.total = geometry.attributes.position!.count;
    const idx = new Uint32Array(this.total);
    for (let i = 0; i < this.total; i++) idx[i] = i;
    this.index = new BufferAttribute(idx, 1);
    geometry.setIndex(this.index);
    geometry.setDrawRange(0, this.total);
  }
  /** Draw everything except the roof `id` (or everything for undefined): the index is rewritten without that roof's triangles. */
  hide(id: string | undefined): void {
    const r = id === undefined ? undefined : this.ranges[id];
    const arr = this.index.array as Uint32Array;
    if (!r) {
      for (let i = 0; i < this.total; i++) arr[i] = i;
      this.geometry.setDrawRange(0, this.total);
    } else {
      const a = r[0] * 3;
      const b = (r[0] + r[1]) * 3;
      let n = 0;
      for (let i = 0; i < a; i++) arr[n++] = i;
      for (let i = b; i < this.total; i++) arr[n++] = i;
      this.geometry.setDrawRange(0, n);
    }
    this.index.needsUpdate = true;
  }
  get drawn(): number {
    return this.geometry.drawRange.count / 3;
  }
}

/**
 * The roofs of a region's interiors, as ONE mesh and one ink hull (so a region pays two meshes, not two per building): each roof is a range of triangles, and the roof over the room the viewer stands in
 * is dropped by rewriting the index buffer (a few thousand indices, only when the room changes). One empty `roof:<id>` group per roof mirrors the state (`visible`), for tests and tools.
 */
export class RoofSet {
  readonly meshes: Mesh[];
  readonly proxies = new Map<string, Group>();
  private readonly cuts: Cut[] = [];
  private current: string | undefined;

  constructor(parent: Object3D, main: RoofSource, hull: RoofSource | undefined, material: MeshToonMaterial, o: { name: string; ink?: WorldInkClass; outline?: boolean; wind?: "village" | "none"; /** A region's own ink material for the hull (Highmark's landmark ink). */ hullMaterial?: Material }) {
    this.cuts.push(new Cut(main.geometry, main.ranges));
    if (hull) this.cuts.push(new Cut(hull.geometry, hull.ranges));
    this.meshes = makeSolid(parent, main.geometry, material as Material as MeshToonMaterial, { name: o.name, outline: o.outline === true && hull !== undefined, ink: o.ink, hullGeometry: hull?.geometry, castShadow: true, wind: o.wind === "village" ? "village" : undefined });
    if (o.hullMaterial && this.meshes[1]) this.meshes[1].material = o.hullMaterial;
    for (const id of Object.keys(main.ranges)) {
      const g = new Group();
      g.name = `roof:${id}`;
      parent.add(g);
      this.proxies.set(id, g);
    }
  }

  get ids(): string[] {
    return [...this.proxies.keys()];
  }
  /** The roof now dropped, if any. */
  get hidden(): string | undefined {
    return this.current;
  }
  /** Triangles of the main roof mesh that are drawn now. */
  get drawnTriangles(): number {
    return this.cuts[0]!.drawn;
  }

  hide(id: string | undefined): void {
    if (id === this.current) return;
    this.current = id;
    for (const c of this.cuts) c.hide(id);
    for (const [k, g] of this.proxies) g.visible = k !== id;
  }

  /** Once a frame for the local player: the roof of the room (grown by 0.3 m) the viewer is in is dropped; every other roof stays. */
  setViewer(rooms: readonly RoomRect[], x: number, z: number): string | undefined {
    const r = roomAt(rooms, x, z, 0.3);
    this.hide(r && this.proxies.has(r.id) ? r.id : undefined);
    return this.current;
  }

  /** Geometry ownership: the caller disposes it (the main geometry and the hull). */
  get geometries(): BufferGeometry[] {
    return this.cuts.map((c) => c.geometry);
  }
}

/** A Kit per roof, in order: `begin(id)` returns the kit to draw that roof into; `finish()` merges them into a `RoofSource`. */
export class RoofKits {
  private readonly parts: { id: string; kit: Kit }[] = [];
  begin(id: string, opts: { sway?: boolean } = {}): Kit {
    const kit = new Kit(opts);
    this.parts.push({ id, kit });
    return kit;
  }
  finish(): RoofSource | undefined {
    const geos: { id: string; geometry: BufferGeometry }[] = [];
    for (const p of this.parts) {
      const g = p.kit.build();
      if (g) geos.push({ id: p.id, geometry: g });
    }
    return mergeRoofs(geos);
  }
}

// ---- the room's own light -----------------------------------------------------------------------------------------------------------------------

/**
 * The warm light of a room the viewer stands in. With the roof lifted, a narrow room's inner faces are in the walls' own shadow and lit by the sky's hemisphere alone, which at a toon ramp's floor reads
 * as near-black (a records room and a customs house were unreadable in the stills: D-038 follow-up). Every region that has walkable interiors adds ONE of these: a hemisphere light in the region's own
 * lamp and lime-wash colours, at intensity 0 outside a room and eased up to `peak` inside one (the light is always in the scene, so the shaders never recompile when the viewer walks in). Eased, never
 * snapped; `update` takes the world clock the views already get. Presentation only: it moves no collision and no server state.
 */
export class InteriorFill {
  readonly light: HemisphereLight;
  private k = 0;
  private target = 0;
  private last = Number.NaN;

  /** `sky` is the colour of the light from above (the lime-wash the lamp throws on a wall), `ground` the bounce from the floor; both PALETTE colours of the region. */
  constructor(parent: Object3D, sky: number, ground: number, private readonly peak: number) {
    this.light = new HemisphereLight(sky, ground, 0);
    this.light.name = "interior-fill";
    parent.add(this.light);
  }

  /** Once a frame (from `setViewer`): whether the viewer is inside a room now. */
  setInside(inside: boolean): void {
    this.target = inside ? 1 : 0;
  }

  /** 0..1: how far the fill has come up. */
  get amount(): number {
    return this.k;
  }

  /** Eases toward the target (about a third of a second) and sets the light. `t` is a clock in seconds. */
  update(t: number): void {
    const dt = Number.isNaN(this.last) ? 1 : Math.min(0.25, Math.max(0, t - this.last));
    this.last = t;
    this.k += (this.target - this.k) * (1 - Math.exp(-8 * dt));
    if (Math.abs(this.target - this.k) < 0.002) this.k = this.target;
    this.light.intensity = this.peak * this.k;
  }
}
