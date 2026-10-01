import { describe, expect, it } from "vitest";
import { FLAG, NPC, WEAPON, CollisionWorld, createCharState, weaponToWire, type PlayerStateType } from "@cb/shared";
import { FOLLOWER_CAP } from "@cb/shared";
import type { CastApi, NpcSpec } from "@cb/shared";
import { mindOf } from "@cb/shared";
import { hirePool, newParty } from "@cb/shared";
import { emptyLoadout } from "@cb/shared";
import { npcBrainNew, type NpcBrainState } from "@cb/shared";
import { NO_COMMAND, parseParty, serializeParty } from "@cb/shared";
import { Followers, FOLLOWERS_RATE, type FollowersHost } from "./Followers.ts";

type Row = PlayerStateType & { morale?: number; cmd?: number };
const SEED = 41;
const DAY = 2;
const world = new CollisionWorld({ height: () => 0 }, [], 160);

function mkRow(x: number, z: number, o: Partial<Row> = {}): Row {
  return { ...createCharState(x, z, world), name: "", look: "", title: "", health: 100, reviveProgress: 0, reviver: "", dragger: "", slot: 0, connected: true, weapon: weaponToWire(WEAPON.RIFLE), weapons: 0, ammo: 5, reserve: 12, reload: 0, shots: 0, aim: 0, npc: 0, ...o } as unknown as Row;
}

interface Rig {
  f: Followers;
  host: FollowersHost;
  rows: Map<string, Row>;
  brains: Map<string, NpcBrainState>;
  roles: Map<string, number>;
  log: { notices: [string, string][]; spent: number[]; dressed: string[]; revived: string[]; held: string[]; dropped: string[]; setParty: string[] };
  s: { purse: number; day: number; now: number; open: boolean; dead: Set<string>; props: Map<string, { x: number; z: number }>; party: string; holdOk: boolean; reviveOk: boolean; dressOk: boolean; despawned: string[] };
  human(id: string, x?: number, z?: number, o?: Partial<Row>): Row;
  tick(n?: number): void;
}

function rig(opts: { party?: string } = {}): Rig {
  const rows = new Map<string, Row>();
  const brains = new Map<string, NpcBrainState>();
  const roles = new Map<string, number>();
  const log: Rig["log"] = { notices: [], spent: [], dressed: [], revived: [], held: [], dropped: [], setParty: [] };
  const s: Rig["s"] = { purse: 200, day: DAY, now: 1000, open: true, dead: new Set(), props: new Map(), party: opts.party ?? "", holdOk: true, reviveOk: true, dressOk: true, despawned: [] };
  const cast: CastApi = {
    spawn: (specs: readonly NpcSpec[]) => {
      let n = 0;
      for (const sp of specs) {
        const key = `npc:${sp.id}`;
        if (rows.has(key) || n >= 3) continue; // a tight cap: the Cast refuses the fourth
        rows.set(key, mkRow(sp.post.x, sp.post.z, { npc: sp.role, name: sp.name, weapon: weaponToWire(sp.weapon) }));
        brains.set(sp.id, npcBrainNew(sp));
        roles.set(sp.id, sp.role);
        n++;
      }
      return n;
    },
    order: () => {}, setWar: () => {}, count: () => ({ alive: 0, routed: 0, down: 0, total: 0 }), row: (id: string) => rows.get(`npc:${id}`) ?? rows.get(id),
    defineRoute: () => {}, noise: () => {}, despawn: (g?: string) => { s.despawned.push(g ?? "*"); for (const k of [...rows.keys()]) if (k.startsWith("npc:hand-")) rows.delete(k); }, tick: () => {}, setWorld: () => {}, atWar: () => false,
  };
  const host: FollowersHost = {
    players: { forEach: (cb) => rows.forEach((p, id) => { if (!p.npc) cb(p, id); }), get: (id) => rows.get(id) },
    cast,
    brainOf: (id) => brains.get(id),
    purse: () => s.purse,
    spend: (n) => { log.spent.push(n); s.purse -= n; },
    getParty: () => s.party,
    setParty: (j) => { s.party = j; log.setParty.push(j); },
    dress: (m, t) => { log.dressed.push(`${m}>${t}`); return s.dressOk; },
    revive: (m, t) => { log.revived.push(`${m}>${t}`); return s.reviveOk; },
    propPos: (id) => s.props.get(id),
    holdProp: (k, id) => { log.held.push(`${k}:${id}`); return s.holdOk; },
    dropProp: (k) => { log.dropped.push(k); },
    notice: (sid, text) => { log.notices.push([sid, text]); },
    prepOpen: () => s.open,
    inBounds: (x, z) => Math.abs(x) <= 120 && Math.abs(z) <= 120,
    day: () => s.day,
    nowS: () => s.now,
    seed: SEED,
    isDead: (k) => s.dead.has(k),
  };
  const f = new Followers(host);
  return {
    f, host, rows, brains, roles, log, s,
    human: (id, x = 0, z = 80, o = {}) => { const r = mkRow(x, z, o); rows.set(id, r); return r; },
    tick: (n = 1) => { for (let i = 0; i < n; i++) { s.now += 1 / 30; f.tick(1 / 30); } },
  };
}

