import { describe, expect, it } from "vitest";
import type { Obstacle } from "./collision.ts";
import { highmarkPlan } from "./highmark.ts";
import { kessarPlan } from "./kessar.ts";
import { createRegionWorld } from "./regions.ts";
import { saltmarketPlan } from "./saltmarket.ts";
import { vesperPlan } from "./vesper.ts";

/**
 * D-097: a sign board stands clear. The player's report: "signs have ugly overlaps and missing text". Seen in stills of every sign: a toll post in front of the toll bar's lettering,
 * lamp posts through two boards and in front of a third, one sign built into a terrace. Every region's boards (2.6 m along their local z, lettered on both faces from 1.56 to
 * 2.14 m up) must not cut into any other solid, and nothing taller than a person may stand within two paces of either face, across the board's width.
 */

const inside = (o: Obstacle, x: number, z: number, m: number): boolean => {
  if (o.kind === "circle") return Math.hypot(x - o.x, z - o.z) <= o.r + m;
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const dx = x - o.x, dz = z - o.z;
  return Math.abs(dx * c + dz * s) <= o.hx + m && Math.abs(-dx * s + dz * c) <= o.hz + m;
};

const REGIONS = [
  ["kessar", () => kessarPlan().signs],
  ["vesper", () => vesperPlan().signs],
  ["highmark", () => highmarkPlan().signs],
  ["saltmarket", () => saltmarketPlan().signs],
] as const;

describe("signs stand clear (D-097)", () => {
  it("every region still has all its signs, each with its own text (an edit once commented two of Highmark's out)", () => {
    const counts = Object.fromEntries(REGIONS.map(([r, signs]) => [r, signs().length]));
    expect(counts).toEqual({ kessar: 6, vesper: 6, highmark: 7, saltmarket: 4 });
    for (const [r, signs] of REGIONS) expect(new Set(signs().map((s) => s.text)).size, r).toBe(signs().length);
  });

  for (const [region, signs] of REGIONS) {
    it(`${region}: every board clear of every other solid, and nothing tall within a pace of its faces`, () => {
      const w = createRegionWorld(region, 7);
      const problems: string[] = [];
      signs().forEach((sg, i) => {
        const y = w.terrainHeight(sg.x, sg.z);
        const along = { x: Math.sin(sg.yaw), z: Math.cos(sg.yaw) };   // (the board runs along its local z)
        const face = { x: Math.cos(sg.yaw), z: -Math.sin(sg.yaw) };   // (its faces look along local x)
        const others = w.obstacles.filter((o) => !(o.kind === "circle" && Math.hypot(o.x - sg.x, o.z - sg.z) < 0.25));
        for (const o of others) {
          let cut = false, before = false;
          for (let t = -1.3; t <= 1.3 + 1e-9; t += 0.13) {
            const bx = sg.x + along.x * t, bz = sg.z + along.z * t;
            if (o.y1 > y + 1.5 && o.y0 < y + 2.2 && inside(o, bx, bz, 0.12)) cut = true;
            if (Math.abs(t) > 1.15) continue;
            for (const side of [-1, 1]) for (let d = 0.35; d <= 1.8; d += 0.2) {
              if (o.y1 > y + 1.7 && o.y0 < y + 1.6 && inside(o, bx + face.x * side * d, bz + face.z * side * d, 0)) before = true;
            }
          }
          if (cut) problems.push(`sign ${i} (${sg.x.toFixed(1)},${sg.z.toFixed(1)}) cuts into a ${o.tag ?? o.kind} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`);
          else if (before) problems.push(`sign ${i} (${sg.x.toFixed(1)},${sg.z.toFixed(1)}) has a ${o.tag ?? o.kind} in front of it at ${o.x.toFixed(1)},${o.z.toFixed(1)}`);
        }
      });
      expect(problems).toEqual([]);
    });
  }
});
