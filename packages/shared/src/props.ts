import { CHARACTER } from "./constants.ts";
import { angleDelta } from "./math.ts";
import { Rng } from "./rng.ts";
import type { Terrain } from "./terrain.ts";

/** Prop kinds are numeric on the wire (uint8). Add new kinds at the END only. */
export const PropKind = { CRATE: 0, BARREL: 1, BOTTLE: 2, CHAIR: 3 } as const;
export type PropKindId = (typeof PropKind)[keyof typeof PropKind];

export interface PropDef {
  name: string;
  shape: "box" | "cylinder" | "capsule";
  /** Half extents (box), or [radius, halfHeight, _] for cylinder/capsule. Metres. */
  half: readonly [number, number, number];
  mass: number;
  carryable: boolean;
}

export const PROP_DEFS: Record<PropKindId, PropDef> = {
  [PropKind.CRATE]: { name: "crate", shape: "box", half: [0.4, 0.3, 0.4], mass: 12, carryable: true },
  [PropKind.BARREL]: { name: "barrel", shape: "cylinder", half: [0.32, 0.45, 0], mass: 20, carryable: true },
  [PropKind.BOTTLE]: { name: "bottle", shape: "capsule", half: [0.05, 0.1, 0], mass: 0.6, carryable: true },
  [PropKind.CHAIR]: { name: "chair", shape: "box", half: [0.25, 0.4, 0.25], mass: 5, carryable: true },
};

export const INTERACT = {
  /** Max horizontal distance from player centre to prop centre. */
  range: 2.0,
  /** Half-angle of the frontal cone, radians (~75 degrees). */
  cone: 1.3,
  /** Vertical tolerance between player feet and prop centre. */
  vertical: 1.6,
  throwSpeed: 9,
  throwLift: 3.2,
  /** Where a carried prop is held relative to the player (metres ahead, height above feet). */
  holdForward: 0.75,
  holdHeight: 1.05,
  maxPropsPerRoom: 48,
} as const;

/** Minimal view of a prop needed for target selection (works on schema instances and plain objects). */
export interface PropView {
  kind: number;
  x: number;
  y: number;
  z: number;
  holder: string | undefined;
}

export interface Positioned {
  x: number;
  y: number;
  z: number;
  facing: number;
}

/**
 * Picks the prop a player would grab: nearest free carryable prop inside the frontal cone and range.
 * Pure and shared: the client uses it for the prompt, the server as the authority. Returns the
 * index/key iterated, or undefined. `each` abstracts over Map/array collections.
 */
export function findInteractTarget<K>(
  player: Positioned,
  each: (cb: (key: K, prop: PropView) => void) => void,
): K | undefined {
  let best: K | undefined;
  let bestScore = Infinity;
  each((key, p) => {
    const def = PROP_DEFS[p.kind as PropKindId];
    if (!def || !def.carryable || p.holder) return; // holder is undefined/"" when free (schema strings default to undefined)
    const dx = p.x - player.x;
    const dz = p.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist > INTERACT.range || Math.abs(p.y - player.y) > INTERACT.vertical) return;
    // Facing 0 = -Z, matching movement.ts: heading of the vector to the prop.
    const toProp = Math.atan2(-dx, -dz);
    const off = Math.abs(angleDelta(player.facing, toProp));
    if (dist > CHARACTER.radius + 0.35 && off > INTERACT.cone) return;
    const score = dist + off * 0.6; // prefer close and centred
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  });
  return best;
}

/** Where a carried prop is held for a player. Pure so client visuals and server physics agree. */
export function holdPosition(player: Positioned, out: { x: number; y: number; z: number }): void {
  out.x = player.x - Math.sin(player.facing) * INTERACT.holdForward;
  out.y = player.y + INTERACT.holdHeight;
  out.z = player.z - Math.cos(player.facing) * INTERACT.holdForward;
}

export interface PropSpawn {
  kind: PropKindId;
  x: number;
  z: number;
  yaw: number;
}

/** Deterministic prop scatter around the spawn clearing (no authored content yet). */
export function scatterProps(seed: number, terrain: Terrain, count: number): PropSpawn[] {
  const rng = new Rng(seed ^ 0x51ed270b);
  const kinds: PropKindId[] = [PropKind.CRATE, PropKind.BARREL, PropKind.BOTTLE, PropKind.CHAIR, PropKind.CRATE, PropKind.BARREL];
  const out: PropSpawn[] = [];
  for (let i = 0; i < Math.min(count, INTERACT.maxPropsPerRoom); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(4.5, 12);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    // Keep clear of the authored wall (z=-12, |x|<6) and crates near (4,6).
    if (z < -10 && Math.abs(x) < 7) continue;
    if (Math.hypot(x - 4.6, z - 6.2) < 2) continue;
    void terrain;
    out.push({ kind: rng.pick(kinds), x, z, yaw: rng.range(0, Math.PI * 2) });
  }
  return out;
}
