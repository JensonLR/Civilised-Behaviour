import { BufferGeometry, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from "three";
import { GROUND_MESHES, geometryPieces, orientedBox } from "./groundAudit.ts";

/**
 * The overlap audit (test tooling, not shipped code): no two placed things may pass through each other where it shows. A tree's crown through a roof, a bush
 * through a fence, a crate half inside a wall, a rock through a doorstep.
 *
 * Every mesh (each instance of an instanced one) is split into its connected pieces, each boxed at its own yaw (`orientedBox`, as the ground audit does). Two
 * pieces of DIFFERENT objects overlap when their boxes interpenetrate by more than a tolerance on every axis (the separating-axis depth: the least overlap over
 * the four plan axes and the vertical). An object is an instance of an instanced mesh, or a whole plain mesh: the pieces of one merged building are joined on
 * purpose (a beam is let into a wall), so a plain mesh is never tested against itself; the caller says which pairs of meshes are worth testing.
 */

export interface OverlapPiece {
  /** The mesh's name and, for an instanced mesh, the instance (-1 for a plain mesh). */
  mesh: string;
  instance: number;
  instanced: boolean;
  min: Vector3;
  max: Vector3;
  c: number;
  s: number;
  cx: number;
  cz: number;
  hu: number;
  hv: number;
  /** A round piece's radius in plan (a column, a tower, a trunk: its box's corners stand well outside it), else 0. */
  round: number;
  /** A round piece's vertices as (height, radius) pairs sorted by height, so a tower that flares at its cap is not as wide at its foot. */
  radial?: Float64Array;
  triangles: number;
}

export interface Overlap {
  a: OverlapPiece;
  b: OverlapPiece;
  /** How deep the two interpenetrate (m): the least overlap over every axis. */
  depth: number;
}

/** Meshes that are effects, light or ink, never objects: the ground's, the hulls, the glows, the weather, the fauna in flight. */
const NOT_OBJECTS = /(_outline$|^windows$|glow|^rain$|^motes$|^birds$|^water$|^sky|^lantern-glass$|^shafts?$|^smoke)/;

/** Every piece of every object under `root` (in world space). `keep(mesh)` narrows which meshes are objects. */
export function scenePieces(root: Object3D, keep: (mesh: Mesh) => boolean = () => true): OverlapPiece[] {
  root.updateMatrixWorld(true);
  const out: OverlapPiece[] = [];
  const v = new Vector3();
  const im = new Matrix4();
  const wm = new Matrix4();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible || GROUND_MESHES.has(mesh.name) || NOT_OBJECTS.test(mesh.name) || !keep(mesh)) return;
    const geo = mesh.geometry as BufferGeometry;
    const pos = geo.getAttribute("position");
    if (!pos) return;
    const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
    const parts = geometryPieces(geo);
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      wm.copy(mesh.matrixWorld);
      if (inst) {
        inst.getMatrixAt(k, im);
        if (Math.abs(im.determinant()) < 1e-9) continue;
        wm.multiply(im);
      }
      for (const part of parts) {
        const w = new Float64Array(part.verts.length * 3);
        const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
        part.verts.forEach((i, j) => {
          v.fromBufferAttribute(pos, i).applyMatrix4(wm);
          w[j * 3] = v.x;
          w[j * 3 + 1] = v.y;
          w[j * 3 + 2] = v.z;
          min.min(v);
          max.max(v);
        });
        const ob = orientedBox(w);
        // round in plan: every vertex within a circle not much wider than the box's half-size, the box near square (its corners would claim what the curve does not reach)
        let rr = 0;
        for (let j = 0; j < w.length; j += 3) rr = Math.max(rr, Math.hypot(w[j]! - ob.cx, w[j + 2]! - ob.cz));
        const hmax = Math.max(ob.hu, ob.hv), hmin = Math.min(ob.hu, ob.hv);
        const round = hmin > 0.05 && hmin / hmax > 0.8 && rr < 1.12 * hmax ? rr : 0;
        let radial: Float64Array | undefined;
        if (round > 0) {
          const pairs: [number, number][] = [];
          for (let j = 0; j < w.length; j += 3) pairs.push([w[j + 1]!, Math.hypot(w[j]! - ob.cx, w[j + 2]! - ob.cz)]);
          pairs.sort((p, q) => p[0] - q[0]);
          radial = new Float64Array(pairs.flat());
        }
        out.push({ mesh: mesh.name || "(unnamed)", instance: inst ? k : -1, instanced: !!inst, min, max, ...ob, round, radial, triangles: part.triangles });
      }
    }
  });
  return out;
}

/** The half width of a piece's footprint along the plan direction (nx, nz). */
const reach = (p: OverlapPiece, nx: number, nz: number): number => p.hu * Math.abs(p.c * nx + p.s * nz) + p.hv * Math.abs(-p.s * nx + p.c * nz);

