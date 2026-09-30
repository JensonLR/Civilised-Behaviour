import { BufferAttribute, BufferGeometry, ShaderMaterial } from "three";
import type { Proportions } from "../proportions.ts";
import { outlineMaterial } from "./outline.ts";
import { smooth } from "./shell.ts";
import { MOUTH_BAND } from "./headShape.ts";

/**
 * Face deformation as morph targets on the head geometry. The skin, the jaw beard, the sideburns and the moustache are ONE merged surface, so a
 * smile or an open mouth has to move all of them together without cracks; morph targets do exactly that, and the animator only drives a handful of
 * numbers. The deltas are computed once per head from position alone (a falloff field per target, `faceDeltas`), so hats, ears, neck and eyewear (which are
 * merged into the same geometry but flagged rigid with a per-vertex weight of 0) never move. The mouth interior (mouthGeo.ts) is built from the SAME
 * function, so the dark opening, the teeth and the tongue stay exactly on the lips that frame them.
 *
 *   jaw       the chin, lower lip and the beard hanging from it rotate down and back about a hinge near the ears (the lips open between two rows of the skull, see MOUTH_BAND)
 *   smile     mouth corners lift and widen, cheeks bunch up
 *   frown     mouth corners drop, chin pushes up, the lower lip pouts
 *   squint    cheeks push up under the eyes
 *   puff      cheeks swell outward
 *   pucker    lips purse forward, corners draw in (an O, a kiss, a whistle)
 *   stretch   corners pulled straight out and back (a grimace, a scream)
 *   snarl     the upper lip and the folds beside the nose lift, the nostrils flare (disgust, a snarl, effort)
 *   smirkL/R  ONE corner of the mouth up (smug, drunk); L is the character's left
 *   browUp    the forehead lifts and bulges (surprise, fear)
 *   browKnit  the inner brows draw down and together, the glabella bunches (anger, concentration, pain)
 */
export const MORPH_NAMES = ["jaw", "smile", "frown", "squint", "puff", "pucker", "stretch", "snarl", "smirkL", "smirkR", "browUp", "browKnit"] as const;
export type MorphName = (typeof MORPH_NAMES)[number];
/** The mouth interior's own targets: the skin's, then teeth bared with the jaw shut and the tongue out. */
export const MOUTH_MORPH_NAMES = [...MORPH_NAMES, "bare", "tongue"] as const;
export type MouthMorphName = (typeof MOUTH_MORPH_NAMES)[number];

/** Jaw hinge in units of the head radius, relative to the head centre: just below and behind the ear. */
export const JAW_HINGE = { y: -0.06, z: 0.2 } as const;
/** Largest jaw rotation in radians (a full gape). */
export const JAW_MAX = 0.3;
/** Height of the mouth groove (units of R): the jaw's moving region starts here. */
export const MOUTH_Y = -0.49;

/** Where a point at (y, z) (both head-centre relative, metres) ends up when the jaw is `open` (0..1) open. */
export function jawPoint(R: number, open: number, y: number, z: number): [number, number] {
  const a = JAW_MAX * open;
  const hy = JAW_HINGE.y * R;
  const hz = JAW_HINGE.z * R;
  const dy = y - hy;
  const dz = z - hz;
  return [hy + dy * Math.cos(a) + dz * Math.sin(a), hz - dy * Math.sin(a) + dz * Math.cos(a)];
}

/**
 * How much a point (in units of R, head-centre relative) belongs to the moving jaw: 0 at and above the upper row of the mouth band, 1 at and below the lower row (linear in
 * elevation between them, exactly as the skin's own triangles interpolate), fading out toward the ears. Near the corners of the mouth the lip rows are held back, so the
 * opening is a D and not a rectangle (the commissure stays put; the chin and the cheeks beyond it move with the bone).
 */
