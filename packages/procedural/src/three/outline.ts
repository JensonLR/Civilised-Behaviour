import { PALETTE } from "@cb/shared";
import { BackSide, Color, DataTexture, InstancedMesh, NearestFilter, RedFormat, ShaderLib, ShaderMaterial, UniformsUtils, Vector2 } from "three";

/**
 * Silhouette outline: an inverted hull pushed outward along each vertex's smoothed `onormal` in clip space, so the line
 * has constant on-screen thickness (and eases thinner with distance). One extra draw per bone mesh; the game enables it for
 * the local player and nearby characters only (crowds skip it - see docs/PERFORMANCE.md).
 *
 * Works on `InstancedMesh` too (world trees, rocks, props): with USE_INSTANCING the hull is pushed out from the instance's own
 * transform, so one outline draw covers every instance. Geometry needs the smoothed `onormal` attribute: `addOutlineNormals`
 * (parts.ts) adds it to any BufferGeometry.
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
        vec4 local = vec4(position, 1.0);
        vec3 on = onormal;
        #ifdef USE_INSTANCING
          mat3 im = mat3(instanceMatrix);
          local = instanceMatrix * local;
          on /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])); // inverse-transpose for non-uniform instance scale
          on = im * on;
        #endif
        vec4 mvPosition = modelViewMatrix * local;
        vec4 clip = projectionMatrix * mvPosition;
        vec3 n = normalize(normalMatrix * on);
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

/**
 * The hull for an InstancedMesh: shares its geometry and its instance matrices (same GPU buffer), so it costs one extra draw for
 * all instances and follows every change to them. Call `syncInstancedOutline` after changing `source.count`.
 */
export function instancedOutline(source: InstancedMesh): InstancedMesh {
  const hull = new InstancedMesh(source.geometry, outlineMaterial(), source.instanceMatrix.count);
  hull.instanceMatrix = source.instanceMatrix;
  hull.count = source.count;
  hull.frustumCulled = source.frustumCulled;
  hull.name = `${source.name}_outline`;
  return hull;
}

export function syncInstancedOutline(hull: InstancedMesh, source: InstancedMesh): void {
  hull.count = source.count;
}

const TOON_STEPS = [120, 175, 225, 255] as const;
let worldRamp: DataTexture | undefined;

/**
 * The 4-step lighting ramp for anything that is not a character (terrain, trees, rocks, camp, props). It holds the same four
 * values as the ramp the character rig uses, so a hill and a hat are lit in the same bands. (rig.ts keeps its own private copy;
 * if the two ever diverge, the world will look lit by a different sun - keep them equal.)
 */
export function sharedToonRamp(): DataTexture {
  if (worldRamp) return worldRamp;
  const tex = new DataTexture(new Uint8Array(TOON_STEPS), TOON_STEPS.length, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return (worldRamp = tex);
}

