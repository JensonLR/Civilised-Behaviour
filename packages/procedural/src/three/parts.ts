import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { PALETTE } from "@cb/shared";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loftGeometry, type Ring } from "./loft.ts";
import { sweepGeometry, type SweepOptions, type SweepSection } from "./sweep.ts";

export type V3 = readonly [number, number, number];

/** Primitives smaller than this (metres, bounding radius) are left out of the outline hull. */
export const SILHOUETTE_MIN_RADIUS = 0.055;

/** Deterministic 0..1 hash (no Math.random: geometry must be identical every time a spec is built). */
const h01 = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const v = new Vector3();
const s = new Vector3();

/**
 * Accumulates coloured primitives and merges them into ONE geometry with a per-vertex colour attribute.
 * One draw call per bone regardless of how many hats, medals and moustaches sit on it.
 */
export class PartBuilder {
  /**
   * While true, builders produce the OUTLINE HULL: primitives below SILHOUETTE_MIN_RADIUS are dropped and the rest are
   * tessellated coarsely (a line does not need smooth curvature). Set by the rig around a second run of a bone's builder.
   */
  static hullMode = false;

  private readonly parts: BufferGeometry[] = [];
  private seq = 0;

  /** Adds a primitive. Geometry is consumed (transformed in place then disposed after merge). */
  add(geo: BufferGeometry, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    if (PartBuilder.hullMode && primitiveRadius(geo, scale) < SILHOUETTE_MIN_RADIUS) {
      geo.dispose();
      return this;
    }
    e.set(rot[0], rot[1], rot[2]);
    q.setFromEuler(e);
    v.set(pos[0], pos[1], pos[2]);
    s.set(scale[0], scale[1], scale[2]);
    m4.compose(v, q, s);
    geo.applyMatrix4(m4);
    const c = new Color(color);
    const n = geo.attributes.position!.count;
    const normals = geo.attributes.normal!;
    const own = geo.attributes.color; // lofts carry per-section colours; everything else is one flat colour
    const colors = new Float32Array(n * 3);
    // Clay feel: a barely-there per-primitive tint (a few percent: enough to break up big flat areas, small enough that
    // skin never looks camouflaged) and every vertex is shaded by which way it faces: undersides darken (contact/occlusion
    // cue under brims, chins, bellies), tops lift a touch.
    const tint = 1 + (h01(this.seq++ * 7919 + Math.round(pos[1] * 1000)) - 0.5) * 0.04;
    for (let i = 0; i < n; i++) {
      const ny = normals.getY(i);
      const shade = tint * (ny < 0 ? 1 + ny * 0.22 : 1 + ny * 0.03); // toon lighting does the modelling; this only adds contact darkening underneath
      if (own) c.setRGB(own.getX(i), own.getY(i), own.getZ(i));
      colors[i * 3] = Math.min(1, c.r * shade);
      colors[i * 3 + 1] = Math.min(1, c.g * shade);
      colors[i * 3 + 2] = Math.min(1, c.b * shade);
    }
    geo.setAttribute("color", new BufferAttribute(colors, 3));
    // Drop UVs: nothing samples textures, and mismatched attribute sets break merging.
    geo.deleteAttribute("uv");
    this.parts.push(geo);
    return this;
  }

