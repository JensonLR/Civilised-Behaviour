import { ConeGeometry, Euler, Matrix4, Vector3 } from "three";
import type { Ring } from "../loft.ts";
import { PartBuilder, type V3 } from "../parts.ts";
import { tone } from "../bodyKit.ts";
import { alongY, faceAlong, torsoSegments, type Surf, type SurfPoint } from "./surface.ts";

/**
 * Placing things ON the trunk, derived from the surface the trunk is drawn with (`Surf`, surface.ts), so the same option fits a stubby paunch and a beanpole:
 * bands wrap the very sections of the loft, plates lie flat on the faces, ribbons follow the surface over the shoulder, hard pieces stand off by their own half thickness.
 */

/** Thickness helper: a strap, ribbon or thin band of half thickness `t` sits with its inner face 2 mm clear of the surface it lies on. */
export const seat = (t: number, base = 0): number => base + t + 0.002;

export interface BandOpts {
  /** Distance of the band's outer face from the surface (metres). */
  lift: number;
  /** Rolled edges: the first and last sections sit almost flush, so it reads as cloth laid on, not a hoop. Default true. */
  edges?: boolean;
  /** Extra sections between the ends (a tall band follows the taper). Default 1. */
  steps?: number;
  crease?: boolean;
  colorBottom?: number;
  /** Extra lift in the middle (a puffed cummerbund, a fur roll). */
  bulge?: number;
}

/** A band round the torso between two heights, following the loft's own sections and sides (same number of sides, so its faces are parallel to the body's). */
export function bandAround(b: PartBuilder, s: Surf, yTop: number, yBot: number, color: number, o: BandOpts): void {
  const hi = Math.max(yTop, yBot);
  const lo = Math.min(yTop, yBot);
  if (PartBuilder.lod >= 1 && hi - lo < 0.05) return; // (a belt a few centimetres wide is a pixel or two at crowd distance)
  const n = 2 + (o.steps ?? 1);
  const out: Ring[] = [];
  const section = (y: number, lift: number, c: number, crease = false): Ring => {
    const q = s.section(y);
    return { y, rx: q.rx + lift, rz: q.rz + lift, cx: q.cx, cz: q.cz, pow: q.pow, color: c, ...(crease ? { crease: true } : {}) };
  };
  if (o.edges !== false) out.push(section(lo - 0.0015, o.lift * 0.3, tone(color, 0.86)));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = lo + (hi - lo) * t;
    out.push(section(y, o.lift + (o.bulge ?? 0) * Math.sin(Math.PI * t), i === 0 ? (o.colorBottom ?? tone(color, 0.9)) : i === n - 1 ? tone(color, 1.06) : color, o.crease === true && i === n - 1));
  }
  if (o.edges !== false) out.push(section(hi + 0.0015, o.lift * 0.3, tone(color, 0.8)));
  b.loft(out, color, undefined, undefined, undefined, { capBottom: false, capTop: false, segments: torsoSegments() });
}

/**
 * A local frame on the surface: `at(dx, dy, out)` = the point dx to the character's right, dy up (along the surface) and `out` off the surface; `rot` turns a primitive so its
 * Z axis (the thin axis of a plate) points out of the surface and its Y stays up; `rotY` turns its Y axis (a cylinder's or cone's axis) out of the surface.
 */
export interface Frame {
  at(dx: number, dy: number, out: number): V3;
  rot: V3;
  rotY: V3;
  n: V3;
  right: V3;
  up: V3;
}

const fa = new Vector3();
const fb = new Vector3();
const fc = new Vector3();
const fm = new Matrix4();
const fe = new Euler();

export function frameAt(sp: SurfPoint): Frame {
  const n = new Vector3(sp.n[0], sp.n[1], sp.n[2]).normalize();
  const up = fa.set(0, 1, 0).addScaledVector(n, -n.y);
  if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
  up.normalize();
  const right = fb.copy(n).cross(up).normalize();
  const rightA: V3 = [right.x, right.y, right.z];
  const upA: V3 = [up.x, up.y, up.z];
  const nA: V3 = [n.x, n.y, n.z];
  fm.makeBasis(right, up, n);
  fe.setFromRotationMatrix(fm, "XYZ");
  const rot: V3 = [fe.x, fe.y, fe.z];
  fc.copy(right).cross(n);
  fm.makeBasis(right, n, fc);
  fe.setFromRotationMatrix(fm, "XYZ");
  const rotY: V3 = [fe.x, fe.y, fe.z];
  return {
    at: (dx, dy, out) => [sp.p[0] + rightA[0] * dx + upA[0] * dy + nA[0] * out, sp.p[1] + rightA[1] * dx + upA[1] * dy + nA[1] * out, sp.p[2] + rightA[2] * dx + upA[2] * dy + nA[2] * out],
    rot,
    rotY,
    n: nA,
    right: rightA,
    up: upA,
  };
}

/** A flat-backed hard piece (button, plate, buckle) on the surface: `centre` = distance of the piece's centre from the surface. Returns nothing; adds `make(pos, rot)`. */
export function onSurface(sp: SurfPoint, centre: number): { pos: V3; rot: V3 } {
  return { pos: [sp.p[0] + sp.n[0] * centre, sp.p[1] + sp.n[1] * centre, sp.p[2] + sp.n[2] * centre], rot: faceAlong(sp.n) };
}

