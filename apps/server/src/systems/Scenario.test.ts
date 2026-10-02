import { describe, expect, it } from "vitest";
import {
  BORDER, FLAG, HOSTAGE, PropKind, hash3, answerParley, openParley, applyOutcome, askingToll, leverageOf, newCampaign, generatePaper, npcKey, weatherAt,
  HIGHMARK_RESOLUTIONS, TEMPLATES, KESSAR_ANCHORS, KESSAR_SITES, NPC_CAP, RESOLVED_LINGER_S, SCENARIO, CONVOY_DEPART_S, HOSTAGE_DEADLINE_S, BORDER_ESCALATE_S, TEMPLATE_RESOLUTIONS,
  type BridgeState, type CampaignState, type NewEnding, type ParleyView, type PlayerStateType, type ResolutionId, type ScenarioOutcome, type ScenarioTemplateId, type ScenarioView,
} from "@cb/shared";
import type { CastApi, CastCount, CastOrder, MountApi, NpcSide, NpcSpec } from "@cb/shared";
import { BOARD_R, Scenario, type ScenarioHost } from "./Scenario.ts";

/**
 * The runner against a FAKE host with a fake Cast and fake Mounts (the real Cast has its own tests; here the runner is judged on what it observes and what it
 * asks for). One scripted run per resolution (all 20), the leave table, the settled crossing's start, and hostile input at every entry point.
 */

const DT = 0.25;
type Row = PlayerStateType & { id: string };
const row = (id: string, x: number, z: number, o: Partial<PlayerStateType> = {}): Row =>
  ({ id, name: id, x, y: 0, z, facing: 0, flags: FLAG.GROUNDED, health: 100, wounds: 0, missing: 0, weapon: 2, ammo: 5, slot: 0, connected: true, ...o }) as unknown as Row;

class FakeCast implements CastApi {
  specs: NpcSpec[] = [];
  orders: { group: string; order: CastOrder }[] = [];
  wars: { a: NpcSide; b: NpcSide; on: boolean }[] = [];
  routes = new Map<string, readonly { x: number; z: number }[]>();
  counts = new Map<string, CastCount>();
  despawned: string[] = [];
  cap = 99;
  constructor(readonly players: Map<string, Row>) {}
  spawn(specs: readonly NpcSpec[]): number {
    let n = 0;
    for (const sp of specs) {
      if (this.players.size >= this.cap || this.players.has(npcKey(sp.id))) continue;
      this.players.set(npcKey(sp.id), row(npcKey(sp.id), sp.post.x, sp.post.z, { weapon: sp.weapon + 1, ammo: 6, npc: sp.role } as Partial<PlayerStateType>));
      this.specs.push(sp);
      n++;
    }
    return n;
  }
  order(group: string, o: CastOrder): void { this.orders.push({ group, order: o }); }
  setWar(a: NpcSide, b: NpcSide, on: boolean): void { this.wars.push({ a, b, on }); }
  count(group: string): CastCount {
    const o = this.counts.get(group);
    if (o) return o;
    let alive = 0, down = 0, total = 0;
    for (const sp of this.specs) {
      if (sp.group !== group) continue;
      total++;
      const r = this.players.get(npcKey(sp.id));
      if (!r || (r.flags & FLAG.DOWNED) !== 0) down++;
      else alive++;
    }
    return { alive, routed: 0, down, total };
  }
  row(id: string): PlayerStateType | undefined { return this.players.get(npcKey(id)); }
  defineRoute(name: string, pts: readonly { x: number; z: number }[]): void { this.routes.set(name, pts); }
  noise(): void {}
  despawn(group?: string): void {
    for (const sp of [...this.specs]) {
      if (group !== undefined && sp.group !== group) continue;
      this.players.delete(npcKey(sp.id));
      this.specs.splice(this.specs.indexOf(sp), 1);
    }
    this.despawned.push(group ?? "*");
  }
  tick(): void {}
  setWorld(): void {}
  atWar(): boolean { return false; }
  groupOrders(group: string): string[] { return this.orders.filter((o) => o.group === group).map((o) => o.order.o); }
}

class FakeMounts implements MountApi {
  at = { x: -32, z: 52 };
  routeName = "";
  seized: string[] = [];
  wrecked: boolean[] = [];
  removed: string[] = [];
  cargo = 60;
  spawned: { at: { x: number; z: number; yaw: number }; crates: number }[] = [];
  spawnWagon(at: { x: number; z: number; yaw: number }, o: { coat: number; crates: number; horse?: boolean }): string { this.spawned.push({ at, crates: o.crates }); this.at = { x: at.x, z: at.z }; return "wagon-1"; }
  lead(): void {}
  route(_id: string, name: string): void { this.routeName = name; }
  pos(id: string): { x: number; z: number } | undefined { return id === "wagon-1" && this.removed.length === 0 ? this.at : undefined; }
  wreck(_id: string, burn: boolean): void { this.wrecked.push(burn); }
  seize(_id: string, by: string): number { this.seized.push(by); const n = this.cargo; this.cargo = 0; return n; }
  remove(id: string): void { this.removed.push(id); }
}

interface Fake {
  host: ScenarioHost;
  players: Map<string, Row>;
  cast: FakeCast;
  mounts: FakeMounts;
  commits: ScenarioOutcome[];
  sent: { sid: string; type: string; msg: any }[];
  views: ScenarioView[];
  booms: { x: number; z: number; r: number; owner: string }[];
  bridges: BridgeState[];
  consumed: string[];
  props: Map<string, { kind: number; x: number; z: number }>;
  clock: { ms: number };
}

function fake(campaign: CampaignState = newCampaign(11), startMs = 0, withMounts = true): Fake {
  const players = new Map<string, Row>();
  const cast = new FakeCast(players);
  const mounts = new FakeMounts();
  let propN = 0;
  const f: Fake = { players, cast, mounts, commits: [], sent: [], views: [], booms: [], bridges: [], consumed: [], props: new Map(), clock: { ms: startMs }, host: undefined as never };
  f.host = {
    players: players as unknown as ScenarioHost["players"],
    worldMs: () => f.clock.ms,
    campaign: () => campaign,
    commit: (o) => void f.commits.push(o),
    cast,
    mounts: withMounts ? mounts : undefined,
    consumeProp: (id) => void f.consumed.push(id),
    propKind: (id) => f.props.get(id)?.kind,
    propPos: (id) => { const p = f.props.get(id); return p ? { x: p.x, y: 0, z: p.z } : undefined; },
    propsNear: () => [],
    spawnProp: (kind, x, z) => { const id = `prop-${++propN}`; f.props.set(id, { kind, x, z }); return id; },
    rebuildBridge: (s) => void f.bridges.push(s),
    explode: (x, _y, z, r, owner) => void f.booms.push({ x, z, r, owner }),
    publish: (v) => void f.views.push(v),
    send: (sid, type, msg) => void f.sent.push({ sid, type, msg }),
    negotiation: { askingToll, leverageOf, openParley, answerParley },
    seed: 424242,
    groundY: () => 0,
  };
  return f;
}