  /** Tessellation scales with the *world-space* size of the primitive: big shapes stay round, tiny ones stay cheap. */
  sphere(r: number, color: number, pos?: V3, scale?: V3, rot?: V3): this {
    const size = r * Math.max(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1);
    const [w, h] = PartBuilder.hullMode ? (size >= 0.18 ? [8, 5] : [6, 4]) : size >= 0.18 ? [12, 8] : size >= 0.06 ? [8, 6] : [6, 4];
    return this.add(new SphereGeometry(r, w, h), color, pos, rot, scale);
  }
  box(w: number, h: number, d: number, color: number, pos?: V3, rot?: V3): this {
    return this.add(new BoxGeometry(w, h, d), color, pos, rot);
  }
  cylinder(rTop: number, rBottom: number, h: number, color: number, pos?: V3, rot?: V3, scale?: V3, openEnded = false): this {
    const r = Math.max(rTop, rBottom);
    const radial = PartBuilder.hullMode ? (r >= 0.15 ? 8 : 6) : r >= 0.15 ? 12 : r >= 0.05 ? 8 : 6;
    return this.add(new CylinderGeometry(rTop, rBottom, h, radial, 1, openEnded), color, pos, rot, scale);
  }
  cone(r: number, h: number, color: number, pos?: V3, rot?: V3, scale?: V3): this {
    return this.add(new ConeGeometry(r, h, PartBuilder.hullMode ? 5 : r >= 0.1 ? 8 : 5, 1), color, pos, rot, scale);
  }
  torus(r: number, tube: number, color: number, pos?: V3, rot?: V3, scale?: V3, arc = Math.PI * 2): this {
    const radial = Math.max(8, Math.round((r * Math.max(scale?.[0] ?? 1, scale?.[1] ?? 1) >= 0.2 ? 18 : 12) * Math.min(1, arc / Math.PI + 0.2)));
    return this.add(new TorusGeometry(r, tube, PartBuilder.hullMode ? 3 : 4, PartBuilder.hullMode ? Math.max(6, Math.round(radial * 0.6)) : radial, arc), color, pos, rot, scale);
  }
  /** A smooth lofted form through cross-sections (see loft.ts): coats, sleeves, trouser legs, boots. */
  loft(rings: readonly Ring[], color: number, pos?: V3, rot?: V3, scale?: V3, opts: { capBottom?: boolean; capTop?: boolean } = {}): this {
    const segments = PartBuilder.hullMode ? 6 : 10;
    return this.add(loftGeometry(rings, { color, segments, ...opts }), color, pos, rot, scale);
  }
  /** A tube swept along a spine with a tapering cross-section (see sweep.ts): moustaches, brows, noses, hair locks, beards. */
  sweep(spine: readonly V3[], section: (t: number, i: number) => SweepSection, color: number, opts: Partial<SweepOptions> = {}): this {
    return this.add(sweepGeometry(spine, section, { color, segments: PartBuilder.hullMode ? 5 : 6, ...opts }), color);
  }
  /** Capsule-like limb segment from (0,0,0) down to (0,-len,0): a stretched sphere pair via cylinder + caps. */
  limb(rTop: number, rBottom: number, len: number, color: number, pos: V3 = [0, 0, 0]): this {
    this.cylinder(rTop, rBottom, len, color, [pos[0], pos[1] - len / 2, pos[2]], undefined, undefined, true); // ends hidden inside the joint spheres
    this.sphere(rTop, color, [pos[0], pos[1], pos[2]]);
    this.sphere(rBottom, color, [pos[0], pos[1] - len, pos[2]]);
    return this;
  }

  get count(): number {
    return this.parts.length;
  }

  /** Merges everything into one geometry (or undefined if empty). */
  build(): BufferGeometry | undefined {
    if (this.parts.length === 0) return undefined;
    // All Three primitives used here are indexed with position/normal/color, which mergeGeometries requires to match.
    const merged = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    if (!merged) return undefined;
    if (PartBuilder.hullMode) merged.deleteAttribute("color"); // hulls are drawn in one flat colour
    addOutlineNormals(merged);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** Darkens a colour toward soot for singed clothing (level 0..3). */
export function singe(color: number, level: number): number {
  if (level <= 0) return color;
  const c = new Color(color);
  const k = [1, 0.72, 0.42, 0.22][level] ?? 0.22;
  c.multiplyScalar(k);
  return c.getHex();
}

export const LEATHER: number = PALETTE.material.leather;
export const WOOD: number = PALETTE.material.wood;
export const CREAM: number = PALETTE.material.cream;
export const SOOT: number = PALETTE.material.soot;

/**
 * Adds `onormal`: the vertex normal averaged over every vertex at the same position. Box/cylinder faces have split
 * normals, so pushing an outline hull along the ordinary normal would open cracks at hard edges; the averaged
 * normal moves coincident vertices together and keeps the hull closed.
 */
export function addOutlineNormals(geo: BufferGeometry): void {
  const pos = geo.attributes.position!;
  const nor = geo.attributes.normal!;
  const acc = new Map<string, [number, number, number]>();
  const key = (i: number): string => `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const a = acc.get(k);
    if (a) {
      a[0] += nor.getX(i);
      a[1] += nor.getY(i);
      a[2] += nor.getZ(i);
    } else acc.set(k, [nor.getX(i), nor.getY(i), nor.getZ(i)]);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(key(i))!;
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / len;
    out[i * 3 + 1] = a[1] / len;
    out[i * 3 + 2] = a[2] / len;
  }
  geo.setAttribute("onormal", new BufferAttribute(out, 3));
}

/** Approximate world-space bounding radius of an untransformed primitive after `scale` (used to cull tiny hull parts). */
function primitiveRadius(geo: BufferGeometry, scale: V3 | undefined): number {
  geo.computeBoundingSphere();
  const r = geo.boundingSphere?.radius ?? 0;
  return r * Math.max(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1);
}
