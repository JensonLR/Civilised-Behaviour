import { BufferAttribute, BufferGeometry, Color } from "three";
import type { Proportions } from "../proportions.ts";
import { orientOutward } from "./sweep.ts";

/**
 * The head is ONE sculpted surface, not a pile of primitives. Its skin is a star-shaped function r(direction) around the head
 * centre: an egg-shaped base (jaw width follows the spec) plus "brushes", smooth bumps and dents at fixed spots on the face
 * (brow ridge, eye sockets, cheekbones, cheeks, lips, mouth groove, chin ...). Everything that sits on the face - eyes, nose,
 * moustache, scars, plasters - is placed by querying this same function, so nothing floats or sinks.
 *
 * Coordinates are head-centre relative: +X = the character's right... (mirrored features use +-X), +Y up, the face looks toward -Z.
 */

type Vec = readonly [number, number, number];

export type BrushTag = "brow" | "socket" | "cheek" | "forehead" | "lip" | "groove" | "chin" | "plain";

interface Brush {
  /** Direction the brush is centred on (normalised at build). */
  c: Vec;
  /** Extent along x, y, z in unit-sphere coordinates. */
  s: Vec;
  /** Radial displacement in units of R (negative = dent). */
  amp: number;
  mirror: boolean;
  tag: BrushTag;
}

const BRUSHES: readonly Brush[] = [
  { c: [0.36, 0.31, -0.88], s: [0.2, 0.085, 0.22], amp: 0.075, mirror: true, tag: "brow" },
  { c: [0.4, 0.1, -0.91], s: [0.14, 0.12, 0.2], amp: -0.06, mirror: true, tag: "socket" },
  { c: [0.56, -0.14, -0.8], s: [0.2, 0.13, 0.22], amp: 0.06, mirror: true, tag: "cheek" },
  { c: [0.5, -0.38, -0.75], s: [0.24, 0.16, 0.24], amp: 0.05, mirror: true, tag: "cheek" },
  { c: [0, 0.6, -0.8], s: [0.42, 0.24, 0.3], amp: 0.035, mirror: false, tag: "forehead" },
  { c: [0.88, 0.22, -0.4], s: [0.12, 0.2, 0.25], amp: -0.03, mirror: true, tag: "plain" },
  { c: [0, -0.44, -0.88], s: [0.3, 0.17, 0.26], amp: 0.055, mirror: false, tag: "plain" },
  { c: [0, -0.42, -0.9], s: [0.17, 0.045, 0.14], amp: 0.03, mirror: false, tag: "lip" },
  { c: [0, -0.56, -0.85], s: [0.16, 0.05, 0.14], amp: 0.038, mirror: false, tag: "lip" },
  { c: [0, -0.485, -0.87], s: [0.24, 0.02, 0.16], amp: -0.035, mirror: false, tag: "groove" },
  { c: [0, -0.37, -0.92], s: [0.035, 0.06, 0.1], amp: -0.012, mirror: false, tag: "plain" },
  { c: [0, -0.86, -0.48], s: [0.2, 0.14, 0.3], amp: 0.07, mirror: false, tag: "chin" },
  { c: [0, -0.66, -0.75], s: [0.15, 0.03, 0.12], amp: -0.02, mirror: false, tag: "plain" },
  { c: [0.3, -0.38, -0.88], s: [0.045, 0.13, 0.1], amp: -0.02, mirror: true, tag: "plain" },
  { c: [0, 0.05, -0.99], s: [0.06, 0.12, 0.1], amp: 0.03, mirror: false, tag: "plain" },
  { c: [0, 0.22, 0.92], s: [0.5, 0.4, 0.35], amp: 0.06, mirror: false, tag: "plain" },
  { c: [0, 0.85, -0.1], s: [0.5, 0.3, 0.5], amp: 0.03, mirror: false, tag: "plain" },
];

const norm = (v: Vec): Vec => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface HeadShape {
  readonly R: number;
  /** Distance from the head centre to the skin along the unit direction. */
  radius(dx: number, dy: number, dz: number): number;
  /** Skin point where a ray from the front at lateral x, height y (both centre-relative) meets the head. */
  front(x: number, y: number): [number, number, number];
  /** Outward unit normal of the skin near p. */
  normal(p: Vec): [number, number, number];
  /** The tagged brush weights (0..1) at a direction, for colouring. */
  weights(dx: number, dy: number, dz: number): Record<BrushTag, number>;
  /** Half-width of the widest horizontal cross-section of the skull at height y (head-centre relative): the size a hat band must be to clear it. */
  widthAt(y: number): number;
}

