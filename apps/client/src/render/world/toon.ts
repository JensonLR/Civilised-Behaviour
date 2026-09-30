import {
  Color,
  DoubleSide,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshToonMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { PALETTE } from "@cb/shared";
import { WORLD_INK, instancedWorldOutline, outlineSettings, sharedToonRamp, worldOutlineMaterial, type OutlineDisplace, type WorldInkClass } from "@cb/procedural/three";
import { atmoUniforms } from "./atmosphere.ts";

/** Time in seconds, shared by every wind-animated material. One object, updated once per frame (no allocation). */
export const worldTime = { value: 0 };

/** Up to four things that walk through the grass: (x, z, radius, strength). Written by `WorldView.setPushers`; read by every blade shader. */
export const MAX_PUSHERS = 4;
export const pushers = { value: Array.from({ length: MAX_PUSHERS }, () => new Vector4(0, 0, 1, 0)) };

/** The campfire as a light for the toon materials: position, strength (0 by day, ~1 at night) and colour. A cheap banded warm term, not a real light. */
export const fireLight = { uFirePos: { value: new Vector3(0, -100, 0) }, uFireI: { value: 0 }, uFireCol: { value: new Color(PALETTE.camp.glow) } };

// ---- wind ------------------------------------------------------------------------------------------------------------------------

/** `cloth` is for non-instanced geometry with an `aSway` attribute (0..1: how loose each vertex hangs): washing, the hammock, hanging lanterns. */
export type WindKind = "none" | "tree" | "grass" | "flora" | "reed" | "cloth" | "village";

/** Shared GLSL: a gust field, tree sway (crowns move, trunks are stiff) and blade sway that also bends away from up to four pushers. */
export const WIND_HEAD = /* glsl */ `
  uniform float uTime;
  uniform float uWindK;
  uniform vec4 uPush[${MAX_PUSHERS}];
  float windGust(vec2 p) {
    return (0.8 + 0.2 * sin(dot(p, vec2(0.037, 0.021)) - uTime * 0.5) + 0.12 * sin(dot(p, vec2(-0.013, 0.046)) * 1.7 - uTime * 0.33)) * uWindK;
  }
  // loose cloth and hanging things: pushed downwind with a flutter riding on it; w is how loose the vertex hangs (0 fixed .. 1 free)
  vec3 windCloth(vec3 p, float w) {
    float g = windGust(p.xz);
    float ph = p.x * 0.9 + p.z * 0.7;
    vec3 d = vec3(0.0);
    d.x = (0.55 + 0.45 * sin(uTime * 1.5 + ph)) * 0.075 * g;
    d.z = (0.35 + 0.65 * sin(uTime * 2.1 + ph * 1.3)) * 0.05 * g;
    d.y = sin(uTime * 3.3 + p.x * 4.1 + p.z * 3.3) * 0.016 * g;
    d.x += sin(uTime * 5.3 + p.y * 6.0 + ph) * 0.012 * g;
    return d * w;
  }
  vec3 windTree(vec3 lp, vec3 base, float sy, float flutter) {
    float ph = base.x * 0.37 + base.z * 0.53;
    float g = windGust(base.xz);
    float hw = smoothstep(2.6, 7.2, lp.y);
    hw *= hw;
    vec3 d = vec3(0.0);
    d.x = (sin(uTime * 1.05 + ph) + 0.4 * sin(uTime * 2.3 + ph * 1.7)) * 0.12;
    d.z = (cos(uTime * 0.9 + ph * 0.8) + 0.3 * sin(uTime * 2.9 + ph)) * 0.085;
    d *= hw * g * sy;
    float fl = hw * 0.05 * sy * flutter * uWindK;
    d.x += sin(uTime * 3.7 + lp.x * 4.1 + lp.y * 2.3 + ph) * fl;
    d.y += sin(uTime * 3.1 + lp.z * 3.7 + lp.y * 1.9) * fl * 0.5;
    d.z += cos(uTime * 3.3 + lp.z * 4.3 + lp.x * 2.1) * fl;
    return d;
  }
  vec3 windBlade(vec3 lp, vec3 base, float k, float pushK) {
    float ph = base.x * 0.33 + base.z * 0.21;
    float g = windGust(base.xz);
    float tip = lp.y * k;
    vec3 d = vec3(0.0);
    d.x = (sin(uTime * 1.7 + ph) + 0.45 * sin(uTime * 3.1 + base.z * 0.9)) * tip * g;
    d.z = cos(uTime * 1.3 + base.x * 0.19 - base.z * 0.29) * tip * 0.6 * g;
    for (int i = 0; i < ${MAX_PUSHERS}; i++) {
      vec4 p = uPush[i];
      vec2 away = base.xz - p.xy;
      float dist = length(away);
      float f = (1.0 - smoothstep(0.15, p.z, dist)) * p.w;
      vec2 dir = away / max(dist, 0.05);
      float h = clamp(lp.y * 2.2, 0.0, 1.0);
      d.xz += dir * f * h * pushK * 0.95;
      d.y -= lp.y * f * pushK * 0.85;
    }
    return d;
  }
`;

/**
 * The village's one moving-parts mesh. `aSway` doubles as a kind: 0..1 is cloth as everywhere (awnings, washing, lamps), 2 is the mill wheel (turns about
 * its axle), 3 the moored punt (bobs and rolls on the water), 4/5 the gate clock's hour and minute hands on the +x face, 6/7 on the -x face.
 * Everything is a displacement of the world-space position (the village sits at the origin), so the ink hull and the shadow pass use the same function.
 */
export const villageUniforms = {
  /** Axle centre (xyz) and turn rate (radians a second). */
  uWheel: { value: new Vector4(0, -100, 0, 0.8) },
  uAxle: { value: new Vector3(1, 0, 0) },
  /** The punt: x, z, yaw of its long axis, and the y its bob rests on. */
  uPunt: { value: new Vector4(0, 0, 0, 0) },
  /** The gate clock's face centre (xyz) and the outward axis of its +x face. */
  uClock: { value: new Vector4(0, -100, 0, 0) },
  uClockAxis: { value: new Vector3(1, 0, 0) },
};
export const VILLAGE_HEAD = /* glsl */ `
  uniform vec4 uWheel; uniform vec3 uAxle; uniform vec4 uPunt; uniform vec4 uClock; uniform vec3 uClockAxis; uniform float uHour;
  vec3 rotA(vec3 v, vec3 a, float ang) { float c = cos(ang); float s = sin(ang); return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c); }
  vec3 villageKin(vec3 p, float w) {
    if (w < 1.5) return windCloth(p, w);
    if (w < 2.5) { vec3 q = p - uWheel.xyz; return rotA(q, uAxle, uTime * uWheel.w) - q; }
    if (w < 3.5) {
      vec2 r = p.xz - uPunt.xy;
      float along = r.x * cos(uPunt.z) + r.y * sin(uPunt.z);
      float across = -r.x * sin(uPunt.z) + r.y * cos(uPunt.z);
      float bob = sin(uTime * 1.25) * 0.035 + sin(uTime * 2.3 + 1.7) * 0.012;
      return vec3(sin(uTime * 0.7) * 0.03, bob + along * sin(uTime * 0.9 + 1.0) * 0.03 + across * sin(uTime * 1.1) * 0.04, cos(uTime * 0.6) * 0.02);
    }
    float face = w < 5.5 ? 1.0 : -1.0;
    float minute = (w < 4.5 || (w > 5.5 && w < 6.5)) ? 0.0 : 1.0;
    float turns = minute > 0.5 ? uHour : uHour / 12.0;
    vec3 ax = uClockAxis * face;
    vec3 q = p - uClock.xyz;
    return rotA(q, ax, -6.2831853 * turns) - q;
  }
  vec3 villageNormal(vec3 n, float w) {
    if (w > 1.5 && w < 2.5) return rotA(n, uAxle, uTime * uWheel.w);
    return n;
  }
`;

const windApply = (kind: WindKind, fluttering: boolean): string => {
  switch (kind) {
    case "tree":
      return `#ifdef USE_INSTANCING\n mvPosition.xyz += windTree(transformed, instanceMatrix[3].xyz, length(instanceMatrix[1].xyz), ${fluttering ? "1.0" : "0.0"});\n#endif`;
    case "grass":
      return `#ifdef USE_INSTANCING\n mvPosition.xyz += windBlade(transformed, instanceMatrix[3].xyz, 0.26, 1.0);\n#endif`;
    case "flora":
      return `#ifdef USE_INSTANCING\n mvPosition.xyz += windBlade(transformed, instanceMatrix[3].xyz, 0.2, 0.9);\n#endif`;
    case "reed":
      return `#ifdef USE_INSTANCING\n mvPosition.xyz += windBlade(transformed, instanceMatrix[3].xyz, 0.13, 0.5);\n#endif`;
    case "cloth":
      return "mvPosition.xyz += windCloth(mvPosition.xyz, aSway);";
    case "village":
      return "mvPosition.xyz += villageKin(mvPosition.xyz, aSway);";
    default:
      return "";
  }
};

/** The scenery outline follows the same tree sway (without the leaf flutter) so the ink stays glued to the crowns. */
export function outlineDisplace(kind: WindKind): OutlineDisplace | undefined {
  if (kind === "village") return { key: "village", uniforms: { uTime: worldTime, uPush: pushers, uWindK: atmoUniforms.uWindK, uHour: atmoUniforms.uHour, ...villageUniforms }, header: `${WIND_HEAD}\n${VILLAGE_HEAD}\nattribute float aSway;`, apply: "local.xyz += villageKin(local.xyz, aSway); on = villageNormal(on, aSway);" };
  if (kind === "cloth") return { key: "cloth", uniforms: { uTime: worldTime, uPush: pushers, uWindK: atmoUniforms.uWindK }, header: `${WIND_HEAD}\nattribute float aSway;`, apply: "local.xyz += windCloth(local.xyz, aSway);" };
  if (kind !== "tree") return undefined;
  return {
    key: "tree",
    uniforms: { uTime: worldTime, uPush: pushers, uWindK: atmoUniforms.uWindK },
    header: WIND_HEAD,
    apply: "#ifdef USE_INSTANCING\n local.xyz += windTree(position, instanceMatrix[3].xyz, length(instanceMatrix[1].xyz), 0.0);\n#endif",
  };
}

/**
 * Puddles, in the toon language: a hashed-noise mask of pools on level ground that grows with `uWet` (crisp edges, no gradient), painted
 * a dark sky-blue; after lighting, pools take a stepped sheen of the sky at grazing angles and a hard glint of the sun (or moon).
 */
const PUDDLE_HEAD = /* glsl */ `
  float pHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float pNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float puddleMask = 0.0;
`;
const PUDDLE_BODY = /* glsl */ `
  {
    vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
    float flatK = smoothstep(0.965, 0.99, abs(wn.y));
    float pn = pNoise(vWPos.xz * 0.23) * 0.65 + pNoise(vWPos.xz * 0.61 + 7.0) * 0.35;
    float thr = 1.0 - smoothstep(0.35, 1.0, uWet) * 0.3;
    puddleMask = smoothstep(thr, thr + 0.018, pn) * flatK * step(0.02, uWet);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.62, 0.72), puddleMask * 0.9);
  }
`;
const PUDDLE_SHEEN = /* glsl */ `
  if (puddleMask > 0.0) {
    vec3 V = normalize(cameraPosition - vWPos);
    float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.2);
    float band = floor(clamp(0.28 + fres * 0.85, 0.0, 1.0) * 3.0 + 0.5) / 3.0;
    vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
    float glint = step(0.965, dot(R, normalize(uSunDirW)));
    // rain rings: a ripple grid that pulses while it falls
    vec2 rc = floor(vWPos.xz * 3.1);
    vec2 rf = fract(vWPos.xz * 3.1) - 0.5;
    float rh = pHash(rc);
    float ph = fract(uTime * (0.7 + rh * 0.5) + rh * 9.0);
    float ring = smoothstep(0.045, 0.0, abs(length(rf - (vec2(pHash(rc + 3.1), pHash(rc + 8.7)) - 0.5) * 0.4) - ph * 0.45)) * (1.0 - ph) * step(0.55, rh) * step(0.15, uRain);
    outgoingLight = mix(outgoingLight, uSheen, puddleMask * band * 0.75);
    outgoingLight += (uSunColW * glint * 0.9 + uSheen * ring * 0.7) * puddleMask;
  }
`;

/**
 * Valley mist: `uMist` (0 at midday, ~1 at dawn) adds a height-falling, noise-patched fog to every toon surface: thick in the hollows by the water, thin
 * on the rises, growing with distance. It uses the world position the materials already export (`vWPos`) and the scene's fog colour, so it takes
 * the colour of the hour and needs no extra geometry.
 */
const MIST_HEAD = /* glsl */ `
  float mHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float mNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mHash(i), mHash(i + vec2(1.0, 0.0)), f.x), mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
const MIST_FOG = /* glsl */ `
  #ifdef USE_FOG
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    if (uMist > 0.005) {
      float lowK = exp(-max(vWPos.y + 2.6, 0.0) * 0.36);
      float mn = mNoise(vWPos.xz * 0.032 + vec2(uTime * 0.011, uTime * 0.004)) * 0.65 + mNoise(vWPos.xz * 0.09 - vec2(uTime * 0.006, 0.0)) * 0.35;
      float mist = uMist * lowK * (0.2 + 1.5 * mn) * (1.0 - exp(-vFogDepth * 0.045));
      fogFactor = max(fogFactor, clamp(mist, 0.0, 0.82));
    }
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
`;

/** Autumn's three shades (palette), shared by every seasonal material. */
export const autumnUniforms = {
  uAutumn0: { value: new Color(PALETTE.world.autumnRed) },
  uAutumn1: { value: new Color(PALETTE.world.autumnOrange) },
  uAutumn2: { value: new Color(PALETTE.world.autumnGold) },
};
/** Green foliage (a vertex colour where green beats red) turns to the patch's autumn shade, keeping its light and shade. */
const SEASON_BODY = /* glsl */ `
  {
    float leaf = smoothstep(0.012, 0.075, diffuseColor.g - diffuseColor.r * 0.9);
    vec3 turn = vSeason.y < 0.4 ? uAutumn0 : (vSeason.y < 0.7 ? uAutumn1 : uAutumn2);
    float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
    diffuseColor.rgb = mix(diffuseColor.rgb, turn * (0.85 + lum * 1.5), leaf * vSeason.x);
  }
`;

/**
 * Lite shading (the test preset, for software rasterisers): scenery materials drop the valley mist (two noise lookups per fragment) and the
 * campfire's warm term. Set by `WorldView` before it builds any material; part of the program cache key.
 */
let toonLite = false;
export const setToonLite = (on: boolean): void => void (toonLite = on);

export interface ToonOptions {
  doubleSided?: boolean;
  wind?: WindKind;
  /** Lit by the campfire's warm term (default true). */
  fire?: boolean;
  /** The geometry carries `aTint` (0..1): only that fraction of the per-instance colour is applied (blooms tint petals, not stems). */
  tinted?: boolean;
  /** Rain puddles: flat ground turns to glossy sky-mirroring pools as `uWet` rises (the terrain only; costs a few ALU per fragment). */
  puddles?: boolean;
  /** Leaves follow the season by region: the geometry's instances carry `aSeason` (amount, hue) and green foliage turns red, orange or gold. */
  season?: boolean;
  /** Extra vertex work on `transformed` (before instancing): per-instance animation of animals. `head` declares attributes/uniforms, `body` runs. */
  vertexPatch?: { key: string; head: string; body: string };
  /** How much of the ground wetness darkens this material (0 = none; foliage 0.35, ground and stone 1). Default 0.6. */
  wetDark?: number;
  /** Extra fragment work on the diffuse colour, run after vertex colours are applied (terrain trail overlay). */
  colourPatch?: { key: string; uniforms: Record<string, { value: unknown }>; head: string; body: string };
}

/**
 * The scenery material: the characters' toon ramp, vertex colours (and per-instance colour when the mesh has it), optional wind with
 * pusher bend, and the campfire's warm banded light. World-space position is exported as `vWPos` (world meshes sit at the origin).
 */
export function toonMaterial(opts: ToonOptions = {}): MeshToonMaterial {
  const m = new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() });
  if (opts.doubleSided) m.side = DoubleSide; // never pass `side: undefined`: three warns about it
  const wind = opts.wind ?? "none";
  const lite = toonLite;
  const fire = (opts.fire ?? true) && !lite;
  const patch = opts.colourPatch;
  const puddles = opts.puddles ?? false;
  const vpatch = opts.vertexPatch;
  const season = opts.season ?? false;
  const wetDark = (opts.wetDark ?? 0.6).toFixed(2);
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = worldTime;
    shader.uniforms.uPush = pushers;
    Object.assign(shader.uniforms, atmoUniforms);
    if (wind === "village") Object.assign(shader.uniforms, villageUniforms);
    if (fire) Object.assign(shader.uniforms, fireLight);
    if (patch) Object.assign(shader.uniforms, patch.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WIND_HEAD}\nvarying vec3 vWPos;${opts.tinted ? "\nattribute float aTint;" : ""}${wind === "cloth" || wind === "village" ? "\nattribute float aSway;" : ""}${wind === "village" ? `\n${VILLAGE_HEAD}` : ""}${vpatch ? `\n${vpatch.head}` : ""}${season ? "\nattribute vec2 aSeason; varying vec2 vSeason;" : ""}`)
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        ${windApply(wind, true)}
        vWPos = mvPosition.xyz;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    if (vpatch) shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n${vpatch.body}`);
    if (wind === "village") shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nobjectNormal = villageNormal(objectNormal, aSway);");
    if (season) {
      Object.assign(shader.uniforms, autumnUniforms);
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSeason = aSeason;");
    }
    if (opts.tinted) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <color_vertex>",
        `vColor = vec4(1.0);
        #ifdef USE_COLOR
          vColor.rgb *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
        #endif`,
      );
    }
    let fs = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\nvarying vec3 vWPos;${season ? "\nvarying vec2 vSeason; uniform vec3 uAutumn0; uniform vec3 uAutumn1; uniform vec3 uAutumn2;" : ""}\nuniform float uTime; uniform float uWet; uniform vec3 uSheen; uniform vec3 uSunDirW; uniform vec3 uSunColW; uniform float uRain; uniform float uMist;\n${lite ? "" : MIST_HEAD}${fire ? "uniform vec3 uFirePos; uniform float uFireI; uniform vec3 uFireCol;" : ""}\n${patch?.head ?? ""}${puddles ? PUDDLE_HEAD : ""}`,
    );
    // Wet ground darkens (all presets: one multiply), and on flat terrain the wettest hollows become pools that mirror the sky.
    fs = fs.replace("#include <color_fragment>", `#include <color_fragment>${season ? SEASON_BODY : ""}\n${patch ? patch.body : ""}\ndiffuseColor.rgb *= 1.0 - ${wetDark} * 0.34 * uWet;${puddles ? PUDDLE_BODY : ""}`);
    if (puddles) fs = fs.replace("#include <opaque_fragment>", `${PUDDLE_SHEEN}\n#include <opaque_fragment>`);
    if (fire) {
      fs = fs.replace(
        "#include <opaque_fragment>",
        `{
          float fd = length(vWPos - uFirePos);
          float fa = uFireI * (1.0 - smoothstep(1.0, 9.5, fd));
          fa = floor(fa * 3.0 + 0.5) / 3.0;
          outgoingLight += uFireCol * fa * diffuseColor.rgb * 0.62;
        }
        #include <opaque_fragment>`,
      );
    }
    // Valley mist: ground fog that pools in the low country and thickens toward the far end of the view, on top of the ordinary exponential fog.
    if (!lite) fs = fs.replace("#include <fog_fragment>", MIST_FOG);
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = (): string => `world|${lite ? "L" : ""}${wind}|${fire ? 1 : 0}|${opts.doubleSided ? 2 : 1}|${opts.tinted ? "t" : ""}|${patch?.key ?? ""}|${puddles ? "p" : ""}|${wetDark}|${vpatch?.key ?? ""}|${season ? "s" : ""}`;
  return m;
}

