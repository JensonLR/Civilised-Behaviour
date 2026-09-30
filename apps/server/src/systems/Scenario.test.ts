import { describe, expect, it } from "vitest";
import {
  BUTTON, FLAG, PropKind, weatherAt, yawFromWire, type MoveCommand, type PlayerStateType,
  answerParley, openParley, applyOutcome, askingToll, leverageOf, newCampaign, serializeCampaign, generatePaper,
  KESSAR_ANCHORS, NPC_CAP, RESOLVED_LINGER_S, RIVAL_ARRIVES_S, RIVAL_PARLEY_S, SCENARIO, npcKey,
  type BridgeState, type CampaignState, type ParleyView, type ResolutionId, type ScenarioOutcome, type ScenarioView,
} from "@cb/shared";
import { Scenario, type ScenarioHost } from "./Scenario.ts";

const DT = 0.05;
type Row = PlayerStateType & { id: string };
const row = (id: string, x: number, z: number, o: Partial<PlayerStateType> = {}): Row =>
  ({ id, name: id, x, y: 0, z, facing: 0, flags: FLAG.GROUNDED, health: 100, wounds: 0, missing: 0, weapon: 2, ammo: 5, slot: 0, connected: true, ...o }) as unknown as Row;

interface Fake {
  host: ScenarioHost;
  players: Map<string, Row>;
  commits: ScenarioOutcome[];
  sent: { sid: string; type: string; msg: any }[];
  views: ScenarioView[];
  booms: { x: number; z: number; r: number }[];
  bridges: BridgeState[];
  consumed: string[];
  removed: string[];
  steps: Map<string, MoveCommand[]>;
  props: Map<string, number>;
  clock: { ms: number };
  cap: { n: number };
}

function fake(campaign: CampaignState = newCampaign(11), startMs = 0): Fake {
  const players = new Map<string, Row>();
  const f: Fake = {
    players, commits: [], sent: [], views: [], booms: [], bridges: [], consumed: [], removed: [], steps: new Map(), props: new Map(), clock: { ms: startMs }, cap: { n: 99 }, host: undefined as never,
  };
  f.host = {
    players: players as unknown as ScenarioHost["players"],
    worldMs: () => f.clock.ms,
    campaign: () => campaign,
    commit: (o) => void f.commits.push(o),
    spawnNpc: (spec) => {
      if (players.size >= f.cap.n) return false;
      players.set(npcKey(spec.id), row(npcKey(spec.id), spec.post.x, spec.post.z, { weapon: spec.weapon + 1, ammo: 6 }));
      return true;
    },
    removeNpc: (k) => { players.delete(k); f.removed.push(k); },
    stepNpc: (k, cmd) => {
      const r = players.get(k);
      if (!r) return;
      const list = f.steps.get(k) ?? [];
      list.push({ ...cmd });
      f.steps.set(k, list);
      if ((r.flags & FLAG.DOWNED) !== 0) return;
      const y = yawFromWire(cmd.yaw), fw = cmd.moveF / 127, rt = cmd.moveR / 127;
      r.x += (-Math.sin(y) * fw + Math.cos(y) * rt) * 4.4 * DT;
      r.z += (-Math.cos(y) * fw - Math.sin(y) * rt) * 4.4 * DT;
    },
    explode: (x, _y, z, r) => void f.booms.push({ x, z, r }),
    consumeProp: (id) => void f.consumed.push(id),
    propKind: (id) => f.props.get(id),
    rebuildBridge: (s) => void f.bridges.push(s),
    publish: (v) => void f.views.push(v),
    send: (sid, type, msg) => void f.sent.push({ sid, type, msg }),
    negotiation: { askingToll, leverageOf, openParley, answerParley },
    seed: 424242,
  };
  return f;
}
const setup = (f: Fake, ...ps: Row[]): Scenario => {
  for (const p of ps) f.players.set(p.id, p);
  const s = new Scenario(f.host);
  s.start();
  return s;
};
const run = (f: Fake, s: Scenario, seconds: number): void => {
  for (let t = 0; t < seconds; t += DT) {
    f.clock.ms += DT * 1000;
    s.tick(DT);
  }
};
const warden = KESSAR_ANCHORS.wardenPost;
const atWarden = (id = "p1"): Row => row(id, warden.x - 0.7, warden.z - 0.5);
const lastParley = (f: Fake, sid: string): { view?: ParleyView; closed?: boolean; line?: string } | undefined => [...f.sent].reverse().find((m) => m.sid === sid && m.type === "parley")?.msg;
const optionIndex = (v: ParleyView, id: string): number => v.options.findIndex((o) => o.id === id);
const down = (f: Fake, key: string): void => { const r = f.players.get(key)!; r.flags |= FLAG.DOWNED; r.health = 0; };
const frozen = (f: Fake, key: string, from: number): boolean => (f.steps.get(key) ?? []).slice(from).every((c) => c.moveF === 0 && c.moveR === 0 && c.buttons === 0);

