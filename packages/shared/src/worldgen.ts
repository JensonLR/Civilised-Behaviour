import { CAMP } from "./camp.ts";
import type { Obstacle, ObstacleTag } from "./collision.ts";
import { smoothstep } from "./math.ts";
import { PALETTE } from "./palette.ts";
import { hashFloat } from "./rng.ts";
import { valueNoise } from "./terrain.ts";
import { villageCobble, villageGarden, villageYard } from "./village.ts";
import { HILL, waterEdgeDistance, waterField, riverHalfWidth, RIVER, trailSample, type TrailSample, type WaterField } from "./landscape.ts";
import { orchardCover, plotAt } from "./fields.ts";
import { HOLLOWMERE_FIELDS, HOLLOWMERE_ORCHARD } from "./hollowmereFields.ts";

/**
 * Pure, deterministic world-dressing decisions shared by the renderer and its tests: what an obstacle is, which tree species
 * stands at a spot, and what colour the ground is. No three.js here so it stays testable in plain Node.
 */

/** What an obstacle is. Tagged obstacles say so; untagged ones follow the original contract (a circle >= 5 m tall is a trunk). */
export function classifyObstacle(o: Obstacle): ObstacleTag {
  if (o.tag) return o.tag;
  if (o.kind === "circle") return o.y1 - o.y0 >= 5 ? "tree" : "rock";
  return "wall";
}

export type TreeSpecies = "broadleaf" | "acacia" | "birch" | "pine";

/**
 * Groves are of one kind: the species follows a low-frequency noise field over the map (birch on the low ground, then broadleaf,
 * acacia and finally dark pine on the highest), with a sprinkling of a neighbouring kind (14%) so a grove is not a monoculture. Purely a
 * function of position, so every client and every test agrees.
 */
export function treeSpecies(x: number, z: number): TreeSpecies {
  const region = valueNoise(0x7ee, x / 38, z / 38);
  const stray = hashFloat(0x5eed, Math.round(x * 4), Math.round(z * 4)) < 0.14;
  const base: TreeSpecies = region < 0.3 ? "birch" : region < 0.56 ? "broadleaf" : region < 0.76 ? "acacia" : "pine";
  if (!stray) return base;
  return base === "birch" ? "broadleaf" : base === "broadleaf" ? "acacia" : base === "acacia" ? "broadleaf" : "acacia";
}

/**
 * The season by REGION: whole patches of the country have turned. `amount` 0..1 is how far (leaves go red, orange or gold together and
 * the grass dries), `hue` 0..1 picks the shade for the patch. One low-frequency field for everything (the arena's trees, shrubs and
 * grass, and the hill tree line beyond it), so an autumn hillside carries on into the far hills.
 */
export function autumnAt(x: number, z: number, out: { amount: number; hue: number } = { amount: 0, hue: 0 }): { amount: number; hue: number } {
  out.amount = smoothstep(0.6, 0.72, valueNoise(0xa07, x / 64, z / 64));
  out.hue = valueNoise(0xa08, x / 23, z / 23);
  return out;
}

// ---- painted ground -----------------------------------------------------------------------------------------------------------

// ---- ground detail: leaf litter under the canopy, crazed clay, the wet belt along the water ------------------------------------------------

export interface CanopyTree {
  x: number;
  z: number;
  r: number;
}

const CANOPY_CELL = 6;

/** A spatial hash of the trees, so the ground can ask "how much shade and fallen leaf is here?" in a few lookups. Pure; built once per world. */
export class CanopyIndex {
  private readonly cells = new Map<number, CanopyTree[]>();
  constructor(trees: readonly CanopyTree[]) {
    for (const t of trees) {
      const key = this.key(Math.floor(t.x / CANOPY_CELL), Math.floor(t.z / CANOPY_CELL));
      const list = this.cells.get(key);
      if (list) list.push(t);
      else this.cells.set(key, [t]);
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  /** Leaf litter 0..1: full under a crown, ragged out to ~4 m from the trunk (noise breaks the edge into drifts). */
  litter(x: number, z: number): number {
    const cx = Math.floor(x / CANOPY_CELL);
    const cz = Math.floor(z / CANOPY_CELL);
    let best = 0;
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const t of list) {
          const d = Math.hypot(x - t.x, z - t.z);
          const v = 1 - smoothstep(t.r + 0.8, t.r + 4.4, d);
          if (v > best) best = v;
        }
      }
    }
    if (best <= 0) return 0;
    const n = valueNoise(151, x / 1.9, z / 1.9);
    const v = best * (0.55 + 0.9 * n) - 0.1;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
}