const setup = (f: Fake, id: ScenarioTemplateId, ...ps: Row[]): Scenario => {
  for (const p of ps) f.players.set(p.id, p);
  const s = new Scenario(f.host, id);
  s.start();
  return s;
};
const run = (f: Fake, s: Scenario, seconds: number, dt = DT): void => {
  for (let t = 0; t < seconds; t += dt) {
    f.clock.ms += dt * 1000;
    s.tick(dt);
  }
};
const me = (f: Fake, id = "p1"): Row => f.players.get(id)!;
const put = (f: Fake, id: string, x: number, z: number): void => { const r = f.players.get(id)!; r.x = x; r.z = z; };
const beside = (f: Fake, id: string, npc: string, dx = 0.8): void => { const r = f.players.get(npcKey(npc))!; put(f, id, r.x + dx, r.z); };
const lastParley = (f: Fake, sid: string): { view?: ParleyView; closed?: boolean; line?: string } | undefined => [...f.sent].reverse().find((m) => m.sid === sid && m.type === "parley")?.msg;
const optionIndex = (v: ParleyView, id: string): number => v.options.findIndex((o) => o.id === id);
const labelIndex = (v: ParleyView, re: RegExp): number => v.options.findIndex((o) => re.test(o.label));
const down = (f: Fake, key: string): void => { const r = f.players.get(key)!; r.flags |= FLAG.DOWNED; r.health = 0; };
const lastView = (f: Fake): ScenarioView => f.views.at(-1)!;
const press = (f: Fake, s: Scenario, id = "p1", prop?: string): boolean => s.onInteract(id, me(f, id), prop);
const npcKeys = (f: Fake): string[] => [...f.players.keys()].filter((k) => k.startsWith("npc:"));
const bar = KESSAR_ANCHORS.wardenPost;

describe("the runner: start, publish, dispose", () => {
  it("spawns the template's people through the cast within NPC_CAP, starts unresolved, and registers routes", () => {
    for (const [id, minNpcs] of [["secure_crossing", 8], ["hostage_rescue", 6], ["convoy_ambush", 5], ["border_incident", 5]] as const) {
      const f = fake();
      const s = setup(f, id, row("p1", 0, 88));
      expect(npcKeys(f).length, id).toBeGreaterThanOrEqual(minNpcs);
      expect(npcKeys(f).length).toBeLessThanOrEqual(NPC_CAP);
      expect(f.commits).toEqual([]);
      expect(lastView(f).template).toBe(id);
      expect(s.template).toBe(id);
      expect(lastView(f).phase).not.toBe("resolved");
      s.dispose();
      expect(npcKeys(f)).toEqual([]);
    }
    const f = fake();
    setup(f, "convoy_ambush", row("p1", 0, 88));
    expect(f.cast.routes.get("convoy")!.length).toBeGreaterThan(4);
    expect(f.mounts.spawned).toHaveLength(1);
    expect(f.mounts.spawned[0]!.crates).toBe(3);
    expect([...f.props.values()].some((p) => p.kind === PropKind.BARREL)).toBe(true);
  });

  it("holds the late groups back, and despawns only its own groups (a hired hand is somebody else's)", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", 0, 88));
    f.cast.spawn([{ id: "porter-1", role: 8, faction: "ward", side: "party", group: "party", post: { x: 1, z: 86 }, weapon: 4, lookSeed: 1, name: "Porter", skill: 10, bravery: 30, brain: "follower" }]);
    expect(f.players.has("npc:reinf-0")).toBe(false);
    s.dispose();
    expect(f.players.has("npc:porter-1")).toBe(true);
    expect(f.cast.despawned).not.toContain("*");
    expect(f.players.has("npc:deserter-0")).toBe(false);
  });

  it("copes with the cast refusing spawns at the cap", () => {
    const f = fake();
    f.cast.cap = 4;
    const s = setup(f, "secure_crossing", row("p1", 0, 88));
    run(f, s, 2);
    expect(npcKeys(f).length).toBe(3);
  });

  it("republishes only on change", () => {
    const f = fake();
    const s = setup(f, "secure_crossing", row("p1", 0, 30));
    run(f, s, 3);
    expect(lastView(f).phase).toBe("standoff");
    const n = f.views.length;
    run(f, s, 5);
    expect(f.views.length).toBeLessThan(n + 12);
  });
});

