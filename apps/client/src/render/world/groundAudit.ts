import { BufferGeometry, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from "three";
import type { Terrain } from "@cb/shared";

/**
 * The grounding audit (test tooling, not shipped code): nothing in a built region may hang in the air unless it is meant to.
 *
 * Every scenery mesh (each instance of an instanced one) is split into its CONNECTED PIECES (triangles that share a vertex position). A piece is
 * GROUNDED when one of its vertices is at or under the terrain; it is SUPPORTED when it touches (boxes within a few millimetres) a
 * piece that is grounded or supported. A piece's box turns with it (its yaw is its edges' dominant direction): a turned building's walls in axis-aligned
 * bounds swell to cover the whole room, and a chimney hanging over the room "touched" them. Whatever is left is floating: a lantern with no post, a roof with no walls, a plank in the air.
 * The ground meshes (`GROUND_MESHES`: the terrain, its skirt, the hills, the horizon, the water) are the ground and are not audited.
 */
export interface Floater {
  /** The mesh's path of names from the view's root (or its geometry's name), to find it in the code. */
  label: string;
  /** Instance index of an instanced mesh (-1 for a plain mesh). */
  instance: number;
  centre: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  /** Height of the piece's lowest point above the ground beneath it. */
  gap: number;
  triangles: number;
  /** The nearest supported piece and the gap to it (bounding boxes), to see what it should have rested on. */
  near: { label: string; gap: number; centre: { x: number; y: number; z: number } } | null;
}

interface Piece {
  min: Vector3;
  max: Vector3;
  /** The piece's footprint as a box at its own yaw: the cos and sin of the yaw, the centre (x, z) and the half extents along its axes. */
  c: number;
  s: number;
  cx: number;
  cz: number;
  hu: number;
  hv: number;
  grounded: boolean;
  supported: boolean;
  label: string;
  instance: number;
  triangles: number;
  gap: number;
}

/** The meshes that are the ground itself (by name): the terrain, its skirt, the hills, the horizon, the water. */
export const GROUND_MESHES: ReadonlySet<string> = new Set(["terrain", "skirt", "hills", "horizon", "water"]);
const TOUCH = 0.03; // metres: pieces this close count as touching
const ON_GROUND = 0.06; // metres above the terrain that still counts as standing on it
const BURY = 8; // metres under a drawn surface that still counts as standing in it, not under it (a big tree on a steep hillside sinks its uphill side deep)

function labelOf(o: Object3D, root: Object3D): string {
  const names: string[] = [];
  for (let p: Object3D | null = o; p && p !== root; p = p.parent) if (p.name) names.push(p.name);
  const geo = (o as Mesh).geometry as BufferGeometry | undefined;
  return (names.reverse().join("/") || "(unnamed)") + (geo?.name ? `[${geo.name}]` : "");
}

/** A piece's footprint as a box at its own yaw (its edges' dominant direction in plan), from its world vertices (x, y, z, x, y, z, ... three per triangle). */
export function orientedBox(w: Float64Array): { c: number; s: number; cx: number; cz: number; hu: number; hv: number } {
  // the yaw: the length-weighted mean of its edges' directions in plan, modulo a right angle (as 4 x the angle); a round piece has none and keeps 0
  let sc = 0, ss = 0;
  for (let t = 0; t + 2 < w.length / 3; t += 3) for (let e = 0; e < 3; e++) {
    const a = (t + e) * 3, b = (t + ((e + 1) % 3)) * 3;
    const dx = w[b]! - w[a]!, dz = w[b + 2]! - w[a + 2]!;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ang = 4 * Math.atan2(dz, dx);
    sc += len * Math.cos(ang);
    ss += len * Math.sin(ang);
  }
  const yaw = Math.hypot(sc, ss) > 1e-6 ? Math.atan2(ss, sc) / 4 : 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let j = 0; j < w.length; j += 3) {
    const u = w[j]! * c + w[j + 2]! * s, vv = -w[j]! * s + w[j + 2]! * c;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (vv < v0) v0 = vv;
    if (vv > v1) v1 = vv;
  }
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  return { c, s, cx: uc * c - vc * s, cz: uc * s + vc * c, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2 };
}