/** A rig with `kinds` hired through the real message path and landed. */
function landed(...picks: number[]): Rig {
  const r = rig();
  r.human("p1");
  const pool = hirePool(SEED, DAY);
  for (const i of picks) {
    expect(r.f.onHire("p1", { id: pool[i]!.id, on: true })).toBe(true);
    r.s.now += 1; // a fresh second for the sender's budget
  }
  r.f.landfall({ x: 0, z: 82 });
  r.s.now += 1;
  return r;
}
const handIds = (r: Rig): string[] => r.f.party.roster.map((h) => h.id);
const MSG_FREEZE = (r: Rig): string => JSON.stringify([r.s.party, r.s.purse, [...r.brains.values()].map((b) => [b.intent, b.mode])]);

describe("hire / loadout messages", () => {
  it("hire: charged once (the signing fee), published, noticed; dismiss pays what is owed", () => {
    const r = rig();
    r.human("p1");
    const c = hirePool(SEED, DAY)[0]!;
    expect(r.f.onHire("p1", { id: c.id, on: true })).toBe(true);
    expect(r.s.purse).toBe(200 - c.wage);
    expect(r.log.spent).toEqual([c.wage]);
    expect(r.f.party.roster.map((h) => h.id)).toEqual([c.id]);
    expect(parseParty(r.s.party)!.roster).toHaveLength(1);
    expect(r.log.notices.at(-1)![1]).toContain(c.name);
    r.s.now += 1;
    expect(r.f.onHire("p1", { id: c.id, on: true })).toBe(false); // already on the books: nothing charged
    expect(r.s.purse).toBe(200 - c.wage);
    r.s.now += 1;
    expect(r.f.onHire("p1", { id: c.id, on: false })).toBe(true);
    expect(r.f.party.roster).toEqual([]);
    expect(r.s.purse).toBe(200 - c.wage);
  });

  it("the roster is capped at four; a fifth is refused and nothing is spent", () => {
    const r = rig();
    r.human("p1");
    for (let d = 1; d <= FOLLOWER_CAP; d++) {
      r.s.day = d;
      expect(r.f.onHire("p1", { id: hirePool(SEED, d)[0]!.id, on: true })).toBe(true);
      r.s.now += 1;
    }
    const before = r.s.purse;
    r.s.day = 9;
    expect(r.f.onHire("p1", { id: hirePool(SEED, 9)[0]!.id, on: true })).toBe(false);
    expect(r.s.purse).toBe(before);
    expect(r.f.party.roster).toHaveLength(FOLLOWER_CAP);
  });

  it("loadoutSet stores a normalised manifest at the table, and only at the table", () => {
    const r = rig();
    r.human("p1");
    expect(r.f.onLoadoutSet("p1", { loadout: { ammo: 9, wagon: true, horses: 1, junk: 3 } })).toBe(true);
    expect(r.f.party.loadout).toEqual({ ammo: 2, medical: 0, provisions: 0, powder: 0, horses: 1, wagon: true });
    expect(parseParty(r.s.party)!.loadout.ammo).toBe(2);
    const before = r.s.party;
    r.s.open = false;
    r.s.now += 1;
    expect(r.f.onLoadoutSet("p1", { loadout: { ammo: 0 } })).toBe(false);
    expect(r.f.onHire("p1", { id: hirePool(SEED, DAY)[0]!.id, on: true })).toBe(false);
    expect(r.s.party).toBe(before);
  });

  it("the party is published on change only", () => {
    const r = rig();
    r.human("p1");
    r.f.onLoadoutSet("p1", { loadout: { ammo: 1 } });
    r.s.now += 1;
    const n = r.log.setParty.length;
    r.f.onLoadoutSet("p1", { loadout: { ammo: 1 } });
    expect(r.log.setParty.length).toBe(n);
  });

  it("a stored party is read back on construction", () => {
    const p = newParty();
    p.roster = hirePool(SEED, 1);
    p.loadout = { ...emptyLoadout(), ammo: 2 };
    const r = rig({ party: serializeParty(p) });
    expect(r.f.party).toEqual(p);
  });
});

