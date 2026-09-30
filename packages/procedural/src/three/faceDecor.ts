import { BufferAttribute, BufferGeometry, Color } from "three";
import { PALETTE } from "@cb/shared";
import type { V3 } from "./parts.ts";
import { skinRamp } from "./headShape.ts";
import type { FaceCtx } from "./faceParts.ts";

/**
 * Marks that live ON the skin: freckles, moles, wrinkles, face paint, tattoos and scars. Each is a thin decal - a fan or a strip of triangles whose
 * points are projected onto the sculpted skin (`shape.front`) and lifted a hair off it - so it follows every brow and cheekbone, needs no texture, and
 * rides the face's morph targets (a grin pulls the crow's feet with it). Positions are in units of the head radius, head-centre relative, +x = the
 * character's right; everything here is deterministic (a hash of the look, never Math.random).
 */

type Pt = readonly [number, number];
interface Hit {
  p: V3;
  n: V3;
}
type Project = (u: number, v: number) => Hit | undefined;

/** Deterministic 0..1 hash of an integer. */
const h01 = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const mix = (a: number, b: number, t: number): number => new Color(a).lerp(new Color(b), t).getHex();

/**
 * `soft[i]` (0..1) turns vertex i toward the skin colour: a painted or drawn mark is not a hard-edged sticker, its rim is thinner than its middle, so at a grazing angle,
 * where a flat-coloured decal reads as a floating card, the mark fades into the skin's own shading instead.
 */
function decalGeometry(parts: { pos: number[]; nor: number[]; idx: number[]; soft?: number[] }, color: number, skin?: number): BufferGeometry | undefined {
  if (parts.idx.length === 0) return undefined;
  const c = new Color(color);
  const sk = new Color(skin ?? color);
  const mixed = new Color();
  const n = parts.pos.length / 3;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = parts.soft?.[i] ?? 0;
    mixed.copy(c).lerp(sk, k);
    col[i * 3] = mixed.r;
    col[i * 3 + 1] = mixed.g;
    col[i * 3 + 2] = mixed.b;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(parts.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(parts.nor), 3));
  g.setAttribute("color", new BufferAttribute(col, 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2));
  g.setIndex(parts.idx);
  g.userData.sheet = true;
  return g;
}

/** Winds triangles so their face normal agrees with the surface normal. */
function pushTri(parts: { pos: number[]; nor: number[]; idx: number[] }, a: number, b: number, c: number): void {
  const P = parts.pos;
  const e1: V3 = [P[b * 3]! - P[a * 3]!, P[b * 3 + 1]! - P[a * 3 + 1]!, P[b * 3 + 2]! - P[a * 3 + 2]!];
  const e2: V3 = [P[c * 3]! - P[a * 3]!, P[c * 3 + 1]! - P[a * 3 + 1]!, P[c * 3 + 2]! - P[a * 3 + 2]!];
  const fx = e1[1] * e2[2] - e1[2] * e2[1];
  const fy = e1[2] * e2[0] - e1[0] * e2[2];
  const fz = e1[0] * e2[1] - e1[1] * e2[0];
  const N = parts.nor;
  const dot = fx * (N[a * 3]! + N[b * 3]! + N[c * 3]!) + fy * (N[a * 3 + 1]! + N[b * 3 + 1]! + N[c * 3 + 1]!) + fz * (N[a * 3 + 2]! + N[b * 3 + 2]! + N[c * 3 + 2]!);
  if (dot >= 0) parts.idx.push(a, b, c);
  else parts.idx.push(a, c, b);
}

/** Skin projection of the head's front (and sides): (x, y) in metres, head-centre relative. */
function skinProject(c: FaceCtx, lift: number): Project {
  return (u, v) => {
    const p = c.shape.front(u, v);
    if (p[2] > -c.P.headRadius * 0.05) return undefined; // off the face
    const n = c.shape.normal(p);
    return { p: [p[0] + n[0] * lift, p[1] + n[1] * lift + c.cy, p[2] + n[2] * lift], n };
  };
}

