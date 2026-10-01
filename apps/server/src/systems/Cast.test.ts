import { describe, expect, it } from "vitest";
import {
  BUTTON, FLAG, KESSAR_ANCHORS as A, NPC, WEAPON, createKessarWorld, createCharState, garrisonRoster, newCampaign, npcKey, stepCharacter, weaponToWire,
  CollisionWorld, type MoveCommand, type PlayerStateType, type WeaponId,
} from "@cb/shared";
import { NAV, NPC_SIDE, type BrainFn, type NpcBody, type NpcSenses, type NpcSpec } from "@cb/shared";
import { kessarNavOptions } from "@cb/shared";
import { npcThink, type NpcBrainState } from "@cb/shared";
import { Cast, CAST, type CastHost } from "./Cast.ts";

const DT = 1 / 30;
type Row = PlayerStateType;

function mkRow(world: CollisionWorld, x: number, z: number, o: Partial<Row> = {}): Row {
  const c = createCharState(x, z, world);
  return { ...c, name: "", look: "", title: "", health: 100, reviveProgress: 0, reviver: "", dragger: "", slot: 0, connected: true, weapon: weaponToWire(WEAPON.RIFLE), weapons: 0, ammo: 5, reserve: 12, reload: 0, shots: 0, aim: 0, npc: 0, ...o } as unknown as Row;
}

interface Rig {
  cast: Cast;
  rows: Map<string, Row>;
  world: CollisionWorld;
  cmds: Map<string, MoveCommand[]>;
  t: { ms: number };
  human(id: string, x: number, z: number, o?: Partial<Row>): Row;
  tick(n?: number): void;
  setWorld(w: CollisionWorld): void;
  caps: { n: number };
  host: CastHost;
}

function rig(opts: { world?: CollisionWorld; brains?: CastHost["brains"]; cap?: number; fear?: number; nav?: boolean } = {}): Rig {
  let world = opts.world ?? new CollisionWorld({ height: () => 0 }, [], 120);
  const rows = new Map<string, Row>();
  const cmds = new Map<string, MoveCommand[]>();
  const t = { ms: 100_000 };
  const caps = { n: opts.cap ?? 24 };
  const host: CastHost = {
    players: {
      forEach: (cb) => rows.forEach((p, id) => { if (!p.npc) cb(p, id); }),
      get: (id) => rows.get(id),
    },
    spawnNpc: (spec: NpcSpec) => {
      const key = npcKey(spec.id);
      let n = 0;
      rows.forEach((p) => { if (p.npc) n++; });
      if (rows.has(key) || n >= caps.n) return false;
      rows.set(key, mkRow(world, spec.post.x, spec.post.z, { npc: spec.role, name: spec.name, weapon: weaponToWire(spec.weapon), slot: 16 + n }));
      return true;
    },
    removeNpc: (key) => { rows.delete(key); },
    stepNpc: (key, cmd) => {
      const p = rows.get(key);
      if (!p) return;
      stepCharacter(p as never, cmd, DT, world);
      let a = cmds.get(key);
      if (!a) { a = []; cmds.set(key, a); }
      a.push({ ...cmd });
    },
    world: () => world,
    worldMs: () => t.ms,
    seed: 11,
    fear: () => opts.fear ?? 10,
    brains: opts.brains ?? { garrison: npcThink },
    navOptions: opts.nav ? kessarNavOptions : undefined,
  };
  const cast = new Cast(host);
  const r: Rig = {
    cast, rows, world, cmds, t, caps, host,
    human: (id, x, z, o = {}) => { const p = mkRow(world, x, z, o); rows.set(id, p); return p; },
    tick: (n = 1) => { for (let i = 0; i < n; i++) { t.ms += 1000 * DT; cast.tick(DT); } },
    setWorld: (w) => { world = w; r.world = w; cast.setWorld(w); },
  };
  return r;
}

const spec = (id: string, o: Partial<NpcSpec> = {}): NpcSpec => ({
  id, role: NPC.SENTRY, faction: "ward", side: "ward", group: "ward", post: { x: 0, z: 0 }, weapon: WEAPON.RIFLE as WeaponId, lookSeed: 7, name: id, skill: 60, bravery: 60, brain: "garrison", ...o,
});
const fired = (r: Rig, key: string): number => (r.cmds.get(key) ?? []).filter((c) => (c.buttons & BUTTON.FIRE) !== 0).length;

