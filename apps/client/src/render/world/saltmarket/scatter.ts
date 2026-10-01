import { Rng, SALTMARKET, SALTMARKET_ANCHORS, hash3, saltmarketPlan, saltmarketSitePoints, type CollisionWorld, type Obstacle, type SaltmarketTerrain } from "./shared.ts";
import type { Item, ScatterDetail } from "../scatter.ts";
import { saltmarketCover } from "./ground.ts";

/**
 * Where the delta's plants go, as plain data (no three.js: placement is unit-tested in Node): reed beds thick at the waterline and in the shallows (the whole reason the horizon is a line), sedge tufts on the
 * damp plain, tamarisk scrub in the odd clump, a few dead snags at the edge of the flats, and egrets' perches. Reeds do not block (the world has no collider for one): they stand in the water's margin,
 * off the boardwalks, the quay, the bridges and every story point. Every decision is a pure function of the world and fixed seeds, so every client agrees.
 */

export interface SaltmarketScatter {
  reeds: Item[];
  sedge: Item[];
  bushes: Item[];
  /** Posts and snags standing in the flats (fishing stakes, dead trunks), as cylinders. */
  stakes: Item[];
}

const h01 = (seed: number, a: number, b = 0): number => hash3(seed, Math.round(a * 100), Math.round(b * 100)) / 4294967296;
const item = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, cls = 0, v = 0, tiltX = 0, tiltZ = 0): Item => ({ x, y, z, yaw, sx, sy, sz, cls, v, tiltX, tiltZ });

