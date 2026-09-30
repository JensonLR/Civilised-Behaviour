import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS, NPC, NPC_CAP } from "./campaignTypes.ts";
import { BUTTON, FLAG } from "./constants.ts";
import { WARD, newCampaign } from "./factions.ts";
import {
  GARRISON_MAX, GARRISON_MIN, RIVAL_ROUTE, garrisonRoster, garrisonSize, isNpcKey, newBrain, npcDecide, npcKey,
  type NpcBody, type NpcBrain, type NpcSenses, type NpcSpec,
} from "./garrison.ts";
import type { MoveCommand } from "./movement.ts";
import { yawFromWire } from "./movement.ts";
import { WEAPON, weaponToWire } from "./weapons.ts";

const cmd = (): MoveCommand => ({ moveF: 0, moveR: 0, yaw: 0, buttons: 0 });
const body = (o: Partial<NpcBody> = {}): NpcBody => ({ x: 0, z: 0, facing: 0, health: 100, weapon: weaponToWire(WEAPON.RIFLE), ammo: 5, flags: FLAG.GROUNDED, ...o });
const senses = (o: Partial<NpcSenses> = {}): NpcSenses => ({ enemy: undefined, allies: 3, alert: false, standDown: false, fear: 10, ...o });
const foe = (x: number, z: number, o: Partial<NonNullable<NpcSenses["enemy"]>> = {}): NpcSenses["enemy"] => ({ id: "p1", x, z, armed: true, down: false, ...o });
const spec = (o: Partial<NpcSpec> = {}): NpcSpec => ({ id: "t", role: NPC.SENTRY, faction: "ward", post: { x: 0, z: 0 }, weapon: WEAPON.RIFLE, lookSeed: 1, name: "T", ...o });
/** Direction the command walks (the step's camera-relative convention: yaw 0 looks down -Z). */
const walk = (c: MoveCommand): { x: number; z: number } => {
  const y = yawFromWire(c.yaw), f = c.moveF / 127, r = c.moveR / 127;
  return { x: -Math.sin(y) * f + Math.cos(y) * r, z: -Math.cos(y) * f - Math.sin(y) * r };
};