describe("the cast", () => {
  it("spawns the garrison, the Warden and the Syndicate within NPC_CAP, and starts unresolved", () => {
    const f = fake();
    const s = setup(f, row("p1", 0, 88));
    const npcs = [...f.players.keys()].filter((k) => k.startsWith("npc:"));
    expect(npcs.length).toBeGreaterThanOrEqual(8);
    expect(npcs.length).toBeLessThanOrEqual(NPC_CAP);
    expect(npcs).toContain("npc:warden");
    expect(f.views.at(-1)!.phase).toBe("approach");
    expect(f.commits).toEqual([]);
    s.dispose();
    expect([...f.players.keys()].filter((k) => k.startsWith("npc:"))).toEqual([]);
  });

  it("copes with the room refusing spawns at the cap", () => {
    const f = fake();
    f.cap.n = 3;
    const s = setup(f, row("p1", 0, 88));
    run(f, s, 2);
    expect([...f.players.keys()].filter((k) => k.startsWith("npc:")).length).toBe(2);
  });

  it("moves to standoff when the party reaches the bar, and republishes only on change", () => {
    const f = fake();
    const s = setup(f, row("p1", 0, 30));
    run(f, s, 3);
    expect(f.views.at(-1)!.phase).toBe("standoff");
    const n = f.views.length;
    run(f, s, 5);
    expect(f.views.length).toBeLessThan(n + 6); // only the ticking timer moves it, and only every half second or so
  });
});

describe("way 1: negotiate", () => {
  it("pays the asking toll and the crossing is settled (paid), committed once", () => {
    const f = fake();
    const s = setup(f, atWarden());
    run(f, s, 1.5);
    expect(s.onInteract("p1", f.players.get("p1")!)).toBe(true);
    const view = lastParley(f, "p1")!.view!;
    expect(view.toll).toBe(askingToll(newCampaign(11)));
    s.onPick("p1", optionIndex(view, "pay"));
    const closed = lastParley(f, "p1")!;
    expect(closed.closed).toBe(true);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "paid", paid: view.toll, bridge: "intact", brokePromise: false });
    const before = f.steps.get("npc:sentry-0")!.length;
    run(f, s, RESOLVED_LINGER_S + 5);
    expect(f.commits).toHaveLength(1);
    expect(frozen(f, "npc:sentry-0", before - 1) || f.removed.includes("npc:sentry-0")).toBe(true);
    expect(f.removed).toContain("npc:warden"); // the cast leaves after the linger
  });

  it("walking away closes the parley and leaves the standoff open", () => {
    const f = fake();
    const s = setup(f, atWarden());
    run(f, s, 1.5);
    s.onInteract("p1", f.players.get("p1")!);
    s.onPick("p1", optionIndex(lastParley(f, "p1")!.view!, "walk_away"));
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.commits).toEqual([]);
    expect(f.views.at(-1)!.phase).toBe("standoff");
    s.onInteract("p1", f.players.get("p1")!); // she will talk again
    expect(lastParley(f, "p1")!.view).toBeDefined();
  });

  it("a bribe spends less than the toll and is committed as bribed", () => {
    const f = fake();
    const s = setup(f, atWarden());
    run(f, s, 1.5);
    s.onInteract("p1", f.players.get("p1")!);
    const v = lastParley(f, "p1")!.view!;
    const i = optionIndex(v, "bribe");
    expect(i).toBeGreaterThanOrEqual(0);
    s.onPick("p1", i);
    expect(f.commits[0]).toMatchObject({ resolution: "bribed" });
    expect(f.commits[0]!.paid).toBeLessThan(v.toll);
  });

  it("the parley is leashed: walking off mid-sentence closes it", () => {
    const f = fake();
    const s = setup(f, atWarden());
    run(f, s, 1.5);
    s.onInteract("p1", f.players.get("p1")!);
    f.players.get("p1")!.x += 12;
    run(f, s, 0.6);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.commits).toEqual([]);
  });
});

