import { WORLD_INK, worldOutlineMaterial } from "@cb/procedural/three";
import type { Material, MeshBasicMaterial, MeshToonMaterial, ShaderMaterial } from "three";

/**
 * The haze answer for a landmark (package P, D-037). Highmark's capital is 200 m from the landing, and the scene's exponential fog is ~95% of every pixel at that range: a white town on a
 * pale plain under a pale sky simply disappears (BUILD_STATE: "the capital washes into the haze"). A LANDMARK gives a share of its own colour back, growing with distance: from 70 m out
 * up to `LANDMARK_FOG.share` of the pre-fog colour returns by 190 m, and it takes the share back as the fog thickens (fog weather, a storm) so the weather still hides it. The ink hull
 * gets the same, and its line stops thinning with distance past `LANDMARK_FOG.inkFar` of its width (the scenery's own ink eases to 42%, which at 200 m is under a pixel and gone).
 * Everything is the existing fog's own variables (`vFogDepth`, `fogDensity`): no new uniform, no new draw.
 */
export const LANDMARK_FOG = { from: 70, to: 190, share: 0.42, inkFar: 0.85, inkThickness: WORLD_INK.medium } as const;

const lift = (share: number): string => /* glsl */ `
#ifdef USE_FOG
  float landmarkShare = ${share.toFixed(2)} * smoothstep(${LANDMARK_FOG.from.toFixed(1)}, ${LANDMARK_FOG.to.toFixed(1)}, vFogDepth) * (1.0 - smoothstep(0.0105, 0.017, fogDensity));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, preFog, landmarkShare);
#endif
`;

/** Marks a material (toon or basic) as a landmark: it keeps `share` of its colour through the fog (see above; a light source keeps most of it). Idempotent. */
export function landmarkFog<T extends MeshToonMaterial | MeshBasicMaterial>(m: T, share: number = LANDMARK_FOG.share): T {
  if (m.userData.landmark) return m;
  m.userData.landmark = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer): void => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <colorspace_fragment>", "#include <colorspace_fragment>\n#ifdef USE_FOG\n  vec3 preFog = gl_FragColor.rgb;\n#endif")
      .replace("#include <premultiplied_alpha_fragment>", `${lift(share)}\n#include <premultiplied_alpha_fragment>`);
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = (): string => `${key()}|landmark${share}`;
  return m;
}

/**
 * The capital's ink: the scenery's hull (one shared material per variant) with a thicker floor at distance and the landmark share. The variant's key is its own (thickness and floor), so
 * nothing else in the game draws with this material.
 */
export function landmarkInk(): ShaderMaterial {
  const m = worldOutlineMaterial({ thickness: LANDMARK_FOG.inkThickness, far: LANDMARK_FOG.inkFar });
  if (m.userData.landmark) return m;
  m.userData.landmark = true;
  m.fragmentShader = m.fragmentShader.replace("#include <fog_fragment>", `#ifdef USE_FOG\n  vec3 preFog = gl_FragColor.rgb;\n#endif\n#include <fog_fragment>\n${lift(LANDMARK_FOG.share)}`);
  m.needsUpdate = true;
  return m;
}

/** Test hook: the fragment shader of a material, whatever its kind. */
export const fragmentOf = (m: Material): string => (m as ShaderMaterial).fragmentShader ?? "";
