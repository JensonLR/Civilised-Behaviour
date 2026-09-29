import { describe, expect, it } from "vitest";
import { BUTTON, FLAG, STEP_DT } from "./constants.ts";
import { CollisionWorld, type Obstacle } from "./collision.ts";
import { createArena, ARENA_RADIUS } from "./arena.ts";
import { Rng, hash3 } from "./rng.ts";
import { createTerrain } from "./terrain.ts";
import { createCharState, stepCharacter, axisToWire, yawToWire, type MoveCommand } from "./movement.ts";

const flat = (obstacles: Obstacle[] = []) => new CollisionWorld({ height: () => 0 }, obstacles, 100);
const fwd = (over: Partial<MoveCommand> = {}): MoveCommand => ({ moveF: 127, moveR: 0, yaw: 0, buttons: 0, ...over });

describe("rng + terrain determinism", () => {
  it("hash3 is stable", () => {
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(1, 3, 2));
  });
  it("Rng streams are reproducible and seed-sensitive", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 8 }, () => a.next());
    expect(seqA).toEqual(Array.from({ length: 8 }, () => b.next()));
    expect(new Rng(43).next()).not.toBe(seqA[0]);
  });
  it("terrain is deterministic, flat at the hub, and bounded", () => {
    const t1 = createTerrain(7);
    const t2 = createTerrain(7);
    expect(t1.height(33.3, -12.1)).toBe(t2.height(33.3, -12.1));
    expect(Math.abs(t1.height(1, 1))).toBeLessThan(1e-9);
    for (let i = 0; i < 200; i++) expect(Math.abs(t1.height(i * 3.7, -i * 2.9))).toBeLessThan(6);
  });
});

describe("stepCharacter", () => {
  it("accelerates to run speed heading forward (-Z at yaw 0)", () => {
    const w = flat();
    const s = createCharState(0, 0, w);
    for (let i = 0; i < 30; i++) stepCharacter(s, fwd(), STEP_DT, w);
    expect(s.z).toBeLessThan(-3);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(4.4, 1);
  });

  it("camera yaw rotates movement", () => {
    const w = flat();
    const s = createCharState(0, 0, w);
    const cmd = fwd({ yaw: yawToWire(Math.PI / 2) }); // camera looks toward -X
    for (let i = 0; i < 30; i++) stepCharacter(s, cmd, STEP_DT, w);
    expect(s.x).toBeLessThan(-3);
    expect(Math.abs(s.z)).toBeLessThan(0.05);
  });

  it("is bit-for-bit deterministic across replays", () => {
    const w = createArena(99);
    const rng = new Rng(5);
    const cmds: MoveCommand[] = Array.from({ length: 600 }, () => ({
      moveF: axisToWire(rng.range(-1, 1)),
      moveR: axisToWire(rng.range(-1, 1)),
      yaw: yawToWire(rng.range(0, 6.28)),
      buttons: rng.chance(0.2) ? BUTTON.JUMP : rng.chance(0.3) ? BUTTON.SPRINT : 0,
    }));
    const run = () => {
      const s = createCharState(3, 3, w);
      for (const c of cmds) stepCharacter(s, c, STEP_DT, w);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("cannot walk through a wall", () => {
    const w = flat([{ kind: "box", x: 0, z: -5, hx: 4, hz: 0.5, yaw: 0, y0: -1, y1: 3 }]);
    const s = createCharState(0, 0, w);
    for (let i = 0; i < 120; i++) stepCharacter(s, fwd({ buttons: BUTTON.SPRINT }), STEP_DT, w);
    expect(s.z).toBeGreaterThan(-4.5 + 0.39);
  });

  it("slides along a wall rather than sticking", () => {
    const w = flat([{ kind: "box", x: 0, z: -5, hx: 20, hz: 0.5, yaw: 0, y0: -1, y1: 3 }]);
    const s = createCharState(0, -3, w);
    const cmd = fwd({ moveR: 127 });
    for (let i = 0; i < 60; i++) stepCharacter(s, cmd, STEP_DT, w);
    expect(s.x).toBeGreaterThan(3);
  });

  it("steps onto a low crate but is blocked by a tall one", () => {
    const low = flat([{ kind: "box", x: 0, z: -3, hx: 1, hz: 1, yaw: 0, y0: 0, y1: 0.4 }]);
    const s1 = createCharState(0, 0, low);
    for (let i = 0; i < 20; i++) stepCharacter(s1, fwd(), STEP_DT, low);
    expect(s1.z).toBeLessThan(-2); // mid-crate
    expect(s1.y).toBeCloseTo(0.4, 5); // standing on top of it
    const tall = flat([{ kind: "box", x: 0, z: -3, hx: 1, hz: 1, yaw: 0, y0: 0, y1: 1.5 }]);
    const s2 = createCharState(0, 0, tall);
    for (let i = 0; i < 60; i++) stepCharacter(s2, fwd(), STEP_DT, tall);
    expect(s2.z).toBeGreaterThanOrEqual(-1.6 - 1e-6); // stopped one radius short of the crate face at z=-2
    expect(s2.y).toBe(0);
  });

  it("jumps, peaks below 1.2 m and lands", () => {
    const w = flat();
    const s = createCharState(0, 0, w);
    let peak = 0;
    let airborne = false;
    for (let i = 0; i < 60; i++) {
      stepCharacter(s, { moveF: 0, moveR: 0, yaw: 0, buttons: i < 3 ? BUTTON.JUMP : 0 }, STEP_DT, w);
      peak = Math.max(peak, s.y);
      if ((s.flags & FLAG.GROUNDED) === 0) airborne = true;
    }
    expect(airborne).toBe(true);
    expect(peak).toBeGreaterThan(0.7);
    expect(peak).toBeLessThan(1.2);
    expect(s.y).toBe(0);
    expect(s.flags & FLAG.GROUNDED).toBeTruthy();
  });

  it("holding jump does not bunny-hop (latch)", () => {
    const w = flat();
    const s = createCharState(0, 0, w);
    let takeoffs = 0;
    let wasGrounded = true;
    for (let i = 0; i < 90; i++) {
      stepCharacter(s, { moveF: 0, moveR: 0, yaw: 0, buttons: BUTTON.JUMP }, STEP_DT, w);
      const g = (s.flags & FLAG.GROUNDED) !== 0;
      if (wasGrounded && !g) takeoffs++;
      wasGrounded = g;
    }
    expect(takeoffs).toBe(1);
  });

  it("stumble strips control", () => {
    const w = flat();
    const s = createCharState(0, 0, w);
    s.stumble = 0.5;
    for (let i = 0; i < 10; i++) stepCharacter(s, fwd(), STEP_DT, w);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(1.6);
  });

  it("stays inside world bounds", () => {
    const w = createArena(1);
    const s = createCharState(ARENA_RADIUS - 5, 0, w);
    const cmd = fwd({ yaw: yawToWire(-Math.PI / 2), buttons: BUTTON.SPRINT }); // camera toward +X
    for (let i = 0; i < 300; i++) stepCharacter(s, cmd, STEP_DT, w);
    expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(ARENA_RADIUS);
  });

  it("does not climb near-vertical terrain", () => {
    const cliff = new CollisionWorld({ height: (x) => (x > 3 ? 8 : 0) }, [], 100);
    const s = createCharState(0, 0, cliff);
    const cmd = fwd({ yaw: yawToWire(-Math.PI / 2) });
    for (let i = 0; i < 120; i++) stepCharacter(s, cmd, STEP_DT, cliff);
    expect(s.x).toBeLessThan(3.05);
    expect(s.y).toBe(0);
  });
});
