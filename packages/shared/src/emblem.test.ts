import { describe, expect, it } from "vitest";
import { emblemSvg } from "./emblem.ts";

/** Every coordinate pair in a path's data (absolute paths only: the helmet is drawn in its own transformed group). */
const points = (svg: string): [number, number][] => {
  const out: [number, number][] = [];
  for (const d of svg.match(/ d="[^"]+"/g) ?? []) for (const m of d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) out.push([Number(m[1]), Number(m[2])]);
  return out;
};

describe("the Society's seal (D-053)", () => {
  it("is deterministic and a 512 square document", () => {
    expect(emblemSvg({ tile: true })).toBe(emblemSvg({ tile: true }));
    expect(emblemSvg()).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 512 512"/);
  });

  it("the favicon keeps the wax and the star but no helmet; the full seal has the helmet and the bezel", () => {
    expect(emblemSvg({ detail: "small" })).not.toContain("<g transform");
    expect(emblemSvg()).toContain("<g transform");
    expect((emblemSvg().match(/<line /g) ?? []).length).toBe(32);
  });

  it("stays inside its tile, and the maskable icon's wax inside Android's safe circle (80 % of the tile)", () => {
    for (const [o, limit] of [[{ tile: true }, 256], [{ tile: true, scale: 0.74 }, 256 * 0.8]] as const) {
      const r = Math.max(...points(emblemSvg(o).split("<g transform")[0]!).map(([x, y]) => Math.hypot(x - 256, y - 256)));
      expect(r, JSON.stringify(o)).toBeLessThanOrEqual(limit);
    }
  });
});
