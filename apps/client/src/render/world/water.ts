import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import { PALETTE, RIVER, riverCentre, riverHalfWidth, ruinPlan, smoothstep, type LandscapeTerrain } from "@cb/shared";
import { worldTime } from "./toon.ts";

/**
 * The stream and its pond as one toon-water mesh. The ribbon follows the shared centreline (`riverCentre`) at the shared channel level
 * (`LandscapeTerrain.channelLevel`), so the terrain's carved bed and the surface always agree and the shoreline is simply where the
 * bank rises through the water. Shading is banded like everything else: three depth tones, crisp ripple highlights that travel
 * downstream, stretched streaks, and a foam line hugging the banks. Palette-driven, unlit (tinted by the day's light), no textures.
 */

export interface WaterUniforms {
  uLight: { value: Color };
  uSun: { value: number };
  uSunDir: { value: Vector3 };
}

const STREAM_ROWS = 60;
const COLS = 5; // across the ribbon (-1, -0.5, 0, 0.5, 1)
const POND_RINGS = 6;
const POND_SPOKES = 28;
const OVERLAP = 4.5; // the ribbon stops this far short of the pond centre: it ends inside the pond disc

/** Ribbon + pond geometry: position, channel coordinate `aQ` (0 centre .. 1 edge) and downstream flow `aFlow`. */
export function buildWater(terrain: LandscapeTerrain): BufferGeometry {
  const pos: number[] = [];
  const q: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const c0 = { x: 0, z: 0 };
  const c1 = { x: 0, z: 0 };
  const level = (s: number): number => terrain.channelLevel(s) - RIVER.freeboard;
  const end = RIVER.length - OVERLAP;
  for (let i = 0; i <= STREAM_ROWS; i++) {
    const s = (i / STREAM_ROWS) * end;
    riverCentre(s, c0);
    riverCentre(s + 0.4, c1);
    let tx = c1.x - c0.x;
    let tz = c1.z - c0.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz;
    const nz = tx;
    const w = riverHalfWidth(s) * 1.02;
    const y = level(s);
    const speed = 0.55 + 0.4 * (1 - s / RIVER.length);
    for (let j = 0; j < COLS; j++) {
      const v = -1 + (2 * j) / (COLS - 1);
      pos.push(c0.x + nx * v * w, y, c0.z + nz * v * w);
      q.push(Math.abs(v) * 1.02);
      flow.push(tx * speed, tz * speed);
    }
    if (i > 0) {
      const a = (i - 1) * COLS;
      const b = i * COLS;
      for (let j = 0; j + 1 < COLS; j++) idx.push(a + j, b + j, b + j + 1, a + j, b + j + 1, a + j + 1);
    }
  }
  // Both faces point up (counter-clockwise seen from +y): the ribbon flows toward -x, so flip if needed below.
  const base = pos.length / 3;
  const py = level(RIVER.length) + 0.004;
  pos.push(RIVER.b.x, py, RIVER.b.z);
  q.push(0);
  flow.push(0.05, 0.02);
  for (let r = 1; r <= POND_RINGS; r++) {
    const rr = (r / POND_RINGS) * RIVER.pondRadius * 1.02;
    for (let k = 0; k < POND_SPOKES; k++) {
      const a = (k / POND_SPOKES) * Math.PI * 2;
      pos.push(RIVER.b.x + Math.cos(a) * rr, py, RIVER.b.z + Math.sin(a) * rr);
      q.push((r / POND_RINGS) * 1.02);
      // a slow swirl: the pond turns gently
      flow.push(-Math.sin(a) * 0.12, Math.cos(a) * 0.12);
    }
  }
  const ring = (r: number, k: number): number => base + 1 + (r - 1) * POND_SPOKES + (k % POND_SPOKES);
  for (let k = 0; k < POND_SPOKES; k++) idx.push(base, ring(1, k + 1), ring(1, k));
  for (let r = 1; r < POND_RINGS; r++) {
    for (let k = 0; k < POND_SPOKES; k++) idx.push(ring(r, k), ring(r, k + 1), ring(r + 1, k), ring(r, k + 1), ring(r + 1, k + 1), ring(r + 1, k));
  }
  // make every triangle face up
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!;
    const b = idx[t + 1]!;
    const c = idx[t + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!;
    const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!;
    const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    if (uz * vx - ux * vz < 0) {
      idx[t + 1] = c;
      idx[t + 2] = b;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aQ", new BufferAttribute(new Float32Array(q), 1));
  g.setAttribute("aFlow", new BufferAttribute(new Float32Array(flow), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function waterMaterial(animated: boolean): { material: ShaderMaterial; uniforms: WaterUniforms } {
  const W = PALETTE.world;
  const uniforms: WaterUniforms = { uLight: { value: new Color(1, 1, 1) }, uSun: { value: 1 }, uSunDir: { value: new Vector3(0, 1, 0) } };
  const material = new ShaderMaterial({
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uDeep: { value: new Color(W.waterDeep) },
        uShallow: { value: new Color(W.waterShallow) },
        uFoam: { value: new Color(W.waterFoam) },
        uGlint: { value: new Color(W.waterGlint) },
      },
    ]),
    defines: { ANIMATED: animated ? 1 : 0 },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute float aQ;
      attribute vec2 aFlow;
      varying float vQ;
      varying vec2 vFlow;
      varying vec3 vWorld;
      void main() {
        vQ = aQ;
        vFlow = aFlow;
        vWorld = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uGlint;
      uniform vec3 uLight; uniform float uSun; uniform vec3 uSunDir;
      varying float vQ; varying vec2 vFlow; varying vec3 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 p = vWorld.xz;
        float speed = length(vFlow) + 0.001;
        vec2 fdir = vFlow / speed;
        vec2 fperp = vec2(-fdir.y, fdir.x);
        // depth tone: deep in the middle of the channel, shallow toward the banks, three flat bands
        float depthK = 1.0 - smoothstep(0.05, 0.72, vQ);
        float bandK = floor(depthK * 3.0 + 0.5) / 3.0;
        vec3 col = mix(uShallow, uDeep, bandK);
        float foamLine = 0.0;
        #if ANIMATED
          vec2 fp = p - vFlow * uTime * 0.9;
          float n1 = vnoise(fp * 1.6);
          float n2 = vnoise(fp * 4.4 + vec2(n1 * 1.5, uTime * 0.12));
          float rip = n1 * 0.55 + n2 * 0.45;
          // crisp banded highlights on the ripples
          float hi = step(0.66, rip);
          col = mix(col, uGlint, hi * 0.42);
          // long thin streaks along the flow
          float st = vnoise(vec2(dot(p, fperp) * 2.6, dot(p, fdir) * 0.45 - uTime * speed * 1.4));
          col = mix(col, uGlint, step(0.83, st) * 0.5 * (1.0 - smoothstep(0.55, 0.7, vQ)));
          // sun glitter on the highest ripples
          float glitter = step(0.79, rip) * step(0.6, hash(floor(fp * 9.0) + floor(uTime * 3.0))) * uSun;
          col = mix(col, uFoam, glitter * 0.75);
          // foam hugs the banks, breaks up, and drifts
          float wob = (n1 - 0.5) * 0.12 + sin(dot(p, fdir) * 2.3 - uTime * speed * 2.0) * 0.012;
          float e = smoothstep(0.56, 0.66, vQ + wob);
          foamLine = e * step(0.42, n2 + e * 0.55);
        #else
          foamLine = smoothstep(0.62, 0.68, vQ);
        #endif
        col = mix(col, uFoam, foamLine);
        col *= uLight;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  // Shared by reference: UniformsUtils.merge clones values, which would freeze the clock and the day's light.
  Object.assign(material.uniforms, uniforms, { uTime: worldTime });
  return { material, uniforms };
}

export function buildWaterMesh(terrain: LandscapeTerrain, animated: boolean): { mesh: Mesh; uniforms: WaterUniforms } {
  const geo = buildWater(terrain);
  const { material, uniforms } = waterMaterial(animated);
  const mesh = new Mesh(geo, material);
  mesh.name = "water";
  mesh.frustumCulled = true;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}

// ---- the falls ---------------------------------------------------------------------------------------------------------------------

const FALLS_ROWS = 14;

/**
 * The stream's source: water pouring off the broken end of the aqueduct's channel into the first reach of the stream. A vertical
 * sheet that spills out from the lip and drops, from the last pier's deck stub (the same numbers `ruins.ts` builds it from) to the
 * ground, with banded streaks that run down it and a foam boil at the bottom. Returns undefined when there is no aqueduct.
 */
export function buildFalls(terrain: LandscapeTerrain): Mesh | undefined {
  const plan = ruinPlan(terrain);
  const last = plan.piers[plan.piers.length - 1];
  if (!last) return undefined;
  const lipX = last.x + plan.dir.x * 2.4;
  const lipZ = last.z + plan.dir.z * 2.4;
  const top = last.top + 1.08;
  const ground = terrain.height(lipX + plan.dir.x * 0.5, lipZ + plan.dir.z * 0.5);
  const bottom = ground + 0.02;
  const H = Math.max(1, top - bottom);
  const across = { x: -plan.dir.z, z: plan.dir.x };
  const half = 0.85;
  const pos: number[] = [];
  const hh: number[] = [];
  const xx: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= FALLS_ROWS; j++) {
    const t = j / FALLS_ROWS;
    const fwd = 0.6 * smoothstep(0, 0.22, t) + 0.15 * t; // leaves the lip, then drops
    for (const u of [-1, 0, 1]) {
      pos.push(lipX + plan.dir.x * fwd + across.x * u * half * (1 + 0.12 * t), top - t * H, lipZ + plan.dir.z * fwd + across.z * u * half * (1 + 0.12 * t));
      hh.push(t * H);
      xx.push(u);
    }
    if (j > 0) {
      const a = (j - 1) * 3;
      const b = j * 3;
      idx.push(a, b, b + 1, a, b + 1, a + 1, a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aH", new BufferAttribute(new Float32Array(hh), 1));
  g.setAttribute("aX", new BufferAttribute(new Float32Array(xx), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const W = PALETTE.world;
  const material = new ShaderMaterial({
    fog: true,
    side: DoubleSide,
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uDeep: { value: new Color(W.waterDeep) }, uShallow: { value: new Color(W.waterShallow) }, uFoam: { value: new Color(W.waterFoam) }, uGlint: { value: new Color(W.waterGlint) }, uHeight: { value: H }, uLight: { value: new Color(1, 1, 1) } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute float aH; attribute float aX;
      varying float vH; varying float vX; varying vec3 vWorld;
      void main() {
        vH = aH; vX = aX; vWorld = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uHeight;
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uGlint; uniform vec3 uLight;
      varying float vH; varying float vX; varying vec3 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float lateral = vWorld.x * 1.3 + vWorld.z * 1.7;
        float streak = vnoise(vec2(lateral * 5.0, vH * 0.55 - uTime * 3.6));
        float fine = vnoise(vec2(lateral * 13.0, vH * 1.3 - uTime * 6.0));
        vec3 col = mix(uShallow, uDeep, step(0.5, 0.5 + 0.5 * vX * vX) * 0.0 + step(0.55, streak) * 0.55);
        col = mix(col, uGlint, step(0.74, streak * 0.6 + fine * 0.5) * 0.7);
        // the lip is glassy, the foot is a boil of foam
        float lip = 1.0 - smoothstep(0.0, 0.35, vH);
        col = mix(col, uGlint, lip * 0.5);
        float foot = smoothstep(uHeight - 1.1, uHeight - 0.15, vH);
        float boil = step(0.42, vnoise(vec2(lateral * 4.0 + uTime * 0.8, vH * 3.0 - uTime * 2.0)) + foot * 0.55);
        col = mix(col, uFoam, foot * boil);
        float edge = smoothstep(0.78, 1.0, abs(vX) + (vnoise(vec2(vH * 2.0 - uTime, lateral)) - 0.5) * 0.3);
        col = mix(col, uFoam, edge * 0.7);
        col *= uLight;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(material.uniforms, { uTime: worldTime });
  const mesh = new Mesh(g, material);
  mesh.name = "falls";
  mesh.frustumCulled = true;
  mesh.renderOrder = 1;
  return mesh;
}
