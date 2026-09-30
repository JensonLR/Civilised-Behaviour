import { BufferAttribute, BufferGeometry, Color } from "three";
import type { V3 } from "./parts.ts";

/**
 * A masked patch of a parametric surface: cloth laid ON a body section. The surface is `point(u, v)` (u runs around, v along); the mask says
 * where the patch exists (0..1, the patch is cut at the 0.5 iso-line so its edges are smooth curves rather than a staircase, exactly like the
 * hair shells on the head). Waistcoat fronts, open coat skirts, lapels, capes, yokes and collars are all patches of the torso or hip surface, so
 * they hug the body by construction and no seam floats or sinks.
 */
export interface PatchSpec {
  /** Surface point and outward unit normal at (u, v), with the patch `lift` metres proud of the body. */
  at(u: number, v: number, lift: number): { p: V3; n: V3 };
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  nu: number;
  nv: number;
  /** Coverage 0..1 (the patch keeps u,v where it is >= 0.5). Prefer `inside`: a hand-made mask that saturates within a cell gives a staircase edge. */
  mask?(u: number, v: number): number;
  /**
   * Signed distance to the patch's edge in (u, v) units: positive inside, zero ON the edge. Combine edges with Math.min. The builder turns it into a coverage ramp
   * a few cells wide, so the piecewise-linear interpolation lands the cut exactly on the zero line and edges are smooth curves.
   */
  inside?(u: number, v: number): number;
  /** Metres proud of the surface at (u, v). Default 0.006. */
  lift?(u: number, v: number): number;
  color: number | ((u: number, v: number) => number);
  /** Wrap around in u (a full ring): the last column joins the first. */
  wrap?: boolean;
  /**
   * Cloth thickness in metres. When set the patch is a two-layer sheet: the outer surface, an inner surface `thick` below it (inverted, in `lining`, so a
   * coat seen from inside or from below shows its lining instead of the world through it) and a rolled rim closing the two along every free edge.
   */
  thick?: number;
  /** Colour of the inner layer and the rim (default: the outer colour darkened). */
  lining?: number;
  /** Which free edges get a rim: called with the edge midpoint's (u, v). Default: all. Use it to skip the edge hidden under a collar. */
  rim?(u: number, v: number): boolean;
}

const c = new Color();

