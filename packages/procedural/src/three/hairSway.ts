import { BufferAttribute, MeshToonMaterial, ShaderMaterial, type BufferGeometry, type Vector3 } from "three";
import { smooth } from "./shell.ts";
import type { HeadFit } from "./headFit.ts";
import { morphOutlineMaterial } from "./faceMorph.ts";
import { outlineMaterial } from "./outline.ts";

/**
 * Hair sway: cheap, per-vertex, LOD-aware. The head's geometry (and its ink hull) carries two extra attributes, `hsw` (a vec4: the weight of each quadrant of the sway box) and `hsy`, written when the head is built
 * (`addHairSway`); a vertex shader chunk moves each vertex by `uSway * weight` in the head bone's frame, where `uSway` is ONE vec3 per rig that the animator drives
 * (animator.ts: a spring that lags the head's motion). Nothing else changes: the same triangles, the same draw calls, the same geometry cache; a rig draws the head with its own
 * material (a clone of the shared cloth shader with the chunk), so one character's hair never moves another's.
 *  - the WEIGHT is how far a vertex stands off the scalp, so roots are 0 and tips are 1: short hair, whose whole thickness is a few millimetres, does not move at all; a tail, a plait
 *    or a mohawk's spikes do;
 *  - the LIMITS keep the hair out of the body: for each vertex and each quadrant of the box (right/left x back/forward) the build asks the head fit's solid field (skull, neck, trunk,
 *    arms) how much of the full corner of that quadrant it may travel before it would sink more than 3 mm deeper than it already sits, and stores that fraction in the weight. The
 *    shader picks the quadrant for the signs of the sway, so hair that hangs against a shoulder streams freely away from it and does not move into it.
 * Crowd levels merge the head into one skinned mesh and never build the attribute (merged.ts ignores it): they cost nothing and stay frozen.
 */

/** The furthest a tip may be moved (metres) by each axis of `uSway`: sideways, up, back (+z in the head frame is behind the character). */
export const HAIR_SWAY_MAX = { x: 0.05, y: 0.015, z: 0.08 } as const;
/** The quadrants of the sway box, in the order the shader reads them: (right, back), (right, forward), (left, back), (left, forward) as the signs of (x, z). */
const QUADRANT: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
/** How much deeper than it already sits a hair vertex may be driven into the skull, neck or trunk by the sway (metres). */
const SWAY_SINK = 0.0015;

/** The uniform one rig owns; the animator writes `value` (head bone frame, metres at weight 1). */
export interface HairSwayUniform {
  value: Vector3;
}

/**
 * Writes `hsw` (the weight of each quadrant of the sideways/back-forward box) and `hsy` (the weight of the lift) from the hair vertices (`flag` is 1 for a vertex that belongs to hair, 0
 * for skin, ears, nose, beard). Pure and deterministic: a vertex's entries are a function of its position, so the main mesh and the coarser ink hull of the same head move alike.
 * Quadrant order: (right, back), (right, forward), (left, back), (left, forward); `x` is the character's right and +z is behind it.
 */
export function addHairSway(geo: BufferGeometry, flag: BufferAttribute, hf: HeadFit): void {
  const pos = geo.attributes.position!;
  const n = pos.count;
  const hsw = new Float32Array(n * 4);
  const hsy = new Float32Array(n);
  const { R, cy } = hf;
  const { x: X, y: Y, z: Z } = HAIR_SWAY_MAX;
  for (let i = 0; i < n; i++) {
    if (flag.getX(i) < 0.5) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const dy = y - cy;
    const l = Math.hypot(x, dy, z) || 1e-9;
    const stand = l - hf.shape.radius(x / l, dy / l, z / l); // how far this vertex stands off the scalp
    const w = smooth(0.08, 1.0, stand / R);
    if (w < 0.01) continue; // (a root, or a short style's whole thickness: it does not move)
    const floor = Math.min(hf.solidDist(x, y, z), 0) - SWAY_SINK;
    // the largest fraction s of a displacement (dx, dy, dz) at which the vertex is still outside `floor`: the full travel if the whole path is clear, else the last clear place before it goes under, less 10%.
    // SPHERE-TRACED (each step is 0.6 of the distance to the nearest solid, at least 1.2 mm): a thin obstacle (a ruff, a bedroll, a cape's rim) cannot be stepped over, which a fixed 6-step march could do (D-038).
    const safe = (dx: number, dyy: number, dz: number, fixedY = 0): number => {
      const L = Math.hypot(dx, dyy, dz);
      if (L < 1e-9) return 1;
      let t = 0;
      let s = 0;
      for (let step = 0; step < 80 && t < 1; step++) {
        const d = hf.solidDist(x + dx * t, y + fixedY + dyy * t, z + dz * t) - floor;
        if (d < 0) return s * 0.9;
        s = t;
        t += Math.max(d * 0.6, 0.0012) / L;
      }
      return t >= 1 ? 1 : s * 0.9;
    };
    const up = safe(0, Y * w, 0);
    hsy[i] = w * up;
    // each quadrant: the corner of the box (full sideways AND full back/forward AND the lift) decides how much of that whole quadrant the vertex may use
    for (let k = 0; k < 4; k++) {
      const dx = QUADRANT[k]![0] * X * w;
      const dz = QUADRANT[k]![1] * Z * w;
      // every combination of the three drives that are on (the animator moves them independently; a solid is not convex, so the corner alone is not enough)
      let m = 1;
      // (the lift is driven on its own weight: the x/z travel is scaled with the lift held at ITS full value, which is what the shader does)
      for (const ay of [0, Y * w * up]) for (const [ax, az] of [[dx, 0], [0, dz], [dx, dz]] as const) m = Math.min(m, safe(ax, 0, az, ay));
      hsw[i * 4 + k] = w * m;
    }
  }
  geo.setAttribute("hsw", new BufferAttribute(hsw, 4));
  geo.setAttribute("hsy", new BufferAttribute(hsy, 1));
}