const cache = new Map<string, HeadShape>();

/** The head shape for these proportions (memoised: the same head is queried by the skull, hair, beard, wounds and rig). */
export function headShape(P: Proportions): HeadShape {
  const key = `${P.headRadius.toFixed(4)}|${P.jawSize.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const shape = makeShape(P.headRadius, P.jawSize);
  if (cache.size > 200) cache.clear();
  cache.set(key, shape);
  return shape;
}

function makeShape(R: number, jaw: number): HeadShape {
  // 0..1 jaw factor from the spec's 0.7..1.35 range
  const j = (jaw - 0.7) / 0.65;
  const jawWidth = 0.62 + j * 0.33;
  const brushes: (Brush & { c2: Vec })[] = [];
  for (const b of BRUSHES) {
    const c = norm(b.c);
    const amp = b.tag === "chin" ? b.amp * (0.6 + jaw * 0.6) : b.amp;
    brushes.push({ ...b, c, amp, c2: [-c[0], c[1], c[2]] });
  }

  const gauss = (dx: number, dy: number, dz: number, c: Vec, s: Vec): number => {
    const x = (dx - c[0]) / s[0];
    const y = (dy - c[1]) / s[1];
    const z = (dz - c[2]) / s[2];
    return Math.exp(-(x * x + y * y + z * z));
  };

  const radius = (dx: number, dy: number, dz: number): number => {
    // Egg: full width above the eyes, narrowing toward the chin by the jaw factor.
    const t = smooth(0.1, -0.85, dy);
    const ax = 1 - (1 - jawWidth) * t;
    const ay = 1.05;
    const az = dz < 0 ? 0.98 + 0.05 * t * j : 1.0;
    let r = 1 / Math.sqrt((dx / ax) ** 2 + (dy / ay) ** 2 + (dz / az) ** 2);
    for (const b of brushes) {
      r += b.amp * gauss(dx, dy, dz, b.c, b.s);
      if (b.mirror) r += b.amp * gauss(dx, dy, dz, b.c2, b.s);
    }
    return r * R;
  };

  const weights = (dx: number, dy: number, dz: number): Record<BrushTag, number> => {
    const w: Record<BrushTag, number> = { brow: 0, socket: 0, cheek: 0, forehead: 0, lip: 0, groove: 0, chin: 0, plain: 0 };
    for (const b of brushes) {
      let g = gauss(dx, dy, dz, b.c, b.s);
      if (b.mirror) g += gauss(dx, dy, dz, b.c2, b.s);
      w[b.tag] = Math.min(1, w[b.tag] + g);
    }
    return w;
  };

  const inside = (x: number, y: number, z: number): boolean => {
    const l = Math.hypot(x, y, z);
    if (l < 1e-9) return true; // the centre itself
    return l < radius(x / l, y / l, z / l);
  };

  const front = (x: number, y: number): [number, number, number] => {
    // Bisection along the ray z: outside at -2R, inside at the plane through the centre (when the ray hits the head at all).
    let lo = -2 * R;
    let hi = 0;
    if (!inside(x, y, hi)) return [x, y, 0]; // beyond the silhouette: nothing to land on
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inside(x, y, mid)) hi = mid;
      else lo = mid;
    }
    return [x, y, hi];
  };

  const normal = (p: Vec): [number, number, number] => {
    const e = R * 0.01;
    const f = (x: number, y: number, z: number): number => {
      const l = Math.hypot(x, y, z) || 1;
      return l - radius(x / l, y / l, z / l);
    };
    const nx = f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]);
    const ny = f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]);
    const nz = f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e);
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };

  const widthAt = (y: number): number => {
    if (y >= radius(0, 1, 0) - 1e-6) return 0;
    let widest = 0;
    for (const ph of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI]) {
      // Find the elevation where the skin is at height y for this azimuth (radius*sin(theta) is monotonic in theta near the crown).
      let lo = -Math.PI / 2;
      let hi = Math.PI / 2;
      for (let i = 0; i < 28; i++) {
        const th = (lo + hi) / 2;
        const r = radius(Math.sin(ph) * Math.cos(th), Math.sin(th), -Math.cos(ph) * Math.cos(th));
        if (r * Math.sin(th) < y) lo = th;
        else hi = th;
      }
      const th = (lo + hi) / 2;
      const r = radius(Math.sin(ph) * Math.cos(th), Math.sin(th), -Math.cos(ph) * Math.cos(th));
      widest = Math.max(widest, r * Math.cos(th));
    }
    return widest;
  };

  return { R, radius, front, normal, weights, widthAt };
}

/** z (head-centre relative, negative = front) of the face at lateral x, height y. Kept for callers that only need depth. */
export function faceSurfaceZ(P: Proportions, y: number, x = 0): number {
  return headShape(P).front(x, y)[2];
}

// ---- the skull mesh --------------------------------------------------------------------------------------------------------

export interface SkullOptions {
  /** Skin colour (sRGB hex). */
  skin: number;
  /** A coarse grid for the outline hull. */
  coarse?: boolean;
}

/**
 * Colours derived from the skin tone: blush, eye-socket shade and lips. All are RELATIVE shifts of the skin (warmer, deeper,
 * redder), never absolute colours, so dark skin gets a rich warm cheek instead of a sunburn and pale skin a soft pink.
 */
export function skinRamp(skin: number): { skin: Color; blush: Color; shade: Color; lip: Color } {
  const base = new Color(skin);
  const shift = (r: number, g: number, b: number): Color => new Color(Math.min(1, base.r * r), Math.min(1, base.g * g), Math.min(1, base.b * b));
  return {
    skin: base,
    blush: shift(1.1, 0.8, 0.78),
    shade: shift(0.82, 0.72, 0.78),
    lip: shift(0.98, 0.6, 0.62),
  };
}

/** Grid columns are densest at the face (phi = 0), rows densest around the eyes and mouth. */
function gridAngles(n: number, k: number, dense: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    out.push(k * (dense * t + (1 - dense) * t * t * t));
  }
  return out;
}

/** The direction grid shared by the skull and every shell that follows it (hair, beard) so their vertices line up. */
export function skullGrid(coarse = false, shell = false): { cols: number; rows: number; phis: number[]; thetas: number[] } {
  // Shells (hair, beards) use the SAME grid as the skull: their vertices line up with it (no chord gaps for skin to poke through) and beard/hair
  // edges are clipped on a grid fine enough that the staircase disappears.
  const cols = coarse ? 18 : 32;
  const rows = coarse ? 12 : 24;
  return { cols, rows, phis: gridAngles(cols, Math.PI, 0.35), thetas: gridAngles(rows, Math.PI / 2, 0.5) };
}

export function buildSkull(shape: HeadShape, opts: SkullOptions): BufferGeometry {
  const { cols, rows, phis, thetas } = skullGrid(opts.coarse);
  const ramp = skinRamp(opts.skin);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new Color();
  for (let j = 0; j <= rows; j++) {
    const th = thetas[j]!;
    for (let i = 0; i < cols; i++) {
      const ph = phis[i]!;
      const dx = Math.sin(ph) * Math.cos(th);
      const dy = Math.sin(th);
      const dz = -Math.cos(ph) * Math.cos(th);
      const r = shape.radius(dx, dy, dz);
      pos.push(dx * r, dy * r, dz * r);
      const w = shape.weights(dx, dy, dz);
      c.copy(ramp.skin);
      c.lerp(ramp.blush, w.cheek * 0.55);
      c.lerp(ramp.shade, w.socket * 0.7);
      c.lerp(ramp.lip, Math.max(0, w.lip - w.groove * 0.5) * 0.9);
      c.lerp(ramp.shade, w.groove * 0.55);
      c.multiplyScalar(1 + 0.05 * w.forehead + 0.03 * w.brow);
      if (dy < -0.72) c.multiplyScalar(1 - 0.16 * smooth(-0.72, -1, dy)); // under the jaw falls into shadow
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * cols + i;
      const b = j * cols + ((i + 1) % cols);
      idx.push(a, a + cols, b, b, a + cols, b + cols);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(idx);
  orientOutward(geo);
  // Analytic normals from the shape function itself: smoother and truer than averaged face normals, so toon bands run in clean curves.
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const n = shape.normal([pos[i]!, pos[i + 1]!, pos[i + 2]!]);
    nrm[i] = n[0];
    nrm[i + 1] = n[1];
    nrm[i + 2] = n[2];
  }
  geo.setAttribute("normal", new BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return geo;
}