export function planSaltmarketScatter(world: CollisionWorld, detail: ScatterDetail): SaltmarketScatter {
  const out: SaltmarketScatter = { reeds: [], sedge: [], bushes: [], stakes: [] };
  const h = (x: number, z: number): number => world.terrainHeight(x, z);
  const water = (x: number, z: number): number => (world.terrain as SaltmarketTerrain).waterDepth(x, z);
  const plan = saltmarketPlan();
  const keep = saltmarketSitePoints();
  const walks = plan.boardwalks;
  const walkDist = (x: number, z: number): number => {
    let best = Infinity;
    for (const w of walks) for (let i = 0; i + 1 < w.pts.length; i++) {
      const a = w.pts[i]!, b = w.pts[i + 1]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (d < best) best = d;
    }
    return best;
  };
  const blocked = (x: number, z: number, margin: number): boolean => {
    let hit = false;
    world.forEachNear(x, z, (o: Obstacle) => {
      const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < (r + margin) ** 2) hit = true;
    });
    return hit;
  };
  const q = plan.quay;
  const onQuay = (x: number, z: number): boolean => Math.abs(x - q.x) < q.half + 3 && z > q.z0 - 8;
  const free = (x: number, z: number, margin: number): boolean => Math.hypot(x, z) < SALTMARKET_ANCHORS.bounds + 8 && !onQuay(x, z) && walkDist(x, z) > 2.2 + margin && !blocked(x, z, margin) && !keep.some((p) => Math.hypot(p.x - x, p.z - z) < 3 + margin);
  const e = 0.6;

  // reed beds: clusters in the shallows and along every margin, on their own Rng stream
  const rr = new Rng(0x5e3d1);
  const nReeds = Math.round(2600 * detail.clutter);
  for (let i = 0, n = 0; n < nReeds && i < nReeds * 14; i++) {
    const x = rr.range(-150, 150);
    const z = rr.range(-146, 128);
    const d = water(x, z);
    const hh = h(x, z);
    if (d > 0.5 || Math.hypot(x, z) > SALTMARKET_ANCHORS.bounds) continue;
    const slope = Math.hypot(h(x + e, z) - hh, h(x, z + e) - hh) / e;
    // reeds follow the cover field (thick at the waterline), sparse elsewhere
    if (rr.next() > saltmarketCover(x, z, hh, slope, d) * 1.15) continue;
    if (!free(x, z, 0.3)) continue;
    const s = 0.9 + rr.next() * 1.1;
    out.reeds.push(item(x, hh - 0.03, z, rr.next() * 6.28, s * (0.9 + rr.next() * 0.3), s * (1.0 + rr.next() * 1.0), s * (0.9 + rr.next() * 0.3), 0, rr.next()));
    // a clump: three more round the first, a stalk's width apart
    for (let c = 0; c < 3 && n < nReeds; c++) {
      const a = rr.range(0, Math.PI * 2), dd = rr.range(0.3, 1.1);
      const cx = x + Math.cos(a) * dd, cz = z + Math.sin(a) * dd;
      if (water(cx, cz) > 0.5 || !free(cx, cz, 0.2)) continue;
      const s2 = s * rr.range(0.7, 1.15);
      out.reeds.push(item(cx, h(cx, cz) - 0.03, cz, rr.next() * 6.28, s2, s2 * (1.0 + rr.next() * 0.8), s2, 0, rr.next()));
      n++;
    }
    n++;
  }
  // sedge: tufts of salt-marsh grass on the damp plain
  const gr = new Rng(0x9a561);
  const nSedge = detail.grassTufts;
  for (let tries = 0; out.sedge.length < nSedge && tries < nSedge * 6; tries++) {
    const x = gr.range(-150, 150);
    const z = gr.range(-146, 126);
    if (Math.hypot(x, z) > SALTMARKET_ANCHORS.bounds + 2) continue;
    const hh = h(x, z);
    const d = water(x, z);
    const slope = Math.hypot(h(x + e, z) - hh, h(x, z + e) - hh) / e;
    if (gr.next() > saltmarketCover(x, z, hh, slope, d) * 0.9) continue;
    if (d > 0.35 || !free(x, z, 0.1)) continue;
    const s = 0.6 + gr.next() * 0.8;
    out.sedge.push(item(x, hh - 0.03, z, gr.next() * 6.28, s * (0.9 + gr.next() * 0.3), s * (0.8 + gr.next() * 0.8), s * (0.9 + gr.next() * 0.3), gr.chance(0.3) ? 1 : 0, gr.next()));
  }
  // tamarisk in the odd clump on the driest ground
  const br = new Rng(0xb05f1);
  for (let i = 0, placed = 0; placed < detail.bushes && i < detail.bushes * 10; i++) {
    const x = br.range(-145, 145);
    const z = br.range(-140, 112);
    const hh = h(x, z);
    if (water(x, z) > 0 || hh < SALTMARKET.level - 0.05 || !free(x, z, 0.9)) continue;
    const s = 0.45 + br.next() * 0.5;
    out.bushes.push(item(x, hh - 0.05, z, br.next() * 6.28, s * (0.9 + br.next() * 0.3), s * (0.7 + br.next() * 0.5), s, 0, br.next()));
    placed++;
  }
  // fishing stakes and dead trunks standing in the shallows, in rows and singly
  const sr = new Rng(0x57ac3);
  const nStakes = Math.round(70 * detail.clutter);
  for (let i = 0, n = 0; n < nStakes && i < nStakes * 12; i++) {
    const x = sr.range(-146, 146);
    const z = sr.range(-140, 120);
    const d = water(x, z);
    if (d < 0.12 || d > 0.55 || !free(x, z, 0.4)) continue;
    const row = sr.chance(0.5) ? 4 : 1;
    const a = sr.range(0, Math.PI);
    for (let r = 0; r < row; r++) {
      const sx = x + Math.cos(a) * r * 1.4, sz = z + Math.sin(a) * r * 1.4;
      if (water(sx, sz) < 0.05 || !free(sx, sz, 0.3)) continue;
      out.stakes.push(item(sx, h(sx, sz) - 0.1, sz, sr.next() * 6.28, 1, sr.range(1.1, 2.4), 1, 0, sr.next(), (sr.next() - 0.5) * 0.12, (sr.next() - 0.5) * 0.12));
    }
    n++;
  }
  void h01;
  return out;
}
