import type { Obstacle } from "./collision.ts";
import { TRAILS, waterEdgeDistance, type Trail } from "./landscape.ts";
import type { LandscapeTerrain } from "./landscape.ts";
import type { Terrain } from "./terrain.ts";

/**
 * The furniture of the country round the spawn clearing, as authored data (the SAME numbers make the collision in `createArena` and the
 * client's visuals, like `camp.ts`): a stone well, a sheep pen with a gate, signposts where the paths part, and a plank footbridge over
 * the stream on its own little path, and flat stepping stones across the ford where the Observatory path wades the stream's source. Pure and deterministic; nothing here depends on the seed.
 */

/** A stone well with a crank and a bucket, south of the camp. */
export const WELL = { x: -4.2, z: 15.4, r: 0.95, height: 1.15 } as const;

/** The pen: a post-and-rail fence on four sides, with a gate on the side that faces the camp. */
export const PEN = { x: -16.5, z: 17.5, hx: 4.6, hz: 3.6, gate: 1.15, height: 1.0, sectionMax: 3.2 } as const;

export interface FenceSection {
  x: number;
  z: number;
  /** Half the length along the rail. */
  hx: number;
  /** Collision yaw: local +x = (cos yaw, sin yaw). */
  yaw: number;
}

/** Posts stand at both ends of every section (the renderer plants them where the sections meet). */
export function penFences(): FenceSection[] {
  const out: FenceSection[] = [];
  const run = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / PEN.sectionMax));
    const yaw = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const a = i / n;
      const b = (i + 1) / n;
      out.push({ x: x0 + (x1 - x0) * ((a + b) / 2), z: z0 + (z1 - z0) * ((a + b) / 2), hx: len / n / 2, yaw });
    }
  };
  const x0 = PEN.x - PEN.hx;
  const x1 = PEN.x + PEN.hx;
  const z0 = PEN.z - PEN.hz;
  const z1 = PEN.z + PEN.hz;
  run(x0, z0, x1, z0); // north side
  run(x0, z1, x1, z1); // south side
  run(x0, z0, x0, z1); // west side
  run(x1, z0, x1, PEN.z - PEN.gate); // east side, either side of the gate
  run(x1, PEN.z + PEN.gate, x1, z1);
  return out;
}

export interface Waypost {
  x: number;
  z: number;
  /** Yaw of the arrow that points on along the path (radians, collision convention). The second board points back. */
  yaw: number;
  /** Trail the post stands beside. */
  trail: string;
}

/** Where each signpost stands: on the named trail's point nearest `near`, `off` metres beyond the trail's edge on the left (+1) or right (-1) of the way on. */
const WAYPOSTS: readonly { trail: string; near: readonly [number, number]; side: 1 | -1; off: number }[] = [
  { trail: "observatory", near: [16.9, -19.5], side: -1, off: 1.6 },
  { trail: "coast", near: [5.9, 13.5], side: 1, off: 1.6 },
  { trail: "west", near: [-16.5, -1.6], side: 1, off: 1.5 },
  { trail: "fire-flag", near: [8.2, -12.4], side: 1, off: 1.6 },
];

/** Point and heading on a trail's smoothed centreline nearest to (qx, qz). */
function trailNear(t: Trail, qx: number, qz: number): { x: number; z: number; tx: number; tz: number } {
  const p = t.line;
  let best = Infinity;
  let out = { x: p[0]!, z: p[1]!, tx: 1, tz: 0 };
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2]! - p[i]!;
    const dz = p[i + 3]! - p[i + 1]!;
    const len2 = dx * dx + dz * dz;
    if (len2 === 0) continue;
    const u = Math.min(1, Math.max(0, ((qx - p[i]!) * dx + (qz - p[i + 1]!) * dz) / len2));
    const x = p[i]! + dx * u;
    const z = p[i + 1]! + dz * u;
    const d = (x - qx) ** 2 + (z - qz) ** 2;
    if (d < best) {
      best = d;
      const l = Math.sqrt(len2);
      out = { x, z, tx: dx / l, tz: dz / l };
    }
  }
  return out;
}

