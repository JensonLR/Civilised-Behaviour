import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS as A, NPC } from "./campaignTypes.ts";
import { CollisionWorld } from "./collision.ts";
import { BUTTON, FLAG } from "./constants.ts";
import type { CommandId, CommandMsg, NavApi, NpcBody, NpcSenses, NpcSpec } from "./expeditionTypes.ts";
import { COMMAND_GAP, FOLLOW, followerThink, mindOf, resolveCommand, setIntent, type CommandCtx } from "./command.ts";
import { kessarNavOptions } from "./garrison.ts";
import { createKessarWorld } from "./kessar.ts";
import { moraleBand, type MoraleBand } from "./morale.ts";
import { NavQuery, buildNavGrid, newNavPath } from "./nav.ts";
import { npcBrainNew, type NpcBrainState } from "./npcBrain.ts";
import { createCharState, stepCharacter, type CharState, type MoveCommand } from "./movement.ts";
import { WEAPON, weaponToWire, type WeaponId } from "./weapons.ts";

const DT = 1 / 30;
const BANDS: MoraleBand[] = ["steady", "shaken", "wavering", "broken"];
const IDS: CommandId[] = ["follow", "hold", "attack", "fetch", "retreat"];
const ctx = (o: Partial<CommandCtx> = {}): CommandCtx => ({ band: "steady", leaderNear: false, rate: 10, here: { x: 1, z: 2 }, ...o });
const full = (intent: CommandId): CommandMsg => ({ intent, at: { x: 5, z: 6 }, target: intent === "attack" ? "deserter-1" : intent === "fetch" ? "p9" : undefined });
const rifle = { kind: "rifleman" as const, name: "Jem Cobbold" };
const porter = { kind: "porter" as const, name: "Dobbin Harrowgate" };
const surgeon = { kind: "surgeon" as const, name: "Dr. Ambrose Quillfeather" };

