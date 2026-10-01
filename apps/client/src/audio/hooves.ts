import { GAIT, gaitOf } from "@cb/shared";

/**
 * Hoofbeats on the horse animator's own stride law (packages/procedural horseAnimator.ts): one full leg cycle every `1.4 + 0.3 * speed` metres, so the beats
 * are locked to distance travelled (a horse that slows, slows its beats; a stopped horse is silent) with no reach into the rig. How many beats a cycle holds,
 * and where in it they fall, is the gait's (`gaitOf`, the same function the game uses to name a gait): a walk has four evenly spaced, a trot two (diagonal
 * pairs land together), a canter three (the lead leg last), a gallop four bunched in pairs with the long suspension between. Allocation-free: all state is
 * in a typed array, so a frame of update on ten horses allocates nothing.
 */

/** Fractions of the cycle at which a beat lands, per gait. */
export const BEAT_AT: readonly (readonly number[])[] = [
  [], // idle
  [0, 0.25, 0.5, 0.75], // walk
  [0, 0.5], // trot
  [0, 0.34, 0.62], // canter
  [0, 0.1, 0.46, 0.54], // gallop
];

/** The sound key (see sounds.ts `hoof`) of each gait. */
export const GAIT_KEYS: readonly string[] = ["", "walk", "trot", "canter", "gallop"];

/** Metres per full leg cycle at `speed` (the animator's law). */
export const strideMetres = (speed: number): number => 1.4 + 0.3 * speed;

/** Beats per metre travelled at a steady `speed`: what "locked to the gait's cadence" means in numbers. */
export const beatsPerMetre = (speed: number): number => BEAT_AT[gaitOf(speed)]!.length / strideMetres(speed);

const PHASE = 0;
const LOUD = 1;

export class HoofCadence {
  private readonly s = new Float64Array(2);
  /** The gait (GAIT.*) of the last step, and the beats that landed in it. */
  gait = 0;
  beats = 0;

  /** Where in the cycle the legs are, 0..1. */
  get phase(): number {
    return this.s[PHASE]!;
  }

  /** 0..1, how heavy a beat is at the last speed (a walk is a murmur, a gallop is a drum). */
  get loud(): number {
    return this.s[LOUD]!;
  }

  /**
   * Advances by `dt` seconds at `speed` m/s; returns how many beats landed in this frame (at most 3: a long frame is a few beats, not a roll) and sets `gait`.
   * Airborne or nearly still: no beats, and the phase holds (the next beat comes where the legs left off).
   */
  step(dt: number, speed: number, grounded: boolean): number {
    const s = this.s;
    this.beats = 0;
    if (!(dt > 0) || !Number.isFinite(dt + speed)) return 0;
    const g = gaitOf(speed);
    this.gait = g;
    if (g === GAIT.idle || !grounded) return 0;
    const v = Math.min(speed, 14);
    const p0 = s[PHASE]!;
    const adv = (v * Math.min(dt, 0.1)) / strideMetres(v);
    const p1 = p0 + adv;
    const at = BEAT_AT[g]!;
    let n = 0;
    for (let k = 0; k < at.length; k++) {
      const b = at[k]!;
      // a beat at fraction b lands when the phase crosses b (this cycle) or b + 1 (it wrapped); phases in [p0, p1) of the unwrapped line
      if ((b >= p0 && b < p1) || (b + 1 >= p0 && b + 1 < p1)) n++;
    }
    s[PHASE] = p1 >= 1 ? p1 - Math.floor(p1) : p1;
    s[LOUD] = Math.min(1, 0.35 + 0.65 * (v / 10.5));
    this.beats = n > 3 ? 3 : n;
    return this.beats;
  }

  reset(): void {
    this.s[PHASE] = 0;
    this.s[LOUD] = 0;
    this.gait = 0;
    this.beats = 0;
  }
}
