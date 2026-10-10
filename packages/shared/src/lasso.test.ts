import { describe, expect, it } from "vitest";
import { LASSO, dragHurt, findRopeTarget } from "./lasso.ts";

/** D-106: the lariat's rules. */
describe("D-106: the lariat", () => {
  const BLOCKED = 1 | 2;
  type Row = { x: number; z: number; npc: number; flags: number };
  const find = (me: { x: number; z: number; facing: number }, rows: Record<string, Row>): string | undefined =>
    findRopeTarget<string>(me, (cb) => Object.entries(rows).forEach(([k, o]) => cb(k, o)), BLOCKED);
  const me = { x: 0, z: 0, facing: 0 }; // (facing 0 looks down -Z)

  it("aims at the nearest NPC on his feet in a narrow cone ahead, within the rope's reach", () => {
    expect(find(me, { a: { x: 0, z: -8, npc: 1, flags: 0 } })).toBe("a");
    expect(find(me, { a: { x: 0, z: -(LASSO.range + 0.5), npc: 1, flags: 0 } })).toBeUndefined();
    expect(find(me, { a: { x: 4, z: -4, npc: 1, flags: 0 } })).toBeUndefined(); // (45 degrees off: outside the cone)
    expect(find(me, { a: { x: 0, z: 6, npc: 1, flags: 0 } })).toBeUndefined(); // (behind)
    expect(find(me, { a: { x: 0, z: -6, npc: 0, flags: 0 } })).toBeUndefined(); // (a player)
    expect(find(me, { a: { x: 0, z: -6, npc: 1, flags: 2 } })).toBeUndefined(); // (blocked: down, held, a beast, a rider)
    expect(find(me, { a: { x: 0, z: -0.3, npc: 1, flags: 0 } })).toBeUndefined(); // (too close to throw at: that is a collar, not a lasso)
    expect(find(me, { far: { x: 0.5, z: -9, npc: 1, flags: 0 }, near: { x: -0.4, z: -5, npc: 1, flags: 0 } })).toBe("near");
  });

  it("the ground hurts only past a run, and more the faster he is hauled", () => {
    expect(dragHurt(0)).toBe(0);
    expect(dragHurt(LASSO.hurtSpeed)).toBe(0);
    expect(dragHurt(LASSO.hurtSpeed * 2)).toBeCloseTo(LASSO.dps, 9);
    expect(dragHurt(LASSO.pullSpeed)).toBeGreaterThan(dragHurt(LASSO.hurtSpeed * 2));
    expect(dragHurt(Number.NaN)).toBe(0);
  });
});
