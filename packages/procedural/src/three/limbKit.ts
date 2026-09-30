import { Euler, Quaternion, Vector3 } from "three";
import { PartBuilder, type V3 } from "./parts.ts";
import { ringAt, tone } from "./bodyKit.ts";
import type { Ring } from "./loft.ts";

/**
 * Placing things ON a limb. Everything that sits on a sleeve, a trouser leg or a boot (cuffs, stripes, buttons, straps, patches, garters) is derived from the ring table the limb itself
 * is lofted from - a section at height y is `ringAt(rings, y)` - and offset along the surface normal by a thickness that scales with the limb. Nothing on a limb uses an absolute
 * offset from a guessed radius, so the same option fits a thin arm and a thick one, a short leg and a long one.
 *
 * The loft is a polygon (10 sides at full detail), and a detail laid on its side would sink into the flat between two vertices by up to 5% of the radius, so `limbSurface`
 * answers with the POLYGON's surface (the chord between the two neighbouring vertices), not the smooth curve.
 */

/** Thickness of a layer of cloth laid on a limb of the given radius (metres): a little absolute (cloth has a thickness) and a little proportional (a thick arm is a thick sleeve). */
export const clothLift = (radius: number): number => 0.005 + 0.06 * radius;

/** The number of sides a loft has in the current build mode (the rule `PartBuilder.loft` applies), so a detail can follow the very polygon it sits on. */
export function loftSegments(): number {
  if (PartBuilder.hullMode) return 6;
  return [10, 8, 6][PartBuilder.lod]!;
}

type Sec = ReturnType<typeof ringAt>;

/** Vertex k of a section as the loft makes it (`loftGeometry.ringVertex`): angle 0 is the front (-Z), increasing toward +X. */
function vertex(s: Sec, k: number, seg: number): [number, number] {
  const th = (k / seg) * Math.PI * 2;
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const e = 2 / s.pow;
  return [s.cx + s.rx * Math.sign(sn) * Math.abs(sn) ** e, s.cz - s.rz * Math.sign(cs) * Math.abs(cs) ** e];
}

/** The outward point (x, z) on the polygon of section s at azimuth phi, and the outward unit normal (x, z) of the face it lies on. */
function polygonAt(s: Sec, phi: number, seg: number): { x: number; z: number; nx: number; nz: number } {
  const u = ((((phi / (Math.PI * 2)) % 1) + 1) % 1) * seg;
  const k0 = Math.floor(u);
  const t = u - k0;
  const a = vertex(s, k0, seg);
  const b = vertex(s, k0 + 1, seg);
  const tx = b[0] - a[0];
  const tz = b[1] - a[1];
  const l = Math.hypot(tx, tz) || 1;
  return { x: a[0] + tx * t, z: a[1] + tz * t, nx: tz / l, nz: -tx / l };
}

/**
 * The surface of a limb's loft: `(phi, y, lift)` -> a point `lift` proud of the polygon at azimuth phi (0 the front, +pi/2 the character's right, pi the back) and height y, and the
 * outward unit normal there (tilted by the taper). `rings` is the table the limb is lofted from (any y order).
 */
export function limbSurface(rings: readonly Ring[], seg: number = loftSegments()): (phi: number, y: number, lift: number) => { p: [number, number, number]; n: [number, number, number] } {
  return (phi, y, lift) => {
    const s = ringAt(rings, y);
    const f = polygonAt(s, phi, seg);
    const h = 0.008;
    const s0 = ringAt(rings, y - h);
    const s1 = ringAt(rings, y + h);
    const f0 = polygonAt(s0, phi, seg);
    const f1 = polygonAt(s1, phi, seg);
    // how fast the surface moves along its own normal per metre of height (a cone: the normal tips toward the wide end)
    const drdy = ((f1.x - f0.x) * f.nx + (f1.z - f0.z) * f.nz) / (2 * h);
    let nx = f.nx;
    let ny = -drdy;
    let nz = f.nz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    return { p: [f.x + nx * lift, y + ny * lift, f.z + nz * lift], n: [nx, ny, nz] };
  };
}

