/**
 * Polyphony accounting for the audio engine, with no Web Audio in it so it can be tested in Node. A fixed number of slots (each slot is a
 * pre-built chain of nodes in the engine), a per-sound cap so a machine-gun of footsteps cannot eat every slot, and stealing: when full, the
 * quietest-priority, oldest voice that is not more important than the newcomer is cut; if everything playing outranks it, the newcomer is dropped.
 * Slots hold plain numbers/strings in parallel arrays: acquiring and releasing allocate nothing.
 */
export class VoicePool {
  private readonly names: string[];
  private readonly prio: Int8Array;
  private readonly start: Float64Array;
  private readonly end: Float64Array;
  private readonly used: Uint8Array;
  /** Set by `acquire`: the slot whose voice was cut to make room (-1 = nothing was cut). The engine fades that voice out. */
  stolen = -1;

  constructor(readonly size: number) {
    this.names = new Array<string>(size).fill("");
    this.prio = new Int8Array(size);
    this.start = new Float64Array(size);
    this.end = new Float64Array(size);
    this.used = new Uint8Array(size);
  }

  /** Voices still sounding at `now`. */
  count(now: number): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) if (this.used[i] && this.end[i]! > now) n++;
    return n;
  }

  countOf(name: string, now: number): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) if (this.used[i] && this.end[i]! > now && this.names[i] === name) n++;
    return n;
  }

  /** Frees every slot whose sound has finished. Returns how many were freed (the engine may use this to recycle nodes). */
  reap(now: number): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.used[i] && this.end[i]! <= now) {
        this.used[i] = 0;
        n++;
      }
    }
    return n;
  }

  /**
   * Claims a slot for `name` playing from `start` until `end` (seconds on the audio clock). `cap` limits simultaneous voices of the same name.
   * Returns the slot, or -1 when the sound is dropped.
   */
  acquire(name: string, prio: number, cap: number, start: number, end: number, now: number): number {
    this.reap(now);
    this.stolen = -1;
    let same = 0;
    let oldestSame = -1;
    let free = -1;
    for (let i = 0; i < this.size; i++) {
      if (!this.used[i]) {
        if (free < 0) free = i;
        continue;
      }
      if (this.names[i] === name) {
        same++;
        if (oldestSame < 0 || this.start[i]! < this.start[oldestSame]!) oldestSame = i;
      }
    }
    let slot = -1;
    if (same >= cap && oldestSame >= 0) {
      // A repeat of the same sound replaces its own oldest voice (unless that one is more important, which cannot happen for one name).
      slot = oldestSame;
      this.stolen = slot;
    } else if (free >= 0) {
      slot = free;
    } else {
      // Full: cut the lowest-priority, oldest voice that is not more important than the newcomer.
      let victim = -1;
      for (let i = 0; i < this.size; i++) {
        if (this.prio[i]! > prio) continue;
        if (victim < 0 || this.prio[i]! < this.prio[victim]! || (this.prio[i] === this.prio[victim] && this.start[i]! < this.start[victim]!)) victim = i;
      }
      if (victim < 0) return -1;
      slot = victim;
      this.stolen = slot;
    }
    this.names[slot] = name;
    this.prio[slot] = prio;
    this.start[slot] = start;
    this.end[slot] = end;
    this.used[slot] = 1;
    return slot;
  }

  /** Extends (or shortens) a voice; used by loops that are kept alive by repeated calls. */
  setEnd(slot: number, end: number): void {
    this.end[slot] = end;
  }

  release(slot: number): void {
    this.used[slot] = 0;
  }

  isUsed(slot: number): boolean {
    return this.used[slot] === 1;
  }

  nameOf(slot: number): string {
    return this.names[slot]!;
  }
}