export function buildPatch(spec: PatchSpec): BufferGeometry | undefined {
  const { nu, nv } = spec;
  const cols = spec.wrap ? nu : nu + 1;
  const uAt = (i: number): number => spec.u0 + ((spec.u1 - spec.u0) * i) / nu;
  const vAt = (j: number): number => spec.v0 + ((spec.v1 - spec.v0) * j) / nv;
  const ramp = 2 * Math.max(Math.abs(spec.u1 - spec.u0) / nu, Math.abs(spec.v1 - spec.v0) / nv);
  const inside = spec.inside;
  const mask = inside ? (u: number, v: number): number => Math.max(0, Math.min(1, 0.5 + inside(u, v) / ramp)) : (spec.mask ?? (() => 1));
  const liftAt = (u: number, v: number): number => spec.lift?.(u, v) ?? 0.006;
  const colorAt = (u: number, v: number): number => (typeof spec.color === "function" ? spec.color(u, v) : spec.color);
  interface G {
    u: number;
    v: number;
    m: number;
  }
  const grid: G[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) grid.push({ u: uAt(i), v: vAt(j), m: mask(uAt(i), vAt(j)) });

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const uvOf: number[] = []; // (u, v) of every emitted vertex (for the rim predicate)
  const welded = new Map<string, number>();
  const emit = (g: G): number => {
    const { p, n } = spec.at(g.u, g.v, liftAt(g.u, g.v));
    const key = `${Math.round(p[0] * 4000)},${Math.round(p[1] * 4000)},${Math.round(p[2] * 4000)}`;
    const hit = welded.get(key);
    if (hit !== undefined) return hit;
    const id = pos.length / 3;
    welded.set(key, id);
    uvOf.push(g.u, g.v);
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0], n[1], n[2]);
    c.setHex(colorAt(g.u, g.v));
    col.push(c.r, c.g, c.b);
    return id;
  };
  const ISO = 0.5;
  const mid = (a: G, b: G): G => {
    const t = (ISO - a.m) / (b.m - a.m);
    const u = a.u + (b.u - a.u) * t;
    const v = a.v + (b.v - a.v) * t;
    return { u, v, m: ISO };
  };
  const tri = (a: G, b: G, d: G): void => {
    const n = (a.m >= ISO ? 1 : 0) + (b.m >= ISO ? 1 : 0) + (d.m >= ISO ? 1 : 0);
    if (n === 0) return;
    if (n === 3) {
      idx.push(emit(a), emit(b), emit(d));
      return;
    }
    const poly: G[] = [];
    const vs = [a, b, d];
    for (let k = 0; k < 3; k++) {
      const p = vs[k]!;
      const q = vs[(k + 1) % 3]!;
      const pin = p.m >= ISO;
      const qin = q.m >= ISO;
      if (pin) poly.push(p);
      if (pin !== qin) poly.push(mid(p, q));
    }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(emit(poly[0]!), emit(poly[k]!), emit(poly[k + 1]!));
  };
  const at = (i: number, j: number): G => grid[j * cols + (i % cols)]!;
  const last = spec.wrap ? nu : nu;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < last; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const d = at(i, j + 1);
      const e = at(i + 1, j + 1);
      tri(a, d, b);
      tri(b, d, e);
    }
  }
  // Drop degenerate triangles (welding two grid points that coincide - a pole, a sliver at the mask's edge - leaves a triangle with no area): they draw nothing and
  // poison anything that measures distance to the surface.
  for (let t = idx.length - 3; t >= 0; t -= 3) {
    const a = idx[t]!;
    const b = idx[t + 1]!;
    const d = idx[t + 2]!;
    const e1x = pos[b * 3]! - pos[a * 3]!;
    const e1y = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const e1z = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const e2x = pos[d * 3]! - pos[a * 3]!;
    const e2y = pos[d * 3 + 1]! - pos[a * 3 + 1]!;
    const e2z = pos[d * 3 + 2]! - pos[a * 3 + 2]!;
    const area2 = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
    if (a === b || b === d || a === d || area2 < 1e-9) idx.splice(t, 3);
  }
  if (idx.length === 0) return undefined;
  // Wind every triangle so its face normal agrees with the surface's own outward normal.
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!;
    const b = idx[t + 1]!;
    const d = idx[t + 2]!;
    const e1: V3 = [pos[b * 3]! - pos[a * 3]!, pos[b * 3 + 1]! - pos[a * 3 + 1]!, pos[b * 3 + 2]! - pos[a * 3 + 2]!];
    const e2: V3 = [pos[d * 3]! - pos[a * 3]!, pos[d * 3 + 1]! - pos[a * 3 + 1]!, pos[d * 3 + 2]! - pos[a * 3 + 2]!];
    const fx = e1[1] * e2[2] - e1[2] * e2[1];
    const fy = e1[2] * e2[0] - e1[0] * e2[2];
    const fz = e1[0] * e2[1] - e1[1] * e2[0];
    const dot = fx * (nor[a * 3]! + nor[b * 3]! + nor[d * 3]!) + fy * (nor[a * 3 + 1]! + nor[b * 3 + 1]! + nor[d * 3 + 1]!) + fz * (nor[a * 3 + 2]! + nor[b * 3 + 2]! + nor[d * 3 + 2]!);
    if (dot < 0) {
      idx[t + 1] = d;
      idx[t + 2] = b;
    }
  }
  if (spec.thick && spec.thick > 0) addThickness(spec, pos, nor, col, idx, uvOf);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(idx);
  return geo;
}

const lc = new Color();

/**
 * Turns a one-sided sheet into cloth with a body: an inner layer (each vertex moved `thick` against its normal, faces and normals inverted, lining colour) and a
 * rim along every free edge (found as the edges used by exactly one triangle) closing the outer and inner layers with a flat strip. Appends to the arrays.
 */
