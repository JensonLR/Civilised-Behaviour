import { describe, expect, it } from "vitest";
import { STEP_DT } from "./constants.ts";
import type { CollisionWorld } from "./collision.ts";
import { trailStep, type Trailer } from "./mount.ts";
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
});
