import { describe, expect, it } from "vitest";
import { BUTTON, STEP_DT } from "./constants.ts";
import { CollisionWorld } from "./collision.ts";
import { createCharState, stepCharacter, type MoveCommand } from "./movement.ts";
import { MOUNT_FLAG, stepMounted, trailStep, type Trailer } from "./mount.ts";
import { bytesPerCall } from "./bytesPerCall.testutil.ts";

/**
 * `trailStep` is allocation-free (CLAUDE.md: the shared steps' hot loops allocate nothing). It is measured HERE, in a file of its own and on a world that costs nothing, because the bytes a
 * step allocates in a shared test file depend on what else has run through the same call sites (see `bytesPerCall.testutil.ts`): in `mount.test.ts` the same function reads 0 or 64 B per step
 * by the order of the tests. A fresh file is a fresh module, so every call site here is monomorphic and the engine inlines the stub world: what is left is the function's own doing. (The
 * real find: `Math.hypot(dx, dz)` was a builtin call that boxed both arguments and the result, 38 B on every step of every wagon; it is a square root of a sum now.)
 */
describe("trailStep allocation", () => {
  const still = { terrainHeight: () => 0, groundHeight: () => 0, resolveXZ: () => false } as unknown as CollisionWorld;

  it("allocates nothing per step, with a height and without", () => {
    const t: Trailer = { x: 0, z: 3, facing: 0, y: 0 };
    const u: Trailer = { x: 0, z: 3, facing: 0 }; // (no height: the other branch)
    // (integer arguments: a double passed to a function that is not inlined is boxed by the engine, which would be the test allocating, not the step)
    const withY = bytesPerCall((i) => {
      trailStep(t, (i >> 2) & 7, (i >> 5) & 7, STEP_DT, still);
    });
    const noY = bytesPerCall((i) => {
      trailStep(u, (i >> 3) & 7, (i >> 6) & 7, STEP_DT, still);
    });
    expect(withY).toBeLessThanOrEqual(8);
    expect(noY).toBeLessThanOrEqual(8);
  });

  it("the meter sees a real allocation (an array per step reads as at least 16 B), so the allowance above cannot hide one", () => {
    let sink: unknown;
    const array = bytesPerCall((i) => {
      sink = [i, i + 1];
    });
    expect(sink).toBeDefined();
    expect(array).toBeGreaterThanOrEqual(16);
  });

  it("a rider's step costs what a walker's step costs (their own code: a flat world with a rock and a wall to push against), and neither more than a few boxed numbers", () => {
    // (On a real world both read hundreds of bytes and the rider ~1.6x the walker: that is the engine boxing the terrain's noise samples, which the horse takes more of, not the step. The old
    // comparison there read 27 B or 101 B on the same commit, by whether a scavenge fell inside its 20,000-call windows: bytesPerCall.testutil.ts.)
    const w = new CollisionWorld({ height: () => 0 }, [
      { kind: "circle", tag: "rock", x: 6, z: 0, r: 1, y0: -1, y1: 2 },
      { kind: "box", tag: "wall", x: -6, z: 0, hx: 1, hz: 3, yaw: 0.3, y0: -1, y1: 3 },
    ], 60);
    const m = createCharState(0, 0, w);
    m.flags |= MOUNT_FLAG.MOUNTED;
    const k = createCharState(0, 0, w);
    const c: MoveCommand = { moveF: 127, moveR: 0, yaw: 0, buttons: BUTTON.SPRINT };
    const mounted = bytesPerCall((i) => {
      c.yaw = (i * 37) & 0xffff;
      if ((i & 255) === 0) m.x = m.z = 0; // (back to the middle now and then: the body keeps meeting the rock and the wall)
      stepMounted(m, c, STEP_DT, w);
    });
    const walker = bytesPerCall((i) => {
      c.yaw = (i * 37) & 0xffff;
      if ((i & 255) === 0) k.x = k.z = 0;
      stepCharacter(k, c, STEP_DT, w);
    });
    expect(mounted).toBeLessThanOrEqual(walker + 16);
    expect(mounted).toBeLessThanOrEqual(64);
    expect(walker).toBeLessThanOrEqual(64);
  });
});
