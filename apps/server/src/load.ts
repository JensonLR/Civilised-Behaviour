import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

/**
 * How busy this server is, from the inside (D-051): how LATE the one game thread's timers fire (the event loop's delay, its 95th percentile per sample), over a short window.
 * Measured with `scripts/capacity.mts` under a real CPU quota (Render's free tier is a tenth of a core): at four or five full rooms the quota is spent and ticks overrun, yet
 * the loop's UTILISATION stayed near 0.15, because a throttled process is frozen between periods and that frozen time reads as idle. Lateness is what the players feel (a
 * tick that fires 60 ms late is a hitch), it shows a quota and a saturated core alike, and it needs no knowledge of the plan. A fixed room cap cannot be right for every
 * plan; this is what NEW campaigns are admitted against (`app.ts`), and the rooms already running keep their tick.
 */
export interface LoadPolicy {
  /** Refuse NEW rooms while the window's typical lateness (ms) is at or above this (0 = never). */
  maxLagMs: number;
  /** How many samples the window holds (one every `everyMs`). */
  window: number;
  everyMs: number;
}

export const DEFAULT_LOAD: LoadPolicy = { maxLagMs: 0, window: 5, everyMs: 2000 };

export class LoadGauge {
  private readonly samples: number[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private histogram: IntervalHistogram | undefined;

  constructor(
    readonly policy: LoadPolicy,
    /** The lateness (p95, ms) since the previous read; injectable for tests. The server reads the event loop's delay histogram and resets it. */
    private readonly read?: () => number,
  ) {}

  /** Takes one sample. */
  sample(): void {
    const lag = this.read ? this.read() : this.readHistogram();
    this.samples.push(Math.max(0, lag));
    if (this.samples.length > this.policy.window) this.samples.shift();
  }

  private readHistogram(): number {
    const h = this.histogram;
    if (!h || h.count === 0) return 0;
    const p95 = h.percentile(95) / 1e6;
    h.reset();
    return p95;
  }

  /** The window's median lateness in ms (0 before the first sample): one sample spent building a world does not move it. */
  get lagMs(): number {
    if (!this.samples.length) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }

  /** Too busy to take on another room: a full window whose median lateness is at or above the threshold. */
  busy(): boolean {
    return this.policy.maxLagMs > 0 && this.samples.length >= this.policy.window && this.lagMs >= this.policy.maxLagMs;
  }

  start(): void {
    if (this.timer || this.policy.maxLagMs <= 0) return;
    if (!this.read) {
      this.histogram = monitorEventLoopDelay({ resolution: 10 });
      this.histogram.enable();
    }
    this.timer = setInterval(() => this.sample(), this.policy.everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.histogram?.disable();
  }
}
