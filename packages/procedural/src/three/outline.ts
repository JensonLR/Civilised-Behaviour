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
      attribute float hthin; // 0 = the full line, 0.45 = a line 55% as thick: a nose's bridge, where the hull would draw a bar across the face (parts.ts, sweep.ts)
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
        float t = thickness * clamp(10.0 / max(-mvPosition.z, 0.1), 0.4, 1.6) * (1.0 - hthin);
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
  // geometry without a `hthin` attribute (every instanced prop, every limb) reads 0: the whole line
  Object.assign(material.defaultAttributeValues, { hthin: [0] });
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


// ---- scenery ink ---------------------------------------------------------------------------------------------------------------------

/**
 * Anything a scenery ink line needs to follow a moving surface: a GLSL header (uniforms/functions) plus a statement that offsets
 * `local` (the instance-transformed model position, a vec4) so the hull sways with the trees it outlines. `key` names the variant for
 * the shader cache; `uniforms` are shared objects owned by the caller.
 */
export interface OutlineDisplace {
  key: string;
  uniforms: Record<string, { value: unknown }>;
  header: string;
  apply: string;
  /** Optional GLSL run on the hull's local-space `vec4 local` BEFORE the instance matrix is applied (so an animated instanced mesh can pose its own hull). */
  pre?: string;
}

export interface WorldOutlineOptions {
  /** Line width in device pixels while the object is within `near` metres: thinner than a character's (which is 2.2 and grows up close). */
  thickness: number;
  /** Beyond this distance the line thins (thickness * near / distance) down to `far` of its width. */
  near?: number;
  far?: number;
  displace?: OutlineDisplace;
}

/** Ink weight classes for scenery: bigger things carry a slightly heavier line, small things a hairline; all are thinner than a character's. */
export const WORLD_INK = { small: 1.05, medium: 1.45, large: 1.8 } as const;
export type WorldInkClass = keyof typeof WORLD_INK;

const worldMaterials = new Map<string, ShaderMaterial>();

/**
 * The scenery ink material: like `outlineMaterial()` (same inverted hull, same colour and fog) but thinner, constant while close and
 * easing thinner with distance, so a rock at arm's length does not wear a character's outline. Shared per (thickness, near, far,
 * displacement) variant; works on plain and instanced meshes.
 */
export function worldOutlineMaterial(o: WorldOutlineOptions): ShaderMaterial {
  const near = o.near ?? 12;
  const far = o.far ?? 0.42;
  const key = `${o.thickness}|${near}|${far}|${o.displace?.key ?? ""}`;
  const cached = worldMaterials.get(key);
  if (cached) return cached;
  const d = o.displace;
  const m = new ShaderMaterial({
    side: BackSide,
    fog: true,
    uniforms: UniformsUtils.merge([
      ShaderLib.basic.uniforms,
      {
        thickness: { value: o.thickness },
        near: { value: near },
        far: { value: far },
        viewport: { value: outlineSettings.viewport },
        outlineColor: { value: outlineSettings.color },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec3 onormal;
      uniform float thickness;
      uniform float near;
      uniform float far;
      uniform vec2 viewport;
      ${d?.header ?? ""}
      void main() {
        vec4 local = vec4(position, 1.0);
        vec3 on = onormal;
        ${d?.pre ?? ""}
        #ifdef USE_INSTANCING
          mat3 im = mat3(instanceMatrix);
          local = instanceMatrix * local;
          on /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
          on = im * on;
        #endif
        ${d?.apply ?? ""}
        vec4 mvPosition = modelViewMatrix * local;
        vec4 clip = projectionMatrix * mvPosition;
        vec3 n = normalize(normalMatrix * on);
        vec2 dir = normalize((projectionMatrix * vec4(n, 0.0)).xy + vec2(1e-6));
        float t = thickness * clamp(near / max(-mvPosition.z, 0.1), far, 1.0);
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
  // Shared by reference (UniformsUtils.merge clones values, which would freeze the wind at t = 0).
  if (d) Object.assign(m.uniforms, d.uniforms);
  m.customProgramCacheKey = (): string => `worldInk${key}`;
  worldMaterials.set(key, m);
  return m;
}

/** True for the character ink material and every scenery ink variant (they are shared across meshes and must not be disposed with one). */
export function isSharedInk(m: unknown): boolean {
  return m === material || (m instanceof ShaderMaterial && [...worldMaterials.values()].includes(m));
}

/** A hull for an InstancedMesh with the scenery ink instead of the character's. */
export function instancedWorldOutline(source: InstancedMesh, o: WorldOutlineOptions): InstancedMesh {
  const hull = instancedOutline(source);
  hull.material = worldOutlineMaterial(o);
  return hull;
}
