import { describe, expect, it } from "vitest";
import { BUTTON, CASUALTY, CollisionWorld, FLAG, NPC, Rng, type PlayerStateType } from "@cb/shared";
import { Casualties, type CasualtyHost } from "./Casualties.ts";

/** A bare row: only what the casualty system reads and writes. */
const row = (x: number, z: number, npc = 0, over: Partial<PlayerStateType> = {}): PlayerStateType =>
  ({ x, y: 0, z, vx: 0, vz: 0, facing: 0, flags: FLAG.GROUNDED, stumble: 0, health: 100, wounds: 0, missing: 0, reviveProgress: 0, reviver: "", dragger: "", slot: 0, connected: true, npc, ...over }) as PlayerStateType;

function rig() {
  const rows = new Map<string, PlayerStateType>();
  const view = (pred: (p: PlayerStateType) => boolean) => ({ forEach: (cb: (p: PlayerStateType, id: string) => void) => rows.forEach((p, id) => pred(p) && cb(p, id)) });
  const humans = view((p) => p.npc === 0);
  const helpable = view((p) => p.npc === 0 || p.npc === NPC.SURGEON || p.npc === NPC.HIRED_RIFLE || p.npc === NPC.PORTER);
  const host = (withScan: boolean): CasualtyHost => ({
    players: { forEach: humans.forEach, get: (id) => rows.get(id) },
    world: new CollisionWorld({ height: () => 0 }, [], 100),
    dropHeldProp: () => undefined,
    routSpawn: () => ({ x: 0, z: 0 }),
    notify: () => undefined,
    rng: new Rng(3),
    emitHit: () => undefined,
    emitSever: () => undefined,
    dismemberment: () => false,
    limbsChanged: () => undefined,
    ...(withScan ? { scan: helpable } : {}),
  });
  return { rows, host };
}

const run = (c: Casualties, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 30); i++) c.tick(1 / 30);
};

describe("a hired surgeon works through Casualties (assist), under the rules a human's hands are under", () => {
  it("revives a downed player in reach with no button held, in the same time a human takes", () => {
    const { rows, host } = rig();
    const c = new Casualties(host(true));
    rows.set("npc:doc", row(0, 0, NPC.SURGEON));
    rows.set("p1", row(1, 0));
    c.down("p1", rows.get("p1")!);
    expect(c.assist("npc:doc", "p1", "revive")).toBe(true);
    expect(rows.get("npc:doc")!.flags & FLAG.REVIVING).not.toBe(0);
    expect(c.assist("npc:doc", "p1", "revive")).toBe(true); // asking again is the same work, not a second one
    run(c, CASUALTY.reviveSeconds * 0.5);
    expect(rows.get("p1")!.flags & FLAG.DOWNED).not.toBe(0);
    expect(rows.get("p1")!.reviveProgress).toBeGreaterThan(30);
    run(c, CASUALTY.reviveSeconds * 0.6);
    expect(rows.get("p1")!.flags & FLAG.DOWNED).toBe(0);
    expect(rows.get("p1")!.health).toBe(CASUALTY.reviveHealth);
    expect(rows.get("npc:doc")!.flags & FLAG.REVIVING).toBe(0);
  });

  it("refuses: out of reach, a standing patient for a revive, a downed medic, a second medic on the same patient, himself", () => {
    const { rows, host } = rig();
    const c = new Casualties(host(true));
    rows.set("npc:doc", row(0, 0, NPC.SURGEON));
    rows.set("npc:doc2", row(0.5, 0.5, NPC.SURGEON));
    rows.set("far", row(CASUALTY.reviveRange + 5, 0));
    rows.set("up", row(1, 0));
    rows.set("down", row(0, 1));
    c.down("far", rows.get("far")!);
    c.down("down", rows.get("down")!);
    expect(c.assist("npc:doc", "far", "revive")).toBe(false);
    expect(c.assist("npc:doc", "up", "revive")).toBe(false);
    expect(c.assist("npc:doc", "npc:doc", "revive")).toBe(false);
    expect(c.assist("npc:doc", "nobody", "revive")).toBe(false);
    expect(c.assist("npc:doc", "down", "revive")).toBe(true);
    expect(c.assist("npc:doc2", "down", "revive")).toBe(false); // somebody is already on it
    c.down("npc:doc2", rows.get("npc:doc2")!);
    expect(c.assist("npc:doc2", "far", "revive")).toBe(false); // a downed medic helps nobody
    expect(c.activeRevives).toBe(1);
  });

  it("the work stops if the patient is dragged off or the medic is put down (nobody is held in a revive by a ghost)", () => {
    const { rows, host } = rig();
    const c = new Casualties(host(true));
    rows.set("npc:doc", row(0, 0, NPC.SURGEON));
    rows.set("p1", row(1, 0));
    c.down("p1", rows.get("p1")!);
    expect(c.assist("npc:doc", "p1", "revive")).toBe(true);
    run(c, 1);
    rows.get("p1")!.x = 40; // carried out of reach
    run(c, 0.2);
    expect(c.activeRevives).toBe(0);
    expect(rows.get("npc:doc")!.flags & FLAG.REVIVING).toBe(0);
    expect(rows.get("p1")!.reviver).toBe("");
  });

  it("dresses a standing wounded player (one level, bounded) and a human may revive a downed hired hand only when the helpable view includes hands", () => {
    const { rows, host } = rig();
    const c = new Casualties(host(true));
    rows.set("npc:doc", row(0, 0, NPC.SURGEON));
    rows.set("p1", row(1, 0, 0, { wounds: 0b1010 }));
    expect(c.assist("npc:doc", "p1", "dress")).toBe(true);
    const before = rows.get("p1")!.wounds;
    run(c, CASUALTY.dressSeconds + 0.3);
    expect(rows.get("p1")!.wounds).not.toBe(before);

    // a human reviving a hired hand: INTERACT held beside him
    rows.set("npc:rifle", row(2, 0.5, NPC.HIRED_RIFLE));
    const hand = rows.get("npc:rifle")!;
    c.down("npc:rifle", hand);
    const me = rows.get("p1")!;
    me.x = 2;
    me.z = 1;
    me.facing = 0; // looking toward -Z, at the hand
    const taken = c.onFrame("p1", me, BUTTON.INTERACT, BUTTON.INTERACT);
    expect(taken).toBe(true);
    expect(hand.reviver).toBe("p1");
    // the same press with no helpable view (slice-1 behaviour) finds nobody
    const solo = rig();
    const c2 = new Casualties(solo.host(false));
    solo.rows.set("p1", row(2, 1));
    solo.rows.set("npc:rifle", row(2, 0.5, NPC.HIRED_RIFLE));
    c2.down("npc:rifle", solo.rows.get("npc:rifle")!);
    expect(c2.onFrame("p1", solo.rows.get("p1")!, BUTTON.INTERACT, BUTTON.INTERACT)).toBe(false);
  });
});