describe("the crossing through the runner", () => {
  it("pays the asking toll: parley by INTERACT at the Warden, a pick, one commit, and the cast leaves after the linger", () => {
    const f = fake();
    const s = setup(f, "secure_crossing", row("p1", bar.x - 0.7, bar.z - 0.5));
    run(f, s, 1.5);
    expect(press(f, s)).toBe(true);
    const view = lastParley(f, "p1")!.view!;
    expect(view.toll).toBe(askingToll(newCampaign(11)));
    s.onPick("p1", optionIndex(view, "pay"));
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "secure_crossing", resolution: "paid", paid: view.toll, bridge: "intact", brokePromise: false });
    run(f, s, RESOLVED_LINGER_S + 5);
    expect(f.commits).toHaveLength(1);
    expect(f.players.has("npc:warden")).toBe(false);
  });

  it("walking away leaves the standoff open; a bribe is committed as bribed; the parley is leashed", () => {
    const f = fake();
    const s = setup(f, "secure_crossing", row("p1", bar.x - 0.7, bar.z - 0.5));
    run(f, s, 1.5);
    press(f, s);
    s.onPick("p1", optionIndex(lastParley(f, "p1")!.view!, "walk_away"));
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(lastView(f).phase).toBe("standoff");
    press(f, s);
    expect(lastParley(f, "p1")!.view).toBeDefined();
    me(f).x += 12;
    run(f, s, 0.6);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.commits).toEqual([]);
    put(f, "p1", bar.x - 0.7, bar.z - 0.5);
    press(f, s);
    const v = lastParley(f, "p1")!.view!;
    s.onPick("p1", optionIndex(v, "bribe"));
    expect(f.commits[0]).toMatchObject({ resolution: "bribed" });
    expect(f.commits[0]!.paid).toBeLessThan(v.toll);
  });

  it("first blood alerts the ward group; breaking 60% of it is forced, with the dead and the routed counted", () => {
    const f = fake();
    const s = setup(f, "secure_crossing", row("p1", 0, 22));
    run(f, s, 1.5);
    expect(lastView(f).phase).toBe("standoff");
    s.onDamage("npc:sentry-0", "p1", 1, false);
    expect(lastView(f).phase).toBe("fighting");
    expect(f.cast.groupOrders("ward")).toContain("alert");
    f.cast.counts.set("ward", { alive: 3, routed: 2, down: 3, total: 8 });
    for (let i = 0; i < 3; i++) { down(f, `npc:sentry-${i}`); s.onDamage(`npc:sentry-${i}`, "p1", 1, true); }
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "forced", paid: 0 });
    expect(f.commits[0]!.tally).toMatchObject({ garrisonKilled: 3, downed: 3, garrisonRouted: 2 });
    expect(f.cast.groupOrders("ward")).toContain("stand_down");
  });

  it("shooting the Syndicate annoys them (they are alerted) but is not war on the Ward; talking first and then shooting her is a broken promise", () => {
    const f = fake();
    const s = setup(f, "secure_crossing", row("p1", 0, 60));
    run(f, s, 1.5);
    s.onDamage("npc:rival-0", "p1", 1, true);
    expect(lastView(f).phase).not.toBe("fighting");
    expect(f.cast.groupOrders("rival")).toContain("alert");
    const g = fake();
    const t = setup(g, "secure_crossing", row("p1", bar.x - 0.7, bar.z - 0.5));
    run(g, t, 1.5);
    press(g, t);
    t.onDamage("npc:warden", "p1", 1, false);
    expect(lastParley(g, "p1")).toMatchObject({ closed: true, line: "You have made your point, with a bullet." });
    g.cast.counts.set("ward", { alive: 3, routed: 0, down: 5, total: 8 });
    run(g, t, 1);
    expect(g.commits[0]).toMatchObject({ resolution: "forced", brokePromise: true });
  });

  it("a barrel at the pier with a lit fuse drops the bridge ten seconds later (sabotaged), blast owned by the lighter, committed once", () => {
    const pier = KESSAR_ANCHORS.pier;
    const f = fake();
    f.props.set("b1", { kind: PropKind.BARREL, x: 0, z: 0 });
    const s = setup(f, "secure_crossing", row("p1", pier.x + 1, pier.z, { flags: FLAG.GROUNDED | FLAG.CARRYING }));
    run(f, s, 1.2);
    expect(s.onInteract("p1", me(f), "b1")).toBe(true);
    expect(f.consumed).toEqual(["b1"]);
    expect(lastView(f).phase).toBe("rigging");
    expect(lastView(f).timerLabel).toBe("Fuse");
    // a second barrel does not double the fuse and is not consumed
    f.props.set("b2", { kind: PropKind.BARREL, x: 0, z: 0 });
    s.onInteract("p1", me(f), "b2");
    expect(f.consumed).toEqual(["b1"]);
    run(f, s, SCENARIO.fuseSeconds - 1);
    expect(f.booms).toEqual([]);
    run(f, s, 2);
    expect(f.booms).toHaveLength(1);
    expect(f.booms[0]).toMatchObject({ x: pier.x, z: pier.z, r: SCENARIO.chargeRadius, owner: "p1" });
    expect(f.bridges).toEqual(["collapsed"]);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "sabotaged", bridge: "collapsed" });
    run(f, s, 60);
    expect(f.commits).toHaveLength(1);
    expect(f.booms).toHaveLength(1);
  });

  it("the pier press is only taken with a BARREL in hand and in reach; a crate, empty hands or the wrong place do nothing", () => {
    const pier = KESSAR_ANCHORS.pier;
    const f = fake();
    f.props.set("crate", { kind: PropKind.CRATE, x: 0, z: 0 });
    f.props.set("b1", { kind: PropKind.BARREL, x: 0, z: 0 });
    const s = setup(f, "secure_crossing", row("p1", pier.x + 1, pier.z, { flags: FLAG.GROUNDED | FLAG.CARRYING }));
    run(f, s, 1.2);
    expect(s.onInteract("p1", me(f), "crate")).toBe(false);
    expect(s.onInteract("p1", me(f), undefined)).toBe(false);
    expect(s.onInteract("p1", me(f), "nonsense")).toBe(false);
    put(f, "p1", pier.x + 30, pier.z);
    expect(s.onInteract("p1", me(f), "b1")).toBe(false);
    expect(f.consumed).toEqual([]);
    expect(lastView(f).phase).not.toBe("rigging");
  });

  it("the weather matters: in heavy rain the same fuse takes twice as long", () => {
    const pier = KESSAR_ANCHORS.pier;
    let ms = -1;
    for (let t = 0; t < 6 * 3600_000 && ms < 0; t += 30_000) if (weatherAt(424242, t).rain >= 0.7 && weatherAt(424242, t + 45_000).rain >= 0.7) ms = t;
    expect(ms).toBeGreaterThan(0);
    const f = fake(newCampaign(11), ms);
    f.props.set("b1", { kind: PropKind.BARREL, x: 0, z: 0 });
    const s = setup(f, "secure_crossing", row("p1", pier.x + 1, pier.z, { flags: FLAG.GROUNDED | FLAG.CARRYING }));
    run(f, s, 2.1);
    s.onInteract("p1", me(f), "b1");
    run(f, s, SCENARIO.fuseSeconds + 1);
    expect(f.booms).toEqual([]);
    run(f, s, SCENARIO.fuseSeconds + 2);
    expect(f.booms).toHaveLength(1);
    expect(f.sent.some((m) => m.type === "notice" && /Rain/.test(m.msg.text))).toBe(true);
  });

  it("the whole party down is abandoned", () => {
    const f = fake();
    const s = setup(f, "secure_crossing", row("p1", 0, 60), row("p2", 3, 60));
    run(f, s, 1);
    down(f, "p1");
    run(f, s, 1);
    expect(f.commits).toEqual([]);
    down(f, "p2");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]!.resolution).toBe("abandoned");
  });

  it("a ruined bridge, and a settled crossing, start resolved: nothing to win, nothing committed, the cast stands down, re-paying is impossible", () => {
    const ruined = newCampaign(11);
    ruined.crossing.bridge = "collapsed";
    const settled = applyOutcome(newCampaign(11), { scenario: "secure_crossing", resolution: "paid", toll: 40, paid: 40, bridge: "intact", brokePromise: false, seconds: 5, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
    for (const c of [ruined, settled]) {
      const f = fake(c);
      const s = setup(f, "secure_crossing", row("p1", bar.x - 0.7, bar.z - 0.5));
      expect(lastView(f).phase).toBe("resolved");
      expect(f.cast.groupOrders("ward")).toContain("stand_down");
      run(f, s, 3);
      expect(press(f, s)).toBe(false);
      expect(f.commits).toEqual([]);
      s.leave();
      expect(f.commits).toEqual([]);
    }
  });
});

