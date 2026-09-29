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
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type V3 = readonly [number, number, number];

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
  private readonly parts: BufferGeometry[] = [];

  /** Adds a primitive. Geometry is consumed (transformed in place then disposed after merge). */
  add(geo: BufferGeometry, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    e.set(rot[0], rot[1], rot[2]);
    q.setFromEuler(e);
    v.set(pos[0], pos[1], pos[2]);
    s.set(scale[0], scale[1], scale[2]);
    m4.compose(v, q, s);
    geo.applyMatrix4(m4);
    const c = new Color(color);
    const n = geo.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
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
    const [w, h] = size >= 0.18 ? [12, 8] : size >= 0.06 ? [8, 6] : [6, 4];
    return this.add(new SphereGeometry(r, w, h), color, pos, rot, scale);
  }
  box(w: number, h: number, d: number, color: number, pos?: V3, rot?: V3): this {
    return this.add(new BoxGeometry(w, h, d), color, pos, rot);
  }
  cylinder(rTop: number, rBottom: number, h: number, color: number, pos?: V3, rot?: V3, scale?: V3, openEnded = false): this {
    const r = Math.max(rTop, rBottom);
    return this.add(new CylinderGeometry(rTop, rBottom, h, r >= 0.15 ? 12 : r >= 0.05 ? 8 : 6, 1, openEnded), color, pos, rot, scale);
  }
  cone(r: number, h: number, color: number, pos?: V3, rot?: V3, scale?: V3): this {
    return this.add(new ConeGeometry(r, h, r >= 0.1 ? 8 : 5, 1), color, pos, rot, scale);
  }
  torus(r: number, tube: number, color: number, pos?: V3, rot?: V3, scale?: V3, arc = Math.PI * 2): this {
    const radial = Math.max(8, Math.round((r * Math.max(scale?.[0] ?? 1, scale?.[1] ?? 1) >= 0.2 ? 18 : 12) * Math.min(1, arc / Math.PI + 0.2)));
    return this.add(new TorusGeometry(r, tube, 4, radial, arc), color, pos, rot, scale);
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

export const LEATHER = 0x2a1c14;
export const WOOD = 0x7a5230;
export const CREAM = 0xe8dcc0;
export const SOOT = 0x141210;