describe("departure and landfall", () => {
  it("prepCommit charges the manifest once and stores the stock; an unaffordable one is trimmed with a notice", () => {
    const r = rig();
    r.human("p1");
    r.f.onLoadoutSet("p1", { loadout: { ammo: 1, medical: 2, provisions: 2, powder: 1 } }); // £10 + 12 + 8 + 8 = 38, 6+6+8+8 = 28 kg
    const a = r.f.prepCommit();
    expect(a.charged).toBe(38);
    expect(r.s.purse).toBe(162);
    expect(a.effects).toMatchObject({ reserveMul: 1.5, dressings: 8, provisions: 2, kegs: 1 });
    expect(r.f.party).toMatchObject({ medical: 8, provisions: 2 });
    expect(a.lines).toEqual([]);
    // a second departure is a second purchase (the manifest persists): cancel is free because prepCommit is only called when the ship leaves
    r.s.purse = 30;
    const b = r.f.prepCommit();
    expect(b.lines.some((l) => /Powder/.test(l))).toBe(true);
    expect(b.charged).toBeLessThanOrEqual(30);
    expect(r.s.purse).toBe(30 - b.charged);
    expect(r.log.notices.some(([sid, t]) => sid === "*" && /Powder/.test(t))).toBe(true);
  });

  it("check() is the propose-time validation", () => {
    const r = rig();
    r.human("p1");
    r.f.onLoadoutSet("p1", { loadout: { wagon: true } });
    expect(r.f.check().ok).toBe(false);
    r.s.now += 1;
    r.f.onLoadoutSet("p1", { loadout: { wagon: true, horses: 1 } });
    expect(r.f.check()).toMatchObject({ ok: true, cost: 62 });
  });

  it("landfall spawns the roster as brains the pure code can drive (kind, morale, nerve, post), follow order, no command shown", () => {
    const r = landed(0, 1, 2);
    expect(r.f.active).toBe(3);
    for (const h of r.f.party.roster) {
      const row = r.rows.get(`npc:${h.id}`)!;
      const b = r.brains.get(h.id)!;
      expect(mindOf(b).kind).toBe(h.kind);
      expect(b.morale.v).toBe(h.morale);
      expect(b.intent).toEqual({ k: "follow" });
      expect(row.cmd).toBe(NO_COMMAND);
      expect(Math.hypot(row.x - 0, row.z - 82)).toBeCloseTo(2.6, 3);
    }
  });

  it("the Cast's refusal (cap) leaves that hand at the quay; the rest come", () => {
    const r = rig();
    r.human("p1");
    for (let d = 1; d <= 4; d++) { r.s.day = d; r.f.onHire("p1", { id: hirePool(SEED, d)[0]!.id, on: true }); r.s.now += 1; }
    expect(r.f.landfall({ x: 0, z: 82 })).toBe(3);
    expect(r.f.active).toBe(3);
  });

  it("endExpedition drops carried props, clears, despawns the party group", () => {
    const r = landed(0, 1, 2);
    const id = handIds(r).find((i) => r.roles.get(i) === NPC.PORTER);
    if (id) mindOf(r.brains.get(id)!).carrying = true;
    r.f.endExpedition();
    expect(r.f.active).toBe(0);
    expect(r.s.despawned).toContain("party");
    if (id) expect(r.log.dropped).toContain(`npc:${id}`);
  });
});

