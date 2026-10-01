import { BufferAttribute, BufferGeometry, Color, PlaneGeometry, SRGBColorSpace } from "three";
import { PALETTE, smoothstep, valueNoise, vesperRoadX, vesperRoadness, VESPER_ANCHORS, type Rgb, type Terrain } from "./shared.ts";
import type { VesperTerrain } from "./shared.ts";

/**
 * The ground of Vesper Gorge. Two layers: the VERTEX paint (the floor: packed dust, the pale gravel of the dry bed, the ore road, scree at the cliffs' feet, the green seep at the wharf, the plateau's
 * bleached top) and a FRAGMENT patch that bands every steep face into strata by absolute height, crisp at any mesh resolution: the cliffs are red-violet at their cool, low feet and warm buff towards the
 * rim, in courses a couple of metres thick that tilt a little and are seamed with a darker line. The mesh is the shared pattern (a segment grid displaced by the shared height function), so what is drawn is
 * what the heightfield refuses to climb. Every colour is a palette colour.
 */

const P = PALETTE.vesper;
type Triple = readonly [number, number, number];
const rgb = (n: number): Triple => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const G = {
  dust: rgb(P.dust), gravel: rgb(P.bedGravel), scree: rgb(P.scree), spoil: rgb(P.spoil), buff: rgb(P.strataBuff), bone: rgb(P.strataBone), rust: rgb(P.strataRust), rustDark: rgb(P.strataRustDark),
  plum: rgb(P.strataPlum), violet: rgb(P.strataViolet), shade: rgb(P.strataShade), sun: rgb(P.strataSun), seep: rgb(P.seepGreen), seepDark: rgb(P.seepDark), copper: rgb(P.copper), verdigris: rgb(P.verdigris),
  shale: rgb(P.shale),
};

function mix(out: Rgb, c: Triple, t: number): void {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  out.r += (c[0] - out.r) * k;
  out.g += (c[1] - out.g) * k;
  out.b += (c[2] - out.b) * k;
}

/** The seep's pool at the wharf (matches the plan's basin) and a second, small seep at the head. */
const POOL = { x: 0, z: 134, r: 7 };
const HEAD_SEEP = { x: -9, z: -90, r: 3.4 };

