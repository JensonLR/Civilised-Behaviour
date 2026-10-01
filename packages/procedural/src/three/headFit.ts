import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { makeBodyField, type BodyField } from "./fit/bodyField.ts";
import { wornRings } from "./fit/worn.ts";
import type { FaceCtx } from "./faceParts.ts";
import type { HeadShape } from "./headShape.ts";
import { noseGeo, type NoseGeo } from "./noseShape.ts";
import { numericSurface } from "./patch.ts";
import { PartBuilder, type V3 } from "./parts.ts";
import { sweepGeometry, type SweepOptions, type SweepSection } from "./sweep.ts";

/**
 * THE HEAD FIT KIT. Everything that is worn on, or grows from, the head is placed by asking the head itself where it is:
 *
 *  - `section(y)`: the skull's cross-section at a height, as radii from the head axis at N azimuths. Hat crowns, bands, goggle straps and hair curtains are built as
 *    STAR LOFTS through these radii plus a margin, so they follow an egg-shaped, long, narrow, small or huge skull exactly (a hat is no longer a circle of the widest radius).
 *  - `outer(dir, off)`: a point `off` metres beyond the head AS SEEN (skin plus the hair over it), so a strap or a bow lies over the hair, not inside it.
 *  - `clearRadius(...)`: the shoulder-clearance function: how far out from the neck axis something hanging at a height and azimuth has to be to stay off the neck, collar and shoulders.
 *  - `ear(sx)`: the real anchors of an ear (top, lobe, front, outer edge) after it is built, for spectacle arms, earrings, hats and hair.
 *
 * Frames. Head-bone space: origin at the neck joint, +Y up, the face looks toward -Z, the head centre is at (0, R, 0). Azimuth `phi` is measured from the face (0) round to the
 * back (pi); a direction at azimuth phi and centre-relative height y is (sin phi * k, y, -cos phi * k).
 */

export interface EarAnchors {
  /** Highest point of the ear (bone space). */
  top: V3;
  /** Lowest point of the lobe. */
  lobe: V3;
  /** Front edge of the ear where it meets the head, half-way up. */
  front: V3;
  /** Point of the rim farthest from the head. */
  outer: V3;
  /** Rear edge of the rim. */
  back: V3;
  /** Where the ear root meets the skin. */
  root: V3;
  /** Half-height of the ear. */
  size: number;
}

export interface HeadFit {
  readonly c: FaceCtx;
  readonly shape: HeadShape;
  readonly R: number;
  readonly cy: number;
  /** Azimuth samples per ring for the current level of detail. */
  readonly N: number;
  /** Centre-relative height of the top of the skull. */
  readonly skullTop: number;
  /** Skull cross-section radii at a centre-relative height y (metres): N samples, azimuth k * 2pi / N from the face. All zero above the skull. */
  section(y: number): Float64Array;
  /** Set by head.ts once the hair is chosen: how far the hair stands off the skin along a unit direction (metres). */
  hairLift: (dx: number, dy: number, dz: number) => number;
  /** A point `off` metres out from the head as seen (skin + hair) in direction (dx, dy, dz), bone space. */
  outer(dx: number, dy: number, dz: number, off?: number): V3;
  /** The body (torso, neck, arms) worn signed distance of a bone-space point: negative inside. */
  bodyDist(x: number, y: number, z: number): number;
  /** Signed distance to the nearest solid the head fit knows: the skull, the neck, the trunk (negative inside). */
  solidDist(x: number, y: number, z: number): number;
  /** Moves a point out of the skull, neck and trunk until it is `gap` clear of them (a hair root may sink `gap` = 0.75 of its own thickness, no more). */
  pushOut(p: V3, gap: number): V3;
  /** Is the point in front of the face on the head (a ray from the front at lateral x and centre-relative height y meets the skull)? */
  hits(x: number, y: number): boolean;
  /** Smallest radius >= `minR` from the neck axis at which the point at height y (bone space) and azimuth phi, further offset by `gap`, is outside the body. `x0` shifts the ray sideways. */
  clearRadius(phi: number, y: number, minR: number, gap: number, x0?: number): number;
  /** Outer radius (from the head axis) of the hair-covered skull at azimuth phi and bone-space height y; 0 below the skull. */
  headOuter(phi: number, y: number): number;
  /** The radius at which something falls from the head under gravity: see `hangProfile` below. */
  hangProfile(phi: number, ys: readonly number[], o: HangOpts): { rho: number[]; land: number };
  /** Ear anchors for side sx (+1 = the character's right, +x). */
  ear(sx: 1 | -1): EarAnchors;
  /** The nose as data (spine, bridge z at a height): spectacles and pince-nez seat on it. */
  nose(): NoseGeo;
}