/** The first hand of `role` (the pool is deterministic, so the kinds are known per test via role). */
const handOf = (r: Rig, role: number): string | undefined => handIds(r).find((i) => r.roles.get(i) === role);

describe("commands", () => {
  it("follow / hold / retreat are obeyed by a steady hand; the plate shows the order; `Obeyed` is noticed", () => {
    const r = landed(0, 1, 2);
    r.human("p2", 3, 80);
    const id = handIds(r)[0]!;
    const row = r.rows.get(`npc:${id}`)!;
    const out = r.f.onCommand("p1", { intent: "hold", at: { x: 10, z: 70 }, who: 1 });
    expect(out).toMatch(/^Obeyed/);
    expect(r.brains.get(id)!.intent).toEqual({ k: "hold", x: 10, z: 70 });
    expect(row.cmd).toBe(1);
    expect(r.log.notices.at(-1)![0]).toBe("p1");
    // the others were not named
    expect(r.brains.get(handIds(r)[1]!)!.intent).toEqual({ k: "follow" });
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "retreat" })).toMatch(/^Obeyed/);
    for (const i of handIds(r)) expect(r.brains.get(i)!.intent).toEqual({ k: "retreat" });
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "follow" })).toMatch(/^Obeyed/);
    expect(row.cmd).toBe(0);
  });

  it("a hand's own morale decides: a broken hand refuses with an authored line, a shaken one refuses attack when the leader is far", () => {
    const r = landed(0, 1, 2);
    const foe = mkRow(30, 60, { npc: NPC.DESERTER, weapon: weaponToWire(WEAPON.PISTOL) });
    r.rows.set("npc:deserter-1", foe);
    const ids = handIds(r);
    const roleIds = ids.filter((i) => r.roles.get(i) !== NPC.PORTER);
    const a = roleIds[0]!;
    r.brains.get(a)!.morale.v = 10;
    r.rows.get(`npc:${a}`)!.x = 90; // out of reach of the leader at (0,80)
    const out = r.f.onCommand("p1", { intent: "follow", who: 1 << ids.indexOf(a) });
    expect(out).toMatch(/^Refused/);
    const note = r.log.notices.at(-1)![1];
    expect(note.length).toBeGreaterThan(30);
    expect(r.brains.get(a)!.intent).toEqual({ k: "follow" });
    // shaken, leader far: attack refused; with the leader beside him: obeyed
    r.brains.get(a)!.morale.v = 60;
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "attack", target: "deserter-1", who: 1 << ids.indexOf(a) })).toMatch(/^Refused/);
    r.rows.get(`npc:${a}`)!.x = 2;
    r.rows.get(`npc:${a}`)!.z = 80;
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "attack", target: "deserter-1", who: 1 << ids.indexOf(a) })).toMatch(/^Obeyed/);
    expect(r.brains.get(a)!.intent).toEqual({ k: "attack", target: "deserter-1" });
    expect(mindOf(r.brains.get(a)!)).toMatchObject({ tOn: true, tx: 30, tz: 60 });
  });

  it("an attack order is only for foes: never a human, a hand, the hostage or a downed man; a nonexistent target is ignored", () => {
    const r = landed(0, 1, 2);
    r.human("p2", 5, 80);
    r.rows.set("npc:hostage", mkRow(20, 60, { npc: NPC.HOSTAGE }));
    r.rows.set("npc:sentry-1", mkRow(30, 60, { npc: NPC.SENTRY, flags: FLAG.GROUNDED | FLAG.DOWNED }));
    r.rows.set("npc:sentry-2", mkRow(31, 60, { npc: NPC.SENTRY }));
    const before = MSG_FREEZE(r);
    const bad = ["p2", "p1", handIds(r)[0]!, "hostage", "npc:hostage", "sentry-1", "nobody", `npc:${handIds(r)[1]}`];
    for (const t of bad) {
      r.s.now += 1;
      expect(r.f.onCommand("p1", { intent: "attack", target: t }), t).toBe("");
    }
    expect(MSG_FREEZE(r)).toBe(before);
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "attack", target: "npc:sentry-2" })).toMatch(/^(Obeyed|Refused)/); // a Ward soldier is a legal target: the player's call
  });

  it("fetch needs a free prop, never an NPC row; the porter walks, picks it up and delivers (the host holds it)", () => {
    const r = landed(0, 1, 2);
    r.rows.set("npc:deserter-1", mkRow(10, 70, { npc: NPC.DESERTER }));
    r.s.props.set("p5", { x: 8, z: 74 });
    const por = handOf(r, NPC.PORTER);
    expect(por, "the seeded pool has a porter").toBeDefined();
    expect(r.f.onCommand("p1", { intent: "fetch", target: "deserter-1" })).toBe(""); // an enemy row is not a prop
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "fetch", target: "p404" })).toBe("");
    r.s.now += 1;
    const porIx = handIds(r).indexOf(por!);
    expect(r.f.onCommand("p1", { intent: "fetch", target: "p5", at: { x: 2, z: 78 }, who: 1 << porIx })).toMatch(/^Obeyed/);
    const b = r.brains.get(por!)!;
    const m = mindOf(b);
    expect(b.intent).toEqual({ k: "fetch", prop: "p5", to: { x: 2, z: 78 } });
    expect(m).toMatchObject({ fOn: true, fx: 8, fz: 74 });
    // the brain asks (we play its part), the host answers
    m.wantPickup = true;
    r.tick();
    expect(r.log.held).toEqual([`npc:${por}:p5`]);
    expect(m.carrying).toBe(true);
    m.wantDrop = true;
    r.tick();
    expect(r.log.dropped).toContain(`npc:${por}`);
    expect(m.carrying).toBe(false);
    expect(b.intent).toEqual({ k: "follow" });
  });

  it("a prop that cannot be held ends the fetch; a prop that vanishes does too", () => {
    const r = landed(0, 1, 2);
    const por = handOf(r, NPC.PORTER)!;
    r.s.props.set("p5", { x: 8, z: 74 });
    const ix = handIds(r).indexOf(por);
    r.f.onCommand("p1", { intent: "fetch", target: "p5", who: 1 << ix });
    r.s.holdOk = false;
    mindOf(r.brains.get(por)!).wantPickup = true;
    r.tick();
    expect(r.brains.get(por)!.intent).toEqual({ k: "follow" });
    r.s.now += 1;
    r.s.holdOk = true;
    r.f.onCommand("p1", { intent: "fetch", target: "p5", who: 1 << ix });
    r.s.props.delete("p5");
    r.tick();
    expect(r.brains.get(por)!.intent).toEqual({ k: "follow" });
  });

  it("the attack order ends by itself when the target goes down", () => {
    const r = landed(0, 1, 2);
    const foe = mkRow(30, 60, { npc: NPC.DESERTER });
    r.rows.set("npc:deserter-1", foe);
    const a = handIds(r).find((i) => r.roles.get(i) !== NPC.PORTER)!;
    r.f.onCommand("p1", { intent: "attack", target: "deserter-1", who: 1 << handIds(r).indexOf(a) });
    expect(r.brains.get(a)!.intent?.k).toBe("attack");
    r.tick();
    expect(r.brains.get(a)!.intent?.k).toBe("attack");
    foe.flags |= FLAG.DOWNED;
    r.tick();
    expect(r.brains.get(a)!.intent).toEqual({ k: "follow" });
  });

  it("per-follower gap: two orders inside half a second are one order", () => {
    const r = landed(0, 1, 2);
    expect(r.f.onCommand("p1", { intent: "retreat" })).toMatch(/^Obeyed/);
    r.s.now += 0.3;
    expect(r.f.onCommand("p1", { intent: "follow" })).toBe("");
    for (const i of handIds(r)) expect(r.brains.get(i)!.intent).toEqual({ k: "retreat" });
    r.s.now += 0.3;
    expect(r.f.onCommand("p1", { intent: "follow" })).toMatch(/^Obeyed/);
  });
});