/** A filled polygon (outline in metres) projected onto the surface, as a fan around its centroid. */
export function fan(c: FaceCtx, project: Project, outline: readonly Pt[], color: number, rings = 1, edge = 0.3): void {
  const parts = { pos: [] as number[], nor: [] as number[], idx: [] as number[], soft: [] as number[] };
  const mu = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const mv = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  const centre = project(mu, mv);
  if (!centre) return;
  const push = (h: Hit, soft = 0): number => {
    parts.pos.push(...h.p);
    parts.nor.push(...h.n);
    parts.soft.push(soft);
    return parts.pos.length / 3 - 1;
  };
  const ci = push(centre);
  // Big decals get an inner ring so no triangle spans more than a skull facet or two (a long triangle would sink into the curve between its corners).
  let prev: number[] | undefined;
  for (let r = 1; r <= rings; r++) {
    const k = r / rings;
    const hits = outline.map(([u, v]) => project(mu + (u - mu) * k, mv + (v - mv) * k));
    if (hits.some((h) => !h)) return;
    const ids = hits.map((h) => push(h!, edge * k * k));
    for (let i = 0; i < ids.length; i++) {
      const j = (i + 1) % ids.length;
      if (!prev) pushTri(parts, ci, ids[i]!, ids[j]!);
      else {
        pushTri(parts, prev[i]!, ids[i]!, ids[j]!);
        pushTri(parts, prev[i]!, ids[j]!, prev[j]!);
      }
    }
    prev = ids;
  }
  const g = decalGeometry(parts, color, c.skin);
  if (g) c.b.add(g, color);
}

/** A ribbon along a centre line (metres), `half` half-width (constant or by t), projected onto the surface. */
export function strip(c: FaceCtx, project: Project, lineIn: readonly Pt[], half: number | ((t: number) => number), color: number, edge = 0.3): void {
  if (lineIn.length < 2) return;
  // resample so consecutive rows are at most ~0.06 R apart (see `fan`)
  const step = c.P.headRadius * 0.06;
  const line: Pt[] = [lineIn[0]!];
  for (let i = 1; i < lineIn.length; i++) {
    const a = lineIn[i - 1]!;
    const b = lineIn[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) line.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const parts = { pos: [] as number[], nor: [] as number[], idx: [] as number[], soft: [] as number[] };
  const rows: [number, number, number][] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)]!;
    const b = line[Math.min(line.length - 1, i + 1)]!;
    let tu = b[0] - a[0];
    let tv = b[1] - a[1];
    const l = Math.hypot(tu, tv) || 1;
    tu /= l;
    tv /= l;
    const w = typeof half === "number" ? half : half(i / (line.length - 1));
    const l0 = project(line[i]![0] - tv * w, line[i]![1] + tu * w);
    const lm = project(line[i]![0], line[i]![1]);
    const l1 = project(line[i]![0] + tv * w, line[i]![1] - tu * w);
    if (!l0 || !l1 || !lm) return;
    const ia = parts.pos.length / 3;
    // three vertices across: the rim fades toward the skin, the middle line is the full colour; the ends of the stroke fade too
    const endFade = i === 0 || i === line.length - 1 ? 0.5 : 0;
    parts.pos.push(...l0.p, ...lm.p, ...l1.p);
    parts.nor.push(...l0.n, ...lm.n, ...l1.n);
    parts.soft.push(Math.min(0.8, edge + endFade), endFade * 0.6, Math.min(0.8, edge + endFade));
    rows.push([ia, ia + 1, ia + 2]);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const [a0, a1, a2] = rows[i]!;
    const [b0, b1, b2] = rows[i + 1]!;
    pushTri(parts, a0, b0, a1);
    pushTri(parts, a1, b0, b1);
    pushTri(parts, a1, b1, a2);
    pushTri(parts, a2, b1, b2);
  }
  const g = decalGeometry(parts, color, c.skin);
  if (g) c.b.add(g, color);
}