describe("hostage rescue through the runner", () => {
  const H = KESSAR_SITES.hostage;
  const landing = KESSAR_ANCHORS.landing;
  const walkHome = (f: Fake): void => { const h = f.players.get("npc:hostage")!; h.x = landing.x; h.z = landing.z - 3; };

  it("slips away: a quiet cage, a walk to the dock, no alarm, no shots", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", H.cage.x, H.cage.z + 1.5));
    run(f, s, 1.5);
    expect(press(f, s)).toBe(true);
    expect(f.cast.orders.some((o) => o.group === "hostage" && o.order.o === "follow")).toBe(true);
    expect(f.cast.groupOrders("deserters")).not.toContain("alert");
    walkHome(f);
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "hostage_rescue", resolution: "slipped_away", paid: 0 });
  });

  it("D-041: sailing with Mr. Quim at your heels takes him home; sailing with him left behind loses him", () => {
    const freed = (): { f: Fake; s: Scenario } => {
      const f = fake();
      const s = setup(f, "hostage_rescue", row("p1", H.cage.x, H.cage.z + 1.5));
      run(f, s, 1.5);
      expect(press(f, s)).toBe(true);
      // the rescuer is at the boat; Mr. Quim is still on the way up, out of the dock's radius
      const p = f.players.get("p1")!; p.x = landing.x; p.z = landing.z;
      const h = f.players.get("npc:hostage")!; h.x = landing.x; h.z = landing.z - 4 - HOSTAGE.dockRadius - 3;
      run(f, s, 1);
      expect(f.commits).toEqual([]);
      return { f, s };
    };
    const a = freed();
    a.s.leave();
    expect(a.f.commits).toHaveLength(1);
    expect(a.f.commits[0]).toMatchObject({ scenario: "hostage_rescue", resolution: "slipped_away" });
    // ... but not one who was left at the Orchard
    const b = freed();
    const h = b.f.players.get("npc:hostage")!; h.x = H.cage.x; h.z = H.cage.z;
    b.s.leave();
    expect(b.f.commits[0]).toMatchObject({ resolution: "hostage_lost" });
    expect(BOARD_R).toBeLessThan(Math.hypot(H.cage.x - landing.x, H.cage.z - landing.z));
  });

  it("the ransom: talk to the colour-sergeant, pay from the purse, no shots", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", H.posts[0]!.x + 0.8, H.posts[0]!.z));
    run(f, s, 1.5);
    expect(press(f, s)).toBe(true);
    const v = lastParley(f, "p1")!.view!;
    expect(v.speaker).toMatch(/Cull/);
    const pay = labelIndex(v, /^Pay/);
    s.onPick("p1", pay);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "ransomed", paid: v.toll });
    expect(f.commits[0]!.tally.downed).toBe(0);
  });

  it("haggling: flattery changes the price once; a forged pick buys nothing; threatening raises the alarm", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", H.posts[0]!.x + 0.8, H.posts[0]!.z), row("p2", 0, 88));
    run(f, s, 1.5);
    press(f, s);
    const v1 = lastParley(f, "p1")!.view!;
    s.onPick("p2", 0);   // not the owner
    s.onPick("p1", 99);  // out of range
    s.onPick("p1", -1);
    s.onPick("p1", 1.5);
    expect(f.commits).toEqual([]);
    s.onPick("p1", labelIndex(v1, /^Flatter/));
    const v2 = lastParley(f, "p1")!.view!;
    expect(v2.round).toBe(2);
    expect(v2.toll).not.toBe(v1.toll);
    s.onPick("p1", labelIndex(v2, /^Flatter/));   // not offered in round 2: the round is re-issued
    expect(lastParley(f, "p1")!.view!.round).toBeGreaterThanOrEqual(2);
    expect(f.commits).toEqual([]);
    const g = fake();
    const t = setup(g, "hostage_rescue", row("p1", H.posts[0]!.x + 0.8, H.posts[0]!.z));
    run(g, t, 1.5);
    press(g, t);
    t.onPick("p1", labelIndex(lastParley(g, "p1")!.view!, /^Threaten/));
    expect(g.cast.groupOrders("deserters")).toContain("alert");
    expect(lastView(g).phase).toBe("fighting");
  });

  it("rescued: the alarm, three of four broken, the cage opened, the surveyor at the dock alive", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", H.cage.x, H.cage.z + 1.5));
    run(f, s, 1);
    s.onDamage("npc:deserter-1", "p1", 1, true);
    down(f, "npc:deserter-1");
    for (const i of [2, 3]) down(f, `npc:deserter-${i}`);
    press(f, s);
    expect(f.cast.groupOrders("deserters")).toContain("alert");
    walkHome(f);
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "rescued" });
    expect(f.commits[0]!.tally.downed).toBeGreaterThanOrEqual(1);
  });

  it("noise: a shot heard at the camp raises the alarm; the same report from far away does nothing", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", 0, 88));
    run(f, s, 1);
    s.onNoise(H.cage.x + 150, H.cage.z, 40, "p1");
    expect(f.cast.groupOrders("deserters")).not.toContain("alert");
    s.onNoise(H.cage.x + 8, H.cage.z, 60, "p1");
    expect(f.cast.groupOrders("deserters")).toContain("alert");
  });

  it("the lookout sees you from 12 m and hails you (D-041), and the alarm goes up when his patience is out; crouched he does not see you at 10 m; a deserter does not see you from 8 m", () => {
    const f = fake();
    // (west of the rise, the way up from the ford: well away from the carousers' posts)
    const s = setup(f, "hostage_rescue", row("p1", H.lookout.x - 20, H.lookout.z));
    run(f, s, 1);
    expect(lastView(f).objectives.some((o) => o.id === "explain")).toBe(false);
    put(f, "p1", H.lookout.x - 10, H.lookout.z);
    run(f, s, 1);
    expect(lastView(f).objectives.some((o) => o.id === "explain")).toBe(true);
    expect(f.cast.groupOrders("lookout")).not.toContain("alert");
    run(f, s, HOSTAGE.lookoutChallengeS + 1);
    expect(f.cast.groupOrders("lookout")).toContain("alert");
    const c = fake();
    const u = setup(c, "hostage_rescue", row("p1", H.lookout.x - 10, H.lookout.z, { flags: FLAG.GROUNDED | FLAG.CROUCHING }));
    run(c, u, 3);
    expect(lastView(c).objectives.some((o) => o.id === "explain")).toBe(false);
    const g = fake();
    const t = setup(g, "hostage_rescue", row("p1", H.cage.x, H.cage.z + 1.5));
    run(g, t, 2);
    expect(g.cast.groupOrders("deserters")).not.toContain("alert");
  });

  it("the deadline buys him; a hostage downed is a loss; shooting him is a civilian harmed", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", 0, 88));
    run(f, s, HOSTAGE_DEADLINE_S + 4, 2);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "hostage_lost" });
    const g = fake();
    const t = setup(g, "hostage_rescue", row("p1", 0, 88));
    run(g, t, 1);
    down(g, "npc:hostage");
    t.onDamage("npc:hostage", "p1", 1, true);
    expect(g.commits).toHaveLength(1);
    expect(g.commits[0]!.resolution).toBe("hostage_lost");
    expect(g.commits[0]!.tally.civiliansHarmed).toBe(1);
  });
});