describe("hostile messages: ignored, no throw, state unchanged", () => {
  it("forged payloads of every shape", () => {
    const r = landed(0, 1, 2);
    r.human("p2", 5, 80);
    const before = MSG_FREEZE(r);
    const junk: unknown[] = [undefined, null, 0, 1, NaN, "", "x", [], {}, true, () => 1, Symbol("s"), 1n,
      { intent: "attack" }, { intent: "dance" }, { intent: "hold", at: { x: 500, z: 80 } }, { intent: "hold", at: { x: NaN, z: 0 } }, { intent: "hold", at: { x: 5 } },
      { intent: "follow", who: 16 }, { intent: "follow", who: -1 }, { intent: "follow", who: 2 ** 31 }, { intent: "follow", who: "1" }, { intent: "fetch" }, { intent: "fetch", target: 5 },
      { intent: "hold", at: { x: 0, z: 500 } }, { intent: "hold", at: { x: 130, z: 80 } }, Object.create({ intent: "follow" })];
    for (const j of junk) {
      r.s.now += 1;
      expect(() => r.f.onCommand("p1", j), String(typeof j)).not.toThrow();
      expect(r.f.onCommand("p1", j), String(j)).toBe("");
      expect(() => r.f.onHire("p1", j)).not.toThrow();
      expect(() => r.f.onLoadoutSet("p1", j)).not.toThrow();
    }
    expect(MSG_FREEZE(r)).toBe(before);
  });

  it("a point 500 m away, outside the bounds, or 61 m from the sender is refused; 59 m inside is taken", () => {
    const r = landed(0, 1, 2);
    expect(r.f.onCommand("p1", { intent: "hold", at: { x: 500, z: 80 } })).toBe("");
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "hold", at: { x: 0, z: 19 } })).toBe(""); // 61 m
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "hold", at: { x: 0, z: 21 } })).toMatch(/^Obeyed/); // 59 m, inside the bounds
    r.s.now += 1;
    r.human("p3", 0, 119);
    expect(r.f.onCommand("p3", { intent: "hold", at: { x: 0, z: 125 } })).toBe(""); // near, but outside the map
  });

  it("senders: strangers, NPC rows, downed or disconnected humans, and forged names are ignored", () => {
    const r = landed(0, 1, 2);
    r.human("down", 0, 80, { flags: FLAG.GROUNDED | FLAG.DOWNED });
    r.human("gone", 0, 80, { connected: false });
    const before = MSG_FREEZE(r);
    for (const sid of ["nobody", "npc:" + handIds(r)[0], "", "down", "gone", "__proto__", "constructor"]) {
      expect(r.f.onCommand(sid, { intent: "retreat" }), sid).toBe("");
      expect(r.f.onHire(sid, { id: hirePool(SEED, DAY)[0]!.id, on: true }), sid).toBe(false);
      expect(r.f.onLoadoutSet(sid, { loadout: { ammo: 2 } }), sid).toBe(false);
      r.s.now += 1;
    }
    expect(MSG_FREEZE(r)).toBe(before);
  });

  it("nothing is commanded before the hands are on the ground", () => {
    const r = rig();
    r.human("p1");
    r.f.onHire("p1", { id: hirePool(SEED, DAY)[0]!.id, on: true });
    r.s.now += 1;
    expect(r.f.onCommand("p1", { intent: "follow" })).toBe("");
  });

  it("spam: more than four messages in a second are dropped, and the budget returns the next second", () => {
    const r = landed(0, 1, 2);
    let ok = 0;
    for (let i = 0; i < 40; i++) {
      r.s.now += 0.5 / 40; // all inside half a second
      if (r.f.onLoadoutSet("p1", { loadout: { ammo: i % 3 } }) || r.f.onCommand("p1", { intent: i % 2 ? "retreat" : "follow" }) !== "") ok++;
    }
    // (landed() leaves the sender's window fresh; every kind of message shares it)
    expect(ok).toBeLessThanOrEqual(FOLLOWERS_RATE);
    r.s.now += 1.1;
    expect(r.f.onLoadoutSet("p1", { loadout: { ammo: 1 } })).toBe(true);
  });

  it("a flood of one-off senders does not lock out the table (the budget map resets itself)", () => {
    const r = landed(0, 1, 2);
    for (let i = 0; i < 500; i++) {
      r.human(`s${i}`, 0, 80);
      r.f.onLoadoutSet(`s${i}`, { loadout: {} });
    }
    r.s.now += 1.5;
    expect(r.f.onLoadoutSet("p1", { loadout: { ammo: 1 } })).toBe(true);
  });
});

