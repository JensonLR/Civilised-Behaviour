import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";
import type { V3 } from "./parts.ts";

/** Cross-section of a sweep at one spine point: superellipse half-axes along the frame's side (rx) and normal (rz) directions. */
export interface SweepSection {
  rx: number;
  rz: number;
  /** Squareness (2 = ellipse). Default 2.2. */
  pow?: number;
  color?: number;
}

export interface SweepOptions {
  color: number;
  /** Segments around the section. Default 8. */
  segments?: number;
  /** Reference "side" direction used to orient the sections (default +X). Pick the axis the form is widest along. */
  side?: V3;
  /** Per-spine-point reference side (index into the spine you passed), for ribbons that wrap a curved surface: the wide axis must follow the surface, not one fixed direction. */
  sideAt?: (i: number) => V3;
  /** Close the ends with fans. Default true. */
  caps?: boolean;
  /** Round off the start and/or end into a smooth dome instead of a flat cut (noses, tufts, beard tips). */
  round?: "start" | "end" | "both";
  /** One dome ring instead of three (crowd levels: a tip a few pixels wide does not need a smooth cap). */
  coarseDome?: boolean;
  /**
   * OUTLINE HULL ONLY (the geometry gets a per-vertex `hthin` attribute that outline.ts reads): how much thinner the ink line is at `t` (0 root .. 1 end of the spine you passed),
   * 0 = the full line, 0.45 = 55%. A nose's hull overlays the cheek and the eye in a three-quarter view; its bridge wants a hairline and its tip the full silhouette.
   */
  hullThin?: (t: number) => number;
}

const c = new Color();
const T = new Vector3();
const S = new Vector3();
const B = new Vector3();
const ref = new Vector3();

/**
 * A tube swept along a 3D spine with a per-point cross-section: moustaches, brows, noses, hair locks, beards, ponytails.
 * Section frames follow the spine tangent with a stable side axis, so planar curves (the common case) never twist.
 * Output has position, normal, uv (unused) and per-vertex colour, like loftGeometry, and always faces outward.
 */
