import { BufferAttribute, BufferGeometry, CircleGeometry, Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, SphereGeometry, type DataTexture, type Material, type Object3D } from "three";
import { PALETTE } from "@cb/shared";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as K from "../catalog.ts";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { eyePlacement } from "./head.ts";
import { headShape, skinRamp, type HeadShape } from "./headShape.ts";
import { curve, sweepGeometry } from "./sweep.ts";
import type { V3 } from "./parts.ts";
import { MORPH_NAMES, MOUTH_MORPH_NAMES, type MouthMorphName } from "./faceMorph.ts";
import { clearMouthGeos, mouthGeo } from "./mouthGeo.ts";
import { NEUTRAL, type FaceTarget } from "./expressions.ts";

/** The animated parts of the face: eyes with upper and lower lids, brows, the mouth (seam, opening, teeth, tongue) and the head's morph targets. */
export interface FaceParts {
  eyeL: Group;
  eyeR: Group;
  /** The iris (the mesh the animator turns to look somewhere). */
  pupilL: Mesh;
  pupilR: Mesh;
  /** The dark pupil disc riding on the iris (dilates with fear, shrinks with triumph). */
  coreL: Mesh;
  coreR: Mesh;
  /** The catch-lights: they stay put when the eye turns (they belong to the light, not the iris). */
  glintL: Mesh;
  glintR: Mesh;
  /** Brows: a body and a fan of tapering hairs; morph targets `arch`, `innerUp`, `innerDown`, `outerDown` (BROW_MORPHS). */
  browL: Mesh;
  browR: Mesh;
  /** The mouth: lip seam, the dark opening, gums, teeth, tongue. One mesh with the skin's morph targets plus `bare` and `tongue` (MOUTH_MORPH_NAMES). */
  mouth: Mesh;
  lidL: Mesh;
  lidR: Mesh;
  /** Lower lids: they rise for a squint, a grin or a wince. */
  lowerLidL: Mesh;
  lowerLidR: Mesh;
  /** Resting geometry constants the animator needs. */
  eyeRadius: number;
  mouthWidth: number;
  /** Resting height of the brows (head-centre relative); the animator raises/lowers from here. */
  browY: number;
  /** Resting horizontal position of the brows (centre of the eye). */
  browX: number;
  /** Depth (head-centre relative z) at which a brow centred at (x, y) rests on the brow ridge: the brows follow the skin as they rise, fall and draw together. */
  browZ(x: number, y: number): number;
  /** Per-character eye set: how far the upper lid rests closed (0 = round-open .. 0.4 = sleepy), the lower lid's rest lift, and the tilt of the eyes (radians, outer corner down positive). */
  lidBias: number;
  lowerLidBase: number;
  eyeTilt: number;
  /** Non-uniform scale of the whole eye (shape variation); the animator multiplies it by its "wide" scale. */
  eyeScale: readonly [number, number];
  /** False when the rig was built as a far-crowd silhouette: the face is a placeholder and the animator skips it. */
  active: boolean;
  /** The live pose of the face (the animator eases it toward the current expression every frame): what the eyes, brows and mouth are doing right now. */
  pose: FaceTarget;
  /** Sets one of the morph targets (0..1) on the head's skin and on the mouth. A no-op for a target the mesh does not have (crowd LODs have none). */
  setMorph(name: MouthMorphName, value: number): void;
}

export interface FaceBuild {
  face: FaceParts;
  root: Group;
  /** Level of detail of the face parts: 0 full (round eyeballs, catch-lights), 1 mid distance (coarser eyes, lids, brows, the lip seam only). Cheap: swaps cached geometry. */
  setDetail(level: 0 | 1): void;
  /**
   * The mid-distance (detail 1) face as static geometry in the head bone's frame, in the pose it was built in (eyes open, brows and mouth neutral): the white, iris and upper lid of
   * each eye, the brows, the lip seam. A crowd rig bakes these into its merged level-1 mesh (merged.ts), which does not animate the face. Shared geometry: never dispose it.
   */
  statics: { geometry: BufferGeometry; matrix: Matrix4 }[];
}

export interface FaceCtx {
  spec: CharacterSpec;
  P: Proportions;
  skin: number;
  hairC: number;
  accent: number;
  irisC: number;
  ramp: DataTexture;
  toonMaterial: MeshToonMaterial;
  /** Reads the head mesh (with morph targets) once the rig has attached it. */
  headMesh: () => Mesh | undefined;
}

/** The brow mesh's own morph targets: the middle lifts, an inner end lifts or drops, the outer end drops. */
export const BROW_MORPHS = ["arch", "innerUp", "innerDown", "outerDown"] as const;

