import { AdditiveBlending, Color, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { PALETTE } from "@cb/shared";
import { worldTime } from "./toon.ts";

/**
 * Cheap canopy sun shafts: a few dozen tall, soft-edged, additive strips that stand in gaps in the woods and lean toward the sun, dappled by a
 * drifting noise. One instanced draw. Each strip starts on the ground and runs toward the sun for as long as the canopy is tall (longer when the sun is
 * low), turning to face the camera about its own axis so it always reads as a beam. Intensity follows the day (`uShaft`): none at night or under cloud, best
 * when the sun is low and the air is misty.
 */

export interface ShaftSpot {
  x: number;
  y: number;
  z: number;
  /** Height of the canopy hole above the ground (the beam's vertical extent), metres. */
  height: number;
  width: number;
  /** 0..1 variety. */
  v: number;
}

export interface ShaftUniforms {
  uShaft: { value: number };
  uSunDirS: { value: Vector3 };
  uShaftCol: { value: Color };
}

export function createShaftUniforms(): ShaftUniforms {
  return { uShaft: { value: 0 }, uSunDirS: { value: new Vector3(0, 1, 0) }, uShaftCol: { value: new Color(PALETTE.world.pollen) } };
}

export function buildShafts(spots: readonly ShaftSpot[], u: ShaftUniforms): InstancedMesh | undefined {
  if (spots.length === 0) return undefined;
  const geo = new PlaneGeometry(1, 1, 1, 1);
  const info = new Float32Array(spots.length * 4);
  spots.forEach((s, i) => {
    info[i * 4] = s.height;
    info[i * 4 + 1] = s.width;
    info[i * 4 + 2] = s.v;
    info[i * 4 + 3] = 0;
  });
  geo.setAttribute("aShaft", new InstancedBufferAttribute(info, 4));
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: 2,
    uniforms: { uTime: worldTime, uShaft: u.uShaft, uSunDirS: u.uSunDirS, uShaftCol: u.uShaftCol },
    vertexShader: /* glsl */ `
      attribute vec4 aShaft;
      uniform vec3 uSunDirS;
      varying vec2 vUv; varying float vV; varying float vDist;
      void main() {
        vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 axis = normalize(uSunDirS);
        float len = aShaft.x / max(axis.y, 0.28);
        vec3 toCam = normalize(cameraPosition - base);
        vec3 right = normalize(cross(axis, toCam) + vec3(1e-4));
        float y = position.y + 0.5;
        vec3 wp = base + axis * (y * len) + right * (position.x * aShaft.y * (0.7 + 0.5 * y));
        vUv = vec2(position.x + 0.5, y);
        vV = aShaft.z;
        vDist = length(wp - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uShaft; uniform vec3 uShaftCol;
      varying vec2 vUv; varying float vV; varying float vDist;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float across = 1.0 - pow(abs(vUv.x * 2.0 - 1.0), 2.0);
        float along = smoothstep(0.0, 0.14, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y));
        float dapple = 0.55 + 0.45 * vnoise(vec2(vUv.y * 5.0 - uTime * 0.25, vV * 40.0 + vUv.x * 3.0 + uTime * 0.05));
        float near = smoothstep(1.0, 4.0, vDist) * (1.0 - smoothstep(38.0, 80.0, vDist));
        float a = across * along * dapple * near * uShaft * (0.5 + 0.5 * vV) * 0.34;
        gl_FragColor = vec4(uShaftCol, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new InstancedMesh(geo, mat, spots.length);
  mesh.name = "shafts";
  const m = new Matrix4();
  spots.forEach((s, i) => mesh.setMatrixAt(i, m.makeTranslation(s.x, s.y, s.z)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