/** Sun-baked clay 0..1: patches on the dry rises, away from water and paths (the shader draws the cracks in it). */
export function crackPatch(x: number, z: number, h: number): number {
  const n = crackNoise(x, z);
  return n > 0 ? n * smoothstep(-0.4, 1.4, h) : 0;
}

/** The clay-patch field before the dryness of the ground is asked (cheap; 0 nearly everywhere). */
export function crackNoise(x: number, z: number): number {
  const n = valueNoise(131, x / 21, z / 21) * 0.7 + valueNoise(133, x / 6.4, z / 6.4) * 0.3;
  return smoothstep(0.66, 0.74, n);
}

/** The wet belt along the water's edge, 0..1: dark, slick mud that the shore's foam and the animals' hooves have worked. */
export function mudBelt(x: number, z: number): number {
  const e = waterEdgeDistance(x, z);
  if (e > 2.4) return 0;
  return (1 - smoothstep(0.0, 2.4, e + (valueNoise(157, x / 2.2, z / 2.2) - 0.5) * 1.6)) * (e > -0.6 ? 1 : 0);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

type Triple = readonly [number, number, number];
const rgb = (n: number): Triple => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const W = PALETTE.world;
const G = {
  grass: rgb(W.grass),
  deep: rgb(W.grassDeep),
  dry: rgb(W.dry),
  meadow: rgb(W.meadow),
  moss: rgb(W.moss),
  dirt: rgb(W.dirt),
  dirtDark: rgb(W.dirtDark),
  rock: rgb(W.rock),
  rockDark: rgb(W.rockDark),
  ash: rgb(PALETTE.camp.ash),
  ember: rgb(PALETTE.camp.ember),
  worn: rgb(W.trailWorn),
  dust: rgb(W.dust),
  rut: rgb(W.rut),
  trampled: rgb(W.trampled),
  mud: rgb(W.mud),
  sand: rgb(W.sand),
  pebble: rgb(W.pebble),
  pave: rgb(W.ruinPale),
  paveShade: rgb(W.ruinShadow),
  cobble: rgb(W.vlCobble),
  cobbleDark: rgb(W.vlCobbleDark),
  soil: rgb(W.vlSoil),
  litter: rgb(W.litter),
  litterRed: rgb(W.litterRed),
  crack: rgb(W.crackClay),
  peb: rgb(W.pebble),
  hay: rgb(W.vlHay),
  leafy: rgb(W.vlLeafy),
};
const plotScratch = { m: 0 };

function mix(out: Rgb, c: Triple, t: number): void {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  out.r += (c[0] - out.r) * k;
  out.g += (c[1] - out.g) * k;
  out.b += (c[2] - out.b) * k;
}

const tsScratch: TrailSample = { wear: 0, shoulder: 0, rut: 0 };
const wfScratch: WaterField = { q: 0, s: 0, pond: false };

/**
 * How much ground cover (grass tufts, flowers) grows at a spot, 0..1: none on the paths, the hearth, in the water or on rocky
 * slopes, thin on trampled shoulders and round the camp, full in open meadow. Mirrors the painted ground so tufts never sit on bare earth.
 */
export function coverDensity(x: number, z: number, slope: number): number {
  const n2 = valueNoise(23, x / 3.3, z / 3.3);
  const camp = 1 - smoothstep(5, 12.5, Math.hypot(x, z) + (n2 - 0.5) * 4);
  const t = trailSample(x, z, tsScratch);
  const hearth = 1 - smoothstep(0.9, 2.2, Math.hypot(x - CAMP.fire.x, z - CAMP.fire.z));
  const water = 1 - smoothstep(-0.2, 0.9, waterEdgeDistance(x, z) + (n2 - 0.5) * 0.8);
  const village = villageYard(x, z) * 1.3 + villageCobble(x, z) * 2 + villageGarden(x, z) * 2;
  const d = 1 - t.wear * 1.25 - t.shoulder * 0.35 - camp * 0.35 - hearth - water - smoothstep(0.4, 0.8, slope) - village;
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/**
 * Flower meadows: noise-driven clusters. `density` is 0..1 (patches of a few metres, separated by bare grass) and `hue` is the index of
 * the patch's dominant bloom colour (0..4); the renderer strews a few strays of other colours through each patch.
 */
export function flowerPatch(x: number, z: number, out: { density: number; hue: number }): { density: number; hue: number } {
  const big = valueNoise(71, x / 16, z / 16);
  const small = valueNoise(73, x / 5.2, z / 5.2);
  const field = big * 0.65 + small * 0.55;
  out.density = smoothstep(0.62, 0.86, field) * (inMeadow(x, z) ? 1 : 0.45);
  out.hue = Math.floor(valueNoise(79, x / 21, z / 21) * 4.999);
  return out;
}

/** Reeds and cattails crowd the stream's banks; 0..1, peaking just outside the wet channel. */
export function reedDensity(x: number, z: number): number {
  const e = waterEdgeDistance(x, z);
  const n = valueNoise(89, x / 2.4, z / 2.4);
  return (smoothstep(-0.5, 0.2, e) * (1 - smoothstep(0.9, 2.6, e))) * (0.35 + n * 0.85);
}

/** True where the painted ground is a sunny meadow patch (flowers gather there). Same noise field as `groundColour`. */
export function inMeadow(x: number, z: number): boolean {
  return valueNoise(11, x / 11, z / 11) + (valueNoise(23, x / 3.3, z / 3.3) - 0.5) * 0.3 > 0.5;
}

/**
 * The colour of the ground at (x, z), sRGB 0..1 written into `out` (allocation-free). Painterly rather than physical: hard-edged
 * meadow patches over a soft two-tone base, deeper green in hollows, dry gold on rises, a worn-earth clearing round the camp with a
 * scorched hearth, a track leading out, and bare rock on slopes. Every input is a palette colour, so the result never leaves the
 * palette's chroma range (a convex mix of muted colours is muted).
 */
export function groundColour(x: number, z: number, h: number, slope: number, out: Rgb, litter = 0): Rgb {
  const n1 = valueNoise(11, x / 11, z / 11);
  const n2 = valueNoise(23, x / 3.3, z / 3.3);
  const n3 = valueNoise(37, x / 1.4, z / 1.4);

  out.r = G.grass[0];
  out.g = G.grass[1];
  out.b = G.grass[2];
  const hollow = smoothstep(0.2, -1.8, h);
  const rise = smoothstep(0.4, 3.2, h);
  mix(out, G.deep, hollow * 0.85);
  mix(out, G.dry, rise * 0.9);
  // Painted patches with hard edges (the illustrated look): sunny meadow, shaded clump, mossy dapple, dry speckle.
  const field = n1 + (n2 - 0.5) * 0.3;
  mix(out, G.meadow, smoothstep(0.5, 0.54, field) * (1 - rise) * 0.8);
  mix(out, G.deep, smoothstep(0.3, 0.26, field) * 0.55);
  mix(out, G.moss, smoothstep(0.24, 0.2, n2) * 0.4);
  mix(out, G.dry, smoothstep(0.84, 0.88, n3) * 0.3);
  // Macro variation: whole tracts of country run warm and sun-bleached or cool and lush (a slow drift over ~100 m), with a mid-scale mottle
  // of paler and deeper swathes; flower meadows lift the green where their blooms crowd.
  const macro = valueNoise(101, x / 105, z / 105);
  const swath = valueNoise(103, x / 34, z / 34);
  mix(out, G.dry, smoothstep(0.6, 0.92, macro) * 0.26 * (1 - hollow));
  mix(out, G.deep, smoothstep(0.4, 0.08, macro) * 0.3);
  mix(out, G.meadow, smoothstep(0.62, 0.86, valueNoise(71, x / 16, z / 16) * 0.65 + valueNoise(73, x / 5.2, z / 5.2) * 0.55) * 0.3 * (1 - rise));
  const k2 = 0.95 + swath * 0.1;
  out.r *= k2;
  out.g *= k2;
  out.b *= k2;

  // Worn ground: a soft trampled halo round the camp, then footpaths radiating to its features, the ford, the Observatory and the map edge
  // (shoulders of trampled dry grass, bare beaten earth, wheel ruts), and a worn meeting place at the spawn.
  const d = Math.hypot(x, z);
  const camp = 1 - smoothstep(4.5, 13.5, d + (n2 - 0.5) * 4);
  mix(out, G.trampled, camp * 0.42 * (1 - hollow * 0.5));
  mix(out, G.dry, camp * smoothstep(0.34, 0.3, n1) * 0.22 * (1 - hollow));
  // The clearing's rim: a ragged ring of flattened, dry grass where the beaten camp gives way to the meadow, with radial streaks where the
  // blades lie the way feet went. (The tufts thin out over the same ring: `coverDensity`.)
  const ang = Math.atan2(z, x);
  const rimK = smoothstep(11.3, 13.4, d + (n2 - 0.5) * 3.4) * (1 - smoothstep(14.6, 17.6, d + (n3 - 0.5) * 2.6));
  const streak = smoothstep(0.5, 0.62, valueNoise(47, ang * 16 + d * 0.05, d / 3.2));
  mix(out, G.trampled, rimK * (0.42 + 0.3 * streak) * (1 - hollow * 0.5));
  mix(out, G.dry, rimK * streak * 0.4 * (1 - hollow));
  mix(out, G.deep, rimK * (1 - streak) * smoothstep(0.62, 0.75, n3) * 0.22); // the odd tuft left standing
  const ts = trailSample(x, z, tsScratch);
  mix(out, G.trampled, ts.shoulder * 0.55);
  mix(out, G.dirt, ts.wear * 0.85 * (1 - hollow * 0.4));
  mix(out, G.worn, ts.wear * (smoothstep(0.62, 0.7, n3) * 0.4 + smoothstep(0.52, 0.56, n1) * 0.25));
  mix(out, G.dust, ts.wear * smoothstep(0.35, 0.75, n2) * 0.32);
  mix(out, G.rut, ts.rut * 0.85);
  mix(out, G.peb, ts.wear * smoothstep(0.5, 0.75, n3) * 0.4); // gravel worked up on the beaten middle
  // The village: trodden yards round every building, cobbles in the plaza and under the gate, tilled soil in the garden beds.
  const yard = villageYard(x, z);
  if (yard > 0) {
    mix(out, G.worn, yard * 0.6 * (1 - hollow * 0.3));
    mix(out, G.dirt, yard * smoothstep(0.35, 0.7, n2) * 0.3);
    mix(out, G.dust, yard * smoothstep(0.55, 0.8, n3) * 0.25);
  }
  const cob = villageCobble(x, z);
  if (cob > 0) {
    const stone = (Math.floor(x / 0.62) * 7 + Math.floor(z / 0.5) * 13) & 3;
    mix(out, G.cobble, cob * 0.9);
    mix(out, G.cobbleDark, cob * (stone === 0 ? 0.55 : stone === 1 ? 0.25 : 0) * smoothstep(0.25, 0.6, n3 + 0.2));
    mix(out, G.moss, cob * smoothstep(0.7, 0.92, n3) * 0.35);
  }
  mix(out, G.soil, villageGarden(x, z) * 0.92);
  // D-117: the village's fields, each crop its own ground (no rows in the paint: a vertex every metre and a half would alias them into bands; the rows are the
  // barley, the drills and the plough's ridges the scatter lays on it), and the orchard's mown sward
  const fi = plotAt(HOLLOWMERE_FIELDS, x, z, plotScratch);
  if (fi >= 0) {
    const m = plotScratch.m;
    const crop = HOLLOWMERE_FIELDS[fi]!.crop;
    if (crop === "barley") {
      mix(out, G.dirt, m * 0.45);
      mix(out, G.hay, m * 0.5);
    } else if (crop === "green") {
      mix(out, G.dirt, m * 0.6);
      mix(out, G.leafy, m * 0.3);
    } else if (crop === "stubble") {
      mix(out, G.hay, m * 0.62);
      mix(out, G.dry, m * smoothstep(0.4, 0.8, n2) * 0.25);
    } else if (crop === "hay") {
      mix(out, G.meadow, m * 0.4);
      mix(out, G.hay, m * (0.2 + smoothstep(0.45, 0.75, n2) * 0.2));
    } else {
      mix(out, G.soil, m * 0.82);
      mix(out, G.dirtDark, m * smoothstep(0.5, 0.8, n3) * 0.3);
    }
  }
  mix(out, G.meadow, orchardCover(HOLLOWMERE_ORCHARD, x, z) * 0.28);
  // River banks: wet mud at the water's edge, a sandy pebble apron beyond it, the meadow returns further out.
  const wf = waterField(x, z, wfScratch);
  if (wf.q < 2.7) {
    const w = wf.pond ? RIVER.pondRadius : riverHalfWidth(wf.s);
    const e = (wf.q - 1) * w; // metres from the channel edge (negative in the channel)
    mix(out, G.sand, (1 - smoothstep(0.2, 2.0, e + (n3 - 0.5) * 1.2)) * 0.8);
    mix(out, G.pebble, (1 - smoothstep(0.1, 0.9, e + (n2 - 0.5) * 0.9)) * smoothstep(0.55, 0.75, n3) * 0.7);
    mix(out, G.mud, (1 - smoothstep(-0.4, 0.5, e + (n3 - 0.5) * 0.5)) * 0.85);
  }
  // Sun-baked clay in patches on dry rises, wet mud along the water, and the litter of fallen leaves under every crown (autumn woods drop red ones).
  const crackK = crackPatch(x, z, h) * (1 - ts.wear) * (1 - smoothstep(0.3, 1.2, slope));
  mix(out, G.crack, crackK * 0.55);
  mix(out, G.dust, crackK * smoothstep(0.35, 0.7, n2) * 0.25);
  const mudK = mudBelt(x, z);
  mix(out, G.mud, mudK * 0.6);
  if (litter > 0) {
    const turned = autumnAt(x, z).amount;
    mix(out, G.litter, litter * 0.72 * (1 - turned * 0.6));
    mix(out, G.litterRed, litter * 0.62 * turned);
  }
  // The Observatory's plateau: worn flagstones (a chequer of two tones with mossy joints) that give way to turf at a ragged edge.
  const dh = Math.hypot(x - HILL.x, z - HILL.z);
  if (dh < 13) {
    const pave = 1 - smoothstep(8.4, 10.4, dh + (n2 - 0.5) * 2.6);
    const chequer = (Math.floor((x + 40) / 1.35) + Math.floor((z + 40) / 1.35)) & 1;
    mix(out, G.pave, pave * 0.82);
    mix(out, G.paveShade, pave * (chequer ? 0.34 : 0.08));
    mix(out, G.moss, pave * smoothstep(0.55, 0.78, n3) * 0.55);
    mix(out, G.dirt, pave * smoothstep(0.7, 0.9, n2) * 0.3);
  }
  // The hearth: scorched ash, with a warm ember-lit tint on the earth around it.
  const df = Math.hypot(x - CAMP.fire.x, z - CAMP.fire.z);
  mix(out, G.ember, (1 - smoothstep(0.5, 3.6, df)) * 0.16);
  mix(out, G.ash, 1 - smoothstep(0.7, 1.9, df + (n3 - 0.5) * 0.6));

  // Rocky slopes.
  mix(out, G.rock, smoothstep(0.26, 0.75, slope) * 0.85);
  mix(out, G.rockDark, smoothstep(0.6, 1.1, slope) * 0.35);

  // Tonal variation, soft (the toon ramp does the banding).
  const j = 0.93 + n2 * 0.09 + (n3 - 0.5) * 0.05;
  out.r = Math.min(1, out.r * j);
  out.g = Math.min(1, out.g * j);
  out.b = Math.min(1, out.b * j);
  return out;
}
