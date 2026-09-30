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
  /** Cloud cover 0..1 (weather). */
  uCover: { value: number };
  /** Lightning: flash brightness 0..1 and the bolt (azimuth in radians, on/off 0..1, seed). */
  uFlash: { value: number };
  uBolt: { value: Vector3 };
  flashCol: { value: Color };
  /** Rain curtain: greys the low sky. */
  uRain: { value: number };
  /** The moon's phase angle (radians): 0 new, PI full. */
  uPhase: { value: number };
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
  u.uCover.value = d.cover;
  u.uFlash.value = d.flash;
  u.uRain.value = d.rain;
  // clouds: lit by the sun's colour toward the horizon glow at dusk, shaded toward the sky's mid tone; both dim with the sky
  // clouds take the sky's exposure squared: at night they are dim, moon-blue shapes rather than grey slabs
  const k = Math.max(0.09, d.exposure * d.exposure);
  u.cloudLit.value.set(PALETTE.world.skyCloud).lerp(setRgb(tmp, d.glow), 0.35 + 0.35 * d.dusk + 0.3 * d.night).multiplyScalar(k);
  u.cloudShade.value.set(PALETTE.world.skyCloudShade).lerp(setRgb(tmp2, d.mid), 0.3 + 0.5 * d.night).multiplyScalar(k);
  u.cloudHigh.value.set(PALETTE.world.skyCloud).lerp(setRgb(tmp, d.horizon), 0.3 + 0.3 * d.dusk + 0.3 * d.night).multiplyScalar(k * 0.95);
  // overcast: the deck goes a flat wet grey, lit from above rather than from the sun, and darker underneath the heavier it is
  if (d.cover > 0.12) {
    const c = Math.min(1, (d.cover - 0.12) / 0.7);
    u.cloudLit.value.lerp(tmp.set(PALETTE.world.overcastHorizon).multiplyScalar(k), c * 0.75);
    u.cloudShade.value.lerp(tmp2.set(PALETTE.world.stormMid).multiplyScalar(k), c * 0.8);
    u.cloudHigh.value.lerp(tmp.set(PALETTE.world.overcastMid).multiplyScalar(k), c * 0.7);
    // a thunderhead has no bright side
    u.cloudLit.value.lerp(tmp.set(PALETTE.world.stormHorizon).multiplyScalar(k), d.rain * 0.55);
  }
}

export type SkyDetail = "flat" | "full";

/**
 * A painted sky. Everything is stepped like the characters' toon ramp: the gradient climbs in soft-edged bands, two cloud layers drift
 * at different speeds and heights (a low puffy deck with a lit and a shaded tone, lit on the side facing the sun, and a high thin
 * deck of streaks), the sun is a disc with a thin ring and two halo bands, a warm glow pools on the horizon behind it, and at night
 * the moon (a gibbous disc with a halo) and a few hundred twinkling stars replace it. All from hashed noise; no textures.
 *
 * The dome is drawn LAST with its depth pinned to the far plane (`gl_Position.z = w`), so the depth test throws away every pixel the ground,
 * hills and trees already cover before the (expensive) fragment shader runs: only the sky you can see is shaded. `lite` compiles a flat banded
 * gradient with the sun's disc and glow, no clouds, stars or moon (the test preset: a software rasteriser pays for every noise call). Measured
 * and dropped: a middle "one cloud deck, no second noise lookup" sky saved 5 ms of 210 per frame on the software rasteriser.
 */
