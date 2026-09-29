import { BufferAttribute, Color, DataTexture, LinearFilter, PlaneGeometry, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector4, type BufferGeometry } from "three";
import { ARENA_RADIUS, PALETTE, TRAILS, WORN_PATCHES, edgeNoise, groundColour, patchProfile, segmentDistance, smoothstep, trailProfile, type Rgb, type Terrain, type TrailSample } from "@cb/shared";

/** How far past the playable radius the visible ground keeps its shape before it settles flat onto the skirt. */
export const TERRAIN_FADE = 22;

/** Terrain height as drawn: exactly the simulated height inside the arena, easing to a flat plain beyond it (nobody can stand out there). */
export function visualHeight(h: number, x: number, z: number): number {
  return h * (1 - smoothstep(ARENA_RADIUS, ARENA_RADIUS + TERRAIN_FADE, Math.hypot(x, z)));
}

/**
 * The ground mesh: a segment grid over the arena and a margin, displaced by the shared height function and painted per vertex with
 * `groundColour` (patches, hollows and rises, footpaths and their trampled shoulders, river banks, hearth, rocky slopes). Smooth
 * normals: the toon ramp turns them into clean bands across the swells.
 */
export function buildTerrain(terrain: Terrain, segments: number): BufferGeometry {
  const size = ARENA_RADIUS * 2 + 60;
  const geo = new PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as BufferAttribute;
  const colours = new Float32Array(pos.count * 3);
  const rgb: Rgb = { r: 0, g: 0, b: 0 };
  const c = new Color();
  const e = 0.6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrain.height(x, z);
    const slope = Math.hypot(terrain.height(x + e, z) - h, terrain.height(x, z + e) - h) / e;
    pos.setY(i, visualHeight(h, x, z));
    groundColour(x, z, h, slope, rgb);
    c.setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geo.deleteAttribute("uv");
  geo.setAttribute("color", new BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ---- the crisp footpath overlay ---------------------------------------------------------------------------------------------------

/** The overlay covers the arena and its margin; one texel is `EXTENT * 2 / MASK_SIZE` metres. */
export const MASK_EXTENT = ARENA_RADIUS + 30;
export const MASK_SIZE = 1024;

/**
 * Bakes the footpaths into an RGBA texture: R = bare earth, G = wheel ruts, B = trampled shoulder. It is the SAME wear function that
 * paints the terrain's vertices (`trailProfile`, `patchProfile`), evaluated per texel close to each path only, so the soft painted halo
 * and the crisp path edge always agree. The vertex paint alone is a fine fallback (low preset); the overlay sharpens it.
 */
export function bakeTrailMask(size = MASK_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const texel = (MASK_EXTENT * 2) / size;
  const sample: TrailSample = { wear: 0, shoulder: 0, rut: 0 };
  const dist = new Float32Array(size * size);
  const put = (i: number, s: TrailSample): void => {
    const o = i * 4;
    const r = Math.round(s.wear * 255);
    const g = Math.round(s.rut * 255);
    const b = Math.round(s.shoulder * 255);
    if (r > data[o]!) data[o] = r;
    if (g > data[o + 1]!) data[o + 1] = g;
    if (b > data[o + 2]!) data[o + 2] = b;
    data[o + 3] = 255;
  };
  const toTexel = (v: number): number => Math.floor((v + MASK_EXTENT) / texel);
  for (const t of TRAILS) {
    const pad = t.width * 1.5 + 1.4;
    const x0 = Math.max(0, toTexel(t.minX - pad));
    const x1 = Math.min(size - 1, toTexel(t.maxX + pad));
    const z0 = Math.max(0, toTexel(t.minZ - pad));
    const z1 = Math.min(size - 1, toTexel(t.maxZ + pad));
    for (let j = z0; j <= z1; j++) dist.fill(Infinity, j * size + x0, j * size + x1 + 1);
    const p = t.line;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k]!;
      const az = p[k + 1]!;
      const bx = p[k + 2]!;
      const bz = p[k + 3]!;
      const sx0 = Math.max(0, toTexel(Math.min(ax, bx) - pad));
      const sx1 = Math.min(size - 1, toTexel(Math.max(ax, bx) + pad));
      const sz0 = Math.max(0, toTexel(Math.min(az, bz) - pad));
      const sz1 = Math.min(size - 1, toTexel(Math.max(az, bz) + pad));
      for (let j = sz0; j <= sz1; j++) {
        const z = -MASK_EXTENT + (j + 0.5) * texel;
        for (let i = sx0; i <= sx1; i++) {
          const x = -MASK_EXTENT + (i + 0.5) * texel;
          const d = segmentDistance(x, z, ax, az, bx, bz);
          if (d < dist[j * size + i]!) dist[j * size + i] = d;
        }
      }
    }
    for (let j = z0; j <= z1; j++) {
      const z = -MASK_EXTENT + (j + 0.5) * texel;
      for (let i = x0; i <= x1; i++) {
        const d = dist[j * size + i]!;
        if (!(d < pad)) continue;
        const x = -MASK_EXTENT + (i + 0.5) * texel;
        sample.wear = 0;
        sample.shoulder = 0;
        sample.rut = 0;
        trailProfile(t, d, edgeNoise(x, z), Math.hypot(x, z), sample);
        put(j * size + i, sample);
      }
    }
  }
  for (const pt of WORN_PATCHES) {
    const reach = pt.r * 1.8;
    const x0 = Math.max(0, toTexel(pt.x - reach));
    const x1 = Math.min(size - 1, toTexel(pt.x + reach));
    const z0 = Math.max(0, toTexel(pt.z - reach));
    const z1 = Math.min(size - 1, toTexel(pt.z + reach));
    for (let j = z0; j <= z1; j++) {
      const z = -MASK_EXTENT + (j + 0.5) * texel;
      for (let i = x0; i <= x1; i++) {
        const x = -MASK_EXTENT + (i + 0.5) * texel;
        const d = Math.hypot(x - pt.x, z - pt.z);
        if (d > reach) continue;
        sample.wear = 0;
        sample.shoulder = 0;
        sample.rut = 0;
        patchProfile(pt, d, edgeNoise(x, z), sample);
        put(j * size + i, sample);
      }
    }
  }
  return data;
}

