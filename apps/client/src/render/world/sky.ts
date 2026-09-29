import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { PALETTE } from "@cb/shared";
import { worldTime } from "./toon.ts";

/**
 * The colour of distance: the horizon colour cooled a touch toward the sky's mid blue. Fog, the sky's lowest band, the ground skirt
 * and the far hills all use this ONE colour, so the world melts into the sky with no seam.
 */
export function fogColour(out = new Color()): Color {
  return out.set(PALETTE.sky.horizon).lerp(new Color(PALETTE.sky.mid), 0.14);
}

/**
 * A painted sky. Everything is stepped like the characters' toon ramp: the gradient climbs in soft-edged bands, clouds are flat
 * shapes with a lit and a shaded tone (lit on the side facing the sun), the sun is a disc with a thin ring and two halo bands, and
 * a warm glow pools on the horizon behind it. Three octaves of value noise; no textures.
 */
export function buildSky(sunDir: Vector3): Mesh {
  const c = (hex: number): { value: Color } => ({ value: new Color(hex) });
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: c(PALETTE.sky.top),
      mid: c(PALETTE.sky.mid),
      horizon: { value: fogColour() },
      glow: c(PALETTE.world.skyGlow),
      cloud: c(PALETTE.world.skyCloud),
      cloudShade: c(PALETTE.world.skyCloudShade),
      sunDisc: c(PALETTE.world.sunDisc),
      sunRing: c(PALETTE.world.sunRing),
      sunDir: { value: sunDir.clone().normalize() },
      uTime: worldTime,
    },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glow; uniform vec3 cloud; uniform vec3 cloudShade;
      uniform vec3 sunDisc; uniform vec3 sunRing; uniform vec3 sunDir; uniform float uTime;
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

        vec2 az = normalize(d.xz + vec2(1e-5));
        vec2 saz = normalize(sunDir.xz);
        float toSun = max(dot(az, saz), 0.0);
        float pool = pow(toSun, 3.0) * (1.0 - smoothstep(0.0, 0.4, h));
        col = mix(col, glow, band(pool, 4.0) * 0.8);

        float ang = acos(clamp(dot(d, normalize(sunDir)), -1.0, 1.0));
        float halo = 1.0 - smoothstep(0.0, 0.42, ang);
        col = mix(col, sunRing, band(halo, 3.0) * 0.28);
        float ring = smoothstep(0.060, 0.063, ang) * (1.0 - smoothstep(0.069, 0.072, ang));
        col = mix(col, sunRing, ring * 0.85);
        col = mix(col, sunDisc, 1.0 - smoothstep(0.032, 0.036, ang));

        // flat-shaded clouds on a projected plane; lit where the noise falls away toward the sun
        vec2 cuv = d.xz / (d.y + 0.4) * 1.05 + vec2(uTime * 0.004, uTime * 0.0015);
        float n = fbm(cuv * 1.5) + (vnoise(cuv * 6.0) - 0.5) * 0.06;
        float nl = fbm((cuv + saz * 0.05) * 1.5) + (vnoise((cuv + saz * 0.05) * 6.0) - 0.5) * 0.06;
        float cover = smoothstep(0.02, 0.2, d.y);
        float body = smoothstep(0.555, 0.563, n) * cover;
        float lit = step(0.012, n - nl);
        float core = smoothstep(0.63, 0.638, n);
        vec3 cc = mix(cloudShade, cloud, max(lit, core * 0.6));
        cc = mix(cc, glow, (1.0 - h) * toSun * 0.35);
        col = mix(col, cc, body);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new Mesh(new SphereGeometry(400, 32, 20), mat);
  sky.frustumCulled = false;
  sky.name = "sky";
  return sky;
}
