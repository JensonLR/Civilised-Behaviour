import { BufferAttribute, BufferGeometry, Color, PlaneGeometry, SRGBColorSpace } from "three";
import { PALETTE, smoothstep, valueNoise, type Rgb, type Terrain } from "@cb/shared";
import { HIGHMARK, HIGHMARK_ANCHORS, HIGHMARK_FIELDS, highmarkRoadness, plotAt, type HighmarkTerrain } from "./shared.ts";
import { highmarkFieldMask, highmarkCover } from "@cb/shared";
// (D-103: the cover functions live in shared, where the fire's fuel map reads them too)
export { highmarkFieldMask, highmarkCover };

/**
 * The ground of Highmark as vertex colour: a golden savannah (patches of deeper gold and green, termite earth), the chalk road, a river bank of shingle and mud, and the five
 * terraces of the hill, each with its own paving: stubble and earth on the granary's, chalk flags on the market's, lawn on the guild's, a checker of chalk on the court terrace's and
 * the plateau's flagstones. Every colour is a palette colour and the result is a convex mix. (The terrain MESH is the shared pattern: a segment grid displaced by the shared height
 * function; only the paint is Highmark's. A riser is a step in the height: the quad that spans it is painted as the stone it is.)
 */

const P = PALETTE.highmark;
type Triple = readonly [number, number, number];
const rgb = (n: number): Triple => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const G = {
  gold: rgb(P.grassGold), deep: rgb(P.grassGoldDeep), pale: rgb(P.grassGoldPale), green: rgb(P.grassGreen), greenDeep: rgb(P.grassGreenDeep), earth: rgb(P.earth), earthDark: rgb(P.earthDark),
  road: rgb(P.roadChalk), rut: rgb(P.roadRut), shingle: rgb(P.shingle), mud: rgb(P.mud), chalk: rgb(P.chalk), shade: rgb(P.chalkShade), dark: rgb(P.chalkDark), reed: rgb(P.reed), reedDark: rgb(P.reedDark),
  termite: rgb(P.termite),
};

function mix(out: Rgb, c: Triple, t: number): void {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  out.r += (c[0] - out.r) * k;
  out.g += (c[1] - out.g) * k;
  out.b += (c[2] - out.b) * k;
}

const C = HIGHMARK.centre;
const R = HIGHMARK.radii;
const RUN = HIGHMARK.rampRun;

/** Which terrace a point is on (0 = the grass beyond the hill, 1..5 = granary, market, guild, court terrace, plateau), by its radius from the hill's centre. */
export function tierOf(x: number, z: number): number {
  const r = Math.hypot(x - C.x, z - C.z);
  let j = 0;
  while (j < 5 && r < R[j]!) j++;
  return j;
}



const plotHit = { m: 0 };

