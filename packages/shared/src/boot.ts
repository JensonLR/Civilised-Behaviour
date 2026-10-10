import type { MeleeStats } from "./weapons.ts";

/**
 * THE BOOT (D-108), after the kick of the first-person sword-and-sorcery games (the idea; built here). With a firearm in hand the melee key (V) is no longer a butt-stroke
 * but a boot: little harm in itself, but it lifts a man off his feet and throws him several metres onto his back. What he lands in does the rest: a wall at speed (a
 * SPLAT), a drop (the FALL), burning grass (D-103 lights him), a stack of kegs (the body shoves them). A second boot on a man down on his back is the coup de grâce
 * (D-105: a stamp). The same rules judge anybody a blast throws: a body flung against a wall or off a ledge is hurt by what it meets.
 *
 * Only NPC rows are judged for the splat and the fall: a player's body is predicted on their own machine, and the server does not hurt a player for where their own
 * step took them (see hitReaction.ts on why the server does not move a player's body for them). Pure; the server's `systems/Flung.ts` watches the bodies.
 */
export const BOOT = {
  /** The blow itself (the firearms' `melee`). */
  blow: { damage: 6, zoneMul: [1, 1, 1, 1, 1, 1], reach: 1.6, arcHalf: 0.5, windup: 0.18, cooldown: 1.0, knock: 9.5, stumble: 0.9, cleave: 1 } satisfies MeleeStats,
  /** How hard it lifts him (m/s up: he leaves the ground) and how long he lies before he gets up (the floored reaction, D-104: long enough to walk up to where he landed
   *  and stamp, about 0.7 s of flight and a few paces; it fits the reaction byte, 3.1 s at most). */
  lift: 3.4,
  floorS: 2.6,
  /** Seconds a thrown body is watched for what it meets (the flight, the slide, the landing). */
  watchS: 2.5,
  /** A splat: a body moving at least `splatSpeed` (m/s) that loses at least `splatLoss` of its speed in one step has met something hard. */
  splatSpeed: 4.5,
  splatLoss: 0.5,
  splatBase: 14,
  splatPerMs: 3.2,
  splatMax: 60,
  /** A fall: landing from more than `fallFrom` metres above hurts `fallPerM` a metre beyond it. */
  fallFrom: 2.5,
  fallPerM: 10,
  fallMax: 120,
} as const;

/** Harm of meeting something hard, by the speed lost in the impact (m/s): nothing under `splatSpeed`, then rising to `splatMax`. */
export function splatDamage(lost: number): number {
  if (!(lost >= BOOT.splatSpeed)) return 0;
  return Math.min(BOOT.splatMax, BOOT.splatBase + BOOT.splatPerMs * (lost - BOOT.splatSpeed));
}

/** Harm of landing after a drop of `metres`: nothing up to `fallFrom`, then `fallPerM` a metre, to `fallMax`. */
export function fallDamage(metres: number): number {
  if (!(metres > BOOT.fallFrom)) return 0;
  return Math.min(BOOT.fallMax, (metres - BOOT.fallFrom) * BOOT.fallPerM);
}

/** One step of a watched body: was this a splat? (`before` and `after`: its horizontal speed either side of the step.) */
export const isSplat = (before: number, after: number): boolean => before >= BOOT.splatSpeed && after <= before * (1 - BOOT.splatLoss);

/** Is this blow the boot? (The firearms share the one `BOOT.blow`.) */
export const isBoot = (m: MeleeStats | undefined): boolean => m === BOOT.blow;