describe("Cast: roster", () => {
  it("spawns rows keyed npc:<id>, honours the host's refusal (cap, duplicates) and counts a group", () => {
    const r = rig({ cap: 3 });
    const n = r.cast.spawn([spec("a", { post: { x: 5, z: 5 } }), spec("b", { post: { x: 6, z: 5 } }), spec("a"), spec("c"), spec("d")]);
    expect(n).toBe(3);
    expect(r.rows.has("npc:a") && r.rows.has("npc:b") && r.rows.has("npc:c")).toBe(true);
    expect(r.cast.row("a")).toBe(r.rows.get("npc:a"));
    expect(r.cast.row("zzz")).toBeUndefined();
    expect(r.cast.count("ward")).toEqual({ alive: 3, routed: 0, down: 0, total: 3 });
    expect(r.cast.count("nobody")).toEqual({ alive: 0, routed: 0, down: 0, total: 0 });
    r.rows.get("npc:b")!.flags |= FLAG.DOWNED;
    expect(r.cast.count("ward")).toEqual({ alive: 2, routed: 0, down: 1, total: 3 });
  });

  it("a reaped row (the host removed it) still counts as down", () => {
    const r = rig();
    r.cast.spawn([spec("a"), spec("b")]);
    r.rows.delete("npc:a");
    r.tick(2);
    expect(r.cast.count("ward")).toEqual({ alive: 1, routed: 0, down: 1, total: 2 });
  });

  it("despawn removes a group or everyone, through the host", () => {
    const r = rig();
    r.cast.spawn([spec("a"), spec("b", { group: "rival", side: "rival", faction: "rival" })]);
    r.cast.despawn("rival");
    expect(r.rows.has("npc:b")).toBe(false);
    expect(r.rows.has("npc:a")).toBe(true);
    r.cast.despawn();
    expect(r.rows.size).toBe(0);
    expect(r.cast.count("ward").total).toBe(0);
  });

  it("the real Kessar roster spawns, sides included", () => {
    const w = createKessarWorld(3, "intact");
    const r = rig({ world: w, nav: true });
    const roster = garrisonRoster(newCampaign(3), 3);
    expect(r.cast.spawn(roster)).toBe(roster.length);
    expect(r.cast.count("ward").total).toBe(roster.filter((s) => s.group === "ward").length);
    expect(r.cast.count("rival").total).toBe(3);
  });
});