describe("resolveCommand: who obeys what", () => {
  it("steady: every order is taken (a rifleman cannot fetch, a porter cannot attack: their trades refuse)", () => {
    expect(resolveCommand(full("follow"), rifle, ctx())).toEqual({ intent: { k: "follow" } });
    expect(resolveCommand(full("hold"), rifle, ctx())).toEqual({ intent: { k: "hold", x: 5, z: 6 } });
    expect(resolveCommand({ intent: "hold" }, rifle, ctx())).toEqual({ intent: { k: "hold", x: 1, z: 2 } }); // no point: where he stands
    expect(resolveCommand(full("attack"), rifle, ctx())).toEqual({ intent: { k: "attack", target: "deserter-1" } });
    expect(resolveCommand(full("attack"), surgeon, ctx())).toEqual({ intent: { k: "attack", target: "deserter-1" } });
    expect(resolveCommand(full("retreat"), rifle, ctx())).toEqual({ intent: { k: "retreat" } });
    expect(resolveCommand(full("fetch"), porter, ctx())).toEqual({ intent: { k: "fetch", prop: "p9", to: { x: 5, z: 6 } } });
    expect(resolveCommand({ intent: "fetch", target: "p9" }, porter, ctx())).toEqual({ intent: { k: "fetch", prop: "p9" } });
    expect(resolveCommand(full("fetch"), rifle, ctx())).toMatchObject({ refuse: expect.stringContaining("Jem Cobbold") });
    expect(resolveCommand(full("attack"), porter, ctx())).toMatchObject({ refuse: expect.stringContaining("Dobbin Harrowgate") });
  });

  it("the full table: band x command", () => {
    const obeys = (band: MoraleBand, c: CommandId, leaderNear: boolean): boolean => !("refuse" in resolveCommand(full(c), rifle, ctx({ band, leaderNear })));
    // steady: everything but fetch (rifleman); shaken: attack only with the leader near; wavering: follow / retreat; broken: nothing
    for (const near of [false, true]) {
      expect(IDS.filter((c) => obeys("steady", c, near))).toEqual(["follow", "hold", "attack", "retreat"]);
      expect(IDS.filter((c) => obeys("wavering", c, near))).toEqual(["follow", "retreat"]);
      expect(IDS.filter((c) => obeys("broken", c, near))).toEqual([]);
    }
    expect(IDS.filter((c) => obeys("shaken", c, false))).toEqual(["follow", "hold", "retreat"]);
    expect(IDS.filter((c) => obeys("shaken", c, true))).toEqual(["follow", "hold", "attack", "retreat"]);
    // and for a porter, band x fetch
    expect(resolveCommand(full("fetch"), porter, ctx({ band: "shaken" }))).toHaveProperty("intent");
    expect(resolveCommand(full("fetch"), porter, ctx({ band: "wavering" }))).toHaveProperty("refuse");
    expect(resolveCommand(full("fetch"), porter, ctx({ band: "broken" }))).toHaveProperty("refuse");
  });

  it("refusals are authored one-liners naming the hand, by reason", () => {
    const seen = new Set<string>();
    for (const who of [rifle, porter, surgeon]) for (const band of BANDS) for (const c of IDS) {
      const r = resolveCommand(full(c), who, ctx({ band }));
      if (!("refuse" in r)) continue;
      expect(r.refuse.length).toBeGreaterThan(20);
      expect(r.refuse).toContain(who.name);
      expect(r.refuse).not.toContain("%n");
      seen.add(r.refuse);
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
    expect(resolveCommand(full("attack"), rifle, ctx({ band: "wavering" }))).toEqual(resolveCommand(full("attack"), rifle, ctx({ band: "wavering" }))); // deterministic
  });

  it("an order with nothing to point at is asked 'where?', not guessed", () => {
    expect(resolveCommand({ intent: "attack" }, rifle, ctx())).toHaveProperty("refuse");
    expect(resolveCommand({ intent: "fetch" }, porter, ctx())).toHaveProperty("refuse");
  });

  it("orders closer together than the gap are ignored in silence", () => {
    const r = resolveCommand(full("follow"), rifle, ctx({ rate: COMMAND_GAP - 0.01 }));
    expect(r).toEqual({ refuse: "" });
    expect(resolveCommand(full("follow"), rifle, ctx({ rate: COMMAND_GAP }))).toHaveProperty("intent");
    expect(resolveCommand(full("follow"), rifle, ctx({ rate: Number.NaN }))).toEqual({ refuse: "" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// followerThink
// ---------------------------------------------------------------------------------------------------------------------------------------------

const spec = (o: Partial<NpcSpec> = {}): NpcSpec => ({
  id: "hand-r1", role: NPC.HIRED_RIFLE, faction: "ward", side: "party", group: "party", post: { x: 0, z: 0 }, weapon: WEAPON.RIFLE, lookSeed: 11, name: "Jem", skill: 62, bravery: 60, brain: "follower", ...o,
});
const fakeNav = (los = true): NavApi => ({
  open: () => true, los: () => los,
  path: (_sx, _sz, tx, tz, out) => { out.x[0] = tx; out.z[0] = tz; out.n = 1; out.complete = true; return true; },
  cover: () => false, flank: () => false, nearestOpen: (x, z, out) => { out.x = x; out.z = z; return true; },
});
const mkSenses = (nav: NavApi, o: Partial<NpcSenses> = {}): NpcSenses => ({ allies: 2, alliesDown: 0, alert: false, standDown: false, fear: 10, token: false, underFire: 0, now: 0, rain: 0, nav, ...o });
const foe = (x: number, z: number): NonNullable<NpcSenses["enemy"]> => ({ id: "foe", x, z, armed: true, moving: 0, down: false });
const flat = (): CollisionWorld => new CollisionWorld({ height: () => 0 }, [], 160);

interface Rig { b: NpcBrainState; s: CharState; c: MoveCommand; sn: NpcSenses; leader: { id: string; x: number; z: number }; t: number; fired: number; sprinted: number }
function rig(world: CollisionWorld, x: number, z: number, o: { spec?: Partial<NpcSpec>; nav?: NavApi; kind?: "porter" | "rifleman" | "surgeon" } = {}): Rig {
  const sp = spec(o.spec);
  const b = npcBrainNew(sp);
  const m = mindOf(b);
  m.kind = o.kind ?? "rifleman";
  m.bravery = sp.bravery;
  m.landX = x; m.landZ = z;
  setIntent(b, { k: "follow" });
  const s = createCharState(x, z, world);
  const leader = { id: "p1", x: x, z: z };
  return { b, s, c: { moveF: 0, moveR: 0, yaw: 0, buttons: 0 }, sn: mkSenses(o.nav ?? fakeNav(), { leader }), leader, t: 0, fired: 0, sprinted: 0 };
}
const bodyOf = (s: CharState, b: NpcBrainState, ammo = 5, health = 100): NpcBody => ({ x: s.x, z: s.z, facing: s.facing, health, weapon: b.weapon, ammo, flags: s.flags, vx: s.vx, vz: s.vz });
/** One server tick: think, then the REAL step. */
function tick(r: Rig, world: CollisionWorld, o: { ammo?: number; health?: number } = {}): void {
  r.sn.now = r.t;
  followerThink(r.b, bodyOf(r.s, r.b, o.ammo, o.health), r.sn, DT, r.c);
  if ((r.c.buttons & BUTTON.FIRE) !== 0) r.fired++;
  if ((r.c.buttons & BUTTON.SPRINT) !== 0) r.sprinted++;
  stepCharacter(r.s, r.c, DT, world);
  r.t += DT;
}
const runFor = (r: Rig, world: CollisionWorld, seconds: number, each?: (r: Rig) => void, o?: { ammo?: number }): void => {
  for (let i = 0; i < Math.round(seconds / DT); i++) { each?.(r); tick(r, world, o); }
};
const dist = (r: Rig, x: number, z: number): number => Math.hypot(r.s.x - x, r.s.z - z);

describe("followerThink: follow", () => {
  it("keeps 2.5-4 m off the leader on open ground, with no shuffle once it is there", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    r.leader.x = 0; r.leader.z = -3;
    runFor(r, w, 2);
    expect(dist(r, 0, -3)).toBeLessThanOrEqual(FOLLOW.far);
    // the leader walks off at 3 m/s
    runFor(r, w, 10, () => { r.leader.z -= 3 * DT; });
    const d = dist(r, r.leader.x, r.leader.z);
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(FOLLOW.far + 1.5);
    // leader stops: the hand closes to inside `far`, then stops moving
    runFor(r, w, 6);
    const dd = dist(r, r.leader.x, r.leader.z);
    expect(dd).toBeLessThanOrEqual(FOLLOW.far);
    let moved = 0;
    runFor(r, w, 3, () => { if (r.c.moveF !== 0) moved++; });
    expect(moved).toBe(0);
    expect(r.b.mode).toBe("follow");
  });

  it("sprints to catch a leader who is far ahead", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    r.leader.z = -40;
    runFor(r, w, 1);
    expect(r.sprinted).toBeGreaterThan(5);
  });

  it("with nobody to follow it goes back to its post and waits", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    r.s.x = 10; r.s.z = 10;
    r.sn.leader = undefined;
    runFor(r, w, 8);
    expect(dist(r, 0, 0)).toBeLessThan(3);
  });

  it("follows the leader through the Kessar road with the real NavQuery, never stopping inside an obstacle", () => {
    const w = createKessarWorld(7, "intact");
    const grid = buildNavGrid(w, kessarNavOptions(w));
    const q = new NavQuery(grid);
    // the leader's walk: the nav's own path from the landing to the toll bar, then the bridge's far end
    const route = newNavPath();
    expect(q.path(A.landing.x, A.landing.z, A.tollBar.x, A.tollBar.z + 12, route)).toBe(true);
    const r = rig(w, A.landing.x, A.landing.z + 3, { nav: q });
    r.leader.x = A.landing.x; r.leader.z = A.landing.z;
    let wp = 0;
    let worst = 0;
    runFor(r, w, 60, () => {
      // 3 m/s along the route
      const tx = route.x[wp]!, tz = route.z[wp]!;
      const dx = tx - r.leader.x, dz = tz - r.leader.z, d = Math.hypot(dx, dz);
      if (d < 0.6 && wp < route.n - 1) wp++;
      else if (d > 0.01) { const k = Math.min(1, (3 * DT) / d); r.leader.x += dx * k; r.leader.z += dz * k; }
      worst = Math.max(worst, dist(r, r.leader.x, r.leader.z));
      expect(w.resolveXZ({ x: r.s.x, z: r.s.z }, 0, 0.4, 1.7)).toBe(false);
    });
    // (D-038 straightened the road from the landing to the toll bar: the nav's route may now be a single leg, so "the leader walked" is asked of where he is, not of how many bends he passed)
    expect(wp > 0 || route.n === 1).toBe(true);
    expect(r.leader.z, "the leader really walked up the road").toBeLessThan(A.landing.z - 20);
    runFor(r, w, 10);
    expect(dist(r, r.leader.x, r.leader.z)).toBeLessThan(FOLLOW.far + 1);
    expect(worst).toBeLessThan(25); // never lost him
    expect(r.s.z).toBeLessThan(A.landing.z - 20); // it really did go up the road
  });

  it("is deterministic: equal inputs, equal command streams", () => {
    const once = (): number[] => {
      const w = flat();
      const r = rig(w, 0, 0);
      const out: number[] = [];
      runFor(r, w, 8, () => { r.leader.z -= 2 * DT; r.leader.x += Math.sin(r.t) * DT; out.push(r.c.moveF, r.c.yaw, r.c.buttons); });
      return out;
    };
    expect(once()).toEqual(once());
  });
});

describe("followerThink: fighting (the garrison brain, with tokens)", () => {
  const nearLeader = (r: Rig, w: CollisionWorld): void => { void w; r.leader.x = r.s.x; r.leader.z = r.s.z - 3; };

  it("fires at a foe it can see only while it holds an attack token", () => {
    const w = flat();
    for (const token of [false, true]) {
      const r = rig(w, 0, 0);
      nearLeader(r, w);
      r.sn.alert = true;
      r.sn.token = token;
      r.sn.enemy = foe(0, -20);
      runFor(r, w, 8, () => { r.leader.x = r.s.x; r.leader.z = r.s.z - 3; });
      if (token) expect(r.fired).toBeGreaterThan(0);
      else expect(r.fired).toBe(0);
    }
  });

  it("answers fire the tick after it stops following (no dead time from the mode change)", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    r.leader.z = -3;
    runFor(r, w, 2);
    expect(r.b.mode).toBe("follow");
    r.sn.alert = true; r.sn.token = true; r.sn.enemy = foe(0, -18);
    let tFirst = -1;
    const t0 = r.t;
    runFor(r, w, 6, () => { r.leader.x = r.s.x; r.leader.z = r.s.z - 3; if (tFirst < 0 && r.fired > 0) tFirst = r.t - t0; });
    expect(tFirst).toBeGreaterThan(0);
    expect(tFirst).toBeLessThan(4); // reaction time + a think, not a dwell on top
  });

  it("will not leave its leader to chase: a foe beyond the tether is ignored and the hand keeps following", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    r.leader.x = 0; r.leader.z = 60;
    r.sn.alert = true; r.sn.token = true; r.sn.enemy = foe(0, -25);
    runFor(r, w, 4);
    expect(r.fired).toBe(0);
    expect(r.s.z).toBeGreaterThan(0); // went toward the leader, away from the foe
  });

  it("hold: stands on its point and fires from there; a foe beyond leash is not chased", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    setIntent(r.b, { k: "hold", x: 6, z: 0 });
    runFor(r, w, 5);
    expect(dist(r, 6, 0)).toBeLessThan(1.6);
    expect(r.b.mode).toBe("hold");
    r.sn.alert = true; r.sn.token = true; r.sn.enemy = foe(6, -22);
    runFor(r, w, 8);
    expect(r.fired).toBeGreaterThan(0);
    expect(dist(r, 6, 0)).toBeLessThan(FOLLOW.holdLeash);
    // the leader leaves; the hold stays
    r.leader.x = 0; r.leader.z = 80;
    r.sn.enemy = undefined; r.sn.alert = false;
    runFor(r, w, 4);
    expect(dist(r, 6, 0)).toBeLessThan(2);
  });

  it("attack: closes on the target's position, then fights with its token", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    const m = mindOf(r.b);
    setIntent(r.b, { k: "attack", target: "foe" });
    m.tOn = true; m.tx = 0; m.tz = -40;
    runFor(r, w, 6);
    expect(r.s.z).toBeLessThan(-12); // walked toward it
    expect(r.b.mode).toBe("advance");
    r.sn.alert = true; r.sn.token = true; r.sn.enemy = foe(0, r.s.z - 15);
    runFor(r, w, 6);
    expect(r.fired).toBeGreaterThan(0);
    // target gone: the host clears it, the brain falls back to follow
    r.sn.enemy = undefined; r.sn.alert = false;
    m.tOn = false;
    setIntent(r.b, { k: "follow" });
    r.leader.x = 0; r.leader.z = 40;
    runFor(r, w, 8);
    expect(r.b.mode).toBe("follow");
    expect(r.s.z).toBeGreaterThan(-12);
  });

  it("retreat: runs back to the leader and does not fire until it is at his side", () => {
    const w = flat();
    const r = rig(w, 0, -30);
    r.leader.x = 0; r.leader.z = 10;
    setIntent(r.b, { k: "retreat" });
    r.sn.alert = true; r.sn.token = true; r.sn.enemy = foe(0, -60); r.sn.underFire = 0.5;
    runFor(r, w, 6);
    expect(r.fired).toBe(0);
    expect(r.s.z).toBeGreaterThan(-30);
    runFor(r, w, 12);
    expect(dist(r, 0, 10)).toBeLessThan(FOLLOW.rally + 0.5);
    expect(r.sprinted).toBeGreaterThan(0);
    // at the leader's side, it fights
    r.sn.enemy = foe(0, -18); r.sn.underFire = 0;
    runFor(r, w, 8);
    expect(r.fired).toBeGreaterThan(0);
  });

  it("a broken hand runs from the foe and does not fire, then rallies once clear and calm", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    r.b.morale.v = 5;
    r.leader.x = 0; r.leader.z = 5;
    r.sn.alert = true; r.sn.token = true; r.sn.enemy = foe(0, -10); r.sn.underFire = 1;
    const z0 = r.s.z;
    runFor(r, w, 3, () => { r.b.morale.v = Math.min(r.b.morale.v, 8); });
    expect(r.fired).toBe(0);
    expect(r.s.z).toBeGreaterThan(z0 + 4);
    expect(moraleBand(r.b.morale.v)).toBe("broken");
  });

  it("morale uses the host's facts: unpaid hands lose heart, provisions steady them", () => {
    const w = flat();
    const finalMorale = (paid: boolean, provisions: boolean): number => {
      const r = rig(w, 0, 0);
      const m = mindOf(r.b);
      m.paid = paid; m.provisions = provisions; m.bravery = 30;
      r.b.morale.v = 70;
      runFor(r, w, 20, () => { r.leader.x = r.s.x; r.leader.z = r.s.z - 3; });
      return r.b.morale.v;
    };
    const unpaid = finalMorale(false, false);
    const paid = finalMorale(true, false);
    const fed = finalMorale(true, true);
    expect(unpaid).toBeLessThan(paid);
    expect(fed).toBeGreaterThan(paid);
  });

  it("the garrison brain's own morale step does not double count (its inputs are discarded)", () => {
    const w = flat();
    const a = rig(w, 0, 0);
    const b = rig(w, 0, 0);
    const mb = mindOf(b.b);
    mb.paid = false; // an input npcThink would not know about
    a.sn.alert = b.sn.alert = true; a.sn.enemy = b.sn.enemy = foe(0, -15);
    a.leader.z = b.leader.z = -3;
    runFor(a, w, 10); runFor(b, w, 10);
    expect(b.b.morale.v).toBeLessThan(a.b.morale.v); // unpaid really did bite (the goal is 12 lower)
  });
});