// ---- shared parts --------------------------------------------------------------------------------------------------------------------------------
// The eyes, lids, brows and mouth of a face are geometry that never changes shape (the animator only moves, turns and scales the MESHES and sets morph weights), and
// materials that never change colour: so both are cached across every rig (keyed by exactly what they depend on) and a clone of a look, or a crowd of similar heads, builds
// only the small Mesh/Group objects. Nothing here belongs to a rig, so `dispose()` frees none of it; `clearCharacterCaches()` does.
const sharedGeo = new Map<string, BufferGeometry>();
const sharedMat = new Map<string, Material>();
const MAX_SHARED = 700;

/** Frees the cached face geometry and materials (rigs still showing them re-upload on their next draw). */
export function clearFaceCaches(): void {
  for (const g of sharedGeo.values()) g.dispose();
  for (const m of sharedMat.values()) m.dispose();
  sharedGeo.clear();
  sharedMat.clear();
  clearMouthGeos();
}
/** How many cached face geometries there are (for tests). */
export const faceCacheSize = (): number => sharedGeo.size;

const cachedGeo = (key: string, make: () => BufferGeometry): BufferGeometry => {
  let g = sharedGeo.get(key);
  if (!g) {
    g = make();
    sharedGeo.set(key, g);
    if (sharedGeo.size > MAX_SHARED) {
      const first = sharedGeo.keys().next().value as string | undefined;
      if (first !== undefined) sharedGeo.delete(first); // (dropped from the table, not disposed: a live rig may still draw it)
    }
  }
  return g;
};
const cachedMat = <T extends Material>(key: string, make: () => T): T => {
  let m = sharedMat.get(key);
  if (!m) {
    m = make();
    sharedMat.set(key, m);
    if (sharedMat.size > MAX_SHARED) {
      const first = sharedMat.keys().next().value as string | undefined;
      if (first !== undefined) sharedMat.delete(first);
    }
  }
  return m as T;
};

/** Eye shapes: upper-lid bias, lower-lid rest, tilt of the eye line (outer corner down), width/height scale, white tint. Indexed by K.EYE_SHAPES. */
const EYE_SHAPE = [
  { bias: 0, lower: 0, tilt: 0, sx: 1, sy: 1, bag: 0 }, // round
  { bias: 0.2, lower: 0.05, tilt: 0.03, sx: 1.02, sy: 0.96, bag: 0 }, // hooded: the upper lid hangs low
  { bias: 0.34, lower: 0.15, tilt: 0.16, sx: 1, sy: 0.92, bag: 0.4 }, // sleepy: heavy lids, drooping outer corners
  { bias: -0.12, lower: -0.05, tilt: -0.04, sx: 1.08, sy: 1.14, bag: 0 }, // wide-eyed
  { bias: 0.28, lower: 0.2, tilt: -0.1, sx: 1.12, sy: 0.72, bag: 0 }, // narrow: slits tilted up at the outer corner
  { bias: 0.08, lower: 0.1, tilt: 0.06, sx: 1, sy: 1, bag: 1 }, // bagged: dark pouches under the eye
] as const;

export function eyeShape(spec: CharacterSpec) {
  return EYE_SHAPE[spec.eyeShape] ?? EYE_SHAPE[0];
}

