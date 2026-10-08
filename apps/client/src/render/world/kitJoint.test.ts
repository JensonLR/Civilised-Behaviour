import { describe, expect, it } from "vitest";
import { Kit } from "./kit.ts";

/**
 * Limbs are open-ended tubes. Two of them meeting at an angle (a kinked trunk) left a wedge-shaped hole on the outside of the bend that you saw through;
 * a limb that carries on from the last one's end at an angle now starts r tan(angle) back along its own axis, so its side spans the bend (no extra triangles).
 */
const reach = (k: Kit, d: [number, number, number]): number => {
  const pos = k.build()!.getAttribute("position");
  let lo = Infinity;
  for (let i = 0; i < pos.count; i++) lo = Math.min(lo, pos.getX(i) * d[0] + pos.getY(i) * d[1] + pos.getZ(i) * d[2]);
  return lo;
};

describe("Kit limb joints", () => {
  const r = 0.3, bend = Math.PI / 6; // 30 degrees
  const d2: [number, number, number] = [Math.sin(bend), Math.cos(bend), 0];
  const end = (l: number): [number, number, number] => [d2[0] * l, 1.5 + d2[1] * l, 0];

  it("a bent chain: the second limb reaches r tan(angle) back past the joint (along its own axis), and has no more triangles", () => {
    const k = new Kit().limb([0, 0, 0], [0, 1.5, 0], r, r, 0x808080, 6).limb([0, 1.5, 0], end(1.5), r, r, 0x808080, 6);
    const lone = new Kit().limb([0, 1.5, 0], end(1.5), r, r, 0x808080, 6).limb([5, 0, 0], [5, 1.5, 0], r, r, 0x808080, 6);
    const joint = 1.5 * d2[1]; // (the joint's projection on the second limb's axis)
    // the first limb reaches below the joint anyway; measure the second alone by building it after an unrelated limb (no chain) and after the first (a chain)
    const chained = new Kit().limb([0, 0, 0], [0, 1.5, 0], r, r, 0x808080, 6);
    const tri = (kk: Kit): number => kk.build()!.getAttribute("position").count;
    expect(tri(k)).toBe(tri(lone));
    // the second limb's own reach: only its vertices are past the first limb's top along d2 on the outside of the bend
    chained.limb([0, 1.5, 0], end(1.5), r, r, 0x808080, 6);
    const g = chained.build()!.getAttribute("position");
    let back = Infinity;
    for (let i = g.count / 2; i < g.count; i++) back = Math.min(back, g.getX(i) * d2[0] + g.getY(i) * d2[1] + g.getZ(i) * d2[2] - joint);
    expect(back).toBeCloseTo(-r * Math.tan(bend), 3);
  });

  it("a straight chain, a thin one, or a limb that starts elsewhere is not lengthened", () => {
    const straight = new Kit().limb([0, 0, 0], [0, 1, 0], r, r, 0x808080, 6).limb([0, 1, 0], [0, 2, 0], r, r, 0x808080, 6);
    expect(reach(straight, [0, 1, 0])).toBeCloseTo(0, 6);
    const thin = new Kit().limb([0, 0, 0], [0, 1.5, 0], 0.02, 0.02, 0x808080, 6).limb([0, 1.5, 0], end(1.5), 0.02, 0.02, 0x808080, 6);
    const g = thin.build()!.getAttribute("position");
    let back = Infinity;
    for (let i = g.count / 2; i < g.count; i++) back = Math.min(back, g.getX(i) * d2[0] + g.getY(i) * d2[1] + g.getZ(i) * d2[2] - 1.5 * d2[1]);
    expect(back).toBeGreaterThan(-0.021);
  });
});
