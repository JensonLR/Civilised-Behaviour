import { HIGHMARK, HIGHMARK_ANCHORS, HIGHMARK_FIELDS, Rng, fieldCover, hash3, highmarkRoadDistance, type CollisionWorld, type Obstacle } from "./shared.ts";
import type { Item, ScatterDetail } from "../scatter.ts";
import { highmarkCover, visualY } from "./ground.ts";
import { planFieldScatter } from "../fieldScatter.ts";

/**
 * Where Highmark's plants and stones go, as plain data (no three.js: placement is unit-tested in Node): the acacia flats and the termite mounds are the world's own `tree` and `rock`
 * obstacles (what is drawn is what blocks); the shrubs, the grass tufts, the pebbles and the reeds on the river's bank are decoration on their own Rng streams, kept off the road,
 * the hill, the water and every obstacle. Every decision is a pure function of the world and fixed seeds, so every client agrees.
 */

export interface HighmarkScatter {
  acacia: Item[];
  /** Termite mounds (the world's `rock` obstacles). */
  mounds: Item[];
  bushes: Item[];
  grass: Item[];
  pebbles: Item[];
  reeds: Item[];
  /** D-046: the barley field's planted clumps, in rows (HIGHMARK_SITES.strike.field); D-116: every barley plot of the Grange's (HIGHMARK_FIELDS). */
  barley: Item[];
  /** D-116: what stands in the fields (the world's `hay` and `scarecrow` obstacles, from `fieldThings`): stooks on the stubble, haycocks on the hay, scarecrows in the crop. */
  stooks: Item[];
  haycocks: Item[];
  scarecrows: Item[];
  /** D-116: the plough's ridges on the fallow and the drills of the young green, in short lengths that follow the ground (`sz` is the length, `tiltX` the slope along it). */
  furrows: Item[];
  drills: Item[];
}

const h01 = (seed: number, a: number, b = 0): number => hash3(seed, Math.round(a * 100), Math.round(b * 100)) / 4294967296;
const item = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, cls = 0, v = 0, tiltX = 0, tiltZ = 0): Item => ({ x, y, z, yaw, sx, sy, sz, cls, v, tiltX, tiltZ });

