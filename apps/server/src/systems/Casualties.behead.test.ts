import { describe, expect, it } from "vitest";
import { BUTTON, CollisionWorld, FLAG, HEAD, NPC, NPC_SIDE, Rng, WEAPON, WEAPONS, ZONE, FINISHER, type HitEvent, type PlayerStateType, type SeverEvent, type WeaponId } from "@cb/shared";
import { Casualties, type CasualtyHost } from "./Casualties.ts";

/** D-118: an enemy's head comes off to a sabre's coup de grâce or a very heavy blow to it; nobody else's ever does; a man without his head is never got up. */
const row = (npc = 0, over: Partial<PlayerStateType> = {}): PlayerStateType =>
  ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, facing: 0, flags: FLAG.GROUNDED, stumble: 0, health: 100, wounds: 0, missing: 0, reviveProgress: 0, reviver: "", dragger: "", slot: 0, connected: true, npc, react: 0, ...over }) as PlayerStateType;

function rig(dismember = true) {
  const rows = new Map<string, PlayerStateType>();
  const hits: HitEvent[] = [];
  const severs: SeverEvent[] = [];
  const draws = { n: 0 };
  const rng = new Rng(11);
  const next = rng.next.bind(rng);
  rng.next = (): number => {
    draws.n++;
    return next();
  };
  const host: CasualtyHost = {
    players: { forEach: (cb) => rows.forEach((p, id) => cb(p, id)), get: (id) => rows.get(id) },
    world: new CollisionWorld({ height: () => 0 }, [], 100),
    dropHeldProp: () => undefined,
    routSpawn: () => ({ x: 0, z: 0 }),
    notify: () => undefined,
    rng,
    emitHit: (e) => hits.push(e),
    emitSever: (e) => severs.push(e),
    dismemberment: () => dismember,
    limbsChanged: () => undefined,
    // (the room's rule: an enemy's row only)
    mayBehead: (id) => {
      const p = rows.get(id);
      const side = p && p.npc !== 0 ? NPC_SIDE[p.npc] : undefined;
      return side === "ward" || side === "rival" || side === "outlaw";
    },
  };
  return { rows, hits, severs, draws, c: new Casualties(host) };
}

const sabreFinisher = { zone: ZONE.HEAD, dirX: 1, dirZ: 0, finisher: true, weapon: WEAPON.SABRE, severBias: WEAPONS[WEAPON.SABRE].severBias * FINISHER.severMul, by: "p1" } as const;

