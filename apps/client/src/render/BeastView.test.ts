import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { FLAG, type PlayerStateType } from "@cb/shared";
import { BeastView } from "./BeastView.ts";

/** D-094: the beast's view follows its row, walks with its speed, lies down on its side when down, and is gone with its row; people are never drawn here. */
describe("BeastView", () => {
  const rowOf = (o: Partial<PlayerStateType>): PlayerStateType => ({ x: 0, y: 0.5, z: 0, facing: 0, flags: FLAG.GROUNDED | FLAG.BEAST, ...o }) as unknown as PlayerStateType;
  const pos = (p: PlayerStateType, k: "x" | "y" | "z"): number => (p as unknown as Record<string, number>)[k]!;

  it("draws a beast where its row is (and never a person), lies it on its side, centred, when down, and drops it with its row", () => {
    const scene = new Scene();
    const v = new BeastView(scene, true);
    const beast = rowOf({ x: 4, z: -2, facing: 1 });
    const man = rowOf({ flags: FLAG.GROUNDED });
    const rows = new Map<string, PlayerStateType>([["npc:grey", beast], ["sid", man]]);
    v.update(1 / 30, rows, pos);
    expect(scene.children).toHaveLength(1);
    const c0 = v.centre("npc:grey")!;
    expect(c0.x).toBeCloseTo(4, 3);
    expect(c0.z).toBeCloseTo(-2, 3);
    expect(c0.y).toBeGreaterThan(1.2);
    expect(v.centre("sid")).toBeUndefined();
    // walking: it moves, and its legs swing
    const root = scene.children[0]!;
    for (let k = 0; k < 30; k++) {
      beast.x += 0.05;
      v.update(1 / 30, rows, pos);
    }
    expect(root.position.x).toBeCloseTo(beast.x, 3);
    const legs = root.children[0]!.children.slice(2);
    expect(legs.some((l) => Math.abs(l.rotation.x) > 0.05)).toBe(true);
    // down: after a second it lies rolled on its side, its middle back over the row, low to the ground
    beast.flags |= FLAG.DOWNED;
    for (let k = 0; k < 40; k++) v.update(1 / 30, rows, pos);
    const body = root.children[0]!;
    expect(body.rotation.z).toBeGreaterThan(1.3);
    expect(v.centre("npc:grey")!.y - beast.y).toBeLessThan(0.7);
    // the barrel's middle: rolled about the feet's line, then put back over the row (within a few centimetres)
    expect(Math.abs(body.position.x - 1.1 * Math.sin(body.rotation.z))).toBeLessThan(0.05);
    // gone with its row
    rows.delete("npc:grey");
    v.update(1 / 30, rows, pos);
    expect(scene.children).toHaveLength(0);
    v.dispose();
  });
});