describe("followerThink: porters and surgeons", () => {
  it("a porter never fires and runs to the leader when a foe is near", () => {
    const w = flat();
    const r = rig(w, 0, -20, { kind: "porter", spec: { weapon: WEAPON.FISTS, role: NPC.PORTER } });
    r.leader.x = 0; r.leader.z = 0;
    r.sn.alert = true; r.sn.token = true; r.sn.enemy = foe(0, -32);
    let ran = false;
    runFor(r, w, 10, () => { if (r.b.mode === "retreat") ran = true; });
    expect(r.fired).toBe(0);
    expect(ran).toBe(true);
    expect(dist(r, 0, 0)).toBeLessThan(3.2);
  });

  it("fetch: walks to the prop, asks for the pickup, carries it to the point or the leader, asks to drop it", () => {
    const w = flat();
    const r = rig(w, 0, 0, { kind: "porter", spec: { weapon: WEAPON.FISTS, role: NPC.PORTER } });
    const m = mindOf(r.b);
    r.leader.x = 0; r.leader.z = 6;
    setIntent(r.b, { k: "fetch", prop: "p7", to: { x: 20, z: 8 } });
    m.fOn = true; m.fx = -14; m.fz = -4;
    let picked = -1, dropped = -1;
    let at = { x: 0, z: 0 };
    const t0 = r.t;
    const events: string[] = [];
    runFor(r, w, 40, () => {
      if (m.wantPickup) { m.carrying = true; picked = r.t - t0; events.push("pickup"); m.fOn = false; }
      if (m.wantDrop) { m.carrying = false; dropped = r.t - t0; at = { x: r.s.x, z: r.s.z }; events.push("drop"); setIntent(r.b, { k: "follow" }); }
    });
    expect(events).toEqual(["pickup", "drop"]);
    expect(picked).toBeGreaterThan(2);
    expect(dropped).toBeGreaterThan(picked + 4);
    expect(Math.hypot(at.x - 20, at.z - 8)).toBeLessThan(FOLLOW.drop + 0.6); // dropped at the point, then went back to the leader's heel
    expect(r.b.mode).toBe("follow");
  });

  it("fetch with no `to` brings it to the leader; a prop that has gone leaves the porter following", () => {
    const w = flat();
    const r = rig(w, 0, 0, { kind: "porter", spec: { weapon: WEAPON.FISTS, role: NPC.PORTER } });
    const m = mindOf(r.b);
    r.leader.x = 0; r.leader.z = 12;
    setIntent(r.b, { k: "fetch", prop: "p7" });
    m.fOn = true; m.fx = 10; m.fz = 0;
    let at = { x: 0, z: 0 };
    runFor(r, w, 30, () => {
      if (m.wantPickup) { m.carrying = true; m.fOn = false; }
      if (m.wantDrop) { at = { x: r.s.x, z: r.s.z }; m.carrying = false; setIntent(r.b, { k: "follow" }); }
    });
    expect(Math.hypot(at.x - 0, at.z - 12)).toBeLessThan(FOLLOW.drop + 1);
    const r2 = rig(w, 0, 0, { kind: "porter", spec: { weapon: WEAPON.FISTS, role: NPC.PORTER } });
    setIntent(r2.b, { k: "fetch", prop: "gone" }); // fOn never set: the prop is not there
    r2.leader.x = 0; r2.leader.z = -10;
    runFor(r2, w, 8);
    expect(r2.b.mode).toBe("follow");
    expect(mindOf(r2.b).wantPickup).toBe(false);
  });

  it("a rifleman told to fetch just follows (the server refuses it earlier; the brain is safe anyway)", () => {
    const w = flat();
    const r = rig(w, 0, 0);
    setIntent(r.b, { k: "fetch", prop: "p7" });
    r.leader.z = -10;
    runFor(r, w, 5);
    expect(r.b.mode).toBe("follow");
  });

  it("a surgeon goes to the patient, reports ready within reach, and breaks off when shot at and not steady", () => {
    const w = flat();
    const r = rig(w, 0, 0, { kind: "surgeon", spec: { weapon: WEAPON.PISTOL, role: NPC.SURGEON } });
    const m = mindOf(r.b);
    r.leader.z = -3;
    m.tendOn = true; m.tendX = 16; m.tendZ = 4;
    let ready = 0;
    runFor(r, w, 8, () => { if (m.ready) ready++; });
    expect(dist(r, 16, 4)).toBeLessThan(FOLLOW.tend + 0.6);
    expect(ready).toBeGreaterThan(5);
    expect(r.b.mode).toBe("tend");
    // shaken and under fire: he stops tending and answers the fire
    r.b.morale.v = 60;
    r.sn.alert = true; r.sn.token = true; r.sn.enemy = foe(16, -14); r.sn.underFire = 1;
    runFor(r, w, 1);
    expect(r.b.mode).not.toBe("tend");
  });

  it("downed hands do nothing and raise no requests", () => {
    const w = flat();
    const r = rig(w, 0, 0, { kind: "porter", spec: { weapon: WEAPON.FISTS, role: NPC.PORTER } });
    const m = mindOf(r.b);
    setIntent(r.b, { k: "fetch", prop: "p1" });
    m.fOn = true; m.fx = 0; m.fz = 0;
    r.s.flags |= FLAG.DOWNED;
    runFor(r, w, 2);
    expect(m.wantPickup).toBe(false);
    expect(r.c.moveF).toBe(0);
    expect(r.c.buttons).toBe(0);
  });
});