export function planHighmarkScatter(world: CollisionWorld, detail: ScatterDetail): HighmarkScatter {
  const out: HighmarkScatter = { acacia: [], mounds: [], bushes: [], grass: [], pebbles: [], reeds: [], barley: [], stooks: [], haycocks: [], scarecrows: [], furrows: [], drills: [] };
  const h = (x: number, z: number): number => world.terrainHeight(x, z);
  const water = (x: number, z: number): number => (world.terrain as { waterDepth?: (x: number, z: number) => number }).waterDepth?.(x, z) ?? 0;
  const blocked = (x: number, z: number, margin: number): boolean => {
    let hit = false;
    world.forEachNear(x, z, (o: Obstacle) => {
      const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < (r + margin) ** 2) hit = true;
    });
    return hit;
  };
  const C = HIGHMARK.centre;
  const onHill = (x: number, z: number): boolean => Math.hypot(x - C.x, z - C.z) < HIGHMARK.radii[0]! + HIGHMARK.rampRun + 3;
  const free = (x: number, z: number, margin: number): boolean => !onHill(x, z) && water(x, z) === 0 && highmarkRoadDistance(x, z) > HIGHMARK.roadHalf + 1 && !blocked(x, z, margin) && Math.hypot(x, z) < HIGHMARK_ANCHORS.bounds + 8;
  const treeDensity = detail.treeDensity ?? 1;

  for (const o of world.obstacles) {
    if (o.kind !== "circle") continue;
    if (o.tag === "tree") {
      if (treeDensity < 1 && h01(31, o.x, o.z) >= treeDensity) continue;
      const y = h(o.x, o.z);
      const s = (o.r / 0.375) * (0.94 + h01(1, o.x, o.z) * 0.14);
      out.acacia.push(item(o.x, y, o.z, h01(3, o.x, o.z) * Math.PI * 2, s, s * (0.86 + h01(2, o.x, o.z) * 0.3), s, 0, h01(6, o.x, o.z), (h01(4, o.x, o.z) - 0.5) * 0.07, (h01(5, o.x, o.z) - 0.5) * 0.07));
    } else if (o.tag === "rock") {
      // a termite mound: a squat, wide, fluted cone (the boulder shape, flattened); its footprint is the obstacle's
      const y = h(o.x, o.z);
      const rh = o.y1 - y;
      out.mounds.push(item(o.x, y - 0.02, o.z, h01(3, o.x, o.z) * Math.PI * 2, o.r * 1.04, (rh / 1.2) * (0.92 + h01(4, o.x, o.z) * 0.16), o.r * 1.04, 0, h01(7, o.x, o.z)));
    }
  }
  // a few acacias far out, past the playable edge, so the plain does not end in a blank wall
  const far = new Rng(0xfa13);
  for (let g = 0; g < 6; g++) {
    const a = far.range(-0.2, Math.PI + 0.2);
    const cx = Math.cos(a) * far.range(155, 190);
    const cz = Math.sin(a) * far.range(70, 120) + 20;
    for (let i = 0; i < 6; i++) {
      const x = cx + far.range(-14, 14);
      const z = cz + far.range(-14, 14);
      const s = 1 + far.next() * 0.5;
      if (treeDensity < 1 && h01(32, x, z) >= treeDensity) continue;
      if (Math.hypot(x - C.x, z - C.z) < 90) continue;
      const it = item(x, visualY(h(x, z), x, z), z, far.range(0, 6.28), s, s * (0.9 + far.next() * 0.3), s, 0, far.next());
      // past the playable edge means past it, crown and all (one stood on the landing quay among its rails); after the draws, so no other tree moves
      if (Math.hypot(x, z) < world.boundsRadius + 2.6 * s) continue;
      out.acacia.push(it);
    }
  }
  // shrubs: thorn scrub in clumps on the flats
  const rng = new Rng(0xb05f);
  for (let i = 0, placed = 0; placed < detail.bushes && i < detail.bushes * 8; i++) {
    const x = rng.range(-145, 145);
    const z = rng.range(-120, 112);
    if (!free(x, z, 0.8) || fieldCover(HIGHMARK_FIELDS, x, z) > 0) continue;   // (no thorn scrub in the fields)
    const s = 0.8 + rng.next() * 0.9;
    out.bushes.push(item(x, h(x, z) - 0.05, z, rng.next() * 6.28, s * (0.9 + rng.next() * 0.3), s * (0.7 + rng.next() * 0.5), s, 0, rng.next()));
    placed++;
  }
  // pebbles round the mounds and along the bank
  const pr = new Rng(0x70c6);
  for (const m of out.mounds) {
    if (m.sx < 0.8 || out.pebbles.length > 120) continue;
    for (let i = 0, n = 2 + Math.floor(h01(11, m.x, m.z) * 4); i < n; i++) {
      const a = pr.range(0, Math.PI * 2);
      const d = m.sx * pr.range(1.3, 2.2);
      const x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      if (free(x, z, 0.15)) out.pebbles.push(item(x, h(x, z) - 0.03, z, pr.next() * 6.28, pr.range(0.1, 0.28), pr.range(0.07, 0.17), pr.range(0.1, 0.28), 0, pr.next()));
    }
  }
  // grass tufts: the long grass of the savannah, in patches
  const gr = new Rng(0x9a56);
  const e = 0.6;
  for (let tries = 0; out.grass.length < detail.grassTufts && tries < detail.grassTufts * 5; tries++) {
    const x = gr.range(-150, 150);
    const z = gr.range(-125, 118);
    if (Math.hypot(x, z) > HIGHMARK_ANCHORS.bounds + 2) continue;
    const hh = h(x, z);
    const slope = Math.hypot(h(x + e, z) - hh, h(x, z + e) - hh) / e;
    if (gr.next() > highmarkCover(x, z, hh, slope, water(x, z)) * 1.1) continue;
    if (blocked(x, z, 0.4)) continue;
    const s = 0.7 + gr.next() * 0.9;
    out.grass.push(item(x, hh - 0.03, z, gr.next() * 6.28, s * (0.9 + gr.next() * 0.3), s * (1.0 + gr.next() * 0.9), s * (0.9 + gr.next() * 0.3), gr.chance(0.35) ? 1 : 0, gr.next()));
  }
  // D-046 / D-116: the Grange's fields (`fieldScatter.ts`, shared with Hollowmere): the barley in its rows (the strike's field first, sown thick on the stream it always had; the
  // Grange's other barley a little thinner, which reads the same from the road and keeps to the budget), the stooks, haycocks and scarecrows, the plough's ridges and the drills
  const fields = planFieldScatter(
    { plots: HIGHMARK_FIELDS, h, blocked, sow: (x, z) => water(x, z) === 0 && highmarkRoadDistance(x, z) >= HIGHMARK.roadHalf + 1, barleySeed: 0xba41, barleyStep: [0.55, 0.75] },
    detail,
  );
  Object.assign(out, fields);
  // reeds on the river's banks (and the water's edge beside the quay)
  const rr = new Rng(0x5e3d);
  const rz = HIGHMARK.river.z;
  const nReeds = Math.round(150 * detail.clutter);
  for (let i = 0, n = 0; n < nReeds && i < nReeds * 10; i++) {
    const x = rr.range(-148, 148);
    const z = rz - HIGHMARK.river.half - rr.range(-3.5, 2.5) - 1;
    const d = water(x, z);
    if (d > 0.5 || d < 0.0 || Math.hypot(x, z) > HIGHMARK_ANCHORS.bounds || blocked(x, z, 0.3)) continue;
    if (Math.abs(x) < 4) continue;   // the quay's own gap
    const s = 0.8 + rr.next() * 0.8;
    out.reeds.push(item(x, h(x, z) - 0.02, z, rr.next() * 6.28, s, s * (0.9 + rr.next() * 0.6), s, 0, rr.next()));
    n++;
  }
  return out;
}