describe("the surgeon", () => {
  const surgeonRig = (): { r: Rig; sid: string } => {
    for (let pick = 0; pick < 3; pick++) {
      for (let day = 1; day < 40; day++) {
        const pool = hirePool(SEED, day);
        if (pool[pick]!.kind !== "surgeon") continue;
        const r = rig();
        r.human("p1");
        r.s.day = day;
        r.f.onHire("p1", { id: pool[pick]!.id, on: true });
        r.f.landfall({ x: 0, z: 82 });
        r.s.now += 1;
        return { r, sid: pool[pick]!.id };
      }
    }
    throw new Error("no surgeon in the seeded pools");
  };

  it("picks the downed human over a nearer wounded one, sends the brain there, revives when it reports ready, and stops when the patient stands", () => {
    const { r, sid } = surgeonRig();
    const m = mindOf(r.brains.get(sid)!);
    const down = r.human("p2", 12, 82, { flags: FLAG.GROUNDED | FLAG.DOWNED });
    r.human("p3", 2, 84, { health: 40 });
    r.f.tick(0); // nothing yet: needs a tick that finds work
    r.tick(3);
    expect(m.tendOn).toBe(true);
    expect([m.tendX, m.tendZ]).toEqual([12, 82]);
    m.ready = true;
    r.tick();
    expect(r.log.revived).toContain(`npc:${sid}>p2`);
    down.flags &= ~FLAG.DOWNED; // he is up
    r.tick();
    expect(m.tendOn).toBe(false);
  });

  it("dresses the wounded with the party's dressings (one per use) and stops at none", () => {
    const { r, sid } = surgeonRig();
    r.f.onLoadoutSet("p1", { loadout: { medical: 1 } });
    r.f.prepCommit();
    expect(r.f.party.medical).toBe(4);
    const m = mindOf(r.brains.get(sid)!);
    const hurt = r.human("p3", 3, 84, { health: 40 });
    r.tick(3);
    expect(m.tendOn).toBe(true);
    m.ready = true;
    r.tick();
    expect(r.log.dressed).toEqual([`npc:${sid}>p3`]);
    expect(r.f.party.medical).toBe(3);
    hurt.health = 90;
    r.tick();
    expect(m.tendOn).toBe(false);
    // no dressings: a wounded man is not a patient
    expect(r.f.takeDressing()).toBe(true);
    expect(r.f.takeDressing()).toBe(true);
    expect(r.f.takeDressing()).toBe(true);
    expect(r.f.takeDressing()).toBe(false);
    hurt.health = 30;
    r.s.now += 2;
    r.tick(3);
    expect(m.tendOn).toBe(false);
  });

  it("a failed revive gives up the patient rather than looping", () => {
    const { r, sid } = surgeonRig();
    const m = mindOf(r.brains.get(sid)!);
    r.human("p2", 10, 82, { flags: FLAG.GROUNDED | FLAG.DOWNED });
    r.tick(3);
    m.ready = true;
    r.s.reviveOk = false;
    r.tick();
    expect(m.tendOn).toBe(false);
  });

  it("will not take a patient someone else is already reviving", () => {
    const { r } = surgeonRig();
    r.human("p2", 10, 82, { flags: FLAG.GROUNDED | FLAG.DOWNED, reviver: "p1" });
    r.tick(5);
    const sid = [...r.brains.keys()][0]!;
    expect(mindOf(r.brains.get(sid)!).tendOn).toBe(false);
  });
});