/** Shadow-pass material that sways with the trees so a crown's shadow moves with the crown. */
export function windDepthMaterial(kind: WindKind): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = worldTime;
    shader.uniforms.uPush = pushers;
    shader.uniforms.uWindK = atmoUniforms.uWindK;
    if (kind === "village") Object.assign(shader.uniforms, villageUniforms, { uHour: atmoUniforms.uHour });
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${WIND_HEAD}${kind === "cloth" || kind === "village" ? "\nattribute float aSway;" : ""}${kind === "village" ? `\n${VILLAGE_HEAD}` : ""}`).replace(
      "#include <project_vertex>",
      `vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      ${windApply(kind, false)}
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  m.customProgramCacheKey = (): string => `worldDepth|${kind}`;
  return m;
}

export interface InstanceSet {
  mesh: InstancedMesh;
  hull?: InstancedMesh;
}

const qt = new Quaternion();
const sc = new Vector3();
const ps = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const tmpEuler = new Euler();
const tmpQ = new Quaternion();

/** Writes an instance matrix from a position, a yaw about Y, a small tilt (radians, about X then Z) and a scale. Allocation-free. */
export function composeInstance(out: Matrix4, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tiltX = 0, tiltZ = 0): Matrix4 {
  qt.setFromAxisAngle(yAxis, yaw);
  if (tiltX !== 0 || tiltZ !== 0) {
    const e = tmpEuler.set(tiltX, 0, tiltZ);
    qt.multiply(tmpQ.setFromEuler(e));
  }
  return out.compose(ps.set(x, y, z), qt, sc.set(sx, sy, sz));
}