describe("Cast: who fights whom", () => {
  it("the Ward ignores the party until the group is alert, then fights it", () => {
    const r = rig();
    r.human("p1", 0, -15);
    r.cast.spawn([spec("s1", { post: { x: 0, z: 0 } })]);
    r.tick(150);
    expect(fired(r, "npc:s1")).toBe(0);
    r.cast.order("ward", { o: "alert" });
    r.tick(240);
    expect(fired(r, "npc:s1")).toBeGreaterThan(0);
  });

  it("outlaws fight everyone at once; neutrals are nobody's target", () => {
    const r = rig();
    r.human("p1", 0, -18);
    r.cast.spawn([spec("d1", { role: NPC.DESERTER, side: "outlaw", group: "camp", faction: "rival", post: { x: 0, z: 0 } }), spec("h1", { role: NPC.HOSTAGE, side: "neutral", group: "hostage", brain: "civil", weapon: WEAPON.FISTS as WeaponId, post: { x: 3, z: 0 } })]);
    r.tick(240);
    expect(fired(r, "npc:d1")).toBeGreaterThan(0);
    expect(fired(r, "npc:h1")).toBe(0);
    // the deserter's target is the human, never the hostage
    const seen = new Set<string>();
    const spy: BrainFn = (b, me, sn, dt, out) => { if (sn.enemy) seen.add(sn.enemy.id); npcThink(b, me, sn, dt, out); };
    const r2 = rig({ brains: { garrison: spy } });
    r2.human("p1", 0, -18);
    r2.cast.spawn([spec("d1", { role: NPC.DESERTER, side: "outlaw", group: "camp", post: { x: 0, z: 0 } }), spec("h1", { role: NPC.HOSTAGE, side: "neutral", group: "hostage", brain: "garrison", post: { x: 3, z: 0 } })]);
    r2.tick(60);
    expect([...seen]).toEqual(["p1"]);
  });

  it("Ward vs Syndicate only under war; outlaws are always at war; roles map to sides", () => {
    const r = rig();
    expect(r.cast.atWar(NPC.SENTRY, NPC.RIVAL_GUARD)).toBe(false);
    r.cast.setWar("ward", "rival", true);
    expect(r.cast.atWar(NPC.SENTRY, NPC.RIVAL_GUARD)).toBe(true);
    expect(r.cast.atWar(NPC.RIVAL_SURVEYOR, NPC.WARDEN)).toBe(true);
    r.cast.setWar("rival", "ward", false);
    expect(r.cast.atWar(NPC.SENTRY, NPC.RIVAL_GUARD)).toBe(false);
    expect(r.cast.atWar(NPC.DESERTER, NPC.SENTRY)).toBe(true);
    expect(r.cast.atWar(NPC.DESERTER, 0)).toBe(true);
    expect(r.cast.atWar(NPC.HOSTAGE, NPC.DESERTER)).toBe(false);
    expect(r.cast.atWar(NPC.SENTRY, NPC.SENTRY)).toBe(false);
    expect(NPC_SIDE[NPC.PORTER]).toBe("party");
  });

  it("under war the two sides shoot each other with no player in the room", () => {
    const r = rig();
    r.cast.spawn([
      spec("w1", { post: { x: -8, z: 0 } }),
      spec("r1", { role: NPC.RIVAL_GUARD, faction: "rival", side: "rival", group: "rival", post: { x: 8, z: 0 } }),
    ]);
    r.tick(120);
    expect(fired(r, "npc:w1") + fired(r, "npc:r1")).toBe(0);
    r.cast.setWar("ward", "rival", true);
    r.tick(300);
    expect(fired(r, "npc:w1")).toBeGreaterThan(0);
    expect(fired(r, "npc:r1")).toBeGreaterThan(0);
  });

  it("hired hands (party side) fight the Ward only once the Ward is alert", () => {
    const r = rig();
    r.cast.spawn([
      spec("f1", { role: NPC.HIRED_RIFLE, side: "party", group: "hands", brain: "follower", post: { x: -8, z: 0 } }),
      spec("w1", { post: { x: 8, z: 0 } }),
    ]);
    r.tick(150);
    expect(fired(r, "npc:f1") + fired(r, "npc:w1")).toBe(0);
    r.cast.order("ward", { o: "alert" });
    r.tick(300);
    expect(fired(r, "npc:f1")).toBeGreaterThan(0);
  });

  it("a wall between them means no target: nobody fires through a tall obstacle", () => {
    const wall = { kind: "box" as const, tag: "wall" as const, x: 0, z: -8, hx: 30, hz: 0.5, yaw: 0, y0: -1, y1: 3 };
    const r = rig({ world: new CollisionWorld({ height: () => 0 }, [wall], 120) });
    r.human("p1", 0, -16);
    r.cast.spawn([spec("s1", { post: { x: 0, z: 0 } })]);
    r.cast.order("ward", { o: "alert" });
    r.tick(240);
    expect(fired(r, "npc:s1")).toBe(0);
  });
});

