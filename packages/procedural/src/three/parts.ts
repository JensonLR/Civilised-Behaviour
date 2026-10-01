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
import { buildPatch, type PatchSpec } from "./patch.ts";

export type V3 = readonly [number, number, number];

/** What the audit hook records for one primitive (see `PartBuilder.audit`). */
export interface PrimitiveAudit {
  min: V3;
  max: V3;
  /** Mean of (face normal . direction from the primitive's centre to the face), area weighted: > 0 for a form whose faces point outward. */
  outward: number;
  triangles: number;
  /** Vertex count: primitives are merged in the order they were added, so this locates each one's vertices in the bone mesh (the fit audit, fit/penetration.ts). */
  vertices: number;
  /** Set by builders around pieces that are meant to be buried in the body they grow from (a collar's base in the shoulder slope): the fit audit does not count their depth. */
  anchored?: boolean;
  /** The bone builder that made it ("torso", "head", ...) - set by the rig while the hook is on. */
  tag: string;
  /** Which helper made it (sphere, loft, sweep ...). */
  kind: string;
}

function auditPrimitive(geo: BufferGeometry): PrimitiveAudit {
  const p = geo.attributes.position!;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const ix = geo.index;
  const n = ix ? ix.count : p.count;
  let sum = 0;
  let area = 0;
  for (let i = 0; i < n; i += 3) {
    const a = ix ? ix.getX(i) : i;
    const b = ix ? ix.getX(i + 1) : i + 1;
    const c = ix ? ix.getX(i + 2) : i + 2;
    const e1x = p.getX(b) - p.getX(a);
    const e1y = p.getY(b) - p.getY(a);
    const e1z = p.getZ(b) - p.getZ(a);
    const e2x = p.getX(c) - p.getX(a);
    const e2y = p.getY(c) - p.getY(a);
    const e2z = p.getZ(c) - p.getZ(a);
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x; // twice the area, times the unit normal
    const mx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3 - cx;
    const my = (p.getY(a) + p.getY(b) + p.getY(c)) / 3 - cy;
    const mz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3 - cz;
    sum += nx * mx + ny * my + nz * mz; // = area-weighted (normal . offset)
    area += Math.hypot(nx, ny, nz);
  }
  let outward = area > 0 ? sum / area : 0;
  if (geo.userData.inward) outward = -outward; // (a lining: its faces are MEANT to point into the form)
  if (geo.userData.sheet) {
    // an open sheet (a patch of cloth on a body surface) has no inside to measure against: its faces must agree with the surface normals it carries
    const nrm = geo.attributes.normal!;
    let agree = 0;
    let tris = 0;
    for (let i = 0; i < n; i += 3) {
      const a = ix ? ix.getX(i) : i;
      const b = ix ? ix.getX(i + 1) : i + 1;
      const c = ix ? ix.getX(i + 2) : i + 2;
      const e1x = p.getX(b) - p.getX(a);
      const e1y = p.getY(b) - p.getY(a);
      const e1z = p.getZ(b) - p.getZ(a);
      const e2x = p.getX(c) - p.getX(a);
      const e2y = p.getY(c) - p.getY(a);
      const e2z = p.getZ(c) - p.getZ(a);
      const fx = e1y * e2z - e1z * e2y;
      const fy = e1z * e2x - e1x * e2z;
      const fz = e1x * e2y - e1y * e2x;
      const d = fx * (nrm.getX(a) + nrm.getX(b) + nrm.getX(c)) + fy * (nrm.getY(a) + nrm.getY(b) + nrm.getY(c)) + fz * (nrm.getZ(a) + nrm.getZ(b) + nrm.getZ(c));
      tris++;
      if (d > 0) agree++;
    }
    outward = tris > 0 ? agree / tris - 0.5 : 0;
  }
  return { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z], outward, triangles: n / 3, vertices: p.count, anchored: PartBuilder.anchored, tag: PartBuilder.auditTag, kind: PartBuilder.auditKind };
}

