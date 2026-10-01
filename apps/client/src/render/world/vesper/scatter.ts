import { PALETTE, Rng, VESPER_ANCHORS, hash3, vesperEastFoot, vesperPlan, vesperRoadDistance, vesperSitePoints, vesperWestFoot, type CollisionWorld, type Obstacle } from "./shared.ts";
import type { Item, ScatterDetail } from "../scatter.ts";
import { vesperCover } from "./ground.ts";
import type { VesperTerrain } from "./shared.ts";

/**
 * Where Vesper's stones and scrub go, as plain data (no three.js: placement is unit-tested in Node): the boulders are the world's own `rock` obstacles (what is drawn is what blocks), the outcrops lean
 * against the cliffs' feet, the pebbles lie round them, and the thorn scrub, the dry tufts, the dead trees and the reeds of the seep are decoration on their own Rng streams, kept off the road, the
 * buildings, the water and every obstacle. Every decision is a pure function of the world and fixed seeds, so every client agrees.
 */

export interface VesperScatter {
  boulders: Item[];
  /** Leaning outcrops against the cliff feet (decoration; the cliffs are the ground). */
  slabs: Item[];
  bushes: Item[];
  grass: Item[];
  pebbles: Item[];
  snags: Item[];
  reeds: Item[];
}

const h01 = (seed: number, a: number, b = 0): number => hash3(seed, Math.round(a * 100), Math.round(b * 100)) / 4294967296;
const item = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, cls = 0, v = 0, tiltX = 0, tiltZ = 0): Item => ({ x, y, z, yaw, sx, sy, sz, cls, v, tiltX, tiltZ });

