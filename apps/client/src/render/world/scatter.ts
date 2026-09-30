import {
  RIVER,
  Rng,
  autumnAt,
  WELL,
  getFordStones,
  classifyObstacle,
  coverDensity,
  flowerPatch,
  hash3,
  inCampFootprint,
  inMeadow,
  nearTrail,
  reedDensity,
  riverCentre,
  riverHalfWidth,
  treeSpecies,
  waterEdgeDistance,
  type CollisionWorld,
  type Obstacle,
} from "@cb/shared";
import { TREE_BASE_RADIUS } from "./flora.ts";
import { visualHeight } from "./terrain.ts";

/**
 * Where everything scenic goes, as plain data: no three.js here, so placement is unit-tested in Node (finite, deterministic, off the
 * footpaths and out of the water, clear of every obstacle). `WorldView` turns each list into one InstancedMesh. Every decision is a
 * pure function of the arena (its obstacles and terrain) and fixed seeds, so all clients and the server's keep-out agree.
 */

export interface Item {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  /** A small class number the renderer maps to a colour (bloom hue, grass tint, ...). */
  cls: number;
  /** A random 0..1 for per-instance colour variation. */
  v: number;
  tiltX?: number;
  tiltZ?: number;
}

export interface ScatterDetail {
  grassTufts: number;
  flowers: number;
  bushes: number;
  /** Multiplier on ferns, mushrooms and reeds. */
  clutter: number;
}

export interface ScatterPlan {
  broadleaf: Item[];
  acacia: Item[];
  birch: Item[];
  pine: Item[];
  snag: Item[];
  /** Lily pads on the pond and the slow stretches of the stream. */
  lilies: Item[];
  bushes: Item[];
  berries: Item[];
  rocks: Item[];
  slabs: Item[];
  pebbles: Item[];
  stumps: Item[];
  logs: Item[];
  grass: Item[];
  daisies: Item[];
  cups: Item[];
  ferns: Item[];
  mushrooms: Item[];
  reeds: Item[];
  /** Flat stepping stones: across the ford (`cls` 1: set into the water) and round the well and along its path (`cls` 0). */
  flagstones: Item[];
  /** Flower positions the butterflies circle. */
  butterflies: { x: number; y: number; z: number }[];
}

/** Number of bloom hues (index into the renderer's palette list). */
export const BLOOM_HUES = 5;
/** Grass tint classes. */
export const GRASS_NORMAL = 0;
export const GRASS_DRY = 1;
export const GRASS_MEADOW = 2;

const h01 = (seed: number, a: number, b = 0): number => hash3(seed, Math.round(a * 100), Math.round(b * 100)) / 4294967296;

export function emptyPlan(): ScatterPlan {
  return { broadleaf: [], acacia: [], birch: [], pine: [], snag: [], lilies: [], bushes: [], berries: [], rocks: [], slabs: [], pebbles: [], stumps: [], logs: [], grass: [], daisies: [], cups: [], ferns: [], mushrooms: [], reeds: [], flagstones: [], butterflies: [] };
}

const item = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, cls = 0, v = 0, tiltX = 0, tiltZ = 0): Item => ({ x, y, z, yaw, sx, sy, sz, cls, v, tiltX, tiltZ });

type TreeKind = "broadleaf" | "acacia" | "birch" | "pine";