export interface InstanceOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Draw the ink hull too (medium/high presets). The hull shares the instance buffer, so it costs one draw for all instances. */
  outline?: boolean;
  /** Ink weight class: thinner than the characters' line, heavier for bigger things. */
  ink?: WorldInkClass;
  /** Wind the ink hull follows (trees). */
  wind?: WindKind;
  /** Hull geometry when a cheaper one exists (coarser lobes); must have the same vertex layout only in that it carries `onormal`. */
  hullGeometry?: BufferGeometry;
  name: string;
}

/** Builds an InstancedMesh (+ ink hull) from prepared matrices and optional per-instance colours. */
export function makeInstances(
  scene: Scene | Object3D,
  geometry: BufferGeometry,
  material: MeshToonMaterial,
  matrices: readonly Matrix4[],
  colours: readonly Color[] | undefined,
  o: InstanceOptions,
): InstanceSet | undefined {
  if (matrices.length === 0) return undefined;
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  mesh.name = o.name;
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  if (colours) colours.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = o.castShadow ?? false;
  mesh.receiveShadow = o.receiveShadow ?? true;
  if (o.wind === "tree" && mesh.castShadow) mesh.customDepthMaterial = windDepthMaterial("tree");
  mesh.computeBoundingSphere(); // instances are static: real bounds keep culling honest
  if (o.wind && o.wind !== "none" && mesh.boundingSphere) mesh.boundingSphere.radius += 1.5; // sway must not pop at the frustum edge
  scene.add(mesh);
  const set: InstanceSet = { mesh };
  if (o.outline) {
    const hull = instancedWorldOutline(mesh, { thickness: WORLD_INK[o.ink ?? "medium"], displace: outlineDisplace(o.wind ?? "none") });
    if (o.hullGeometry) hull.geometry = o.hullGeometry;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.boundingSphere = mesh.boundingSphere;
    scene.add(hull);
    set.hull = hull;
  }
  return set;
}