export function jawWeight(x: number, y: number, z: number): number {
  const l = Math.hypot(x, y, z) || 1;
  const th = Math.asin(Math.max(-1, Math.min(1, y / l)));
  const base = Math.max(0, Math.min(1, (MOUTH_BAND.up - th) / (MOUTH_BAND.up - MOUTH_BAND.lo)));
  if (base <= 0) return 0;
  const az = Math.abs(Math.atan2(x, -z));
  const ax = Math.abs(x);
  const corner = smooth(0.1, 0.26, ax) * (1 - smooth(0.3, 0.42, ax));
  const band = 1 - smooth(-0.62, -0.74, th);
  return base * (1 - smooth(0.85, 1.55, az)) * (1 - 0.8 * corner * band);
}

const gauss = (x: number, y: number, z: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): number => {
  const a = (x - cx) / sx;
  const b = (y - cy) / sy;
  const c = (z - cz) / sz;
  return Math.exp(-(a * a + b * b + c * c));
};

const SA = Math.sin(JAW_MAX);
const CA = Math.cos(JAW_MAX);
const K = MORPH_NAMES.length;

/**
 * The displacement of every morph target at a point of the face, in units of R, written to `out` (3 numbers per target in MORPH_NAMES order: dx, dy, dz; `out` is zeroed
 * first). `x, y, z` are in units of R relative to the head centre. `jawW` overrides the jaw weight (the mouth interior gives its own).
 */
export function faceDeltas(x: number, y: number, z: number, out: Float64Array, jawW?: number): void {
  out.fill(0, 0, K * 3);
  if (z > 0.35) return; // the back half of the head never moves
  const ax = Math.abs(x);
  const sgn = Math.sign(x) || 1;
  // jaw: rotate about the hinge, scaled by the weight
  const wj = jawW ?? jawWeight(x, y, z);
  if (wj > 0) {
    const dy = y - JAW_HINGE.y;
    const dz = z - JAW_HINGE.z;
    out[1] = (dy * CA + dz * SA - dy) * wj;
    out[2] = (-dy * SA + dz * CA - dz) * wj;
  }
  const corner = gauss(ax, y, z, 0.3, MOUTH_Y, -0.85, 0.2, 0.16, 0.4);
  const cheek = gauss(ax, y, z, 0.5, -0.2, -0.75, 0.24, 0.22, 0.4);
  // smile: corners of the mouth up/out, cheeks up and forward
  out[3] = sgn * (corner * 0.07 + cheek * 0.03);
  out[4] = corner * 0.13 + cheek * 0.08;
  out[5] = -(cheek * 0.05 + corner * 0.02);
  // frown: corners down, the chin pushes up and out, the lower lip pouts
  const chin = gauss(ax, y, z, 0, -0.75, -0.7, 0.3, 0.2, 0.4);
  const lowerLip = gauss(x, y, z, 0, -0.57, -0.86, 0.2, 0.06, 0.2);
  out[6] = -sgn * corner * 0.03;
  out[7] = -corner * 0.11 + chin * 0.06 + lowerLip * 0.02;
  out[8] = -chin * 0.04 - lowerLip * 0.03;
  // squint: cheeks push up under the eyes
  const under = gauss(ax, y, z, 0.45, -0.02, -0.85, 0.24, 0.14, 0.4);
  out[10] = (under * 0.07 + cheek * 0.03);
  out[11] = -under * 0.03;
  // puff: cheeks swell outward
  const puffW = gauss(ax, y, z, 0.6, -0.3, -0.6, 0.3, 0.26, 0.45);
  out[12] = sgn * puffW * 0.1;
  out[14] = -puffW * 0.04;
  // pucker: lips purse forward and the corners draw in
  const purse = gauss(ax, y, z, 0.12, MOUTH_Y, -0.88, 0.34, 0.14, 0.45);
  out[15] = -sgn * ax * 0.5 * purse;
  out[16] = 0.0;
  out[17] = -0.075 * purse - 0.03 * chin;
  // stretch: corners pulled straight out and a little back, cheeks flattened
  out[18] = sgn * corner * 0.1;
  out[19] = -corner * 0.025;
  out[20] = corner * 0.03 + cheek * 0.025;
  // snarl: upper lip and the folds beside the nose lift, the nostrils flare
  const up = gauss(ax, y, z, 0.12, -0.4, -0.92, 0.32, 0.07, 0.3);
  const fold = gauss(ax, y, z, 0.26, -0.36, -0.9, 0.12, 0.1, 0.3);
  const wing = gauss(ax, y, z, 0.12, -0.24, -1.0, 0.1, 0.08, 0.25);
  out[21] = sgn * (fold * 0.015 + wing * 0.03);
  out[22] = up * 0.075 + fold * 0.06 + wing * 0.03;
  out[23] = -up * 0.01;
  // one corner up: [L, R] (x > 0 is the character's right)
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? -1 : 1;
    const g = gauss(x, y, z, side * 0.3, MOUTH_Y, -0.85, 0.2, 0.16, 0.4);
    const ch = gauss(x, y, z, side * 0.5, -0.2, -0.75, 0.24, 0.22, 0.4);
    out[24 + k * 3] = side * (g * 0.05 + ch * 0.02);
    out[25 + k * 3] = g * 0.12 + ch * 0.06;
    out[26 + k * 3] = -ch * 0.03;
  }
  // brows: the forehead lifts; the inner brows draw down and together
  const fh = gauss(x, y, z, 0, 0.45, -0.85, 0.75, 0.32, 0.45);
  out[30] = 0;
  out[31] = fh * 0.07;
  out[32] = -fh * 0.02;
  const knit = gauss(ax, y, z, 0.16, 0.3, -0.95, 0.16, 0.12, 0.25);
  const glab = gauss(ax, y, z, 0.05, 0.42, -0.9, 0.1, 0.1, 0.3);
  out[33] = -sgn * knit * 0.04;
  out[34] = -knit * 0.035;
  out[35] = -knit * 0.03 - glab * 0.02;
}

