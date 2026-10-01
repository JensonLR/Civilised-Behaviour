import type { CollisionWorld } from "./collision.ts";

/**
 * The SKYLINE a person standing at (x, z) sees: for each of `bins` azimuths, the highest elevation angle (degrees above the horizontal at eye height) of any ground or solid within `maxRange`.
 * Pure and deterministic over the collision world (terrain heightfield + obstacle tops), so a region's SILHOUETTE, which the art direction asks to be distinct (Kessar's fort on a coast, Highmark's stepped hill,
 * Vesper's cleft, the Saltmarket's flat line with hairs on it), is something a test can measure rather than a taste. Bin 0 is north (-Z), bins run clockwise (towards +X). Test and tooling code: the game never calls it.
 */
export interface SkylineOptions { bins?: number; eye?: number; maxRange?: number; step?: number }
export interface SkylineStats {
  /** Mean elevation over all bins, degrees. */
  mean: number;
  /** 10th percentile and maximum elevation. */
  p10: number;
  max: number;
  /** Share of bins (0..1) at or above 4 degrees: "walled in". */
  walled: number;
  /** Share of bins at or below 2 degrees: "open horizon". */
  open: number;
  /** Local peaks that stand >= 2 degrees above both neighbours at 3 bins' distance: the verticals of the line (a headframe, a mast, a tower). */
  spikes: number;
}

const DEG = 180 / Math.PI;

export function skylineFrom(world: CollisionWorld, x: number, z: number, opts: SkylineOptions = {}): number[] {
  const bins = opts.bins ?? 72;
  const eye = (world.terrainHeight(x, z) + (opts.eye ?? 1.7));
  const range = opts.maxRange ?? world.boundsRadius;
  const step = opts.step ?? 2;
  const out = new Array<number>(bins).fill(-90);
  // the ground: march each azimuth
  for (let i = 0; i < bins; i++) {
    const a = ((i + 0.5) / bins) * Math.PI * 2;
    const sx = Math.sin(a), sz = -Math.cos(a);
    let best = -90;
    for (let d = step; d <= range; d += step) {
      const el = Math.atan2(world.terrainHeight(x + sx * d, z + sz * d) - eye, d) * DEG;
      if (el > best) best = el;
    }
    out[i] = best;
  }
  // the solids: a ray against each obstacle (a circle or an oriented box); the elevation is that of its top from the near hit
  for (const o of world.obstacles) {
    const dx0 = o.x - x, dz0 = o.z - z;
    const reach = (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + range;
    if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
    const topEl = (t: number): number => Math.atan2(o.y1 - eye, Math.max(t, 1)) * DEG;
    for (let i = 0; i < bins; i++) {
      const a = ((i + 0.5) / bins) * Math.PI * 2;
      const sx = Math.sin(a), sz = -Math.cos(a);
      let t = -1;
      if (o.kind === "circle") {
        const tc = dx0 * sx + dz0 * sz;   // along the ray
        const d2 = dx0 * dx0 + dz0 * dz0 - tc * tc;
        if (tc > 0 && d2 <= o.r * o.r) t = tc - Math.sqrt(o.r * o.r - d2);
      } else {
        const c = Math.cos(o.yaw), sn = Math.sin(o.yaw);
        const ox = -dx0 * c - dz0 * sn, oz = dx0 * sn - dz0 * c;   // the ray's origin in the box's frame
        const dx = sx * c + sz * sn, dz = -sx * sn + sz * c;       // and its direction
        let t0 = 0, t1 = Infinity;
        for (const [p0, dd, h] of [[ox, dx, o.hx], [oz, dz, o.hz]] as const) {
          if (Math.abs(dd) < 1e-9) { if (Math.abs(p0) > h) { t1 = -1; break; } continue; }
          const u = (-h - p0) / dd, v = (h - p0) / dd;
          t0 = Math.max(t0, Math.min(u, v));
          t1 = Math.min(t1, Math.max(u, v));
        }
        if (t1 >= t0 && t1 > 0) t = t0;
      }
      if (t < 0 || t > range) continue;
      const el = topEl(t);
      if (el > out[i]!) out[i] = el;
    }
  }
  return out;
}

export function skylineStats(sl: readonly number[]): SkylineStats {
  const n = sl.length;
  const sorted = [...sl].sort((a, b) => a - b);
  let sum = 0, walled = 0, open = 0, spikes = 0;
  for (let i = 0; i < n; i++) {
    const v = sl[i]!;
    sum += v;
    if (v >= 4) walled++;
    if (v <= 2) open++;
    if (v >= sl[(i + 3) % n]! + 2 && v >= sl[(i - 3 + n) % n]! + 2 && v >= sl[(i + 1) % n]! && v >= sl[(i - 1 + n) % n]!) spikes++;
  }
  return { mean: sum / n, p10: sorted[Math.floor(n * 0.1)]!, max: sorted[n - 1]!, walled: walled / n, open: open / n, spikes };
}

/** How differently two skylines read: the mean absolute difference of elevation over the bins, degrees. 0 = the same silhouette. */
export function skylineDistance(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!);
  return s / n;
}