/** A single (non-instanced) mesh with its ink hull as a sibling. `wind: "cloth"` (geometry with `aSway`) sways the mesh, its shadow and its ink together. */
export function makeSolid(scene: Scene | Object3D, geometry: BufferGeometry, material: MeshToonMaterial, o: { name: string; outline?: boolean; ink?: WorldInkClass; hullGeometry?: BufferGeometry; castShadow?: boolean; wind?: WindKind }): Mesh[] {
  const mesh = new Mesh(geometry, material);
  mesh.name = o.name;
  mesh.castShadow = o.castShadow ?? true;
  mesh.receiveShadow = true;
  if (o.wind === "cloth") {
    mesh.customDepthMaterial = windDepthMaterial("cloth");
    mesh.frustumCulled = false; // sway moves vertices past the static bounds; one draw either way
  }
  if (o.wind === "village") mesh.customDepthMaterial = windDepthMaterial("village"); // (bounds are real: the moving parts stay within a metre of them)
  scene.add(mesh);
  const out: Mesh[] = [mesh];
  if (o.outline) {
    const hull = new Mesh(o.hullGeometry ?? geometry, worldOutlineMaterial({ thickness: WORLD_INK[o.ink ?? "large"], displace: outlineDisplace(o.wind ?? "none") }));
    hull.name = `${o.name}_outline`;
    if (o.wind === "cloth") hull.frustumCulled = false;
    scene.add(hull);
    out.push(hull);
  }
  return out;
}

/** How brightly the village's lit windows burn (near 0 by day, 1 at night): the lantern glass mesh carries them as panes with `aLit = 1`. */
export const windowLight = { value: 0.05 };

/** An unlit vertex-coloured material (lantern glass and lit window panes) whose vertices sway like the cloth around it. Geometry needs `aSway` and `aLit`. */
export function clothBasicMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ vertexColors: true, fog: true });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = worldTime;
    shader.uniforms.uPush = pushers;
    shader.uniforms.uWindK = atmoUniforms.uWindK;
    shader.uniforms.uWinK = windowLight;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WIND_HEAD}\nattribute float aSway; attribute float aLit; uniform float uWinK;`)
      .replace("#include <color_vertex>", "#include <color_vertex>\nvColor.rgb *= mix(1.0, uWinK, aLit);")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += windCloth(transformed, aSway);");
  };
  m.customProgramCacheKey = (): string => "clothBasic";
  return m;
}

/** A texture-free uniform helper: `{ value: Texture }`. */
export const textureUniform = (t: Texture): { value: Texture } => ({ value: t });

export { outlineSettings };