describe("way 2: force the garrison", () => {
  it("first blood alerts the garrison, who fight back; breaking 60% of them is forced, with the dead counted", () => {
    const f = fake();
    const p1 = row("p1", 0, 22);
    const s = setup(f, p1);
    run(f, s, 1.5);
    expect(f.views.at(-1)!.phase).toBe("standoff");
    s.onDamage("npc:sentry-0", "p1", 1, false);
    expect(f.views.at(-1)!.phase).toBe("fighting");
    run(f, s, 2);
    const shots = [...f.steps.entries()].filter(([k]) => k.startsWith("npc:sentry")).reduce((n, [, cs]) => n + cs.filter((c) => (c.buttons & BUTTON.FIRE) !== 0).length, 0);
    expect(shots).toBeGreaterThan(0); // they shoot back through the ordinary command path
    expect(f.commits).toEqual([]);
    for (let i = 0; i < 4; i++) {
      down(f, `npc:sentry-${i}`);
      s.onDamage(`npc:sentry-${i}`, "p1", 1, true);
    }
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "forced", paid: 0, bridge: "intact" });
    expect(f.commits[0]!.tally.garrisonKilled).toBe(4);
    expect(f.commits[0]!.tally.downed).toBe(4);
    expect(f.commits[0]!.brokePromise).toBe(false);
    const n = f.steps.get("npc:sentry-5")!.length;
    run(f, s, 3);
    expect(frozen(f, "npc:sentry-5", n)).toBe(true); // survivors stand down
  });

  it("a rout counts as much as a death: sentries that flee are tallied as routed", () => {
    const f = fake();
    const p1 = row("p1", 0, 22);
    const s = setup(f, p1);
    run(f, s, 1.5);
    s.onDamage("npc:warden", "p1", 1, false);
    // wound four sentries badly enough that they break
    for (let i = 0; i < 4; i++) f.players.get(`npc:sentry-${i}`)!.health = 8;
    run(f, s, 6);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]!.resolution).toBe("forced");
    expect(f.commits[0]!.tally.garrisonRouted).toBeGreaterThanOrEqual(3);
  });

  it("talking first and then shooting her is a broken promise", () => {
    const f = fake();
    const s = setup(f, atWarden());
    run(f, s, 1.5);
    s.onInteract("p1", f.players.get("p1")!);
    s.onDamage("npc:warden", "p1", 1, false);
    expect(lastParley(f, "p1")).toMatchObject({ closed: true, line: "You have made your point, with a bullet." });
    for (let i = 0; i < 4; i++) {
      down(f, `npc:sentry-${i}`);
      s.onDamage(`npc:sentry-${i}`, "p1", 1, true);
    }
    run(f, s, 1);
    expect(f.commits[0]).toMatchObject({ resolution: "forced", brokePromise: true });
  });

  it("rivals shot at fight back, but shooting them is not war on the Ward", () => {
    const f = fake();
    const s = setup(f, row("p1", 0, 60));
    run(f, s, 1.5);
    s.onDamage("npc:rival-0", "p1", 1, true);
    expect(f.views.at(-1)!.phase).not.toBe("fighting");
  });
});

