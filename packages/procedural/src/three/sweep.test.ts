import type { BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import type { V3 } from "./parts.ts";
import { curve, sweepGeometry } from "./sweep.ts";

const volume = (g: BufferGeometry): number => {
  const p = g.attributes.position!;
  const ix = g.index!;
  let v = 0;
  for (let i = 0; i < ix.count; i += 3) {
    const a = ix.getX(i);
    const b = ix.getX(i + 1);
    const c = ix.getX(i + 2);
    v += (p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) - p.getY(a) * (p.getX(b) * p.getZ(c) - p.getZ(b) * p.getX(c)) + p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c))) / 6;
  }
  return v;
};
const taper = (t: number) => ({ rx: 0.1 * (1 - t * 0.8), rz: 0.06 });

describe("sweepGeometry", () => {
  const paths: Record<string, V3[]> = {
    straight: [[0, 0, 0], [0, 0, -0.5], [0, 0, -1]],
    "curved down (a hooked nose)": curve([[0, 0.1, 0], [0, 0, -0.3], [0, -0.2, -0.5], [0, -0.4, -0.45]], 10),
    "curled up (a handlebar tip)": curve([[0, 0, 0], [0.3, -0.05, 0], [0.5, 0.1, 0], [0.45, 0.25, 0]], 10),
    "hanging (a beard)": [[0, 0, 0], [0, -0.5, 0.05], [0, -1, 0.1]],
  };
  for (const [name, spine] of Object.entries(paths)) {
    for (const side of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]) {
      it(`${name}: a closed solid facing outward, either direction, side axis ${side.join(",")}`, () => {
        const fwd = sweepGeometry(spine, taper, { color: 0xffffff, side });
        const back = sweepGeometry([...spine].reverse(), taper, { color: 0xffffff, side });
        expect(volume(fwd)).toBeGreaterThan(0);
        expect(volume(back)).toBeGreaterThan(0);
        const n = fwd.attributes.normal!;
        for (let i = 0; i < n.count; i++) expect(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))).toBe(true);
      });
    }
  }
  it("volume matches the obvious cylinder for a straight constant section", () => {
    const g = sweepGeometry([[0, 0, 0], [0, 0, -1]], () => ({ rx: 0.1, rz: 0.1, pow: 2 }), { color: 0xffffff, segments: 32 });
    expect(volume(g)).toBeCloseTo(Math.PI * 0.01 * 1, 1);
  });
  it("curve() keeps its endpoints and samples smoothly", () => {
    const pts: V3[] = [[0, 0, 0], [1, 1, 0], [2, 0, 0]];
    const c = curve(pts, 21);
    expect(c[0]).toEqual([0, 0, 0]);
    expect(c[20]![0]).toBeCloseTo(2);
    expect(c).toHaveLength(21);
  });

  it("round ends stay closed solids and extend past the spine by about one radius", () => {
    const spine: V3[] = [[0, 0, 0], [0, 0, -0.5], [0, 0, -1]];
    const flat = sweepGeometry(spine, () => ({ rx: 0.1, rz: 0.1, pow: 2 }), { color: 0xffffff, segments: 16 });
    const domed = sweepGeometry(spine, () => ({ rx: 0.1, rz: 0.1, pow: 2 }), { color: 0xffffff, segments: 16, round: "both" });
    expect(volume(domed)).toBeGreaterThan(volume(flat));
    domed.computeBoundingBox();
    expect(domed.boundingBox!.min.z).toBeLessThan(-1.05);
    expect(domed.boundingBox!.max.z).toBeGreaterThan(0.05);
  });

  it("a per-point side axis keeps a ribbon wrapped around a cylinder wide along the surface", () => {
    // A ring around a vertical cylinder of radius 1, ribbon 0.2 wide (tall) and 0.02 thick: the wide axis must stay vertical.
    const spine: V3[] = [];
    const normals: V3[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 1.5;
      spine.push([Math.sin(a), 0, Math.cos(a)]);
      normals.push([Math.sin(a), 0, Math.cos(a)]);
    }
    const g = sweepGeometry(spine, () => ({ rx: 0.1, rz: 0.01, pow: 3 }), { color: 0xffffff, segments: 8, sideAt: () => [0, 1, 0] });
    expect(volume(g)).toBeGreaterThan(0);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeGreaterThan(0.09);
    expect(g.boundingBox!.max.y).toBeLessThan(0.11);
    void normals;
  });
});
