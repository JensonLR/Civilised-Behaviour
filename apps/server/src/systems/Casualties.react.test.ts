import { describe, expect, it } from "vitest";
import { CollisionWorld, FLAG, HIT_REACT, NPC, REACT, Rng, WEAPON, ZONE, reactKind, reactRight, weaponToWire, type PlayerStateType } from "@cb/shared";
import { Casualties, type CasualtyHost } from "./Casualties.ts";

/** D-104: where a blow lands decides what it does to the body. Casualties applies the rule (hitReaction.ts), times it, and calls the room to take a knocked-away weapon. */

const row = (npc = 0, over: Partial<PlayerStateType> = {}): PlayerStateType =>
  ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, facing: 0, flags: FLAG.GROUNDED, stumble: 0, health: 100, wounds: 0, missing: 0, reviveProgress: 0, reviver: "", dragger: "", slot: 0, connected: true, npc, weapon: weaponToWire(WEAPON.RIFLE), react: 0, ...over }) as PlayerStateType;

function rig() {
  const rows = new Map<string, PlayerStateType>();
  const disarmed: { id: string; right: boolean; dx: number; dz: number }[] = [];
  const host: CasualtyHost = {
    players: { forEach: (cb) => rows.forEach((p, id) => cb(p, id)), get: (id) => rows.get(id) },
    world: new CollisionWorld({ height: () => 0 }, [], 100),
    dropHeldProp: () => undefined,
    routSpawn: () => ({ x: 0, z: 0 }),
    notify: () => undefined,
    rng: new Rng(11),
    emitHit: () => undefined,
    emitSever: () => undefined,
    dismemberment: () => false,
    limbsChanged: () => undefined,
    disarm: (id, right, dx, dz) => void disarmed.push({ id, right, dx, dz }),
  };
  return { rows, disarmed, c: new Casualties(host) };
}

describe("D-104: hit reactions on the server", () => {
  it("a leg shot floors an NPC on that knee for its time, then he gets up", () => {
    const { rows, c } = rig();
    rows.set("npc:a", row(NPC.SENTRY));
    c.damage("npc:a", 30, { zone: ZONE.LEG_R, dirX: 1, dirZ: 0 });
    const a = rows.get("npc:a")!;
    expect(reactKind(a.react)).toBe(REACT.FLOORED);
    expect(reactRight(a.react)).toBe(true);
    expect(c.reactionOf("npc:a")).toBe(a.react);
    c.tick(HIT_REACT.floorS[0] * 0.8);
    expect(reactKind(a.react)).toBe(REACT.FLOORED);
    c.tick(1.5);
    expect(a.react).toBe(0);
    expect(c.reactionOf("npc:a")).toBe(0);
  });

  it("an arm shot knocks the weapon away (the room is told which arm and which way); bare fists cannot be knocked away", () => {
    const { rows, disarmed, c } = rig();
    rows.set("npc:a", row(NPC.SENTRY));
    rows.set("npc:b", row(NPC.SENTRY, { weapon: weaponToWire(WEAPON.FISTS) }));
    c.damage("npc:a", 22, { zone: ZONE.ARM_L, dirX: 0, dirZ: 2 });
    c.damage("npc:b", 22, { zone: ZONE.ARM_L, dirX: 0, dirZ: 2 });
    expect(disarmed).toEqual([{ id: "npc:a", right: false, dx: 0, dz: 1 }]);
    expect(reactKind(rows.get("npc:a")!.react)).toBe(REACT.DISARMED);
    expect(rows.get("npc:b")!.react).toBe(0);
  });

  it("players, beasts, riders and men at a crank gun do not react; nor does anybody to fire", () => {
    const { rows, disarmed, c } = rig();
    rows.set("ada", row(0));
    rows.set("npc:ox", row(NPC.SENTRY, { flags: FLAG.GROUNDED | FLAG.BEAST }));
    rows.set("npc:rider", row(NPC.SENTRY, { flags: FLAG.GROUNDED | FLAG.MOUNTED }));
    rows.set("npc:crank", row(NPC.SENTRY, { flags: FLAG.GROUNDED | FLAG.OPERATING }));
    rows.set("npc:burnt", row(NPC.SENTRY));
    for (const id of ["ada", "npc:ox", "npc:rider", "npc:crank"]) {
      c.damage(id, 30, { zone: ZONE.LEG_L });
      c.damage(id, 30, { zone: ZONE.ARM_R });
    }
    c.damage("npc:burnt", 30, { zone: ZONE.TORSO, burn: true });
    for (const r of rows.values()) expect(r.react).toBe(0);
    expect(disarmed).toHaveLength(0);
  });

  it("a lesser blow does not stand him up; going down ends the stagger; a lighter blow does nothing at all", () => {
    const { rows, c } = rig();
    rows.set("npc:a", row(NPC.SENTRY));
    const a = rows.get("npc:a")!;
    c.damage("npc:a", 10, { zone: ZONE.LEG_L });
    expect(a.react).toBe(0);
    c.damage("npc:a", 30, { zone: ZONE.LEG_L });
    const floored = a.react;
    c.damage("npc:a", 25, { zone: ZONE.TORSO });
    expect(a.react).toBe(floored);
    c.damage("npc:a", 100, { zone: ZONE.TORSO });
    expect((a.flags & FLAG.DOWNED) !== 0).toBe(true);
    expect(a.react).toBe(0);
    c.tick(0.05);
    expect(c.reactionOf("npc:a")).toBe(0);
  });

  it("a row that leaves takes its timer with it", () => {
    const { rows, c } = rig();
    rows.set("npc:a", row(NPC.SENTRY));
    c.damage("npc:a", 30, { zone: ZONE.LEG_L });
    rows.delete("npc:a");
    expect(() => c.tick(0.1)).not.toThrow();
    expect(c.reactionOf("npc:a")).toBe(0);
  });
});
