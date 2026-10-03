import { describe, expect, it } from "vitest";
import { CollisionWorld, FLAG, NPC, Rng, type HitEvent, type PlayerStateType, type SeverEvent } from "@cb/shared";
import { Casualties, type CasualtyHost } from "./Casualties.ts";

const row = (npc = 0, over: Partial<PlayerStateType> = {}): PlayerStateType =>
  ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, facing: 0, flags: FLAG.GROUNDED, stumble: 0, health: 100, wounds: 0, missing: 0, reviveProgress: 0, reviver: "", dragger: "", slot: 0, connected: true, npc, ...over }) as PlayerStateType;

function rig(dismember = true) {
  const rows = new Map<string, PlayerStateType>();
  const hits: HitEvent[] = [];
  const severs: SeverEvent[] = [];
  const host: CasualtyHost = {
    players: { forEach: (cb) => rows.forEach((p, id) => cb(p, id)), get: (id) => rows.get(id) },
    world: new CollisionWorld({ height: () => 0 }, [], 100),
    dropHeldProp: () => undefined,
    routSpawn: () => ({ x: 0, z: 0 }),
    notify: () => undefined,
    rng: new Rng(11),
    emitHit: (e) => hits.push(e),
    emitSever: (e) => severs.push(e),
    dismemberment: () => dismember,
    limbsChanged: () => undefined,
  };
  return { rows, hits, severs, c: new Casualties(host) };
}

describe("a blast throws the fallen (D-064: Casualties.toss)", () => {
  it("a downed body is thrown (a hit event with lift) and its health is left alone", () => {
    const { rows, hits, c } = rig();
    rows.set("p1", row());
    c.down("p1", rows.get("p1")!);
    c.toss("p1", 3, 4, 0.9, 0.7, 80, 2.2);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "p1", down: true, lift: 0.7 });
    expect(hits[0]!.dx).toBeCloseTo(0.6);
    expect(hits[0]!.dz).toBeCloseTo(0.8);
    expect(rows.get("p1")!.health).toBe(0);
  });

  it("nobody standing is tossed (they took the blast as a hit), and a zero-power toss is nothing", () => {
    const { rows, hits, c } = rig();
    rows.set("p1", row());
    c.toss("p1", 1, 0, 1, 1, 120, 2.2);
    rows.set("p2", row());
    c.down("p2", rows.get("p2")!);
    c.toss("p2", 1, 0, 0, 1, 120, 2.2);
    expect(hits).toHaveLength(0);
  });

  it("a fallen NPC comes apart under a heavy blast; a fallen member of the party never does; the dismemberment rule is obeyed", () => {
    const { rows, severs, c } = rig();
    for (let i = 0; i < 12; i++) {
      rows.set(`npc:${i}`, row(NPC.SENTRY));
      c.down(`npc:${i}`, rows.get(`npc:${i}`)!);
      rows.set(`p${i}`, row());
      c.down(`p${i}`, rows.get(`p${i}`)!);
    }
    for (let k = 0; k < 4; k++) for (let i = 0; i < 12; i++) {
      c.toss(`npc:${i}`, 1, 0, 1, 1, 120, 2.2);
      c.toss(`p${i}`, 1, 0, 1, 1, 120, 2.2);
    }
    expect(severs.length).toBeGreaterThan(0);
    expect(severs.every((e) => e.id.startsWith("npc:"))).toBe(true);
    for (let i = 0; i < 12; i++) expect(rows.get(`p${i}`)!.missing).toBe(0);

    const off = rig(false);
    off.rows.set("npc:a", row(NPC.SENTRY));
    off.c.down("npc:a", off.rows.get("npc:a")!);
    for (let k = 0; k < 40; k++) off.c.toss("npc:a", 1, 0, 1, 1, 120, 2.2);
    expect(off.severs).toHaveLength(0);
  });
});
