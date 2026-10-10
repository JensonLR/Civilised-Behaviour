import { describe, expect, it } from "vitest";
import { BOOT, CollisionWorld, FLAG, NPC, createCharState, fallDamage, splatDamage, stepCharacter, type MoveCommand, type Obstacle, type PlayerStateType } from "@cb/shared";
import { Flung } from "./Flung.ts";
import type { HitInfo } from "./Casualties.ts";

/** D-108: a thrown body is hurt by the wall it meets at speed and by the drop it falls from; never by a slide on open ground; only NPC rows; credited to the thrower. */
const DT = 1 / 30;
const STILL: MoveCommand = { moveF: 0, moveR: 0, yaw: 0, buttons: 0 };

function rig(obstacles: Obstacle[] = [], height: (x: number, z: number) => number = () => 0) {
  const world = new CollisionWorld({ height }, obstacles, 100);
  const rows = new Map<string, PlayerStateType>();
  const hurts: { id: string; amount: number; hit: HitInfo }[] = [];
  const struck: { id: string; by: string; kind: string; amount: number }[] = [];
  const f = new Flung({
    players: { forEach: (cb) => rows.forEach((p, id) => cb(p, id)), get: (id) => rows.get(id) },
    damage: (id, amount, hit) => {
      hurts.push({ id, amount, hit });
      const p = rows.get(id)!;
      p.health = Math.max(0, p.health - amount);
      if (p.health === 0) p.flags |= FLAG.DOWNED;
    },
    struck: (id, by, kind, amount) => void struck.push({ id, by, kind, amount }),
  });
  const add = (id: string, x: number, z: number, npc: number = NPC.SENTRY): PlayerStateType => {
    const p = { ...createCharState(x, z, world), health: 100, npc, connected: true, wounds: 0, missing: 0 } as unknown as PlayerStateType;
    rows.set(id, p);
    return p;
  };
  /** The boot's knock, as Combat gives it: along (dx, dz) at the blow's speed, lifted off the ground. */
  const boot = (p: PlayerStateType, dx: number, dz: number): void => {
    p.vx += dx * BOOT.blow.knock;
    p.vz += dz * BOOT.blow.knock;
    p.vy = BOOT.lift;
    p.stumble = Math.max(p.stumble, BOOT.blow.stumble);
    p.flags &= ~FLAG.GROUNDED;
  };
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      rows.forEach((p) => stepCharacter(p as never, STILL, DT, world));
      f.tick(DT);
    }
  };
  return { world, rows, hurts, struck, f, add, boot, run };
}

describe("D-108: the rules", () => {
  it("a splat hurts by the speed lost and a fall by the metres beyond the first few; neither under its threshold", () => {
    expect(splatDamage(BOOT.splatSpeed - 0.1)).toBe(0);
    expect(splatDamage(BOOT.splatSpeed)).toBe(BOOT.splatBase);
    expect(splatDamage(9.5)).toBeGreaterThan(splatDamage(6));
    expect(splatDamage(1000)).toBe(BOOT.splatMax);
    expect(fallDamage(BOOT.fallFrom)).toBe(0);
    expect(fallDamage(BOOT.fallFrom + 2)).toBeCloseTo(2 * BOOT.fallPerM, 6);
    expect(fallDamage(1000)).toBe(BOOT.fallMax);
    expect(fallDamage(Number.NaN)).toBe(0);
  });
});

describe("D-108: thrown bodies", () => {
  it("booted into a wall a pace behind him: a splat, credited to the one who booted him, the moment he meets it", () => {
    const { rows, hurts, struck, f, add, boot, run } = rig([{ kind: "box", tag: "wall", x: 0, z: -1.2, hx: 3, hz: 0.2, yaw: 0, y0: 0, y1: 3 }]);
    const s = add("npc:s", 0, 0);
    boot(s, 0, -1);
    f.track("npc:s", "ada");
    run(0.15);
    expect(struck).toEqual([{ id: "npc:s", by: "ada", kind: "wall", amount: expect.any(Number) }]);
    expect(struck[0]!.amount).toBeGreaterThan(BOOT.blow.knock * 0.8); // (he met it near full speed)
    expect(hurts[0]!.amount).toBeCloseTo(splatDamage(struck[0]!.amount), 6);
    expect(hurts[0]!.hit.by).toBe("ada");
    expect(hurts[0]!.hit.dirZ).toBeLessThan(0); // (along the way he was going: into the wall)
    run(BOOT.watchS + 0.5);
    expect(struck).toHaveLength(1); // (once: lying against it is not a second splat)
    expect(f.watching).toBe(0);
    expect(rows.get("npc:s")!.health).toBe(100 - hurts[0]!.amount);
  });

  it("booted across open ground he flies and slides several metres and is not hurt by it", () => {
    const { hurts, struck, f, add, boot, run } = rig();
    const s = add("npc:s", 0, 0);
    boot(s, 0, -1);
    f.track("npc:s", "ada");
    run(BOOT.watchS + 0.5);
    expect(-s.z).toBeGreaterThan(4); // (he goes a good way)
    expect(-s.z).toBeLessThan(10);
    expect(struck).toEqual([]);
    expect(hurts).toEqual([]);
  });

  it("booted off a ledge he falls, and the fall hurts his legs; a step down does not", () => {
    // a 6 m drop beyond z = -1.5 (a bank, a bridge's edge)
    const { hurts, struck, f, add, boot, run } = rig([], (_x, z) => (z < -1.5 ? -6 : 0));
    const s = add("npc:s", 0, 0);
    boot(s, 0, -1);
    f.track("npc:s", "ada");
    run(3);
    const fall = struck.find((x) => x.kind === "fall");
    expect(fall).toBeDefined();
    expect(fall!.amount).toBeGreaterThan(6);
    const hurt = hurts.find((h) => h.hit.zone !== undefined && h.hit.zone >= 4)!;
    expect(hurt.amount).toBeCloseTo(fallDamage(fall!.amount), 6);
    expect(hurt.hit.severBias).toBe(0); // (a fall breaks a leg; it does not take it off)

    const low = rig([], (_x, z) => (z < -1.5 ? -1 : 0));
    const t = low.add("npc:t", 0, 0);
    low.boot(t, 0, -1);
    low.f.track("npc:t", "ada");
    low.run(3);
    expect(low.hurts).toEqual([]);
  });

  it("only NPC rows are watched; a body already down is let go", () => {
    const { rows, f, add } = rig();
    add("ada", 0, 0, 0);
    f.track("ada", "npc:s");
    expect(f.watching).toBe(0);
    const s = add("npc:s", 3, 0);
    s.flags |= FLAG.DOWNED;
    f.track("npc:s", "ada");
    expect(f.watching).toBe(0);
    s.flags &= ~FLAG.DOWNED;
    f.track("npc:s", "ada");
    expect(f.watching).toBe(1);
    rows.delete("npc:s");
    f.tick(DT);
    expect(f.watching).toBe(0);
  });
});
