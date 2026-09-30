import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { PALETTE, Rng } from "@cb/shared";
import { LANTERN_SWING } from "./camplife.ts";
import { atmoUniforms } from "./atmosphere.ts";
import { WIND_HEAD, worldTime } from "./toon.ts";

/**
 * Ambient life, all of it driven by the GPU from the clock: pollen drifting by day and fireflies blinking at dusk (one Points draw
 * wrapped round the camera), butterflies figure-eighting over the flower meadows, a few distant birds circling, smoke and steam
 * rising from the campfire and its pot, and the glow of the hanging lanterns. Each is ONE draw call; positions are functions of
 * time and a per-instance seed evaluated in the vertex shader, so the CPU writes only a handful of uniforms per frame and nothing
 * allocates. The presets scale the counts (low builds none of it except the lantern glow).
 */

export interface AmbientUniforms {
  /** 1 by day, 0 at night. */
  uDay: { value: number };
  /** 0..1: how firefly-ish the evening is. */
  uFly: { value: number };
  /** Ground level under the camera (feet), for the camera-relative motes. */
  uBaseY: { value: number };
  /** Lantern/fire intensity 0..1. */
  uLamp: { value: number };
  /** Light tint for unlit ambient things (butterflies, birds, smoke). */
  uLight: { value: Color };
  /** Motion preference 0..1: scales flaps, orbits and drift (prefers-reduced-motion, `?motion=`). */
  uMotion: { value: number };
}

export function createAmbientUniforms(): AmbientUniforms {
  return { uDay: { value: 1 }, uFly: { value: 0 }, uBaseY: { value: 0 }, uLamp: { value: 0 }, uLight: { value: new Color(1, 1, 1) }, uMotion: { value: 1 } };
}

const shared = (u: AmbientUniforms): Record<string, { value: unknown }> => ({ ...u, uTime: worldTime, uWindK: atmoUniforms.uWindK }) as unknown as Record<string, { value: unknown }>;

// ---- pollen and fireflies -------------------------------------------------------------------------------------------------------