describe("D-118: an enemy's head", () => {
  it("comes off to a sabre's coup de grâce on it: the bit, down at once, the head's wound grievous, one sever event with the head, and the hit says he is down", () => {
    const { rows, hits, severs, c } = rig();
    rows.set("npc:a", row(NPC.SENTRY, { health: 30 }));
    c.damage("npc:a", 31, sabreFinisher);
    const p = rows.get("npc:a")!;
    expect(p.missing & HEAD).toBe(HEAD);
    expect(p.flags & FLAG.DOWNED).toBe(FLAG.DOWNED);
    expect(severs).toEqual([expect.objectContaining({ id: "npc:a", limb: HEAD, dx: 1 })]);
    expect(severs[0]!.power).toBeGreaterThanOrEqual(0.8);
    expect(hits.at(-1)).toMatchObject({ id: "npc:a", down: true });
    // a man who has lost his head is down for good, even with health to spare
    rows.set("npc:b", row(NPC.RIVAL_GUARD, { health: 100 }));
    c.damage("npc:b", 10, sabreFinisher);
    expect(rows.get("npc:b")!.health).toBe(0);
    expect(rows.get("npc:b")!.flags & FLAG.DOWNED).toBe(FLAG.DOWNED);
  });

  it("comes off to a very heavy blow to the head (a cannonball), never to a rifle ball, a sabre's ordinary cut, or a coup de grâce with a gun's butt", () => {
    const cases: [string, number, number, boolean, WeaponId, boolean][] = [
      ["cannonball", 160, WEAPONS[WEAPON.CANNON].severBias, false, WEAPON.CANNON, true],
      ["rifle head shot", 70 * 2.2, WEAPONS[WEAPON.RIFLE].severBias, false, WEAPON.RIFLE, false],
      ["sabre cut", 36 * 1.5, WEAPONS[WEAPON.SABRE].severBias, false, WEAPON.SABRE, false],
      ["rifle butt finisher", 120, WEAPONS[WEAPON.RIFLE].severBias * FINISHER.severMul, true, WEAPON.RIFLE, false],
      ["umbrella finisher", 120, 0, true, WEAPON.UMBRELLA, false],
    ];
    for (const [what, amount, bias, finisher, weapon, off] of cases) {
      const { rows, c } = rig();
      rows.set("npc:a", row(NPC.SENTRY));
      c.damage("npc:a", amount, { zone: ZONE.HEAD, severBias: bias, finisher, weapon });
      expect((rows.get("npc:a")!.missing & HEAD) !== 0, what).toBe(off);
    }
    // and a sabre's coup de grâce that lands on the body takes no head
    const { rows, c } = rig();
    rows.set("npc:a", row(NPC.SENTRY));
    c.damage("npc:a", 120, { ...sabreFinisher, zone: ZONE.TORSO });
    expect(rows.get("npc:a")!.missing & HEAD).toBe(0);
  });

  it("never comes off a player, a hired hand, a bystander or a beast, nor anyone's when the campaign has dismemberment off; and it draws nothing on the seeded dice", () => {
    for (const [who, npc, over] of [["player", 0, {}], ["hired rifle", NPC.HIRED_RIFLE, {}], ["hostage", NPC.HOSTAGE, {}], ["picket", NPC.PICKET, {}], ["beast", NPC.BEAST, { flags: FLAG.GROUNDED | FLAG.BEAST }]] as const) {
      const { rows, severs, c } = rig();
      rows.set("x", row(npc, over));
      c.damage("x", 500, sabreFinisher);
      expect(rows.get("x")!.missing & HEAD, who).toBe(0);
      expect(severs.filter((e) => e.limb === HEAD), who).toHaveLength(0);
    }
    const off = rig(false);
    off.rows.set("npc:a", row(NPC.SENTRY));
    off.c.damage("npc:a", 500, sabreFinisher);
    expect(off.rows.get("npc:a")!.missing).toBe(0);
    // the rule is certain: a head blow that takes it and one that does not draw the same randomness (the seeded injuries of a campaign are not shifted)
    const a = rig();
    const b = rig();
    a.rows.set("npc:a", row(NPC.SENTRY));
    b.rows.set("npc:a", row(NPC.SENTRY));
    a.c.damage("npc:a", 120, sabreFinisher);
    b.c.damage("npc:a", 120, { ...sabreFinisher, weapon: WEAPON.UMBRELLA, severBias: 0 });
    expect(a.rows.get("npc:a")!.missing & HEAD).toBe(HEAD);
    expect(b.rows.get("npc:a")!.missing & HEAD).toBe(0);
    expect(a.draws.n).toBe(b.draws.n);
  });

  it("the scripted sever refuses a head: there is no way to ask for one", () => {
    const { rows, c } = rig();
    rows.set("p1", row());
    rows.set("npc:a", row(NPC.SENTRY));
    expect(c.sever("p1", HEAD as never)).toBe(false);
    expect(c.sever("npc:a", HEAD as never)).toBe(false);
    expect(rows.get("p1")!.missing).toBe(0);
  });

  it("a man without his head is never got up: no revive starts on him, and one under way stops", () => {
    const { rows, c } = rig();
    rows.set("p1", row(0, { x: 0, z: 0 }));
    rows.set("npc:a", row(NPC.SENTRY, { x: 0.8, z: 0 }));
    c.damage("npc:a", 120, sabreFinisher);
    expect(rows.get("npc:a")!.missing & HEAD).toBe(HEAD);
    // the reviver presses INTERACT beside him: nothing begins
    expect(c.onFrame("p1", rows.get("p1")!, BUTTON.INTERACT, BUTTON.INTERACT)).toBe(false);
    expect(rows.get("p1")!.flags & FLAG.REVIVING).toBe(0);
    // a surgeon's assist is refused too
    rows.set("npc:doc", row(NPC.SURGEON, { x: -0.8, z: 0 }));
    expect(c.assist("npc:doc", "npc:a", "revive")).toBe(false);
  });
});
