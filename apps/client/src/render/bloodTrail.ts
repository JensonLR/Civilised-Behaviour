import { LIMB, worstWound } from "@cb/shared";

/**
 * D-104: a trail you can follow. A body with a bleeding wound drips as it goes: a spatter every so many metres it travels, closer together the worse it is, closest from a
 * stump and from a body crawling on the ground. Presentation only (the decal field draws it at the player's Gore level: nothing at Off), read off the replicated wounds.
 */
export const TRAIL = {
  /** Metres between drops for the worst wound (index = severity: 0 and 1 do not drip). */
  gap: [0, 0, 1.7, 0.9],
  /** A lost limb, and a body crawling downed (bleeding into the ground it drags over). */
  stump: 0.6,
  crawl: 0.5,
  /** Radius of one drop (the decal field's spatter). */
  drop: 0.13,
  /** Slower than this (m/s) and the drops would only pile up where the body stands: the pool under a fallen body is the hit's, not the trail's. */
  minSpeed: 0.5,
} as const;

const LIMBS = LIMB.ARM_L | LIMB.ARM_R | LIMB.LEG_L | LIMB.LEG_R;

/** Metres between drops for a body with these wounds (0 = it does not bleed enough to leave a trail). */
export function trailGap(wounds: number, missing: number, downed: boolean): number {
  let gap: number = TRAIL.gap[worstWound(wounds)] ?? 0;
  if ((missing & LIMBS) !== 0) gap = gap > 0 ? Math.min(gap, TRAIL.stump) : TRAIL.stump;
  if (downed && gap > 0) gap = Math.min(gap, TRAIL.crawl);
  return gap;
}

/** Steps one body's trail: `travelled` metres since the last drop, plus this frame's. Returns the new distance, or -1 when a drop is due now (the caller drops it and starts again from 0). */
export function trailStep(travelled: number, speed: number, dt: number, gap: number): number {
  if (!(gap > 0) || !(speed >= TRAIL.minSpeed) || !(dt > 0)) return travelled;
  const d = travelled + speed * dt;
  return d >= gap ? -1 : d;
}