export function sweepGeometry(spineIn: readonly V3[], section: (t: number, i: number) => SweepSection, opts: SweepOptions): BufferGeometry {
  const seg = Math.max(4, opts.segments ?? 6);
  let spine: readonly V3[] = spineIn;
  if (spine.length < 2) throw new Error("sweep needs at least two spine points");
  // Optional dome ends: extra rings past the last spine point whose radii follow a quarter circle, so the tube closes smoothly.
  const baseN = spine.length;
  const secs: SweepSection[] = spine.map((_, i) => section(i / (baseN - 1), i));
  const pts: V3[] = [...spine];
  const DOME = opts.coarseDome ? [0.87] : [0.5, 0.86, 0.985];
  const sideRefs: (V3 | undefined)[] = opts.sideAt ? spine.map((_, i) => opts.sideAt!(i)) : [];
  if (opts.round === "end" || opts.round === "both") {
    const a = pts[pts.length - 2]!;
    const b = pts[pts.length - 1]!;
    const s = secs[secs.length - 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    const r = Math.max(s.rx, s.rz);
    for (const u of DOME) {
      const k = Math.sqrt(1 - u * u);
      pts.push([b[0] + ((b[0] - a[0]) / len) * r * u, b[1] + ((b[1] - a[1]) / len) * r * u, b[2] + ((b[2] - a[2]) / len) * r * u]);
      secs.push({ ...s, rx: s.rx * k, rz: s.rz * k });
      if (opts.sideAt) sideRefs.push(sideRefs[baseN - 1]);
    }
  }
  if (opts.round === "start" || opts.round === "both") {
    const a = pts[1]!;
    const b = pts[0]!;
    const s = secs[0]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    const r = Math.max(s.rx, s.rz);
    for (const u of DOME) {
      const k = Math.sqrt(1 - u * u);
      pts.unshift([b[0] + ((b[0] - a[0]) / len) * r * u, b[1] + ((b[1] - a[1]) / len) * r * u, b[2] + ((b[2] - a[2]) / len) * r * u]);
      secs.unshift({ ...s, rx: s.rx * k, rz: s.rz * k });
      if (opts.sideAt) sideRefs.unshift(sideRefs[0]);
    }
  }
  spine = pts;
  const n = spine.length;
  const pos: number[] = [];
  const col: number[] = [];
  const thin: number[] = [];
  const startDome = opts.round === "start" || opts.round === "both" ? DOME.length : 0;
  const index: number[] = [];
  ref.set(...(opts.side ?? ([1, 0, 0] as V3)));

  for (let i = 0; i < n; i++) {
    const p = spine[i]!;
    const a = spine[Math.max(0, i - 1)]!;
    const b = spine[Math.min(n - 1, i + 1)]!;
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (T.lengthSq() < 1e-12) T.set(0, 1, 0);
    T.normalize();
    const rv = sideRefs[i];
    if (rv) ref.set(rv[0], rv[1], rv[2]);
    S.copy(ref).addScaledVector(T, -ref.dot(T));
    if (S.lengthSq() < 1e-6) S.set(Math.abs(T.z) < 0.9 ? 0 : 1, 0, Math.abs(T.z) < 0.9 ? 1 : 0); // spine runs along the reference axis: pick another
    S.addScaledVector(T, -S.dot(T)).normalize();
    B.crossVectors(T, S).normalize();
    const sec = secs[i]!;
    c.setHex(sec.color ?? opts.color);
    const e = 2 / (sec.pow ?? 2.2);
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const s = Math.sin(th);
      const co = Math.cos(th);
      const u = sec.rx * Math.sign(s) * Math.abs(s) ** e;
      const v = sec.rz * Math.sign(co) * Math.abs(co) ** e;
      pos.push(p[0] + S.x * u + B.x * v, p[1] + S.y * u + B.y * v, p[2] + S.z * u + B.z * v);
      col.push(c.r, c.g, c.b);
      if (opts.hullThin) thin.push(opts.hullThin(Math.max(0, Math.min(1, (i - startDome) / (baseN - 1)))));
    }
  }
  // Side quads. Winding is checked against the outward direction once, so the caps can follow it exactly.
  const sideIndex: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const b = i * seg + ((k + 1) % seg);
      sideIndex.push(a, a + seg, b, b, a + seg, b + seg);
    }
  }
  {
    const a = sideIndex[0]!;
    const bq = sideIndex[1]!;
    const cq = sideIndex[2]!;
    const P = (i: number, k: 0 | 1 | 2): number => pos[i * 3 + k]!;
    const e1: V3 = [P(bq, 0) - P(a, 0), P(bq, 1) - P(a, 1), P(bq, 2) - P(a, 2)];
    const e2: V3 = [P(cq, 0) - P(a, 0), P(cq, 1) - P(a, 1), P(cq, 2) - P(a, 2)];
    const nrm: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const sp = spine[0]!;
    const out: V3 = [P(a, 0) - sp[0], P(a, 1) - sp[1], P(a, 2) - sp[2]];
    if (nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2] < 0) for (let i = 0; i < sideIndex.length; i += 3) [sideIndex[i + 1], sideIndex[i + 2]] = [sideIndex[i + 2]!, sideIndex[i + 1]!];
  }
  index.push(...sideIndex);
  if (opts.caps !== false) {
    const cap = (i: number, dirSign: 1 | -1): void => {
      const p = spine[i]!;
      const q = spine[i + dirSign] ?? p;
      const centre = pos.length / 3;
      pos.push(p[0], p[1], p[2]);
      c.setHex(secs[i]!.color ?? opts.color);
      col.push(c.r, c.g, c.b);
      if (opts.hullThin) thin.push(thin[i * seg]!);
      const base = pos.length / 3;
      for (let k = 0; k < seg; k++) {
        pos.push(pos[(i * seg + k) * 3]!, pos[(i * seg + k) * 3 + 1]!, pos[(i * seg + k) * 3 + 2]!);
        col.push(col[(i * seg + k) * 3]!, col[(i * seg + k) * 3 + 1]!, col[(i * seg + k) * 3 + 2]!);
        if (opts.hullThin) thin.push(thin[i * seg + k]!);
      }
      // The cap must face away from the rest of the tube (along p - q).
      const away: V3 = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
      const v0: V3 = [pos[base * 3]! - p[0], pos[base * 3 + 1]! - p[1], pos[base * 3 + 2]! - p[2]];
      const v1: V3 = [pos[(base + 1) * 3]! - p[0], pos[(base + 1) * 3 + 1]! - p[1], pos[(base + 1) * 3 + 2]! - p[2]];
      const nrm: V3 = [v0[1] * v1[2] - v0[2] * v1[1], v0[2] * v1[0] - v0[0] * v1[2], v0[0] * v1[1] - v0[1] * v1[0]];
      const faces = nrm[0] * away[0] + nrm[1] * away[1] + nrm[2] * away[2] >= 0;
      for (let k = 0; k < seg; k++) {
        const x = base + k;
        const y = base + ((k + 1) % seg);
        if (faces) index.push(centre, x, y);
        else index.push(centre, y, x);
      }
    };
    cap(0, 1);
    cap(n - 1, -1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  if (opts.hullThin) geo.setAttribute("hthin", new BufferAttribute(new Float32Array(thin), 1));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return geo;
}

/** Flips the winding if the mesh's signed volume is negative (frames can be left- or right-handed depending on the spine). */
export function orientOutward(geo: BufferGeometry): void {
  const p = geo.attributes.position!;
  const ix = geo.index!;
  let v = 0;
  for (let i = 0; i < ix.count; i += 3) {
    const a = ix.getX(i);
    const b = ix.getX(i + 1);
    const cc = ix.getX(i + 2);
    v += p.getX(a) * (p.getY(b) * p.getZ(cc) - p.getZ(b) * p.getY(cc)) - p.getY(a) * (p.getX(b) * p.getZ(cc) - p.getZ(b) * p.getX(cc)) + p.getZ(a) * (p.getX(b) * p.getY(cc) - p.getY(b) * p.getX(cc));
  }
  if (v >= 0) return;
  for (let i = 0; i < ix.count; i += 3) {
    const t = ix.getX(i + 1);
    ix.setX(i + 1, ix.getX(i + 2));
    ix.setX(i + 2, t);
  }
}

/** Smooth Catmull-Rom resample of control points into `samples` spine points (endpoints preserved). */
export function curve(points: readonly V3[], samples: number): V3[] {
  const n = points.length;
  if (n < 2) throw new Error("curve needs at least two points");
  const out: V3[] = [];
  const P = (i: number): V3 => points[Math.max(0, Math.min(n - 1, i))]!;
  for (let s = 0; s < samples; s++) {
    const f = (s / (samples - 1)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const t = f - i;
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const at = (k: 0 | 1 | 2): number =>
      0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    out.push([at(0), at(1), at(2)]);
  }
  return out;
}