describe("convoy ambush through the runner", () => {
  const route = KESSAR_SITES.convoy.route;
  const cut = KESSAR_SITES.convoy.cut;

  it("the convoy leaves at CONVOY_DEPART_S: the wagon is sent along the route and the guards march", () => {
    const f = fake();
    const s = setup(f, "convoy_ambush", row("p1", 0, 88));
    run(f, s, CONVOY_DEPART_S - 3);
    expect(f.mounts.routeName).toBe("");
    run(f, s, 6);
    expect(f.mounts.routeName).toBe("convoy");
    expect(f.cast.orders.some((o) => o.group === "guards" && o.order.o === "march")).toBe(true);
    expect(lastView(f).phase).toBe("waiting");
  });

  it("seized: down the guards, INTERACT the wagon, the cargo's value is the outcome's loot", () => {
    const f = fake();
    const s = setup(f, "convoy_ambush", row("p1", cut.x, cut.z - 5));
    run(f, s, CONVOY_DEPART_S + 2);
    f.mounts.at = { x: cut.x, z: cut.z };
    put(f, "p1", cut.x + 1, cut.z + 1);
    expect(press(f, s)).toBe(true);   // taken (the guards still stand), but nothing is seized
    expect(f.mounts.seized).toEqual([]);
    s.onDamage("npc:guard-0", "p1", 1, true);
    down(f, "npc:guard-0");
    down(f, "npc:guard-1");
    expect(f.cast.groupOrders("guards")).toContain("alert");
    expect(f.mounts.routeName).toBe("");
    run(f, s, 1);
    expect(press(f, s)).toBe(true);
    expect(f.mounts.seized).toEqual(["p1"]);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "seized", loot: 60 });
  });

  it("burned: a barrel destroyed near the wagon wrecks it; one destroyed far away does nothing", () => {
    const f = fake();
    const s = setup(f, "convoy_ambush", row("p1", 0, 88));
    run(f, s, 2);
    const keg = [...f.props.entries()].find(([, p]) => p.kind === PropKind.BARREL)![0];
    s.onProp("destroyed", keg);
    expect(f.commits).toEqual([]);
    f.mounts.at = { x: cut.x + 3, z: cut.z };
    s.onProp("destroyed", "nonsense");
    s.onProp("seized", keg);
    s.onProp("destroyed", keg);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "burned" });
    expect(f.mounts.wrecked).toEqual([true]);
    expect(f.booms).toHaveLength(1);
  });

  it("tipped off: the Ward's ford post is told; the soldiers go to the Cut under war; the guards fall; no player shot a thing", () => {
    const f = fake();
    const s = setup(f, "convoy_ambush", row("p1", 0, 88));
    run(f, s, 1);
    beside(f, "p1", "post-0");
    expect(press(f, s)).toBe(true);
    const v = lastParley(f, "p1")!.view!;
    expect(v.speaker).toMatch(/Aldous/);
    s.onPick("p1", 0);
    expect(f.cast.wars).toContainEqual({ a: "ward", b: "rival", on: true });
    expect(f.cast.orders.some((o) => o.group === "ward_post" && o.order.o === "guard")).toBe(true);
    down(f, "npc:guard-0");
    down(f, "npc:guard-1");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "tipped_off", tally: { downed: 0 } });
  });

  it("passed: the wagon reaches the ford landing", () => {
    const f = fake();
    const s = setup(f, "convoy_ambush", row("p1", 0, 88));
    run(f, s, CONVOY_DEPART_S + 1);
    f.mounts.at = { x: route[route.length - 1]!.x - 1, z: route[route.length - 1]!.z };
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "passed" });
    run(f, s, RESOLVED_LINGER_S + 2);
    expect(f.mounts.removed).toEqual(["wagon-1"]);
  });

  it("without a mounts host there is simply no wagon to use (and nothing throws)", () => {
    const f = fake(newCampaign(11), 0, false);
    const s = setup(f, "convoy_ambush", row("p1", cut.x, cut.z));
    run(f, s, CONVOY_DEPART_S + 5);
    expect(press(f, s)).toBe(false);
    expect(f.commits).toEqual([]);
  });
});

describe("border incident through the runner", () => {
  const B = KESSAR_SITES.border;
  const talkTo = (f: Fake, s: Scenario, npc: string): ParleyView => { beside(f, "p1", npc); expect(press(f, s)).toBe(true); return lastParley(f, "p1")!.view!; };

  it("mediated: both sides agree to a joint survey and stand down", () => {
    const f = fake();
    const s = setup(f, "border_incident", row("p1", 0, 88));
    run(f, s, 1);
    const w = talkTo(f, s, "ward-0");
    s.onPick("p1", labelIndex(w, /joint survey/));
    expect(f.commits).toEqual([]);
    const r = talkTo(f, s, "rival-0");
    s.onPick("p1", labelIndex(r, /joint survey/));
    expect(f.commits).toEqual([]); // (D-041: agreeing is not the end: somebody stands witness at the Stone while the chains go out)
    put(f, "p1", B.marker.x + 1.2, B.marker.z);
    run(f, s, BORDER.witnessS + 2);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "border_incident", resolution: "mediated" });
    expect(f.cast.groupOrders("ward")).toContain("stand_down");
  });

  it("sided_ward: learn the plan from the surveyor, tell the patrol; the Syndicate leaves", () => {
    const f = fake();
    const s = setup(f, "border_incident", row("p1", 0, 88));
    run(f, s, 1);
    const r = talkTo(f, s, "rival-0");
    s.onPick("p1", labelIndex(r, /really measuring/));
    const r2 = lastParley(f, "p1")!.view!;
    expect(r2.round).toBe(2);
    expect(r2.line).toMatch(/envelope/);
    s.onPick("p1", labelIndex(r2, /Walk away/));
    const w = talkTo(f, s, "ward-0");
    s.onPick("p1", labelIndex(w, /Syndicate's plan/));
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "sided_ward" });
    expect(f.cast.groupOrders("rival")).toContain("flee");
  });

  it("sided_syndicate: the envelope, then pull the Stone; the Ward goes alert against you", () => {
    const f = fake();
    const s = setup(f, "border_incident", row("p1", 0, 88));
    run(f, s, 1);
    const r = talkTo(f, s, "rival-0");
    s.onPick("p1", labelIndex(r, /really measuring/));
    s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /envelope/i));
    put(f, "p1", B.marker.x + 1.5, B.marker.z);
    run(f, s, 1);
    expect(press(f, s)).toBe(true);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "sided_syndicate" });
    expect(f.cast.groupOrders("ward")).toContain("alert");
  });

  it("provoked: the first player shot; the wronged side fights, the other holds its fire", () => {
    const f = fake();
    const s = setup(f, "border_incident", row("p1", B.ward[0]!.x, B.ward[0]!.z + 8));
    run(f, s, 1);
    s.onDamage("npc:ward-0", "p1", 1, false);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "provoked", tally: { wounded: 1 } });
    expect(f.cast.orders).toContainEqual({ group: "ward", order: { o: "attack", side: "party" } });
    expect(f.cast.orders).toContainEqual({ group: "rival", order: { o: "hold_fire" } });
  });

  it("a shot of NPC on NPC is not provoked (only a player's shot is)", () => {
    const f = fake();
    const s = setup(f, "border_incident", row("p1", 0, 88));
    run(f, s, 1);
    s.onDamage("npc:ward-0", "npc:rival-1", 1, false);
    expect(f.commits).toEqual([]);
  });

  it("escalated: time wins; the sides fight under war and the players watch", () => {
    const f = fake();
    const s = setup(f, "border_incident", row("p1", 0, 88));
    run(f, s, BORDER_ESCALATE_S + 3, 1);
    expect(f.cast.wars).toContainEqual({ a: "ward", b: "rival", on: true });
    expect(lastView(f).phase).toBe("escalated");
    expect(f.commits).toEqual([]);
    f.cast.counts.set("rival", { alive: 0, routed: 0, down: 3, total: 3 });
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "escalated" });
  });

  it("noise raises the tension: a volley near the Stone escalates a quiet border early", () => {
    const f = fake();
    const s = setup(f, "border_incident", row("p1", 0, 88));
    run(f, s, 1);
    for (let i = 0; i < 5; i++) s.onNoise(B.marker.x + 5, B.marker.z, 80, "p1");
    expect(lastView(f).phase).toBe("escalated");
  });
});