/** Iris colour: the spec's choice, or (Auto) a stable pick from hair and skin. */
export function irisColour(spec: CharacterSpec): number {
  const list = K.IRIS_COLORS;
  if (spec.eyeColor > 0) return list[(spec.eyeColor - 1) % list.length]!;
  return list[(spec.hairColor + spec.skin * 3) % list.length]!;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const setColors = (geo: BufferGeometry, f: (x: number, y: number, z: number, i: number) => Color): void => {
  const pos = geo.attributes.position as BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = f(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  geo.deleteAttribute("uv");
};

// ---- the eyeball -----------------------------------------------------------------------------------------------------------------------------------

/** The white of the eye: the front cap of a sphere (its pole toward -Z) shaded by the lids above and below and pinkish at the inner corner. */
function scleraGeo(eyeR: number, base: Color, socket: Color, innerSign: number, d: 0 | 1): BufferGeometry {
  const g = new SphereGeometry(eyeR, d === 0 ? 10 : 8, d === 0 ? 4 : 3, 0, Math.PI * 2, 0, 1.2);
  g.rotateX(-Math.PI / 2);
  const pink = new Color(PALETTE.trim.blushHot);
  const c = new Color();
  setColors(g, (x, y, z) => {
    const xn = x / eyeR;
    const yn = y / eyeR;
    const zn = z / eyeR;
    c.copy(base);
    c.multiplyScalar(1 - 0.24 * smooth(0.05, 0.85, yn) - 0.07 * smooth(-0.3, -0.85, yn)); // the upper lid shades the white beneath it, the lower barely
    const inner = xn * innerSign;
    c.lerp(pink, 0.4 * smooth(0.5, 0.9, inner)); // the caruncle
    c.lerp(socket, 0.35 * smooth(0.55, 0.95, -inner)); // the outer corner turns into the shadow of the socket
    c.multiplyScalar(1 - 0.35 * smooth(-0.1, 0.55, zn)); // behind the equator: dark (hidden by the lids)
    return c;
  });
  return g;
}

const IRIS_ALPHA = 0.6;
/** The iris: a slightly domed disc lying on the eyeball, bright next to the pupil, darker outward, with a hard dark limbal ring at the rim and faint radial streaks. */
function irisGeo(eyeR: number, base: number, d: 0 | 1): BufferGeometry {
  const S = d === 0 ? 12 : 8;
  const Rb = eyeR * 1.006;
  const rings = d === 0 ? [{ a: 0, k: 0.55 }, { a: 0.5, k: 1.3 }, { a: 0.83, k: 0.96 }, { a: 0.83, k: 0.52 }, { a: 1, k: 0.42 }] : [{ a: 0, k: 0.55 }, { a: 0.6, k: 1.05 }, { a: 1, k: 0.5 }];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new Color();
  const b = new Color(base);
  rings.forEach((r, ri) => {
    const alpha = r.a * IRIS_ALPHA;
    const rad = Rb * (1 + 0.03 * (1 - r.a * r.a)); // the cornea bulges a little over the pupil
    for (let s = 0; s < (ri === 0 ? 1 : S); s++) {
      const phi = (s / S) * Math.PI * 2;
      const x = Math.sin(alpha) * Math.cos(phi) * rad;
      const y = Math.sin(alpha) * Math.sin(phi) * rad;
      const z = -Math.cos(alpha) * rad;
      pos.push(x, y, z);
      const streak = ri === 0 ? 1 : 0.92 + 0.16 * hash(s * 17 + ri * 5);
      const lid = 1 - 0.22 * smooth(0.1, 0.9, y / eyeR); // the upper lid shadows the top of the iris
      c.copy(b).multiplyScalar(r.k * streak * lid);
      col.push(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b));
    }
  });
  // fan from the centre to ring 1, then bands
  const at = (ri: number, s: number): number => (ri === 0 ? 0 : 1 + (ri - 1) * S + (s % S));
  for (let s = 0; s < S; s++) idx.push(0, at(1, s + 1), at(1, s));
  for (let ri = 1; ri < rings.length - 1; ri++) {
    if (rings[ri]!.a === rings[ri + 1]!.a) continue;
    for (let s = 0; s < S; s++) idx.push(at(ri, s), at(ri, s + 1), at(ri + 1, s), at(ri, s + 1), at(ri + 1, s + 1), at(ri + 1, s));
  }
  // the hard step of the limbal ring: the band from ring 3 (same place as 2) to the rim
  if (d === 0) for (let s = 0; s < S; s++) idx.push(at(3, s), at(3, s + 1), at(4, s), at(3, s + 1), at(4, s + 1), at(4, s));
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // (the disc faces away from the eye's centre: make sure the winding agrees)
  const nrm = g.attributes.normal as BufferAttribute;
  if (nrm.getZ(0) > 0) {
    const ix = g.index!;
    for (let i = 0; i < ix.count; i += 3) {
      const t = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, t);
    }
    g.computeVertexNormals();
  }
  return g;
}

/** A flat disc facing -Z, centred on its own origin. */
function discGeo(radius: number, segs: number): BufferGeometry {
  const g = new CircleGeometry(radius, segs);
  g.rotateY(Math.PI);
  g.deleteAttribute("uv");
  return g;
}

/** Catch-lights: a big soft one up toward the light, a small one low on the other side (they sit over the iris and stay put when it turns). */
function glintGeo(eyeR: number): BufferGeometry {
  const Rg = eyeR * 1.048;
  const disc = (x: number, y: number, r: number, segs: number): BufferGeometry => {
    const g = discGeo(r, segs);
    g.translate(x, y, -Math.sqrt(Math.max(eyeR * eyeR * 0.25, Rg * Rg - x * x - y * y)));
    return g;
  };
  const parts = [disc(eyeR * 0.2, eyeR * 0.25, eyeR * 0.1, 9), disc(-eyeR * 0.16, -eyeR * 0.18, eyeR * 0.045, 6)];
  const m = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return m;
}

