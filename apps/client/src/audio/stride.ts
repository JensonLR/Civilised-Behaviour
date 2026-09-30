/**
 * Footstep cadence from distance travelled. The animator's gait phase is private to the character rig, but it is itself "distance-locked" (a
 * stride is a fixed multiple of leg length that grows from walk to run), so counting metres with the same stride law puts each footfall within a
 * few centimetres of the foot visibly landing, at every speed, without reaching into the rig.
 */

const LEG_LENGTH = 0.85; // typical caricature; the rig scales stride with leg length
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Metres between one foot landing and the other's. */
export function stepLength(speed: number): number {
  const g = Math.min(speed / 4.4, 1.7);
  const runW = smooth(0.45, 1.0, g);
  return 0.5 * LEG_LENGTH * (1.9 + 1.3 * runW);
}

/** Footstep loudness (0..1) for a speed and stance: a creep is a whisper, a sprint is a drum. */
export function stepVolume(speed: number, crouching: boolean): number {
  const v = 0.35 + 0.65 * Math.min(1, speed / 6.6);
  return crouching ? v * 0.55 : v;
}

export class Stride {
  private dist = 0;
  private started = false;

  /** Advance by `dt` at `speed` m/s; true when a foot lands this frame. Airborne or nearly still resets the rhythm so the next step comes half a stride after moving off. */
  advance(dt: number, speed: number, grounded: boolean): boolean {
    if (!grounded || speed < 0.35) {
      this.started = false;
      return false;
    }
    const len = stepLength(speed);
    if (!this.started) {
      this.started = true;
      this.dist = len * 0.5;
    }
    this.dist += speed * dt;
    if (this.dist >= len) {
      this.dist -= len;
      if (this.dist > len) this.dist = 0; // a long frame: one step, not a burst
      return true;
    }
    return false;
  }
}