describe("roster", () => {
  it("garrison size tracks militaryStrength from 4 to 8", () => {
    expect(garrisonSize(0)).toBe(GARRISON_MIN);
    expect(garrisonSize(100)).toBe(GARRISON_MAX);
    expect(garrisonSize(55)).toBe(6);
    expect(garrisonSize(Number.NaN)).toBeGreaterThanOrEqual(GARRISON_MIN);
    let last = 0;
    for (let m = 0; m <= 100; m += 5) {
      const n = garrisonSize(m);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it("sentries + Warden + three Syndicate, never above NPC_CAP, unique ids, posts on the anchors", () => {
    for (const mil of [0, 25, 55, 80, 100]) {
      const c = newCampaign(3);
      c.factions.ward.militaryStrength = mil;
      const r = garrisonRoster(c, 11);
      const sentries = r.filter((n) => n.role === NPC.SENTRY);
      expect(sentries.length).toBe(garrisonSize(mil));
      expect(r.filter((n) => n.role === NPC.WARDEN).length).toBe(1);
      expect(r.filter((n) => n.faction === "rival").length).toBe(3);
      expect(r.length).toBeLessThanOrEqual(NPC_CAP);
      expect(new Set(r.map((n) => n.id)).size).toBe(r.length);
      sentries.forEach((s, i) => expect(s.post).toEqual({ x: KESSAR_ANCHORS.sentries[i]!.x, z: KESSAR_ANCHORS.sentries[i]!.z }));
    }
  });

  it("is deterministic in (campaign, seed); the Warden is the Ward's authored leader", () => {
    const c = newCampaign(3);
    expect(garrisonRoster(c, 5)).toEqual(garrisonRoster(c, 5));
    expect(garrisonRoster(c, 5)[0]!.lookSeed).not.toBe(garrisonRoster(c, 6)[0]!.lookSeed);
    const w = garrisonRoster(c, 5).find((n) => n.role === NPC.WARDEN)!;
    expect(w.name).toContain(WARD.leader.name);
    expect(w.post).toEqual({ x: KESSAR_ANCHORS.wardenPost.x, z: KESSAR_ANCHORS.wardenPost.z });
  });

  it("keys are namespaced so they can never collide with a session id", () => {
    expect(npcKey("warden")).toBe("npc:warden");
    expect(isNpcKey("npc:warden")).toBe(true);
    expect(isNpcKey("abc123")).toBe(false);
  });
});

describe("npcDecide", () => {
  it("is deterministic: equal brain, body and senses give equal commands", () => {
    const run = (): MoveCommand[] => {
      const b = newBrain(spec());
      const out: MoveCommand[] = [];
      for (let i = 0; i < 60; i++) {
        const c = cmd();
        npcDecide(b, body({ x: i * 0.1 }), senses({ alert: true, enemy: foe(0, -12) }), 0.05, c);
        out.push({ ...c });
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it("holds its post when nobody has provoked it, even with a player in sight", () => {
    const b = newBrain(spec());
    const c = cmd();
    npcDecide(b, body(), senses({ enemy: foe(0, -8) }), 0.05, c);
    expect(b.mode).toBe("post");
    expect(c.buttons & BUTTON.FIRE).toBe(0);
    expect(c.moveF).toBe(0);
  });

  it("walks back to its post when displaced", () => {
    const b = newBrain(spec({ post: { x: 10, z: 0 } }));
    const c = cmd();
    npcDecide(b, body({ x: 0, z: 0 }), senses(), 0.05, c);
    const d = walk(c);
    expect(d.x).toBeGreaterThan(0.9);
  });

  it("attacks the enemy it is told about: closes, aims, and fires on a pulse", () => {
    const b = newBrain(spec());
    let fired = 0;
    let moved = false;
    for (let i = 0; i < 120; i++) {
      const c = cmd();
      npcDecide(b, body({ x: 0, z: 0 }), senses({ alert: true, enemy: foe(0, -20) }), 0.05, c);
      const d = walk(c);
      if (d.z < -0.9) moved = true;
      if (c.buttons & BUTTON.FIRE) fired++;
      expect(c.aimYaw).toBe(c.yaw);
    }
    expect(b.mode).toBe("attack");
    expect(b.target).toBe("p1");
    expect(moved).toBe(true);
    expect(fired).toBeGreaterThan(1);
    expect(fired).toBeLessThan(10); // a pulse every cooldown, not a held trigger
  });

  it("melee sentries close and swing; empty guns reload", () => {
    const sab = newBrain(spec({ weapon: WEAPON.SABRE }));
    const c = cmd();
    npcDecide(sab, body({ weapon: weaponToWire(WEAPON.SABRE) }), senses({ alert: true, enemy: foe(0, -1) }), 0.05, c);
    expect(c.buttons & BUTTON.FIRE).toBeTruthy();
    const gun = newBrain(spec());
    gun.cooldown = 0;
    const r = cmd();
    npcDecide(gun, body({ ammo: 0 }), senses({ alert: true, enemy: foe(0, -10) }), 0.05, r);
    expect(r.buttons & BUTTON.RELOAD).toBeTruthy();
    expect(r.buttons & BUTTON.FIRE).toBe(0);
  });

  it("goes for the nearer of the two as the host hands it, and ignores a downed player", () => {
    const b = newBrain(spec());
    const c = cmd();
    npcDecide(b, body(), senses({ alert: true, enemy: foe(0, -10, { down: true }) }), 0.05, c);
    expect(b.mode).not.toBe("attack");
    expect(c.buttons & BUTTON.FIRE).toBe(0);
  });

  it("flees at low morale (wounded, frightened, alone) and keeps running away from the enemy", () => {
    const b = newBrain(spec());
    let last = cmd();
    for (let i = 0; i < 80; i++) {
      last = cmd();
      npcDecide(b, body({ health: 12 }), senses({ alert: true, allies: 0, fear: 90, enemy: foe(0, -10) }), 0.05, last);
    }
    expect(b.mode).toBe("flee");
    expect(b.morale).toBeLessThan(30);
    expect(walk(last).z).toBeGreaterThan(0.9); // enemy is north (-z): away is south (+z)
    expect(last.buttons & BUTTON.SPRINT).toBeTruthy();
    expect(last.buttons & BUTTON.FIRE).toBe(0);
  });

  it("a healthy, unafraid sentry does not flee; a frightened one with friends holds longer than a lone one", () => {
    const steady = newBrain(spec());
    for (let i = 0; i < 100; i++) npcDecide(steady, body(), senses({ alert: true, enemy: foe(0, -10) }), 0.05, cmd());
    expect(steady.mode).toBe("attack");
    const moraleAfter = (allies: number): number => {
      const b = newBrain(spec());
      for (let i = 0; i < 100; i++) npcDecide(b, body({ health: 60 }), senses({ alert: true, allies, fear: 70, enemy: foe(0, -10) }), 0.05, cmd());
      return b.morale;
    };
    expect(moraleAfter(4)).toBeGreaterThan(moraleAfter(0));
  });

  it("a routed sentry stops running after a while and does not come back while frightened", () => {
    const b = newBrain(spec());
    for (let i = 0; i < 60; i++) npcDecide(b, body({ health: 10 }), senses({ alert: true, allies: 0, fear: 90, enemy: foe(0, -10) }), 0.05, cmd());
    expect(b.mode).toBe("flee");
    const c = cmd();
    for (let i = 0; i < 400; i++) npcDecide(b, body({ health: 10 }), senses({ alert: true, allies: 0, fear: 90 }), 0.05, c);
    expect(b.mode).toBe("flee");
    expect(c.moveF).toBe(0);
  });

  it("never acts in stand_down, whatever it is told, and the stand-down is latched", () => {
    const b = newBrain(spec());
    const c = cmd();
    npcDecide(b, body(), senses({ standDown: true, alert: true, enemy: foe(0, -3) }), 0.05, c);
    expect(b.mode).toBe("stand_down");
    for (let i = 0; i < 50; i++) {
      c.moveF = 99;
      c.buttons = 0xffff;
      npcDecide(b, body({ health: 5 }), senses({ standDown: false, alert: true, enemy: foe(0, -3) }), 0.05, c);
      expect(b.mode).toBe("stand_down");
      expect(c.moveF).toBe(0);
      expect(c.moveR).toBe(0);
      expect(c.buttons).toBe(0);
    }
  });

  it("does nothing while downed", () => {
    const b = newBrain(spec());
    const c = cmd();
    npcDecide(b, body({ flags: FLAG.DOWNED }), senses({ alert: true, enemy: foe(0, -3) }), 0.05, c);
    expect(c.moveF).toBe(0);
    expect(c.buttons).toBe(0);
  });

  it("marches the rival's waypoint list in order, then stands at the parley spot", () => {
    const b = newBrain(spec({ faction: "rival", role: NPC.RIVAL_GUARD, post: RIVAL_ROUTE[0]! }));
    b.mode = "march";
    let x = RIVAL_ROUTE[0]!.x, z = RIVAL_ROUTE[0]!.z;
    const seen: number[] = [0];
    const c = cmd();
    for (let i = 0; i < 6000 && b.route < RIVAL_ROUTE.length; i++) {
      npcDecide(b, body({ x, z }), senses(), 0.05, c);
      if (seen[seen.length - 1] !== b.route) seen.push(b.route);
      const d = walk(c);
      x += d.x * 4.4 * 0.05;
      z += d.z * 4.4 * 0.05;
    }
    expect(seen).toEqual([...RIVAL_ROUTE.map((_, i) => i), RIVAL_ROUTE.length]);
    expect(b.route).toBe(RIVAL_ROUTE.length);
    const end = RIVAL_ROUTE[RIVAL_ROUTE.length - 1]!;
    expect(Math.hypot(x - end.x, z - end.z)).toBeLessThan(2.5);
    npcDecide(b, body({ x, z }), senses(), 0.05, c);
    expect(c.moveF).toBe(0);
    expect(KESSAR_ANCHORS.rivalParley).toEqual({ x: end.x, z: end.z });
  });

  it("a marching rival that is provoked fights instead", () => {
    const b = newBrain(spec({ faction: "rival", role: NPC.RIVAL_GUARD }));
    b.mode = "march";
    const c = cmd();
    for (let i = 0; i < 40; i++) npcDecide(b, body(), senses({ alert: true, enemy: foe(0, -8) }), 0.05, c);
    expect(b.mode).toBe("attack");
  });

  it("survives hostile input: NaN dt, NaN facing, infinite fear", () => {
    const b = newBrain(spec());
    const c = cmd();
    npcDecide(b, body({ facing: Number.NaN, health: Number.NaN }), senses({ fear: Infinity, allies: Number.NaN }), Number.NaN, c);
    expect(Number.isFinite(c.yaw) && Number.isFinite(c.moveF)).toBe(true);
    expect(Number.isFinite(b.morale)).toBe(true);
  });

  it("is allocation-free: a quarter of a million ticks retain no memory", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const b: NpcBrain = newBrain(spec());
    const me = body();
    const sn = senses({ alert: true, enemy: foe(0, -12) });
    const c = cmd();
    const tickOnce = (i: number): void => {
      me.x = Math.sin(i * 0.01) * 3;
      sn.enemy!.z = -12 - (i % 50) * 0.1;
      npcDecide(b, me, sn, 0.05, c);
    };
    for (let i = 0; i < 20000; i++) tickOnce(i);
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 250000; i++) tickOnce(i);
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(400_000);
  });
});