export function trailMaskTexture(): DataTexture {
  const tex = new DataTexture(bakeTrailMask(), MASK_SIZE, MASK_SIZE, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Shader patch that lays the crisp footpath overlay over the vertex-painted ground (see `bakeTrailMask`). */
export function trailOverlayPatch(mask: DataTexture): { key: string; uniforms: Record<string, { value: unknown }>; head: string; body: string } {
  const W = PALETTE.world;
  return {
    key: "trails",
    uniforms: {
      uTrail: { value: mask },
      uTrailBox: { value: new Vector4(-MASK_EXTENT, -MASK_EXTENT, MASK_EXTENT * 2, 0) },
      uDirt: { value: new Color(W.dirt) },
      uWorn: { value: new Color(W.trailWorn) },
      uDust: { value: new Color(W.dust) },
      uRut: { value: new Color(W.rut) },
      uTramp: { value: new Color(W.trampled) },
      uStone: { value: new Color(W.pebble) },
    },
    head: `uniform sampler2D uTrail; uniform vec4 uTrailBox; uniform vec3 uDirt; uniform vec3 uWorn; uniform vec3 uDust; uniform vec3 uRut; uniform vec3 uTramp; uniform vec3 uStone;`,
    body: `{
      vec2 tuv = (vWPos.xz - uTrailBox.xy) / uTrailBox.z;
      vec3 tm = texture2D(uTrail, tuv).rgb;
      float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
      float sh = smoothstep(0.30, 0.55, tm.b);
      diffuseColor.rgb = mix(diffuseColor.rgb, uTramp * (0.9 + lum * 0.5), sh * 0.32);
      float core = smoothstep(0.40, 0.56, tm.r);
      vec3 earth = mix(uDirt, uWorn, smoothstep(0.35, 0.9, lum * 2.2));
      earth = mix(earth, uDust, 0.22 + 0.3 * smoothstep(0.55, 0.95, tm.r));
      diffuseColor.rgb = mix(diffuseColor.rgb, earth * (0.85 + lum * 0.5), core * 0.92);
      diffuseColor.rgb = mix(diffuseColor.rgb, uRut, smoothstep(0.35, 0.6, tm.g) * 0.8);
      // scattered stones on the path: a hashed cell grid (deterministic in world space), round pebbles, more on the beaten middle
      vec2 cell = floor(vWPos.xz * 4.2);
      float hs = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      vec2 cf = fract(vWPos.xz * 4.2) - 0.5;
      float sd = length(cf - (vec2(fract(hs * 7.13), fract(hs * 3.71)) - 0.5) * 0.5);
      float stone = step(0.84, hs) * (1.0 - smoothstep(0.12, 0.2, sd)) * smoothstep(0.4, 0.7, tm.r + tm.b * 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb, uStone * (0.75 + 0.5 * fract(hs * 17.0)), stone * 0.95);
    }`,
  };
}
