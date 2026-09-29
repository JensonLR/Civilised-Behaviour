import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { PALETTE, type DayState, type Rgb } from "@cb/shared";
import { worldTime } from "./toon.ts";

/**
 * The colour of distance at noon: the horizon colour cooled a touch toward the sky's mid blue. Fog, the sky's lowest band, the ground
 * skirt and the far hills all use ONE colour of distance, so the world melts into the sky with no seam; through the day it is
 * `DayState.horizon` (the same recipe applied to that hour's stops).
 */
export function fogColour(out = new Color()): Color {
  return out.set(PALETTE.sky.horizon).lerp(new Color(PALETTE.sky.mid), 0.14);
}

/** Sets a three Color from an sRGB triple (the day cycle works in sRGB, like the palette). */
export function setRgb(out: Color, c: Rgb): Color {
  return out.setRGB(c.r, c.g, c.b, "srgb");
}

export interface SkyUniforms {
  top: { value: Color };
  mid: { value: Color };
  horizon: { value: Color };
  glow: { value: Color };
  cloudLit: { value: Color };
  cloudShade: { value: Color };
  cloudHigh: { value: Color };
  sunDisc: { value: Color };
  sunRing: { value: Color };
  moonCol: { value: Color };
  starCol: { value: Color };
  sunDir: { value: Vector3 };
  moonDir: { value: Vector3 };
  uTime: { value: number };
  uDusk: { value: number };
  uStars: { value: number };
  uMoon: { value: number };
}

const tmp = new Color();
const tmp2 = new Color();

/** Feeds the sky shader the current moment of the day. Allocation-free. */
export function applyDaySky(u: SkyUniforms, d: DayState): void {
  setRgb(u.top.value, d.top);
  setRgb(u.mid.value, d.mid);
  setRgb(u.horizon.value, d.horizon);
  setRgb(u.glow.value, d.glow);
  u.sunDir.value.set(d.sunDir.x, d.sunDir.y, d.sunDir.z);
  u.moonDir.value.set(d.moonDir.x, d.moonDir.y, d.moonDir.z);
  u.uDusk.value = d.dusk;
  u.uStars.value = d.stars;
  u.uMoon.value = d.moon;
  // clouds: lit by the sun's colour toward the horizon glow at dusk, shaded toward the sky's mid tone; both dim with the sky
  // clouds take the sky's exposure squared: at night they are dim, moon-blue shapes rather than grey slabs
  const k = Math.max(0.09, d.exposure * d.exposure);
  u.cloudLit.value.set(PALETTE.world.skyCloud).lerp(setRgb(tmp, d.glow), 0.35 + 0.35 * d.dusk + 0.3 * d.night).multiplyScalar(k);
  u.cloudShade.value.set(PALETTE.world.skyCloudShade).lerp(setRgb(tmp2, d.mid), 0.3 + 0.5 * d.night).multiplyScalar(k);
  u.cloudHigh.value.set(PALETTE.world.skyCloud).lerp(setRgb(tmp, d.horizon), 0.3 + 0.3 * d.dusk + 0.3 * d.night).multiplyScalar(k * 0.95);
}

/**
 * A painted sky. Everything is stepped like the characters' toon ramp: the gradient climbs in soft-edged bands, two cloud layers drift
 * at different speeds and heights (a low puffy deck with a lit and a shaded tone, lit on the side facing the sun, and a high thin
 * deck of streaks), the sun is a disc with a thin ring and two halo bands, a warm glow pools on the horizon behind it, and at night
 * the moon (a gibbous disc with a halo) and a few hundred twinkling stars replace it. All from hashed noise; no textures.
 */