/** A box lying on the surface at lateral offset x (front or back) and height y, `w` across, `h` tall, `d` deep; its back face stands `lift` off the surface. */
export function plate(b: PartBuilder, s: Surf, x: number, y: number, w: number, h: number, d: number, color: number, o: { lift?: number; back?: boolean; roll?: number } = {}): SurfPoint {
  const sp = s.atX(x, y, 0, o.back === true);
  const m = onSurface(sp, (o.lift ?? 0) + d / 2);
  // (a roll about the surface normal is a rotation about the box's own Z: compose by adding it to the third Euler angle only when the face is near-vertical)
  b.box(w, h, d, color, m.pos, o.roll ? [m.rot[0], m.rot[1], (m.rot[2] ?? 0) + o.roll] : m.rot);
  return sp;
}

/** A dome (button, stud, boss) standing on the surface at lateral offset x: `r` its radius, flattened to `thick` along the normal. */
export function stud(b: PartBuilder, s: Surf, x: number, y: number, r: number, color: number, o: { lift?: number; thick?: number; back?: boolean } = {}): void {
  const sp = s.atX(x, y, 0, o.back === true);
  const t = o.thick ?? r * 0.6;
  const m = onSurface(sp, (o.lift ?? 0) + t * 0.5);
  b.sphere(r, color, m.pos, [1, 1, t / r], m.rot);
}

/** A button: a domed five-sided cone whose apex points along the surface normal (lift = how far its base stands off the surface). */
export function buttonOn(b: PartBuilder, s: Surf, x: number, y: number, r: number, color: number, lift = 0.001, back = false): void {
  const sp = s.atX(x, y, 0, back);
  const m = onSurface(sp, r * 0.27 + lift);
  PartBuilder.auditKind = "button";
  b.add(new ConeGeometry(r, r * 0.55, 5, 1), color, m.pos, alongY(sp.n));
}

export interface RibbonStop {
  phi: number;
  y: number;
}

export interface RibbonOpts {
  /** Thickness of the cloth the ribbon lies over (the coat's facings): the ribbon's inner face sits 2 mm above it. */
  base?: number;
  round?: "both" | "start" | "end";
  /** Colour along the ribbon (t = 0..1): stripes on a muffler, a fringe at an end. */
  colorAt?: (t: number) => number;
  /** Width factor along the ribbon (t = 0..1): a tapered tail. */
  taper?: (t: number) => number;
  /** Sample spacing in metres (default 5 cm). */
  step?: number;
}

/**
 * A flat ribbon laid on the surface through the stops (azimuth, height): sampled every ~3.5 cm along the way so it follows the faces, its side axis along the surface.
 * `half` is the half width, `thick` the half thickness; the ribbon's inner face is 2 mm off the surface plus `o.base` (the thickness of whatever cloth it lies over).
 */
export function ribbon(b: PartBuilder, s: Surf, color: number, stops: readonly RibbonStop[], half: number, thick: number, o: RibbonOpts = {}): void {
  if (stops.length < 2) return;
  const path: V3[] = [];
  const normals: V3[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const c = stops[i + 1]!;
    const pa = s.at(a.phi, a.y, 0).p;
    const pc = s.at(c.phi, c.y, 0).p;
    const len = Math.hypot(pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]);
    const steps = Math.max(2, Math.ceil(len / ((o.step ?? 0.05) * (PartBuilder.lod >= 1 ? 2.2 : 1))));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      const phi = a.phi + (c.phi - a.phi) * t;
      const y = a.y + (c.y - a.y) * t;
      // position on the drawn polygon, lifted along the SMOOTH normal (which is also the ribbon's side reference: no twist at the polygon's edges)
      const q = s.at(phi, y, 0);
      const n = s.normal(phi, y);
      const lift = seat(thick, o.base ?? 0);
      path.push([q.p[0] + n[0] * lift, q.p[1] + n[1] * lift, q.p[2] + n[2] * lift]);
      normals.push(n);
    }
  }
  if (path.length < 3) return;
  const last = path.length - 1;
  b.sweep(path, (t, i) => ({ rx: half * (o.taper ? o.taper(t) : 1), rz: thick, pow: 3.2, ...(o.colorAt ? { color: o.colorAt(i / last) } : {}) }), color, {
    segments: 4,
    coarseDome: true,
    ...(o.round === undefined ? { round: "both" as const } : { round: o.round }),
    sideAt: (i) => {
      const a = path[Math.max(0, i - 1)]!;
      const c = path[Math.min(path.length - 1, i + 1)]!;
      const t: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = normals[Math.min(i, normals.length - 1)]!;
      // across the ribbon = normal x tangent
      return [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]] as V3;
    },
  });
}

/** A ribbon hanging straight down the front (or back) at lateral offset x from height yTop to yBot: a tie, a scarf end, a sash tail; it follows the chest's curve. */
export function hangingStrip(b: PartBuilder, s: Surf, x: number, yTop: number, yBot: number, half: number, thick: number, color: number, o: RibbonOpts & { back?: boolean } = {}): void {
  const n = Math.max(2, Math.ceil(Math.abs(yTop - yBot) / 0.07));
  const stops: RibbonStop[] = [];
  for (let i = 0; i <= n; i++) {
    const y = yTop + ((yBot - yTop) * i) / n;
    stops.push({ phi: s.atX(x, y, 0, o.back === true).phi, y });
  }
  ribbon(b, s, color, stops, half, thick, { round: "end", ...o });
}

/**
 * The height at which the torso's half-width equals `x` on the shoulder slope (between the widest ring at 0.87 h and the neck): where a strap crosses the top of the shoulder,
 * for ANY shoulder width. Returns torso-frame y.
 */
export function shoulderY(s: Surf, h: number, x: number): number {
  let lo = h * 0.87;
  let hi = h * 0.985;
  const w = (y: number): number => s.section(y).rx + Math.abs(s.section(y).cx);
  if (x >= w(lo)) return lo;
  if (x <= w(hi)) return hi;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (w(mid) > x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