export interface HangOpts {
  /** Clearance from the body (metres). */
  gap: number;
  /** Never closer to the axis than this. */
  minR?: number;
  /** The top of a sheet starts this many R inside the hair and comes out of it, so its edge is never a ledge. */
  inset?: number;
  /** How steeply a surface it slides down may lean out (dr/dy) before the strand counts as landed. Infinity: it follows anything (a beard lies on the chest). */
  slope?: number;
  /** Outer radius of what it hangs from, by bone height (default: the hair-covered skull). */
  outer?: (y: number) => number;
  /** Lateral shift of the ray (a strand hanging beside the axis). */
  x0?: number;
  /** The radius may shrink going down (a veil gathering toward the shoulders); default: it never tucks in under what is above it. */
  inward?: boolean;
  /** Where the body would push it out further than this it has landed instead (hair stays near the neck, it does not spread over the shoulders like a cape). */
  maxR?: number;
}

const fits = new WeakMap<FaceCtx, HeadFit>();
const sectionCache = new WeakMap<HeadShape, Map<string, Float64Array>>();
const fieldCache = new WeakMap<object, BodyField>();

/** The number of azimuth samples per ring at the current level of detail. */
export function ringCount(): number {
  return PartBuilder.hullMode ? 10 : PartBuilder.lod >= 2 ? 10 : PartBuilder.lod === 1 ? 14 : 20;
}

/** Radii of a cross-section at height y, by bisection along each azimuth ray (the skull is star-shaped about its centre, so this is well defined). */
function sectionRadii(shape: HeadShape, y: number, n: number): Float64Array {
  const key = `${n}|${y.toFixed(5)}`;
  let per = sectionCache.get(shape);
  if (!per) sectionCache.set(shape, (per = new Map()));
  const hit = per.get(key);
  if (hit) return hit;
  const R = shape.R;
  const out = new Float64Array(n);
  const inside = (x: number, z: number): boolean => {
    const l = Math.hypot(x, y, z);
    if (l < 1e-9) return true; // (the centre itself)
    return l < shape.radius(x / l, y / l, z / l);
  };
  if (y < shape.radius(0, 1, 0) && y > -shape.radius(0, -1, 0) && inside(0, 0)) {
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2;
      const hx = Math.sin(th);
      const hz = -Math.cos(th);
      let lo = 0;
      let hi = 2.2 * R;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        if (inside(hx * mid, hz * mid)) lo = mid;
        else hi = mid;
      }
      out[k] = (lo + hi) / 2;
    }
  }
  if (per.size > 400) per.clear();
  per.set(key, out);
  return out;
}

const sstepH = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Linear interpolation of a ring's radii at azimuth phi (radians from the face, any range). */
export function ringAtAz(r: ArrayLike<number>, phi: number): number {
  const n = r.length;
  let f = (((phi / (Math.PI * 2)) % 1) + 1) % 1;
  f *= n;
  const i = Math.floor(f) % n;
  const t = f - Math.floor(f);
  return r[i]! * (1 - t) + r[(i + 1) % n]! * t;
}

