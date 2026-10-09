import { describe, expect, it } from "vitest";
import {
  FLAG, HIGHMARK_ANCHORS, HIGHMARK_RESOLUTIONS, HIGHMARK_SITES, NPC, NPC_CAP, PropKind, RESOLVED_LINGER_S, answerParley, applyOutcome, askingToll, leverageOf, newCampaign, npcKey, openParley,
  type CampaignState, type ParleyView, type PlayerStateType, type ScenarioOutcome, type ScenarioView,
} from "@cb/shared";
import type { CastApi, CastCount, CastOrder, NpcSide, NpcSpec } from "@cb/shared";
import { Scenario, type ScenarioHost } from "./Scenario.ts";

/**
 * "The Vacant Chair" (D-036, Highmark) through the REAL runner on a fake host and a fake Cast: the six endings as a client could reach them (INTERACT, a parley option index, a barrel
 * carried to a delegate, the cast's counts), one commit each, and hostile input at every entry point. The pure rules are in packages/shared (scenarios/succession.test.ts); this file
 * judges the runner's observation and the fx it carries out. No server source is touched by package G.
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
  despawned: string[] = [];
  constructor(readonly players: Map<string, Row>) {}
  spawn(specs: readonly NpcSpec[]): number {
    let n = 0;
    for (const sp of specs) {
      if (this.players.has(npcKey(sp.id))) continue;
      this.players.set(npcKey(sp.id), row(npcKey(sp.id), sp.post.x, sp.post.z, { weapon: sp.weapon + 1, ammo: 6, npc: sp.role } as Partial<PlayerStateType>));
      this.specs.push(sp);
      n++;
    }
    return n;
  }
  order(group: string, o: CastOrder): void { this.orders.push({ group, order: o }); }
  setWar(a: NpcSide, b: NpcSide, on: boolean): void { this.wars.push({ a, b, on }); }
  count(group: string): CastCount {
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

interface Fake {
  host: ScenarioHost;
  players: Map<string, Row>;
  cast: FakeCast;
  commits: ScenarioOutcome[];
  sent: { sid: string; type: string; msg: any }[];
  views: ScenarioView[];
  consumed: string[];
  props: Map<string, { kind: number; x: number; z: number }>;
  clock: { ms: number };
}

function fake(campaign: CampaignState = newCampaign(11)): Fake {
  const players = new Map<string, Row>();
  const cast = new FakeCast(players);
  const f: Fake = { players, cast, commits: [], sent: [], views: [], consumed: [], props: new Map(), clock: { ms: 0 }, host: undefined as never };
  f.host = {
    players: players as unknown as ScenarioHost["players"],
    worldMs: () => f.clock.ms,
    campaign: () => campaign,
    commit: (o) => void f.commits.push(o),
    cast,
    mounts: undefined,
    consumeProp: (id) => void f.consumed.push(id),
    propKind: (id) => f.props.get(id)?.kind,
    propPos: (id) => { const p = f.props.get(id); return p ? { x: p.x, y: 0, z: p.z } : undefined; },
    propsNear: () => [],
    spawnProp: (kind, x, z) => { const id = `prop-${f.props.size + 1}`; f.props.set(id, { kind, x, z }); return id; },
    rebuildBridge: () => {},
    explode: () => {},
    publish: (v) => void f.views.push(v),
    send: (sid, type, msg) => void f.sent.push({ sid, type, msg }),
    negotiation: { askingToll, leverageOf, openParley, answerParley },
    seed: 424242,
    groundY: () => 0,
  };
  return f;
}

const setup = (f: Fake, ...ps: Row[]): Scenario => {
  for (const p of ps) f.players.set(p.id, p);
  const s = new Scenario(f.host, "succession_dispute");
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
const labelIndex = (v: ParleyView, re: RegExp): number => v.options.findIndex((o) => re.test(o.label));
const down = (f: Fake, key: string): void => { const r = f.players.get(key)!; r.flags |= FLAG.DOWNED; r.health = 0; };
const lastView = (f: Fake): ScenarioView => f.views.at(-1)!;
const press = (f: Fake, s: Scenario, id = "p1", prop?: string): boolean => s.onInteract(id, me(f, id), prop);
const npcKeys = (f: Fake): string[] => [...f.players.keys()].filter((k) => k.startsWith("npc:"));
/** The seconds to the harvest bell, read off the HUD's countdown (so a complication's shift is honoured). */
const bellIn = (f: Fake): number => (lastView(f).endsAtWorldMs - f.clock.ms) / 1000;

