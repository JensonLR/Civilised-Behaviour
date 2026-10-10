import type { MoraleBand } from "./morale.ts";

/**
 * THE HOLD-UP (D-113), after the western's "hands up" (the idea; built here). A man whose nerve is going, held in the sights of a gun for a moment, gives in: he drops
 * his weapon, puts his hands up and stands where he is for the rest of the run. He counts as out of the fight (routed) for the contract, his side within earshot takes a
 * fright (so one surrender can bring on another), and the Society bills it as the civilised method. Shoot him with his hands up and the paper says so.
 *
 * Who gives in: a man broken or wavering; a shaken one who is alone or hurt; never a steady one, and never one with nerve to spare. Pure: the server keeps the time each
 * man has been covered (systems/HoldUps.ts) and the Cast says whether his nerve will hold.
 */
export const HOLDUP = {
  /** `PlayerState.roped` for a man with his hands up (1 the lariat's, D-106; 2 the collar's, D-112). */
  held: 3,
  /** How far, and how near the line of the gun (the cosine of the cone's half-angle, about 8 degrees), a man must be to be covered. */
  range: 14,
  coneCos: 0.99,
  /** How long he must be kept covered before he gives in. */
  coverS: 0.9,
  /** Health under which a shaken man counts as hurt. */
  hurtBelow: 60,
  /** Bravery from which nobody gives in at gunpoint. */
  stubborn: 85,
  /** The fright his surrender gives his own side within `frightR` metres (a morale shock, as a comrade's fall gives). */
  fright: 22,
  frightR: 16,
} as const;

/** Whether a man gives in at gunpoint: broken or wavering, or shaken and alone or hurt; never steady, never stubborn. */
export function yieldsAtGunpoint(band: MoraleBand, alone: boolean, health: number, bravery: number): boolean {
  if (!(bravery < HOLDUP.stubborn)) return false;
  if (band === "broken" || band === "wavering") return true;
  return band === "shaken" && (alone || health < HOLDUP.hurtBelow);
}

/**
 * The man in the sights of a gun held by `me` (facing `facing`, the way the gun points): within `HOLDUP.range`, inside the cone, nearest first. `each` lists the
 * candidates (the caller filters out who cannot be covered); `clear` says whether the line to him is open. Allocation-free apart from the caller's callback.
 */
export function findCovered<K>(
  me: { x: number; z: number; facing: number },
  each: (cb: (id: K, o: { x: number; z: number }) => void) => void,
  clear?: (o: { x: number; z: number }) => boolean,
): K | undefined {
  const fx = -Math.sin(me.facing);
  const fz = -Math.cos(me.facing);
  let best: K | undefined;
  let bestD: number = HOLDUP.range;
  each((id, o) => {
    const dx = o.x - me.x;
    const dz = o.z - me.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > bestD || d < 0.5) return;
    if ((dx * fx + dz * fz) / d < HOLDUP.coneCos) return;
    if (clear && !clear(o)) return;
    bestD = d;
    best = id;
  });
  return best;
}
