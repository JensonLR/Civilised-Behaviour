import { angleDelta } from "./math.ts";

/** Health, downing, revive and drag tuning. Shared so client prompts and server authority agree. */
export const CASUALTY = {
  maxHealth: 100,
  /** Seconds of uninterrupted hold to revive a teammate (measured in SERVER ticks, never client frames). */
  reviveSeconds: 2.5,
  reviveHealth: 35,
  /** Horizontal reach to start/keep reviving. */
  reviveRange: 1.8,
  /** Horizontal reach to start dragging; dragging auto-releases beyond `dragBreakRange`. */
  dragRange: 1.7,
  dragBreakRange: 3.2,
  /** How far behind the dragger the body trails, metres. */
  dragDistance: 1.2,
  /** Seconds with every connected player downed before the party is hauled back up (the "rout"). */
  routSeconds: 8,
  routHealth: 40,
} as const;

/** Minimal view of a player for casualty targeting (works on schema instances and plain objects). */
export interface CasualtyView {
  x: number;
  y: number;
  z: number;
  facing: number;
  flags: number;
}

const DOWNED = 16; // FLAG.DOWNED (avoid a circular import; asserted equal in casualty.test.ts)

/**
 * The downed teammate a player would help: nearest within `range`, preferring one in front but accepting any
 * that is very close. Pure and shared (prompt on the client, authority on the server).
 */
export function findDownedTarget<K>(
  self: CasualtyView,
  range: number,
  each: (cb: (key: K, other: CasualtyView) => void) => void,
): K | undefined {
  let best: K | undefined;
  let bestScore = Infinity;
  each((key, o) => {
    if ((o.flags & DOWNED) === 0) return;
    const dx = o.x - self.x;
    const dz = o.z - self.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range || Math.abs(o.y - self.y) > 1.6) return;
    const off = Math.abs(angleDelta(self.facing, Math.atan2(-dx, -dz)));
    if (dist > 0.9 && off > 1.6) return;
    const score = dist + off * 0.4;
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  });
  return best;
}
