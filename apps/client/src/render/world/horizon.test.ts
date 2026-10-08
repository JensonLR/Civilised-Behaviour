import { describe, expect, it } from "vitest";
import { Color, Vector3 } from "three";
import { PALETTE } from "@cb/shared";
import { HORIZON, RANGE, buildHills, buildTreeLine, createHillUniforms, treeLineMaterial } from "./horizon.ts";

/**
 * Each region's own skyline. Kessar's and Highmark's horizons were Hollowmere's: green rings, a fir-and-birch tree line, snow on Alpine peaks
 * and the Hollowmere windmill turning on a crest above the desert. The builder now takes the region's style.
 */
const sails = (style = HORIZON.hollowmere): number => {
  const a = buildHills(style).geometry.attributes.aSail!;
  let n = 0;
  for (let i = 0; i < a.count; i++) if (a.getX(i) > 0.5) n++;
  return n;
};
/** The far range's crest heights (the highest vertices beyond the rings), rounded to a metre. */
const crests = (style = HORIZON.hollowmere): number[] => {
  const p = buildHills(style).geometry.attributes.position!;
  const ys: number[] = [];
  for (let i = 0; i < p.count; i++) if (Math.hypot(p.getX(i), p.getZ(i)) > RANGE.radius - RANGE.width * 0.35 && p.getY(i) > 20) ys.push(Math.round(p.getY(i)));
  return ys;
};

describe("each region its own horizon", () => {
  it("only Hollowmere has the windmill on its second summit", () => {
    expect(sails(HORIZON.hollowmere)).toBeGreaterThan(0);
    expect(buildHills(HORIZON.hollowmere).summit).toBeDefined();
    expect(sails(HORIZON.kessar)).toBe(0);
    expect(sails(HORIZON.highmark)).toBe(0);
    expect(buildHills(HORIZON.kessar).summit).toBeUndefined();
  });

  it("Kessar's far range is table-land (a few plateau levels), Hollowmere's jagged peaks (every crest its own height)", () => {
    const k = new Set(crests(HORIZON.kessar).map((y) => Math.round(y / 5)));
    const h = new Set(crests(HORIZON.hollowmere).map((y) => Math.round(y / 5)));
    expect(k.size).toBeLessThan(h.size / 2);
    // and no snow lies on it (Hollowmere's peaks carry snowfields)
    const snowy = (style = HORIZON.hollowmere): number => {
      const c = buildHills(style).geometry.attributes.aCol!;
      const snow = new Color(PALETTE.world.snow);
      const rock = new Color(style.rock);
      const d = (i: number, k: Color): number => Math.abs(c.getX(i) - k.r) + Math.abs(c.getY(i) - k.g) + Math.abs(c.getZ(i) - k.b);
      let n = 0;
      for (let i = 0; i < c.count; i++) if (d(i, snow) < d(i, rock) * 0.5) n++; // (nearer the snow than the rock: a snowfield)
      return n;
    };
    expect(snowy(HORIZON.hollowmere)).toBeGreaterThan(50);
    expect(snowy(HORIZON.kessar)).toBe(0);
  });

  it("a dry country grows no firs: Kessar's scrub is sparser than Highmark's savannah, both sparser than Hollowmere's woods", () => {
    const line = (style = HORIZON.hollowmere) => buildTreeLine(buildHills(style), treeLineMaterial(createHillUniforms(new Vector3(0.4, 1, 0.3))), 600, style)!;
    const home = line(HORIZON.hollowmere);
    const sand = line(HORIZON.kessar);
    const grass = line(HORIZON.highmark);
    expect(home.conifers.count).toBeGreaterThan(0);
    expect(sand.conifers.count).toBe(0);
    expect(grass.conifers.count).toBe(0);
    const total = (t: typeof home): number => t.conifers.count + t.rounds.count;
    expect(total(sand)).toBeLessThan(total(grass));
    expect(total(grass)).toBeLessThan(total(home));
  });

  it("the same region builds the same skyline twice; the three differ", () => {
    const sig = (style = HORIZON.hollowmere): number => {
      const p = buildHills(style).geometry.attributes.position!;
      let s = 0;
      for (let i = 0; i < p.count; i += 7) s += p.getY(i) * ((i % 13) + 1);
      return s;
    };
    expect(sig(HORIZON.kessar)).toBe(sig(HORIZON.kessar));
    expect(new Set([sig(HORIZON.hollowmere), sig(HORIZON.kessar), sig(HORIZON.highmark)]).size).toBe(3);
  });
});