describe("Cast: whose bullets hurt whom (hostileTo) and the hands' attack orders", () => {
  const sentry = (id: string) => spec(id, { post: { x: 0, z: 0 } });
  const rival = (id: string) => spec(id, { role: NPC.RIVAL_GUARD, faction: "rival", side: "rival", group: "rival", post: { x: 6, z: 0 } });
  const hand = (id: string) => spec(id, { role: NPC.HIRED_RIFLE, faction: "ward", side: "party", group: "party", brain: "follower", post: { x: -6, z: 0 } });

  it("a sentry's rounds reach the party only once the Ward is alert, and never the Syndicate unless they are at war", () => {
    const r = rig();
    r.human("p1", 0, -15);
    r.cast.spawn([sentry("s1"), rival("r1")]);
    expect(r.cast.hostileTo("npc:s1", "p1")).toBe(false);
    expect(r.cast.hostileTo("npc:s1", "npc:r1")).toBe(false);
    r.cast.order("ward", { o: "alert" });
    expect(r.cast.hostileTo("npc:s1", "p1")).toBe(true);
    expect(r.cast.hostileTo("npc:s1", "npc:r1")).toBe(false);
    r.cast.setWar("ward", "rival", true);
    expect(r.cast.hostileTo("npc:s1", "npc:r1")).toBe(true);
    expect(r.cast.hostileTo("npc:r1", "npc:s1")).toBe(true);
  });

  it("a hand's rounds hurt an alert enemy, never the party it works for, and an ordered target at any time; unknown shooters hurt nobody", () => {
    const r = rig();
    r.human("p1", -10, 0);
    r.cast.spawn([sentry("s1"), hand("h1")]);
    expect(r.cast.hostileTo("npc:h1", "npc:s1")).toBe(false); // answers fire, does not start it
    expect(r.cast.hostileTo("npc:h1", "p1")).toBe(false);
    const b = r.cast.brainOf("h1")!;
    expect(b).toBeDefined();
    b.intent = { k: "attack", target: "s1" };
    expect(r.cast.hostileTo("npc:h1", "npc:s1")).toBe(true); // the order is the declaration
    b.intent = undefined;
    r.cast.order("ward", { o: "alert" });
    expect(r.cast.hostileTo("npc:h1", "npc:s1")).toBe(true);
    expect(r.cast.hostileTo("npc:ghost", "p1")).toBe(false);
    expect(r.cast.brainOf("ghost")).toBeUndefined();
  });

  it("outlaws are hostile to everything that is not neutral, in or out of sight", () => {
    const r = rig();
    r.human("p1", 0, -15);
    r.cast.spawn([spec("d1", { role: NPC.DESERTER, side: "outlaw", group: "camp" }), sentry("s1"), spec("h1", { role: NPC.HOSTAGE, side: "neutral", group: "hostage", brain: "civil", post: { x: 3, z: 0 } })]);
    expect(r.cast.hostileTo("npc:d1", "p1")).toBe(true);
    expect(r.cast.hostileTo("npc:d1", "npc:s1")).toBe(true);
    expect(r.cast.hostileTo("npc:d1", "npc:h1")).toBe(false);
  });

  it("a hand ordered to attack picks THAT enemy, even a nearer one is not chosen", () => {
    const seen: string[] = [];
    const spy: BrainFn = (b, me, sn, dt, out) => { if (b.target !== undefined && sn.enemy) seen.push(sn.enemy.id); npcThink(b, me, sn, dt, out); };
    const r = rig({ brains: { garrison: npcThink, follower: spy } });
    r.human("p1", -10, 0);
    r.cast.spawn([
      spec("near", { post: { x: -2, z: 0 } }),
      spec("far", { post: { x: 12, z: 0 } }),
      hand("h1"),
    ]);
    r.cast.order("ward", { o: "alert" });
    r.cast.brainOf("h1")!.intent = { k: "attack", target: "far" };
    r.tick(10);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(["npc:far"]));
  });
});

describe("Cast: attack tokens", () => {
  it("never more than two firing at one target; the rest are told to wait", () => {
    let maxHolders = 0;
    const holders = new Map<string, number>();
    const spy: BrainFn = (b, me, sn, dt, out) => {
      if (sn.enemy && sn.token) holders.set(sn.enemy.id, (holders.get(sn.enemy.id) ?? 0) + 1);
      npcThink(b, me, sn, dt, out);
    };
    const r = rig({ brains: { garrison: spy } });
    r.human("p1", 0, -20);
    r.cast.spawn([0, 1, 2, 3, 4, 5].map((i) => spec(`s${i}`, { post: { x: -5 + i * 2, z: 0 }, lookSeed: 100 + i })));
    r.cast.order("ward", { o: "alert" });
    for (let i = 0; i < 300; i++) {
      holders.clear();
      r.tick();
      maxHolders = Math.max(maxHolders, holders.get("p1") ?? 0);
    }
    expect(maxHolders).toBe(2); // the rule is two shooters per target, whatever the constant says
    expect(r.cast.stats.tokenGrants).toBeGreaterThan(0);
  });

  it("each target has its own two tokens, and a token holder keeps it while it can fire", () => {
    const holders = new Map<string, Set<string>>();
    const spy: BrainFn = (b, me, sn, dt, out) => { if (sn.enemy && sn.token) { const k = sn.enemy.id; (holders.get(k) ?? holders.set(k, new Set()).get(k)!).add(String((b as NpcBrainState).seed)); } npcThink(b, me, sn, dt, out); };
    const r = rig({ brains: { garrison: spy } });
    r.human("p1", -12, -20);
    r.human("p2", 12, -20);
    r.cast.spawn([0, 1, 2, 3, 4, 5].map((i) => spec(`s${i}`, { post: { x: -5 + i * 2, z: 0 }, lookSeed: 100 + i })));
    r.cast.order("ward", { o: "alert" });
    r.tick(60);
    // both players are shot at by (up to) two each: every sentry has one of the two as nearest
    expect((holders.get("p1")?.size ?? 0) + (holders.get("p2")?.size ?? 0)).toBeGreaterThanOrEqual(3);
    expect(holders.get("p1")?.size ?? 0).toBeLessThanOrEqual(2 + 2); // holders over time rotate when a gun empties, never more than 2 at once (checked above)
  });

  it("an empty gun does not hold a token: the next man gets it", () => {
    const tokens: boolean[] = [];
    const spy: BrainFn = (b, me, sn, dt, out) => { if ((b as NpcBrainState).seed === 100) tokens.push(sn.token); npcThink(b, me, sn, dt, out); };
    const r = rig({ brains: { garrison: spy } });
    r.human("p1", 0, -20);
    r.cast.spawn([spec("s0", { post: { x: 0, z: 0 }, lookSeed: 100 }), spec("s1", { post: { x: 1, z: 0 }, lookSeed: 101 }), spec("s2", { post: { x: 2, z: 0 }, lookSeed: 102 })]);
    r.cast.order("ward", { o: "alert" });
    r.tick(5);
    expect(tokens.at(-1)).toBe(true);
    r.rows.get("npc:s0")!.ammo = 0;
    r.tick(3);
    expect(tokens.at(-1)).toBe(false);
  });
});

