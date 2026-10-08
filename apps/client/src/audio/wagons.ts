import { hash3 } from "@cb/shared";

/**
 * The wagon on the move, locked to the distance its wheels roll (a wagon that slows, slows its rattle; a stopped one is silent). An iron tyre knocks over the road's stones
 * about once a metre, never evenly (the spacing comes from a hash of the wagon and the count, so the same wagon on the same road sounds the same on every machine), and
 * every few metres the axle and the bed's joints creak. Allocation-free: all state is in a typed array.
 */

const DIST = 0;
const NEXT = 1;
const CREAK = 2;
const LOUD = 3;

/** Below this (m/s) a wagon is standing, not rolling: a horse shifting its feet does not rattle the load. */
export const ROLL_MIN_SPEED = 0.25;
/** At most this many knocks in one frame: a long frame is a couple of knocks, not a drum roll. */
export const MAX_KNOCKS = 2;

/** Metres to the next knock: 0.7 .. 1.2 (mean 0.95), from the wagon's seed and how many have sounded. */
export const knockGap = (seed: number, n: number): number => 0.7 + 0.5 * (hash3(seed >>> 0, n, 0x3a9) / 4294967296);
/** Metres to the next creak: 3.5 .. 7.5. */
export const creakGap = (seed: number, n: number): number => 3.5 + 4 * (hash3(seed >>> 0, n, 0xc2e) / 4294967296);

/** A stable seed for a wagon from its row id (once, when its track is made). */
export function wagonSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class WagonRoll {
  private readonly s = new Float64Array(4);
  /** Knocks so far (an integer: it goes to the hash unboxed). */
  private count = 0;
  /** Knocks in the last step, and whether the axle creaked in it. */
  knocks = 0;
  creak = false;

  private readonly seed: number;

  constructor(seed = 0) {
    this.seed = seed & 0x3fffffff; // (a small integer: it stays unboxed wherever it is passed)
    this.s[NEXT] = knockGap(this.seed, 0);
    this.s[CREAK] = creakGap(this.seed, 0);
  }

  /** 0..1, how hard the wheels hit at the last speed (a walk is a mutter, a trot a clatter). */
  get loud(): number {
    return this.s[LOUD]!;
  }

  /** Metres rolled since it was made. */
  get rolled(): number {
    return this.s[DIST]!;
  }

  /**
   * Advances by the frame's seconds in `clock[0]` at the row's `speed` (m/s); returns the knocks that land in this frame and sets `creak`. Hostile input is silent.
   * It takes no bare number on purpose: a double passed to a call the engine does not inline is boxed (a heap number every frame; see `bytesPerCall`), and from
   * ContentAudio's frame this call is not inlined. Doubles read here, from a typed array and a row, stay in registers.
   */
  roll(clock: Float64Array, row: { speed: number }): number {
    const s = this.s;
    const dt = clock[0]!;
    const speed = row.speed;
    this.knocks = 0;
    this.creak = false;
    if (!(dt > 0) || !Number.isFinite(dt + speed) || speed < ROLL_MIN_SPEED) return 0;
    const v = Math.min(speed, 12);
    const d = s[DIST]! + v * Math.min(dt, 0.1);
    s[DIST] = d;
    s[LOUD] = Math.min(1, 0.35 + (0.65 * v) / 6);
    let n = 0;
    while (d >= s[NEXT]! && n < MAX_KNOCKS) {
      n++;
      this.count++;
      s[NEXT] = s[NEXT]! + knockGap(this.seed, this.count);
    }
    if (d >= s[NEXT]!) s[NEXT] = d + knockGap(this.seed, this.count + 1); // (a long frame: the knocks it skipped are not owed)
    if (d >= s[CREAK]!) {
      this.creak = true;
      s[CREAK] = d + creakGap(this.seed, this.count);
    }
    this.knocks = n;
    return n;
  }

  private readonly tick = new Float64Array(1);
  private readonly row = { speed: 0 };
  /** `roll` with plain numbers (tests, and any caller that inlines it). */
  step(dt: number, speed: number): number {
    this.tick[0] = dt;
    this.row.speed = speed;
    return this.roll(this.tick, this.row);
  }
}