/** An eyelid cap: a shallow spherical shell over the eyeball with a shaded crease, a drawn lash line and a thickened edge. `pole` is +1 for the upper lid (axis +Y) and -1 for the lower. */
function lidGeo(eyeR: number, radius: number, thetaLen: number, segs: number, rings: number, skin: Color, crease: Color, edge: Color, upper: boolean): BufferGeometry {
  const g = new SphereGeometry(radius, segs, rings, 0, Math.PI * 2, 0, thetaLen);
  const c = new Color();
  setColors(g, (x, y, z) => {
    const theta = Math.acos(Math.max(-1, Math.min(1, Math.abs(y) / radius)));
    const t = Math.min(1, theta / thetaLen);
    // which side of the cap this is: +1 the side that faces forward at rest (it becomes the lower edge as the lid comes down: the lash line), -1 the far side (the fold at the top)
    const side = -z / (Math.hypot(x, z) || 1);
    c.copy(skin);
    if (upper) {
      c.lerp(crease, 0.6 * smooth(0.42, 0.6, t) * (1 - smooth(0.68, 0.8, t)) * smooth(0.3, -0.5, side)); // the fold of the lid, on the side that ends up above the eye
      c.lerp(edge, 0.94 * smooth(0.8, 1, t) * smooth(-0.45, 0.35, side)); // the lash line along the lower edge
    } else {
      c.lerp(edge, 0.62 * smooth(0.72, 1, t) * smooth(-0.35, 0.4, side)); // a faint lower lash line, warm and wet
    }
    return c;
  });
  if (!upper) return g;
  // the lash line: a dark ribbon along the front half of the rim, tapering to both corners, so a closed or half-closed eye has a drawn edge (the lid's edge colour alone is a soft gradient)
  const N = 8;
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const rr = radius * 1.004;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const phi = Math.PI + u * Math.PI; // the half of the rim that faces forward at rest (z < 0)
    const w = Math.sin(Math.PI * u) ** 0.6; // taper to the corners
    for (const th of [thetaLen - 0.075 * w, thetaLen + 0.03 * w]) {
      const x = rr * Math.sin(th) * Math.cos(phi);
      const y = rr * Math.cos(th);
      const z = rr * Math.sin(th) * Math.sin(phi);
      pos.push(x, y, z);
      nrm.push(x / rr, y / rr, z / rr);
      col.push(edge.r, edge.g, edge.b);
    }
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const rib = new BufferGeometry();
  rib.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  rib.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  rib.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  rib.setIndex(idx);
  // (the ribbon faces outward: flip its winding if its normal disagrees with the sphere's)
  const pa = rib.attributes.position as BufferAttribute;
  const ix = rib.index!;
  const e1 = [pa.getX(1) - pa.getX(0), pa.getY(1) - pa.getY(0), pa.getZ(1) - pa.getZ(0)];
  const e2 = [pa.getX(2) - pa.getX(0), pa.getY(2) - pa.getY(0), pa.getZ(2) - pa.getZ(0)];
  const cx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
  const cy = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
  const cz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
  if (cx * pa.getX(0) + cy * pa.getY(0) + cz * pa.getZ(0) < 0) {
    for (let i = 0; i < ix.count; i += 3) {
      const t = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, t);
    }
  }
  const merged = mergeGeometries([g, rib], false)!;
  g.dispose();
  rib.dispose();
  void eyeR;
  return merged;
}

// ---- brows -----------------------------------------------------------------------------------------------------------------------------------------

/** A brow: (spine control points in units of R as [x, y, z], half-widths and depths along it), by style. Inner end is at negative x. */
interface BrowStyle {
  pts: readonly V3[];
  rx: (t: number) => number;
  rz: number;
  /** How many hairs grow on it, how long (x R) and wide (x R). */
  hairs: number;
  len: number;
  wide: number;
  visible?: boolean;
}
const BROWS: readonly BrowStyle[] = [
  { pts: [[-0.2, -0.005, 0], [-0.08, 0.035, 0], [0.06, 0.035, 0], [0.2, -0.01, 0.01]], rx: (t) => 0.036 + 0.026 * Math.sin(Math.PI * Math.min(1, t * 1.1)) - 0.02 * t * t, rz: 0.04, hairs: 14, len: 0.1, wide: 0.02 }, // natural
  { pts: [[-0.22, 0, 0], [-0.08, 0.04, 0], [0.08, 0.045, 0], [0.22, -0.005, 0.01]], rx: (t) => 0.06 + 0.04 * Math.sin(Math.PI * Math.min(1, t * 1.1)) - 0.02 * t * t, rz: 0.06, hairs: 22, len: 0.13, wide: 0.026 }, // bushy
  { pts: [[-0.18, -0.01, 0], [-0.06, 0.05, 0], [0.08, 0.055, 0], [0.22, -0.03, 0.01]], rx: (t) => 0.016 + 0.012 * Math.sin(Math.PI * t), rz: 0.022, hairs: 9, len: 0.08, wide: 0.012 }, // thin, high arch
  { pts: [[-0.4, 0.005, 0], [-0.18, 0.02, 0], [0.04, 0.045, 0], [0.2, -0.01, 0.01]], rx: (t) => 0.05 + 0.026 * (1 - t) - 0.015 * t * t, rz: 0.05, hairs: 18, len: 0.115, wide: 0.022 }, // unibrow: the inner end runs to the middle of the face
  { pts: [[-0.22, 0.01, 0], [-0.08, 0.012, 0], [0.08, 0.008, 0], [0.24, 0.005, 0.01]], rx: (t) => 0.062 + 0.02 * Math.sin(Math.PI * t) - 0.02 * t * t, rz: 0.05, hairs: 17, len: 0.12, wide: 0.024 }, // heavy and flat
  { pts: [[-0.2, -0.03, 0], [-0.06, 0.0, 0], [0.09, 0.055, 0], [0.22, 0.0, 0.01]], rx: (t) => 0.03 + 0.018 * (1 - t) * (1 - t), rz: 0.034, hairs: 11, len: 0.1, wide: 0.017 }, // villain: a sharp peak over the outer eye
  { pts: [[-0.16, 0, 0], [0, 0.01, 0], [0.16, 0, 0.01]], rx: () => 0.014, rz: 0.012, hairs: 0, len: 0, wide: 0, visible: false }, // shaved: only a faint ridge
];