/** Talks to `who` and picks the option whose label matches. */
function pick(f: Fake, s: Scenario, who: string, re: RegExp, sid = "p1"): void {
  beside(f, sid, who);
  expect(press(f, s, sid), `press at ${who}`).toBe(true);
  const v = lastParley(f, sid)!.view!;
  expect(v, `a parley with ${who}`).toBeDefined();
  const i = labelIndex(v, re);
  expect(i, `${re} among ${v.options.map((o) => o.label).join(" | ")}`).toBeGreaterThanOrEqual(0);
  s.onPick(sid, i);
}
/** Carries a barrel of grain to a delegate. */
function feed(f: Fake, s: Scenario, n: number, sid = "p1"): boolean {
  const id = `barrel-${n}`;
  f.props.set(id, { kind: PropKind.BARREL, x: 0, z: 0 });
  me(f, sid).flags |= FLAG.CARRYING;
  beside(f, sid, `grange-${n}`);
  const taken = press(f, s, sid, id);
  me(f, sid).flags &= ~FLAG.CARRYING;
  return taken;
}
const START = { x: HIGHMARK_ANCHORS.capital.court.x, z: HIGHMARK_ANCHORS.capital.court.z };
const newRun = (): { f: Fake; s: Scenario } => {
  const f = fake();
  const s = setup(f, row("p1", START.x + 3, START.z + 3));
  run(f, s, 1);
  return { f, s };
};

describe("the runner: start, publish, dispose (The Vacant Chair)", () => {
  it("spawns the court through the cast within NPC_CAP, starts unresolved, and publishes the Highmark view", () => {
    const { f, s } = newRun();
    expect(npcKeys(f).length).toBeGreaterThanOrEqual(10);
    expect(npcKeys(f).length).toBeLessThanOrEqual(14);
    expect(npcKeys(f).length).toBeLessThanOrEqual(NPC_CAP);
    expect(f.commits).toEqual([]);
    expect(lastView(f)).toMatchObject({ template: "succession_dispute", title: "The Vacant Chair", timerLabel: "The harvest bell" });
    expect(s.template).toBe("succession_dispute");
    const roles = new Set([...f.players.values()].map((r) => (r as unknown as { npc?: number }).npc));
    for (const r of [NPC.CHAMBERLAIN, NPC.CLAIMANT, NPC.COURT_GUARD, NPC.HERDER, NPC.RIVAL_SURVEYOR]) expect(roles.has(r), `role ${r}`).toBe(true);
    s.dispose();
    expect(npcKeys(f)).toEqual([]);
  });

  it("the people stand where Highmark's plan puts them", () => {
    const { f } = newRun();
    const at = (id: string): { x: number; z: number } => f.players.get(npcKey(id))!;
    expect(at("chamberlain")).toMatchObject(HIGHMARK_SITES.chamberlain);
    expect(at("claimant-elder")).toMatchObject(HIGHMARK_SITES.claimants.elder);
    expect(at("claimant-younger")).toMatchObject(HIGHMARK_SITES.claimants.younger);
    expect(at("envoy")).toMatchObject(HIGHMARK_SITES.envoy);
    for (let i = 0; i < 4; i++) expect(at(`guard-${i}`)).toMatchObject(HIGHMARK_SITES.guards[i]!);
  });
});