/**
 * Adds the morph targets to a merged head geometry. `mw` is the per-vertex rigidity weight (1 = part of the face surface, 0 = rigid).
 * `cy` is the height of the head centre in the geometry's frame. Deltas are relative (`morphTargetsRelative`).
 */
export function addFaceMorphs(geo: BufferGeometry, mw: BufferAttribute, P: Proportions, cy: number): void {
  const R = P.headRadius;
  const pos = geo.attributes.position as BufferAttribute;
  const n = pos.count;
  const targets = MORPH_NAMES.map(() => new Float32Array(n * 3));
  const d = new Float64Array(K * 3);
  for (let i = 0; i < n; i++) {
    if (mw.getX(i) < 0.5) continue;
    faceDeltas(pos.getX(i) / R, (pos.getY(i) - cy) / R, pos.getZ(i) / R, d);
    for (let k = 0; k < K; k++) {
      const t = targets[k]!;
      t[i * 3] = d[k * 3]! * R;
      t[i * 3 + 1] = d[k * 3 + 1]! * R;
      t[i * 3 + 2] = d[k * 3 + 2]! * R;
    }
  }
  geo.morphAttributes.position = targets.map((t) => new BufferAttribute(t, 3));
  geo.morphTargetsRelative = true;
  geo.userData.morphNames = MORPH_NAMES;
}

let morphOutline: ShaderMaterial | undefined;

/**
 * The outline material for a hull that has morph targets: the standard ink hull (outline.ts) with the morph-target chunks compiled in, sharing its
 * uniform objects so thickness, viewport and colour stay in sync. Falls back to the plain hull material if the shader ever stops matching.
 */
export function morphOutlineMaterial(): ShaderMaterial {
  if (morphOutline) return morphOutline;
  const base = outlineMaterial();
  const anchor = "vec4 local = vec4(position, 1.0);";
  if (!base.vertexShader.includes(anchor)) return (morphOutline = base);
  const m = new ShaderMaterial({
    side: base.side,
    fog: base.fog,
    uniforms: base.uniforms, // same objects: outlineSettings changes reach this material too
    vertexShader: base.vertexShader
      .replace("attribute vec3 onormal;", "attribute vec3 onormal;\n#include <morphtarget_pars_vertex>")
      .replace(anchor, "vec3 transformed = vec3(position);\n#include <morphtarget_vertex>\nvec4 local = vec4(transformed, 1.0);"),
    fragmentShader: base.fragmentShader,
  });
  return (morphOutline = m);
}
