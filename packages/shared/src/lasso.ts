/**
 * THE LARIAT (D-106): the Society's patent rope, after the lassos of the big westerns (the idea; built here). Aimed at a man on his feet within `range`, the loop is thrown;
 * a moment later it lands, he goes down on his back and is hauled along behind on the rope, struggling, until he works free, the rope parts, or he is let go. Dragged
 * faster than a run (from the saddle, say) the ground hurts him, and he leaves a trail. Server-owned (Casualties); the clients draw the rope and say when a throw would land.
 *
 * Who can be roped: NPC rows on their feet (not a beast, not a rider, not a man already held or down). The party is never roped: a player's body is predicted on their own
 * machine (see hitReaction.ts on why the server does not move a player's body for them).
 */
export const LASSO = {
  /** Metres a loop can be thrown, and the half-angle (radians) of the cone it is aimed in. */
  range: 12,
  cone: 0.3,
  /** Seconds the loop is in the air (the catch is re-checked when it lands). */
  throwS: 0.35,
  /** Seconds between throws. */
  cooldown: 1.2,
  /** The rope: how far behind the one holding it the roped man is hauled, and past what distance it parts (a wall, a cliff). */
  length: 3.2,
  breakRange: 9,
  /** The fastest he is hauled (m/s): a galloping horse is faster than a hand. */
  pullSpeed: 14,
  /** Seconds before a man on his feet works the loop loose (one on the ground stays roped until let go). */
  holdS: 7,
  /** Hauled faster than this (m/s) the ground hurts: `dps` a second at twice this speed, in proportion, in bites. */
  hurtSpeed: 4.5,
  dps: 10,
  /** The roped man's morale shock (a humiliation as much as a hurt). */
  shock: 20,
  /** Seconds the man lies before getting up when the rope comes off. */
  getUpS: 1.0,
} as const;

/** Damage a second for being hauled at `speed` (m/s): nothing up to `LASSO.hurtSpeed`, then rising in proportion. */
export function dragHurt(speed: number): number {
  if (!(speed > LASSO.hurtSpeed)) return 0;
  return (LASSO.dps * (speed - LASSO.hurtSpeed)) / LASSO.hurtSpeed;
}

/**
 * The man a loop thrown now would be aimed at: the nearest NPC on his feet within `LASSO.range`, inside the cone round `me.facing`, not a beast, not a rider, not held,
 * not down. `each` walks the candidates. The caller checks the line of sight (a wall between stops the loop). Allocation-free; undefined when there is none.
 */
export function findRopeTarget<K>(
  me: { x: number; z: number; facing: number },
  each: (cb: (id: K, o: { x: number; z: number; npc: number; flags: number }) => void) => void,
  blocked: number,
): K | undefined {
  let best: K | undefined;
  let bestD: number = LASSO.range;
  const fx = -Math.sin(me.facing);
  const fz = -Math.cos(me.facing);
  const cosCone = Math.cos(LASSO.cone);
  each((id, o) => {
    if (o.npc === 0 || (o.flags & blocked) !== 0) return;
    const dx = o.x - me.x;
    const dz = o.z - me.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > bestD || d < 0.5) return;
    if ((dx * fx + dz * fz) / d < cosCone) return;
    bestD = d;
    best = id;
  });
  return best;
}
