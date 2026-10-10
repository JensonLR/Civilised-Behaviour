import { smoothstep } from "./math.ts";
import { hashFloat } from "./rng.ts";

/**
 * THE FIELDS (D-116): worked land between a landing and what the party came for. The owner found the country "very sparse": the plain from Highmark's quay to its hill was
 * 130 m of grass, a few acacias and the milestones. A region now declares its plots (axis-aligned rectangles, a crop each, rows a set distance apart along z) and everything
 * follows from that one list: the ground's paint (the furrows and the rows), the planted clumps, the stooks on the stubble, the haycocks on the mown hay, a scarecrow in the
 * standing crop, where the grass and the scrub do not grow, and what the fire finds to burn (the barley, the stubble and the hay go up; a ploughed field is a firebreak).
 *
 * Generic and pure: the plots are the region's (`HIGHMARK_FIELDS`; Hollowmere's `HOLLOWMERE_FIELDS` and its orchard, D-117), the furniture is a function of the plot (and a hash of
 * its place, never a clock or `Math.random`).
 */

export type Crop = "barley" | "green" | "stubble" | "hay" | "fallow";

export interface FieldPlot {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Between rows (m); the rows run along z. */
  row: number;
  crop: Crop;
}

/** What each crop gives the fire (D-103): ripe barley, stubble and hay burn as well as anything; the young green barely; a ploughed field not at all. */
export const CROP_FUEL: Readonly<Record<Crop, number>> = { barley: 1, stubble: 1, hay: 1, green: 0.3, fallow: 0 };

/** How far a field's edge eases into the grass round it (m). */
export const FIELD_EDGE = 1.5;

/** 1 inside the plot, easing to 0 over `FIELD_EDGE` outside it. */
export function plotMask(p: FieldPlot, x: number, z: number): number {
  const out = Math.max(p.x0 - x, x - p.x1, p.z0 - z, z - p.z1, 0);
  return 1 - smoothstep(0, FIELD_EDGE, out);
}

/** The plot whose ground (x, z) is (the strongest, where two edges meet), or -1; its mask into `out.m`. Allocation-free. */
export function plotAt(plots: readonly FieldPlot[], x: number, z: number, out: { m: number }): number {
  let best = -1;
  out.m = 0;
  for (let i = 0; i < plots.length; i++) {
    const m = plotMask(plots[i]!, x, z);
    if (m > out.m) {
      out.m = m;
      best = i;
    }
  }
  return best;
}

const scratch = { m: 0 };

/** 0..1: how much (x, z) is field of any kind (the grass and the scrub keep out of it). */
export function fieldCover(plots: readonly FieldPlot[], x: number, z: number): number {
  plotAt(plots, x, z, scratch);
  return scratch.m;
}

/** What the crops at (x, z) give the fire, 0..1 (0 off the fields). */
export function fieldFuel(plots: readonly FieldPlot[], x: number, z: number): number {
  const i = plotAt(plots, x, z, scratch);
  return i < 0 ? 0 : scratch.m * CROP_FUEL[plots[i]!.crop];
}

/** The things standing in a field (collidable: what you see is what you bump into). */
export interface FieldThing {
  kind: "stook" | "haycock" | "scarecrow";
  x: number;
  z: number;
  /** Footprint radius and height (m), and the heading it was set down at (collision-convention yaw). */
  r: number;
  height: number;
  yaw: number;
}

/** A stook (sheaves leaning together to dry), a haycock (a mown field's hay built into a dome), a scarecrow (a cross of timber in a coat). */
export const FIELD_THING = {
  stook: { r: 0.5, height: 1.25, along: 6.2, across: 4.6, margin: 2 },
  haycock: { r: 1.35, height: 2.3, along: 8, across: 6, margin: 3.2 },
  scarecrow: { r: 0.14, height: 2.35 },
} as const;

/**
 * What stands in a plot: stooks in rows on the stubble, haycocks in a loose grid on the hay, and one scarecrow in the standing crop (the barley, the green) a little off its
 * middle, its arms across the rows. Each set down a hand off true by a hash of its place, so a field looks worked by people and not printed.
 */