export function buildSky(sunDir: Vector3, detail: SkyDetail = "full"): { mesh: Mesh; uniforms: SkyUniforms } {
  const lite = detail === "flat";
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
    uCover: { value: 0.06 },
    uFlash: { value: 0 },
    uBolt: { value: new Vector3(0, 0, 0) },
    flashCol: c(PALETTE.world.flash),
    uRain: { value: 0 },
    uPhase: { value: Math.PI },
  };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = (projectionMatrix * modelViewMatrix * vec4(position,1.0)).xyww; }",
    fragmentShader: /* glsl */ `
      ${lite ? "#define SKY_LITE" : ""}
      varying vec3 vDir;
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glow;
      uniform vec3 cloudLit; uniform vec3 cloudShade; uniform vec3 cloudHigh;
      uniform vec3 sunDisc; uniform vec3 sunRing; uniform vec3 moonCol; uniform vec3 starCol;
      uniform vec3 sunDir; uniform vec3 moonDir;
      uniform float uTime; uniform float uDusk; uniform float uStars; uniform float uMoon;
      uniform float uCover; uniform float uFlash; uniform vec3 uBolt; uniform vec3 flashCol; uniform float uRain; uniform float uPhase;
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
        float sunSee = sunUp * (1.0 - smoothstep(0.35, 0.8, uCover));
        vec2 az = normalize(d.xz + vec2(1e-5));
        vec2 saz = normalize(sunDir.xz + vec2(1e-5));
        float toSun = max(dot(az, saz), 0.0);
        float pool = pow(toSun, 3.0) * (1.0 - smoothstep(0.0, 0.4 + 0.25 * uDusk, h));
        col = mix(col, glow, band(pool, 4.0) * (0.55 + 0.5 * uDusk) * sunUp);

        #ifndef SKY_LITE
        // stars: a sparse bright layer, a dense faint one, a milky band of extra faint ones, and now and then a shooting star
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
          // faint dense layer
          vec2 suv2 = suv * 2.7 + 31.0;
          vec2 cell2 = floor(suv2);
          vec2 fp2 = fract(suv2) - 0.5;
          float r2 = hash(cell2 + 5.0);
          vec2 off2 = vec2(hash(cell2 + 1.3), hash(cell2 + 2.9)) - 0.5;
          float faint = step(0.8, r2) * (1.0 - smoothstep(0.02, 0.07, length(fp2 - off2 * 0.7))) * (0.5 + 0.5 * sin(uTime * (2.0 + r2 * 4.0) + r2 * 40.0));
          // the milky band: a great circle tilted across the sky where the faint stars crowd
          float band = 1.0 - smoothstep(0.0, 0.32, abs(dot(d, normalize(vec3(0.45, 0.62, -0.64)))));
          float milk = step(0.55, r2) * (1.0 - smoothstep(0.02, 0.06, length(fp2 - off2 * 0.7))) * band;
          float sky3 = smoothstep(0.03, 0.25, d.y) * uStars;
          col = mix(col, starCol, clamp(star + faint * 0.5 + milk * 0.5, 0.0, 1.0) * sky3);
          col = mix(col, starCol * 0.9, band * band * 0.05 * sky3 * (0.6 + 0.4 * vnoise(suv * 1.3)));
          // a shooting star every so often (a streak that fades along its path)
          float slot = floor(uTime / 23.0);
          float sh = hash(vec2(slot, 4.0));
          float lifeT = fract(uTime / 23.0) * 23.0;
          if (sh > 0.55 && lifeT < 0.9) {
            vec2 a0 = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
            vec2 start = vec2(sh * 6.2831, 0.55 + 0.4 * hash(vec2(slot, 9.0)));
            vec2 dirv = vec2(0.85, -0.5);
            vec2 head = start + dirv * lifeT * 0.3;
            vec2 rel = a0 - head;
            rel.x = mod(rel.x + 3.14159265, 6.2831853) - 3.14159265;
            float along = dot(rel, -dirv);
            float across = abs(dot(rel, vec2(-dirv.y, dirv.x)));
            float streak = step(0.0, along) * (1.0 - smoothstep(0.0, 0.22, along)) * (1.0 - smoothstep(0.0015, 0.004, across)) * (1.0 - lifeT / 0.9);
            col = mix(col, starCol, streak * uStars * 0.9);
          }
        }
        // the moon, by its phase: the disc lit on the side facing the (hidden) sun, the rest in faint earthshine
        if (uMoon > 0.01) {
          vec3 mn = normalize(moonDir);
          float ma = acos(clamp(dot(d, mn), -1.0, 1.0));
          float illum = 0.5 - 0.5 * cos(uPhase);
          float halo = 1.0 - smoothstep(0.0, 0.38, ma);
          col = mix(col, moonCol, band(halo, 3.0) * (0.03 + 0.15 * illum) * uMoon);
          if (ma < 0.08) {
            vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), mn) + vec3(1e-4));
            vec3 upv = cross(mn, side);
            vec3 dd = d - mn * dot(d, mn);
            vec2 muv = vec2(dot(dd, side), dot(dd, upv)) / 0.052;
            float rr = length(muv);
            float disc = 1.0 - smoothstep(0.94, 1.0, rr);
            vec3 nrm = vec3(muv, sqrt(max(0.0, 1.0 - rr * rr)));
            float lit = smoothstep(-0.03, 0.04, dot(nrm, vec3(sin(uPhase), 0.0, -cos(uPhase))));
            float mare = vnoise(muv * 3.6 + 4.0) * 0.6 + vnoise(muv * 8.0) * 0.4;
            vec3 face = moonCol * (0.9 + 0.1 * mare) * lit + moonCol * 0.14 * (1.0 - lit) * (0.8 + 0.2 * mare);
            col = mix(col, face, disc * uMoon);
          }
        }

        #endif

        // sun: disc with a ring and two halo bands
        float ang = acos(clamp(dot(d, normalize(sunDir)), -1.0, 1.0));
        float halo = 1.0 - smoothstep(0.0, 0.42, ang);
        col = mix(col, sunRing, band(halo, 3.0) * 0.28 * sunSee);
        float ring = smoothstep(0.060, 0.063, ang) * (1.0 - smoothstep(0.069, 0.072, ang));
        col = mix(col, sunRing, ring * 0.85 * sunSee);
        col = mix(col, sunDisc, (1.0 - smoothstep(0.032, 0.036, ang)) * sunSee);

        #ifndef SKY_LITE
        // high deck: thin stretched streaks, slow, banded in two tones
        vec2 huv = d.xz / (d.y + 0.16) * 0.5 + vec2(uTime * 0.0022, uTime * 0.0006);
        float hn = fbm(vec2(huv.x * 0.9, huv.y * 3.2) * 1.4 + 5.0);
        float hcover = smoothstep(0.03, 0.22, d.y) * (1.0 - smoothstep(0.7, 0.98, d.y));
        float hbody = smoothstep(0.58 - uCover * 0.16, 0.60 - uCover * 0.16, hn) * hcover * 0.85;
        float hcore = smoothstep(0.66, 0.68, hn);
        vec3 hc = mix(cloudHigh * 0.9, cloudHigh, hcore);
        hc = mix(hc, glow, (1.0 - h) * toSun * 0.4 * (0.4 + uDusk));
        col = mix(col, hc, hbody);

        // low deck: flat-shaded puffs on a projected plane, lit where the noise falls away toward the sun
        vec2 cuv = d.xz / (d.y + 0.4) * 1.05 + vec2(uTime * 0.0052, uTime * 0.0018);
        float n = fbm(cuv * 1.5) + (vnoise(cuv * 6.0) - 0.5) * 0.06;
        float nl = fbm((cuv + saz * 0.05) * 1.5) + (vnoise((cuv + saz * 0.05) * 6.0) - 0.5) * 0.06;
        float cover = smoothstep(0.02, 0.2, d.y);
        float thr = 0.555 - uCover * 0.24;
        float body = smoothstep(thr, thr + 0.008 + uCover * 0.12, n) * mix(cover, smoothstep(-0.02, 0.1, d.y), uCover);
        float lit = step(0.012, n - nl) * sunUp * (1.0 - uCover * 0.9);
        float core = smoothstep(thr + 0.075, thr + 0.083, n);
        vec3 cc = mix(cloudShade, cloudLit, max(lit, core * 0.6));
        // volume: a third tone deep in the thick of a cloud (its belly), and a bright rim on the sun's edge of it
        float belly = smoothstep(thr + 0.11, thr + 0.2, n) * (1.0 - lit);
        cc = mix(cc, cloudShade * 0.78, belly * 0.7);
        cc = mix(cc, glow, (1.0 - h) * toSun * (0.3 + 0.4 * uDusk) * sunUp);
        // sunset: clouds in front of the sun go dark plum with a burning rim (silhouettes), and the rim catches fire along its edge
        float rim = smoothstep(thr, thr + 0.02, n) * (1.0 - smoothstep(thr + 0.025, thr + 0.07, n));
        float sunSide = pow(toSun, 2.0) * uDusk * sunUp * (1.0 - smoothstep(0.0, 0.5, h));
        cc = mix(cc, cloudShade * 0.5, sunSide * 0.55 * (1.0 - rim));
        cc = mix(cc, glow * 1.35, rim * sunSide * 1.6 + rim * uDusk * 0.25);
        col = mix(col, cc, body);
        #endif
        // rain curtain: the low sky greys out
        col = mix(col, horizon, uRain * (1.0 - smoothstep(0.0, 0.5, h)) * 0.55);
        // lightning: a jagged bolt in the sky for the first instants, then the whole dome flares (clouds most)
        if (uFlash > 0.02) {
          float el = asin(clamp(d.y, -1.0, 1.0));
          float az = atan(d.z, d.x);
          float jag = sin(el * 23.0 + uBolt.z) * 0.012 + sin(el * 51.0 + uBolt.z * 2.3) * 0.006 + sin(el * 9.0 + uBolt.z * 0.7) * 0.02;
          float da = abs(mod(az - uBolt.x - jag + 3.14159265, 6.2831853) - 3.14159265) * cos(el);
          float fork = abs(mod(az - uBolt.x - jag - (el - 0.25) * 0.35 + 3.14159265, 6.2831853) - 3.14159265) * cos(el);
          float bolt = (1.0 - smoothstep(0.0012, 0.0036, da)) * smoothstep(0.02, 0.09, el) * (1.0 - smoothstep(0.5, 0.62, el));
          bolt = max(bolt, (1.0 - smoothstep(0.001, 0.0028, fork)) * smoothstep(0.27, 0.3, el) * (1.0 - smoothstep(0.36, 0.5, el)) * 0.8);
          col = mix(col, flashCol, bolt * uBolt.y * smoothstep(0.25, 0.75, uFlash));
          #ifdef SKY_LITE
          col = mix(col, flashCol, uFlash * 0.3);
          #else
          col = mix(col, flashCol, uFlash * (0.3 + 0.5 * body));
          #endif
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(400, 32, 20), mat);
  mesh.frustumCulled = false;
  mesh.name = "sky";
  mesh.renderOrder = 1000; // last among the opaque draws (its depth is the far plane, so only uncovered pixels are shaded)
  return { mesh, uniforms };
}
