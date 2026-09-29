import { CAMP } from "./camp.ts";
import type { Obstacle, ObstacleTag } from "./collision.ts";
import { smoothstep } from "./math.ts";
import { PALETTE } from "./palette.ts";
import { hashFloat } from "./rng.ts";
import { valueNoise } from "./terrain.ts";

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

export type TreeSpecies = "broadleaf" | "acacia";

/**
 * Groves are of one kind: the species follows a low-frequency noise field over the map, with a sprinkling of the other kind
 * (14%) so a grove is not a monoculture. Purely a function of position, so every client and every test agrees.
 */
export function treeSpecies(x: number, z: number): TreeSpecies {
  const region = valueNoise(0x7ee, x / 38, z / 38);
  const stray = hashFloat(0x5eed, Math.round(x * 4), Math.round(z * 4)) < 0.14;
  return (region < 0.55) !== stray ? "broadleaf" : "acacia";
}

// ---- painted ground -----------------------------------------------------------------------------------------------------------

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
};

function mix(out: Rgb, c: Triple, t: number): void {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  out.r += (c[0] - out.r) * k;
  out.g += (c[1] - out.g) * k;
  out.b += (c[2] - out.b) * k;
}

/** The worn track that leaves the camp past the signpost and wanders into the interior. */
const TRACK: readonly (readonly [number, number])[] = [
  [11, 0.6],
  [22, -3],
  [32, -12],
  [40, -26],
  [46, -44],
  [54, -60],
  [60, -80],
];

function trackDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < TRACK.length; i++) {
    const [ax, az] = TRACK[i]!;
    const [bx, bz] = TRACK[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/**
 * How much ground cover (grass tufts, flowers) grows at a spot, 0..1: none on the trampled clearing, the track, the hearth or rocky
 * slopes; full in open meadow. Mirrors the painted ground so tufts never sit on bare earth.
 */
export function coverDensity(x: number, z: number, slope: number): number {
  const n2 = valueNoise(23, x / 3.3, z / 3.3);
  const clearing = 1 - smoothstep(5.5, 13.8, Math.hypot(x, z) + (n2 - 0.5) * 4);
  const track = 1 - smoothstep(0.6, 1.9, trackDistance(x, z));
  const hearth = 1 - smoothstep(0.9, 2.2, Math.hypot(x - CAMP.fire.x, z - CAMP.fire.z));
  const d = 1 - clearing * 0.95 - track - hearth - smoothstep(0.4, 0.8, slope);
  return d < 0 ? 0 : d > 1 ? 1 : d;
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
export function groundColour(x: number, z: number, h: number, slope: number, out: Rgb): Rgb {
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

  // Trampled clearing round the camp, with a ragged edge.
  const d = Math.hypot(x, z);
  const clearing = 1 - smoothstep(5.5, 13.8, d + (n2 - 0.5) * 4);
  mix(out, G.dirt, clearing * 0.92);
  mix(out, G.dirtDark, clearing * (smoothstep(0.62, 0.7, n3) * 0.45 + smoothstep(0.52, 0.56, n1) * 0.35));
  mix(out, G.dry, clearing * smoothstep(0.34, 0.3, n1) * 0.4 * (1 - hollow));
  // A track that leaves the camp and fades into the grass.
  const tk = 1 - smoothstep(0.6, 1.9, trackDistance(x, z) + (n3 - 0.5) * 1.0);
  mix(out, G.dirt, tk * 0.85 * (1 - hollow * 0.4));
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
