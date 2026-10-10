import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { FireGrid } from "./fire.ts";
import { createRegionWorld } from "./regions.ts";

/**
 * D-103: once a fire's cells know their fuel, a step allocates nothing (the server steps it four times a second for as long as anything burns). Measured on its own (see
 * bytesPerCall.testutil.ts on why): many fresh fires on a grid whose fuel is already worked out, heap read after a forced GC, per step.
 */
describe("D-103: the fire's step", () => {
  it("allocates nothing once the fuel is known", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const world = createRegionWorld("highmark", 7);
    const grids: FireGrid[] = [];
    for (let k = 0; k < 24; k++) {
      const g = new FireGrid(world, "highmark", 7);
      for (let c = 0; c < g.cells; c++) g.fuelOf(c); // (fuel first: working it out is allowed to allocate)
      grids.push(g);
    }
    const spot = (g: FireGrid, k: number): number => {
      for (let t = 0; t < 20000; t++) {
        const c = (k * 7919 + t * 104729) % g.cells;
        if (g.fuelOf(c) > 0.5) return c;
      }
      return -1;
    };
    const wx = { windX: 0.6, windZ: 0.8, wind: 0.6, rain: 0, wet: 0 };
    // the first fires warm the step's code (compiling it is the engine's allocation, not the step's); then many short windows on fires in full cry, the median taken
    // (a window must not span a collection: see bytesPerCall.testutil.ts)
    for (let k = 0; k < 6; k++) {
      grids[k]!.igniteCell(spot(grids[k]!, k));
      for (let t = 0; t < 600 && grids[k]!.burning > 0; t++) grids[k]!.step(t, wx);
    }
    const per: number[] = [];
    for (let k = 6; k < grids.length; k++) {
      const g = grids[k]!;
      g.igniteCell(spot(g, k));
      let t = 0;
      for (; t < 40 && g.burning > 0; t++) g.step(t, wx); // (let it take hold)
      if (g.burning < 4) continue;
      gc();
      const before = process.memoryUsage().heapUsed;
      let steps = 0;
      for (; steps < 60 && g.burning > 0; steps++, t++) g.step(t, wx);
      if (steps >= 30) per.push((process.memoryUsage().heapUsed - before) / steps);
    }
    per.sort((a, b) => a - b);
    expect(per.length).toBeGreaterThan(8);
    expect(per[per.length >> 1]!).toBeLessThan(16);
  });
});