function buildBrowGeometry(style: BrowStyle, R: number, color: number, detail: 0 | 1, shape: HeadShape, eyeX: number, browY: number, seed: number): BufferGeometry {
  const baseZ = shape.front(eyeX, browY)[2];
  // the spine lies ON the head: its depth follows the skin at each point, so a brow wraps round the brow ridge instead of standing in front of it
  const ctrl = style.pts.map((p): V3 => [p[0] * R, p[1] * R, shape.front(eyeX + p[0] * R, browY + p[1] * R)[2] - baseZ + p[2] * R]);
  const spine = curve(ctrl, detail === 0 ? 7 : 4);
  const rootC = new Color(color).multiplyScalar(0.78);
  const tube = sweepGeometry(spine, (t) => ({ rx: R * style.rx(t) * 0.95, rz: R * style.rz * 0.85, pow: 2.2, color: rootC.getHex() }), { color: rootC.getHex(), segments: detail === 0 ? 5 : 4, side: [0, 1, 0], round: "start" });
  tube.deleteAttribute("uv");
  const parts: BufferGeometry[] = [tube];
  const count = detail === 0 ? style.hairs : Math.ceil(style.hairs * 0.5);
  if (count > 0) {
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const base = new Color(color);
    const c = new Color();
    const at = (t: number): { p: V3; tan: V3 } => {
      const f = Math.max(0, Math.min(1, t)) * (spine.length - 1);
      const i = Math.min(spine.length - 2, Math.floor(f));
      const u = f - i;
      const a = spine[i]!;
      const b = spine[i + 1]!;
      const tv: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(tv[0], tv[1], tv[2]) || 1;
      return { p: [a[0] + tv[0] * u, a[1] + tv[1] * u, a[2] + tv[2] * u], tan: [tv[0] / l, tv[1] / l, tv[2] / l] };
    };
    for (let h = 0; h < count; h++) {
      const t = Math.min(0.98, Math.max(0.02, (h + 0.5) / count + (hash(seed + h * 3) - 0.5) * (0.55 / count)));
      const u = (hash(seed + h * 7 + 1) - 0.5) * 1.5; // where across the brow's height it grows
      const { p, tan } = at(t);
      const rx = R * style.rx(t);
      // hairs grow up and out along the inner third, along the brow in the middle, and down and out at the tail
      const grow = (0.6 - t) * 0.55 + (hash(seed + h * 11 + 2) - 0.5) * 0.22;
      const ca = Math.cos(grow);
      const sa = Math.sin(grow);
      const dx = tan[0] * ca - tan[1] * sa;
      const dy = tan[0] * sa + tan[1] * ca;
      const dl = Math.hypot(dx, dy) || 1;
      const dir: V3 = [dx / dl, dy / dl, 0];
      const len = R * style.len * 0.78 * (0.75 + 0.5 * hash(seed + h * 13 + 3)) * (1 - 0.3 * t);
      const w = R * style.wide * (0.8 + 0.4 * hash(seed + h * 17 + 4));
      const root: V3 = [p[0], p[1] + u * rx, p[2] - R * style.rz * 0.75 * Math.sqrt(Math.max(0.1, 1 - u * u * 0.4))];
      const side: V3 = [-dir[1], dir[0], 0];
      const bend = 0.12 * (hash(seed + h * 19 + 5) - 0.3);
      const midDir: V3 = [dir[0] * Math.cos(bend) - dir[1] * Math.sin(bend), dir[0] * Math.sin(bend) + dir[1] * Math.cos(bend), 0];
      const mid: V3 = [root[0] + dir[0] * len * 0.5, root[1] + dir[1] * len * 0.5, root[2] - R * 0.006];
      const tip: V3 = [mid[0] + midDir[0] * len * 0.5, mid[1] + midDir[1] * len * 0.5, mid[2] - R * 0.004];
      const v0 = pos.length / 3;
      const shade = 0.86 + 0.28 * hash(seed + h * 23 + 6);
      const rowCol = [0.8, 1, 1.1].map((k) => c.copy(base).multiplyScalar(shade * k).clone());
      pos.push(root[0] - side[0] * w * 0.5, root[1] - side[1] * w * 0.5, root[2], root[0] + side[0] * w * 0.5, root[1] + side[1] * w * 0.5, root[2]);
      pos.push(mid[0] - side[0] * w * 0.42, mid[1] - side[1] * w * 0.42, mid[2], mid[0] + side[0] * w * 0.42, mid[1] + side[1] * w * 0.42, mid[2]);
      pos.push(tip[0], tip[1], tip[2]);
      for (let k = 0; k < 5; k++) nrm.push(0, 0, -1);
      const cols = [rowCol[0]!, rowCol[0]!, rowCol[1]!, rowCol[1]!, rowCol[2]!];
      for (const cc of cols) col.push(Math.min(1, cc.r), Math.min(1, cc.g), Math.min(1, cc.b));
      idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx);
    parts.push(g);
  }
  const geo = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  // morph targets: the middle arches, the inner end goes up or down (and inward), the outer end drops
  const p = geo.attributes.position as BufferAttribute;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    x0 = Math.min(x0, p.getX(i));
    x1 = Math.max(x1, p.getX(i));
  }
  const arch = new Float32Array(p.count * 3);
  const innerUp = new Float32Array(p.count * 3);
  const innerDown = new Float32Array(p.count * 3);
  const outerDown = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) - x0) / (x1 - x0 || 1);
    arch[i * 3 + 1] = R * 0.055 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    innerUp[i * 3 + 1] = R * 0.075 * (1 - t) ** 1.5;
    innerDown[i * 3 + 1] = -R * 0.055 * (1 - t) ** 1.3;
    innerDown[i * 3] = -R * 0.07 * (1 - t) ** 2;
    outerDown[i * 3 + 1] = -R * 0.05 * t * t;
  }
  geo.morphAttributes.position = [arch, innerUp, innerDown, outerDown].map((a) => new BufferAttribute(a, 3));
  geo.morphTargetsRelative = true;
  geo.computeBoundingSphere();
  return geo;
}