/** Connected components of a geometry's triangles: for each component, its vertex indices. */
export function geometryPieces(geo: BufferGeometry): { verts: number[]; triangles: number }[] {
  const pos = geo.getAttribute("position");
  const n = pos.count;
  // weld by position (1 mm): flat-shaded meshes repeat a corner once per face
  const weld = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    const w = seen.get(k);
    if (w === undefined) {
      seen.set(k, i);
      weld[i] = i;
    } else weld[i] = w;
  }
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]!]!;
    return a;
  };
  const union = (a: number, b: number): void => {
    const ra = find(weld[a]!), rb = find(weld[b]!);
    if (ra !== rb) parent[ra] = rb;
  };
  const index = geo.getIndex();
  const tri = index ? index.count / 3 : n / 3;
  const at = (t: number, c: number): number => (index ? index.getX(t * 3 + c) : t * 3 + c);
  for (let t = 0; t < tri; t++) {
    union(at(t, 0), at(t, 1));
    union(at(t, 1), at(t, 2));
  }
  const groups = new Map<number, { verts: number[]; triangles: number }>();
  for (let t = 0; t < tri; t++) {
    const r = find(weld[at(t, 0)]!);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = { verts: [], triangles: 0 }));
    g.triangles++;
    for (let c = 0; c < 3; c++) g.verts.push(at(t, c));
  }
  return [...groups.values()];
}

/**
 * The ground as drawn: every upward-facing triangle of the ground meshes, in a 2 m grid; true when a point stands on (or a little
 * into) one of them. (The drawn terrain is a triangulation of the analytic height, and the hills and the water are not in it.)
 */
function groundSurface(root: Object3D): (x: number, z: number, y: number) => boolean {
  const CELL = 2;
  const tris: number[] = []; // x0 y0 z0 x1 y1 z1 x2 y2 z2
  const grid = new Map<string, number[]>();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const im = new Matrix4(), wm = new Matrix4();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible || !GROUND_MESHES.has(mesh.name)) return;
    const geo = mesh.geometry as BufferGeometry;
    const pos = geo.getAttribute("position");
    if (!pos) return;
    const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      wm.copy(mesh.matrixWorld);
      if (inst) wm.multiply((inst.getMatrixAt(k, im), im));
      const index = geo.getIndex();
      const n = index ? index.count / 3 : pos.count / 3;
      for (let t = 0; t < n; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3, i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1, i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(wm);
        b.fromBufferAttribute(pos, i1).applyMatrix4(wm);
        c.fromBufferAttribute(pos, i2).applyMatrix4(wm);
        // upward-facing in either winding (double-sided skirts): the triangle's normal is mostly vertical
        const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (Math.abs(ny) < 0.2 * Math.hypot(nx, ny, nz)) continue;
        const id = tris.length / 9;
        tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        for (let gx = Math.floor(Math.min(a.x, b.x, c.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x, c.x) / CELL); gx++)
          for (let gz = Math.floor(Math.min(a.z, b.z, c.z) / CELL); gz <= Math.floor(Math.max(a.z, b.z, c.z) / CELL); gz++) {
            const key = `${gx},${gz}`;
            let l = grid.get(key);
            if (!l) grid.set(key, (l = []));
            l.push(id);
          }
      }
    }
  });
  return (x, z, vy) => {
    for (const id of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const o = id * 9;
      const x0 = tris[o]!, y0 = tris[o + 1]!, z0 = tris[o + 2]!, x1 = tris[o + 3]!, y1 = tris[o + 4]!, z1 = tris[o + 5]!, x2 = tris[o + 6]!, y2 = tris[o + 7]!, z2 = tris[o + 8]!;
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(d) < 1e-12) continue;
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
      const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      const y = l0 * y0 + l1 * y1 + l2 * y2;
      if (vy <= y + ON_GROUND && vy >= y - BURY) return true;
    }
    return false;
  };
}