describe("leave: the room calls it before dispose", () => {
  it("dismissed when nothing happened: nothing committed; anything else commits the template's own ending with the tally so far", () => {
    const cases: [ScenarioTemplateId, (f: Fake, s: Scenario) => void, ResolutionId | undefined][] = [
      ["secure_crossing", () => {}, undefined],
      ["secure_crossing", (f, s) => { put(f, "p1", 0, 22); run(f, s, 1.5); }, "abandoned"],
      ["hostage_rescue", () => {}, undefined],
      ["hostage_rescue", (f, s) => { s.onDamage("npc:deserter-0", "p1", 1, true); }, "hostage_lost"],
      ["convoy_ambush", (f, s) => { run(f, s, 20); }, undefined],
      ["convoy_ambush", (f, s) => { run(f, s, CONVOY_DEPART_S + 2); }, "passed"],
      ["border_incident", () => {}, undefined],
      ["border_incident", (f, s) => { put(f, "p1", KESSAR_SITES.border.marker.x + 2, KESSAR_SITES.border.marker.z); run(f, s, 1); }, "escalated"],
    ];
    for (const [id, act, want] of cases) {
      const f = fake();
      const s = setup(f, id, row("p1", 0, 88));
      run(f, s, 0.5);
      act(f, s);
      s.leave();
      if (want === undefined) expect(f.commits, id).toEqual([]);
      else {
        expect(f.commits, `${id} ${want}`).toHaveLength(1);
        expect(f.commits[0]!.resolution).toBe(want);
      }
      s.dispose();
      expect(f.commits.length).toBeLessThanOrEqual(1);
    }
  });

  it("a lit fuse falls unwatched (sabotaged, bridge collapsed); fighting is abandoned with the tally and the broken promise", () => {
    const pier = KESSAR_ANCHORS.pier;
    const f = fake();
    f.props.set("b1", { kind: PropKind.BARREL, x: 0, z: 0 });
    const s = setup(f, "secure_crossing", row("p1", pier.x + 1, pier.z, { flags: FLAG.GROUNDED | FLAG.CARRYING }));
    run(f, s, 1.2);
    s.onInteract("p1", me(f), "b1");
    s.leave();
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "sabotaged", bridge: "collapsed" });
    const g = fake();
    const t = setup(g, "secure_crossing", row("p1", bar.x - 0.7, bar.z - 0.5));
    run(g, t, 1.5);
    press(g, t);
    t.onDamage("npc:warden", "p1", 1, false);
    t.onDamage("npc:sentry-0", "p1", 1, true);
    t.leave();
    expect(g.commits).toHaveLength(1);
    expect(g.commits[0]).toMatchObject({ resolution: "abandoned", brokePromise: true, tally: { downed: 1, garrisonKilled: 1 } });
  });

  it("leave after the end, or twice, commits nothing more", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", 0, 88));
    run(f, s, 1);
    down(f, "p1");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    s.leave();
    s.leave();
    expect(f.commits).toHaveLength(1);
  });
});

