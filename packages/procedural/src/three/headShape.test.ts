import { describe, expect, it } from "vitest";
import { generateCharacter } from "../spec.ts";
import { computeProportions } from "../proportions.ts";
import { buildSkull, headShape, skinRamp } from "./headShape.ts";
import { buildShell } from "./shell.ts";
import { PartBuilder } from "./parts.ts";

const shapeFor = (seed: number, over: Record<string, number> = {}) => {
  const spec = { ...generateCharacter(seed), ...over };
  const P = computeProportions(spec);
  return { P, shape: headShape(P), R: P.headRadius };
};
const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

describe("headShape", () => {
  it("is mirror-symmetric, positive and finite in every direction, for many characters", () => {
    for (let seed = 0; seed < 40; seed++) {
      const { shape, R } = shapeFor(seed);
      for (let i = 0; i < 200; i++) {
        const [x, y, z] = unit(Math.sin(i * 1.7) * 3, Math.cos(i * 0.9) * 2, Math.sin(i * 2.9) * 3 + 0.01);
        const r = shape.radius(x, y, z);
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThan(R * 0.5);
        expect(r).toBeLessThan(R * 1.4);
        expect(shape.radius(-x, y, z)).toBeCloseTo(r, 6);
      }
    }
  });

  it("carries the face features it is sculpted for: recessed eye sockets, a brow ridge, cheekbones, a mouth groove between the lips", () => {
    const { shape, R } = shapeFor(4);
    const base = (x: number, y: number, z: number) => shape.radius(...unit(x, y, z)) / R;
    const socket = base(0.4, 0.1, -0.91);
    const brow = base(0.36, 0.31, -0.88);
    const cheek = base(0.56, -0.14, -0.8);
    const forehead = base(0, 0.75, -0.6);
    expect(brow).toBeGreaterThan(socket + 0.08); // the ridge stands above the socket
    expect(cheek).toBeGreaterThan(socket);
    const upperLip = base(0, -0.42, -0.9);
    const groove = base(0, -0.485, -0.87);
    const lowerLip = base(0, -0.56, -0.85);
    expect(upperLip).toBeGreaterThan(groove);
    expect(lowerLip).toBeGreaterThan(groove);
    void forehead;
  });

  it("front(x, y) lands exactly on the skin, and its normal points away from the head", () => {
    const { shape, R } = shapeFor(9);
    for (const [x, y] of [[0, 0], [0.4, 0.1], [-0.3, -0.45], [0.1, 0.6], [0, -0.85]] as const) {
      const p = shape.front(x * R, y * R);
      const l = Math.hypot(...p);
      expect(l).toBeCloseTo(shape.radius(p[0] / l, p[1] / l, p[2] / l), 3);
      expect(p[2]).toBeLessThan(0); // the face is toward -Z
      const n = shape.normal(p);
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]).toBeGreaterThan(0);
    }
  });

  it("the jaw slider widens the lower face and leaves the cranium alone", () => {
    const narrow = shapeFor(7, { jaw: 0 });
    const wide = shapeFor(7, { jaw: 255 });
    const at = (s: { shape: ReturnType<typeof headShape>; R: number }, y: number) => s.shape.radius(...unit(1, y, 0.001)) / s.R;
    expect(at(wide, -0.6)).toBeGreaterThan(at(narrow, -0.6) + 0.05);
    expect(Math.abs(at(wide, 0.5) - at(narrow, 0.5))).toBeLessThan(0.02);
  });

  it("memoises per proportions (the skull, hair, beard and wounds all query the same object)", () => {
    const a = shapeFor(3);
    const b = shapeFor(3);
    expect(a.shape).toBe(b.shape);
  });
});

describe("buildSkull and shells", () => {
  it("the skull is a watertight-ish closed surface with unit outward analytic normals and baked blush", () => {
    const { shape, P } = shapeFor(5);
    const g = buildSkull(shape, { skin: 0xd39a76 });
    const pos = g.attributes.position!;
    const nor = g.attributes.normal!;
    for (let i = 0; i < pos.count; i++) {
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 4);
      expect(pos.getX(i) * nor.getX(i) + pos.getY(i) * nor.getY(i) + pos.getZ(i) * nor.getZ(i)).toBeGreaterThan(-1e-4);
    }
    expect(P.headRadius).toBeGreaterThan(0);
    // cheeks are pinker than the forehead: red share of the colour rises while green falls
    const col = g.attributes.color!;
    let cheek = -1;
    let forehead = -1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (Math.abs(x - 0.55 * P.headRadius) < 0.02 && Math.abs(y + 0.2 * P.headRadius) < 0.03 && z < 0) cheek = i;
      if (Math.abs(x) < 0.02 && y > 0.6 * P.headRadius && y < 0.75 * P.headRadius && z < 0) forehead = i;
    }
    expect(cheek).toBeGreaterThanOrEqual(0);
    expect(forehead).toBeGreaterThanOrEqual(0);
    const ratio = (i: number) => col.getX(i) / (col.getY(i) + 1e-6);
    expect(ratio(cheek)).toBeGreaterThan(ratio(forehead));
  });

  it("skin ramp shifts are relative: dark skin stays dark, and every derived colour keeps the skin's own hue family", () => {
    for (const hex of [0xf2c7a5, 0xa66a43, 0x6b4229]) {
      const r = skinRamp(hex);
      expect(r.blush.r).toBeGreaterThanOrEqual(r.skin.r * 0.99);
      expect(r.blush.g).toBeLessThan(r.skin.g);
      expect(r.shade.r + r.shade.g + r.shade.b).toBeLessThan(r.skin.r + r.skin.g + r.skin.b);
      expect(r.lip.r).toBeGreaterThan(r.lip.g * 1.3);
    }
  });

  it("a hair shell lies outside the skin everywhere, follows the sculpt, and its edge sits on the skin", () => {
    const { shape, R } = shapeFor(6);
    const g = buildShell(shape, {
      color: 0x6a4423,
      mask: (d) => (d.y > 0.4 ? 1 : d.y > 0.3 ? (d.y - 0.3) / 0.1 : 0),
      thick: () => 0.1,
    })!;
    expect(g).toBeDefined();
    const pos = g.attributes.position!;
    let onSkin = 0;
    let proud = 0;
    for (let i = 0; i < pos.count; i++) {
      const l = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      const r = shape.radius(pos.getX(i) / l, pos.getY(i) / l, pos.getZ(i) / l);
      expect(l).toBeGreaterThanOrEqual(r - 1e-4);
      if (l - r < 0.0025) onSkin++;
      if (l - r > 0.07 * R) proud++;
    }
    expect(onSkin).toBeGreaterThan(5); // feathered edge lies on the skin (clipped at the mask iso-line, not the grid)
    expect(proud).toBeGreaterThan(20); // the body of the shell stands off it
  });

  it("an empty mask yields no geometry, and the outline hull builds from a coarse grid with far fewer triangles", () => {
    const { shape } = shapeFor(6);
    expect(buildShell(shape, { color: 0, mask: () => 0, thick: () => 0.1 })).toBeUndefined();
    const fine = buildSkull(shape, { skin: 0xd39a76 });
    const coarse = buildSkull(shape, { skin: 0xd39a76, coarse: true });
    expect(coarse.index!.count).toBeLessThan(fine.index!.count * 0.5);
    expect(PartBuilder.hullMode).toBe(false);
  });
});