/** Plant cover 0..1 (dry tufts, thorn scrub, snags): sparse, on the floor and the benches, never on the road, the bed, the cliffs or the scree. Mirrors the paint. */
export function vesperCover(x: number, z: number, h: number, slope: number, floorY: number): number {
  const n1 = valueNoise(411, x / 14, z / 14);
  const n2 = valueNoise(413, x / 4.1, z / 4.1);
  const patch = 0.25 + 0.75 * smoothstep(0.42, 0.7, n1 + (n2 - 0.5) * 0.3);
  const road = vesperRoadness(x, z);
  const bedU = 4.5 * Math.sin(z * 0.045 + 0.7);
  const bed = 1 - smoothstep(1.6, 4.6, Math.abs(x - vesperRoadX(z) - bedU));
  const rel = h - floorY;
  const v = patch * (1 - road * 1.4) * (1 - bed * 0.85) * (1 - smoothstep(0.2, 0.55, slope)) * (rel > 14 ? 0 : 1) * (Math.hypot(x - POOL.x, z - POOL.z) < POOL.r + 2 ? 0 : 1);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function vesperGroundColour(x: number, z: number, h: number, slope: number, floorY: number, out: Rgb): Rgb {
  const n1 = valueNoise(401, x / 11, z / 11);
  const n2 = valueNoise(403, x / 3.3, z / 3.3);
  const n3 = valueNoise(407, x / 1.4, z / 1.4);
  const rel = h - floorY;
  out.r = G.dust[0];
  out.g = G.dust[1];
  out.b = G.dust[2];
  // packed dust in broad patches of paler and redder earth, scree speckle
  mix(out, G.buff, smoothstep(0.55, 0.8, n1) * 0.4);
  mix(out, G.rust, (1 - smoothstep(0.2, 0.42, n1)) * 0.22);
  mix(out, G.scree, smoothstep(0.62, 0.86, n2) * 0.45);
  mix(out, G.spoil, smoothstep(0.82, 0.95, n3) * 0.35);
  // the dry bed: pale gravel along a meandering channel
  const u = x - vesperRoadX(z);
  const bedU = 4.5 * Math.sin(z * 0.045 + 0.7);
  const bed = 1 - smoothstep(1.6, 4.6, Math.abs(u - bedU));
  mix(out, G.gravel, bed * 0.85);
  mix(out, G.spoil, bed * smoothstep(0.7, 0.9, n3) * 0.5);
  // scree under the cliffs: the foot is grey rubble
  mix(out, G.scree, smoothstep(0.22, 0.7, slope) * 0.8 * (rel > 0.4 ? 1 : 0.4));
  // the seeps: a green pool at the wharf's basin with a wet rim, a small one at the head, copper-green streaks down the cliff feet
  const dp = Math.hypot(x - POOL.x, z - POOL.z);
  mix(out, G.seep, (1 - smoothstep(POOL.r - 0.6, POOL.r + 3.4, dp)) * 0.55);
  mix(out, G.seepDark, (1 - smoothstep(POOL.r - 2.4, POOL.r + 0.2, dp)) * 0.85);
  const dh = Math.hypot(x - HEAD_SEEP.x, z - HEAD_SEEP.z);
  mix(out, G.seep, (1 - smoothstep(HEAD_SEEP.r * 0.5, HEAD_SEEP.r + 2, dh)) * 0.6);
  mix(out, G.verdigris, (1 - smoothstep(HEAD_SEEP.r, HEAD_SEEP.r + 4.5, dh)) * 0.25);
  mix(out, G.copper, smoothstep(0.5, 0.95, slope) * smoothstep(0.82, 0.94, n3) * 0.5);
  mix(out, G.verdigris, smoothstep(0.35, 0.8, slope) * smoothstep(0.9, 0.97, n2) * 0.55);
  // the rock itself (the fragment patch bands it): a base of rust and plum so a cliff reads red-violet even without the patch
  const rock = smoothstep(0.75, 1.25, slope);
  mix(out, G.rust, rock * 0.75);
  mix(out, G.plum, rock * (1 - smoothstep(2, 26, rel)) * 0.35);
  // the plateau beyond the rim and the rim's flat ledges are bleached stone
  const top = smoothstep(14, 24, rel) * (1 - smoothstep(0.35, 0.8, slope));
  mix(out, G.bone, top * 0.55);
  mix(out, G.buff, top * 0.3);
  // the ore road, with two worn lines
  const road = vesperRoadness(x, z);
  mix(out, G.buff, road * 0.75);
  mix(out, G.rustDark, road * smoothstep(0.58, 0.82, n3) * 0.35 * (1 - smoothstep(0.7, 0.95, road)));
  const j = 0.95 + n2 * 0.08 + (n3 - 0.5) * 0.04;
  out.r = Math.min(1, out.r * j);
  out.g = Math.min(1, out.g * j);
  out.b = Math.min(1, out.b * j);
  return out;
}

/** Half the side of the terrain mesh. */
export const GROUND_HALF = VESPER_ANCHORS.bounds + 30;

export function buildVesperGround(terrain: VesperTerrain, segments: number): BufferGeometry {
  const geo = new PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as BufferAttribute;
  const colours = new Float32Array(pos.count * 3);
  const rgbv: Rgb = { r: 0, g: 0, b: 0 };
  const c = new Color();
  const e = 0.6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrain.height(x, z);
    const slope = Math.hypot(terrain.height(x + e, z) - h, terrain.height(x, z + e) - h) / e;
    pos.setY(i, h);
    vesperGroundColour(x, z, h, slope, terrain.floor(x, z), rgbv);
    c.setRGB(rgbv.r, rgbv.g, rgbv.b, SRGBColorSpace);
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

/**
 * The plateau and the plain beyond the terrain mesh: square rings out to 480 m whose heights are the terrain's at the nearest point of the mesh's edge (the mesa runs on; the plain runs on), in bleached
 * stone, so the horizon is the country's own and the fog dissolves it.
 */
export function buildVesperSkirt(terrain: Terrain): BufferGeometry {
  const rings: number[] = [];
  const inner = GROUND_HALF;
  const outer = 480;
  const n = 8;
  for (let i = 0; i <= n; i++) rings.push(inner * Math.pow(outer / inner, i / n));
  const per = 40;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const cc = new Color();
  const pt = (half: number, k: number): [number, number] => {
    const t = (k / (per * 4)) * 4;
    const side = Math.min(3, Math.floor(t));
    const f = (t - side) * 2 - 1;
    return side === 0 ? [f * half, -half] : side === 1 ? [half, f * half] : side === 2 ? [-f * half, half] : [-half, -f * half];
  };
  const h = (x: number, z: number): number => terrain.height(Math.max(-GROUND_HALF, Math.min(GROUND_HALF, x)), Math.max(-GROUND_HALF, Math.min(GROUND_HALF, z)));
  const push = (x: number, z: number, ring: number): void => {
    pos.push(x, h(x, z) - 0.03, z);
    nor.push(0, 1, 0);
    cc.set(P.strataBone);
    cc.lerp(new Color(P.dust), 0.35 + 0.35 * valueNoise(421, x / 60, z / 60));
    cc.lerp(new Color(P.strataBuff), 0.25 * (ring % 2));
    col.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < per * 4; k++) {
      const [x0, z0] = pt(rings[i]!, k), [x1, z1] = pt(rings[i]!, k + 1);
      const [X0, Z0] = pt(rings[i + 1]!, k), [X1, Z1] = pt(rings[i + 1]!, k + 1);
      push(x0, z0, i);
      push(X0, Z0, i);
      push(x1, z1, i);
      push(x1, z1, i);
      push(X0, Z0, i);
      push(X1, Z1, i);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

/** The fragment patch: strata on every steep face. `body` runs inside the toon material after the vertex colour is applied (`vWPos` is the world position, `diffuseColor` the colour). */
export function vesperStrataPatch(): { key: string; uniforms: Record<string, { value: unknown }>; head: string; body: string } {
  const bands = [P.strataShade, P.strataRustDark, P.strataViolet, P.strataRust, P.strataPlum, P.strataBuff, P.strataRust].map((n) => new Color(n));
  return {
    key: "vesper-strata",
    uniforms: { uBand: { value: bands }, uCool: { value: new Color(P.strataShade) }, uWarm: { value: new Color(P.strataSun) }, uBone: { value: new Color(P.strataBone) }, uShale: { value: new Color(P.shale) } },
    head: `uniform vec3 uBand[7]; uniform vec3 uCool; uniform vec3 uWarm; uniform vec3 uBone; uniform vec3 uShale;
      float vsh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
    body: `{
      vec3 fdx = dFdx(vWPos);
      vec3 fdy = dFdy(vWPos);
      vec3 fn = normalize(cross(fdx, fdy));
      float steep = 1.0 - abs(fn.y);
      float rock = smoothstep(0.34, 0.66, steep);
      float y = vWPos.y + sin(vWPos.x * 0.09 + vWPos.z * 0.06) * 0.8 + sin(vWPos.z * 0.21 - vWPos.x * 0.04) * 0.35;
      float b = y / 2.1;
      float idx = floor(b);
      float k = mod(idx * 3.0 + floor(idx / 7.0) * 2.0, 7.0);
      vec3 band = uBand[int(k)];
      float seam = fract(b);
      band *= 0.84 + 0.16 * smoothstep(0.0, 0.1, seam) * (1.0 - smoothstep(0.9, 1.0, seam));
      float cool = 1.0 - smoothstep(3.0, 22.0, vWPos.y);
      float warm = smoothstep(18.0, 46.0, vWPos.y);
      band = mix(band, uCool, cool * 0.4);
      band = mix(band, uWarm, warm * 0.4);
      band = mix(band, uBone, smoothstep(40.0, 54.0, vWPos.y) * 0.3);
      float st = vsh21(vec2(floor(vWPos.x * 1.3 + vWPos.z * 1.7), idx));
      band *= 0.92 + 0.12 * st;
      band = mix(band, uShale, step(0.93, vsh21(vec2(idx, 3.7))) * 0.5);
      diffuseColor.rgb = mix(diffuseColor.rgb, band, rock * 0.92);
      // fissures: thin dark verticals that wander with height, and a dust of pale chips where the rock weathers
      float fis = smoothstep(0.975, 1.0, sin(vWPos.x * 2.1 + vWPos.z * 2.6 + floor(vWPos.y / 5.0) * 7.3 + sin(vWPos.y * 0.6) * 1.5));
      diffuseColor.rgb *= 1.0 - 0.38 * fis * rock;
      // flat ground: mottled dust, scattered pebbles
      float flatG = 1.0 - smoothstep(0.1, 0.4, steep);
      vec2 cell = floor(vWPos.xz * 2.6);
      float hh = vsh21(cell);
      vec2 cf = fract(vWPos.xz * 2.6) - 0.5;
      float peb = step(0.86, hh) * (1.0 - smoothstep(0.1, 0.2, length(cf - (vec2(fract(hh * 7.1), fract(hh * 3.7)) - 0.5) * 0.45)));
      diffuseColor.rgb = mix(diffuseColor.rgb, uShale * (0.9 + 0.5 * fract(hh * 11.0)), peb * flatG * 0.55);
      diffuseColor.rgb *= 1.0 - flatG * (0.07 * vsh21(floor(vWPos.xz * 0.6)) + 0.05 * hh);
    }`,
  };
}
