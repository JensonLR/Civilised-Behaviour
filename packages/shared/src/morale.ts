import type { Morale } from "./expeditionTypes.ts";
import { clamp } from "./math.ts";

/**
 * Morale (D-034), one pure function for the garrison and the hired hands. `v` moves toward a goal that bravery, company, a leader, wounds,
 * incoming fire, fear and fallen friends set; `shock` is a fear impulse the caller adds to when something dreadful happens in sight (a friend
 * goes down, a limb comes off) and that decays on its own. Allocation-free; non-finite inputs are treated as zero.
 */
export interface MoraleInput {
  dt: number;
  /** 1 when a leader (the player, an officer) is near and in command. */
  leader: 0 | 1;
  allies: number;
  alliesDown: number;
  /** 100 - health. */
  hpLack: number;
  /** 0..1 */
  underFire: number;
  /** The faction's fear toward the player, 0..100. */
  fear: number;
  /** Wages are up to date (only hired hands can be unpaid). */
  paid: boolean;
  /** The party carries provisions. */
  provisions: boolean;
}

/** Rates per second, the weight of a fear impulse in the goal, the band floors (steady 70, shaken 50, wavering 30, below that broken) and the morale at which a routed man rallies. */
export const MORALE = { rise: 6, fall: 25, shockDecay: 10, shockWeight: 0.6, steadyAt: 70, shakenAt: 50, waveringAt: 30, rallyAt: 55 } as const;
export type MoraleBand = "steady" | "shaken" | "wavering" | "broken";

const fin = (v: number): number => (Number.isFinite(v) ? v : 0);

export const newMorale = (v = 70): Morale => ({ v: clamp(fin(v), 0, 100), shock: 0 });

export function moraleGoal(m: Morale, i: MoraleInput, bravery: number): number {
  const goal = 25 + 0.6 * clamp(fin(bravery), 0, 100) + 6 * Math.min(Math.max(fin(i.allies), 0), 4) + 12 * (i.leader ? 1 : 0)
    - 0.5 * clamp(fin(i.hpLack), 0, 100) - 20 * clamp(fin(i.underFire), 0, 1) - 0.25 * clamp(fin(i.fear), 0, 100) - 8 * Math.min(Math.max(fin(i.alliesDown), 0), 4)
    + (i.provisions ? 8 : 0) - (i.paid ? 0 : 12) - MORALE.shockWeight * m.shock;
  return clamp(goal, 0, 100);
}

export function moraleStep(m: Morale, i: MoraleInput, bravery: number): void {
  const dt = clamp(fin(i.dt), 0, 0.5);
  m.shock = Math.max(0, fin(m.shock) - MORALE.shockDecay * dt);
  const goal = moraleGoal(m, i, bravery);
  const d = goal - fin(m.v);
  m.v = clamp(fin(m.v) + clamp(d, -MORALE.fall * dt, MORALE.rise * dt), 0, 100);
}

export const moraleBand = (v: number): MoraleBand => (v >= MORALE.steadyAt ? "steady" : v >= MORALE.shakenAt ? "shaken" : v >= MORALE.waveringAt ? "wavering" : "broken");
