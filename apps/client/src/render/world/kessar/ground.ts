import { BufferAttribute, BufferGeometry, Color, PlaneGeometry, SRGBColorSpace } from "three";
import { PALETTE, smoothstep, valueNoise, type Rgb, type Terrain } from "@cb/shared";
import { KESSAR, KESSAR_ANCHORS, kessarRiverHalf, kessarRiverZ, kessarRoad, kessarWallRun, type KessarTerrain } from "./shared.ts";
import { kessarCover } from "@cb/shared";
// (D-103: the cover functions live in shared, where the fire's fuel map reads them too)
export { kessarCover };

/**
 * The ground of Kessar Reach as vertex colour: ochre swells with patches of scrub, a pale beach shelving into wet sand, the packed customs yard and
 * the road, sandstone strata on the gorge walls, shingle on the river bed, dry rock on the fort's hill. Every colour is a palette colour and the
 * result is a convex mix, so it never leaves the palette's dusty range. (The terrain MESH is the shared pattern of world/terrain.ts: a segment grid
 * displaced by the shared height function; only the paint is Kessar's.)
 */

const K = PALETTE.kessar;
type Triple = readonly [number, number, number];
const rgb = (n: number): Triple => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const G = {
  sand: rgb(K.sand), pale: rgb(K.sandPale), wet: rgb(K.sandWet), ochre: rgb(K.ochre), clay: rgb(K.clay), strata: rgb(K.strata), strataDark: rgb(K.strataDark),
  scrub: rgb(K.scrub), scrubDry: rgb(K.scrubDry), scrubDeep: rgb(K.scrubDeep), shingle: rgb(K.shingle), road: rgb(K.roadDust), rut: rgb(K.roadRut), stone: rgb(K.stoneShade), stoneDark: rgb(K.stoneDark),
};

function mix(out: Rgb, c: Triple, t: number): void {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  out.r += (c[0] - out.r) * k;
  out.g += (c[1] - out.g) * k;
  out.b += (c[2] - out.b) * k;
}


export function kessarGroundColour(x: number, z: number, h: number, slope: number, out: Rgb): Rgb {
  const n1 = valueNoise(201, x / 11, z / 11);
  const n2 = valueNoise(203, x / 3.3, z / 3.3);
  const n3 = valueNoise(207, x / 1.4, z / 1.4);
  out.r = G.sand[0];
  out.g = G.sand[1];
  out.b = G.sand[2];
  mix(out, G.ochre, smoothstep(0.35, 0.7, valueNoise(209, x / 37, z / 37)) * 0.75);
  mix(out, G.clay, smoothstep(0.66, 0.8, n1) * 0.4);
  // scrub: patches of dry grass, a few deeper clumps, speckle
  const cover = kessarCover(x, z, h, slope);
  mix(out, G.scrubDry, cover * 0.85);
  mix(out, G.scrub, cover * smoothstep(0.5, 0.7, n2) * 0.7);
  mix(out, G.scrubDeep, cover * smoothstep(0.72, 0.85, n3) * 0.5);
  // the beach and the wet sand below the tide line
  mix(out, G.pale, smoothstep(84, 96, z) * 0.85);
  mix(out, G.wet, (1 - smoothstep(KESSAR.seaLevel - 0.1, KESSAR.seaLevel + 0.55, h)) * smoothstep(90, 100, z) * 0.9);
  // the gorge: strata on the walls (bands by height), shingle and wet sand on the bed
  const zc = kessarRiverZ(x);
  const ad = Math.abs(z - zc);
  const reach = kessarRiverHalf(x) + kessarWallRun(x);
  if (ad < reach + 1.2) {
    const band = Math.floor((h + n2 * 0.5) * 2.6) & 1;
    const wall = smoothstep(0.35, 1.0, slope);
    mix(out, band ? G.strata : G.strataDark, wall * 0.9);
    const bed = 1 - smoothstep(KESSAR.level - KESSAR.gorgeDepth + 0.4, KESSAR.level - 0.3, h);
    mix(out, G.shingle, bed * 0.75 * (1 - wall));
    mix(out, G.wet, bed * smoothstep(0.55, 0.8, n3) * 0.5);
  }
  // the fort's hill: dry rock, steeper = darker
  const hd = Math.hypot(x - KESSAR_ANCHORS.fort.x, z - KESSAR_ANCHORS.fort.z);
  if (hd < KESSAR.hillRadius + 6) {
    const on = 1 - smoothstep(KESSAR.hillRadius - 4, KESSAR.hillRadius + 6, hd);
    mix(out, G.stone, on * smoothstep(0.25, 0.7, slope) * 0.8);
    mix(out, G.ochre, on * 0.25);
  }
  // roads and the packed customs yard
  const road = kessarRoad(x, z);
  const yard = (1 - smoothstep(8, 13, Math.hypot(x, z - 6))) * 0.85;
  const worn = Math.max(road, yard);
  mix(out, G.road, worn * 0.85);
  mix(out, G.rut, road * smoothstep(0.55, 0.75, n3) * (1 - smoothstep(0.6, 0.95, road)) * 0.6 + road * smoothstep(0.9, 0.96, n2) * 0.25);
  // rocky slopes, then tonal variation
  mix(out, G.stoneDark, smoothstep(0.85, 1.4, slope) * 0.35);
  const j = 0.94 + n2 * 0.09 + (n3 - 0.5) * 0.05;
  out.r = Math.min(1, out.r * j);
  out.g = Math.min(1, out.g * j);
  out.b = Math.min(1, out.b * j);
  return out;
}

