import { percentile } from "@cb/shared";

/**
 * Where a tick's time goes (D-036, package Q's measuring stick). One process-wide probe; `WorldRoom`'s tick calls `lap(section)` after each phase, and every call charges the
 * time since the previous lap (or `start`) to that section. Allocation-free: fixed typed arrays, a ring of the last RING laps per section for percentiles. Costs two
 * `performance.now()` calls per section per tick, which is why the section list is short. Sections are append-only (Q may add; the soak report keys by name).
 */
export const TICK_SECTIONS = ["inputs", "mounts", "npc", "scenario", "cast", "followers", "casualties", "combat", "physics", "props", "travel", "other"] as const;
export type TickSection = (typeof TICK_SECTIONS)[number];
const RING = 4096;
const N = TICK_SECTIONS.length;
/** The section lapped LAST in a tick: its lap closes the tick, and `onTick` (the soak harness) is told the whole tick's time. */
const LAST: TickSection = "travel";
const INDEX: Record<TickSection, number> = Object.fromEntries(TICK_SECTIONS.map((s, i) => [s, i])) as Record<TickSection, number>;

export class TickProbe {
  private ring = new Float64Array(N * RING);
  private count = new Uint32Array(N);
  private sum = new Float64Array(N);
  private max = new Float64Array(N);
  private last = 0;
  private began = 0;
  enabled = true;
  /** Called (allocation-free) with the whole tick's ms when the closing section is lapped. One slot: the soak harness's, which tags the sample with the room it knows is running. */
  onTick: ((ms: number) => void) | undefined;

  /** Begin a tick: the first lap measures from here. */
  start(): void {
    if (this.enabled) this.last = this.began = performance.now();
  }

  /** Charge the time since the last lap (or `start`) to `section`. */
  lap(section: TickSection): void {
    if (!this.enabled) return;
    const now = performance.now();
    const i = INDEX[section];
    const dt = now - this.last;
    this.last = now;
    this.ring[i * RING + (this.count[i]! % RING)] = dt;
    this.count[i]!++;
    this.sum[i]! += dt;
    if (dt > this.max[i]!) this.max[i] = dt;
    if (section === LAST && this.onTick) this.onTick(now - this.began);
  }

  reset(): void {
    this.count.fill(0);
    this.sum.fill(0);
    this.max.fill(0);
  }

  /** Average, p95 and worst per section over everything since the last `reset` (the percentile is over the last RING laps). Allocates: call it from reports, never from a tick. */
  stats(): Record<TickSection, { laps: number; avgMs: number; p95Ms: number; maxMs: number }> {
    const out = {} as Record<TickSection, { laps: number; avgMs: number; p95Ms: number; maxMs: number }>;
    for (const s of TICK_SECTIONS) {
      const i = INDEX[s];
      const n = this.count[i]!;
      const m = Math.min(n, RING);
      const win = Array.from(this.ring.subarray(i * RING, i * RING + m)).sort((a, b) => a - b);
      out[s] = { laps: n, avgMs: n ? this.sum[i]! / n : 0, p95Ms: percentile(win, 0.95), maxMs: this.max[i]! };
    }
    return out;
  }
}

export const tickProbe = new TickProbe();