export interface BandOptions {
  /** How far the band stands proud of the surface at its top and at its bottom (metres). The bottom defaults to the top. */
  lift?: number;
  liftBottom?: number;
  /** Rolled edges: the band's first and last section sit almost flush with the surface (a folded cuff, a hem), so it reads as cloth laid on the limb and not as a ring around it. Default true. */
  edges?: boolean;
  /** Extra intermediate sections (a long band follows the taper of the limb). Default 0. */
  steps?: number;
  /** Hard edge under the band (a crease in the shading). */
  crease?: boolean;
  /** Colour of the bottom section, if it differs from the top (a shaded fold). */
  colorBottom?: number;
  /** Extra lift in the middle of the band, tapering to nothing at both ends (fur, a knitted roll, a puffed cuff); needs `steps`. */
  bulge?: number;
}

/**
 * A band laid on a limb between two heights, following the limb's own sections: the loft's rings sampled at those heights and pushed out by `lift`. The band has the same number of
 * segments around as the limb (the loft default), so its faces lie parallel to the limb's own faces and never dip into them. `rings` is the table the limb is lofted from.
 */
export function bandOn(b: PartBuilder, rings: readonly Ring[], yTop: number, yBot: number, color: number, o: BandOptions = {}): void {
  const lift0 = o.lift ?? 0.008;
  const lift1 = o.liftBottom ?? lift0;
  const n = 2 + (o.steps ?? 0);
  const out: Ring[] = [];
  const section = (y: number, lift: number, c: number, crease = false): Ring => {
    const s = ringAt(rings, y);
    return { y, rx: s.rx + lift, rz: s.rz + lift, cx: s.cx, cz: s.cz, pow: s.pow, color: c, ...(crease ? { crease: true } : {}) };
  };
  const dir = Math.sign(yBot - yTop) || -1;
  const cTop = tone(color, 1.06);
  const cBot = o.colorBottom ?? tone(color, 0.9);
  if (o.edges !== false) out.push(section(yTop - dir * 0.0015, lift0 * 0.3, tone(color, 0.86)));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = yTop + (yBot - yTop) * t;
    out.push(section(y, lift0 + (lift1 - lift0) * t + (o.bulge ?? 0) * Math.sin(Math.PI * t), i === 0 ? cTop : i === n - 1 ? cBot : color, o.crease === true && i === n - 1));
  }
  if (o.edges !== false) out.push(section(yBot + dir * 0.0015, lift1 * 0.3, tone(color, 0.8)));
  b.loft(out, color, undefined, undefined, undefined, { capBottom: false, capTop: false });
}

/** Euler angles (XYZ, as PartBuilder takes them) that turn a primitive's +Z axis onto the direction n (a flat bead lying on the surface has its thin axis along Z). */
export function faceAlong(n: V3): V3 {
  // Euler XYZ = Rx * Ry * Rz: +Z goes to (sin ry, -cos ry sin rx, cos ry cos rx)
  const ry = Math.asin(Math.max(-1, Math.min(1, n[0])));
  const rx = Math.atan2(-n[1], n[2]);
  return [rx, ry, 0];
}

/** Euler angles (XYZ) that turn a primitive's +Y axis (a cone's tip) onto the direction n. */
export function tipAlong(n: V3): V3 {
  qa.setFromUnitVectors(vb, va.set(n[0], n[1], n[2]).normalize());
  ea.setFromQuaternion(qa, "XYZ");
  return [ea.x, ea.y, ea.z];
}

/** A domed button (a five-sided cone, 10 triangles) of radius r lying on the limb at azimuth phi and height y, `lift` proud of the surface at its base. */
export function buttonOn(b: PartBuilder, surf: ReturnType<typeof limbSurface>, phi: number, y: number, lift: number, r: number, color: number): void {
  const s = surf(phi, y, lift);
  const h = r * 0.7;
  b.cone(r, h, color, [s.p[0] + s.n[0] * h * 0.5, s.p[1] + s.n[1] * h * 0.5, s.p[2] + s.n[2] * h * 0.5], tipAlong(s.n));
}

/**
 * A flat-backed piece (a button, a buckle, a pad) sitting on the limb at azimuth phi and height y: the point `lift` proud of the surface and the rotation that turns the piece's Z axis
 * along the normal there. Add it with `b.sphere(r, c, pos, [w, h, thick], rot)` or `b.box(...)`.
 */
export function mountOn(surf: ReturnType<typeof limbSurface>, phi: number, y: number, lift: number): { pos: V3; rot: V3; n: V3 } {
  const s = surf(phi, y, lift);
  return { pos: s.p, rot: faceAlong(s.n), n: s.n };
}

/**
 * A strip laid along a limb (a stripe, a strap, a cord) at azimuth phi from height yA to yB, sampled at every ring node in between so it follows the taper exactly. `halfWidth` is across
 * the surface, `thick` the half thickness; the strip's inner face sits 2 mm under the surface so it can never lift off.
 */
