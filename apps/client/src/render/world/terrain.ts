import { BufferAttribute, Color, DataTexture, LinearFilter, PlaneGeometry, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector4, type BufferGeometry } from "three";
import { ARENA_RADIUS, PALETTE, TRAILS, WORN_PATCHES, crackNoise, crackPatch, edgeNoise, groundColour, mudBelt, patchProfile, segmentDistance, smoothstep, trailProfile, villageCobble, type CanopyIndex, type Rgb, type Terrain, type TrailSample } from "@cb/shared";

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
export function buildTerrain(terrain: Terrain, segments: number, canopy?: CanopyIndex): BufferGeometry {
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
    groundColour(x, z, h, slope, rgb, canopy ? canopy.litter(x, z) : 0);
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

// ---- the ground-detail mask ------------------------------------------------------------------------------------------------------------

/** Ground detail is soft (fallen leaves, clay patches, the wet belt, the plaza's extent), so it lives in a coarser texture than the footpaths. */
export const DETAIL_SIZE = 320;

/**
 * Bakes RGBA: R = leaf litter under the canopy, G = sun-baked clay (the shader draws cracks in it), B = wet mud along the water, A = the plaza's cobbles.
 * Every channel is a shared pure function (`CanopyIndex.litter`, `crackPatch`, `mudBelt`, `villageCobble`), evaluated only where it can be non-zero.
 */
export function bakeGroundDetail(terrain: Terrain, canopy?: CanopyIndex, size = DETAIL_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const texel = (MASK_EXTENT * 2) / size;
  for (let j = 0; j < size; j++) {
    const z = -MASK_EXTENT + (j + 0.5) * texel;
    for (let i = 0; i < size; i++) {
      const x = -MASK_EXTENT + (i + 0.5) * texel;
      const o = (j * size + i) * 4;
      if (Math.hypot(x, z) > ARENA_RADIUS + 12) continue;
      if (canopy) data[o] = Math.round(canopy.litter(x, z) * 255);
      if (crackNoise(x, z) > 0.02) data[o + 1] = Math.round(crackPatch(x, z, terrain.height(x, z)) * 255);
      if (z < -20 && z > -50 && x > -34 && x < 30) data[o + 2] = Math.round(mudBelt(x, z) * 255);
      if (z < -48 && x > -34 && x < -8) data[o + 3] = Math.round(villageCobble(x, z) * 255);
      else if (x > -2 && x < 8 && z < -42 && z > -49) data[o + 3] = Math.round(villageCobble(x, z) * 255);
    }
  }
  return data;
}

export function groundDetailTexture(terrain: Terrain, canopy?: CanopyIndex): DataTexture {
  const tex = new DataTexture(bakeGroundDetail(terrain, canopy), DETAIL_SIZE, DETAIL_SIZE, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Shader patch that lays the crisp footpath overlay over the vertex-painted ground (see `bakeTrailMask`). */
export function trailOverlayPatch(mask: DataTexture, detail?: DataTexture): { key: string; uniforms: Record<string, { value: unknown }>; head: string; body: string } {
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
      uDetail: { value: detail ?? mask },
      uDetailOn: { value: detail ? 1 : 0 },
      uLeaf0: { value: new Color(W.litter) },
      uLeaf1: { value: new Color(W.litterRed) },
      uClay: { value: new Color(W.crackClay) },
      uCobA: { value: new Color(W.vlCobble) },
      uCobB: { value: new Color(W.vlCobbleDark) },
    },
    head: `uniform sampler2D uTrail; uniform vec4 uTrailBox; uniform vec3 uDirt; uniform vec3 uWorn; uniform vec3 uDust; uniform vec3 uRut; uniform vec3 uTramp; uniform vec3 uStone;
      uniform sampler2D uDetail; uniform float uDetailOn; uniform vec3 uLeaf0; uniform vec3 uLeaf1; uniform vec3 uClay; uniform vec3 uCobA; uniform vec3 uCobB;
      float gh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec2 gh22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }`,
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
      if (uDetailOn > 0.5) {
        vec4 dm = texture2D(uDetail, tuv);
        // fallen leaves: flecks in drifts under the crowns (two colours, more of them where the litter is deep)
        if (dm.r > 0.04) {
          vec2 lp = vWPos.xz * 9.0;
          vec2 lc = floor(lp);
          vec2 lo = gh22(lc);
          float lh = gh21(lc + 3.7);
          float leafD = length(fract(lp) - (0.2 + 0.6 * lo));
          float fleck = step(leafD, 0.13 + 0.14 * lh) * step(0.55 - dm.r * 0.45, gh21(lc + 9.1));
          vec3 leaf = mix(uLeaf0, uLeaf1, fract(lh * 9.7));
          diffuseColor.rgb = mix(diffuseColor.rgb, leaf * (0.8 + lum * 0.5), fleck * smoothstep(0.04, 0.35, dm.r) * 0.8);
        }
        // sun-baked clay: a network of cracks (the ridges between voronoi cells), darker in the seams, paler on the plates
        if (dm.g > 0.06) {
          vec2 cp = vWPos.xz * 1.45;
          vec2 ci = floor(cp);
          vec2 cf = fract(cp);
          float d1 = 9.0; float d2 = 9.0;
          for (int a = -1; a <= 1; a++) {
            for (int b = -1; b <= 1; b++) {
              vec2 g = vec2(float(a), float(b));
              vec2 o = gh22(ci + g);
              float d = length(g + o - cf);
              if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
            }
          }
          float seam = 1.0 - smoothstep(0.03, 0.09, d2 - d1);
          vec3 plate = mix(diffuseColor.rgb, uClay * (0.92 + 0.35 * lum), 0.55 * dm.g);
          diffuseColor.rgb = mix(plate, uRut * 0.9, seam * smoothstep(0.1, 0.6, dm.g) * 0.85);
        }
        // wet mud: darker and a touch bluer
        diffuseColor.rgb *= 1.0 - 0.24 * dm.b;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.9, 1.0), dm.b * 0.5);
        // tracks in the mud: short trails of paired cloven prints (deer coming down to drink, the ducks' webbed marks, a cat's paws), one trail per hashed cell
        if (dm.b > 0.35) {
          vec2 tp = vWPos.xz / 2.2;
          vec2 tcell = floor(tp);
          float th = gh21(tcell + 5.3);
          if (th > 0.3) {
            float ang = th * 61.0;
            vec2 dir = vec2(cos(ang), sin(ang));
            vec2 per = vec2(-dir.y, dir.x);
            vec2 rel = (fract(tp) - (0.3 + 0.4 * gh22(tcell + 1.7))) * 2.2;
            float along = dot(rel, dir);
            float across = dot(rel, per);
            float k = floor(along / 0.38 + 0.5);
            float lat = (mod(k, 2.0) < 0.5 ? 1.0 : -1.0) * 0.085;
            vec2 pc = vec2((along - k * 0.38) / 0.1, (across - lat) / 0.06);
            float inTrail = step(abs(k), 2.0);
            float pmark = (1.0 - smoothstep(0.7, 1.0, length(pc))) * inTrail;
            diffuseColor.rgb *= 1.0 - 0.5 * pmark * smoothstep(0.35, 0.6, dm.b);
          }
        }
        // the plaza: rounded cobbles with dark joints
        if (dm.a > 0.45) {
          vec2 kp = vWPos.xz * vec2(2.6, 3.4);
          vec2 kc = floor(kp + vec2(0.5 * mod(floor(kp.y), 2.0), 0.0));
          vec2 kf = fract(kp + vec2(0.5 * mod(floor(kp.y), 2.0), 0.0)) - 0.5;
          float kh = gh21(kc);
          float rnd = 1.0 - smoothstep(0.32, 0.5, max(abs(kf.x) * 1.15, abs(kf.y)));
          vec3 stoneC = mix(uCobA, uCobB, kh * 0.7) * (0.86 + 0.28 * fract(kh * 5.3));
          vec3 mortar = uCobB * 0.6;
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(mortar, stoneC, rnd), smoothstep(0.45, 0.6, dm.a) * 0.96);
        }
      }
    }`,
  };
}
