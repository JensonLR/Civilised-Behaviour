import type { BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { loftGeometry, type Ring } from "./loft.ts";

/** Signed volume of a closed indexed mesh: positive when the faces point outward. */
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

const tube: Ring[] = [
  { y: 0, rx: 0.5, rz: 0.4 },
  { y: 1, rx: 0.6, rz: 0.5 },
  { y: 2, rx: 0.4, rz: 0.3 },
];

describe("loftGeometry", () => {
  it("is a closed solid with outward faces whichever way the sections are listed (limbs hang downwards)", () => {
    const up = loftGeometry(tube, { color: 0xffffff });
    const down = loftGeometry(tube.map((r) => ({ ...r, y: -r.y })), { color: 0xffffff });
    expect(volume(up)).toBeGreaterThan(0.5);
    expect(volume(down)).toBeGreaterThan(0.5);
    expect(volume(down)).toBeCloseTo(volume(up), 3);
  });

  it("outward normals: every side vertex's normal points away from the axis", () => {
    for (const rings of [tube, tube.map((r) => ({ ...r, y: -r.y }))]) {
      const g = loftGeometry(rings, { color: 0xffffff, capBottom: false, capTop: false });
      const p = g.attributes.position!;
      const n = g.attributes.normal!;
      for (let i = 0; i < p.count; i++) expect(p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i)).toBeGreaterThan(0);
    }
  });

  it("a crease keeps a hard edge: the vertices there are duplicated, so normals do not blend across it", () => {
    const smooth = loftGeometry(tube, { color: 0xffffff, segments: 8 });
    const creased = loftGeometry([tube[0]!, { ...tube[1]!, crease: true }, tube[2]!], { color: 0xffffff, segments: 8 });
    expect(creased.attributes.position!.count).toBe(smooth.attributes.position!.count + 8);
  });

  it("carries per-section colours and the attributes the part merger needs", () => {
    const g = loftGeometry([{ y: 0, rx: 1, rz: 1, color: 0xff0000 }, { y: 1, rx: 1, rz: 1, color: 0x0000ff }], { color: 0x00ff00, capBottom: false, capTop: false });
    const c = g.attributes.color!;
    expect(c.getX(0)).toBeGreaterThan(c.getZ(0)); // bottom ring red
    expect(c.getZ(g.attributes.position!.count - 1)).toBeGreaterThan(c.getX(g.attributes.position!.count - 1)); // top ring blue
    expect(g.attributes.normal).toBeDefined();
    expect(g.attributes.uv).toBeDefined();
    expect(g.index).not.toBeNull();
  });

  it("the front of the section faces -Z (the character's front)", () => {
    const g = loftGeometry(tube, { color: 0xffffff, capBottom: false, capTop: false });
    const p = g.attributes.position!;
    let minZ = Infinity;
    let at = 0;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < minZ) ((minZ = p.getZ(i)), (at = i));
    expect(Math.abs(p.getX(at))).toBeLessThan(0.01);
    expect(minZ).toBeLessThan(-0.39);
  });
});
