import { Color, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial } from "three";
import { PALETTE, Rng } from "@cb/shared";
import { atmoUniforms } from "./atmosphere.ts";
import { worldTime } from "./toon.ts";

/**
 * Rain: one pooled InstancedMesh of thin streaks that fall through a box which follows the camera (positions are a function of time and
 * a per-streak seed evaluated in the vertex shader, so the CPU writes nothing per frame and nothing allocates). Each streak is a quad
 * stretched along its fall direction and turned to face the camera; `uRain` (0..1) decides how many of them exist, the wind slants them.
 * The pool is fixed at build time and scales with the preset (`low` builds none: rain there is a tint and fog only).
 */
export const RAIN_BOX = { x: 34, y: 18, z: 34 } as const;

export function buildRain(count: number, baseY: { value: number }): InstancedMesh | undefined {
  if (count <= 0) return undefined;
  const geo = new PlaneGeometry(1, 1);
  const rng = new Rng(0x8a17);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = rng.next();
  geo.setAttribute("aSeed", new InstancedBufferAttribute(seed, 4));
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: worldTime, uRain: atmoUniforms.uRain, uWindK: atmoUniforms.uWindK, rainCol: { value: new Color(PALETTE.world.rain) }, uSheen: atmoUniforms.uSheen, uBaseY: baseY } as unknown as Record<string, { value: unknown }>,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime; uniform float uRain; uniform float uWindK; uniform float uBaseY;
      varying float vA; varying vec2 vUv;
      void main() {
        vec3 box = vec3(${RAIN_BOX.x.toFixed(1)}, ${RAIN_BOX.y.toFixed(1)}, ${RAIN_BOX.z.toFixed(1)});
        // the density scales with the rain: streaks above the current threshold do not exist
        float present = 1.0 - step(uRain * 1.05 + 0.0001, aSeed.w);
        float speed = 13.0 + 5.0 * aSeed.z;
        vec3 fall = vec3(0.9 + 1.5 * uWindK, -speed, 0.4 + 0.7 * uWindK);
        vec3 p0 = aSeed.xyz * box;
        vec3 wp = p0 + fall * uTime;
        // wrap round the camera
        vec2 wrapped = mod(wp.xz - cameraPosition.xz + box.xz * 0.5, box.xz) - box.xz * 0.5;
        float y = mod(wp.y, box.y);
        vec3 head = vec3(cameraPosition.x + wrapped.x, cameraPosition.y - box.y * 0.55 + y, cameraPosition.z + wrapped.y);
        head.y = max(head.y, uBaseY - 0.2);
        vec3 axis = normalize(fall);
        float len = 0.55 + 0.35 * aSeed.z;
        vec3 tail = head - axis * len;
        vec3 mid = (head + tail) * 0.5;
        vec3 toCam = normalize(cameraPosition - mid);
        vec3 side = normalize(cross(axis, toCam));
        float width = 0.012 + 0.008 * aSeed.x;
        vec3 pos = mid + axis * (position.y * len) + side * (position.x * width);
        vec4 mv = viewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float fade = (1.0 - smoothstep(12.0, 17.0, length(wrapped))) * smoothstep(0.5, 2.0, d);
        // streaks below the ground vanish
        float above = smoothstep(uBaseY - 0.3, uBaseY + 0.2, pos.y);
        vA = present * fade * above * (0.24 + 0.3 * aSeed.y);
        vUv = position.xy + 0.5;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 rainCol; uniform vec3 uSheen;
      varying float vA; varying vec2 vUv;
      void main() {
        if (vA < 0.01) discard;
        // a soft-edged streak, brighter toward the head
        float across = 1.0 - smoothstep(0.25, 0.5, abs(vUv.x - 0.5));
        float along = smoothstep(0.0, 0.25, vUv.y) * (0.45 + 0.55 * vUv.y);
        gl_FragColor = vec4(mix(rainCol, uSheen, 0.25), vA * across * along);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new InstancedMesh(geo, mat, count);
  const id = new Matrix4();
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, id);
  mesh.name = "rain";
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false; // shown only while it rains
  return mesh;
}