/** Motes wrapped round the camera in a box: pollen by day, blinking fireflies as the evening comes on. */
export function buildMotes(count: number, u: AmbientUniforms): Points | undefined {
  if (count <= 0) return undefined;
  const rng = new Rng(0x40e5);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = rng.next();
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aSeed", new BufferAttribute(seed, 4));
  geo.boundingSphere = null;
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...shared(u), pollen: { value: new Color(PALETTE.world.pollen) }, fly: { value: new Color(PALETTE.world.firefly) } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime; uniform float uDay; uniform float uFly; uniform float uBaseY; uniform float uMotion;
      varying vec3 vCol; varying float vAlpha;
      uniform vec3 pollen; uniform vec3 fly;
      void main() {
        vec3 box = vec3(46.0, 5.0, 46.0);
        float isFly = step(0.62, aSeed.w);
        vec3 p0 = aSeed.xyz * box;
        float t = uTime * (0.25 + 0.75 * uMotion);
        vec3 drift = vec3(t * 0.35 + sin(t * 0.21 + aSeed.x * 40.0) * 2.0, sin(t * (0.5 + aSeed.y) + aSeed.z * 30.0) * 0.5, t * 0.12 + cos(t * 0.17 + aSeed.z * 40.0) * 2.0);
        // fireflies wander in slow loops instead of streaming with the wind
        vec3 loop = vec3(cos(t * (0.3 + aSeed.x * 0.4) + aSeed.z * 20.0), sin(t * (0.5 + aSeed.y * 0.4) + aSeed.x * 20.0) * 0.5, sin(t * (0.3 + aSeed.z * 0.4) + aSeed.y * 20.0)) * 1.4;
        vec3 wp = p0 + mix(drift, loop, isFly);
        vec2 wrapped = mod(wp.xz - cameraPosition.xz + box.xz * 0.5, box.xz) - box.xz * 0.5;
        float h = mod(wp.y, box.y);
        vec3 pos = vec3(cameraPosition.x + wrapped.x, uBaseY + 0.3 + h * 0.75 + mix(0.0, 0.4, isFly), cameraPosition.z + wrapped.y);
        vec4 mv = viewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float blink = smoothstep(0.35, 0.9, sin(t * (0.7 + aSeed.x * 1.6) + aSeed.y * 40.0) * 0.5 + 0.5);
        float size = mix(2.4, 5.2, isFly);
        gl_PointSize = clamp(size * 34.0 / max(dist, 1.0), 1.0, 12.0);
        float fade = 1.0 - smoothstep(16.0, 24.0, length(wrapped));
        vAlpha = mix(0.34 * uDay * (0.5 + 0.5 * sin(t * 1.3 + aSeed.z * 30.0)), blink * uFly, isFly) * fade;
        vCol = mix(pollen, fly, isFly);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha;
        gl_FragColor = vec4(vCol, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new Points(geo, mat);
  pts.name = "motes";
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return pts;
}

// ---- butterflies ----------------------------------------------------------------------------------------------------------------

/** Four triangles: two wings meeting at a body line along +z; the vertex shader flaps them. */
function butterflyGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  // per wing: two triangles (upper and lower wing), x lateral, z forward
  const p = [
    0, 0, 0.1, 0.22, 0, 0.16, 0.16, 0, -0.06,
    0, 0, -0.02, 0.16, 0, -0.06, 0.1, 0, -0.16,
    0, 0, 0.1, -0.16, 0, -0.06, -0.22, 0, 0.16,
    0, 0, -0.02, -0.1, 0, -0.16, -0.16, 0, -0.06,
  ];
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  const shade = new Float32Array([1, 0.9, 0.7, 0.6, 0.55, 0.5, 1, 0.7, 0.9, 0.6, 0.5, 0.55]);
  g.setAttribute("aShade", new BufferAttribute(shade, 1));
  return g;
}

/**
 * Butterflies over flower clusters: each orbits a centre (a flower's position) in a figure-eight, its wings flapping fast. `centres`
 * are world positions; up to `count` are used.
 */
export function buildButterflies(centres: readonly Vector3[], count: number, u: AmbientUniforms): InstancedMesh | undefined {
  const n = Math.min(count, centres.length);
  if (n <= 0) return undefined;
  const geo = butterflyGeometry();
  const c = new Float32Array(n * 4);
  const rng = new Rng(0xb077);
  for (let i = 0; i < n; i++) {
    const p = centres[i]!;
    c[i * 4] = p.x;
    c[i * 4 + 1] = p.y;
    c[i * 4 + 2] = p.z;
    c[i * 4 + 3] = rng.next() * 100;
  }
  geo.setAttribute("aCentre", new InstancedBufferAttribute(c, 4));
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: shared(u),
    vertexShader: /* glsl */ `
      attribute vec4 aCentre;
      attribute float aShade;
      uniform float uTime; uniform float uDay; uniform vec3 uLight; uniform float uMotion;
      varying vec3 vCol;
      vec3 orbit(float a, float ph) {
        float r = 1.6 + 0.8 * sin(ph * 3.0);
        return vec3(cos(a) * r, 0.75 + 0.35 * sin(a * 2.0 + ph) + 0.15 * sin(a * 5.0), sin(a * 2.0) * r * 0.55);
      }
      void main() {
        float ph = aCentre.w;
        float sp = 0.42 + 0.12 * fract(ph);
        float a = uTime * sp * (0.3 + 0.7 * uMotion) + ph;
        vec3 p1 = orbit(a, ph);
        vec3 p2 = orbit(a + 0.05, ph);
        vec3 f = normalize(vec3(p2.x - p1.x, 0.0, p2.z - p1.z) + vec3(1e-4));
        vec3 r = vec3(f.z, 0.0, -f.x);
        float flap = sin(uTime * (17.0 + 5.0 * fract(ph * 1.7)) + ph) * (0.3 + 0.65 * uMotion);
        float lift = abs(position.x) * sin(flap);
        vec3 lp = r * position.x * cos(flap) + f * position.z + vec3(0.0, lift, 0.0);
        vec3 world = aCentre.xyz + p1 + lp;
        float show = step(0.05, uDay);
        vec4 mv = viewMatrix * vec4(mix(vec3(0.0, -1000.0, 0.0), world, show), 1.0);
        gl_Position = projectionMatrix * mv;
        vCol = instanceColor * (0.7 + 0.3 * aShade) * uLight;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        gl_FragColor = vec4(vCol, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new InstancedMesh(geo, mat, n);
  const palette = [PALETTE.world.bloomYellow, PALETTE.world.bloomWhite, PALETTE.world.bloomBlue, PALETTE.world.bloomRed, PALETTE.world.bloomPink];
  const col = new Color();
  for (let i = 0; i < n; i++) {
    mesh.setColorAt(i, col.set(palette[i % palette.length]!).multiplyScalar(1.1));
    mesh.setMatrixAt(i, new Matrix4());
  }
  mesh.name = "butterflies";
  mesh.frustumCulled = false;
  return mesh;
}

// ---- birds ------------------------------------------------------------------------------------------------------------------------

function birdGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  // a V: body point, two wings each a triangle swept back; x lateral, z forward
  const p = [0, 0, 0.5, 1.0, 0, -0.1, 0.3, 0, -0.15, 0, 0, 0.5, -0.3, 0, -0.15, -1.0, 0, -0.1];
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  return g;
}

/** A few distant birds circling high over the country: V shapes with slow flaps, faded by fog with distance. */
export function buildBirds(count: number, u: AmbientUniforms): InstancedMesh | undefined {
  if (count <= 0) return undefined;
  const geo = birdGeometry();
  const rng = new Rng(0xb1d5);
  const a = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const flockAngle = (i % 2) * 2.4 + 0.6;
    a[i * 4] = Math.cos(flockAngle) * rng.range(55, 105) + rng.range(-8, 8); // circle centre x
    a[i * 4 + 1] = 38 + rng.range(0, 24); // altitude
    a[i * 4 + 2] = Math.sin(flockAngle) * rng.range(55, 105) + rng.range(-8, 8); // centre z
    a[i * 4 + 3] = rng.next() * 100;
  }
  geo.setAttribute("aCircle", new InstancedBufferAttribute(a, 4));
  const mat = new ShaderMaterial({
    side: DoubleSide,
    fog: true,
    uniforms: UniformsUtils.merge([UniformsLib.fog, { birdCol: { value: new Color(PALETTE.world.bird) } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec4 aCircle;
      uniform float uTime; uniform float uDay; uniform float uMotion;
      void main() {
        float ph = aCircle.w;
        float R = 22.0 + 10.0 * fract(ph * 3.1);
        float w = 0.11 + 0.03 * fract(ph * 1.3);
        float ang = uTime * w + ph;
        vec3 c = vec3(cos(ang) * R, sin(uTime * 0.2 + ph) * 3.0, sin(ang) * R);
        vec3 f = normalize(vec3(-sin(ang), 0.0, cos(ang)));
        vec3 r = vec3(f.z, 0.0, -f.x);
        float flap = sin(uTime * 3.4 + ph * 7.0) * 0.55 * (0.3 + 0.7 * uMotion) * step(0.0, sin(uTime * 0.4 + ph));
        float s = 1.25;
        vec3 lp = r * position.x * cos(flap) * s + f * position.z * s + vec3(0.0, abs(position.x) * sin(flap) * s, 0.0);
        vec3 world = aCircle.xyz + c + lp;
        float show = step(0.15, uDay);
        vec4 mvPosition = viewMatrix * vec4(mix(vec3(0.0, -1000.0, 0.0), world, show), 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 birdCol;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(birdCol, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, shared(u)); // by reference: UniformsUtils.merge would clone the clock and the day
  const mesh = new InstancedMesh(geo, mat, count);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, new Matrix4());
  mesh.name = "birds";
  mesh.frustumCulled = false;
  return mesh;
}

// ---- smoke and steam --------------------------------------------------------------------------------------------------------------

export interface SmokeSource {
  /** World position of the source. */
  at: Vector3;
  /** 0 = campfire smoke (grey, slow, tall); 1 = pot steam (pale, quick, short). */
  kind: 0 | 1;
  puffs: number;
}

/** Pooled soft puffs: each has an age cycling 0..1, rises, widens and fades; banded into a lit core and a shaded rim. */
export function buildSmoke(sources: readonly SmokeSource[], u: AmbientUniforms): InstancedMesh | undefined {
  const total = sources.reduce((n, s) => n + s.puffs, 0);
  if (total <= 0) return undefined;
  const geo = new PlaneGeometry(1, 1);
  const src = new Float32Array(total * 4);
  const kind = new Float32Array(total);
  let k = 0;
  const rng = new Rng(0x5a0c);
  for (const s of sources) {
    for (let i = 0; i < s.puffs; i++, k++) {
      src[k * 4] = s.at.x;
      src[k * 4 + 1] = s.at.y;
      src[k * 4 + 2] = s.at.z;
      src[k * 4 + 3] = (i + rng.range(-0.15, 0.15)) / s.puffs; // phase, evenly spread so the plume is continuous
      kind[k] = s.kind;
    }
  }
  geo.setAttribute("aSrc", new InstancedBufferAttribute(src, 4));
  geo.setAttribute("aKind", new InstancedBufferAttribute(kind, 1));
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { ...shared(u), smoke: { value: new Color(PALETTE.world.smoke) }, shade: { value: new Color(PALETTE.world.smokeShade) } },
    vertexShader: /* glsl */ `
      attribute vec4 aSrc;
      attribute float aKind;
      uniform float uTime;
      varying vec2 vUv; varying float vLife; varying float vKind;
      void main() {
        float speed = mix(0.16, 0.42, aKind);
        float age = fract(uTime * speed + aSrc.w);
        float seed = floor(uTime * speed + aSrc.w) * 7.13 + aSrc.w * 31.0;
        float rise = mix(5.2, 1.1, aKind);
        vec3 wind = vec3(0.9, 0.0, 0.35) * age * age * mix(3.2, 0.6, aKind);
        vec3 wob = vec3(sin(seed + age * 5.0), 0.0, cos(seed * 1.3 + age * 4.0)) * (0.12 + age * 0.35) * mix(1.0, 0.3, aKind);
        vec3 centre = aSrc.xyz + vec3(0.0, age * rise, 0.0) + wind + wob;
        float size = mix(0.3, 1.5, age) * mix(1.0, 0.45, aKind);
        vec4 mv = viewMatrix * vec4(centre, 1.0);
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
        vUv = position.xy * 2.0;
        vLife = age;
        vKind = aKind;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 smoke; uniform vec3 shade; uniform float uDay; uniform vec3 uLight;
      varying vec2 vUv; varying float vLife; varying float vKind;
      void main() {
        float ang = atan(vUv.y, vUv.x);
        float rad = 1.0 + 0.16 * sin(ang * 5.0 + vLife * 6.0) + 0.1 * sin(ang * 9.0 - vLife * 4.0);
        float r = length(vUv) / rad;
        if (r > 1.0) discard;
        vec3 col = mix(smoke, shade, step(0.62, r));
        col = mix(col, vec3(1.0), vKind * 0.35) * uLight;
        float a = smoothstep(0.0, 0.12, vLife) * pow(1.0 - vLife, 1.3) * mix(0.62, 0.42, vKind);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new InstancedMesh(geo, mat, total);
  for (let i = 0; i < total; i++) mesh.setMatrixAt(i, new Matrix4());
  mesh.name = "smoke";
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

// ---- lantern glow -------------------------------------------------------------------------------------------------------------------

/** Soft additive glows at the lanterns' positions; they brighten with `uLamp` (a candle by day, a lamp at dusk). */
export function buildLanternGlow(positions: readonly Vector3[], u: AmbientUniforms, lit: readonly number[] = []): Points | undefined {
  if (positions.length === 0) return undefined;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(positions.flatMap((p) => [p.x, p.y, p.z])), 3));
  // `lit[i]` is a lantern's floor level (0..1): a lamp in a dark room burns bright even at noon
  geo.setAttribute("aBase", new BufferAttribute(new Float32Array(positions.map((_, i) => lit[i] ?? 0)), 1));
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...shared(u), glow: { value: new Color(PALETTE.camp.glowLantern) } },
    vertexShader: /* glsl */ `
      ${WIND_HEAD}
      attribute float aBase;
      uniform float uLamp;
      varying float vA;
      void main() {
        vec4 mv = viewMatrix * vec4(position + windCloth(position, ${LANTERN_SWING.toFixed(2)}), 1.0);
        gl_Position = projectionMatrix * mv;
        float flick = 0.94 + 0.06 * sin(uTime * 7.0 + position.x * 3.0 + position.z * 5.0);
        vA = max(aBase, 0.14 + 0.86 * uLamp) * flick;
        gl_PointSize = clamp((0.9 + 2.6 * max(uLamp, aBase * 0.7)) * 190.0 / max(-mv.z, 1.0), 4.0, 90.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 glow; varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.0, 0.18, r);
        float halo = (1.0 - smoothstep(0.1, 1.0, r)) * 0.5;
        float a = (core + halo) * vA;
        gl_FragColor = vec4(glow, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new Points(geo, mat);
  pts.name = "lantern-glow";
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return pts;
}