describe("Cast: orders", () => {
  it("stand_down is inert (and the stand-down latches), post lifts it", () => {
    const r = rig();
    r.human("p1", 0, -10);
    r.cast.spawn([spec("s1")]);
    r.cast.order("ward", { o: "alert" });
    r.cast.order("ward", { o: "stand_down" });
    r.tick(200);
    expect(fired(r, "npc:s1")).toBe(0);
    const all = r.cmds.get("npc:s1")!;
    expect(all.every((c) => c.moveF === 0 && c.buttons === 0)).toBe(true);
    r.cast.order("ward", { o: "post" });
    r.cast.order("ward", { o: "alert" });
    r.tick(240);
    expect(fired(r, "npc:s1")).toBeGreaterThan(0);
  });

  it("hold_fire stops the trigger but not the movement; attack lifts it and makes a group hostile to a side", () => {
    const r = rig();
    r.human("p1", 0, -20);
    r.cast.spawn([spec("s1", { post: { x: 0, z: 0 } })]);
    r.cast.order("ward", { o: "alert" });
    r.cast.order("ward", { o: "hold_fire" });
    r.tick(240);
    expect(fired(r, "npc:s1")).toBe(0);
    r.cast.order("ward", { o: "attack", side: "party" });
    r.tick(300);
    expect(fired(r, "npc:s1")).toBeGreaterThan(0);
  });

  it("flee routs a group: counted as routed, sprinting", () => {
    const r = rig();
    r.cast.spawn([spec("s1"), spec("s2", { post: { x: 3, z: 0 } })]);
    r.cast.order("ward", { o: "flee" });
    r.tick(10);
    expect(r.cast.count("ward")).toEqual({ alive: 0, routed: 2, down: 0, total: 2 });
  });

  it("march walks a defined route to its end; an undefined route is ignored", () => {
    const r = rig();
    r.cast.defineRoute("walk", [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: -12 }]);
    r.cast.spawn([spec("r1", { group: "rival", side: "rival", faction: "rival", role: NPC.RIVAL_GUARD })]);
    r.cast.order("rival", { o: "march", route: "nope" });
    r.tick(30);
    expect(r.rows.get("npc:r1")!.x).toBeCloseTo(0, 0);
    r.cast.order("rival", { o: "march", route: "walk" });
    r.tick(600);
    const p = r.rows.get("npc:r1")!;
    expect(Math.hypot(p.x - 10, p.z + 12)).toBeLessThan(2);
  });

  it("guard moves a group to a spot and spreads it inside the radius", () => {
    const r = rig();
    r.cast.spawn([0, 1, 2].map((i) => spec(`g${i}`, { post: { x: 20, z: 20 }, lookSeed: 40 + i })));
    r.cast.order("ward", { o: "guard", x: -10, z: -10, r: 6 });
    r.tick(900);
    const xs = [0, 1, 2].map((i) => r.rows.get(`npc:g${i}`)!);
    for (const p of xs) expect(Math.hypot(p.x + 10, p.z + 10)).toBeLessThan(6);
    expect(new Set(xs.map((p) => Math.round(p.x * 10))).size).toBeGreaterThan(1);
  });

  it("follow keeps a group near the named person", () => {
    const r = rig();
    const p1 = r.human("p1", 0, 0);
    r.cast.spawn([spec("f1", { post: { x: 15, z: 15 }, role: NPC.HIRED_RIFLE, side: "party", group: "hands", brain: "follower" })]);
    r.cast.order("hands", { o: "follow", target: "p1" });
    p1.x = -10;
    p1.z = -20;
    r.tick(900);
    const f = r.rows.get("npc:f1")!;
    expect(Math.hypot(f.x - p1.x, f.z - p1.z)).toBeLessThan(6);
  });
});