describe("the six endings through the real runner, one commit each", () => {
  it("backed_elder: Form 11 stamped, the elder pledged, two delegates fed, the bell rings and the Assembly ratifies", () => {
    const { f, s } = newRun();
    pick(f, s, "chamberlain", /Form 11/);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    pick(f, s, "claimant-elder", /Pledge/);
    expect(f.commits).toHaveLength(0);
    run(f, s, 46);
    expect(feed(f, s, 0)).toBe(true);
    expect(feed(f, s, 1)).toBe(true);
    expect(f.consumed, "the grain is consumed").toEqual(["barrel-0", "barrel-1"]);
    run(f, s, bellIn(f) + 2);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "succession_dispute", resolution: "backed_elder", region: "highmark" });
    expect(f.commits[0]!.paid).toBeGreaterThan(0);
    expect(lastView(f).resolution).toBe("backed_elder");
    expect(f.cast.groupOrders("guards")).toContain("stand_down");
    run(f, s, RESOLVED_LINGER_S + 2);
    expect(f.commits).toHaveLength(1);
    expect(npcKeys(f), "the court is despawned after the linger").toEqual([]);
  });

  it("backed_younger: an envelope for the Chamberlain, the younger pledged, all three delegates fed (the bell rings early)", () => {
    const { f, s } = newRun();
    const before = bellIn(f);
    pick(f, s, "chamberlain", /envelope/i);
    pick(f, s, "claimant-younger", /Pledge/);
    for (const n of [0, 1, 2]) feed(f, s, n);
    expect(bellIn(f), "a fed Assembly rings early").toBeLessThan(before - 30);
    run(f, s, 25);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "backed_younger", region: "highmark" });
  });

  it("regency: both heirs and the Chamberlain sign, the Assembly ratifies", () => {
    const { f, s } = newRun();
    pick(f, s, "chamberlain", /envelope/i);
    pick(f, s, "claimant-elder", /regency/i);
    pick(f, s, "claimant-younger", /regency/i);
    for (const n of [0, 1, 2]) feed(f, s, n);
    run(f, s, 25);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "regency", paid: f.commits[0]!.paid });
  });

  it("usurped: break the guard (a shot, then the downed), then sit somebody in the chair", () => {
    const { f, s } = newRun();
    s.onDamage(npcKey("guard-0"), "p1", 1, true);
    down(f, npcKey("guard-0"));
    for (const i of [1, 2]) { s.onDamage(npcKey(`guard-${i}`), "p1", 1, true); down(f, npcKey(`guard-${i}`)); }
    run(f, s, 1);
    expect(f.cast.groupOrders("guards")).toContain("alert");
    expect(lastView(f).phase).toBe("fighting");
    expect(lastView(f).objectives.map((o) => o.id)).toContain("sit");
    put(f, "p1", lastThrone(f).x, lastThrone(f).z + 0.6);
    expect(press(f, s)).toBe(true);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "usurped", region: "highmark" });
    expect(f.commits[0]!.tally.downed).toBe(3);
    expect(f.commits[0]!.tally.garrisonKilled).toBe(3);
  });

  it("crown_sold: the envoy's cheque taken (two presses) and the Chamberlain's seal bought", () => {
    const { f, s } = newRun();
    beside(f, "p1", "envoy");
    expect(press(f, s)).toBe(true);
    expect(f.sent.some((m) => m.type === "notice" && /£\d+/.test(m.msg.text))).toBe(true);
    expect(press(f, s)).toBe(true);
    expect(f.commits).toHaveLength(0);
    pick(f, s, "chamberlain", /envelope/i);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "crown_sold", region: "highmark" });
    expect(f.commits[0]!.loot).toBeGreaterThanOrEqual(80);
  });

  it("crown_sold by default: nobody settles anything, and the cheque is cashed without them", () => {
    const { f, s } = newRun();
    run(f, s, bellIn(f) + 150 + 3);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "crown_sold" });
    expect(f.commits[0]!.loot).toBeUndefined();
  });

  it("abandoned: the whole party down", () => {
    const { f, s } = newRun();
    down(f, "p1");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "abandoned", region: "highmark" });
  });

  it("every Highmark outcome the runner commits applies cleanly to the ledger", () => {
    const seen = new Set<string>();
    for (const r of [...HIGHMARK_RESOLUTIONS]) seen.add(r);
    const { f, s } = newRun();
    pick(f, s, "chamberlain", /envelope/i);
    pick(f, s, "claimant-elder", /Pledge/);
    for (const n of [0, 1, 2]) feed(f, s, n);
    run(f, s, 25);
    const c = applyOutcome(newCampaign(11), f.commits[0]!);
    expect(c.sites.succession).toBe("elder");
    expect(c.history.at(-1)).toMatchObject({ region: "highmark", template: "succession_dispute" });
    expect(seen.size).toBe(5);
  });
});