/** A wobbly round outline: n points, radius r (metres) at (cx, cy), stretched by (sx, sy), deterministic per `seed`. */
function blob(cx: number, cy: number, r: number, seed: number, n = 8, wobble = 0.22, sx = 1, sy = 1): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (h01(seed * 31 + i) - 0.5) * 2 * wobble;
    out.push([cx + Math.cos(a) * r * k * sx, cy + Math.sin(a) * r * k * sy]);
  }
  return out;
}

const star = (cx: number, cy: number, r: number): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 ? 0.42 : 1;
    out.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return out;
};

/** Everything painted, drawn or grown on the face skin. `hairColor` seeds the look of stubble-free skin marks. */
export function buildFaceDecor(c: FaceCtx): void {
  const { spec, P } = c;
  const R = P.headRadius;
  const ramp = skinRamp(c.skin);
  const lift = R * 0.011;
  const front = skinProject(c, lift);
  const seed = spec.skin * 131 + spec.hairColor * 17 + spec.height;
  const speck = mix(c.skin, PALETTE.material.leather, 0.42);

  // ---- complexion -------------------------------------------------------------------------------------------------------------------------
  if (spec.complexion === 1 || spec.complexion === 2) {
    const n = spec.complexion === 1 ? 14 : 30;
    for (let i = 0; i < n; i++) {
      // scatter over the nose bridge and both cheeks, denser near the middle
      const side = h01(seed + i * 5) < 0.5 ? -1 : 1;
      const fx = h01(seed + i * 7 + 1);
      const fy = h01(seed + i * 11 + 2);
      const x = side * (0.06 + fx * fx * 0.5) * R;
      const y = (0.1 - fy * 0.4) * R;
      fan(c, front, blob(x, y, R * (0.013 + 0.014 * h01(seed + i * 3)), seed + i, 5, 0.3), speck, 1, 0.15);
    }
  } else if (spec.complexion === 4) {
    // sun spots: larger, paler patches on the forehead and cheekbones
    const spot = mix(c.skin, PALETTE.material.leather, 0.24);
    for (let i = 0; i < 9; i++) {
      const x = (h01(seed + i * 13) - 0.5) * 1.1 * R;
      const y = (h01(seed + i * 17 + 3) < 0.5 ? 0.35 + h01(seed + i) * 0.4 : -0.05 - h01(seed + i) * 0.2) * R;
      fan(c, front, blob(x, y, R * (0.035 + 0.03 * h01(seed + i * 19)), seed + i * 3, 7, 0.3), spot);
    }
  }

  // ---- skin marks -------------------------------------------------------------------------------------------------------------------------
  if (spec.mark === 1) fan(c, front, blob(0.3 * R, -0.36 * R, R * 0.02, seed, 6, 0.1), PALETTE.material.soot, 1, 0); // a beauty spot beside the mouth
  else if (spec.mark === 2) {
    // a mole on the cheek: dark, a little raised
    const m = skinProject(c, R * 0.02)(-0.52 * R, -0.2 * R);
    if (m) c.b.sphere(R * 0.032, mix(c.skin, PALETTE.material.soot, 0.55), m.p, [1, 1, 0.7]);
  } else if (spec.mark === 3) {
    // a wart on the chin: a pink bump with a dark crown
    const m = skinProject(c, R * 0.03)(-0.16 * R, -0.8 * R);
    if (m) {
      c.b.sphere(R * 0.048, mix(c.skin, PALETTE.trim.blushHot, 0.25), m.p, [1, 1, 0.9]);
      c.b.sphere(R * 0.022, mix(c.skin, PALETTE.material.soot, 0.45), [m.p[0] + m.n[0] * R * 0.03, m.p[1] + m.n[1] * R * 0.03, m.p[2] + m.n[2] * R * 0.03]);
    }
  } else if (spec.mark === 4) fan(c, front, blob(-0.46 * R, -0.02 * R, R * 0.17, seed + 7, 10, 0.3, 1, 1.2), mix(c.skin, PALETTE.trim.rouge, 0.55), 2); // a port-wine birthmark

  // ---- face paint -------------------------------------------------------------------------------------------------------------------------
  const paint = spec.facePaint;
  if (paint === 2) {
    const soot = mix(c.skin, PALETTE.material.soot, 0.55);
    for (const [x, y, r] of [[0.5, -0.26, 0.15], [-0.42, 0.55, 0.13], [0.1, -0.7, 0.11], [-0.55, -0.1, 0.09]] as const) fan(c, front, blob(x * R, y * R, r * R, seed + Math.round(x * 10), 10, 0.3, 1.2, 0.8), soot, 2);
  } else if (paint === 3) {
    for (const sx of [-1, 1]) fan(c, front, blob(sx * 0.5 * R, -0.22 * R, 0.17 * R, 3 + sx, 12, 0.03), mix(c.skin, PALETTE.trim.rouge, 0.75), 2);
  } else if (paint === 4) {
    // chalk stripes: three bars down each cheek
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x = sx * (0.34 + k * 0.13) * R;
        strip(c, front, [[x, 0.02 * R], [x + sx * 0.02 * R, -0.16 * R], [x + sx * 0.03 * R, -0.34 * R]], R * 0.034, PALETTE.trim.zinc);
      }
    }
  } else if (paint === 5) {
    // a sunburnt bridge: a raw red band across the nose and cheekbones
    strip(c, front, [[-0.7 * R, -0.04 * R], [-0.3 * R, -0.09 * R], [0, -0.1 * R], [0.3 * R, -0.09 * R], [0.7 * R, -0.04 * R]], R * 0.11, mix(c.skin, PALETTE.trim.blushHot, 0.72));
  } else if (paint === 6) {
    // a soot mask across the eyes
    strip(c, front, [[-0.8 * R, 0.12 * R], [-0.4 * R, 0.08 * R], [0, 0.06 * R], [0.4 * R, 0.08 * R], [0.8 * R, 0.12 * R]], (t) => R * (0.09 + 0.05 * Math.sin(Math.PI * t)), PALETTE.material.soot);
  }

  // ---- tattoos ----------------------------------------------------------------------------------------------------------------------------
  const ink = PALETTE.face.tattoo;
  if (spec.tattoo === 3) fan(c, front, star(0.6 * R, -0.16 * R, 0.13 * R), ink, 2, 0.12); // a star on the cheek
  else if (spec.tattoo === 5) {
    // a ribbon banner across the brow
    strip(c, front, [[-0.5 * R, 0.55 * R], [-0.2 * R, 0.6 * R], [0.2 * R, 0.6 * R], [0.5 * R, 0.55 * R]], R * 0.045, ink, 0.12);
    strip(c, front, [[-0.5 * R, 0.55 * R], [-0.6 * R, 0.5 * R]], R * 0.03, ink, 0.12);
  } else if (spec.tattoo === 1) {
    // swallows on the side of the jaw under the ear: a pair of little wings, laid on the skull as seen from the side
    for (const sx of [-1, 1]) {
      const project: Project = (z, y) => {
        // (u, v) = (z, y): a ray from the side at depth z and centre-relative height y meets the skull
        const inside = (x: number): boolean => {
          const l = Math.hypot(x, y, z);
          return l < c.shape.radius(x / l, y / l, z / l);
        };
        if (!inside(0.001)) return undefined;
        let lo = 0.001;
        let hi = R * 1.6;
        for (let i = 0; i < 22; i++) {
          const mid = (lo + hi) / 2;
          if (inside(mid)) lo = mid;
          else hi = mid;
        }
        const p: V3 = [sx * lo, y, z];
        const n = c.shape.normal(p);
        return { p: [p[0] + n[0] * lift, p[1] + n[1] * lift + c.cy, p[2] + n[2] * lift], n };
      };
      const cyN = -R * 0.5;
      const zC = R * 0.32;
      fan(c, project, [[zC - 0.16 * R, cyN], [zC - 0.02 * R, cyN + 0.07 * R], [zC + 0.14 * R, cyN + 0.02 * R], [zC + 0.02 * R, cyN - 0.03 * R]], ink);
      fan(c, project, [[zC - 0.2 * R, cyN - 0.1 * R], [zC - 0.05 * R, cyN - 0.03 * R], [zC + 0.1 * R, cyN - 0.08 * R], [zC - 0.02 * R, cyN - 0.16 * R]], ink);
    }
  }

  // ---- scars that need the skin (the raised welts are in head.ts) -----------------------------------------------------------------------------
  if (spec.scars & 128) {
    // a burn: shiny, tight, pale-pink skin over the jaw and cheek
    const burn = mix(c.skin, PALETTE.trim.blushHot, 0.32);
    fan(c, front, blob(0.5 * R, -0.36 * R, 0.22 * R, seed + 5, 10, 0.32, 0.8, 1.15), burn, 2);
    fan(c, front, blob(0.44 * R, -0.58 * R, 0.1 * R, seed + 9, 7, 0.25), mix(burn, ramp.shade.getHex(), 0.3));
  }

  // ---- age --------------------------------------------------------------------------------------------------------------------------------
  const age = spec.age;
  if (age > 40) {
    const line = mix(c.skin, ramp.shade.getHex(), 0.65 + 0.35 * Math.min(1, age / 255));
    const w = R * (0.008 + 0.006 * Math.min(1, age / 255));
    const arcs = age > 190 ? 3 : age > 110 ? 2 : 1;
    for (let k = 0; k < arcs; k++) {
      // forehead lines: shallow arcs above the brows, broken in the middle
      const y = (0.5 + k * 0.1) * R;
      const bow = 0.02 * R;
      strip(c, front, [[-0.48 * R, y - bow], [-0.3 * R, y + bow * 0.4], [-0.1 * R, y + bow]], w, line, 0.12);
      strip(c, front, [[0.1 * R, y + bow], [0.3 * R, y + bow * 0.4], [0.48 * R, y - bow]], w, line, 0.12);
    }
    if (age > 70) {
      // the frown between the brows
      for (const sx of [-1, 1]) strip(c, front, [[sx * 0.05 * R, 0.4 * R], [sx * 0.045 * R, 0.24 * R]], w, line, 0.12);
    }
    if (age > 100) {
      // laughter lines from the nose wings to the mouth corners
      for (const sx of [-1, 1]) strip(c, front, [[sx * 0.2 * R, -0.24 * R], [sx * 0.3 * R, -0.36 * R], [sx * 0.32 * R, -0.5 * R]], w * 1.2, line, 0.12);
    }
    if (age > 140) {
      // crow's feet at the outer corners of the eyes
      for (const sx of [-1, 1]) for (const dy of [-0.07, 0, 0.07]) strip(c, front, [[sx * 0.66 * R, (0.1 + dy) * R], [sx * 0.8 * R, (0.1 + dy * 1.8) * R]], w * 0.8, line, 0.12);
    }
    if (age > 180) {
      // bags under the eyes
      for (const sx of [-1, 1]) strip(c, front, [[sx * 0.28 * R, -0.05 * R], [sx * 0.42 * R, -0.09 * R], [sx * 0.54 * R, -0.05 * R]], w, line, 0.12);
    }
  }
  if (spec.eyeShape === 5) {
    // the "bagged" eye set has its pouches drawn whatever the age
    const line = mix(c.skin, ramp.shade.getHex(), 0.7);
    for (const sx of [-1, 1]) strip(c, front, [[sx * 0.26 * R, -0.06 * R], [sx * 0.4 * R, -0.1 * R], [sx * 0.55 * R, -0.06 * R]], R * 0.014, line, 0.12);
  }
}
