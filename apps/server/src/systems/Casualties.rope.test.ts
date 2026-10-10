import { describe, expect, it } from "vitest";
import { BUTTON, CollisionWorld, FLAG, LASSO, NPC, REACT, Rng, reactKind, type LassoEvent, type Obstacle, type PlayerStateType } from "@cb/shared";
import { Casualties, type CasualtyHost } from "./Casualties.ts";

/** D-106: the lariat on the server. A loop thrown at the man ahead lands a moment later; he is hauled on the rope; he works free, is let go, or is hurt by the haul. */

const row = (npc: number, x: number, z: number, over: Partial<PlayerStateType> = {}): PlayerStateType =>
  ({ x, y: 0, z, vx: 0, vz: 0, facing: 0, flags: FLAG.GROUNDED, stumble: 0, health: 100, wounds: 0, missing: 0, reviveProgress: 0, reviver: "", dragger: "", slot: 0, connected: true, npc, weapon: 0, react: 0, roped: 0, ...over }) as PlayerStateType;

function rig(obstacles: Obstacle[] = []) {
  const rows = new Map<string, PlayerStateType>();
  const thrown: LassoEvent[] = [];
  const roped: string[] = [];
  const world = new CollisionWorld({ height: () => 0 }, obstacles, 100);
  const host: CasualtyHost = {
    players: { forEach: (cb) => rows.forEach((p, id) => cb(p, id)), get: (id) => rows.get(id) },
    world,
    dropHeldProp: () => undefined,
    routSpawn: () => ({ x: 0, z: 0 }),
    notify: () => undefined,
    rng: new Rng(3),
    emitHit: () => undefined,
    emitSever: () => undefined,
    dismemberment: () => false,
    limbsChanged: () => undefined,
    rows: { forEach: (cb) => rows.forEach((p, id) => cb(p, id)) },
    emitLasso: (e) => void thrown.push(e),
    roped: (by, t) => void roped.push(`${by}>${t}`),
  };
  const c = new Casualties(host);
  /** Steps the casualty tick and moves every row by its velocity (the movement step's part, for a test). */
  const run = (seconds: number, dt = 1 / 30): void => {
    for (let t = 0; t < seconds; t += dt) {
      c.tick(dt);
      for (const p of rows.values()) {
        p.x += p.vx * dt;
        p.z += p.vz * dt;
      }
    }
  };
  const press = (id: string, bits: number): void => {
    c.onFrame(id, rows.get(id)!, bits, bits);
    c.onFrame(id, rows.get(id)!, 0, 0);
  };
  return { rows, thrown, roped, c, run, press };
}