let wayposts: Waypost[] | undefined;
/** The signposts where the paths part, computed from the trails (so they follow the paths if the paths are ever redrawn). */
export function getWayposts(): readonly Waypost[] {
  wayposts ??= WAYPOSTS.map((w) => {
    const trail = TRAILS.find((t) => t.name === w.trail)!;
    const p = trailNear(trail, w.near[0], w.near[1]);
    const off = trail.width * 0.5 + w.off;
    return { x: p.x + -p.tz * w.side * off, z: p.z + p.tx * w.side * off, yaw: Math.atan2(p.tz, p.tx), trail: w.trail };
  });
  return wayposts;
}

export const WAYPOST = { r: 0.09, height: 2.35 } as const;

export interface BridgeSegment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Bridge {
  segments: BridgeSegment[];
  halfWidth: number;
  /** Rail height above the deck. */
  rail: number;
}

let bridge: Bridge | undefined;
/**
 * The footbridge: the stretch of the "footbridge" path that crosses the stream, a metre or two either side, resampled every ~1.7 m into
 * straight planked segments (the deck top is set from the banks in `bridgeDeck`).
 */
export function getBridge(): Bridge {
  if (bridge) return bridge;
  const t = TRAILS.find((q) => q.name === "footbridge")!;
  const pts: { x: number; z: number; wet: boolean }[] = [];
  for (let i = 0; i + 1 < t.line.length; i += 2) {
    const x = t.line[i]!;
    const z = t.line[i + 1]!;
    pts.push({ x, z, wet: waterEdgeDistance(x, z) < 0.9 });
  }
  // the longest run of wet points
  let best: [number, number] = [0, -1];
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i]!.wet) continue;
    let j = i;
    while (j + 1 < pts.length && pts[j + 1]!.wet) j++;
    if (j - i > best[1] - best[0]) best = [i, j];
    i = j;
  }
  // walk out from the wet run until each end has dry, level-ish ground of its own (about 2 m of approach)
  const a = Math.max(0, best[0] - 3);
  const b = Math.min(pts.length - 1, best[1] + 3);
  const line = pts.slice(a, b + 1);
  // resample by arc length
  const res: { x: number; z: number }[] = [line[0]!];
  let carry = 0;
  const STEP = 1.7;
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i]!;
    const q = line[i + 1]!;
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    let d = STEP - carry;
    while (d <= l) {
      res.push({ x: p.x + ((q.x - p.x) * d) / l, z: p.z + ((q.z - p.z) * d) / l });
      d += STEP;
    }
    carry = l - (d - STEP);
  }
  res.push(line[line.length - 1]!);
  const segments: BridgeSegment[] = [];
  for (let i = 0; i + 1 < res.length; i++) {
    if (Math.hypot(res[i + 1]!.x - res[i]!.x, res[i + 1]!.z - res[i]!.z) < 0.4) continue;
    segments.push({ x0: res[i]!.x, z0: res[i]!.z, x1: res[i + 1]!.x, z1: res[i + 1]!.z });
  }
  bridge = { segments, halfWidth: 0.85, rail: 0.85 };
  return bridge;
}

/** Deck-top world height: a hand above the LOWER bank (so neither end is more than a small step up), and well clear of the water beneath. */
export function bridgeDeck(terrain: Terrain): number {
  const b = getBridge();
  const first = b.segments[0]!;
  const last = b.segments[b.segments.length - 1]!;
  // the lower bank, measured where a walker really steps on: at each end and a metre and a quarter before it (the approach slopes)
  const dirA = { x: first.x1 - first.x0, z: first.z1 - first.z0 };
  const la = Math.hypot(dirA.x, dirA.z) || 1;
  const dirB = { x: last.x1 - last.x0, z: last.z1 - last.z0 };
  const lb = Math.hypot(dirB.x, dirB.z) || 1;
  const bank = Math.min(
    terrain.height(first.x0, first.z0), terrain.height(last.x1, last.z1),
    terrain.height(first.x0 - (dirA.x / la) * 1.25, first.z0 - (dirA.z / la) * 1.25), terrain.height(last.x1 + (dirB.x / lb) * 1.25, last.z1 + (dirB.z / lb) * 1.25),
  );
  let water = -Infinity;
  const l = terrain as Partial<LandscapeTerrain>;
  if (typeof l.waterDepth === "function") {
    for (const s of b.segments) {
      const mx = (s.x0 + s.x1) / 2;
      const mz = (s.z0 + s.z1) / 2;
      const d = l.waterDepth(mx, mz);
      if (d > 0) water = Math.max(water, terrain.height(mx, mz) + d);
    }
  }
  // D-038: a hand above the lower bank and clear of the water, but never more than a step (0.42) above that bank: on seeds where the stream stands high against its banks the deck used to sit 0.53 m up and the way across was a wall
  return Math.min(Math.max(bank + 0.14, water + 0.4), bank + 0.42);
}

