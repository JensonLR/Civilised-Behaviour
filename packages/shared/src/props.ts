import { CHARACTER } from "./constants.ts";
import { hqRoute } from "./hqRoute.ts";
import { angleDelta } from "./math.ts";

/** Prop kinds are numeric on the wire (uint8). Add new kinds at the END only. */
export const PropKind = { CRATE: 0, BARREL: 1, BOTTLE: 2, CHAIR: 3, INSTRUMENT: 4 } as const;   // (D-096: the Society's theodolite in its case, the Triangulation's instrument)
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
  [PropKind.INSTRUMENT]: { name: "theodolite", shape: "box", half: [0.26, 0.3, 0.2], mass: 9, carryable: true },
};

/**
 * D-054: a powder keg with a lit fuse. Carrying a keg, RELOAD lights it (on a pad or a phone, the held USE that reloads); it goes off `seconds` later wherever it is, in
 * the air, on the ground or still in somebody's arms, with the same blast as a keg that takes a ball (`radius`, the cannon's damage times `damageMul`), credited to whoever
 * lit it. `PropState.fuse` carries what is left in tenths of a second, so every client can draw the sparks and play the hiss.
 */
export const KEG_FUSE = { seconds: 4, radius: 5, damageMul: 0.6 } as const;
/**
 * D-064: powder catches. A blast lights every keg within `reach` x its radius on a short fuse that grows with distance (`base` + `perMetre` x d seconds), so a stack of kegs goes
 * up as a ripple, nearest first, rather than all on one tick: loud, legible, and still a quarter-second's warning to whoever is standing in it.
 */
export const KEG_CHAIN = { reach: 0.9, base: 0.25, perMetre: 0.07 } as const;
/** The replicated fuse (tenths of a second, 1..255; 0 = not lit) for `left` seconds. */
export const fuseTenths = (left: number): number => (left > 0 ? Math.min(255, Math.max(1, Math.ceil(left * 10))) : 0);

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
  /** Height of its underside above the ground: a crate stacked on others (D-115, `stores.ts`). Absent on the ground. */
  up?: number;
}

let hqPosts: { x: number; z: number; r: number }[] | undefined;
/** True near an HQ finger-post (its radius plus a prop's reach) or within 1.5 m of the two authored walking lines (hqRoute.ts). */
export function hqKeepOut(x: number, z: number): boolean {
  const rt = hqRoute();
  hqPosts ??= rt.signs.map((p) => ({ x: p.x, z: p.z, r: p.r }));
  for (const p of hqPosts) if (Math.hypot(x - p.x, z - p.z) < p.r + 1.0) return true;
  for (const line of [rt.map, rt.dock]) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < 1.5) return true;
    }
  }
  return false;
}