export function planScatter(world: CollisionWorld, detail: ScatterDetail): ScatterPlan {
  const plan = emptyPlan();
  const h = (x: number, z: number): number => world.terrainHeight(x, z);
  const blocked = (x: number, z: number, margin: number): boolean => {
    let hit = false;
    world.forEachNear(x, z, (o: Obstacle) => {
      const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < (r + margin) ** 2) hit = true;
    });
    return hit || inCampFootprint(x, z, margin);
  };
  /** Free ground for a plant: no obstacle, no bare path, not in the water. */
  const freeGround = (x: number, z: number, margin: number): boolean => !blocked(x, z, margin) && !nearTrail(x, z, 0.25) && waterEdgeDistance(x, z) > 0.25;
  const rng = new Rng(0xb05e);
  const trees: { x: number; z: number; r: number; kind: TreeKind }[] = [];

  // ---- trees, snags and the shrubs round them ---------------------------------------------------------------------------------
  const pushBush = (x: number, z: number): void => {
    if (!freeGround(x, z, 0.6)) return;
    const s = 0.8 + rng.next() * 0.9;
    const it = item(x, h(x, z) - 0.05, z, rng.next() * 6.28, s * (0.9 + rng.next() * 0.3), s * (0.7 + rng.next() * 0.5), s, 0, rng.next());
    (rng.next() < 0.28 ? plan.berries : plan.bushes).push(it);
  };
  for (const o of world.obstacles) {
    const tag = classifyObstacle(o);
    if (o.kind !== "circle" || (tag !== "tree" && tag !== "snag")) continue;
    const kind = tag === "snag" ? "snag" : treeSpecies(o.x, o.z);
    const y = h(o.x, o.z);
    const s = (o.r / TREE_BASE_RADIUS) * (0.94 + h01(1, o.x, o.z) * 0.14);
    const tall = kind === "snag" ? ((o.y1 - y) / 5.4) * (0.95 + h01(2, o.x, o.z) * 0.1) : s * (0.86 + h01(2, o.x, o.z) * 0.3);
    const sw = kind === "snag" ? Math.max(o.r / 0.28, 0.7) : s;
    plan[kind].push(item(o.x, y, o.z, h01(3, o.x, o.z) * Math.PI * 2, sw, tall, sw, 0, h01(6, o.x, o.z), (h01(4, o.x, o.z) - 0.5) * 0.07, (h01(5, o.x, o.z) - 0.5) * 0.07));
    if (kind !== "snag") trees.push({ x: o.x, z: o.z, r: o.r, kind });
    if (kind !== "snag" && detail.bushes > 0 && h01(9, o.x, o.z) < 0.55) {
      const a = h01(10, o.x, o.z) * Math.PI * 2;
      const d = o.r + 1.4 + h01(11, o.x, o.z) * 1.6;
      pushBush(o.x + Math.cos(a) * d, o.z + Math.sin(a) * d);
    }
  }
  // Distant trees beyond the playable edge (no collision, nobody can walk there): they stop the map ending in a blank meadow.
  const far = new Rng(0xfa12);
  for (let g = 0; g < 7; g++) {
    const a = far.range(0, Math.PI * 2);
    const cx = Math.cos(a) * far.range(100, 130);
    const cz = Math.sin(a) * far.range(100, 130);
    for (let i = 0; i < 9; i++) {
      const t = far.range(0, Math.PI * 2);
      const d = 12 * Math.sqrt(far.next());
      const x = cx + Math.cos(t) * d;
      const z = cz + Math.sin(t) * d;
      const kind = treeSpecies(x, z);
      const s = 0.9 + far.next() * 0.55;
      plan[kind].push(item(x, visualHeight(h(x, z), x, z), z, far.range(0, 6.28), s, s * (0.9 + far.next() * 0.3), s, 0, far.next()));
    }
  }
  // lone shrubs in the open
  for (let i = 0, placed = 0; placed < detail.bushes * 0.5 && i < detail.bushes * 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = 16 + 72 * Math.sqrt(rng.next());
    const before = plan.bushes.length + plan.berries.length;
    pushBush(Math.cos(a) * d, Math.sin(a) * d);
    if (plan.bushes.length + plan.berries.length > before) placed++;
  }
  // the bush budget covers both kinds
  const bushCap = detail.bushes;
  const berryCap = Math.round(bushCap * 0.28);
  plan.bushes.length = Math.min(plan.bushes.length, Math.max(0, bushCap - Math.min(plan.berries.length, berryCap)));
  plan.berries.length = Math.min(plan.berries.length, berryCap);

  // ---- rocks, slabs, pebbles, timber --------------------------------------------------------------------------------------------
  const rr = new Rng(0x70c5);
  const pebble = (x: number, z: number, s: number): void => {
    plan.pebbles.push(item(x, h(x, z) - s * 0.15, z, rr.next() * 6.28, s * (0.9 + rr.next() * 0.5), s * (0.6 + rr.next() * 0.4), s * (0.9 + rr.next() * 0.4), 0, rr.next()));
  };
  for (const o of world.obstacles) {
    const tag = classifyObstacle(o);
    if (o.kind === "circle" && tag === "rock") {
      const y = h(o.x, o.z);
      const rh = o.y1 - y;
      if (o.r >= 1.05 && h01(12, o.x, o.z) < 0.34) {
        // a leaning slab of layered stone: same footprint, taller and thinner
        const k = o.r / 0.95;
        plan.slabs.push(item(o.x, y - 0.03, o.z, h01(3, o.x, o.z) * Math.PI * 2, k, (rh / 1.2) * (0.92 + h01(4, o.x, o.z) * 0.16), k, 0, h01(7, o.x, o.z)));
      } else {
        const sx = o.r * (1.0 + (h01(1, o.x, o.z) - 0.5) * 0.24);
        const sz = o.r * (1.0 + (h01(2, o.x, o.z) - 0.5) * 0.24);
        plan.rocks.push(item(o.x, y - 0.02, o.z, h01(3, o.x, o.z) * Math.PI * 2, sx * 1.04, (rh / 1.2) * (0.92 + h01(4, o.x, o.z) * 0.16), sz * 1.04, 0, h01(7, o.x, o.z), (h01(5, o.x, o.z) - 0.5) * 0.12, (h01(6, o.x, o.z) - 0.5) * 0.12));
      }
      if (o.r > 0.7 && h01(10, o.x, o.z) < 0.7) {
        const n = 3 + Math.floor(h01(11, o.x, o.z) * 5);
        for (let i = 0; i < n; i++) {
          const a = rr.range(0, Math.PI * 2);
          const d = o.r * rr.range(1.25, 2.3);
          const px = o.x + Math.cos(a) * d;
          const pz = o.z + Math.sin(a) * d;
          if (!blocked(px, pz, 0.15)) pebble(px, pz, rr.range(0.1, 0.3));
        }
      }
    } else if (o.kind === "circle" && tag === "stump") {
      const y = h(o.x, o.z);
      plan.stumps.push(item(o.x, y - 0.02, o.z, h01(3, o.x, o.z) * Math.PI * 2, o.r / 0.86, o.y1 - y, o.r / 0.86, 0, h01(7, o.x, o.z)));
    } else if (o.kind === "box" && tag === "log") {
      const y = h(o.x, o.z);
      const s = o.hz / 0.46;
      // the visual log lies along local +x with three.js yaw = -collision yaw
      plan.logs.push(item(o.x, y - 0.05, o.z, -o.yaw, o.hx, s, s, 0, h01(7, o.x, o.z)));
    }
  }
  for (let i = 0; i < 40; i++) {
    const a = rr.range(0, Math.PI * 2);
    const d = rr.range(9, 26);
    const px = Math.cos(a) * d;
    const pz = Math.sin(a) * d;
    if (!blocked(px, pz, 0.3)) pebble(px, pz, rr.range(0.07, 0.17));
  }
  // gravel along the stream banks
  const cpt = { x: 0, z: 0 };
  const cpt2 = { x: 0, z: 0 };
  for (let i = 0; i < 70; i++) {
    const s = rr.range(0, RIVER.length);
    riverCentre(s, cpt);
    const hw = riverHalfWidth(s);
    const side = rr.chance(0.5) ? 1 : -1;
    const off = (hw + rr.range(-0.5, 1.5)) * side;
    riverCentre(s + 0.5, cpt2);
    const nx = -(cpt2.z - cpt.z);
    const nz = cpt2.x - cpt.x;
    const nl = Math.hypot(nx, nz) || 1;
    const px = cpt.x + (nx / nl) * off;
    const pz = cpt.z + (nz / nl) * off;
    if (!blocked(px, pz, 0.2)) pebble(px, pz, rr.range(0.06, 0.2));
  }

  // ---- grass and flower meadows ------------------------------------------------------------------------------------------------
  const gr = new Rng(0x9a55);
  const e = 0.6;
  const slopeAt = (x: number, z: number, hh: number): number => Math.hypot(h(x + e, z) - hh, h(x, z + e) - hh) / e;
  for (let tries = 0; plan.grass.length < detail.grassTufts && tries < detail.grassTufts * 4; tries++) {
    const a = gr.range(0, Math.PI * 2);
    const d = 90 * Math.pow(gr.next(), 1.2);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const hh = h(x, z);
    if (gr.next() > coverDensity(x, z, slopeAt(x, z, hh))) continue;
    if (blocked(x, z, 0.35) || nearTrail(x, z, -0.05)) continue; // (a faded far path still has no grass on its bare middle)
    const s = 0.6 + gr.next() * 0.6;
    const cls = inMeadow(x, z) ? GRASS_MEADOW : hh > 1.4 && gr.chance(0.7) ? GRASS_DRY : gr.chance(0.12) ? GRASS_DRY : autumnAt(x, z).amount > 0.5 && h01(50, x, z) < 0.65 ? GRASS_DRY : GRASS_NORMAL; // (a turned hillside dries its grass too)
    plan.grass.push(item(x, hh - 0.03, z, gr.next() * 6.28, s * (0.9 + gr.next() * 0.3), s * (0.8 + gr.next() * 0.6), s * (0.9 + gr.next() * 0.3), cls, gr.next()));
  }
  const fr = new Rng(0xf10e);
  const fp = { density: 0, hue: 0 };
  const total = () => plan.daisies.length + plan.cups.length;
  for (let tries = 0; total() < detail.flowers && tries < detail.flowers * 14; tries++) {
    const a = fr.range(0, Math.PI * 2);
    const d = 88 * Math.pow(fr.next(), 1.1);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    flowerPatch(cx, cz, fp);
    if (fp.density < 0.3 || fr.next() > fp.density) continue;
    const dominant = fp.hue;
    const n = 3 + Math.floor(fr.next() * 5);
    for (let k = 0; k < n && total() < detail.flowers; k++) {
      const t = fr.range(0, Math.PI * 2);
      const rad = 0.9 * Math.sqrt(fr.next());
      const x = cx + Math.cos(t) * rad;
      const z = cz + Math.sin(t) * rad;
      const hh = h(x, z);
      if (coverDensity(x, z, slopeAt(x, z, hh)) < 0.55 || blocked(x, z, 0.3)) continue;
      const hue = fr.next() < 0.78 ? dominant : Math.floor(fr.next() * BLOOM_HUES);
      const s = 0.8 + fr.next() * 0.8;
      const it = item(x, hh - 0.02, z, fr.next() * 6.28, s, s, s, hue, fr.next());
      (fr.next() < 0.6 ? plan.daisies : plan.cups).push(it);
    }
  }
  // butterflies circle blooms spread across the meadows (at least ~14 m apart)
  const blooms = [...plan.daisies, ...plan.cups];
  for (const b of blooms) {
    if (plan.butterflies.length >= 16) break;
    if (Math.hypot(b.x, b.z) < 10) continue;
    if (plan.butterflies.every((p) => (p.x - b.x) ** 2 + (p.z - b.z) ** 2 > 14 * 14)) plan.butterflies.push({ x: b.x, y: b.y, z: b.z });
  }

  // ---- forest floor: ferns, mushroom rings; stream banks: reeds ---------------------------------------------------------------
  const cl = detail.clutter;
  const cr = new Rng(0xfe27);
  const fernCap = Math.round(110 * cl);
  for (const t of trees) {
    if (plan.ferns.length >= fernCap) break;
    if (h01(20, t.x, t.z) > 0.6) continue;
    const n = 1 + Math.floor(h01(21, t.x, t.z) * 3);
    for (let i = 0; i < n; i++) {
      const a = cr.range(0, Math.PI * 2);
      const d = t.r + cr.range(0.5, 2.4);
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      if (!freeGround(x, z, 0.3)) continue;
      const s = 0.8 + cr.next() * 0.7;
      plan.ferns.push(item(x, h(x, z) - 0.02, z, cr.next() * 6.28, s, s * (0.8 + cr.next() * 0.4), s, 0, cr.next()));
    }
  }
  // ferns also crowd the shaded stream banks
  for (let i = 0; i < 60 * cl; i++) {
    const s = cr.range(0, RIVER.length);
    riverCentre(s, cpt);
    const a = cr.range(0, Math.PI * 2);
    const d = riverHalfWidth(s) + cr.range(1.2, 3.4);
    const x = cpt.x + Math.cos(a) * d;
    const z = cpt.z + Math.sin(a) * d;
    if (!freeGround(x, z, 0.3) || waterEdgeDistance(x, z) < 0.9) continue;
    const sc = 0.8 + cr.next() * 0.6;
    plan.ferns.push(item(x, h(x, z) - 0.02, z, cr.next() * 6.28, sc, sc, sc, 0, cr.next()));
  }
  // toadstool rings under the broadleaf groves, and single caps beside timber
  const ringCap = Math.max(1, Math.round(6 * cl));
  let rings = 0;
  for (const t of trees) {
    if (rings >= ringCap) break;
    if (t.kind !== "broadleaf" || h01(22, t.x, t.z) > 0.22) continue;
    const a0 = h01(23, t.x, t.z) * Math.PI * 2;
    const d0 = t.r + 1.8 + h01(24, t.x, t.z) * 1.4;
    const cx = t.x + Math.cos(a0) * d0;
    const cz = t.z + Math.sin(a0) * d0;
    if (!freeGround(cx, cz, 1.0)) continue;
    const n = 8 + Math.floor(h01(25, t.x, t.z) * 4);
    const rad = 0.7 + h01(26, t.x, t.z) * 0.35;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + cr.range(-0.12, 0.12);
      const x = cx + Math.cos(a) * rad * cr.range(0.92, 1.08);
      const z = cz + Math.sin(a) * rad * cr.range(0.92, 1.08);
      if (blocked(x, z, 0.1)) continue;
      const s = cr.range(0.17, 0.32);
      plan.mushrooms.push(item(x, h(x, z) - 0.02, z, cr.next() * 6.28, s, s * cr.range(0.85, 1.3), s, 0, cr.next()));
    }
    rings++;
  }
  for (const w of [...plan.stumps, ...plan.logs]) {
    if (plan.mushrooms.length >= 140 * Math.max(cl, 0.4)) break;
    const n = 2 + Math.floor(h01(27, w.x, w.z) * 3);
    for (let i = 0; i < n; i++) {
      const a = cr.range(0, Math.PI * 2);
      const d = Math.max(w.sx, w.sz) * 0.9 + cr.range(0.2, 0.7);
      const x = w.x + Math.cos(a) * d;
      const z = w.z + Math.sin(a) * d;
      if (blocked(x, z, 0.1) || nearTrail(x, z, 0.2)) continue;
      const s = cr.range(0.16, 0.28);
      plan.mushrooms.push(item(x, h(x, z) - 0.02, z, cr.next() * 6.28, s, s * cr.range(0.85, 1.3), s, 0, cr.next()));
    }
  }
  // reeds and cattails where the ground is wet
  const reedCap = Math.round(240 * cl);
  for (let tries = 0; plan.reeds.length < reedCap && tries < reedCap * 8; tries++) {
    const pond = cr.next() < 0.3;
    let x: number;
    let z: number;
    if (pond) {
      const a = cr.range(0, Math.PI * 2);
      const d = RIVER.pondRadius + cr.range(-1.2, 1.4);
      x = RIVER.b.x + Math.cos(a) * d;
      z = RIVER.b.z + Math.sin(a) * d;
    } else {
      const s = cr.range(0, RIVER.length);
      riverCentre(s, cpt);
      const a = cr.range(0, Math.PI * 2);
      const d = riverHalfWidth(s) * cr.range(0.6, 1.5);
      x = cpt.x + Math.cos(a) * d;
      z = cpt.z + Math.sin(a) * d;
    }
    if (cr.next() > reedDensity(x, z)) continue;
    if (blocked(x, z, 0.2)) continue;
    const s = 0.8 + cr.next() * 0.7;
    plan.reeds.push(item(x, h(x, z) - 0.03, z, cr.next() * 6.28, s, s * cr.range(0.85, 1.3), s, 0, cr.next()));
  }

  // ---- lily pads on the still water ---------------------------------------------------------------------------------------------------
  const lr = new Rng(0x1117);
  const lilyCap = Math.round(46 * detail.clutter);
  const lt0 = world.terrain as { waterDepth?: (x: number, z: number) => number };
  for (let tries = 0; plan.lilies.length < lilyCap && tries < lilyCap * 40; tries++) {
    // mostly in the pond, some in the slower stretch of the stream just above it
    const pond = lr.next() < 0.72;
    let x: number;
    let z: number;
    if (pond) {
      const a = lr.range(0, Math.PI * 2);
      const d = RIVER.pondRadius * Math.sqrt(lr.next()) * 0.93;
      x = RIVER.b.x + Math.cos(a) * d;
      z = RIVER.b.z + Math.sin(a) * d;
    } else {
      const s = lr.range(RIVER.length * 0.55, RIVER.length);
      riverCentre(s, cpt);
      const a = lr.range(0, Math.PI * 2);
      const d = riverHalfWidth(s) * 0.6 * Math.sqrt(lr.next());
      x = cpt.x + Math.cos(a) * d;
      z = cpt.z + Math.sin(a) * d;
    }
    const depth = lt0.waterDepth?.(x, z) ?? 0;
    if (depth < 0.2 || waterEdgeDistance(x, z) > -0.6) continue;
    // clumps: a pad gathers others near it
    const clump = h01(60, Math.floor(x / 2.4), Math.floor(z / 2.4));
    if (lr.next() > 0.25 + clump * 0.75) continue;
    if (plan.lilies.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 0.36)) continue;
    const r = 0.26 + lr.next() * 0.22;
    plan.lilies.push(item(x, h(x, z) + depth + 0.035, z, lr.next() * 6.28, r, 1, r, 0, lr.next()));
  }

  // ---- stepping stones ---------------------------------------------------------------------------------------------------------------
  const lt = world.terrain as { waterDepth?: (x: number, z: number) => number };
  for (const st of getFordStones()) {
    const surface = h(st.x, st.z) + (lt.waterDepth?.(st.x, st.z) ?? 0);
    // flat stones set into the stream: their tops a hand above the water
    plan.flagstones.push(item(st.x, surface - 0.14, st.z, st.yaw, st.r, 1, st.r * (0.85 + h01(30, st.x, st.z) * 0.3), 1, h01(31, st.x, st.z)));
  }
  // a flagged apron round the well, and a stepping-stone path to it from the gramophone's corner of the camp
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    const d = WELL.r + 0.55 + h01(32, i) * 0.25;
    const x = WELL.x + Math.cos(a) * d;
    const z = WELL.z + Math.sin(a) * d;
    if (blocked(x, z, 0.1)) continue;
    const r = 0.3 + h01(33, i) * 0.14;
    plan.flagstones.push(item(x, h(x, z) - 0.09, z, h01(34, i) * 6.28, r, 1, r * 0.9, 0, h01(35, i)));
  }
  const px0 = -1.6;
  const pz0 = 11.9;
  const plen = Math.hypot(WELL.x + 0.9 - px0, WELL.z - 1.4 - pz0);
  for (let i = 0, n = Math.floor(plen / 0.85); i < n; i++) {
    const t = (i + 0.5) / n;
    const x = px0 + (WELL.x + 0.9 - px0) * t + (h01(36, i) - 0.5) * 0.3;
    const z = pz0 + (WELL.z - 1.4 - pz0) * t + (h01(37, i) - 0.5) * 0.3;
    if (blocked(x, z, 0.1)) continue;
    const r = 0.28 + h01(38, i) * 0.14;
    plan.flagstones.push(item(x, h(x, z) - 0.09, z, h01(39, i) * 6.28, r, 1, r * 0.9, 0, h01(40, i)));
  }
  return plan;
}
