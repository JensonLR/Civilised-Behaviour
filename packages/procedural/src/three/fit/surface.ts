import { Euler, Quaternion, Vector3 } from "three";
import { PartBuilder, type V3 } from "../parts.ts";
import { ringAt, ringSurface } from "../bodyKit.ts";
import type { Ring } from "../loft.ts";

/**
 * The surface of a lofted trunk AS DRAWN: a loft is a polygon (10 or 16 sides), so a detail laid on the analytic superellipse would hover up to a few centimetres off a flat
 * between two vertices, or sink into it. `polySurface(rings, seg)` answers with the POLYGON's surface (the chord between the two neighbouring vertices), so buttons, plates,
 * straps and pockets sit flush on the very faces the player sees, on any body. Everything on the torso is placed through this (see also `LAYER` in layers.ts for the lifts).
 */

/** Sides of the torso loft in the current build mode: 14 at full detail (a fat belly is round, not a decagon), fewer for crowds, 6 in the outline hull. */
export function torsoSegments(): number {
  if (PartBuilder.hullMode) return 6;
  return [14, 8, 6][PartBuilder.lod]!; // (PartBuilder.loft caps lofts at 8 sides at LOD1 and 6 at LOD2: the surface must be the polygon that is drawn)
}

type Sec = ReturnType<typeof ringAt>;

function vertex(s: Sec, k: number, seg: number): [number, number] {
  const th = (k / seg) * Math.PI * 2;
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const e = 2 / s.pow;
  return [s.cx + s.rx * Math.sign(sn) * Math.abs(sn) ** e, s.cz - s.rz * Math.sign(cs) * Math.abs(cs) ** e];
}

/** The outward point (x, z) on the polygon of section s at azimuth phi and the outward unit normal (x, z) of the face it lies on. */
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

export interface SurfPoint {
  p: [number, number, number];
  n: [number, number, number];
  /** The azimuth of the point (0 front, +pi/2 the character's right, pi the back). */
  phi: number;
}

export interface Surf {
  /** Point `lift` proud of the polygon at azimuth phi and height y, with the face's outward normal (tilted by the taper). */
  at(phi: number, y: number, lift?: number): SurfPoint;
  /** The point at lateral offset x (metres, +x the character's right) on the front (default) or the back, at height y. */
  atX(x: number, y: number, lift?: number, back?: boolean): SurfPoint;
  /** z of the front surface at lateral offset x (negative = toward the viewer) and of the back (positive). */
  front(y: number, x?: number): number;
  back(y: number, x?: number): number;
  /** The SMOOTH outward normal of the section surface at (phi, y): shading normals and the side axis of a ribbon (the polygon's face normals jump at every edge and would twist a strap). */
  normal(phi: number, y: number): V3;
  /** The interpolated section at height y. */
  section(y: number): Sec;
  rings: readonly Ring[];
  seg: number;
}

export function polySurface(rings: readonly Ring[], seg: number = torsoSegments()): Surf {
  const sec = (y: number): Sec => ringAt(rings, y);
  const at = (phi: number, y: number, lift = 0): SurfPoint => {
    const s = sec(y);
    const f = polygonAt(s, phi, seg);
    const h = 0.008;
    const f0 = polygonAt(sec(y - h), phi, seg);
    const f1 = polygonAt(sec(y + h), phi, seg);
    // how fast the surface moves along its own normal per metre of height (a cone: the normal tips toward the wide end)
    const drdy = ((f1.x - f0.x) * f.nx + (f1.z - f0.z) * f.nz) / (2 * h);
    let nx = f.nx;
    let ny = -drdy;
    let nz = f.nz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    return { p: [f.x + nx * lift, y + ny * lift, f.z + nz * lift], n: [nx, ny, nz], phi };
  };
  const smooth = ringSurface([...rings].sort((a, b) => a.y - b.y));
  const xAt = (phi: number, y: number): number => polygonAt(sec(y), phi, seg).x;
  /** Bisection on the (monotone) lateral position along the front half (-pi/2 .. pi/2) or the back half. */
  const phiOfX = (x: number, y: number, back: boolean): number => {
    const s = sec(y);
    const lo0 = back ? Math.PI * 0.5 : -Math.PI * 0.5;
    const hi0 = back ? Math.PI * 1.5 : Math.PI * 0.5;
    const xl = xAt(lo0, y);
    const xh = xAt(hi0, y);
    // front: x grows with phi; back: x falls with phi
    const inc = xh > xl;
    if (x >= Math.max(xl, xh)) return inc ? hi0 : lo0;
    if (x <= Math.min(xl, xh)) return inc ? lo0 : hi0;
    let lo = lo0;
    let hi = hi0;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const xm = polygonAt(s, mid, seg).x;
      if (xm < x === inc) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return {
    at,
    atX: (x, y, lift = 0, back = false) => at(phiOfX(x, y, back), y, lift),
    front: (y, x = 0) => polygonAt(sec(y), phiOfX(x, y, false), seg).z,
    back: (y, x = 0) => polygonAt(sec(y), phiOfX(x, y, true), seg).z,
    normal: (phi, y) => smooth(phi, y, 0).n,
    section: sec,
    rings,
    seg,
  };
}

/** Euler angles (XYZ, as PartBuilder takes them) that turn a primitive's +Z axis onto the direction n (a flat plate lying on the surface has its thin axis along Z). */
export function faceAlong(n: V3): V3 {
  const ry = Math.asin(Math.max(-1, Math.min(1, n[0])));
  const rx = Math.atan2(-n[1], n[2]);
  return [rx, ry, 0];
}

const qa = new Quaternion();
const ea = new Euler();
const yAxis = new Vector3(0, 1, 0);
const vd = new Vector3();
/** Euler angles (XYZ) that turn a primitive's +Y axis onto the direction n (a cone or a cylinder standing out of a surface, a strap end hanging along a direction). */
export function alongY(n: V3): V3 {
  vd.set(n[0], n[1], n[2]);
  if (vd.lengthSq() < 1e-12) return [0, 0, 0];
  qa.setFromUnitVectors(yAxis, vd.normalize());
  ea.setFromQuaternion(qa, "XYZ");
  return [ea.x, ea.y, ea.z];
}

/**
 * A flat-backed piece on the surface: where to put a primitive (`pos`, `lift` = distance of its CENTRE from the surface) and how to turn it so its Z axis points out of the
 * surface (`faceAlong`). Add it with `b.box(w, h, d, colour, pos, rot)`.
 */
export function mount(s: SurfPoint): { pos: V3; rot: V3; n: V3 } {
  return { pos: s.p, rot: faceAlong(s.n), n: s.n };
}

/**
 * A surface for masked cloth PATCHES (waistcoat fronts, lapels, collars): positions on the polygon as drawn (so a patch a few millimetres proud never floats off the flat between two
 * vertices or sinks into it), normals from the smooth analytic section (so it shades exactly like the smooth-shaded loft under it and no seam shows).
 */
export function patchSurface(rings: readonly Ring[], seg: number = torsoSegments()): (phi: number, y: number, lift: number) => { p: V3; n: V3 } {
  const poly = polySurface(rings, seg);
  const smooth = ringSurface([...rings].sort((a, b) => a.y - b.y));
  return (phi, y, lift) => {
    const a = poly.at(phi, y, 0);
    const n = smooth(phi, y, 0).n;
    return { p: [a.p[0] + n[0] * lift, a.p[1] + n[1] * lift, a.p[2] + n[2] * lift], n };
  };
}