describe("Cast: the people who are not soldiers", () => {
  it("a hostage stands still, bolts from a gunshot, and follows a rescuer when told to", () => {
    const r = rig();
    r.human("p1", 10, 10);
    r.cast.spawn([spec("h1", { role: NPC.HOSTAGE, side: "neutral", group: "hostage", brain: "civil", weapon: WEAPON.FISTS as WeaponId, post: { x: 0, z: 0 } })]);
    r.tick(60);
    const h = r.rows.get("npc:h1")!;
    expect(Math.hypot(h.x, h.z)).toBeLessThan(0.1);
    r.cast.noise(10, 10, 60, "p1"); // a shot at (10,10)
    r.tick(60);
    expect(Math.hypot(h.x, h.z)).toBeGreaterThan(3);
    expect(h.x + h.z).toBeLessThan(-2); // away from the report (south-east of the hostage is where it came from: he went north-west)
    r.tick(300);
    const rest = { x: h.x, z: h.z };
    r.tick(30);
    expect(Math.hypot(h.x - rest.x, h.z - rest.z)).toBeLessThan(0.1);
    r.cast.order("hostage", { o: "follow", target: "p1" });
    r.tick(600);
    expect(Math.hypot(h.x - 10, h.z - 10)).toBeLessThan(6);
    // never fires
    expect(fired(r, "npc:h1")).toBe(0);
  });

  it("noise unsettles soldiers who are not on the shooter's side", () => {
    const r = rig();
    r.cast.spawn([spec("s1", { post: { x: 0, z: 0 } })]);
    const b = (r.cast as unknown as { byKey: Map<string, { brain: NpcBrainState }> }).byKey.get("npc:s1")!.brain;
    r.cast.noise(5, 0, 40, "p1");
    expect(b.morale.shock).toBeGreaterThan(0);
    const before = b.morale.shock;
    r.cast.noise(5, 0, 40, "npc:s1"); // its own shot: no shock
    expect(b.morale.shock).toBe(before);
  });

  it("a friend going down shakes the men beside him", () => {
    const r = rig();
    r.cast.spawn([spec("s1", { post: { x: 0, z: 0 } }), spec("s2", { post: { x: 4, z: 0 } }), spec("far", { post: { x: 60, z: 0 } })]);
    r.tick(3);
    r.rows.get("npc:s1")!.flags |= FLAG.DOWNED;
    r.tick(2);
    const brain = (id: string): NpcBrainState => (r.cast as unknown as { byKey: Map<string, { brain: NpcBrainState }> }).byKey.get(id)!.brain;
    expect(brain("npc:s2").morale.shock).toBeGreaterThan(10);
    expect(brain("npc:far").morale.shock).toBe(0);
  });

  it("a wounded row remembers being hit (underFire) and is shaken by it", () => {
    const r = rig();
    r.cast.spawn([spec("s1")]);
    r.tick(3);
    r.rows.get("npc:s1")!.health = 60;
    r.tick(2);
    const b = (r.cast as unknown as { byKey: Map<string, { brain: NpcBrainState }> }).byKey.get("npc:s1")!.brain;
    expect(b.hurtAt).toBeGreaterThan(0);
    expect(b.morale.shock).toBeGreaterThan(5);
  });
});

