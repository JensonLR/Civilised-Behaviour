import { HILL, RIVER, riverCentre } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { Stride, stepLength, stepVolume } from "./stride.ts";
import { regionSurface, surfaceAt } from "./surface.ts";

describe("footstep cadence", () => {
  const run = (speed: number, seconds: number, grounded = true, dt = 1 / 60): number => {
    const s = new Stride();
    let steps = 0;
    for (let t = 0; t < seconds; t += dt) if (s.advance(dt, speed, grounded)) steps++;
    return steps;
  };

  it("steps are a fixed distance apart, so faster movement steps more often but not proportionally", () => {
    const walk = run(2.2, 10);
    const runn = run(4.4, 10);
    const sprint = run(6.6, 10);
    expect(walk).toBeGreaterThan(15);
    expect(runn).toBeGreaterThan(walk);
    expect(sprint).toBeGreaterThan(runn);
    expect(sprint / walk).toBeLessThan(3);
    // distance per step matches the stride law within a step
    expect((2.2 * 10) / walk).toBeCloseTo(stepLength(2.2), 0);
  });

  it("no sound while standing still or in the air, and the rhythm restarts with the next walk", () => {
    expect(run(0, 5)).toBe(0);
    expect(run(0.2, 5)).toBe(0);
    expect(run(4, 5, false)).toBe(0);
    const s = new Stride();
    let first = -1;
    for (let i = 0; i < 120 && first < 0; i++) if (s.advance(1 / 60, 2.2, true)) first = i;
    expect(first).toBeGreaterThan(0);
    expect(first / 60).toBeLessThan(stepLength(2.2) / 2.2); // the first step comes within a stride, not after a full one
  });

  it("a very long frame gives one step, not a burst", () => {
    const s = new Stride();
    s.advance(0.016, 4, true);
    let n = 0;
    for (const dt of [0.5, 0.5]) if (s.advance(dt, 6, true)) n++;
    expect(n).toBeLessThanOrEqual(2);
  });

  it("volume rises with speed and falls when crouched", () => {
    expect(stepVolume(6.6, false)).toBeGreaterThan(stepVolume(2.2, false));
    expect(stepVolume(2.2, true)).toBeLessThan(stepVolume(2.2, false));
    expect(stepVolume(50, false)).toBeLessThanOrEqual(1);
    expect(stepVolume(0, true)).toBeGreaterThan(0);
  });
});

describe("what the foot lands on", () => {
  it("water in the stream, stone on the Observatory plateau, wood on raised things, grass on the meadow", () => {
    const c = riverCentre(RIVER.length * 0.5, { x: 0, z: 0 });
    expect(surfaceAt(c.x, c.z)).toBe("water");
    expect(surfaceAt(HILL.x, HILL.z)).toBe("stone");
    expect(surfaceAt(-60, 90)).toBe("grass");
    expect(surfaceAt(-60, 90, 0.6)).toBe("wood");
  });

  it("worn paths are dirt (the spawn clearing has a trampled patch)", () => {
    const seen = new Set<string>();
    for (let x = -12; x <= 12; x += 1) for (let z = -12; z <= 12; z += 1) seen.add(surfaceAt(x, z));
    expect(seen.has("dirt")).toBe(true);
    expect(seen.has("grass")).toBe(true);
  });
});

describe("the ground by region (D-038)", () => {
  it("Kessar is sand, the Saltmarket mud, Vesper stone; water, wood and the home meadow keep their own", () => {
    expect(regionSurface("kessar", "grass")).toBe("sand");
    expect(regionSurface("saltmarket", "dirt")).toBe("mud");
    expect(regionSurface("vesper", "grass")).toBe("stone");
    expect(regionSurface("hollowmere", "grass")).toBe("grass");
    for (const r of ["kessar", "saltmarket", "vesper", "highmark"]) {
      expect(regionSurface(r, "water")).toBe("water");
      expect(regionSurface(r, "wood")).toBe("wood");
    }
  });
});

describe("the ground under a boot, region by region (D-058)", () => {
  it("never hears the hub's stream, hill or paths on another shore; hears the region's own water, roads and the Saltmarket's planks", async () => {
    const { regionSurfaceAt } = await import("./surface.ts");
    const { highmarkRoadDistance, saltmarketPlan } = await import("@cb/shared");
    // where the hub's stream runs (surfaceAt says water) Kessar's beach is sand, and the hub's hill plateau is not stone in Highmark
    let wet: { x: number; z: number } | undefined;
    for (let x = -60; x <= 60 && !wet; x += 2) for (let z = -60; z <= 60 && !wet; z += 2) if (surfaceAt(x, z) === "water") wet = { x, z };
    expect(wet).toBeDefined();
    expect(regionSurfaceAt("hollowmere", wet!.x, wet!.z)).toBe("water");
    expect(regionSurfaceAt("kessar", wet!.x, wet!.z)).toBe("sand");
    expect(regionSurfaceAt("highmark", HILL.x, HILL.z)).not.toBe("stone");
    // real water: the region's own depth
    expect(regionSurfaceAt("kessar", 0, 0, 0, 0.4)).toBe("water");
    expect(regionSurfaceAt("saltmarket", 30, 60, 0, 0.02)).not.toBe("water");
    // the Saltmarket: planks on the boardwalk, mud off it
    const walk = saltmarketPlan().boardwalks[0]!.pts;
    const mid = { x: (walk[1]!.x + walk[2]!.x) / 2, z: (walk[1]!.z + walk[2]!.z) / 2 };
    expect(regionSurfaceAt("saltmarket", mid.x, mid.z)).toBe("plank");
    expect(regionSurfaceAt("saltmarket", mid.x + 6, mid.z)).toBe("mud");
    // Highmark: the Processional Road is dirt, the grass beside it grass
    let road: { x: number; z: number } | undefined;
    for (let x = -40; x <= 40 && !road; x += 1) for (let z = 40; z <= 118 && !road; z += 1) if (highmarkRoadDistance(x, z) < 0.5) road = { x, z };
    expect(road).toBeDefined();
    expect(regionSurfaceAt("highmark", road!.x, road!.z)).toBe("dirt");
    expect(regionSurfaceAt("highmark", road!.x + 12, road!.z)).toBe("grass");
    // anything raised is wood everywhere
    expect(regionSurfaceAt("vesper", 0, 0, 0.6)).toBe("wood");
  });
});