export function stripOn(b: PartBuilder, rings: readonly Ring[], surf: ReturnType<typeof limbSurface>, phi: number, yA: number, yB: number, halfWidth: number, thick: number, color: number, lift = 0): void {
  const ys = new Set<number>([yA, yB]);
  for (const r of rings) if (r.y < Math.max(yA, yB) - 0.004 && r.y > Math.min(yA, yB) + 0.004) ys.add(r.y);
  const list = [...ys].sort((p, q) => (yA >= yB ? q - p : p - q));
  const pts: V3[] = list.map((y) => surf(phi, y, thick - 0.002 + lift).p);
  // across the surface = the tangent of the polygon (perpendicular to the normal in the section plane)
  const mid = surf(phi, (yA + yB) / 2, 0).n;
  const side: V3 = [-mid[2], 0, mid[0]];
  b.sweep(pts, () => ({ rx: halfWidth, rz: thick, pow: 2.4 }), color, { side, segments: 4 });
}

/** Mean radius of the limb's section at height y (for sizing things that go round it). */
export function radiusAt(rings: readonly Ring[], y: number): number {
  const s = ringAt(rings, y);
  return (s.rx + s.rz) * 0.5;
}

const qa = new Quaternion();
const ea = new Euler();
const va = new Vector3();
const vb = new Vector3(0, 1, 0);

/** A thin box laid between two points (a tassel, a thread, a strap end): `w` across, `t` thick; its length runs from p0 to p1. */
export function boxBetween(b: PartBuilder, p0: V3, p1: V3, w: number, t: number, color: number): void {
  va.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = va.length();
  if (len < 1e-6) return;
  va.divideScalar(len);
  qa.setFromUnitVectors(vb, va);
  ea.setFromQuaternion(qa, "XYZ");
  b.box(w, len, t, color, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], [ea.x, ea.y, ea.z]);
}

export interface PatchOnOptions {
  /** Azimuth of the centre (0 front, +pi/2 right, pi back), the mean radius there (metres: turns arc length into azimuth) and the height of the centre. */
  phi: number;
  radius: number;
  y: number;
  /** Half extents across (arc length) and along the limb, metres. */
  halfW: number;
  halfH: number;
  shape?: "oval" | "rect" | "ring";
  /** For "ring": the inner size as a fraction of the outer. */
  hole?: number;
  /** Turn the shape in the surface (radians). */
  turn?: number;
  lift?: number;
  color: number | ((s: number, y: number) => number);
  thick?: number;
  cells?: number;
}

/**
 * A patch of cloth or leather laid on a limb (a knee patch, an elbow patch, a mend, a mud stain): a masked piece of the limb's own surface, so it hugs a thin arm and a thick one
 * alike and its edge is a smooth curve. Both extents are in metres, so the mask's ramp is even in both directions.
 */
export function patchOn(b: PartBuilder, surf: ReturnType<typeof limbSurface>, o: PatchOnOptions): void {
  const cells = o.cells ?? 8;
  const shape = o.shape ?? "oval";
  const co = Math.cos(o.turn ?? 0);
  const si = Math.sin(o.turn ?? 0);
  const m = Math.min(o.halfW, o.halfH);
  const ext = Math.hypot(o.halfW, o.halfH);
  const sdf = (s: number, y: number): number => {
    const dy = y - o.y;
    const a = s * co + dy * si;
    const d = -s * si + dy * co;
    if (shape === "rect") return Math.min(o.halfW - Math.abs(a), o.halfH - Math.abs(d));
    const e = Math.hypot(a / o.halfW, d / o.halfH);
    if (shape === "ring") return Math.min((1 - e) * m, (e - (o.hole ?? 0.8)) * m);
    return (1 - e) * m;
  };
  const turned = o.turn !== undefined && o.turn !== 0;
  const hw = turned ? ext : o.halfW;
  const hh = turned ? ext : o.halfH;
  b.patch({
    at: (s, y, l) => surf(o.phi + s / o.radius, y, l),
    u0: -hw,
    u1: hw,
    v0: o.y - hh,
    v1: o.y + hh,
    nu: cells,
    nv: cells,
    inside: sdf,
    lift: () => o.lift ?? 0.004,
    color: o.color,
    ...(o.thick !== undefined ? { thick: o.thick } : {}),
  });
}