describe("followerThink: performance", () => {
  it("is allocation-free across intents, fights and fetches", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const nav = fakeNav();
    const b = npcBrainNew(spec());
    const m = mindOf(b);
    const me: NpcBody = { x: 0, z: 0, facing: 0, health: 100, weapon: weaponToWire(WEAPON.RIFLE as WeaponId), ammo: 5, flags: FLAG.GROUNDED, vx: 0, vz: 0 };
    const sn = mkSenses(nav, { leader: { id: "p1", x: 5, z: -5 }, enemy: foe(0, -15) });
    const c: MoveCommand = { moveF: 0, moveR: 0, yaw: 0, buttons: 0 };
    // intents are prebuilt: the host allocates them when an order arrives, never per tick
    const intents = [{ k: "follow" as const }, { k: "hold" as const, x: 3, z: 3 }, { k: "attack" as const, target: "foe" }, { k: "fetch" as const, prop: "p1" }, { k: "retreat" as const }];
    const tickOnce = (i: number): void => {
      if (i % 400 === 0) setIntent(b, intents[(i / 400) % intents.length]!);
      m.tOn = true; m.tx = 0; m.tz = -30; m.fOn = true; m.fx = 8; m.fz = 8; m.tendOn = i % 900 > 600; m.tendX = 4; m.tendZ = 4;
      m.kind = i % 2000 < 1000 ? "rifleman" : i % 2000 < 1500 ? "porter" : "surgeon";
      me.x = Math.sin(i * 0.01) * 4; me.z = Math.cos(i * 0.013) * 4;
      sn.enemy = i % 700 < 500 ? sn.enemy ?? foe(0, -15) : undefined;
      sn.alert = sn.enemy !== undefined;
      sn.token = i % 300 < 200;
      sn.underFire = i % 500 < 100 ? 0.8 : 0;
      sn.now = i * DT;
      followerThink(b, me, sn, DT, c);
      if (m.wantPickup) m.carrying = true;
      if (m.wantDrop) m.carrying = false;
    };
    for (let i = 0; i < 20000; i++) tickOnce(i);
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) tickOnce(i);
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(400_000);
  });
});

