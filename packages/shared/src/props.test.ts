import { describe, expect, it } from "vitest";
import { BUTTON, FLAG, STEP_DT } from "./constants.ts";
import { CollisionWorld } from "./collision.ts";
import { createCharState, stepCharacter } from "./movement.ts";
import { INTERACT, PropKind, findInteractTarget, holdPosition, type PropView } from "./props.ts";
import { campProps } from "./stores.ts";
import { createArena } from "./arena.ts";
import { createTerrain } from "./terrain.ts";

const prop = (x: number, z: number, over: Partial<PropView> = {}): PropView => ({ kind: PropKind.CRATE, x, y: 0, z, holder: "", ...over });
const target = (player: { x: number; y: number; z: number; facing: number }, props: PropView[]) =>
  findInteractTarget<number>(player, (cb) => props.forEach((p, i) => cb(i, p)));

describe("findInteractTarget", () => {
  const me = { x: 0, y: 0, z: 0, facing: 0 }; // facing -Z

  it("picks a prop in front within range", () => {
    expect(target(me, [prop(0, -1.5)])).toBe(0);
  });
  it("treats an undefined holder (schema default) as free", () => {
    expect(target(me, [prop(0, -1, { holder: undefined })])).toBe(0);
  });
  it("ignores props out of range, behind, held, or at the wrong height", () => {
    expect(target(me, [prop(0, -3)])).toBeUndefined();
    expect(target(me, [prop(0, 1.6)])).toBeUndefined();
    expect(target(me, [prop(0, -1, { holder: "someone" })])).toBeUndefined();
    expect(target(me, [prop(0, -1, { y: 2.5 })])).toBeUndefined();
  });
  it("prefers the nearer, better-centred prop", () => {
    expect(target(me, [prop(1.2, -1.2), prop(0.1, -1.0)])).toBe(1);
  });
  it("respects facing", () => {
    const east = { x: 0, y: 0, z: 0, facing: -Math.PI / 2 };
    expect(target(east, [prop(1.5, 0)])).toBe(0);
    expect(target(east, [prop(-1.5, 0)])).toBeUndefined();
  });
  it("allows grabbing something at your feet regardless of facing", () => {
    expect(target({ ...me, facing: Math.PI }, [prop(0, -0.5)])).toBe(0);
  });
});

describe("carry", () => {
  const flat = () => new CollisionWorld({ height: () => 0 }, [], 100);
  it("slows movement, blocks sprint and jump", () => {
    const w = flat();
    const free = createCharState(0, 0, w);
    const carry = createCharState(0, 0, w);
    carry.flags |= FLAG.CARRYING;
    const cmd = { moveF: 127, moveR: 0, yaw: 0, buttons: BUTTON.SPRINT | BUTTON.JUMP };
    for (let i = 0; i < 30; i++) {
      stepCharacter(free, cmd, STEP_DT, w);
      stepCharacter(carry, cmd, STEP_DT, w);
    }
    expect(Math.hypot(carry.vx, carry.vz)).toBeCloseTo(4.4 * 0.72, 1);
    expect(Math.hypot(free.vx, free.vz)).toBeGreaterThan(6);
    expect(carry.y).toBe(0);
    expect(carry.flags & FLAG.CARRYING).toBeTruthy(); // step never clears server-owned flags
  });
  it("holdPosition is ahead of the facing direction", () => {
    const out = { x: 0, y: 0, z: 0 };
    holdPosition({ x: 5, y: 1, z: 5, facing: 0 }, out);
    expect(out.z).toBeCloseTo(5 - INTERACT.holdForward);
    expect(out.y).toBeCloseTo(1 + INTERACT.holdHeight);
  });
});

describe("campProps (D-115)", () => {
  it("is deterministic, capped, and a little different in every campaign", () => {
    const w = createArena(3);
    const a = campProps(3, w);
    expect(a).toEqual(campProps(3, w));
    expect(a.length).toBeLessThanOrEqual(INTERACT.maxPropsPerRoom);
    expect(campProps(4, w)).not.toEqual(a);
  });
});