export function buildSky(sunDir: Vector3): { mesh: Mesh; uniforms: SkyUniforms } {
  const c = (hex: number): { value: Color } => ({ value: new Color(hex) });
  const uniforms: SkyUniforms = {
    top: c(PALETTE.sky.top),
    mid: c(PALETTE.sky.mid),
    horizon: { value: fogColour() },
    glow: c(PALETTE.world.skyGlow),
    cloudLit: c(PALETTE.world.skyCloud),
    cloudShade: c(PALETTE.world.skyCloudShade),
    cloudHigh: c(PALETTE.world.skyCloud),
    sunDisc: c(PALETTE.world.sunDisc),
    sunRing: c(PALETTE.world.sunRing),
    moonCol: c(PALETTE.world.moon),
    starCol: c(PALETTE.world.star),
    sunDir: { value: sunDir.clone().normalize() },
    moonDir: { value: new Vector3(0, -1, 0) },
    uTime: worldTime as { value: number },
    uDusk: { value: 0 },
    uStars: { value: 0 },
    uMoon: { value: 0 },
  };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glow;
      uniform vec3 cloudLit; uniform vec3 cloudShade; uniform vec3 cloudHigh;
      uniform vec3 sunDisc; uniform vec3 sunRing; uniform vec3 moonCol; uniform vec3 starCol;
      uniform vec3 sunDir; uniform vec3 moonDir;
      uniform float uTime; uniform float uDusk; uniform float uStars; uniform float uMoon;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return v; }
      // quantise into n soft-edged steps
      float band(float x, float n){ float f = x * n; return (floor(f) + smoothstep(0.3, 0.7, fract(f))) / n; }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        float g = band(pow(h, 0.72), 7.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.42, g));
        col = mix(col, top, smoothstep(0.36, 1.0, g));

        float sunUp = smoothstep(-0.12, 0.08, sunDir.y);
        vec2 az = normalize(d.xz + vec2(1e-5));
        vec2 saz = normalize(sunDir.xz + vec2(1e-5));
        float toSun = max(dot(az, saz), 0.0);
        float pool = pow(toSun, 3.0) * (1.0 - smoothstep(0.0, 0.4 + 0.25 * uDusk, h));
        col = mix(col, glow, band(pool, 4.0) * (0.55 + 0.5 * uDusk) * sunUp);

        // stars and moon (night)
        if (uStars > 0.01 && d.y > 0.0) {
          vec2 suv = vec2(atan(d.z, d.x) * 9.0, asin(clamp(d.y, -1.0, 1.0)) * 16.0);
          vec2 cell = floor(suv * vec2(2.0, 2.0));
          vec2 fp = fract(suv * 2.0) - 0.5;
          float r = hash(cell);
          float present = step(0.86, r);
          vec2 off = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
          float sd = length(fp - off * 0.6);
          float tw = 0.65 + 0.35 * sin(uTime * (1.4 + r * 3.0) + r * 60.0);
          float star = present * (1.0 - smoothstep(0.03, 0.09 + 0.06 * hash(cell + 9.3), sd)) * tw;
          col = mix(col, starCol, star * uStars * smoothstep(0.03, 0.25, d.y));
        }
        if (uMoon > 0.01) {
          float ma = acos(clamp(dot(d, normalize(moonDir)), -1.0, 1.0));
          float halo = 1.0 - smoothstep(0.0, 0.38, ma);
          col = mix(col, moonCol, band(halo, 3.0) * 0.16 * uMoon);
          // a gibbous moon: the disc minus a shifted disc
          vec3 mn = normalize(moonDir);
          vec3 side = normalize(cross(mn, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
          float shifted = acos(clamp(dot(d, normalize(mn + side * 0.03)), -1.0, 1.0));
          float disc = 1.0 - smoothstep(0.050, 0.054, ma);
          float bite = 1.0 - smoothstep(0.047, 0.052, shifted);
          float lit = disc * (1.0 - bite * 0.78);
          float mare = vnoise(vec2(atan(d.z, d.x) * 90.0, d.y * 90.0));
          col = mix(col, moonCol * (0.88 + 0.12 * mare), lit * uMoon);
        }

        // sun: disc with a ring and two halo bands
        float ang = acos(clamp(dot(d, normalize(sunDir)), -1.0, 1.0));
        float halo = 1.0 - smoothstep(0.0, 0.42, ang);
        col = mix(col, sunRing, band(halo, 3.0) * 0.28 * sunUp);
        float ring = smoothstep(0.060, 0.063, ang) * (1.0 - smoothstep(0.069, 0.072, ang));
        col = mix(col, sunRing, ring * 0.85 * sunUp);
        col = mix(col, sunDisc, (1.0 - smoothstep(0.032, 0.036, ang)) * sunUp);

        // high deck: thin stretched streaks, slow, banded in two tones
        vec2 huv = d.xz / (d.y + 0.16) * 0.5 + vec2(uTime * 0.0022, uTime * 0.0006);
        float hn = fbm(vec2(huv.x * 0.9, huv.y * 3.2) * 1.4 + 5.0);
        float hcover = smoothstep(0.03, 0.22, d.y) * (1.0 - smoothstep(0.7, 0.98, d.y));
        float hbody = smoothstep(0.58, 0.60, hn) * hcover * 0.85;
        float hcore = smoothstep(0.66, 0.68, hn);
        vec3 hc = mix(cloudHigh * 0.9, cloudHigh, hcore);
        hc = mix(hc, glow, (1.0 - h) * toSun * 0.4 * (0.4 + uDusk));
        col = mix(col, hc, hbody);

        // low deck: flat-shaded puffs on a projected plane, lit where the noise falls away toward the sun
        vec2 cuv = d.xz / (d.y + 0.4) * 1.05 + vec2(uTime * 0.0052, uTime * 0.0018);
        float n = fbm(cuv * 1.5) + (vnoise(cuv * 6.0) - 0.5) * 0.06;
        float nl = fbm((cuv + saz * 0.05) * 1.5) + (vnoise((cuv + saz * 0.05) * 6.0) - 0.5) * 0.06;
        float cover = smoothstep(0.02, 0.2, d.y);
        float body = smoothstep(0.555, 0.563, n) * cover;
        float lit = step(0.012, n - nl) * sunUp;
        float core = smoothstep(0.63, 0.638, n);
        vec3 cc = mix(cloudShade, cloudLit, max(lit, core * 0.6));
        cc = mix(cc, glow, (1.0 - h) * toSun * (0.3 + 0.4 * uDusk) * sunUp);
        col = mix(col, cc, body);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(400, 32, 20), mat);
  mesh.frustumCulled = false;
  mesh.name = "sky";
  return { mesh, uniforms };
}