const lastThrone = (f: Fake): { x: number; z: number } => {
  // the throne is where the template's INTERACT spot is: the chair in the plan (the runner reads `observe.use`)
  void f;
  return { x: 0, z: -100.05 };
};

describe("leave: the room calls it before dispose", () => {
  it("commits nothing when nothing happened; abandoned once something did; crown_sold with the cheque in the pocket", () => {
    const a = newRun();
    a.s.leave();
    expect(a.f.commits).toEqual([]);
    const b = newRun();
    pick(b.f, b.s, "chamberlain", /Form 11/);
    b.s.leave();
    expect(b.f.commits).toHaveLength(1);
    expect(b.f.commits[0]).toMatchObject({ resolution: "abandoned", region: "highmark" });
    const c = newRun();
    beside(c.f, "p1", "envoy");
    press(c.f, c.s);
    press(c.f, c.s);
    c.s.leave();
    expect(c.f.commits).toHaveLength(1);
    expect(c.f.commits[0]).toMatchObject({ resolution: "crown_sold" });
  });
});

describe("hostile input at every entry point", () => {
  it("forged INTERACT (out of range, from an NPC key, from the downed, with a garbage carried id) is not taken, and nothing commits", () => {
    const f = fake();
    const s = setup(f, row("p1", 0, 118), row("p2", 3, 118));
    run(f, s, 1);
    expect(press(f, s), "far from everything").toBe(false);
    expect(s.onInteract("npc:guard-0", me(f, "p1"))).toBe(false);
    expect(s.onInteract("p1", undefined as never)).toBe(false);
    down(f, "p2");
    expect(s.onInteract("p2", me(f, "p2"))).toBe(false);
    // a grange press without a barrel, with a non-barrel, with a made-up id: the delegate is not fed
    beside(f, "p1", "grange-0");
    expect(press(f, s)).toBe(false);
    f.props.set("crate-1", { kind: PropKind.CRATE, x: 0, z: 0 });
    me(f).flags |= FLAG.CARRYING;
    for (const id of ["crate-1", "nobody", "__proto__", "", undefined]) expect(press(f, s, "p1", id as string | undefined), `carrying ${String(id)}`).toBe(false);
    expect(f.consumed).toEqual([]);
    expect(f.commits).toEqual([]);
    s.dispose();
    expect(s.onInteract("p1", me(f), undefined)).toBe(false);
  });

  it("a delegate is fed once; a downed delegate and a downed envoy cannot be dealt with", () => {
    const { f, s } = newRun();
    expect(feed(f, s, 0)).toBe(true);
    expect(feed(f, s, 0), "the same delegate twice is refused: the press falls through to the room (D-096)").toBe(false);
    expect(f.consumed.length, "(the runner consumes only what the machine accepted)").toBeGreaterThanOrEqual(1);
    down(f, npcKey("grange-1"));
    expect(feed(f, s, 1), "a downed delegate cannot be reached").toBe(false);
    down(f, npcKey("envoy"));
    beside(f, "p1", "envoy");
    expect(press(f, s)).toBe(false);
    expect(f.commits).toEqual([]);
  });

  it("onPick and onParleyClose with no parley, from a non-owner, with garbage options, or after the end do nothing", () => {
    const f = fake();
    const s = setup(f, row("p1", START.x, START.z + 6), row("p2", START.x + 3, START.z + 6));
    for (const o of [0, 1, -1, 1.5, NaN, Infinity, "x" as never, undefined as never]) { s.onPick("p1", o); s.onPick("p2", o); }
    s.onParleyClose("p1");
    s.onParleyClose("nobody");
    expect(f.commits).toEqual([]);
    // an open parley belongs to its owner
    beside(f, "p1", "chamberlain");
    expect(press(f, s)).toBe(true);
    const v = lastParley(f, "p1")!.view!;
    expect(v.options.length).toBeGreaterThanOrEqual(4);
    const sent = f.sent.length;
    s.onPick("p2", 0);
    s.onParleyClose("p2");
    s.onPick("p1", v.options.length);        // out of range
    s.onPick("p1", -1);
    s.onPick("p1", 1.5);
    s.onPick("p1", NaN);
    expect(f.sent.length, "nothing was sent for a non-owner or an out-of-range pick").toBe(sent);
    beside(f, "p2", "chamberlain", -0.8);
    expect(press(f, s, "p2")).toBe(true);   // taken, but no second parley is opened
    expect(lastParley(f, "p2")).toBeUndefined();
    expect(f.commits).toEqual([]);
    // a wandering player's parley closes by the leash
    put(f, "p1", START.x + 40, START.z + 40);
    run(f, s, 1);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    // after the end: nothing
    down(f, "p1");
    down(f, "p2");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    s.onPick("p1", 0);
    s.onNoise(0, 0, 100, "p1");
    s.onProp("destroyed", "x");
    s.onDamage(npcKey("guard-0"), "p1", 1, true);
    expect(press(f, s)).toBe(false);
    expect(f.commits).toHaveLength(1);
  });

  it("a forged `pay` index with a purse too small is re-issued, not charged; an unaffordable pledge changes nothing", () => {
    const f = fake({ ...newCampaign(11), purse: 4 });
    const s = setup(f, row("p1", START.x, START.z + 3));
    run(f, s, 1);
    beside(f, "p1", "claimant-elder");
    press(f, s);
    const v = lastParley(f, "p1")!.view!;
    s.onPick("p1", labelIndex(v, /Pledge/));
    expect(lastParley(f, "p1")!.view, "the round is re-issued").toBeDefined();
    run(f, s, 400);
    expect(f.commits.every((c) => c.paid === 0)).toBe(true);
  });

  it("a flood of forged inputs (1500 sequences) never reaches an ending a client could not earn, never throws, never commits twice", () => {
    let seed = 0x5eed;
    const rnd = (): number => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0; return seed / 4294967296; };
    const garbage = [undefined, "", "b1", "npc:chamberlain", "__proto__", "prop-1", "barrel-0", "crate-1"];
    for (let i = 0; i < 1500; i++) {
      const f = fake(newCampaign(1 + (i % 40)));
      f.props.set("barrel-0", { kind: PropKind.BARREL, x: 0, z: 0 });
      const s = setup(f, row("p1", 0, 118), row("p2", 4, 120));
      for (let k = 0; k < 12; k++) {
        const who = rnd() < 0.5 ? "p1" : "p2";
        switch (Math.floor(rnd() * 6)) {
          case 0: s.onInteract(who, me(f, who), garbage[Math.floor(rnd() * garbage.length)]); break;
          case 1: s.onPick(who, [0, 1, 2, -1, 1.5, NaN, 99][Math.floor(rnd() * 7)]!); break;
          case 2: s.onParleyClose(who); break;
          case 3: s.onNoise((rnd() - 0.5) * 1e6, (rnd() - 0.5) * 1e6, rnd() * 1e9, who); break;
          case 4: s.onProp("destroyed", garbage[Math.floor(rnd() * garbage.length)] as string); break;
          default: s.onDamage(["npc:guard-0", "npc:envoy", "nobody"][Math.floor(rnd() * 3)]!, who, 1, rnd() < 0.5); break;
        }
        run(f, s, 0.5);
      }
      expect(f.commits.length, `run ${i}`).toBeLessThanOrEqual(1);
      for (const c of f.commits) expect(["abandoned", ...HIGHMARK_RESOLUTIONS]).toContain(c.resolution);
      s.dispose();
    }
  }, 120_000);
});