describe("way 3: sabotage", () => {
  const pier = KESSAR_ANCHORS.pier;
  const carrier = (): Row => row("p1", pier.x + 1, pier.z, { flags: FLAG.GROUNDED | FLAG.CARRYING });

  it("a barrel at the pier with a lit fuse drops the bridge ten seconds later (sabotaged), committed once", () => {
    const f = fake();
    f.props.set("b1", PropKind.BARREL);
    const s = setup(f, carrier());
    run(f, s, 1.2);
    expect(s.onInteract("p1", f.players.get("p1")!, "b1")).toBe(true);
    expect(f.consumed).toEqual(["b1"]);
    expect(f.views.at(-1)!.phase).toBe("rigging");
    expect(f.views.at(-1)!.timerLabel).toBe("Fuse");
    run(f, s, SCENARIO.fuseSeconds - 1);
    expect(f.booms).toEqual([]);
    run(f, s, 2);
    expect(f.booms).toHaveLength(1);
    expect(f.booms[0]).toMatchObject({ x: pier.x, z: pier.z, r: SCENARIO.chargeRadius });
    expect(f.bridges).toEqual(["collapsed"]);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "sabotaged", bridge: "collapsed" });
    run(f, s, 60);
    expect(f.commits).toHaveLength(1);
    expect(f.booms).toHaveLength(1);
  });

  it("the sentries near the pier notice the fuse and go hostile", () => {
    const f = fake();
    f.props.set("b1", PropKind.BARREL);
    const s = setup(f, carrier());
    run(f, s, 1.2);
    s.onInteract("p1", f.players.get("p1")!, "b1");
    run(f, s, 1);
    const fired = (f.steps.get("npc:sentry-0") ?? []).some((c) => (c.buttons & (BUTTON.FIRE | BUTTON.AIM)) !== 0) || (f.steps.get("npc:sentry-1") ?? []).some((c) => (c.buttons & (BUTTON.FIRE | BUTTON.AIM)) !== 0);
    expect(fired).toBe(true);
  });

  it("the weather matters: in heavy rain the same fuse takes twice as long", () => {
    // find a stretch of world time where it rains hard for the next minute
    let ms = -1;
    for (let t = 0; t < 6 * 3600_000 && ms < 0; t += 30_000) if (weatherAt(424242, t).rain >= 0.7 && weatherAt(424242, t + 45_000).rain >= 0.7) ms = t;
    expect(ms).toBeGreaterThan(0);
    const f = fake(newCampaign(11), ms);
    f.props.set("b1", PropKind.BARREL);
    const s = setup(f, carrier());
    run(f, s, 2.1); // the weather reading is taken once a second
    s.onInteract("p1", f.players.get("p1")!, "b1");
    run(f, s, SCENARIO.fuseSeconds + 1);
    expect(f.booms).toEqual([]);
    run(f, s, SCENARIO.fuseSeconds + 2);
    expect(f.booms).toHaveLength(1);
    expect(f.sent.some((m) => m.type === "notice" && /Rain/.test(m.msg.text))).toBe(true);
  });
});

describe("way 4: dawdle (the Syndicate) and the wipe", () => {
  it("the Syndicate marches to the parley spot and buys the crossing (rival_secured)", () => {
    const f = fake();
    const s = setup(f, row("p1", 0, 88));
    // (the chaos director may bring them 120 s early for this campaign; either way never before the earliest walk + their minute)
    const earliest = RIVAL_ARRIVES_S - SCENARIO.rivalEarlyBy + RIVAL_PARLEY_S;
    run(f, s, earliest - 10);
    expect(f.commits).toEqual([]);
    for (let i = 0; i < 60 && f.commits.length === 0; i++) run(f, s, 10);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]!.seconds).toBeGreaterThanOrEqual(earliest - 1);
    expect(f.commits[0]).toMatchObject({ resolution: "rival_secured" });
    const r = f.players.get("npc:rival-0")!;
    if (r) expect(Math.hypot(r.x - KESSAR_ANCHORS.rivalParley.x, r.z - KESSAR_ANCHORS.rivalParley.z)).toBeLessThan(6);
    expect(f.sent.some((m) => m.type === "notice" && /Syndicate/.test(m.msg.text))).toBe(true);
  });

  it("the whole party down is abandoned", () => {
    const f = fake();
    const s = setup(f, row("p1", 0, 60), row("p2", 3, 60));
    run(f, s, 1);
    down(f, "p1");
    run(f, s, 1);
    expect(f.commits).toEqual([]);
    down(f, "p2");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]!.resolution).toBe("abandoned");
  });

  it("a bridge that is already a ruin resolves nothing and commits nothing", () => {
    const c = newCampaign(11);
    c.crossing.bridge = "collapsed";
    const f = fake(c);
    const s = setup(f, atWarden());
    run(f, s, RIVAL_ARRIVES_S + RIVAL_PARLEY_S + 60);
    expect(f.commits).toEqual([]);
    expect(f.views.at(-1)!.phase).toBe("resolved");
    expect([...f.players.keys()].some((k) => k.startsWith("npc:rival"))).toBe(false);
    expect(f.removed).toEqual([]);
    expect(s.onInteract("p1", f.players.get("p1")!)).toBe(false);
  });
});

