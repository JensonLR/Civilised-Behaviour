import { BufferAttribute, BufferGeometry, Color, PlaneGeometry, SRGBColorSpace } from "three";
import { PALETTE, SALTMARKET, SALTMARKET_ANCHORS, smoothstep, valueNoise, type Rgb, type SaltmarketTerrain, type Terrain } from "./shared.ts";

/**
 * The ground of the Saltmarket Delta as vertex colour: grey-fawn silt in broad pale and dark patches, wet mud darkening toward every water's edge, a crust of salt (small amounts, on the driest ground),
 * reed-stubble straw where the shallows begin, the banks of the deep cuts in their darkest mud. The mesh is the shared pattern (a segment grid displaced by the shared height function); only the paint is
 * the delta's. Every colour is a palette colour and the result is a convex mix.
 */

const P = PALETTE.saltmarket;
type Triple = readonly [number, number, number];
const rgb = (n: number): Triple => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const G = {
  silt: rgb(P.silt), siltDark: rgb(P.siltDark), siltPale: rgb(P.siltPale), mud: rgb(P.mud), mudDark: rgb(P.mudDark), mudPale: rgb(P.mudPale), salt: rgb(P.salt), saltShade: rgb(P.saltShade),
  reed: rgb(P.reed), reedDark: rgb(P.reedDark), reedGreen: rgb(P.reedGreen), water: rgb(P.siltWater), tar: rgb(P.tarPlankDark),
};

function mix(out: Rgb, c: Triple, t: number): void {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  out.r += (c[0] - out.r) * k;
  out.g += (c[1] - out.g) * k;
  out.b += (c[2] - out.b) * k;
}

/** Plant cover 0..1 (reeds, sedge): thick at the water's edge and in the shallows, thinning on the dry plain; none on the planks' ground, the quay's apron, deep water or the sites. Mirrors the paint. */
export function saltmarketCover(x: number, z: number, h: number, slope: number, water = 0): number {
  const n1 = valueNoise(411, x / 17, z / 17);
  const n2 = valueNoise(423, x / 5.1, z / 5.1);
  const wet = 1 - smoothstep(0.05, 0.5, Math.abs(h - SALTMARKET.waterY - 0.15));   // near the waterline, either side
  const patch = 0.3 + 0.7 * smoothstep(0.3, 0.6, n1 + (n2 - 0.5) * 0.3);
  const v = (0.18 + 0.82 * wet) * patch * (1 - smoothstep(0.35, 0.7, slope)) * (water > 0.55 ? 0 : 1);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function saltmarketGroundColour(x: number, z: number, h: number, slope: number, out: Rgb, water = 0): Rgb {
  const n1 = valueNoise(401, x / 13, z / 13);
  const n2 = valueNoise(403, x / 3.6, z / 3.6);
  const n3 = valueNoise(407, x / 1.3, z / 1.3);
  out.r = G.silt[0];
  out.g = G.silt[1];
  out.b = G.silt[2];
  // the plain: broad patches of pale and dark silt, a darker fleck
  mix(out, G.siltPale, smoothstep(0.5, 0.78, valueNoise(409, x / 31, z / 31)) * 0.75);
  mix(out, G.siltDark, smoothstep(0.45, 0.72, n1) * 0.75);
  mix(out, G.mudPale, smoothstep(0.7, 0.9, n2) * 0.35);
  // salt: a crust on the driest, highest ground, in small amounts
  const dry = smoothstep(0.42, 0.62, h) * smoothstep(0.66, 0.84, valueNoise(413, x / 9, z / 9));
  mix(out, G.salt, dry * 0.55);
  mix(out, G.saltShade, dry * smoothstep(0.55, 0.8, n3) * 0.3);
  // tidal ripple marks on the flat damp plain: long pale-and-dark bands that wander
  const rip = Math.sin(z * 2.1 + valueNoise(417, x / 6, z / 6) * 5.0) * 0.5 + 0.5;
  mix(out, G.siltDark, smoothstep(0.72, 0.95, rip) * 0.22 * (1 - dry));
  mix(out, G.siltPale, smoothstep(0.05, 0.28, rip) * 0.08 * (1 - dry));
  // wet ground: mud darkens as the ground sinks to the waterline, and under the water it is the bed
  const wetK = 1 - smoothstep(0.04, 0.27, h - SALTMARKET.waterY);
  mix(out, G.mud, wetK * 0.8);
  mix(out, G.mudDark, wetK * smoothstep(0.35, 0.75, n2) * 0.55);
  mix(out, G.mudDark, Math.min(1, water * 1.4) * 0.8);
  mix(out, G.water, Math.min(1, water * 0.5) * 0.25);
  // reed stubble in the shallows' margins
  const cover = saltmarketCover(x, z, h, slope, water);
  mix(out, G.reedDark, cover * smoothstep(0.55, 0.8, n3) * 0.4);
  mix(out, G.reed, cover * smoothstep(0.62, 0.85, n2) * 0.25);
  mix(out, G.reedGreen, cover * smoothstep(0.7, 0.9, n1) * 0.18);
  // a bank is wet dark mud, and darker the steeper it is
  mix(out, G.mudDark, smoothstep(0.5, 1.2, slope) * 0.85);
  mix(out, G.tar, smoothstep(1.4, 3.2, slope) * 0.4);
  const j = 0.96 + n2 * 0.07 + (n3 - 0.5) * 0.04;
  out.r = Math.min(1, out.r * j);
  out.g = Math.min(1, out.g * j);
  out.b = Math.min(1, out.b * j);
  return out;
}

const EDGE = SALTMARKET_ANCHORS.bounds + 24;
/** Half the side of the terrain mesh. */
export const GROUND_HALF = SALTMARKET_ANCHORS.bounds + 30;
/** The plain beyond the terrain mesh stands at the bank level; the mesh eases to it at its rim, the skirt lies on it. */
export const skirtY = (): number => SALTMARKET.level - 0.12;

/** The height as drawn: exactly the simulated height inside the bounds, easing to the skirt beyond them (nobody can stand out there). */
export function visualY(h: number, x: number, z: number): number {
  const k = smoothstep(SALTMARKET_ANCHORS.bounds, EDGE, Math.hypot(x, z));
  return h + (skirtY() - h) * k;
}

export function buildSaltmarketGround(terrain: Terrain, segments: number): BufferGeometry {
  const geo = new PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as BufferAttribute;
  const colours = new Float32Array(pos.count * 3);
  const rgbv: Rgb = { r: 0, g: 0, b: 0 };
  const c = new Color();
  const e = 0.6;
  const wd = (terrain as Partial<SaltmarketTerrain>).waterDepth;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrain.height(x, z);
    const slope = Math.hypot(terrain.height(x + e, z) - h, terrain.height(x, z + e) - h) / e;
    pos.setY(i, visualY(h, x, z));
    saltmarketGroundColour(x, z, h, slope, rgbv, wd ? wd(x, z) : 0);
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

/** Wet flats from the terrain's rim out past the farthest horizon, in the silt's own tones (fog dissolves it): mud near, a pale salt-bright line far. */
export function buildSaltmarketSkirt(): BufferGeometry {
  const inner = EDGE - 2;
  const outer = 520;
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
    pos.push(x, skirtY() - 0.02, z);
    nor.push(0, 1, 0);
    cc.set(P.silt);
    cc.lerp(new Color(P.siltPale), 0.5 * smoothstep(180, 420, r));
    cc.lerp(new Color(P.mud), 0.45 * (1 - smoothstep(180, 260, r)) * (0.6 + 0.4 * valueNoise(433, x / 40, z / 40)));
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