/** Finds every floating piece under `root`. `skip` drops meshes by label (things that fly, hang from the sky or drift by design). */
export function floatingPieces(root: Object3D, terrain: Terrain, skip: (label: string, mesh: Mesh) => boolean = () => false): Floater[] {
  root.updateMatrixWorld(true);
  const ground = groundSurface(root);
  const pieces: Piece[] = [];
  const v = new Vector3();
  const im = new Matrix4();
  const wm = new Matrix4();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const geo = mesh.geometry as BufferGeometry;
    if (!geo.getAttribute("position")) return;
    const label = labelOf(o, root);
    if (GROUND_MESHES.has(mesh.name) || mesh.name.endsWith("_outline") || skip(label, mesh)) return; // (an ink hull repeats its solid)
    const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
    const count = inst ? inst.count : 1;
    const parts = geometryPieces(geo);
    const pos = geo.getAttribute("position");
    for (let k = 0; k < count; k++) {
      wm.copy(mesh.matrixWorld);
      if (inst) {
        inst.getMatrixAt(k, im);
        if (Math.abs(im.determinant()) < 1e-9) continue; // a hidden (zero-scale) instance
        wm.multiply(im);
      }
      for (const part of parts) {
        const min = new Vector3(Infinity, Infinity, Infinity);
        const max = new Vector3(-Infinity, -Infinity, -Infinity);
        let grounded = false;
        let gap = Infinity;
        const w = new Float64Array(part.verts.length * 3);
        part.verts.forEach((i, j) => {
          v.fromBufferAttribute(pos, i).applyMatrix4(wm);
          w[j * 3] = v.x;
          w[j * 3 + 1] = v.y;
          w[j * 3 + 2] = v.z;
          min.min(v);
          max.max(v);
          const above = v.y - terrain.height(v.x, v.z);
          if (above < gap) gap = above;
          if (above <= ON_GROUND || ground(v.x, v.z, v.y)) grounded = true;
        });
        const ob = orientedBox(w);
        pieces.push({ min, max, ...ob, grounded, supported: grounded, label, instance: inst ? k : -1, triangles: part.triangles, gap });
      }
    }
  });
  // spread support from the ground through touching pieces (a 4 m grid of cells keeps it near linear)
  const CELL = 4;
  const grid = new Map<string, number[]>();
  const cells = (p: Piece, f: (key: string) => void): void => {
    for (let x = Math.floor((p.min.x - TOUCH) / CELL); x <= Math.floor((p.max.x + TOUCH) / CELL); x++)
      for (let z = Math.floor((p.min.z - TOUCH) / CELL); z <= Math.floor((p.max.z + TOUCH) / CELL); z++) f(`${x},${z}`);
  };
  pieces.forEach((p, i) => cells(p, (key) => {
    let l = grid.get(key);
    if (!l) grid.set(key, (l = []));
    l.push(i);
  }));
  // (the half width of a piece's footprint along the plan direction (nx, nz))
  const reach = (p: Piece, nx: number, nz: number): number => p.hu * Math.abs(p.c * nx + p.s * nz) + p.hv * Math.abs(-p.s * nx + p.c * nz);
  // the two footprints overlap (or come within TOUCH) on every axis of either box: the separating axis test, in plan
  const footprintsTouch = (a: Piece, b: Piece): boolean => {
    for (const p of [a, b]) for (const [nx, nz] of [[p.c, p.s], [-p.s, p.c]] as const) {
      const d = Math.abs((b.cx - a.cx) * nx + (b.cz - a.cz) * nz);
      if (d > reach(a, nx, nz) + reach(b, nx, nz) + TOUCH) return false;
    }
    return true;
  };
  const touch = (a: Piece, b: Piece): boolean =>
    a.min.x <= b.max.x + TOUCH && b.min.x <= a.max.x + TOUCH && a.min.y <= b.max.y + TOUCH && b.min.y <= a.max.y + TOUCH && a.min.z <= b.max.z + TOUCH && b.min.z <= a.max.z + TOUCH && footprintsTouch(a, b);
  const queue: number[] = [];
  pieces.forEach((p, i) => p.supported && queue.push(i));
  while (queue.length > 0) {
    const a = pieces[queue.pop()!]!;
    cells(a, (key) => {
      for (const j of grid.get(key) ?? []) {
        const b = pieces[j]!;
        if (!b.supported && touch(a, b)) {
          b.supported = true;
          queue.push(j);
        }
      }
    });
  }
  const boxGap = (a: Piece, b: Piece): number => {
    const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y), dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
    return Math.hypot(dx, dy, dz);
  };
  const nearest = (p: Piece): Floater["near"] => {
    let best: Piece | null = null, bg = Infinity;
    for (const q of pieces) {
      if (!q.supported) continue;
      if (Math.abs((q.min.x + q.max.x) / 2 - (p.min.x + p.max.x) / 2) > 30 || Math.abs((q.min.z + q.max.z) / 2 - (p.min.z + p.max.z) / 2) > 30) continue;
      const d = boxGap(p, q);
      if (d < bg) (bg = d), (best = q);
    }
    return best ? { label: best.label, gap: bg, centre: { x: (best.min.x + best.max.x) / 2, y: (best.min.y + best.max.y) / 2, z: (best.min.z + best.max.z) / 2 } } : null;
  };
  return pieces
    .filter((p) => !p.supported)
    .map((p) => ({
      near: nearest(p),
      label: p.label,
      instance: p.instance,
      centre: { x: (p.min.x + p.max.x) / 2, y: (p.min.y + p.max.y) / 2, z: (p.min.z + p.max.z) / 2 },
      size: { x: p.max.x - p.min.x, y: p.max.y - p.min.y, z: p.max.z - p.min.z },
      gap: p.gap,
      triangles: p.triangles,
    }));
}
