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
  const welded = new Map<string, number>();
  const emit = (g: G): number => {
    const { p, n } = spec.at(g.u, g.v, liftAt(g.u, g.v));
    const key = `${Math.round(p[0] * 4000)},${Math.round(p[1] * 4000)},${Math.round(p[2] * 4000)}`;
    const hit = welded.get(key);
    if (hit !== undefined) return hit;
    const id = pos.length / 3;
    welded.set(key, id);
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
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(idx);
  return geo;
}

/** Smooth 0..1 step. */
export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
