import { PALETTE } from "@cb/shared";
import { BackSide, Color, DataTexture, InstancedMesh, NearestFilter, RedFormat, ShaderLib, ShaderMaterial, UniformsUtils, Vector2, Vector4 } from "three";

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
  /** The third-person lens's subject (xyz: the player's chest; w: 1 in third person, 0 in first), shared by reference with the scenery's own fade (the client's `uFocus`). */
  focus: new Vector4(0, 0, 0, 0),
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
 * The 4-step lighting ramp, one texture for everything: the characters (rig.ts) and the world (terrain, trees, rocks, camp, props), so a hill and a hat are
 * lit in the same bands. Banded light and shadow give forms a graphic, illustrated read that flat PBR shading smears out.
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
  /**
   * The body this hull outlines dissolves near the lens and on the line to the player (the client's D-077 scenery fade): the hull must go with it. A hull is drawn from
   * its back faces, and only the body in front hides them; dither the body away and the hull's far inside shows through as a black slab. So the hull dissolves too, and
   * sooner: what decides is the body face in FRONT of it, which can be up to an object's depth nearer the lens (see `HULL_FADE`).
   */
  fade?: boolean;
}

/**
 * The hull's dissolve, matched to the body's (`FADE_BODY` in the client's toon.ts: keep = smoothstep(0.35, 1.3, distance) near the lens, a quarter inside the tunnel
 * to the player). A hull fragment lies on the far side of its object, `depth` behind the body face that hides it, so its distance is taken that much nearer before the
 * same ramp; and in the tunnel it goes entirely (a quarter of its pixels would show as black dots through the body's holes). The ink of things in the last metres
 * before the lens is the price: they are dissolving anyway.
 */
const HULL_FADE = /* glsl */ `
  {
    vec3 toFrag = vWPos - cameraPosition;
    float keep = mix(1.0, smoothstep(0.35, 1.3, length(toFrag) - 1.5), uFocus.w);
    if (uFocus.w > 0.5) {
      vec3 ab = uFocus.xyz - cameraPosition;
      float L = length(ab);
      vec3 dir = ab / max(L, 1e-3);
      float t = dot(toFrag, dir);
      if (t > 0.0 && t < L - 0.2) keep = min(keep, smoothstep(0.6, 1.3, length(toFrag - dir * t)));
    }
    int bi = int(mod(gl_FragCoord.x, 4.0)) + int(mod(gl_FragCoord.y, 4.0)) * 4;
    float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    if (keep < 0.999 && keep < (bayer[bi] + 0.5) / 16.0) discard;
  }
`;

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
  const fade = o.fade === true;
  const key = `${o.thickness}|${near}|${far}|${o.displace?.key ?? ""}${fade ? "|f" : ""}`;
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
      ${fade ? "varying vec3 vWPos;" : ""}
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
        ${fade ? "vWPos = (modelMatrix * local).xyz;" : ""}
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
      ${fade ? "uniform vec4 uFocus;\n      varying vec3 vWPos;" : ""}
      #include <fog_pars_fragment>
      void main() {
        ${fade ? HULL_FADE : ""}
        gl_FragColor = vec4(outlineColor, 1.0);
        #include <fog_fragment>
      }`,
  });
  // Shared by reference (UniformsUtils.merge clones values, which would freeze the wind at t = 0).
  if (d) Object.assign(m.uniforms, d.uniforms);
  if (fade) m.uniforms.uFocus = { value: outlineSettings.focus };
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
