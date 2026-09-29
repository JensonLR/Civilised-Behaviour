import { beforeAll, describe, expect, it } from "vitest";
import { PropKind, createArena } from "@cb/shared";
import { PhysicsWorld, initRapier } from "./physics.ts";

beforeAll(async () => initRapier());

describe("PhysicsWorld", () => {
  it("terrain heightfield matches the analytic terrain the players walk on", () => {
    const arena = createArena(42);
    const phys = new PhysicsWorld(arena);
    // Sample well away from obstacles by dropping bottles on a grid and checking where they settle.
    const spots: [number, number][] = [[20, 15], [-25, 30], [40, -35], [-45, -20], [10, 50], [-5, -60]];
    const bodies = spots.map(([x, z]) => {
      // Skip spots that overlap obstacles (their colliders would legitimately hold the prop up).
      let blocked = false;
      arena.forEachNear(x, z, (o) => {
        const d = Math.hypot(o.x - x, o.z - z);
        if (d < (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + 1.5) blocked = true;
      });
      return blocked ? undefined : { x, z, p: phys.spawnProp({ kind: PropKind.BOTTLE, x, z, yaw: 0 }, arena.terrainHeight(x, z) + 1.5)! };
    });
    for (let i = 0; i < 150; i++) phys.step(1 / 30);
    let checked = 0;
    for (const b of bodies) {
      if (!b) continue;
      const t = b.p.body.translation();
      // Sitting on a slope it may have rolled, so compare against the terrain under where it ended up.
      const under = arena.terrainHeight(t.x, t.z) + 0.15; // bottle half-height (0.1) + radius (0.05)
      expect(Math.abs(t.y - under)).toBeLessThan(0.25);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
    phys.dispose();
  });

  it("props fall asleep when at rest (idle rooms cost nothing)", () => {
    const arena = createArena(7);
    const phys = new PhysicsWorld(arena);
    const p = phys.spawnProp({ kind: PropKind.CRATE, x: 3, z: 3, yaw: 0.4 }, arena.terrainHeight(3, 3));
    for (let i = 0; i < 240; i++) phys.step(1 / 30);
    expect(p!.body.isSleeping()).toBe(true);
    phys.dispose();
  });

  it("enforces the prop cap", () => {
    const arena = createArena(1);
    const phys = new PhysicsWorld(arena);
    let made = 0;
    for (let i = 0; i < 80; i++) if (phys.spawnProp({ kind: PropKind.CRATE, x: i % 9, z: 3, yaw: 0 }, 0)) made++;
    expect(made).toBe(48);
    phys.dispose();
  });

  it("a held prop follows its holder and a released prop keeps the throw velocity", () => {
    const arena = createArena(3);
    const phys = new PhysicsWorld(arena);
    const p = phys.spawnProp({ kind: PropKind.BARREL, x: 2, z: 2, yaw: 0 }, arena.terrainHeight(2, 2))!;
    expect(phys.hold(p.id, "p1")).toBe(true);
    expect(phys.hold(p.id, "p2")).toBe(false); // already held
    phys.moveHeld(p.id, 5, 1.2, 5, 0);
    phys.step(1 / 30);
    const held = p.body.translation();
    expect(held.x).toBeCloseTo(5, 1);
    expect(held.y).toBeCloseTo(1.2, 1);
    phys.release(p.id, 8, 3, 0);
    for (let i = 0; i < 12; i++) phys.step(1 / 30);
    expect(p.body.translation().x).toBeGreaterThan(6.5);
    phys.dispose();
  });
});