export function highmarkGroundColour(x: number, z: number, h: number, slope: number, out: Rgb, water = 0): Rgb {
  const n1 = valueNoise(301, x / 11, z / 11);
  const n2 = valueNoise(303, x / 3.3, z / 3.3);
  const n3 = valueNoise(307, x / 1.4, z / 1.4);
  out.r = G.gold[0];
  out.g = G.gold[1];
  out.b = G.gold[2];
  // the savannah: broad patches of deep gold and pale straw, a green flush in the hollows, speckle
  mix(out, G.pale, smoothstep(0.5, 0.78, valueNoise(309, x / 29, z / 29)) * 0.7);
  mix(out, G.deep, smoothstep(0.52, 0.74, n1) * 0.65);
  mix(out, G.green, (1 - smoothstep(0.28, 0.5, valueNoise(313, x / 21, z / 21))) * 0.55 * (1 - smoothstep(-0.6, 0.6, h - HIGHMARK.level)));
  mix(out, G.greenDeep, smoothstep(0.7, 0.85, n3) * 0.18);
  mix(out, G.earth, smoothstep(0.78, 0.9, n2) * 0.3);
  // D-046 / D-116: the Grange's fields, worked (the rows run north-south, a row every `plot.row` metres), each crop its own ground: the barley's earth between straw rows,
  // the young green in drills on bare earth, the stubble's pale straw with the drills showing, the mown hay's sward and windrows, the plough's ridge and furrow
  const fi = plotAt(HIGHMARK_FIELDS, x, z, plotHit);
  if (fi >= 0) {
    const p = HIGHMARK_FIELDS[fi]!;
    const m = plotHit.m;
    const rowK = 0.5 + 0.5 * Math.cos((x * Math.PI * 2) / p.row);
    if (p.crop === "barley") {
      mix(out, G.earth, m * 0.55);
      mix(out, G.pale, m * rowK * 0.45);
    } else if (p.crop === "green") {
      mix(out, G.earth, m * 0.7);
      mix(out, G.green, m * rowK * 0.8);
    } else if (p.crop === "stubble") {
      mix(out, G.pale, m * 0.72);
      mix(out, G.earth, m * (1 - rowK) * 0.3);
    } else if (p.crop === "hay") {
      mix(out, G.green, m * 0.3);
      mix(out, G.pale, m * rowK * 0.4);
    } else {
      mix(out, G.earth, m * 0.85);
      mix(out, G.earthDark, m * rowK * 0.55);
    }
  }
  // the river's bank and bed: mud at the edge, shingle under the water, reed-green on the south bank
  const rz = HIGHMARK.river.z;
  const nearRiver = smoothstep(rz - HIGHMARK.river.half - HIGHMARK.river.bank - 2, rz - HIGHMARK.river.half - 1, z);
  mix(out, G.mud, nearRiver * 0.55);
  mix(out, G.reed, nearRiver * smoothstep(0.55, 0.8, n2) * 0.5);
  mix(out, G.shingle, Math.min(1, water * 1.6) * 0.85);
  // the hill: each terrace has its own floor
  const dx = x - C.x, dz = z - C.z;
  const r = Math.hypot(dx, dz);
  if (r < R[0]! + RUN) {
    const j = tierOf(x, z);
    const check = (Math.floor(dx / 2) + Math.floor(dz / 2)) & 1;
    if (j === 1) {
      mix(out, G.earth, 0.8);
      mix(out, G.pale, (0.5 + 0.5 * Math.sin(r * 2.2)) * 0.5);   // stubble in rows that follow the terrace
    } else if (j === 2) {
      mix(out, G.road, 0.95);
      mix(out, G.shade, check * 0.28);
    } else if (j === 3) {
      mix(out, G.green, 0.8);
      mix(out, G.greenDeep, smoothstep(0.55, 0.8, n2) * 0.4);
      mix(out, G.road, smoothstep(0.7, 0.9, n3) * 0.15);
    } else if (j === 4) {
      mix(out, G.chalk, 0.95);
      mix(out, G.shade, check * 0.35);
    } else if (j === 5) {
      mix(out, G.chalk, 0.98);
      mix(out, G.shade, ((Math.floor(dx * 0.7) + Math.floor(dz * 0.7)) & 1) * 0.22);
      // the sun medallion of the court: a disc of dark chalk-gold under the heraldry (the geometry draws its rays)
      mix(out, G.pale, (1 - smoothstep(4.4, 5.2, Math.hypot(x - HIGHMARK_ANCHORS.capital.court.x, z - HIGHMARK_ANCHORS.capital.court.z) - 0.2)) * 0.7);
    }
  }
  // the carriageway, with two rut lines
  const road = highmarkRoadness(x, z);
  mix(out, G.road, road * 0.9);
  mix(out, G.rut, road * smoothstep(0.55, 0.78, n3) * (1 - smoothstep(0.6, 0.95, road)) * 0.5);
  // a riser is stone: steep means chalk, and darker the steeper it is
  mix(out, G.shade, smoothstep(0.5, 1.2, slope) * 0.9);
  mix(out, G.dark, smoothstep(1.4, 3.2, slope) * 0.45);
  const j = 0.95 + n2 * 0.08 + (n3 - 0.5) * 0.04;
  out.r = Math.min(1, out.r * j);
  out.g = Math.min(1, out.g * j);
  out.b = Math.min(1, out.b * j);
  return out;
}

/** The plain beyond the terrain mesh stands at the grass level. The mesh eases to it at its rim, the skirt lies on it. */
export const skirtY = (): number => HIGHMARK.level;

const EDGE = HIGHMARK_ANCHORS.bounds + 24;
/** Half the side of the terrain mesh. */
export const GROUND_HALF = HIGHMARK_ANCHORS.bounds + 30;

/** The height as drawn: exactly the simulated height inside the bounds, easing to the skirt beyond them (nobody can stand out there). */
export function visualY(h: number, x: number, z: number): number {
  const k = smoothstep(HIGHMARK_ANCHORS.bounds, EDGE, Math.hypot(x, z));
  return h + (HIGHMARK.level - h) * k;
}

export function buildHighmarkGround(terrain: Terrain, segments: number): BufferGeometry {
  const geo = new PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as BufferAttribute;
  const colours = new Float32Array(pos.count * 3);
  const rgbv: Rgb = { r: 0, g: 0, b: 0 };
  const c = new Color();
  const e = 0.6;
  const wd = (terrain as Partial<HighmarkTerrain>).waterDepth;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrain.height(x, z);
    const slope = Math.hypot(terrain.height(x + e, z) - h, terrain.height(x, z + e) - h) / e;
    pos.setY(i, visualY(h, x, z));
    highmarkGroundColour(x, z, h, slope, rgbv, wd ? wd(x, z) : 0);
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

/** Flat ground from the terrain's rim out past the farthest hills, in the plain's gold (fog dissolves it). */
export function buildHighmarkSkirt(): BufferGeometry {
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
    pos.push(x, skirtY() - 0.02, z);
    nor.push(0, 1, 0);
    cc.set(P.grassGold);
    cc.lerp(new Color(P.grassGoldPale), 0.35 * smoothstep(-200, 200, z));
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