describe("D-106: the lariat on the server", () => {
  it("a loop thrown at the man ahead flies, lands, and he is roped: on his back and hauled at the rope's length behind", () => {
    const { rows, thrown, roped, c, run, press } = rig();
    rows.set("ada", row(0, 0, 0));
    rows.set("npc:s", row(NPC.SENTRY, 0, -8));
    press("ada", BUTTON.GRAB);
    expect(thrown).toHaveLength(1);
    expect(thrown[0]).toMatchObject({ by: "ada", hit: true });
    expect(c.isRoped("npc:s")).toBe(false); // (still in the air)
    run(LASSO.throwS + 0.1);
    run(1.5); // (she stands still: he is drawn in to the rope's length, and stays IN FRONT of her: a rope pulls along its line, it does not swing him behind)
    expect(rows.get("npc:s")!.z).toBeLessThan(-LASSO.length + 0.5);
    expect(rows.get("npc:s")!.z).toBeGreaterThan(-LASSO.length - 0.5);
    const s = rows.get("npc:s")!;
    expect(c.isRoped("npc:s")).toBe(true);
    expect(roped).toEqual(["ada>npc:s"]);
    expect(s.roped).toBe(1);
    expect((s.flags & FLAG.DRAGGED) !== 0).toBe(true);
    expect((rows.get("ada")!.flags & FLAG.DRAGGING) !== 0).toBe(true);
    // she walks off south (+Z, facing it): he comes along behind her at the rope's length
    const ada = rows.get("ada")!;
    ada.facing = Math.PI;
    ada.vz = 3;
    run(3);
    const d = Math.hypot(s.x - ada.x, s.z - ada.z);
    expect(d).toBeGreaterThan(LASSO.length - 0.6);
    expect(d).toBeLessThan(LASSO.length + 0.6);
    expect(s.z).toBeLessThan(ada.z); // (behind her)
    expect(s.health).toBe(100); // (a walk does not hurt)
    // he lies with his head to her: his forward (-sin, -cos of his facing) points away from her
    const fx = -Math.sin(s.facing);
    const fz = -Math.cos(s.facing);
    expect(fx * (s.x - ada.x) + fz * (s.z - ada.z)).toBeGreaterThan(0);
  });

  it("a man on his feet works the loop loose in time, and gets up from the ground; let go sooner, the same", () => {
    const { rows, c, run, press } = rig();
    rows.set("ada", row(0, 0, 0));
    rows.set("npc:s", row(NPC.SENTRY, 0, -6));
    press("ada", BUTTON.GRAB);
    run(LASSO.throwS + 0.1);
    expect(c.isRoped("npc:s")).toBe(true);
    run(LASSO.holdS + 0.2);
    const s = rows.get("npc:s")!;
    expect(c.isRoped("npc:s")).toBe(false);
    expect(s.roped).toBe(0);
    expect((s.flags & FLAG.DRAGGED) !== 0).toBe(false);
    expect(reactKind(s.react)).toBe(REACT.FLOORED); // (lying a moment, then up)
    // again (he lies behind her now: she turns to face him), and this time she lets go with the same key
    run(LASSO.cooldown);
    const ada = rows.get("ada")!;
    ada.facing = Math.atan2(-(s.x - ada.x), -(s.z - ada.z));
    press("ada", BUTTON.GRAB);
    run(LASSO.throwS + 0.1);
    expect(c.isRoped("npc:s")).toBe(true);
    press("ada", BUTTON.GRAB);
    expect(c.isRoped("npc:s")).toBe(false);
    expect((rows.get("ada")!.flags & FLAG.DRAGGING) !== 0).toBe(false);
  });

  it("hauled at a gallop, the ground hurts him, in bites, until he is down; at a walk it never does", () => {
    const { rows, c, run, press } = rig();
    rows.set("ada", row(0, 0, 0));
    rows.set("npc:s", row(NPC.SENTRY, 0, -6));
    press("ada", BUTTON.GRAB);
    run(LASSO.throwS + 0.1);
    const ada = rows.get("ada")!;
    const s = rows.get("npc:s")!;
    ada.facing = Math.PI;
    ada.vz = 13; // (a horse at a gallop)
    run(6);
    expect(s.health).toBeLessThan(100);
    expect((s.flags & FLAG.DOWNED) !== 0).toBe(true);
    expect(c.isRoped("npc:s")).toBe(true); // (down, he stays on the rope until let go)
    expect(s.roped).toBe(1);
  });

  it("no catch through a wall, at a beast, a rider, a man already down, a player, or nobody; and not twice in a breath", () => {
    const wall = rig([{ kind: "box", tag: "wall", x: 0, z: -4, hx: 3, hz: 0.2, yaw: 0, y0: 0, y1: 3 }]);
    wall.rows.set("ada", row(0, 0, 0));
    wall.rows.set("npc:s", row(NPC.SENTRY, 0, -8));
    wall.press("ada", BUTTON.GRAB);
    expect(wall.thrown[0]!.hit).toBe(false);
    wall.run(1);
    expect(wall.c.isRoped("npc:s")).toBe(false);

    const { rows, thrown, c, run, press } = rig();
    rows.set("ada", row(0, 0, 0));
    rows.set("npc:ox", row(NPC.SENTRY, 0, -5, { flags: FLAG.GROUNDED | FLAG.BEAST }));
    rows.set("npc:rider", row(NPC.SENTRY, 0.3, -6, { flags: FLAG.GROUNDED | FLAG.MOUNTED }));
    rows.set("npc:down", row(NPC.SENTRY, -0.3, -7, { flags: FLAG.GROUNDED | FLAG.DOWNED }));
    rows.set("bram", row(0, 0, -4));
    press("ada", BUTTON.GRAB);
    run(1);
    expect(thrown[0]!.hit).toBe(false); // (thrown at nobody: it sails out and falls)
    expect([...rows.keys()].some((k) => c.isRoped(k))).toBe(false);
    press("ada", BUTTON.GRAB); // (within the cooldown of the last: nothing)
    expect(thrown).toHaveLength(1);
  });
});