function addThickness(spec: PatchSpec, pos: number[], nor: number[], col: number[], idx: number[], uvOf: number[]): void {
  const t = spec.thick!;
  const outerVerts = pos.length / 3;
  const outerTris = idx.length;
  // the lining colour follows the outer colour by default (a shade darker) so a striped hem lines itself in stripes
  const lining = (i: number): [number, number, number] => {
    if (spec.lining !== undefined) return (lc.setHex(spec.lining), [lc.r, lc.g, lc.b]);
    return [col[i * 3]! * 0.72, col[i * 3 + 1]! * 0.72, col[i * 3 + 2]! * 0.72];
  };
  for (let i = 0; i < outerVerts; i++) {
    pos.push(pos[i * 3]! - nor[i * 3]! * t, pos[i * 3 + 1]! - nor[i * 3 + 1]! * t, pos[i * 3 + 2]! - nor[i * 3 + 2]! * t);
    nor.push(-nor[i * 3]!, -nor[i * 3 + 1]!, -nor[i * 3 + 2]!);
    col.push(...lining(i));
  }
  for (let k = 0; k < outerTris; k += 3) idx.push(idx[k]! + outerVerts, idx[k + 2]! + outerVerts, idx[k + 1]! + outerVerts);
  // free edges: directed edge a->b of a triangle whose reverse b->a no triangle has
  const seen = new Map<string, { a: number; b: number; third: number; twice: boolean }>();
  for (let k = 0; k < outerTris; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[k + e]!;
      const b = idx[k + ((e + 1) % 3)]!;
      const third = idx[k + ((e + 2) % 3)]!;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}_${hi}`;
      const hit = seen.get(key);
      if (hit) hit.twice = true;
      else seen.set(key, { a, b, third, twice: false });
    }
  }
  for (const e of seen.values()) {
    if (e.twice) continue;
    if (spec.rim && !spec.rim((uvOf[e.a * 2]! + uvOf[e.b * 2]!) / 2, (uvOf[e.a * 2 + 1]! + uvOf[e.b * 2 + 1]!) / 2)) continue;
    const A = [pos[e.a * 3]!, pos[e.a * 3 + 1]!, pos[e.a * 3 + 2]!];
    const B = [pos[e.b * 3]!, pos[e.b * 3 + 1]!, pos[e.b * 3 + 2]!];
    const T = [pos[e.third * 3]!, pos[e.third * 3 + 1]!, pos[e.third * 3 + 2]!];
    const ia = e.a + outerVerts;
    const ib = e.b + outerVerts;
    const A2 = [pos[ia * 3]!, pos[ia * 3 + 1]!, pos[ia * 3 + 2]!];
    // rim normal: the edge direction crossed with the sheet's depth axis, pointing away from the triangle's third vertex
    const ex = B[0]! - A[0]!;
    const ey = B[1]! - A[1]!;
    const ez = B[2]! - A[2]!;
    const dx = A2[0]! - A[0]!;
    const dy = A2[1]! - A[1]!;
    const dz = A2[2]! - A[2]!;
    let rx = ey * dz - ez * dy;
    let ry = ez * dx - ex * dz;
    let rz = ex * dy - ey * dx;
    const away = rx * ((A[0]! + B[0]!) / 2 - T[0]!) + ry * ((A[1]! + B[1]!) / 2 - T[1]!) + rz * ((A[2]! + B[2]!) / 2 - T[2]!);
    if (away < 0) {
      rx = -rx;
      ry = -ry;
      rz = -rz;
    }
    const l = Math.hypot(rx, ry, rz) || 1;
    rx /= l;
    ry /= l;
    rz /= l;
    const base = pos.length / 3;
    const rimCol = lining(e.a);
    for (const src of [e.a, e.b, ia, ib]) {
      pos.push(pos[src * 3]!, pos[src * 3 + 1]!, pos[src * 3 + 2]!);
      nor.push(rx, ry, rz);
      col.push(...rimCol);
    }
    // wind so the face normal agrees with (rx, ry, rz)
    const B2 = [pos[ib * 3]!, pos[ib * 3 + 1]!, pos[ib * 3 + 2]!];
    const f = (p: number[], q: number[], r: number[]): number => ((q[1]! - p[1]!) * (r[2]! - p[2]!) - (q[2]! - p[2]!) * (r[1]! - p[1]!)) * rx + ((q[2]! - p[2]!) * (r[0]! - p[0]!) - (q[0]! - p[0]!) * (r[2]! - p[2]!)) * ry + ((q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!)) * rz;
    if (f(A, B, B2) >= 0) idx.push(base, base + 1, base + 3);
    else idx.push(base, base + 3, base + 1);
    if (f(A, B2, A2) >= 0) idx.push(base, base + 3, base + 2);
    else idx.push(base, base + 2, base + 3);
  }
}

/** Smooth 0..1 step. */
export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A patch surface from any parametric point function: the normal is taken numerically (dP/du x dP/dv). Its sign is chosen ONCE, so that it faces `outward` at the
 * reference parameter `ref`, and kept everywhere: a sheet that folds over (a brim turned up) keeps the same face outermost all the way round the fold instead of
 * flipping where its normal passes through the plane of `outward`.
 */
export function numericSurface(
  pt: (u: number, v: number) => V3,
  outward: V3 = [0, 1, 0],
  ref: readonly [number, number] = [0, 0.1],
): (u: number, v: number, lift: number) => { p: V3; n: V3 } {
  const e = 1e-3;
  const raw = (u: number, v: number): V3 => {
    const a = pt(u - e, v);
    const b = pt(u + e, v);
    const c = pt(u, v - e);
    const d = pt(u, v + e);
    const t1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const t2 = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
    const nx = t1[1]! * t2[2]! - t1[2]! * t2[1]!;
    const ny = t1[2]! * t2[0]! - t1[0]! * t2[2]!;
    const nz = t1[0]! * t2[1]! - t1[1]! * t2[0]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  const r0 = raw(ref[0], ref[1]);
  const sign = r0[0] * outward[0] + r0[1] * outward[1] + r0[2] * outward[2] < 0 ? -1 : 1;
  return (u, v, lift) => {
    const p = pt(u, v);
    const n = raw(u, v);
    const nx = n[0] * sign;
    const ny = n[1] * sign;
    const nz = n[2] * sign;
    return { p: [p[0] + nx * lift, p[1] + ny * lift, p[2] + nz * lift], n: [nx, ny, nz] };
  };
}
