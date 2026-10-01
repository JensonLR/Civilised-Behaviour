import { percentile } from "@cb/shared";
import { persistenceStats } from "./persistence/stats.ts";
import { tickProbe } from "./tickProbe.ts";
/**
 * Lightweight in-process metrics exposed at /metrics (see docs/NETWORKING.md). Counters are
 * plain numbers - no per-frame allocation - and tick timings use a fixed-size ring buffer.
 */
const TICK_RING = 512;

export class Metrics {
  rooms = 0;
  players = 0;
  messagesRejected = 0;
  reconnects = 0;
  reconnectFailures = 0;
  tickOverruns = 0;
  saveFailures = 0;
  /** Input frames discarded for exceeding a player's frame budget (flooding / speed hacks / severe clock drift). */
  inputFramesDropped = 0;
  /** Live Rapier bodies (props + player capsules) across all rooms. */
  physicsBodies = 0;
  /** Rounds fired and blows that found somebody, across rooms (combat, docs/NETWORKING.md). */
  shotsFired = 0;
  hitsLanded = 0;
  private ticks = new Float64Array(TICK_RING);
  private tickCount = 0;

  recordTick(ms: number): void {
    this.ticks[this.tickCount++ % TICK_RING] = ms;
  }

  /** Over the last TICK_RING ticks of every room in the process (rooms share one thread, so this is the thread's view). */
  tickStats(): { samples: number; avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number } {
    const n = Math.min(this.tickCount, TICK_RING);
    if (n === 0) return { samples: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
    const sorted = Array.from(this.ticks.subarray(0, n)).sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return { samples: n, avgMs: sum / n, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), p99Ms: percentile(sorted, 0.99), maxMs: sorted[n - 1] ?? 0 };
  }

  /** Where a tick's time goes (`tickProbe`, since the process started): average and p95 per section, ms rounded to a microsecond. */
  sectionStats(): Record<string, { avgMs: number; p95Ms: number }> {
    const out: Record<string, { avgMs: number; p95Ms: number }> = {};
    const round = (v: number): number => Math.round(v * 1000) / 1000;
    for (const [name, s] of Object.entries(tickProbe.stats())) out[name] = { avgMs: round(s.avgMs), p95Ms: round(s.p95Ms) };
    return out;
  }

  snapshot() {
    const mem = process.memoryUsage();
    return {
      uptimeS: Math.round(process.uptime()),
      rooms: this.rooms,
      players: this.players,
      messagesRejected: this.messagesRejected,
      reconnects: this.reconnects,
      reconnectFailures: this.reconnectFailures,
      tickOverruns: this.tickOverruns,
      saveFailures: this.saveFailures,
      inputFramesDropped: this.inputFramesDropped,
      physicsBodies: this.physicsBodies,
      shotsFired: this.shotsFired,
      hitsLanded: this.hitsLanded,
      tick: this.tickStats(),
      sections: this.sectionStats(),
      persistence: { ...persistenceStats },
      heapMB: Math.round(mem.heapUsed / 1048576),
      rssMB: Math.round(mem.rss / 1048576),
    };
  }
}

export const metrics = new Metrics();