export interface FordStone {
  x: number;
  z: number;
  r: number;
  yaw: number;
}

let stones: FordStone[] | undefined;
/**
 * Flat stepping stones laid along the Observatory path where it wades through the stream's source (decoration: the ford is shallow and
 * walkable, the stones are level with the water and not collidable). Hashed jitter so they do not look ruled.
 */
export function getFordStones(): readonly FordStone[] {
  if (stones) return stones;
  const t = TRAILS.find((q) => q.name === "observatory")!;
  stones = [];
  let carry = 0;
  for (let i = 0; i + 3 < t.line.length && stones.length < 30; i += 2) {
    const x0 = t.line[i]!;
    const z0 = t.line[i + 1]!;
    const x1 = t.line[i + 2]!;
    const z1 = t.line[i + 3]!;
    const l = Math.hypot(x1 - x0, z1 - z0);
    let d = 1.05 - carry;
    while (d <= l) {
      const x = x0 + ((x1 - x0) * d) / l;
      const z = z0 + ((z1 - z0) * d) / l;
      if (waterEdgeDistance(x, z) < -0.35 && stones.length < 30) {
        const k = stones.length;
        const jitter = ((k * 37) % 11) / 11 - 0.5;
        stones.push({ x: x - ((z1 - z0) / l) * jitter * 0.5, z: z + ((x1 - x0) / l) * jitter * 0.5, r: 0.34 + (((k * 53) % 7) / 7) * 0.14, yaw: (k * 2.399963) % 6.283 });
      }
      d += 1.05;
    }
    carry = l - (d - 1.05);
  }
  return stones;
}

/** The furniture's collidable parts: the well, the pen's fence sections (jump them), the signposts, the footbridge's deck (walk onto it). */
export function clearingObstacles(terrain: Terrain): Obstacle[] {
  const out: Obstacle[] = [];
  const g = (x: number, z: number): number => terrain.height(x, z);
  out.push({ kind: "circle", tag: "well", x: WELL.x, z: WELL.z, r: WELL.r, y0: g(WELL.x, WELL.z) - 0.5, y1: g(WELL.x, WELL.z) + WELL.height });
  for (const f of penFences()) out.push({ kind: "box", tag: "fence", x: f.x, z: f.z, hx: f.hx, hz: 0.07, yaw: f.yaw, y0: g(f.x, f.z) - 0.5, y1: g(f.x, f.z) + PEN.height });
  for (const w of getWayposts()) out.push({ kind: "circle", tag: "waypost", x: w.x, z: w.z, r: WAYPOST.r, y0: g(w.x, w.z) - 1, y1: g(w.x, w.z) + WAYPOST.height });
  const deck = bridgeDeck(terrain);
  const bw = getBridge();
  for (const seg of bw.segments) {
    const cx = (seg.x0 + seg.x1) / 2;
    const cz = (seg.z0 + seg.z1) / 2;
    const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
    const yaw = Math.atan2(seg.z1 - seg.z0, seg.x1 - seg.x0);
    out.push({ kind: "box", tag: "bridge", x: cx, z: cz, hx: len / 2 + 0.05, hz: bw.halfWidth, yaw, y0: deck - 2.6, y1: deck });
  }
  // handrails on either side of the middle of the crossing (the first and last spans stay open so the way on is wide)
  bw.segments.forEach((seg, i) => {
    if (i === 0 || i === bw.segments.length - 1) return;
    const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
    const yaw = Math.atan2(seg.z1 - seg.z0, seg.x1 - seg.x0);
    for (const side of [-1, 1]) {
      const off = (bw.halfWidth + 0.02) * side;
      const cx = (seg.x0 + seg.x1) / 2 - Math.sin(yaw) * off;
      const cz = (seg.z0 + seg.z1) / 2 + Math.cos(yaw) * off;
      out.push({ kind: "box", tag: "bridge", x: cx, z: cz, hx: len / 2 + 0.05, hz: 0.05, yaw, y0: deck - 0.03, y1: deck + bw.rail });
    }
  });
  return out;
}