/** The head fit for a face context (memoised on it: the builders of one head share it). */
export function headFit(c: FaceCtx): HeadFit {
  const cached = fits.get(c);
  if (cached) return cached;
  const { shape, P, cy } = c;
  const R = P.headRadius;
  const N = ringCount();
  const skullTop = shape.radius(0, 1, 0);
  let field: BodyField | undefined;
  const getField = (): BodyField => {
    if (field) return field;
    const key = c.spec as object;
    let f = fieldCache.get(key);
    if (!f) {
      f = makeBodyField(c.spec, wornRings(c.spec, true), P);
      fieldCache.set(key, f);
    }
    return (field = f);
  };
  const bodyRegions = ["torso", "neck", "upperArm", "drape"] as const;
  const fit: HeadFit = {
    c,
    shape,
    R,
    cy,
    N,
    skullTop,
    section: (y) => sectionRadii(shape, y, N),
    hairLift: () => 0,
    outer: (dx, dy, dz, off = 0) => {
      const l = Math.hypot(dx, dy, dz) || 1;
      const d: V3 = [dx / l, dy / l, dz / l];
      const r = shape.radius(d[0], d[1], d[2]) + fit.hairLift(d[0], d[1], d[2]);
      return [d[0] * (r + off), d[1] * (r + off) + cy, d[2] * (r + off)];
    },
    bodyDist: (x, y, z) => {
      const f = getField();
      const p = f.toRig("head", [x, y, z]);
      return f.sdf(p, "worn", 1, bodyRegions);
    },
    solidDist: (x, y, z) => {
      const dy = y - cy;
      const l = Math.hypot(x, dy, z) || 1e-9;
      const skull = l - shape.radius(x / l, dy / l, z / l);
      return Math.min(skull, fit.bodyDist(x, y, z));
    },
    pushOut: (p, gap) => {
      let q: V3 = p;
      const e = 0.004;
      for (let it = 0; it < 5; it++) {
        const d = fit.solidDist(q[0], q[1], q[2]);
        if (d >= gap - 1e-4) break;
        const gx = fit.solidDist(q[0] + e, q[1], q[2]) - fit.solidDist(q[0] - e, q[1], q[2]);
        const gy = fit.solidDist(q[0], q[1] + e, q[2]) - fit.solidDist(q[0], q[1] - e, q[2]);
        const gz = fit.solidDist(q[0], q[1], q[2] + e) - fit.solidDist(q[0], q[1], q[2] - e);
        const gl = Math.hypot(gx, gy, gz) || 1;
        const k = (gap - d) / gl;
        q = [q[0] + gx * k, q[1] + gy * k, q[2] + gz * k];
      }
      return q;
    },
    hits: (x, y) => shape.front(x, y)[2] < -1e-9,
    clearRadius: (phi, y, minR, gap, x0 = 0) => {
      const hx = Math.sin(phi);
      const hz = -Math.cos(phi);
      let r = minR;
      // march outward in 5 mm steps until the point is clear of the body by `gap` (the body is convex enough round the neck for this to be a single crossing)
      for (let i = 0; i < 90; i++) {
        if (fit.bodyDist(x0 + hx * r, y, hz * r) > gap) return r;
        r += 0.005;
      }
      return r;
    },
    headOuter: (phi, y) => {
      const yr = y - cy;
      const sec = ringAtAz(fit.section(yr), phi);
      if (sec <= 1e-6) return 0;
      const l = Math.hypot(sec, yr);
      return sec + fit.hairLift((Math.sin(phi) * sec) / l, yr / l, (-Math.cos(phi) * sec) / l);
    },
    hangProfile: (phi, ys, o) => {
      const outer = o.outer ?? ((y: number) => fit.headOuter(phi, y));
      const slope = o.slope ?? 1.25;
      const out: number[] = [];
      let prev = 0;
      // the widest thing above the start (a strand falls from the occiput, not from the hairline)
      const yStart = ys[0]!;
      for (let s = 0; s <= 6; s++) prev = Math.max(prev, outer(yStart + (cy + R * 0.3 - yStart) * (s / 6)));
      prev = Math.max(prev, o.minR ?? 0);
      if (o.inward) prev = outer(yStart);
      // A strand slides down what it lands on: it may follow a surface that leans out by up to `slope` (a back, a sloping shoulder). Where the body juts out further than that
      // (the top of a shoulder) it has landed: it ends there instead of leaping across the shoulder like a cape.
      let land = -Infinity;
      for (let i = 0; i < ys.length; i++) {
        const y = ys[i]!;
        const need = o.inward ? outer(y) + R * 0.005 : Math.max(prev, outer(y) + R * 0.005);
        const r = fit.clearRadius(phi, y, need, o.gap, o.x0 ?? 0);
        const dy = i === 0 ? 1 : ys[i - 1]! - y;
        if (land === -Infinity && i > 0 && (r - prev > slope * dy + 0.006 || (o.maxR !== undefined && r > o.maxR))) land = ys[i - 1]!;
        if (land === -Infinity) prev = r;
        out.push(prev);
      }
      const dil = out.map((v, i) => Math.max(out[Math.max(0, i - 1)]!, v, out[Math.min(out.length - 1, i + 1)]!));
      const soft = dil.map((v, i) => (dil[Math.max(0, i - 1)]! + 2 * v + dil[Math.min(dil.length - 1, i + 1)]!) / 4);
      // (the top of a hanging sheet starts INSIDE the hair on the head and comes out of it, so its edge is never a ledge)
      const span = Math.max(1e-6, ys[0]! - ys[ys.length - 1]!);
      const inset = o.inset ?? 0;
      return { rho: soft.map((v, i) => v - R * inset * (1 - sstepH(0, 0.34, (ys[0]! - ys[i]!) / span))), land };
    },
    ear: (sx) => earAnchors(c, sx),
    nose: () => noseGeo(P, shape, c.spec, cy),
  };
  fits.set(c, fit);
  return fit;
}

