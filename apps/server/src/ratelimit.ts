/** Tiny in-memory token bucket keyed by string (client IP). Enough for one game process. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  /** Returns true if the call is allowed. */
  take(key: string, now = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, last: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.last) / 1000) * this.refillPerSecond);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    if (this.buckets.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [k, b] of this.buckets) if (now - b.last > 60_000) this.buckets.delete(k);
  }
}