/** The displacement of one vertex (the CPU twin of the shader chunk, for tests): `hsw`/`hsy` are the vertex's attributes, `sway` the rig's vec3. */
export function swayOffset(hsw: readonly [number, number, number, number], hsy: number, sway: Vector3, out: Vector3): Vector3 {
  const q = sway.x >= 0 ? (sway.z >= 0 ? hsw[0] : hsw[1]) : sway.z >= 0 ? hsw[2] : hsw[3];
  return out.set(sway.x * q, sway.y * hsy, sway.z * q);
}

const GLSL_PARS = /* glsl */ `
attribute vec4 hsw;
attribute float hsy;
uniform vec3 uSway;
vec3 hairSway() {
  float q = uSway.x >= 0.0 ? (uSway.z >= 0.0 ? hsw.x : hsw.y) : (uSway.z >= 0.0 ? hsw.z : hsw.w);
  return vec3(uSway.x * q, uSway.y * hsy, uSway.z * q);
}`;

/** A copy of the shared cloth material for a head that has hair on it: the same toon shading, plus the sway chunk reading this rig's uniform. */
export function hairSwayMaterial(like: MeshToonMaterial, u: HairSwayUniform): MeshToonMaterial {
  const m = new MeshToonMaterial({ vertexColors: like.vertexColors, gradientMap: like.gradientMap });
  (m as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = { hsw: [0, 0, 0, 0], hsy: [0] }; // (three reads this off any material; a head without the attribute does not sway)
  m.onBeforeCompile = (shader): void => {
    shader.uniforms.uSway = u;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${GLSL_PARS}`).replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += hairSway();");
  };
  m.customProgramCacheKey = (): string => "hairSway";
  return m;
}

/** The ink hull of such a head: the (morphing) character outline with the same chunk, so the line follows the hair it outlines. */
export function hairSwayHullMaterial(morph: boolean, u: HairSwayUniform): ShaderMaterial {
  const base = morph ? morphOutlineMaterial() : outlineMaterial();
  const anchor = morph ? "vec4 local = vec4(transformed, 1.0);" : "vec4 local = vec4(position, 1.0);";
  const body = base.vertexShader;
  if (!body.includes(anchor) || !body.includes("attribute vec3 onormal;")) return base; // (the base shader changed: no sway rather than a broken line)
  const m = new ShaderMaterial({
    side: base.side,
    fog: base.fog,
    defaultAttributeValues: { ...(base.defaultAttributeValues as Record<string, number[]>), hsw: [0, 0, 0, 0], hsy: [0] } as unknown as ShaderMaterial["defaultAttributeValues"],
    uniforms: { ...base.uniforms, uSway: u },
    vertexShader: body.replace("attribute vec3 onormal;", `attribute vec3 onormal;${GLSL_PARS}`).replace(anchor, anchor.replace(/(position|transformed)/, "$1 + hairSway()")),
    fragmentShader: base.fragmentShader,
  });
  m.customProgramCacheKey = (): string => (morph ? "hairSwayHullMorph" : "hairSwayHull");
  return m;
}