/** Primitives smaller than this (metres, bounding radius) are left out of the outline hull. */
export const SILHOUETTE_MIN_RADIUS = 0.055;
/** Crowd levels of detail: primitives whose bounding radius is below this are dropped (index = lod). LOD0 keeps everything. */
const LOD_MIN_RADIUS = [0, 0.032, 0.085] as const;
export type Lod = 0 | 1 | 2;
/** Crowd levels drop primitives thin in two dimensions (straps, ribbons, creases, cords, piping) below this second-largest extent (metres). */
const LOD_THIN = [0, 0.05, 0.12] as const;

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
  /** Off while the crowd's merged levels build their bones (hairSway.ts: a merged head never sways, so it never pays for the attribute). */
  static sway = true;
  /**
   * Crowd level of detail (0 full, 1 mid distance, 2 far silhouette). Set by the rig around a bone's builder like `hullMode`; builders
   * may also read it to skip whole features (`PartBuilder.lod >= 1`), and every primitive helper tessellates more coarsely and
   * drops tiny primitives at higher levels.
   */
  static lod: Lod = 0;
  /**
   * Test hook: while set, every primitive added is described (bounding box in the bone frame, how outward its faces point) so a test can assert that
   * nothing is inside-out or floating. Never set in the game.
   */
  static audit: PrimitiveAudit[] | undefined = undefined;
  static auditTag = "";
  static auditKind = "add";
  /** Test hook (see PrimitiveAudit.anchored): true while a builder adds pieces that are buried in their base by design. */
  static anchored = false;

  private readonly parts: BufferGeometry[] = [];
  private seq = 0;
  /** Set before the first `add` to track which parts are face surface (see `morphable`); `build` then hands the weights to its `morph` callback. */
  trackMorph = false;
  /** While true (and `trackMorph`), parts added are flagged as moving with the face's morph targets (skin, beards); false = rigid (ears, hats, neck). */
  morphable = false;
  /** Set before the first `add` to track which parts are hair (see hairSway.ts); `build` then hands the flags to its `sway` callback. Off for crowd levels and anything that is not a character's head. */
  trackSway = false;
  /** While true (and `trackSway`), parts added are hair: they may sway. */
  swayable = false;

  /** Adds a primitive. Geometry is consumed (transformed in place then disposed after merge). */
  add(geo: BufferGeometry, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    const minR = PartBuilder.hullMode ? Math.max(SILHOUETTE_MIN_RADIUS, LOD_MIN_RADIUS[PartBuilder.lod]) : LOD_MIN_RADIUS[PartBuilder.lod];
    if (minR > 0 && primitiveRadius(geo, scale) < minR) {
      geo.dispose();
      return this;
    }
    e.set(rot[0], rot[1], rot[2]);
    q.setFromEuler(e);
    v.set(pos[0], pos[1], pos[2]);
    s.set(scale[0], scale[1], scale[2]);
    m4.compose(v, q, s);
    geo.applyMatrix4(m4);
    if (PartBuilder.lod > 0 && !PartBuilder.hullMode && isThinDetail(geo, LOD_THIN[PartBuilder.lod]!)) {
      geo.dispose();
      return this;
    }
    if (PartBuilder.hullMode && isThinDetail(geo)) {
      // creases, piping, straps, buttons: fine detail on a surface adds an ink ring round every little thing instead of a silhouette
      geo.dispose();
      return this;
    }
    if (PartBuilder.audit) PartBuilder.audit.push(auditPrimitive(geo));
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
    // outline hulls only: every part carries `hthin` (0 = the full ink line; a nose's bridge sets its own, see SweepOptions.hullThin) so the parts merge
    if (PartBuilder.hullMode && !geo.attributes.hthin) geo.setAttribute("hthin", new BufferAttribute(new Float32Array(n), 1));
    if (this.trackMorph) geo.setAttribute("mw", new BufferAttribute(new Float32Array(n).fill(this.morphable ? 1 : 0), 1));
    if (this.trackSway) geo.setAttribute("sw", new BufferAttribute(new Float32Array(n).fill(this.swayable ? 1 : 0), 1));
    // Drop UVs: nothing samples textures, and mismatched attribute sets break merging.
    geo.deleteAttribute("uv");
    this.parts.push(geo);
    PartBuilder.auditKind = "add";
    return this;
  }

  /** Tessellation scales with the *world-space* size of the primitive: big shapes stay round, tiny ones stay cheap. */
  sphere(r: number, color: number, pos?: V3, scale?: V3, rot?: V3): this {
    PartBuilder.auditKind = "sphere";
    const size = r * Math.max(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1);
    const coarse = PartBuilder.hullMode || PartBuilder.lod > 0;
    const [w, h] = coarse ? (size >= 0.18 ? [8, 5] : size >= 0.03 ? [6, 4] : [5, 3]) : size >= 0.18 ? [12, 8] : size >= 0.06 ? [8, 6] : size >= 0.03 ? [6, 4] : [5, 3];
    return this.add(new SphereGeometry(r, w, h), color, pos, rot, scale);
  }
  box(w: number, h: number, d: number, color: number, pos?: V3, rot?: V3): this {
    PartBuilder.auditKind = "box";
    return this.add(new BoxGeometry(w, h, d), color, pos, rot);
  }
  cylinder(rTop: number, rBottom: number, h: number, color: number, pos?: V3, rot?: V3, scale?: V3, openEnded = false): this {
    PartBuilder.auditKind = "cylinder";
    const r = Math.max(rTop, rBottom);
    const radial = PartBuilder.hullMode || PartBuilder.lod > 0 ? (r >= 0.15 ? 8 : 6) : r >= 0.15 ? 12 : r >= 0.05 ? 8 : 6;
    return this.add(new CylinderGeometry(rTop, rBottom, h, radial, 1, openEnded), color, pos, rot, scale);
  }
  cone(r: number, h: number, color: number, pos?: V3, rot?: V3, scale?: V3): this {
    PartBuilder.auditKind = "cone";
    return this.add(new ConeGeometry(r, h, PartBuilder.hullMode || PartBuilder.lod > 0 ? 5 : r >= 0.1 ? 8 : 5, 1), color, pos, rot, scale);
  }
  torus(r: number, tube: number, color: number, pos?: V3, rot?: V3, scale?: V3, arc = Math.PI * 2): this {
    PartBuilder.auditKind = "torus";
    if (PartBuilder.lod > 0 && 2 * tube < LOD_THIN[PartBuilder.lod]!) return this;
    const size = r * Math.max(scale?.[0] ?? 1, scale?.[1] ?? 1);
    const radial = Math.max(6, Math.round((size >= 0.2 ? 18 : size >= 0.07 ? 12 : 8) * Math.min(1, arc / Math.PI + 0.2)));
    const coarse = PartBuilder.hullMode || PartBuilder.lod > 0;
    return this.add(new TorusGeometry(r, tube, coarse || tube < 0.012 ? 3 : 4, coarse ? Math.max(6, Math.round(radial * 0.6)) : radial, arc), color, pos, rot, scale);
  }
  /** A domed button (a flattened five-sided cone: 10 triangles) facing -Z, centred at `pos`. */
  button(r: number, color: number, pos: V3, rot: V3 = [-Math.PI / 2, 0, 0]): this {
    PartBuilder.auditKind = "button";
    return this.add(new ConeGeometry(r, r * 0.55, 5, 1), color, pos, rot);
  }
  /** A smooth lofted form through cross-sections (see loft.ts): coats, sleeves, trouser legs, boots. */
  loft(ringsIn: readonly Ring[], color: number, pos?: V3, rot?: V3, scale?: V3, opts: { capBottom?: boolean; capTop?: boolean; segments?: number; inward?: boolean } = {}): this {
    let rings = ringsIn;
    PartBuilder.auditKind = "loft";
    const segments = opts.segments ?? (PartBuilder.hullMode ? 6 : [10, 8, 6][PartBuilder.lod]!);
    // A far figure drops every other interior section of a long stack (creased sections are kept: they are the hems and cuffs).
    if (PartBuilder.lod >= 2 && rings.length > 4) rings = rings.filter((r, i) => i === 0 || i === rings.length - 1 || r.crease === true || rings[i + 1]?.crease === true || i % 2 === 0);
    return this.add(loftGeometry(rings, { color, ...opts, segments: PartBuilder.hullMode ? Math.min(6, segments) : PartBuilder.lod > 0 ? Math.min(segments, [10, 8, 6][PartBuilder.lod]!) : segments }), color, pos, rot, scale);
  }
  /**
   * A masked patch of a body surface (see patch.ts): cloth laid on the torso, a coat skirt, a lapel. Left out of the outline hull unless it
   * changes the silhouette (`silhouette`), and out of the far-crowd level of detail.
   */
  patch(spec: PatchSpec, silhouette = false): this {
    PartBuilder.auditKind = "patch";
    if ((PartBuilder.hullMode || PartBuilder.lod >= 2) && !silhouette) return this;
    const k = PartBuilder.hullMode ? 0.6 : [1, 0.6, 0.5][PartBuilder.lod]!;
    // cloth thickness (lining layer + rim) is a full-detail feature: crowd levels and the outline hull draw the single sheet
    const thick = PartBuilder.lod === 0 && !PartBuilder.hullMode ? spec.thick : 0;
    const g = buildPatch({ ...spec, thick, nu: Math.max(2, Math.round(spec.nu * k)), nv: Math.max(2, Math.round(spec.nv * k)) });
    if (g) {
      g.userData.sheet = true;
      this.add(g, typeof spec.color === "number" ? spec.color : 0xffffff);
    }
    return this;
  }
  /** A tube swept along a spine with a tapering cross-section (see sweep.ts): moustaches, brows, noses, hair locks, beards. */
  sweep(spine: readonly V3[], section: (t: number, i: number) => SweepSection, color: number, opts: Partial<SweepOptions> = {}): this {
    PartBuilder.auditKind = "sweep";
    const lod = PartBuilder.lod;
    if (lod > 0 || PartBuilder.hullMode) {
      // a tube whose cross-section is thin is fine detail whatever its length (a diagonal strap has a big bounding box and no volume)
      let r = 0;
      for (let k = 0; k <= 3; k++) {
        const sec = section(k / 3, Math.round((k / 3) * (spine.length - 1)));
        r = Math.max(r, sec.rx, sec.rz);
      }
      if (2 * r < (PartBuilder.hullMode ? 0.04 : LOD_THIN[lod]!)) return this;
    }
    const want = opts.segments ?? [6, 5, 4][lod]!;
    const segments = PartBuilder.hullMode ? Math.min(want, 5) : Math.min(want, [8, 5, 4][lod]!);
    // Far levels use half the spine points (the section function is evaluated over the reduced spine, so tapers stay right).
    const pts = (lod >= 2 ? spine.length > 6 : spine.length > 7) && lod >= 1 && !opts.sideAt ? spine.filter((_, i) => i % 2 === 0 || i === spine.length - 1) : spine;
    return this.add(sweepGeometry(pts, section, { color, ...opts, segments, ...(lod > 0 || PartBuilder.hullMode ? { coarseDome: true } : {}) }), color);
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
  build(morph?: (geo: BufferGeometry, mw: BufferAttribute) => void, sway?: (geo: BufferGeometry, sw: BufferAttribute) => void): BufferGeometry | undefined {
    if (this.parts.length === 0) return undefined;
    // All Three primitives used here are indexed with position/normal/color, which mergeGeometries requires to match.
    const merged = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    if (!merged) return undefined;
    if (PartBuilder.hullMode) {
      merged.deleteAttribute("color"); // hulls are drawn in one flat colour
      addOutlineNormals(merged); // only the hull reads the smoothed normal
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    if (this.trackSway) {
      const sw = merged.getAttribute("sw") as BufferAttribute | undefined;
      if (sw && sway) {
        sway(merged, sw);
        // (the culling sphere holds the hair at the furthest it is ever moved)
        if (merged.boundingSphere) merged.boundingSphere.radius += 0.09;
      }
      merged.deleteAttribute("sw");
    }
    if (this.trackMorph) {
      const mw = merged.getAttribute("mw") as BufferAttribute | undefined;
      if (mw && morph) {
        morph(merged, mw);
        // Keep the tight box (three would grow it by the extremes of every morph target, which only matters at a full gape); pad the culling sphere instead.
        const pad = merged.boundingSphere ? merged.boundingSphere.radius * 0.15 : 0;
        if (merged.boundingSphere) merged.boundingSphere.radius += pad;
      }
      merged.deleteAttribute("mw");
    }
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

/** True for a primitive thin in two of its three dimensions (a crease, a cord, a strap): not a silhouette. */
function isThinDetail(geo: BufferGeometry, limit = 0.04): boolean {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const e = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].sort((a, b) => a - b);
  return e[1]! < limit;
}

/** Approximate world-space bounding radius of an untransformed primitive after `scale` (used to cull tiny hull parts). */
function primitiveRadius(geo: BufferGeometry, scale: V3 | undefined): number {
  geo.computeBoundingSphere();
  const r = geo.boundingSphere?.radius ?? 0;
  return r * Math.max(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1);
}