export function fieldThings(p: FieldPlot): FieldThing[] {
  const out: FieldThing[] = [];
  const jit = (x: number, z: number, k: number): number => hashFloat(Math.round(x * 10), Math.round(z * 10), k, 0xf1e1d) - 0.5;
  const grid = (spec: { r: number; height: number; along: number; across: number; margin: number }, kind: "stook" | "haycock"): void => {
    const w = p.x1 - p.x0 - spec.margin * 2;
    const d = p.z1 - p.z0 - spec.margin * 2;
    const nx = Math.max(1, Math.floor(w / spec.across) + 1);
    const nz = Math.max(1, Math.floor(d / spec.along) + 1);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const bx = p.x0 + spec.margin + (nx === 1 ? w / 2 : (w * i) / (nx - 1));
        const bz = p.z0 + spec.margin + (nz === 1 ? d / 2 : (d * j) / (nz - 1)) + (i % 2) * spec.along * 0.35;
        if (bz > p.z1 - spec.margin) continue;
        const x = bx + jit(bx, bz, 1) * spec.across * 0.25;
        const z = bz + jit(bx, bz, 2) * spec.along * 0.2;
        out.push({ kind, x, z, r: spec.r, height: spec.height, yaw: jit(bx, bz, 3) * Math.PI * 2 });
      }
    }
  };
  if (p.crop === "stubble") grid(FIELD_THING.stook, "stook");
  else if (p.crop === "hay") grid(FIELD_THING.haycock, "haycock");
  else if (p.crop === "barley" || p.crop === "green") {
    const x = (p.x0 + p.x1) / 2 + (p.x1 - p.x0) * 0.18;
    const z = (p.z0 + p.z1) / 2 - (p.z1 - p.z0) * 0.12;
    // its arms across the rows (the rows run along z, so it faces along z)
    out.push({ kind: "scarecrow", x, z, r: FIELD_THING.scarecrow.r, height: FIELD_THING.scarecrow.height, yaw: Math.PI / 2 + jit(x, z, 4) * 0.4 });
  }
  return out;
}

// ---- D-117: the orchard -------------------------------------------------------------------------------------------------------------------

/** An orchard: fruit trees in columns `pitch` apart along x, each column half a pitch down from the last (the old quincunx), and a stand of hives in it. */
export interface Orchard {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  pitch: number;
  /** Skeps on the hive stand. */
  hives: number;
}

/** A fruit tree at scale 1: its trunk's collision radius, its height to the top of the crown, the crown's reach from the trunk (m). */
export const ORCHARD_TREE = { r: 0.2, height: 4.3, crown: 2.3 } as const;
/** The hive stand: a plank on two legs, the skeps along it `pitch` apart; its half-depth and its height to the top of a skep (m). */
export const HIVE_STAND = { hx: 0.32, pitch: 1.05, height: 1.12, plank: 0.42 } as const;

export interface OrchardPlan {
  /** Each tree's scale, 0.9..1.15 (a crown is never lower than a person's head: ORCHARD_TREE's crown starts 2.1 m up at scale 1). */
  trees: { x: number; z: number; s: number }[];
  /** Where one died and was cut down: its stump. */
  stumps: { x: number; z: number; r: number }[];
  /** The hive stand: its middle, the way its skeps' mouths face (collision-convention yaw), how many skeps. */
  stand: { x: number; z: number; yaw: number; n: number };
}

/**
 * What stands in an orchard: its trees, a stump where one died (about one in ten), and the hive stand in the west column's middle (where that tree would be), its
 * skeps' mouths turned east into the trees. Each tree a hand off its line and its own size by a hash of its place: an orchard someone planted, not one printed.
 */
export function orchardPlan(o: Orchard): OrchardPlan {
  const plan: OrchardPlan = { trees: [], stumps: [], stand: { x: 0, z: 0, yaw: 0, n: o.hives } };
  const jit = (x: number, z: number, k: number): number => hashFloat(Math.round(x * 10), Math.round(z * 10), k, 0x0c4a5d) - 0.5;
  const nx = Math.max(1, Math.floor((o.x1 - o.x0) / o.pitch));
  const nz = Math.max(1, Math.floor((o.z1 - o.z0) / o.pitch));
  const standRow = Math.floor((nz - 1) / 2);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const bx = o.x0 + o.pitch * (i + 0.5);
      const bz = o.z0 + o.pitch * (j + 0.5) + (i % 2) * o.pitch * 0.5;
      if (bz > o.z1 - o.pitch * 0.4) continue;
      if (i === 0 && j === standRow) {
        plan.stand = { x: bx, z: bz, yaw: 0, n: o.hives };
        continue;
      }
      const x = bx + jit(bx, bz, 1) * 0.5;
      const z = bz + jit(bx, bz, 2) * 0.5;
      if (jit(bx, bz, 3) < -0.4) plan.stumps.push({ x, z, r: 0.3 });
      else plan.trees.push({ x, z, s: 0.9 + (jit(bx, bz, 4) + 0.5) * 0.25 });
    }
  }
  return plan;
}

/** 0..1: how much (x, z) is the orchard's mown ground (easing out over a metre past its edge). */
export function orchardCover(o: Orchard, x: number, z: number): number {
  const out = Math.max(o.x0 - x, x - o.x1, o.z0 - z, z - o.z1, 0);
  return 1 - smoothstep(0, 1, out);
}