describe("all 20 resolutions: one scripted run each through the runner; distinct outcomes, distinct papers", () => {
  /** Plays the resolution out on a fresh fake and returns what was committed. */
  // D-036: Kessar's twenty endings. Highmark's five (HIGHMARK_RESOLUTIONS) are driven through the runner by package G (systems/Succession.test.ts); the sixteen of D-037 (NewEnding) by C3 and D4.
  const play: Record<Exclude<ResolutionId, (typeof HIGHMARK_RESOLUTIONS)[number] | NewEnding>, (f: Fake) => { id: ScenarioTemplateId; go: (s: Scenario) => void }> = {
    paid: (f) => ({ id: "secure_crossing", go: (s) => { put(f, "p1", bar.x - 0.7, bar.z - 0.5); run(f, s, 1.5); press(f, s); s.onPick("p1", optionIndex(lastParley(f, "p1")!.view!, "pay")); } }),
    bargained: (f) => ({ id: "secure_crossing", go: (s) => { f.players.set("p2", row("p2", bar.x + 2, bar.z)); put(f, "p1", bar.x - 0.7, bar.z - 0.5); run(f, s, 1.5); press(f, s); s.onPick("p1", optionIndex(lastParley(f, "p1")!.view!, "haggle_threaten")); s.onPick("p1", optionIndex(lastParley(f, "p1")!.view!, "pay")); } }),
    bribed: (f) => ({ id: "secure_crossing", go: (s) => { put(f, "p1", bar.x - 0.7, bar.z - 0.5); run(f, s, 1.5); press(f, s); s.onPick("p1", optionIndex(lastParley(f, "p1")!.view!, "bribe")); } }),
    forced: (f) => ({ id: "secure_crossing", go: (s) => { put(f, "p1", 0, 22); run(f, s, 1.5); f.cast.counts.set("ward", { alive: 2, routed: 1, down: 5, total: 8 }); s.onDamage("npc:sentry-0", "p1", 1, true); run(f, s, 1); } }),
    sabotaged: (f) => ({ id: "secure_crossing", go: (s) => { const p = KESSAR_ANCHORS.pier; f.props.set("b1", { kind: PropKind.BARREL, x: 0, z: 0 }); put(f, "p1", p.x + 1, p.z); me(f).flags |= FLAG.CARRYING; run(f, s, 1.2); s.onInteract("p1", me(f), "b1"); run(f, s, SCENARIO.fuseSeconds + 2); } }),
    rival_secured: (f) => ({ id: "secure_crossing", go: (s) => { run(f, s, 700, 2); } }),
    abandoned: (f) => ({ id: "secure_crossing", go: (s) => { run(f, s, 1); down(f, "p1"); run(f, s, 1); } }),
    ransomed: (f) => ({ id: "hostage_rescue", go: (s) => { beside(f, "p1", "deserter-0"); run(f, s, 1.5); press(f, s); const v = lastParley(f, "p1")!.view!; s.onPick("p1", labelIndex(v, /^Pay/)); } }),
    rescued: (f) => ({ id: "hostage_rescue", go: (s) => { put(f, "p1", KESSAR_SITES.hostage.cage.x, KESSAR_SITES.hostage.cage.z + 1.5); run(f, s, 1); s.onDamage("npc:deserter-1", "p1", 1, true); for (const i of [1, 2, 3]) down(f, `npc:deserter-${i}`); press(f, s); const h = f.players.get("npc:hostage")!; h.x = 0; h.z = 85; run(f, s, 1); } }),
    slipped_away: (f) => ({ id: "hostage_rescue", go: (s) => { put(f, "p1", KESSAR_SITES.hostage.cage.x, KESSAR_SITES.hostage.cage.z + 1.5); run(f, s, 1); press(f, s); const h = f.players.get("npc:hostage")!; h.x = 0; h.z = 85; run(f, s, 1); } }),
    hostage_lost: (f) => ({ id: "hostage_rescue", go: (s) => { run(f, s, HOSTAGE_DEADLINE_S + 4, 2); } }),
    seized: (f) => ({ id: "convoy_ambush", go: (s) => { const c = KESSAR_SITES.convoy.cut; run(f, s, CONVOY_DEPART_S + 2); f.mounts.at = { x: c.x, z: c.z }; put(f, "p1", c.x + 1, c.z + 1); s.onDamage("npc:guard-0", "p1", 1, true); down(f, "npc:guard-0"); down(f, "npc:guard-1"); run(f, s, 1); press(f, s); } }),
    tipped_off: (f) => ({ id: "convoy_ambush", go: (s) => { run(f, s, 1); beside(f, "p1", "post-0"); press(f, s); s.onPick("p1", 0); down(f, "npc:guard-0"); down(f, "npc:guard-1"); run(f, s, 1); } }),
    burned: (f) => ({ id: "convoy_ambush", go: (s) => { const c = KESSAR_SITES.convoy.cut; run(f, s, 1); f.mounts.at = { x: c.x + 3, z: c.z }; const keg = [...f.props.entries()].find(([, p]) => p.kind === PropKind.BARREL)![0]; s.onProp("destroyed", keg); } }),
    passed: (f) => ({ id: "convoy_ambush", go: (s) => { const r = KESSAR_SITES.convoy.route; run(f, s, CONVOY_DEPART_S + 1); f.mounts.at = { x: r[r.length - 1]!.x, z: r[r.length - 1]!.z }; run(f, s, 1); } }),
    mediated: (f) => ({ id: "border_incident", go: (s) => { run(f, s, 1); beside(f, "p1", "ward-0"); press(f, s); s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /joint survey/)); beside(f, "p1", "rival-0"); press(f, s); s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /joint survey/)); put(f, "p1", KESSAR_SITES.border.marker.x + 1.2, KESSAR_SITES.border.marker.z); run(f, s, BORDER.witnessS + 2); } }),
    sided_ward: (f) => ({ id: "border_incident", go: (s) => { run(f, s, 1); beside(f, "p1", "rival-0"); press(f, s); s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /really measuring/)); s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /Walk away/)); beside(f, "p1", "ward-0"); press(f, s); s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /Syndicate's plan/)); } }),
    sided_syndicate: (f) => ({ id: "border_incident", go: (s) => { run(f, s, 1); beside(f, "p1", "rival-0"); press(f, s); s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /really measuring/)); s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /envelope/i)); put(f, "p1", KESSAR_SITES.border.marker.x + 1.5, KESSAR_SITES.border.marker.z); run(f, s, 1); press(f, s); } }),
    provoked: (f) => ({ id: "border_incident", go: (s) => { run(f, s, 1); s.onDamage("npc:rival-1", "p1", 1, false); } }),
    escalated: (f) => ({ id: "border_incident", go: (s) => { run(f, s, BORDER_ESCALATE_S + 3, 1); f.cast.counts.set("ward", { alive: 0, routed: 0, down: 2, total: 2 }); run(f, s, 1); } }),
  };
  /** A campaign where the Syndicate does not come early, so the crossing's slow endings are unaffected by the chaos director. */
  const quiet = (): CampaignState => {
    for (let seed = 1; seed < 200; seed++) {
      const c = newCampaign(seed);
      const f = fake(c);
      const s = new Scenario(f.host, "secure_crossing");
      s.start();
      if (!lastViewComplication(f)) return c;
    }
    throw new Error("no quiet seed");
  };
  const lastViewComplication = (f: Fake): boolean => lastView(f).complication !== undefined;

  /** A world seed whose first threat works on the Lamp-Warden (two armed in the party, a full garrison), so "bargained" is reachable by a script that does not gamble. */
  const threatSeed = (c: CampaignState): number => {
    const lv = leverageOf(c, { armed: 2, garrisonAlive: 7, garrisonTotal: 7, partyWounded: 0 });
    for (let sd = 1; sd < 800; sd++) {
      const ps = hash3(sd, c.day, 0x7a11);
      const v = openParley(c, lv, ps);
      const st = answerParley(c, lv, ps, v, v.options.findIndex((o) => o.id === "haggle_threaten"));
      if (st.view && st.view.toll < v.toll) return sd;
    }
    throw new Error("no threatening seed");
  };

  it("each commits exactly one outcome with its resolution; all 20 are distinct campaigns and distinct headlines", () => {
    const campaigns = new Set<string>();
    const heads = new Set<string>();
    const base = quiet();
    for (const r of Object.keys(play) as (keyof typeof play)[]) {
      const f = fake(base);
      if (r === "bargained") f.host.seed = threatSeed(base);
      f.players.set("p1", row("p1", 0, 88));
      const { id, go } = play[r](f);
      const s = new Scenario(f.host, id);
      s.start();
      go(s);
      expect(f.commits, `${r}: ${JSON.stringify(f.commits.map((c) => c.resolution))}`).toHaveLength(1);
      expect(f.commits[0]!.resolution).toBe(r);
      expect(f.commits[0]!.scenario).toBe(id);
      expect(TEMPLATE_RESOLUTIONS[id]).toContain(r);
      run(f, s, 5);
      expect(f.commits).toHaveLength(1);
      const after = applyOutcome(base, f.commits[0]!);
      campaigns.add(JSON.stringify(after));
      heads.add(generatePaper(after, 5).headline);
      s.dispose();
    }
    expect(campaigns.size).toBe(20);
    expect(heads.size).toBe(20);
  });
});

