import { PALETTE } from "@cb/shared";
import { BackSide, Color, ShaderLib, ShaderMaterial, UniformsUtils, Vector2 } from "three";

/**
 * Silhouette outline: an inverted hull pushed outward along each vertex's smoothed `onormal` in clip space, so the line
 * has constant on-screen thickness (and eases thinner with distance). One extra draw per bone mesh; the game enables it for
 * the local player and nearby characters only (crowds skip it - see docs/PERFORMANCE.md).
 */
export const outlineSettings = {
  /** Base thickness in device pixels at ~10 m. */
  thickness: 2.2,
  viewport: new Vector2(1280, 720),
  color: new Color(PALETTE.ink),
};

let material: ShaderMaterial | undefined;

export function outlineMaterial(): ShaderMaterial {
  if (material) return material;
  material = new ShaderMaterial({
    side: BackSide,
    fog: true,
    uniforms: UniformsUtils.merge([
      ShaderLib.basic.uniforms,
      {
        thickness: { value: outlineSettings.thickness },
        viewport: { value: outlineSettings.viewport },
        outlineColor: { value: outlineSettings.color },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec3 onormal;
      uniform float thickness;
      uniform vec2 viewport;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * mvPosition;
        vec3 n = normalize(normalMatrix * onormal);
        vec2 dir = normalize((projectionMatrix * vec4(n, 0.0)).xy + vec2(1e-6));
        float t = thickness * clamp(10.0 / max(-mvPosition.z, 0.1), 0.4, 1.6);
        clip.xy += dir * (t * 2.0 / viewport) * clip.w;
        gl_Position = clip;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 outlineColor;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(outlineColor, 1.0);
        #include <fog_fragment>
      }`,
  });
  return material;
}

/** Call when the drawing buffer size changes (device pixels). */
export function setOutlineViewport(width: number, height: number): void {
  outlineSettings.viewport.set(width, height);
}
