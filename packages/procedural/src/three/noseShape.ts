import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import type { HeadShape } from "./headShape.ts";
import type { V3 } from "./parts.ts";
import { curve } from "./sweep.ts";

/**
 * The nose as DATA: its spine and cross-sections for a spec on a head. `buildNose` sweeps it; spectacles, pince-nez, monocle chains and nose paint ask it where the
 * bridge really is (`frontZ`), so a pad seats on a button, hooked, flat or roman nose alike.
 */
export interface NoseGeo {
  /** Control points of the spine, bone frame. */
  pts: V3[];
  /** Resampled spine (bone frame). */
  spine: V3[];
  /** Half-width / half-depth of the section at t in 0..1 along the spine. */
  rx(t: number): number;
  rz(t: number): number;
  /** Projection from the face (metres). */
  len: number;
  /** z of the front of the nose bridge at centre-relative height y, or the skin where y is off the nose. */
  frontZ(y: number): number;
  /** Half-width of the nose at centre-relative height y (0 off the nose). */
  widthAt(y: number): number;
  style: Style;
}

export interface Style {
  y: number[];
  f: number[];
  add?: number[];
  rx: number[];
  rz: number[];
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** How the nose swells along its length (0 root .. 1 tip) relative to the style's widths: a slim bridge growing into a rounded ball at the end. */
export const noseSwell = (t: number): number => 0.66 + 0.34 * smooth(0.05, 0.7, t) + 0.3 * smooth(0.72, 0.98, t);

const lerpAt = (arr: readonly number[], t: number): number => {
  const f = Math.max(0, Math.min(1, t)) * (arr.length - 1);
  const i = Math.min(arr.length - 2, Math.floor(f));
  return arr[i]! + (arr[i + 1]! - arr[i]!) * (f - i);
};

/** Spine control points as [y (x R), projection (fraction of L, or metres via `add`)], plus half-widths and depths (x R). */
export const NOSE_STYLES_GEO: Style[] = [
  { y: [0.08, -0.04, -0.2], f: [0, 0.55, 1], add: [-0.02, 0, 0], rx: [0.055, 0.085, 0.115], rz: [0.045, 0.075, 0.105] }, // button
  { y: [0.1, 0.0, -0.14, -0.3, -0.36], f: [0, 0.45, 0.85, 1, 0.8], add: [-0.02, 0, 0, 0, 0], rx: [0.05, 0.06, 0.075, 0.09, 0.075], rz: [0.04, 0.06, 0.075, 0.09, 0.07] }, // hooked
  { y: [0.06, -0.06, -0.22], f: [0, 0.55, 1], add: [-0.02, 0, 0], rx: [0.06, 0.13, 0.21], rz: [0.05, 0.12, 0.2] }, // bulb
  { y: [0.09, -0.02, -0.12, -0.24], f: [0, 0.4, 0.75, 1], add: [-0.02, 0, 0, 0], rx: [0.045, 0.05, 0.055, 0.085], rz: [0.04, 0.05, 0.055, 0.085] }, // long
  { y: [0.02, -0.2], f: [0, 1], add: [-0.02, 0], rx: [0.17, 0.21], rz: [0.035, 0.085] }, // flat
  { y: [0.06, -0.06, -0.24], f: [0, 0.6, 1], add: [-0.02, 0, 0], rx: [0.07, 0.15, 0.22], rz: [0.06, 0.14, 0.21] }, // ruddy lump
  { y: [0.07, -0.03, -0.13, -0.2], f: [0, 0.5, 0.85, 1], add: [-0.02, 0, 0, 0.01], rx: [0.05, 0.075, 0.095, 0.105], rz: [0.045, 0.07, 0.09, 0.095] }, // snub: short and turned up at the tip
  { y: [0.13, 0.03, -0.1, -0.24], f: [0, 0.62, 0.92, 1], add: [-0.02, 0.035, 0, 0], rx: [0.05, 0.05, 0.062, 0.09], rz: [0.045, 0.062, 0.075, 0.085] }, // roman: a high bridge with a bump, then straight and strong
];

const cache = new WeakMap<object, Map<string, NoseGeo>>();

export function noseGeo(P: Proportions, shape: HeadShape, spec: CharacterSpec, cy: number): NoseGeo {
  const key = `${spec.noseStyle}|${P.noseLength.toFixed(4)}`;
  let per = cache.get(shape);
  if (!per) cache.set(shape, (per = new Map()));
  const hit = per.get(key);
  if (hit) return hit;
  const R = P.headRadius;
  const L = Math.max(0.05 * R, Math.min(P.noseLength, 1.5 * R));
  const st = NOSE_STYLES_GEO[spec.noseStyle] ?? NOSE_STYLES_GEO[0]!;
  const len = spec.noseStyle === 4 ? Math.min(L, 0.5 * R) * 0.7 : spec.noseStyle === 0 ? Math.min(L, 0.9 * R) * 0.8 : spec.noseStyle === 6 ? Math.min(L, 0.62 * R) * 0.8 : L;
  const pts: V3[] = st.y.map((yy, i) => {
    const y = yy * R;
    const z = shape.front(0, y)[2] - (st.f[i]! * len + (st.add?.[i] ?? 0) * R);
    return [0, y + cy, z];
  });
  const spine = curve(pts, 9);
  const rx = (t: number): number => lerpAt(st.rx, t) * R * noseSwell(t);
  const rz = (t: number): number => lerpAt(st.rz, t) * R * noseSwell(t);
  const n = spine.length;
  const lookup = (y: number): { t: number; z: number } | undefined => {
    const yb = y + cy;
    for (let i = 0; i + 1 < n; i++) {
      const a = spine[i]!;
      const b = spine[i + 1]!;
      if ((yb <= a[1] && yb >= b[1]) || (yb >= a[1] && yb <= b[1])) {
        const u = Math.abs(a[1] - b[1]) < 1e-9 ? 0 : (yb - a[1]) / (b[1] - a[1]);
        return { t: (i + u) / (n - 1), z: a[2] + (b[2] - a[2]) * u };
      }
    }
    return undefined;
  };
  const geo: NoseGeo = {
    pts,
    spine,
    rx,
    rz,
    len,
    style: st,
    frontZ: (y) => {
      const skin = shape.front(0, y)[2];
      const h = lookup(y);
      if (!h) return skin;
      return Math.min(skin, h.z - rz(h.t) * 0.95);
    },
    widthAt: (y) => {
      const h = lookup(y);
      return h ? rx(h.t) : 0;
    },
  };
  if (per.size > 300) per.clear();
  per.set(key, geo);
  return geo;
}
