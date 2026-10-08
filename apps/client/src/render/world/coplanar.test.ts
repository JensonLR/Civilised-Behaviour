import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferAttribute, type BufferGeometry } from "three";
import { LIFT, separateCoplanar } from "./coplanar.ts";

/** A coloured box at a spot (a Kit part). */
function box(w: number, h: number, d: number, x: number, y: number, z: number, rgb: [number, number, number]): BufferGeometry {
  const g = new BoxGeometry(w, h, d).toNonIndexed();
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute("color", new BufferAttribute(c, 3));
  g.translate(x, y, z);
  return g;
}
const centre = (g: BufferGeometry): number[] => {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  return [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
};
const PLASTER: [number, number, number] = [0.8, 0.75, 0.6];
const TIMBER: [number, number, number] = [0.3, 0.2, 0.1];

describe("D-080: coplanar faces of different colours never fight", () => {
  it("a beam laid flush on a wall (same face plane) is lifted off it along the face's normal; the wall stays", () => {
    const wall = box(4, 3, 0.3, 0, 1.5, 0, PLASTER); // front face at z = 0.15
    const beam = box(0.2, 3, 0.2, 0, 1.5, 0.05, TIMBER); // front face also at z = 0.15
    expect(separateCoplanar([wall, beam])).toBe(1);
    expect(centre(wall)).toEqual([0, 1.5, 0]);
    expect(centre(beam)[2]).toBeCloseTo(0.05 + LIFT, 6);
  });

  it("the same colour flush is left alone (nobody can see that fight), and so are faces that only meet at an edge", () => {
    expect(separateCoplanar([box(4, 3, 0.3, 0, 1.5, 0, PLASTER), box(0.2, 3, 0.2, 0, 1.5, 0.05, PLASTER)])).toBe(0);
    // two blocks side by side, touching edge to edge
    expect(separateCoplanar([box(1, 1, 1, 0, 0.5, 0, PLASTER), box(1, 1, 1, 1, 0.5, 0, TIMBER)])).toBe(0);
  });

  it("a row of overlapping blocks in alternating shades ends with every neighbour apart, and nothing moved more than three lifts", () => {
    const shades: [number, number, number][] = [PLASTER, [0.6, 0.55, 0.45]];
    const row = Array.from({ length: 8 }, (_, i) => box(1.2, 0.6, 0.4, i * 1.0, 0.3, 0, shades[i % 2]!));
    separateCoplanar(row);
    for (let i = 0; i + 1 < row.length; i++) {
      const a = centre(row[i]!), b = centre(row[i + 1]!);
      // their front faces (z = +0.2 before) are no longer in one plane, or one was lifted along another of its overlapping faces
      const apart = Math.abs(a[0]! - (i * 1.0)) + Math.abs(a[1]! - 0.3) + Math.abs(a[2]!) + Math.abs(b[0]! - (i + 1)) + Math.abs(b[1]! - 0.3) + Math.abs(b[2]!);
      expect(apart, `blocks ${i}, ${i + 1}`).toBeGreaterThan(LIFT * 0.5);
    }
    for (let i = 0; i < row.length; i++) {
      const c = centre(row[i]!);
      expect(Math.hypot(c[0]! - i, c[1]! - 0.3, c[2]!)).toBeLessThanOrEqual(LIFT * 3 + 1e-9);
    }
  });
});