describe("end of the expedition", () => {
  it("report: the downed are listed (the dead apart), morale is read from the brains; settle pays from the purse the campaign holds", () => {
    const r = landed(0, 1, 2);
    const ids = handIds(r);
    r.rows.get(`npc:${ids[0]}`)!.flags |= FLAG.DOWNED;
    r.s.dead.add(`npc:${ids[1]}`);
    r.brains.get(ids[2]!)!.morale.v = 37.4;
    const rep = r.f.report();
    expect(rep.down).toEqual([ids[0]]);
    expect(rep.dead).toEqual([ids[1]]);
    expect(rep.morale![ids[2]!]).toBe(37);
    const purse = r.s.purse;
    const wages = r.f.party.roster.filter((h) => h.id !== ids[1]).reduce((s, h) => s + h.wage, 0); // the downed man draws his full wage for the expedition he was hurt in
    const lines = r.f.settle({ resolution: "paid", brokePromise: false });
    expect(lines.length).toBeGreaterThan(0);
    expect(r.s.purse).toBe(purse - wages);
    expect(r.f.party.roster.map((h) => h.id)).toEqual([ids[0], ids[2]]);
    expect(r.f.party.roster[0]!.wounded).toBe(2);
    expect(parseParty(r.s.party)!.roster).toHaveLength(2);
  });

  it("settling with an empty purse owes, never goes negative", () => {
    const r = landed(0, 1, 2);
    r.s.purse = 0;
    r.f.settle({ resolution: "abandoned", brokePromise: true });
    expect(r.s.purse).toBe(0);
    for (const h of r.f.party.roster) expect(h.owed).toBeGreaterThan(0);
    expect(r.log.spent.every((n) => n > 0)).toBe(true);
  });
});

describe("plates", () => {
  it("writes morale and the order index onto the hand's row, on change only", () => {
    const r = landed(0, 1, 2);
    const id = handIds(r)[0]!;
    const row = r.rows.get(`npc:${id}`)!;
    r.brains.get(id)!.morale.v = 63.6;
    r.tick();
    expect(row.morale).toBe(64);
    let writes = 0;
    let v = row.morale;
    Object.defineProperty(row, "morale", { get: () => v, set: (x: number) => { writes++; v = x; } });
    r.tick(5);
    expect(writes).toBe(0);
    r.f.onCommand("p1", { intent: "retreat", who: 1 });
    expect(row.cmd).toBe(4);
  });
});