/** Signed plan distance from (x, z) to a piece's box (negative inside). */
function boxDistance(p: OverlapPiece, x: number, z: number): number {
  const lx = Math.abs((x - p.cx) * p.c + (z - p.cz) * p.s) - p.hu;
  const lz = Math.abs(-(x - p.cx) * p.s + (z - p.cz) * p.c) - p.hv;
  return lx > 0 || lz > 0 ? Math.hypot(Math.max(0, lx), Math.max(0, lz)) : Math.max(lx, lz);
}

/** A round piece's radius between heights y0 and y1: its widest vertex there, or (between two rings) the wider of the rings either side. */
function radiusBetween(p: OverlapPiece, y0: number, y1: number): number {
  const r = p.radial;
  if (!r) return p.round;
  let inside = 0, below = 0, above = 0;
  for (let i = 0; i < r.length; i += 2) {
    const y = r[i]!, rad = r[i + 1]!;
    if (y < y0) below = rad; // (sorted by height: the last one below is the nearest)
    else if (y <= y1) inside = Math.max(inside, rad);
    else {
      above = rad; // (and the first one above)
      break;
    }
  }
  return inside > 0 ? inside : Math.max(below, above);
}

/** How deep two pieces interpenetrate (m; 0 or less: apart). */
export function overlapDepth(a: OverlapPiece, b: OverlapPiece): number {
  const y0 = Math.max(a.min.y, b.min.y), y1 = Math.min(a.max.y, b.max.y);
  let d = y1 - y0;
  if (d <= 0) return d;
  if (a.round > 0 && b.round > 0) return Math.min(d, radiusBetween(a, y0, y1) + radiusBetween(b, y0, y1) - Math.hypot(a.cx - b.cx, a.cz - b.cz));
  if (a.round > 0 || b.round > 0) {
    const c = a.round > 0 ? a : b, box = a.round > 0 ? b : a;
    return Math.min(d, radiusBetween(c, y0, y1) - boxDistance(box, c.cx, c.cz));
  }
  for (const p of [a, b]) for (const [nx, nz] of [[p.c, p.s], [-p.s, p.c]] as const) {
    const o = reach(a, nx, nz) + reach(b, nx, nz) - Math.abs((b.cx - a.cx) * nx + (b.cz - a.cz) * nz);
    if (o < d) d = o;
    if (d <= 0) return d;
  }
  return d;
}

/**
 * Every pair of pieces of different objects that interpenetrate by more than `tol` metres, where `pair(a, b)` says the two meshes are worth testing
 * (it is asked with the two in either order). A 4 m grid keeps it near linear.
 */
export function overlaps(pieces: readonly OverlapPiece[], pair: (a: OverlapPiece, b: OverlapPiece) => boolean, tol: number): Overlap[] {
  const CELL = 4;
  const grid = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    for (let x = Math.floor(p.min.x / CELL); x <= Math.floor(p.max.x / CELL); x++)
      for (let z = Math.floor(p.min.z / CELL); z <= Math.floor(p.max.z / CELL); z++) {
        const key = `${x},${z}`;
        let l = grid.get(key);
        if (!l) grid.set(key, (l = []));
        l.push(i);
      }
  });
  const seen = new Set<string>();
  const out: Overlap[] = [];
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const ia = list[i]!, ib = list[j]!;
      const a = pieces[ia]!, b = pieces[ib]!;
      if (a.mesh === b.mesh && a.instance === b.instance) continue; // (one object: its joints are on purpose)
      if (!pair(a, b) && !pair(b, a)) continue;
      const key = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (a.max.x < b.min.x || b.max.x < a.min.x || a.max.z < b.min.z || b.max.z < a.min.z || a.max.y < b.min.y || b.max.y < a.min.y) continue;
      const depth = overlapDepth(a, b);
      if (depth > tol) out.push({ a, b, depth });
    }
  }
  return out.sort((x, y) => y.depth - x.depth);
}

/** A line for a finding: both pieces (mesh#instance, centre, size) and the depth. */
export function describeOverlap(o: Overlap): string {
  const at = (p: OverlapPiece): string =>
    `${p.mesh}#${p.instance} at ${((p.min.x + p.max.x) / 2).toFixed(1)},${((p.min.y + p.max.y) / 2).toFixed(1)},${((p.min.z + p.max.z) / 2).toFixed(1)} size ${(p.max.x - p.min.x).toFixed(2)}x${(p.max.y - p.min.y).toFixed(2)}x${(p.max.z - p.min.z).toFixed(2)}`;
  return `${at(o.a)}  <->  ${at(o.b)}  depth ${o.depth.toFixed(2)} m`;
}
