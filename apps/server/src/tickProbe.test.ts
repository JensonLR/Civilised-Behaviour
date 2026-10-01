import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { TICK_SECTIONS, TickProbe } from "./tickProbe.ts";

describe("tick probe (D-036 contract)", () => {
  it("charges each lap to its section, resets, and reports every section", () => {
    const p = new TickProbe();
    for (let k = 0; k < 50; k++) {
      p.start();
      const t = performance.now();
      while (performance.now() - t < 0.2) { /* spin */ }
      p.lap("cast");
      p.lap("physics");
    }
    const s = p.stats();
    expect(Object.keys(s).sort()).toEqual([...TICK_SECTIONS].sort());
    expect(s.cast.laps).toBe(50);
    expect(s.cast.avgMs).toBeGreaterThan(0.15);
    expect(s.physics.avgMs).toBeLessThan(s.cast.avgMs);
    expect(s.cast.p95Ms).toBeGreaterThanOrEqual(s.cast.avgMs * 0.5);
    expect(s.cast.maxMs).toBeGreaterThanOrEqual(s.cast.p95Ms * 0.99);
    expect(s.combat.laps).toBe(0);
    p.reset();
    expect(p.stats().cast.laps).toBe(0);
    p.enabled = false;
    p.start();
    p.lap("cast");
    expect(p.stats().cast.laps).toBe(0);
  });
  it("laps retain nothing once warm (heap after a forced GC does not grow over 600k laps)", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const p = new TickProbe();
    for (let i = 0; i < 5000; i++) { p.start(); p.lap("inputs"); p.lap("cast"); }
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200_000; i++) { p.start(); p.lap("inputs"); p.lap("cast"); }
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(300_000);
  });
});
