import { Rng, fieldThings, hash3, type FieldPlot } from "@cb/shared";
import type { Item, ScatterDetail } from "./scatter.ts";

/**
 * What a region's worked fields put on the ground (D-116, shared `fields.ts`), as plain data the region's view instances: the barley clumps in their rows, the stooks, haycocks
 * and scarecrows exactly where the world's obstacles are, and the plough's ridges and the young crop's drills in short lengths that each sit on the ground under them. One
 * function for every region with fields (Highmark's Grange, Hollowmere's strips), so the fields look the same wherever they are. Pure and deterministic; no three.js.
 */
export interface FieldScatter {
  barley: Item[];
  stooks: Item[];
  haycocks: Item[];
  scarecrows: Item[];
  furrows: Item[];
  drills: Item[];
}

export interface FieldScatterInput {
  plots: readonly FieldPlot[];
  /** Ground height where it is drawn. */
  h: (x: number, z: number) => number;
  /** Whether anything solid stands within `margin` of (x, z). */
  blocked: (x: number, z: number, margin: number) => boolean;
  /** Extra say over where a clump may stand (off the road, out of the water). */
  sow?: (x: number, z: number) => boolean;
  /** The first barley plot's own stream and sowing (Highmark's strike field keeps the one it always had). */
  barleySeed: number;
  /** Clump spacing along a row in each barley plot, by its index among the barley plots (the last value for any after). */
  barleyStep: readonly number[];
}

const h01 = (seed: number, a: number, b = 0): number => hash3(seed, Math.round(a * 100), Math.round(b * 100)) / 4294967296;
const item = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, cls = 0, v = 0, tiltX = 0, tiltZ = 0): Item => ({ x, y, z, yaw, sx, sy, sz, cls, v, tiltX, tiltZ });

export function planFieldScatter(i: FieldScatterInput, detail: ScatterDetail): FieldScatter {
  const out: FieldScatter = { barley: [], stooks: [], haycocks: [], scarecrows: [], furrows: [], drills: [] };
  const { plots, h, blocked } = i;
  // the barley, planted in north-south rows (thinned with the grass budget; none at all where the preset draws no grass), round any obstacle
  if (detail.grassTufts > 0) {
    for (const [fi, f] of plots.filter((q) => q.crop === "barley").entries()) {
      const step = (i.barleyStep[fi] ?? i.barleyStep[i.barleyStep.length - 1]!) / Math.min(1, Math.max(0.45, detail.grassTufts / 5000));
      const br = new Rng(i.barleySeed + fi * 0x101);
      for (let x = f.x0 + f.row / 2; x < f.x1; x += f.row) {
        for (let z = f.z0 + step / 2; z < f.z1; z += step) {
          const px = x + br.range(-0.1, 0.1), pz = z + br.range(-0.15, 0.15);
          if (blocked(px, pz, 0.35) || (i.sow && !i.sow(px, pz))) continue;
          const sc = 0.92 + br.next() * 0.22;
          out.barley.push(item(px, h(px, pz) - 0.02, pz, br.next() * 6.28, sc, sc * (0.95 + br.next() * 0.15), sc, 0, br.next()));
        }
      }
    }
  }
  // what stands in the fields, exactly where the world's obstacles are (the same `fieldThings`); full size, its own heading
  for (const t of plots.flatMap(fieldThings)) {
    const it = item(t.x, h(t.x, t.z) - 0.04, t.z, -t.yaw, 1, 1, 1, 0, h01(17, t.x, t.z));
    (t.kind === "stook" ? out.stooks : t.kind === "haycock" ? out.haycocks : out.scarecrows).push(it);
  }
  // the ridges of the plough and the drills of the young crop, a row every `plot.row` metres, laid in lengths of about 2.5 m that each sit on the ground under them
  for (const f of plots) {
    if (f.crop !== "fallow" && f.crop !== "green") continue;
    const list = f.crop === "fallow" ? out.furrows : out.drills;
    const n = Math.max(1, Math.round((f.z1 - f.z0) / 2.5));
    const len = (f.z1 - f.z0) / n;
    for (let x = f.x0 + f.row / 2; x < f.x1; x += f.row) {
      for (let j = 0; j < n; j++) {
        const z = f.z0 + len * (j + 0.5);
        // (a length is not laid through anything standing in the field: a scarecrow's post, a stone the plough went round)
        let clear = true;
        for (let t = -0.5; t <= 0.5 && clear; t += 0.25) if (blocked(x, z + t * len, 0.5) || (i.sow && !i.sow(x, z + t * len))) clear = false;
        if (!clear) continue;
        const ya = h(x, z - len / 2), yb = h(x, z + len / 2);
        // (tiltX turns the length about x: a rise toward +z is a negative turn)
        list.push(item(x, (ya + yb) / 2 - 0.03, z, 0, 1, 1, len + 0.08, 0, h01(19, x, z), -Math.atan2(yb - ya, len), 0));
      }
    }
  }
  return out;
}
