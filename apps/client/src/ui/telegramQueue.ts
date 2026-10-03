/**
 * Notices arrive by telegram. Several can land at once (a rout, a revival, the server's word about a comrade), so they queue: at most `max` slips show
 * at a time, each for as long as it takes to read, the rest wait their turn. Pure state, no DOM (`Telegrams.ts` draws it; the tests drive it).
 */
export interface Slip {
  id: number;
  text: string;
  /** Seconds on show so far, and how long it stays. */
  age: number;
  life: number;
}

/**
 * How long a slip stays: 2.4 s and 35 ms a character, between 3 and 7 seconds unless the caller says; a debrief (several lines, D-040) up to 12. (D-063: slips stayed 4-11 s
 * and arrived 3-8 a minute in a contract, so one was nearly always on the picture; the whole text is kept in the pause sheet's dispatches, so a slip only has to be glanced at.)
 */
export const readingTime = (text: string): number => Math.max(3, Math.min(text.includes("\n") ? 12 : 7, 2.4 + text.length * 0.035));

/** News that has waited this long for a place is old news: it goes to the dispatches log without being shown (a queue of slips trickling on for a minute was the spam). */
export const STALE_S = 12;

export class TelegramQueue {
  readonly shown: Slip[] = [];
  private readonly waiting: { text: string; life: number; at: number }[] = [];
  private nextId = 1;
  /** The same text arriving again within this many seconds of being shown or queued is the same news, not a second slip. */
  static readonly DUPLICATE_WINDOW = 1.5;
  private recent: { text: string; at: number }[] = [];
  private clock = 0;

  constructor(readonly max = 3, readonly maxWaiting = 12) {}

  get queued(): number {
    return this.waiting.length;
  }

  /** Adds a slip; returns false if it was dropped as a duplicate or because the queue is full (the oldest waiting slip is discarded to make room for news). */
  push(text: string, seconds?: number): boolean {
    const t = text.trim();
    if (!t) return false;
    if (this.recent.some((r) => r.text === t && this.clock - r.at < TelegramQueue.DUPLICATE_WINDOW)) return false;
    this.recent.push({ text: t, at: this.clock });
    if (this.recent.length > 8) this.recent.shift();
    const life = seconds && seconds > 0 ? seconds : readingTime(t);
    if (this.shown.length < this.max) this.show(t, life);
    else {
      if (this.waiting.length >= this.maxWaiting) this.waiting.shift();
      this.waiting.push({ text: t, life, at: this.clock });
    }
    return true;
  }

  private show(text: string, life: number): void {
    this.shown.push({ id: this.nextId++, text, age: 0, life });
  }

  /** Advances the clocks; returns true if the set of slips on show changed. */
  tick(dt: number): boolean {
    this.clock += dt;
    let changed = false;
    for (const s of this.shown) s.age += dt;
    for (let i = this.shown.length - 1; i >= 0; i--) {
      if (this.shown[i]!.age >= this.shown[i]!.life) {
        this.shown.splice(i, 1);
        changed = true;
      }
    }
    while (this.waiting.length > 0 && this.clock - this.waiting[0]!.at > STALE_S) {
      this.waiting.shift();
      changed = true;
    }
    while (this.shown.length < this.max && this.waiting.length > 0) {
      const w = this.waiting.shift()!;
      this.show(w.text, w.life);
      changed = true;
    }
    return changed;
  }

  clear(): void {
    this.shown.length = 0;
    this.waiting.length = 0;
    this.recent.length = 0;
  }
}