/** Where the ground beyond the terrain mesh stands: the plain at 0, shelving to the sea bed on the south. The mesh eases to this at its rim, the skirt lies on it. */
export function skirtY(z: number): number {
  return KESSAR.seabed * smoothstep(96, 106, z);
}

const EDGE = KESSAR_ANCHORS.bounds + 24;
/** Half the side of the terrain mesh. */
export const GROUND_HALF = KESSAR_ANCHORS.bounds + 30;

/** The height as drawn: exactly the simulated height inside the bounds, easing to the skirt beyond them (nobody can stand out there). */
export function visualY(h: number, x: number, z: number): number {
  const k = smoothstep(KESSAR_ANCHORS.bounds, EDGE, Math.hypot(x, z));
  return h + (skirtY(z) - h) * k;
}

export function buildKessarGround(terrain: Terrain, segments: number): BufferGeometry {
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
    pos.setY(i, visualY(h, x, z));
    kessarGroundColour(x, z, h, slope, rgbv);
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

/** Flat ground from the terrain's rim out past the farthest hills, in the plain's sand (fog dissolves it). */
export function buildKessarSkirt(): BufferGeometry {
  const inner = EDGE - 2;
  const outer = 480;
  const radial = 9;
  const around = 64;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const cc = new Color();
  const radii: number[] = [];
  for (let i = 0; i <= radial; i++) radii.push(inner * Math.pow(outer / inner, i / radial));
  const push = (r: number, th: number): void => {
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    pos.push(x, skirtY(z) - 0.02, z);
    nor.push(0, 1, 0);
    cc.set(z > 100 ? K.sandWet : K.sand);
    cc.lerp(new Color(K.ochre), 0.3 * (1 - smoothstep(-200, 200, z)));
    col.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i < radial; i++) {
    for (let k = 0; k < around; k++) {
      const t0 = (k / around) * Math.PI * 2;
      const t1 = ((k + 1) / around) * Math.PI * 2;
      push(radii[i]!, t0);
      push(radii[i + 1]!, t1);
      push(radii[i + 1]!, t0);
      push(radii[i]!, t0);
      push(radii[i]!, t1);
      push(radii[i + 1]!, t1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

/** Depth of water over the ground as drawn (the sea), for the sea mesh's shore foam. */
export function seaDepthAt(terrain: KessarTerrain, x: number, z: number): number {
  return KESSAR.seaLevel - visualY(terrain.height(x, z), x, z);
}
