import { BufferAttribute, BufferGeometry, ShaderMaterial } from "three";
import type { Proportions } from "../proportions.ts";
import { outlineMaterial } from "./outline.ts";
import { smooth } from "./shell.ts";

/**
 * Face deformation as morph targets on the head geometry. The skin, the jaw beard, the sideburns and the moustache are ONE merged surface, so a
 * smile or an open mouth has to move all of them together without cracks; morph targets do exactly that, and the animator only drives five
 * numbers. The deltas are computed once per head from position alone (a falloff field per expression), so hats, ears, neck and eyewear (which are
 * merged into the same geometry but flagged rigid with a per-vertex weight of 0) never move.
 *
 *   jaw     the chin, lower lip and the beard hanging from it rotate down and back about a hinge near the ears
 *   smile   mouth corners lift and widen, cheeks bunch up
 *   frown   mouth corners drop, chin pushes up
 *   squint  cheeks push up under the eyes
 *   puff    cheeks swell outward
 */
export const MORPH_NAMES = ["jaw", "smile", "frown", "squint", "puff"] as const;
export type MorphName = (typeof MORPH_NAMES)[number];

/** Jaw hinge in units of the head radius, relative to the head centre: just below and behind the ear. */
export const JAW_HINGE = { y: -0.06, z: 0.2 } as const;
/** Largest jaw rotation in radians (a full gape). */
export const JAW_MAX = 0.3;
/** Height of the mouth groove (units of R): the jaw's moving region starts here. */
export const MOUTH_Y = -0.49;

/** Where a point at (y, z) (both head-centre relative, metres) ends up when the jaw is `open` (0..1) open. Used to place teeth, tongue and the cavity. */
export function jawPoint(R: number, open: number, y: number, z: number): [number, number] {
  const a = JAW_MAX * open;
  const hy = JAW_HINGE.y * R;
  const hz = JAW_HINGE.z * R;
  const dy = y - hy;
  const dz = z - hz;
  return [hy + dy * Math.cos(a) + dz * Math.sin(a), hz - dy * Math.sin(a) + dz * Math.cos(a)];
}

/** How much a point (in units of R, head-centre relative) belongs to the moving jaw: 0 above the mouth groove and near the ears, 1 on the chin. */
export function jawWeight(x: number, y: number, z: number): number {
  const below = smooth(MOUTH_Y + 0.005, MOUTH_Y - 0.06, y);
  if (below <= 0) return 0;
  const az = Math.abs(Math.atan2(x, -z));
  return below * (1 - smooth(0.85, 1.55, az));
}

const gauss = (x: number, y: number, z: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): number => {
  const a = (x - cx) / sx;
  const b = (y - cy) / sy;
  const c = (z - cz) / sz;
  return Math.exp(-(a * a + b * b + c * c));
};

/**
 * Adds the five morph targets to a merged head geometry. `mw` is the per-vertex rigidity weight (1 = part of the face surface, 0 = rigid).
 * `cy` is the height of the head centre in the geometry's frame. Deltas are relative (`morphTargetsRelative`).
 */
export function addFaceMorphs(geo: BufferGeometry, mw: BufferAttribute, P: Proportions, cy: number): void {
  const R = P.headRadius;
  const pos = geo.attributes.position as BufferAttribute;
  const n = pos.count;
  const targets = MORPH_NAMES.map(() => new Float32Array(n * 3));
  const [jaw, smile, frown, squint, puff] = targets as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  const a = JAW_MAX;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const hy = JAW_HINGE.y;
  const hz = JAW_HINGE.z;
  for (let i = 0; i < n; i++) {
    if (mw.getX(i) < 0.5) continue;
    const x = pos.getX(i) / R;
    const y = (pos.getY(i) - cy) / R;
    const z = pos.getZ(i) / R;
    const ax = Math.abs(x);
    if (z > 0.35) continue; // the back half of the head never moves
    // jaw: rotate about the hinge, scaled by the weight
    const wj = jawWeight(x, y, z);
    if (wj > 0) {
      const dy = y - hy;
      const dz = z - hz;
      jaw[i * 3 + 1] = (dy * ca + dz * sa - dy) * wj * R;
      jaw[i * 3 + 2] = (-dy * sa + dz * ca - dz) * wj * R;
    }
    // smile: corners of the mouth up/out, cheeks up and forward
    const corner = gauss(ax, y, z, 0.3, MOUTH_Y, -0.85, 0.2, 0.16, 0.4);
    const cheek = gauss(ax, y, z, 0.5, -0.2, -0.75, 0.24, 0.22, 0.4);
    const sgn = Math.sign(x) || 1;
    smile[i * 3] = sgn * (corner * 0.07 + cheek * 0.03) * R;
    smile[i * 3 + 1] = (corner * 0.13 + cheek * 0.08) * R;
    smile[i * 3 + 2] = -(cheek * 0.05 + corner * 0.02) * R;
    // frown: corners down, the chin pushes up and out
    const chin = gauss(ax, y, z, 0, -0.75, -0.7, 0.3, 0.2, 0.4);
    frown[i * 3] = -sgn * corner * 0.03 * R;
    frown[i * 3 + 1] = (-corner * 0.11 + chin * 0.06) * R;
    frown[i * 3 + 2] = -chin * 0.04 * R;
    // squint: cheeks push up under the eyes
    const under = gauss(ax, y, z, 0.45, -0.02, -0.85, 0.24, 0.14, 0.4);
    squint[i * 3 + 1] = (under * 0.07 + cheek * 0.03) * R;
    squint[i * 3 + 2] = -under * 0.03 * R;
    // puff: cheeks swell outward
    const puffW = gauss(ax, y, z, 0.6, -0.3, -0.6, 0.3, 0.26, 0.45);
    puff[i * 3] = sgn * puffW * 0.1 * R;
    puff[i * 3 + 2] = -puffW * 0.04 * R;
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
