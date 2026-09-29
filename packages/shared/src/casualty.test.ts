import { describe, expect, it } from "vitest";
import { BUTTON, FLAG, MOVEMENT, STEP_DT } from "./constants.ts";
import { CASUALTY, findDownedTarget, type CasualtyView } from "./casualty.ts";
import { CollisionWorld } from "./collision.ts";
import { createCharState, stepCharacter, type MoveCommand } from "./movement.ts";

const flat = (obstacles: ConstructorParameters<typeof CollisionWorld>[1] = []) => new CollisionWorld({ height: () => 0 }, obstacles, 100);
const fwd = (over: Partial<MoveCommand> = {}): MoveCommand => ({ moveF: 127, moveR: 0, yaw: 0, buttons: 0, ...over });
const speedAfter = (flags: number, cmd: MoveCommand, steps = 40) => {
  const w = flat();
  const s = createCharState(0, 0, w);
  s.flags |= flags;
  for (let i = 0; i < steps; i++) stepCharacter(s, cmd, STEP_DT, w);
  return { s, speed: Math.hypot(s.vx, s.vz) };
};

describe("flag constants", () => {
  it("casualty.ts hard-codes FLAG.DOWNED to avoid a circular import: keep them equal", () => {
    expect(FLAG.DOWNED).toBe(16);
  });
  it("all flags are distinct bits and fit uint16", () => {
    const vals = Object.values(FLAG);
    expect(new Set(vals).size).toBe(vals.length);
    for (const v of vals) expect(v & (v - 1)).toBe(0); // power of two
    expect(Math.max(...vals)).toBeLessThanOrEqual(0xffff);
  });
});

describe("downed / reviving / dragging movement", () => {
  it("a downed player can only crawl, and cannot sprint or jump", () => {
    const { speed, s } = speedAfter(FLAG.DOWNED, fwd({ buttons: BUTTON.SPRINT | BUTTON.JUMP }));
    expect(speed).toBeCloseTo(MOVEMENT.crawlSpeed, 1);
    expect(s.y).toBe(0);
  });
  it("a reviver holds position while kneeling", () => {
    expect(speedAfter(FLAG.REVIVING, fwd()).speed).toBeLessThan(0.01);
  });
  it("a dragger is slowed and cannot sprint or jump", () => {
    const { speed, s } = speedAfter(FLAG.DRAGGING, fwd({ buttons: BUTTON.SPRINT | BUTTON.JUMP }));
    expect(speed).toBeCloseTo(MOVEMENT.runSpeed * MOVEMENT.dragFactor, 1);
    expect(s.y).toBe(0);
  });
});

describe("dragged bodies (server-steered)", () => {
  it("ignore input entirely and integrate the server-written velocity", () => {
    const w = flat();
    const s = createCharState(0, 0, w);
    s.flags |= FLAG.DOWNED | FLAG.DRAGGED;
    s.vx = 2;
    s.vz = -1;
    const facing = (s.facing = 1.234);
    for (let i = 0; i < 30; i++) stepCharacter(s, fwd({ moveR: -127, buttons: BUTTON.SPRINT | BUTTON.JUMP }), STEP_DT, w);
    expect(s.x).toBeCloseTo(2, 5);
    expect(s.z).toBeCloseTo(-1, 5);
    expect(s.facing).toBe(facing); // facing is server-owned while dragged
    expect(s.y).toBe(0);
    expect(s.flags & FLAG.GROUNDED).toBeTruthy();
    expect(s.vx).toBe(2); // velocity is not decayed by the step; the server owns it
  });
  it("are still stopped by walls, and are deterministic", () => {
    const w = flat([{ kind: "box", x: 3, z: 0, hx: 0.5, hz: 4, yaw: 0, y0: -1, y1: 3 }]);
    const run = () => {
      const s = createCharState(0, 0, w);
      s.flags |= FLAG.DOWNED | FLAG.DRAGGED;
      s.vx = 3;
      for (let i = 0; i < 120; i++) stepCharacter(s, fwd(), STEP_DT, w);
      return s;
    };
    const a = run();
    expect(a.x).toBeLessThanOrEqual(3 - 0.5 - 0.4 + 1e-6);
    expect(run()).toEqual(a);
  });
  it("follow terrain height", () => {
    const hill = new CollisionWorld({ height: (x) => Math.max(0, x * 0.3) }, [], 100);
    const s = createCharState(0, 0, hill);
    s.flags |= FLAG.DOWNED | FLAG.DRAGGED;
    s.vx = 2;
    for (let i = 0; i < 60; i++) stepCharacter(s, fwd(), STEP_DT, hill);
    expect(s.y).toBeCloseTo(s.x * 0.3, 1);
  });
});

describe("findDownedTarget", () => {
  const me: CasualtyView = { x: 0, y: 0, z: 0, facing: 0, flags: 0 };
  const other = (x: number, z: number, flags: number = FLAG.DOWNED, y = 0): CasualtyView => ({ x, y, z, facing: 0, flags });
  const find = (list: CasualtyView[], range = CASUALTY.reviveRange) => findDownedTarget<number>(me, range, (cb) => list.forEach((o, i) => cb(i, o)));

  it("finds a downed teammate in front within range", () => expect(find([other(0, -1.2)])).toBe(0));
  it("ignores healthy players", () => expect(find([other(0, -1, 0)])).toBeUndefined());
  it("ignores anyone out of range or on another level", () => {
    expect(find([other(0, -5)])).toBeUndefined();
    expect(find([other(0, -1, FLAG.DOWNED, 3)])).toBeUndefined();
  });
  it("prefers the closer one; accepts a very close body behind you", () => {
    expect(find([other(0, -1.6), other(0.2, -0.8)])).toBe(1);
    expect(find([other(0, 0.5)])).toBe(0);
    expect(find([other(0, 1.5)])).toBeUndefined(); // behind and not adjacent
  });
});