export function planVesperScatter(world: CollisionWorld, detail: ScatterDetail): VesperScatter {
  const out: VesperScatter = { boulders: [], slabs: [], bushes: [], grass: [], pebbles: [], snags: [], reeds: [] };
  const terrain = world.terrain as VesperTerrain;
  const h = (x: number, z: number): number => terrain.height(x, z);
  const plan = vesperPlan();
  const pool = plan.wharf.pool;
  const blocked = (x: number, z: number, margin: number): boolean => {
    let hit = false;
    world.forEachNear(x, z, (o: Obstacle) => {
      if (o.tag === "cliff") return;
      const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < (r + margin) ** 2) hit = true;
    });
    return hit;
  };
  const inGorge = (x: number, z: number): boolean => x > vesperWestFoot(z) + 1.5 && x < vesperEastFoot(z) - 1.5 && z > -110 && z < 140;
  const nearSite = (x: number, z: number, d: number): boolean => {
    for (const s of vesperSitePoints()) if (Math.hypot(s.x - x, s.z - z) < d) return true;
    return false;
  };
  const free = (x: number, z: number, margin: number): boolean => inGorge(x, z) && vesperRoadDistance(x, z) > 2.6 + 1 && !blocked(x, z, margin) && Math.hypot(x - pool.x, z - pool.z) > pool.r - 0.5 && !(z < -39 && x > 12) && !(z > -75 && z < -53 && x < -28);
  const treeDensity = detail.treeDensity ?? 1;
  const slope = (x: number, z: number, e = 0.6): number => {
    const hh = h(x, z);
    return Math.hypot(h(x + e, z) - hh, h(x, z + e) - hh) / e;
  };

  // the boulders: the world's own rocks (the heaps of spoil, the needles and the plug are drawn with the buildings)
  for (const o of world.obstacles) {
    if (o.kind !== "circle" || o.tag !== "rock") continue;
    if (plan.spoil.some((s) => s.x === o.x && s.z === o.z) || plan.needles.some((s) => s.x === o.x && s.z === o.z)) continue;
    const y = h(o.x, o.z);
    const rh = o.y1 - y;
    out.boulders.push(item(o.x, y - 0.04, o.z, h01(3, o.x, o.z) * Math.PI * 2, o.r * 1.04, (rh / 1.2) * (0.92 + h01(4, o.x, o.z) * 0.16), o.r * 1.04, 0, h01(7, o.x, o.z)));
  }
  // outcrops against the cliffs' feet, both sides, as many as the preset's clutter allows
  const sr = new Rng(0x51ab);
  const nSlabs = Math.round(70 * detail.clutter);
  for (let i = 0, tries = 0; i < nSlabs && tries < nSlabs * 6; tries++) {
    const z = sr.range(-104, 120);
    const west = sr.chance(0.5);
    const foot = west ? vesperWestFoot(z) : vesperEastFoot(z);
    const x = foot + (west ? 1 : -1) * sr.range(-0.4, 0.9);
    if (nearSite(x, z, 5) || vesperRoadDistance(x, z) < 6 || (z < -39 && x > 12) || (z < -53 && z > -75 && x < -28)) continue;
    const s = sr.range(1.1, 2.6);
    out.slabs.push(item(x, h(x, z) - 0.15, z, (west ? 0 : Math.PI) + sr.range(-0.5, 0.5), s * 1.3, s * sr.range(0.9, 1.7), s, 0, sr.next(), sr.range(-0.08, 0.08), sr.range(-0.08, 0.08)));
    i++;
  }
  // the thorn scrub, in clumps on the floor and the benches
  const rng = new Rng(0xb05f);
  const nBush = Math.round(detail.bushes * 0.7);
  for (let i = 0, placed = 0; placed < nBush && i < nBush * 10; i++) {
    const z = rng.range(-106, 124);
    const x = rng.range(vesperWestFoot(z), vesperEastFoot(z));
    if (!free(x, z, 0.8)) continue;
    const fl = terrain.floor(x, z);
    if (rng.next() > vesperCover(x, z, h(x, z), slope(x, z), fl) * 1.2) continue;
    const s = 0.7 + rng.next() * 0.8;
    out.bushes.push(item(x, h(x, z) - 0.05, z, rng.next() * 6.28, s * (0.9 + rng.next() * 0.3), s * (0.6 + rng.next() * 0.5), s, 0, rng.next()));
    placed++;
  }
  // pebbles round the boulders
  const pr = new Rng(0x70c6);
  for (const m of out.boulders) {
    if (m.sx < 0.8 || out.pebbles.length > 160) continue;
    for (let i = 0, n = 2 + Math.floor(h01(11, m.x, m.z) * 4); i < n; i++) {
      const a = pr.range(0, Math.PI * 2);
      const d = m.sx * pr.range(1.3, 2.2);
      const x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      if (free(x, z, 0.15)) out.pebbles.push(item(x, h(x, z) - 0.03, z, pr.next() * 6.28, pr.range(0.1, 0.3), pr.range(0.07, 0.18), pr.range(0.1, 0.3), 0, pr.next()));
    }
  }
  // the dry tufts
  const gr = new Rng(0x9a56);
  const nGrass = Math.round(detail.grassTufts * 0.45);
  for (let tries = 0; out.grass.length < nGrass && tries < nGrass * 6; tries++) {
    const z = gr.range(-106, 126);
    const x = gr.range(vesperWestFoot(z), vesperEastFoot(z));
    if (!free(x, z, 0.4)) continue;
    const hh = h(x, z);
    if (gr.next() > vesperCover(x, z, hh, slope(x, z), terrain.floor(x, z)) * 0.95) continue;
    const s = 0.7 + gr.next() * 0.9;
    out.grass.push(item(x, hh - 0.03, z, gr.next() * 6.28, s * (0.9 + gr.next() * 0.3), s * (0.8 + gr.next() * 0.8), s * (0.9 + gr.next() * 0.3), 0, gr.next()));
  }
  // dead trees, a few, on the benches and at the seep
  const dr = new Rng(0xdead);
  const nSnag = Math.round(10 * treeDensity);
  for (let i = 0, tries = 0; i < nSnag && tries < 200; tries++) {
    const z = dr.range(-100, 126);
    const x = dr.range(vesperWestFoot(z), vesperEastFoot(z));
    if (!free(x, z, 1.4) || nearSite(x, z, 7) || vesperRoadDistance(x, z) < 6) continue;
    const s = 0.8 + dr.next() * 0.6;
    out.snags.push(item(x, h(x, z) - 0.05, z, dr.next() * 6.28, s, s * (0.9 + dr.next() * 0.4), s, 0, dr.next(), (dr.next() - 0.5) * 0.08, (dr.next() - 0.5) * 0.08));
    i++;
  }
  // reeds round the seep at the wharf and the small one at the head
  const rr = new Rng(0x5e3d);
  const nReeds = Math.round(70 * detail.clutter);
  for (let i = 0, n = 0; n < nReeds && i < nReeds * 10; i++) {
    const head = i % 5 === 0;
    const cx = head ? -9 : pool.x, cz = head ? -90 : pool.z, rad = head ? 3.4 : pool.r;
    const a = rr.range(0, Math.PI * 2);
    const d = rad + rr.range(-0.5, 2.6);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (blocked(x, z, 0.3) || Math.abs(x) < 3.2 && z > plan.wharf.z0 - 1 && z < plan.wharf.z1 + 1 || z > 146 || (Math.hypot(x, z) > VESPER_ANCHORS.bounds)) continue;
    const s = 0.8 + rr.next() * 0.8;
    out.reeds.push(item(x, h(x, z) - 0.02, z, rr.next() * 6.28, s, s * (0.9 + rr.next() * 0.6), s, 0, rr.next()));
    n++;
  }
  void PALETTE;
  return out;
}