// ---- the face --------------------------------------------------------------------------------------------------------------------------------------

/**
 * Builds the face's animated parts on `parent` (the head bone): eyes with lids, brows and the mouth. The head's skin, ears, nose and hair are part of the head bone's merged
 * mesh; these parts are separate so they can move.
 */
export function buildFace(ctx: FaceCtx, parent: Group): FaceBuild {
  const { P, spec, skin, hairC, accent, irisC, ramp } = ctx;
  const R = P.headRadius;
  const shape = headShape(P);
  const shp = eyeShape(spec);
  const hex = (c: number | Color): string => (typeof c === "number" ? c : c.getHex()).toString(16);
  /** Geometry swaps for `setDetail`: [mesh, geometry at detail 0, geometry at detail 1]. */
  const swaps: [Mesh, BufferGeometry, BufferGeometry][] = [];
  const both = (m: Mesh, g0: BufferGeometry, g1: BufferGeometry): Mesh => (swaps.push([m, g0, g1]), m);

  const root = new Group();
  root.name = "faceRoot";
  root.position.y = R;
  parent.add(root);

  const eye = eyePlacement(P);
  const eyeR = eye.radius;
  const ramps = skinRamp(skin);
  const lidTone = new Color(skin).lerp(ramps.shade, 0.3);
  const creaseTone = new Color(skin).lerp(ramps.shade, 0.9);
  const bagTone = new Color(skin).lerp(ramps.shade, 0.6);
  const lashC = new Color(PALETTE.face.lash);
  const whiteTint = new Color(PALETTE.face.white).lerp(new Color(PALETTE.trim.blushHot), spec.complexion === 3 ? 0.12 : spec.eyeShape === 5 ? 0.06 : 0);
  const vertexToon = (key: string): MeshToonMaterial => cachedMat(`vtoon|${key}`, () => new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
  const glintMat = cachedMat("glint", () => new MeshBasicMaterial({ color: PALETTE.face.glint }));
  const pupilMat = cachedMat(`toon|pupil`, () => new MeshToonMaterial({ color: PALETTE.face.pupil, gradientMap: ramp }));
  const eK = eyeR.toFixed(5);
  const detailOf = (d: 0 | 1): 0 | 1 => d;

  const mkEye = (sx: number): { g: Group; iris: Mesh; core: Mesh; glint: Mesh; lid: Mesh; lower: Mesh } => {
    const sign = Math.sign(sx || 1);
    const g = new Group();
    g.position.set(sx * eye.x, eye.y, eye.z);
    g.scale.set(shp.sx, shp.sy, 1);
    g.rotation.z = -sx * shp.tilt; // the outer corner drops for sleepy eyes and lifts for narrow ones
    // the white of the eye: pinker at the inner corner (nearest the nose), which is toward -sign
    const whiteGeo = (d: 0 | 1): BufferGeometry => cachedGeo(`white|${eK}|${hex(whiteTint)}|${hex(creaseTone)}|${sign}|${d}`, () => scleraGeo(eyeR, whiteTint, creaseTone, -sign, detailOf(d)));
    const white = both(new Mesh(whiteGeo(0), vertexToon("eye")), whiteGeo(0), whiteGeo(1));
    const iGeo = (d: 0 | 1): BufferGeometry => cachedGeo(`iris|${eK}|${hex(irisC)}|${d}`, () => irisGeo(eyeR, irisC, detailOf(d)));
    const iris = both(new Mesh(iGeo(0), vertexToon("eye")), iGeo(0), iGeo(1));
    const core = new Mesh(cachedGeo(`core|${eK}`, () => discGeo(eyeR * Math.sin(IRIS_ALPHA * 0.42) * 1.02, 12)), pupilMat);
    core.position.set(0, 0, -eyeR * 1.006 * (1.03 + 0.0025));
    iris.add(core);
    // catch-lights: siblings of the iris, so they stay where the light is when the eye turns
    const glint = new Mesh(cachedGeo(`glint|${eK}`, () => glintGeo(eyeR)), glintMat);
    // Upper lid: a shallow skin cap over the eyeball with a drawn lash line on its edge. Axis +Y at rest; the animator tilts it: 0.5 rad = retracted
    // up-and-back (eye open), -PI/2 = pointing forward over the pupil (eye closed / blink).
    const lidKey = `${eK}|${hex(lidTone)}|${hex(creaseTone)}|${hex(lashC)}`;
    const lidG = (d: 0 | 1): BufferGeometry =>
      cachedGeo(`lid|${lidKey}|${d}`, () => lidGeo(eyeR, eyeR * 1.11, 1.15, d === 0 ? 16 : 8, d === 0 ? 4 : 3, lidTone, creaseTone, lashC, true));
    const lid = both(new Mesh(lidG(0), vertexToon("eye")), lidG(0), lidG(1));
    lid.rotation.x = 0.5;
    // Lower lid: a smaller cap opening downward; it rises for a squint. Pouches darken it. (Hidden at the mid level of detail.)
    const lowTone = shp.bag > 0 ? bagTone : lidTone;
    const lower = new Mesh(
      cachedGeo(`low|${eK}|${hex(lowTone)}|${hex(lashC)}|${shp.bag > 0 ? 1 : 0}`, () => lidGeo(eyeR, eyeR * 1.085, 1.1, 12, 2, lowTone, lowTone, new Color(lowTone).lerp(lashC, 0.55), false)),
      vertexToon("eye"),
    );
    lower.rotation.x = Math.PI - 0.6; // axis -Y, tilted back
    g.add(white, iris, glint, lid, lower);
    root.add(g);
    return { g, iris, core, glint, lid, lower };
  };
  const eL = mkEye(-1);
  const eRr = mkEye(1);

  // ---- brows ----------------------------------------------------------------------------------------------------------------
  const browY = R * 0.37;
  // (a coarse table of the ridge's depth around the brow, so the animator can seat a brow on the skin wherever it has moved to)
  const bzY = Array.from({ length: 9 }, (_, i) => browY + (i - 4) * R * 0.035);
  const bzX = Array.from({ length: 5 }, (_, i) => eye.x + (i - 2) * R * 0.07);
  const bzT = bzY.map((y) => bzX.map((x) => shape.front(x, y)[2]));
  const zAtBrow = (x: number, y: number): number => {
    const fy = Math.max(0, Math.min(8, ((y - bzY[0]!) / (bzY[8]! - bzY[0]!)) * 8));
    const fx = Math.max(0, Math.min(4, ((Math.abs(x) - bzX[0]!) / (bzX[4]! - bzX[0]!)) * 4));
    const iy = Math.min(7, Math.floor(fy));
    const ix = Math.min(3, Math.floor(fx));
    const ty = fy - iy;
    const tx = fx - ix;
    const a = bzT[iy]![ix]! * (1 - tx) + bzT[iy]![ix + 1]! * tx;
    const b2 = bzT[iy + 1]![ix]! * (1 - tx) + bzT[iy + 1]![ix + 1]! * tx;
    return a * (1 - ty) + b2 * ty - R * 0.018;
  };
  const browZ = zAtBrow(eye.x, browY);
  const style = BROWS[spec.brows] ?? BROWS[0]!;
  const browColor = greyed(hairC, spec);
  const browMat = vertexToon("brow");
  const browGeo = (d: 0 | 1): BufferGeometry =>
    cachedGeo(`brow|${spec.brows}|${R.toFixed(5)}|${shape.front(eye.x, browY)[2].toFixed(4)}|${hex(browColor)}|${d}`, () => buildBrowGeometry(style, R, browColor, d, shape, eye.x, browY, spec.brows * 101 + 7));
  const browL = both(new Mesh(browGeo(0), browMat), browGeo(0), browGeo(1));
  const browR = both(new Mesh(browGeo(0), browMat), browGeo(0), browGeo(1));
  // Inner ends toward the nose: the left brow is mirrored so the thick end is always inner.
  browL.scale.x = -1;
  browL.position.set(-eye.x, browY, browZ);
  browR.position.set(eye.x, browY, browZ);
  browL.visible = browR.visible = style.visible !== false;
  root.add(browL, browR);

  // ---- mouth --------------------------------------------------------------------------------------------------------------------
  const mg = mouthGeo(shape, spec.teeth, accent);
  const mouthMat = vertexToon("mouth");
  const mouth = both(new Mesh(mg.full, mouthMat), mg.full, mg.line);
  mouth.frustumCulled = false; // (its morph targets carry it far from its rest bounds)
  root.add(mouth);

  for (const m of [browL, browR, mouth, eL.iris, eRr.iris, eL.lid, eRr.lid, eL.lower, eRr.lower, eL.glint, eRr.glint, eL.core, eRr.core]) m.castShadow = false;

  const skinIndex = new Map<string, number>(MORPH_NAMES.map((n, i) => [n, i]));
  const mouthIndex = new Map<string, number>(MOUTH_MORPH_NAMES.map((n, i) => [n, i]));
  const faceParts: FaceParts = {
    eyeL: eL.g,
    eyeR: eRr.g,
    pupilL: eL.iris,
    pupilR: eRr.iris,
    coreL: eL.core,
    coreR: eRr.core,
    glintL: eL.glint,
    glintR: eRr.glint,
    browL,
    browR,
    mouth,
    lidL: eL.lid,
    lidR: eRr.lid,
    lowerLidL: eL.lower,
    lowerLidR: eRr.lower,
    eyeRadius: eyeR,
    mouthWidth: mg.halfWidth * 2,
    browY,
    browX: eye.x,
    browZ: zAtBrow,
    lidBias: shp.bias,
    lowerLidBase: shp.lower,
    eyeTilt: shp.tilt,
    eyeScale: [shp.sx, shp.sy],
    active: true,
    pose: { ...NEUTRAL },
    setMorph(name, value) {
      const inf = ctx.headMesh()?.morphTargetInfluences;
      const si = skinIndex.get(name);
      if (inf && si !== undefined && si < inf.length) inf[si] = value;
      const minf = mouth.morphTargetInfluences;
      const mi = mouthIndex.get(name);
      if (minf && mi !== undefined && mi < minf.length) minf[mi] = value;
    },
  };
  const setDetail = (level: 0 | 1): void => {
    for (const [m, g0, g1] of swaps) {
      const g = level === 0 ? g0 : g1;
      if (m.geometry !== g) {
        m.geometry = g;
        m.updateMorphTargets(); // (the geometry on the other level may have no targets, or another number of them)
      }
    }
    eL.glint.visible = eRr.glint.visible = level === 0;
  };
  // the level-1 face frozen as it stands now (construction pose); each part's matrix up to the head bone, mirrored brows included
  const toHead = (mesh: Object3D): Matrix4 => {
    const m = new Matrix4();
    for (let n: Object3D | null = mesh; n && n !== parent; n = n.parent) {
      n.updateMatrix();
      m.premultiply(n.matrix);
    }
    return m;
  };
  const statics = swaps.filter(([m]) => m.visible).map(([m, , g1]) => ({ geometry: g1, matrix: toHead(m) }));
  return { face: faceParts, root, setDetail, statics };
}

export { greyed } from "./look.ts";
import { greyed } from "./look.ts";

const DUMMY_GROUP = new Group();
const DUMMY_MESH = new Mesh();

/**
 * The face of a far-crowd figure before it ever needed one: the same object shape as a built face, with shared inert placeholders and `active: false`
 * (the animator skips an inactive face). `buildFace` fills the SAME object in when the figure first comes close, so references to `rig.face` stay valid.
 */
export function inertFace(): FaceParts {
  return {
    eyeL: DUMMY_GROUP,
    eyeR: DUMMY_GROUP,
    pupilL: DUMMY_MESH,
    pupilR: DUMMY_MESH,
    coreL: DUMMY_MESH,
    coreR: DUMMY_MESH,
    glintL: DUMMY_MESH,
    glintR: DUMMY_MESH,
    browL: DUMMY_MESH,
    browR: DUMMY_MESH,
    mouth: DUMMY_MESH,
    lidL: DUMMY_MESH,
    lidR: DUMMY_MESH,
    lowerLidL: DUMMY_MESH,
    lowerLidR: DUMMY_MESH,
    eyeRadius: 0,
    mouthWidth: 0,
    browY: 0,
    browX: 0,
    browZ: () => 0,
    lidBias: 0,
    lowerLidBase: 0,
    eyeTilt: 0,
    eyeScale: [1, 1],
    active: false,
    pose: { ...NEUTRAL },
    setMorph() {},
  };
}