describe("distinct end states", () => {
  const ways: Record<string, () => ScenarioOutcome> = {
    paid: () => {
      const f = fake(); const s = setup(f, atWarden()); run(f, s, 1.5); s.onInteract("p1", f.players.get("p1")!);
      s.onPick("p1", optionIndex(lastParley(f, "p1")!.view!, "pay")); return f.commits[0]!;
    },
    forced: () => {
      const f = fake(); const s = setup(f, row("p1", 0, 22)); run(f, s, 1.5); s.onDamage("npc:sentry-0", "p1", 1, false);
      for (let i = 0; i < 4; i++) { down(f, `npc:sentry-${i}`); s.onDamage(`npc:sentry-${i}`, "p1", 1, true); }
      run(f, s, 1); return f.commits[0]!;
    },
    sabotaged: () => {
      const pier = KESSAR_ANCHORS.pier;
      const f = fake(); f.props.set("b", PropKind.BARREL);
      const s = setup(f, row("p1", pier.x + 1, pier.z, { flags: FLAG.GROUNDED | FLAG.CARRYING })); run(f, s, 1.2);
      s.onInteract("p1", f.players.get("p1")!, "b"); run(f, s, 12); return f.commits[0]!;
    },
    rival_secured: () => { const f = fake(); const s = setup(f, row("p1", 0, 88)); run(f, s, RIVAL_ARRIVES_S + RIVAL_PARLEY_S + 2); return f.commits[0]!; },
    abandoned: () => { const f = fake(); const s = setup(f, row("p1", 0, 60)); run(f, s, 1); down(f, "p1"); run(f, s, 1); return f.commits[0]!; },
  };

  it("each path commits a different outcome, which the campaign and the newspaper then tell differently", () => {
    const outcomes = Object.fromEntries(Object.entries(ways).map(([k, run_]) => [k, run_()]));
    const campaigns: string[] = [];
    const headlines: string[] = [];
    for (const [k, o] of Object.entries(outcomes)) {
      expect(o.resolution, k).toBe(k as ResolutionId);
      const after = applyOutcome(newCampaign(11), o);
      campaigns.push(serializeCampaign(after));
      headlines.push(generatePaper(after, 424242).headline);
    }
    expect(new Set(campaigns).size).toBe(campaigns.length);
    expect(new Set(headlines).size).toBe(headlines.length);
    expect(outcomes.sabotaged!.bridge).toBe("collapsed");
    expect(outcomes.paid!.paid).toBeGreaterThan(0);
  });
});

