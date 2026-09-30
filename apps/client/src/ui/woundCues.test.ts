import { ZONE_COUNT } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { HATCH_DEFS, SEVERITY_SHAPES, ZONE_CENTRES, cuePath } from "./woundCues.ts";

describe("colour-blind safe injury marks", () => {
  it("there is a centre for every body zone, inside the chart's viewBox", () => {
    expect(ZONE_CENTRES).toHaveLength(ZONE_COUNT);
    for (const [x, y] of ZONE_CENTRES) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(40);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(88);
    }
  });

  it("each severity has its own SHAPE: none, one slash, two slashes, a cross, a bar", () => {
    const paths = [0, 1, 2, 3, 4].map((s) => cuePath(s, 20, 30));
    expect(paths[0]).toBe("");
    expect(new Set(paths).size).toBe(5);
    expect(SEVERITY_SHAPES).toHaveLength(5);
    const strokes = (d: string): number => (d.match(/M/g) ?? []).length;
    expect([strokes(paths[1]!), strokes(paths[2]!), strokes(paths[3]!)]).toEqual([1, 2, 2]);
    expect(paths[3]).toContain("L"); // the cross is two crossing lines
    expect(paths[4]).toContain("H"); // the bar of a lost limb is horizontal
  });

  it("marks stay centred on their zone and inside the smallest zone (an arm is 6 wide, 28 tall)", () => {
    const points = (d: string): { x: number; y: number }[] => {
      const out: { x: number; y: number }[] = [];
      let y = 0;
      for (const m of d.matchAll(/([MLH])(-?[\d.]+)(?: (-?[\d.]+))?/g)) {
        if (m[1] === "H") out.push({ x: Number(m[2]), y });
        else {
          y = Number(m[3]);
          out.push({ x: Number(m[2]), y });
        }
      }
      return out;
    };
    for (const s of [1, 2, 3, 4]) {
      const pts = points(cuePath(s, 6, 33));
      expect(pts.length).toBeGreaterThan(1);
      for (const p of pts) {
        expect(Math.abs(p.x - 6)).toBeLessThanOrEqual(3.5);
        expect(Math.abs(p.y - 33)).toBeLessThanOrEqual(3.5);
      }
      expect(pts.reduce((a, p) => a + p.x, 0) / pts.length).toBeCloseTo(6, 0);
    }
  });

  it("junk severities draw nothing", () => {
    expect(cuePath(7, 1, 1)).toBe("");
    expect(cuePath(-1, 1, 1)).toBe("");
  });

  it("the hatch patterns get denser as injuries get worse, and take their colours from CSS classes, not literals", () => {
    const size = (id: string): number => Number(new RegExp(`id="${id}" width="([\\d.]+)"`).exec(HATCH_DEFS)![1]);
    expect(size("cb-hatch-1")).toBeGreaterThan(size("cb-hatch-2"));
    expect(size("cb-hatch-2")).toBeGreaterThan(size("cb-hatch-3"));
    expect(HATCH_DEFS).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(/);
  });
});
