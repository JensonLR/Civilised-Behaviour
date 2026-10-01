import { describe, expect, it } from "vitest";
import { Metrics } from "./metrics.ts";
import { TICK_SECTIONS, tickProbe } from "./tickProbe.ts";

describe("/metrics: tick percentiles and the sections (D-036)", () => {
  it("reports p50, p95, p99 and max over the ring, nearest-rank, and zeros before the first tick", () => {
    const m = new Metrics();
    expect(m.tickStats()).toEqual({ samples: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 });
    for (let i = 1; i <= 100; i++) m.recordTick(i / 10); // 0.1 .. 10.0 ms
    const s = m.tickStats();
    expect(s.samples).toBe(100);
    expect(s.p50Ms).toBeCloseTo(5.0, 6);
    expect(s.p95Ms).toBeCloseTo(9.5, 6);
    expect(s.p99Ms).toBeCloseTo(9.9, 6);
    expect(s.maxMs).toBeCloseTo(10, 6);
    expect(s.avgMs).toBeCloseTo(5.05, 6);
    expect(s.p50Ms).toBeLessThan(s.p95Ms);
    expect(s.p95Ms).toBeLessThanOrEqual(s.p99Ms);
  });

  it("the ring keeps only the latest 512 ticks (an old spike ages out)", () => {
    const m = new Metrics();
    m.recordTick(500);
    for (let i = 0; i < 600; i++) m.recordTick(1);
    const s = m.tickStats();
    expect(s.samples).toBe(512);
    expect(s.maxMs).toBe(1);
  });

  it("the snapshot carries p50/p95 and a per-section table (every probe section, rounded to a microsecond, JSON-safe)", () => {
    const m = new Metrics();
    tickProbe.reset();
    for (let i = 0; i < 20; i++) {
      tickProbe.start();
      const t = performance.now();
      while (performance.now() - t < 0.3) { /* spin */ }
      tickProbe.lap("cast");
      tickProbe.lap("physics");
    }
    m.recordTick(2);
    const snap = m.snapshot();
    expect(snap.tick.p50Ms).toBe(2);
    expect(snap.tick.p95Ms).toBe(2);
    expect(Object.keys(snap.sections).sort()).toEqual([...TICK_SECTIONS].sort());
    expect(snap.sections.cast!.avgMs).toBeGreaterThan(0.2);
    expect(snap.sections.cast!.p95Ms).toBeGreaterThanOrEqual(snap.sections.cast!.avgMs * 0.5);
    expect(snap.sections.combat).toEqual({ avgMs: 0, p95Ms: 0 });
    expect(snap.sections.cast!.avgMs * 1000).toBeCloseTo(Math.round(snap.sections.cast!.avgMs * 1000), 6); // (rounded to a microsecond)
    expect(JSON.parse(JSON.stringify(snap)).sections.cast.avgMs).toBe(snap.sections.cast!.avgMs);
    tickProbe.reset();
  });

  it("the probe tells its listener the whole tick's time when the closing section is lapped, and only then", () => {
    tickProbe.reset();
    const got: number[] = [];
    tickProbe.onTick = (ms) => got.push(ms);
    try {
      for (let i = 0; i < 5; i++) {
        tickProbe.start();
        const t = performance.now();
        while (performance.now() - t < 0.4) { /* spin */ }
        tickProbe.lap("cast");
        expect(got.length).toBe(i);
        tickProbe.lap("travel");
      }
      expect(got.length).toBe(5);
      for (const ms of got) expect(ms).toBeGreaterThanOrEqual(0.4);
    } finally {
      tickProbe.onTick = undefined;
      tickProbe.reset();
    }
  });
});