describe("hostile input at every entry point", () => {
  it("INTERACT out of range, from NPC keys, from the downed, in the wrong state, or after the end: not taken, nothing committed", () => {
    for (const id of ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident"] as const) {
      const f = fake();
      const s = setup(f, id, row("p1", 0, 88), row("p2", 3, 88));
      run(f, s, 1);
      expect(press(f, s), `${id} far from everything`).toBe(false);
      expect(s.onInteract("npc:sentry-0", me(f, "p1"))).toBe(false);
      expect(s.onInteract("p1", undefined as never)).toBe(false);
      down(f, "p2");
      expect(s.onInteract("p2", me(f, "p2"))).toBe(false);
      expect(f.commits).toEqual([]);
      s.dispose();
      expect(s.onInteract("p1", me(f), undefined)).toBe(false);
    }
  });

  it("onPick and onParleyClose with no parley, from a non-owner, with garbage options, or after the end do nothing", () => {
    const f = fake();
    const s = setup(f, "hostage_rescue", row("p1", 0, 88), row("p2", 3, 88));
    for (const o of [0, 1, -1, 1.5, NaN, Infinity, "x" as never, undefined as never]) { s.onPick("p1", o); s.onPick("p2", o); }
    s.onParleyClose("p1");
    s.onParleyClose("p2");
    s.onParleyClose("nobody");
    expect(f.commits).toEqual([]);
    // an open parley belongs to its owner
    beside(f, "p1", "deserter-0");
    expect(press(f, s)).toBe(true);
    expect(lastParley(f, "p1")!.view).toBeDefined();
    const sent = f.sent.length;
    s.onPick("p2", 0);
    s.onParleyClose("p2");
    beside(f, "p2", "deserter-0", -0.8);
    expect(press(f, s, "p2")).toBe(true);   // the press is taken (nobody picks the prop up) but a second parley is not opened
    expect(lastParley(f, "p2")).toBeUndefined();
    expect(f.sent.slice(sent).some((m) => m.sid === "p2" && m.type === "notice")).toBe(true);
    expect(f.commits).toEqual([]);
    // after the end: nothing
    down(f, "p1");
    down(f, "p2");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    s.onPick("p1", 0);
    s.onNoise(0, 0, 100, "p1");
    s.onProp("destroyed", "x");
    s.onDamage("npc:deserter-0", "p1", 1, true);
    expect(f.commits).toHaveLength(1);
  });

  it("a flood of forged inputs (3000 sequences) never reaches an ending a client could not earn", () => {
    // Client-reachable inputs only: INTERACT from anywhere with any carried id, picks and closes from non-owners and with garbage, noise reports of absurd size,
    // props named at random, damage claims against nobody. Players stay far from every story point, so the only way to an ending is the clock.
    let seed = 0x5eed;
    const rnd = (): number => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0; return seed / 4294967296; };
    const ids = ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident"] as const;
    for (let i = 0; i < 3000; i++) {
      const id = ids[i % 4]!;
      const f = fake(newCampaign(1 + (i % 40)));
      const s = setup(f, id, row("p1", 0, 88), row("p2", 4, 90));
      const garbage = [undefined, "", "b1", "npc:warden", "__proto__", "prop-1", "prop-2"];
      for (let k = 0; k < 12; k++) {
        const roll = Math.floor(rnd() * 8);
        if (roll === 0) s.onInteract(rnd() < 0.5 ? "p1" : "p2", me(f, rnd() < 0.5 ? "p1" : "p2"), garbage[Math.floor(rnd() * garbage.length)]);
        else if (roll === 1) s.onPick(rnd() < 0.5 ? "p1" : "p2", Math.floor(rnd() * 9) - 2);
        else if (roll === 2) s.onParleyClose(rnd() < 0.5 ? "p1" : "p2");
        else if (roll === 3) s.onNoise((rnd() - 0.5) * 1e6, (rnd() - 0.5) * 1e6, rnd() * 1e6, "p1");
        else if (roll === 4) s.onProp(rnd() < 0.5 ? "destroyed" : "seized", garbage[Math.floor(rnd() * garbage.length)] ?? "x");
        else if (roll === 5) s.onDamage(garbage[1 + Math.floor(rnd() * 3)]!, "p1", 1, rnd() < 0.5);
        else run(f, s, rnd() * 3 + 0.25);
      }
      for (const c of f.commits) expect(c.resolution, `${id} #${i}`).toBe("abandoned");
      expect(f.commits.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("the runner: a use spec that asks for a CRATE (D-037)", () => {
  // the real templates' timber and barge presses are driven in MineRescue.test.ts and SmugglingRun.test.ts; this isolates the runner's own crate rule on the claim race's slot with a bespoke one-spec template, restored afterwards
  const withTimber = <T>(body: () => T): T => {
    const stub = TEMPLATES.claim_race;
    const patched = {
      ...stub,
      observe: { ...stub.observe, use: [{ id: "timber", at: { x: 5, z: 5 }, r: 2, carry: "crate" as const, consume: true }] },
      reduce: (st: { t: number }, e: { t: string }) => (e.t === "use" ? { s: { ...st, t: st.t + 0.001 }, fx: [] } : stub.reduce(st as never, e as never)),
    };
    (TEMPLATES as Record<string, unknown>).claim_race = patched;
    try { return body(); } finally { (TEMPLATES as Record<string, unknown>).claim_race = stub; }
  };
  it("is taken only with a crate in hand and in reach, consumes it exactly once, and never for a barrel, empty hands or the wrong place", () => {
    withTimber(() => {
      const f = fake();
      f.props.set("crate", { kind: PropKind.CRATE, x: 5, z: 5 });
      f.props.set("barrel", { kind: PropKind.BARREL, x: 5, z: 5 });
      const s = setup(f, "claim_race", row("p1", 5, 5, { flags: FLAG.GROUNDED | FLAG.CARRYING }));
      run(f, s, 0.5);
      expect(s.onInteract("p1", me(f), "barrel")).toBe(false);
      expect(s.onInteract("p1", me(f), undefined)).toBe(false);
      expect(s.onInteract("p1", me(f), "nonsense")).toBe(false);
      put(f, "p1", 40, 40);
      expect(s.onInteract("p1", me(f), "crate")).toBe(false);
      expect(f.consumed).toEqual([]);
      put(f, "p1", 5, 5);
      expect(s.onInteract("p1", me(f), "crate")).toBe(true);
      expect(f.consumed).toEqual(["crate"]);
      me(f).flags &= ~FLAG.CARRYING;
      expect(s.onInteract("p1", me(f), "crate")).toBe(false);   // empty hands: not a crate press
      expect(f.consumed).toEqual(["crate"]);
    });
  });
});