describe("Cast: budgets", () => {
  it("at most NAV.queriesPerTick paths per tick, and every brain gets a turn (round robin)", () => {
    const perTick: number[] = [];
    let cur = 0;
    const got = new Map<string, number>();
    const greedy: BrainFn = (b, me, sn, _dt, out) => {
      if (sn.nav.path(me.x, me.z, 30, 30, b.path)) { cur++; got.set(String((b as NpcBrainState).seed), (got.get(String((b as NpcBrainState).seed)) ?? 0) + 1); }
      out.moveF = 0; out.moveR = 0; out.buttons = 0; out.yaw = 0;
    };
    const r = rig({ brains: { garrison: greedy } });
    r.cast.spawn(Array.from({ length: 10 }, (_, i) => spec(`s${i}`, { post: { x: i * 3, z: 0 }, lookSeed: 500 + i })));
    for (let i = 0; i < 40; i++) {
      cur = 0;
      r.tick();
      perTick.push(cur);
    }
    expect(Math.max(...perTick)).toBe(NAV.queriesPerTick);
    expect(got.size).toBe(10);
    const counts = [...got.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it("hostile numbers in dt and a world swap mid-tick do not throw", () => {
    const r = rig();
    r.cast.spawn([spec("s1")]);
    expect(() => { r.cast.tick(Number.NaN); r.cast.tick(-5); r.cast.tick(Infinity); r.setWorld(new CollisionWorld({ height: () => 0 }, [], 90)); r.tick(3); }).not.toThrow();
    r.cast.noise(Number.NaN, 0, 10, "x");
    r.cast.order("nobody", { o: "alert" });
    r.cast.order("ward", { o: "guard", x: Number.NaN, z: 0, r: Number.NaN });
    r.tick(3);
    expect(Number.isFinite(r.rows.get("npc:s1")!.x)).toBe(true);
  });
});

describe("Cast on the real Kessar", () => {
  it("20 NPCs, 4 humans: the Cast's own tick stays cheap", () => {
    const w = createKessarWorld(5, "intact");
    const r = rig({ world: w, nav: true });
    const roster = garrisonRoster(newCampaign(3), 5);
    r.cast.spawn(roster);
    const extra = Array.from({ length: 24 - roster.length }, (_, i) => spec(`x${i}`, { group: "deserters", side: "outlaw", role: NPC.DESERTER, post: { x: 40 + (i % 5) * 3, z: -10 + Math.floor(i / 5) * 3 }, lookSeed: 900 + i }));
    r.cast.spawn(extra);
    for (let i = 0; i < 4; i++) r.human(`p${i}`, 30 + i * 3, -8, { weapon: weaponToWire(WEAPON.RIFLE) });
    r.cast.order("ward", { o: "alert" });
    r.tick(30); // warm
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t0 = performance.now();
      r.t.ms += 1000 * DT;
      r.cast.tick(DT);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    if (process.env.DBG) console.log("CAST tick ms median", times[150]!.toFixed(3), "p95", times[285]!.toFixed(3), "max", times[299]!.toFixed(3));
    // the real rooms step each row too (stepNpc is in this measurement, as a stand-in): budget is 2 ms on a quiet machine
    expect(times[Math.floor(times.length * 0.5)]!).toBeLessThan(4);
    expect(times[Math.floor(times.length * 0.95)]!).toBeLessThan(10);
  });

  it("when the bridge falls, a re-planned walk goes round by the ford", () => {
    const intact = createKessarWorld(5, "intact");
    const r = rig({ world: intact, nav: true });
    const leader = r.human("p1", A.tollBar.x, A.tollBar.z - 2);
    r.cast.spawn([spec("f1", { post: { x: A.landing.x, z: A.landing.z - 6 }, role: NPC.HIRED_RIFLE, side: "party", group: "hands", brain: "follower" })]);
    r.cast.order("hands", { o: "follow", target: "p1" });
    r.tick(20);
    r.setWorld(createKessarWorld(5, "collapsed"));
    let maxX = 0;
    for (let i = 0; i < 3300; i++) {
      r.tick();
      const f = r.rows.get("npc:f1")!;
      if (Math.abs(f.z - A.river.z) < 6) maxX = Math.max(maxX, f.x);
    }
    const f = r.rows.get("npc:f1")!;
    expect(maxX).toBeGreaterThan(30); // crossed the river where the ford is
    expect(Math.hypot(f.x - leader.x, f.z - leader.z)).toBeLessThan(10);
  });
});

void ({} as { a: NpcBody; b: NpcSenses });