// ---- ears ---------------------------------------------------------------------------------------------------------------------------------------

/** Number of outline samples round an ear (the level of detail's). */
const earK = (): number => (PartBuilder.hullMode ? 8 : PartBuilder.lod >= 2 ? 6 : PartBuilder.lod === 1 ? 10 : 14);

const sstepE = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface EarModel {
  /** Layers of the ear from the buried root outward; each an outline of K points in the ear's local frame (y = outward from the head). */
  layers: V3[][];
  /** The bottom of the bowl (local). */
  dish: V3;
  /** Where the ear goes (bone space) and how it is turned (Euler XYZ). */
  pos: V3;
  rot: V3;
  /** Points already in bone space that also count for the anchors (the pointed tip). */
  extra: V3[];
  /** Half-height scale of the ear. */
  es: number;
}

/**
 * An ear as DATA: a dished plate standing off the head (a thick rim round a hollow), sized by `earScale`, reshaped by `earShape`. The builder makes its mesh and every
 * thing that must find the ear (spectacle arms, earrings, hair, hats) reads its anchors, so they cannot disagree. Outline: an egg wider at the top, leaning back.
 */
export function earModel(c: FaceCtx, sx: 1 | -1): EarModel {
  const { P, shape } = c;
  const kind = c.spec.earShape;
  const es = P.earSize * 0.72 * (kind === 3 ? 1.32 : 1);
  const r = shape.radius(sx, 0.02, 0.06);
  const push = kind === 3 ? 1.06 : 1;
  const pos: [number, number, number] = [sx * (r * 0.93 * push), c.cy + P.headRadius * 0.02, P.headRadius * 0.05];
  const rot: V3 = [kind === 3 ? 0.22 : 0.14, sx * (kind === 3 ? 0.95 : kind === 1 ? 0.7 : 0.55), -sx * (Math.PI / 2)];
  const A = 1.6 * es * (kind === 1 ? 1.15 : kind === 4 ? 1.05 : 1);
  const B = 1.0 * es * (kind === 2 ? 1.25 : 1);
  const K = earK();
  // (outward offset, size scale along the height, along the width): root buried in the skull, base, outer edge of the rim, inner edge of the rim, wall of the bowl
  const thickRim = kind === 2 ? 1.5 : 1;
  // the ear stands off the SKIN (not off its own root): the root is sunk `skinO` ear-sizes into the head
  const skinO = (r * (1 - 0.93 * push)) / es;
  const LAYERS: [number, number, number][] = [
    [Math.min(-0.12, skinO - 0.2), 0.78, 0.78],
    [skinO - 0.06, 1.0, 1.0],
    [skinO + 0.58 * thickRim, 1.0, 0.98],
    [skinO + 0.7 * thickRim, 0.83, 0.75], // the helix: a proper rolled rim, thicker than the plate behind it
    [skinO + 0.4 * thickRim, 0.6, 0.52],
  ];
  const layers: V3[][] = LAYERS.map(([o, sa, sb], li) => {
    const ring: V3[] = [];
    for (let k = 0; k < K; k++) {
      const th = (k / K) * Math.PI * 2;
      const pu = Math.cos(th);
      const pw = Math.sin(th);
      let fu = 1;
      let fw = 1 + 0.16 * Math.max(0, pu) - 0.14 * Math.max(0, -pu);
      if (kind === 1) {
        fu += 0.7 * sstepE(0.55, 1, pu);
        fw *= 1 - 0.55 * sstepE(0.6, 1, pu);
      } else if (kind === 4) {
        fu += 0.95 * sstepE(-0.2, -1, pu);
        fw *= 1 - 0.3 * sstepE(-0.4, -1, pu);
      } else if (kind === 2) {
        const lump = 0.11 * Math.sin(3 * th + 1) + 0.06 * Math.sin(5 * th + 2);
        fu *= 1 + lump;
        fw *= 1 + lump;
      }
      // the lobe: the bottom of the ear is a soft rounded drop, a little narrower than the helix above it; inside the bowl the antihelix is a ridge that pinches the wall
      const lobe = sstepE(-0.35, -1, pu);
      if (li !== 4) {
        fu += 0.1 * lobe;
        fw *= 1 - 0.1 * lobe;
      } else {
        fu *= 1 + 0.3 * Math.max(0, Math.sin(th * 2 + 0.9)) * (pu > -0.3 ? 1 : 0.3);
        fw *= 1 - 0.18 * sstepE(0.1, 0.9, Math.cos(th - 0.5));
      }
      const u = A * sa * pu * fu;
      const w = B * sb * pw * fw + 0.12 * B * sb * pu; // the top leans back
      ring.push([-sx * u, o * es, w]);
    }
    return ring;
  });
  const extra: V3[] = [];
  // The ear is hinged at its FRONT edge (that is where it grows from the head): the plate turns about it, so a flared ear (jug, pointed) swings its rear rim out instead of
  // burying its front half in the skull. Then it is moved out along x until its base does not sink into the skull by more than a sliver.
  const pivot = kind === 3 ? 0.85 : kind === 1 ? 0.7 : 0.5;
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  _v.set(0, 0, -B * pivot).applyQuaternion(_q); // where the hinge lands after the turn
  pos[0] += -_v.x;
  pos[1] += -_v.y;
  pos[2] += -B * pivot - _v.z; // ... and where it should be: straight in front of the ear's centre
  const model: EarModel = { layers, dish: [0, (skinO + 0.06) * es, 0.1 * B], pos, rot, extra, es };
  // outward shift: the base layer (index 1) and the rim (2) must not sink deeper than 0.1 es into the skull
  const pts = earPoints({ ...model, layers: layers.slice(1, 3), dish: layers[2]![0]! });
  let deepest = 0;
  for (const p of pts) {
    const dy = p[1] - c.cy;
    const l = Math.hypot(p[0], dy, p[2]) || 1e-9;
    deepest = Math.max(deepest, shape.radius(p[0] / l, dy / l, p[2] / l) - l);
  }
  const shift = Math.max(0, deepest - 0.1 * es);
  pos[0] += sx * shift;
  return model;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _v = new Vector3();
const _one = new Vector3(1, 1, 1);

/** All vertices of an ear model in bone space (the same transform PartBuilder.add applies). */
export function earPoints(m: EarModel): V3[] {
  _e.set(m.rot[0], m.rot[1], m.rot[2]);
  _q.setFromEuler(_e);
  _m.compose(_v.set(m.pos[0], m.pos[1], m.pos[2]), _q, _one);
  const out: V3[] = [];
  const p = new Vector3();
  for (const layer of m.layers) {
    for (const l of layer) {
      p.set(l[0], l[1], l[2]).applyMatrix4(_m);
      out.push([p.x, p.y, p.z]);
    }
  }
  p.set(m.dish[0], m.dish[1], m.dish[2]).applyMatrix4(_m);
  out.push([p.x, p.y, p.z]);
  return [...out, ...m.extra];
}

function earAnchors(c: FaceCtx, sx: 1 | -1): EarAnchors {
  const m = earModel(c, sx);
  // the rim layers (outer edge of the rim and the base) define the extremes; the buried root does not count
  const pts = earPoints({ ...m, layers: m.layers.slice(1, 3), dish: m.layers[2]![0]! });
  let top = pts[0]!;
  let lobe = pts[0]!;
  let outer = pts[0]!;
  let front = pts[0]!;
  let back = pts[0]!;
  for (const p of pts) {
    if (p[1] > top[1]) top = p;
    if (p[1] < lobe[1]) lobe = p;
    if (Math.abs(p[0]) > Math.abs(outer[0])) outer = p;
    if (p[2] > back[2]) back = p;
  }
  const lo = lobe[1] + (top[1] - lobe[1]) * 0.3;
  const hi = lobe[1] + (top[1] - lobe[1]) * 0.75;
  let found = false;
  for (const p of pts) {
    if (p[1] >= lo && p[1] <= hi && (!found || p[2] < front[2])) {
      front = p;
      found = true;
    }
  }
  return { top, lobe, outer, front, back, root: m.pos, size: m.es };
}

// ---- star lofts and brims --------------------------------------------------------------------------------------------------------------------

export interface StarRing {
  /** Bone-space height. */
  y: number;
  /** Radii from the head axis at the fit's N azimuths (k * 2pi / N from the face). */
  r: ArrayLike<number>;
  color?: number;
  /** Per-vertex colours (override `color`). */
  colors?: ArrayLike<number>;
  /** Per-vertex height offsets (a brim turned up at the sides, the ends of a bicorne). */
  dy?: ArrayLike<number>;
  /** Shifts the ring centre (bone space x, z). */
  cx?: number;
  cz?: number;
}

export interface StarOptions {
  color: number;
  /** "dome": the top closes to a point with shared (smooth) normals; "flat": a flat lid; "none": open. */
  top?: "dome" | "flat" | "none";
  bottom?: "flat" | "none";
  /** Height of the dome's apex (default: the last ring's height). */
  apexY?: number;
}

const col = new Color();

/**
 * A closed tube through rings of arbitrary (star-shaped) outline: the hat crown that follows the skull, the band round it, a hair curtain. Same vertex layout and winding as
 * `loftGeometry` (ring vertex k at angle 2pi k / n from the face, rings stacked upward), so the faces point outward.
 */
export function starLoft(rings: readonly StarRing[], o: StarOptions): BufferGeometry {
  const n = rings[0]!.r.length;
  const pos: number[] = [];
  const colr: number[] = [];
  const index: number[] = [];
  for (const g of rings) {
    for (let k = 0; k < n; k++) {
      col.setHex(g.colors ? g.colors[k]! : (g.color ?? o.color));
      const th = (k / n) * Math.PI * 2;
      const r = g.r[k]!;
      pos.push((g.cx ?? 0) + Math.sin(th) * r, g.y + (g.dy ? g.dy[k]! : 0), (g.cz ?? 0) - Math.cos(th) * r);
      colr.push(col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k;
      const b = i * n + ((k + 1) % n);
      index.push(a, a + n, b, b, a + n, b + n);
    }
  }
  const top = o.top ?? "flat";
  const last = rings[rings.length - 1]!;
  if (top === "dome") {
    const centre = pos.length / 3;
    pos.push(last.cx ?? 0, o.apexY ?? last.y, last.cz ?? 0);
    col.setHex(last.color ?? o.color);
    colr.push(col.r, col.g, col.b);
    const base = (rings.length - 1) * n;
    for (let k = 0; k < n; k++) index.push(centre, base + ((k + 1) % n), base + k);
  } else if (top === "flat") {
    const centre = pos.length / 3;
    pos.push(last.cx ?? 0, last.y, last.cz ?? 0);
    col.setHex(last.color ?? o.color);
    colr.push(col.r, col.g, col.b);
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2;
      pos.push((last.cx ?? 0) + Math.sin(th) * last.r[k]!, last.y, (last.cz ?? 0) - Math.cos(th) * last.r[k]!);
      colr.push(col.r, col.g, col.b);
    }
    for (let k = 0; k < n; k++) index.push(centre, base + ((k + 1) % n), base + k);
  }
  if (o.bottom === "flat") {
    const first = rings[0]!;
    const centre = pos.length / 3;
    pos.push(first.cx ?? 0, first.y, first.cz ?? 0);
    col.setHex(first.color ?? o.color);
    colr.push(col.r, col.g, col.b);
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2;
      pos.push((first.cx ?? 0) + Math.sin(th) * first.r[k]!, first.y, (first.cz ?? 0) - Math.cos(th) * first.r[k]!);
      colr.push(col.r, col.g, col.b);
    }
    for (let k = 0; k < n; k++) index.push(centre, base + k, base + ((k + 1) % n));
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(colr), 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return geo;
}

/** Adds a star loft to the builder (LOD-aware: the ring count is already the level's). */
export function addStar(b: PartBuilder, rings: readonly StarRing[], o: StarOptions): void {
  PartBuilder.auditKind = "loft";
  b.add(starLoft(rings, o), o.color);
}

/** Radii scaled and offset: a new ring outline from an old one. */
export function ringMap(r: ArrayLike<number>, f: (r: number, k: number, phi: number) => number): Float64Array {
  const n = r.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = f(r[k]!, k, (k / n) * Math.PI * 2);
  return out;
}

export interface BrimSpec {
  /** Bone-space height of the brim's root. */
  y: number;
  /** Radii of the root ring (the crown wall at the band). */
  inner: ArrayLike<number>;
  /** Width of the brim at azimuth phi (metres), 0 where there is none. */
  width(phi: number): number;
  /** Vertical displacement at (phi, s), s = 0 at the root .. 1 at the edge (metres; negative droops). */
  rise?(phi: number, s: number): number;
  /** Extra width fraction that follows s (default linear). */
  thick: number;
  color: number | ((phi: number, s: number) => number);
  lining?: number;
  nu?: number;
  nv?: number;
  /** Which edges get a rim (default all). */
  rim?(phi: number, s: number): boolean;
}

/**
 * A brim: a two-layer sheet of felt from the crown wall outward, a patch on the polar surface (phi, s). Its width, droop and curl are functions, so the same call makes a
 * top hat's rolled brim, a pith helmet's broad shelf, a peaked cap's visor (width 0 outside the front) or a sou'wester's tail.
 */
export function addBrim(b: PartBuilder, o: BrimSpec, silhouette = true): (phi: number, s: number, lift?: number) => V3 {
  const n = o.inner.length;
  const surf = numericSurface((phi, sRaw): V3 => {
    const s = Math.max(0, Math.min(1, sRaw)); // (the numeric normal probes a hair outside 0..1)
    const rho = ringAtAz(o.inner, phi) - 0.004 + (o.width(phi) + 0.004) * s;
    return [Math.sin(phi) * rho, o.y + (o.rise?.(phi, s) ?? 0), -Math.cos(phi) * rho];
  });
  const lod = PartBuilder.lod;
  b.patch(
    {
      at: (u, v, lift) => surf(u, v, lift),
      u0: 0,
      u1: Math.PI * 2,
      v0: 0,
      v1: 1,
      nu: o.nu ?? Math.max(10, n),
      nv: o.nv ?? 2,
      wrap: true,
      lift: () => 0,
      color: typeof o.color === "number" ? o.color : o.color,
      thick: o.thick,
      lining: o.lining,
      rim: o.rim ?? (() => true),
    },
    silhouette,
  );
  return (phi, s, lift = 0) => surf(phi, s, lift).p;
}

/** A unit vector helper used by builders that place things on the crown. */
export { norm3 };

/**
 * A swept tube that is CONFORMED to the body: every vertex of the finished tube is moved out of the skull, neck and coat until it is `gap` clear (HeadFit.pushOut). A wide
 * beard, a weeper or a tail then lies on the chest and the jaw instead of passing through them at its edges, whatever the head or the body. (Same level-of-detail rules as
 * PartBuilder.sweep.)
 */
export function addConformedSweep(b: PartBuilder, hf: HeadFit, spine: readonly V3[], section: (t: number, i: number) => SweepSection, color: number, opts: Partial<SweepOptions>, gap: number): void {
  const lod = PartBuilder.lod;
  if (lod > 0 || PartBuilder.hullMode) {
    let r = 0;
    for (let k = 0; k <= 3; k++) {
      const sec = section(k / 3, Math.round((k / 3) * (spine.length - 1)));
      r = Math.max(r, sec.rx, sec.rz);
    }
    if (2 * r < (PartBuilder.hullMode ? 0.04 : [0, 0.05, 0.12][lod]!)) return;
  }
  const want = opts.segments ?? [6, 5, 4][lod]!;
  const segments = PartBuilder.hullMode ? Math.min(want, 5) : Math.min(want, [8, 5, 4][lod]!);
  const geo = sweepGeometry(spine, section, { color, ...opts, segments, ...(lod > 0 || PartBuilder.hullMode ? { coarseDome: true } : {}) });
  const pos = geo.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const q = hf.pushOut([pos.getX(i), pos.getY(i), pos.getZ(i)], gap);
    pos.setXYZ(i, q[0], q[1], q[2]);
  }
  geo.computeVertexNormals();
  PartBuilder.auditKind = "sweep";
  b.add(geo, color);
}