describe("a client cannot force a resolution", () => {
  it("ignores picks from anyone but the owner, and options that do not exist", () => {
    const f = fake();
    const s = setup(f, atWarden("p1"), row("p2", warden.x - 1, warden.z - 1));
    run(f, s, 1.5);
    s.onInteract("p1", f.players.get("p1")!);
    const v = lastParley(f, "p1")!.view!;
    const pay = optionIndex(v, "pay");
    s.onPick("p2", pay);
    s.onPick("ghost", pay);
    for (const bad of [-1, v.options.length, 99, 1.5, Number.NaN, Infinity, "0" as unknown as number, undefined as unknown as number]) s.onPick("p1", bad);
    s.onParleyClose("p2");
    expect(f.commits).toEqual([]);
    expect(lastParley(f, "p2")).toBeUndefined();
    expect(lastParley(f, "p1")!.closed).toBeUndefined();
    s.onPick("p1", pay);
    expect(f.commits).toHaveLength(1);
  });

  it("a second player cannot open a parley over the first, or at all when the place is at war", () => {
    const f = fake();
    const s = setup(f, atWarden("p1"), row("p2", warden.x - 1, warden.z - 1));
    run(f, s, 1.5);
    s.onInteract("p1", f.players.get("p1")!);
    expect(s.onInteract("p2", f.players.get("p2")!)).toBe(true);
    expect(lastParley(f, "p2")).toBeUndefined();
    expect(f.sent.some((m) => m.sid === "p2" && m.type === "notice")).toBe(true);
    s.onDamage("npc:sentry-0", "p1", 1, false);
    expect(s.onInteract("p2", f.players.get("p2")!)).toBe(true);
    expect(lastParley(f, "p2")).toBeUndefined();
  });

  it("picks with no parley open, and after the crossing is settled, do nothing", () => {
    const f = fake();
    const s = setup(f, atWarden());
    run(f, s, 1.5);
    s.onPick("p1", 0);
    expect(f.commits).toEqual([]);
    s.onInteract("p1", f.players.get("p1")!);
    s.onPick("p1", optionIndex(lastParley(f, "p1")!.view!, "pay"));
    const sent = f.sent.length;
    s.onPick("p1", 0);
    s.onParleyClose("p1");
    expect(s.onInteract("p1", f.players.get("p1")!)).toBe(false);
    expect(f.sent.length).toBe(sent);
    expect(f.commits).toHaveLength(1);
  });

  it("the charge: no barrel, wrong prop, unknown prop, not carrying, too far, downed, an NPC, a second fuse: all ignored", () => {
    const pier = KESSAR_ANCHORS.pier;
    const f = fake();
    f.props.set("b1", PropKind.BARREL);
    f.props.set("c1", PropKind.CRATE);
    const carry = GROUNDED_CARRY();
    const s = setup(f, row("p1", pier.x + 1, pier.z, { flags: carry }), row("p2", pier.x + 1, pier.z, { flags: FLAG.GROUNDED }), row("p3", 0, 80, { flags: carry }), row("p4", pier.x, pier.z, { flags: carry | FLAG.DOWNED }));
    run(f, s, 1.2);
    const p = (id: string): Row => f.players.get(id)!;
    expect(s.onInteract("p1", p("p1"))).toBe(false);          // carrying, but nothing named
    expect(s.onInteract("p1", p("p1"), "c1")).toBe(false);     // a crate
    expect(s.onInteract("p1", p("p1"), "nope")).toBe(false);   // not a prop
    expect(s.onInteract("p2", p("p2"), "b1")).toBe(false);     // not carrying
    expect(s.onInteract("p3", p("p3"), "b1")).toBe(false);     // nowhere near the pier
    expect(s.onInteract("p4", p("p4"), "b1")).toBe(false);     // downed
    expect(s.onInteract("npc:warden", p("p1"), "b1")).toBe(false);
    expect(f.consumed).toEqual([]);
    run(f, s, SCENARIO.fuseSeconds + 3);
    expect(f.booms).toEqual([]);
    expect(f.commits).toEqual([]);
    expect(s.onInteract("p1", p("p1"), "b1")).toBe(true);
    expect(s.onInteract("p1", p("p1"), "b1")).toBe(true);      // told off, nothing consumed
    expect(f.consumed).toEqual(["b1"]);
    run(f, s, SCENARIO.fuseSeconds + 3);
    expect(f.booms).toHaveLength(1);
  });

  it("garbage damage reports never throw or resolve anything", () => {
    const f = fake();
    const s = setup(f, row("p1", 0, 60));
    run(f, s, 1);
    for (const [v, a] of [["", ""], ["nobody", "nobody"], ["npc:sentry-0", "npc:warden"], ["p1", "npc:sentry-0"], ["npc:ghost", "p1"]] as const) s.onDamage(v, a, 99, false);
    expect(f.commits).toEqual([]);
    expect(f.views.at(-1)!.phase).not.toBe("resolved");
  });

  it("does nothing before start and after dispose", () => {
    const f = fake();
    f.players.set("p1", atWarden());
    const s = new Scenario(f.host);
    s.tick(1);
    expect(s.onInteract("p1", f.players.get("p1")!)).toBe(false);
    s.start();
    s.dispose();
    s.tick(1);
    s.onPick("p1", 0);
    expect(f.commits).toEqual([]);
  });
});

function GROUNDED_CARRY(): number { return FLAG.GROUNDED | FLAG.CARRYING; }
