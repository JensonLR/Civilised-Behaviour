import { describe, expect, it } from "vitest";
import { FLAG, NPC, NPC_CAP, PropKind, RESOLVED_LINGER_S, TEMPLATE_RESOLUTIONS, VESPER_ANCHORS, VESPER_SITES, VESPER_STOCK, applyOutcome, newCampaign, npcKey } from "@cb/shared";
import { DT, beside, down, fake, labelIndex, lastParley, lastView, me, notices, npcKeys, pick, press, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";
import type { Scenario } from "./Scenario.ts";

/**
 * "The Lower Gallery" (D-037, Vesper Gorge, package C3) through the REAL runner on a fake host and a fake Cast: the four endings (and the party-down abandonment) as a client could reach them
 * (INTERACT with crates, barrels, empty hands, a parley option index, the cast's counts), one commit each, and hostile input at every entry point. The pure rules are in packages/shared
 * (scenarios/mineRescue.test.ts). No server source is touched by package C3.
 */

const FALL = VESPER_STOCK.dig;
const START = { x: VESPER_ANCHORS.road[5]!.x, z: VESPER_ANCHORS.road[5]!.z };
const newRun = (purse = 400): { f: Fake; s: Scenario } => {
  const f = fake({ ...newCampaign(11), purse });
  const s = setup(f, "mine_rescue", row("p1", START.x, START.z));
  run(f, s, 1);
  return { f, s };
};
const MINER_KEYS = (f: Fake): string[] => npcKeys(f).filter((k) => k.startsWith("npc:miner-"));
/** Carries a crate (timber) or a barrel (powder) to the fall and presses INTERACT with it in the hands. */
function carry(f: Fake, s: Scenario, kind: number, n: number, sid = "p1"): boolean {
  const id = `${kind === PropKind.CRATE ? "timber" : "keg"}${n}`;
  f.props.set(id, { kind, x: 0, z: 0 });
  put(f, sid, FALL.x, FALL.z + 1.5);
  me(f, sid).flags |= FLAG.CARRYING;
  const taken = press(f, s, sid, id);
  me(f, sid).flags &= ~FLAG.CARRYING;
  return taken;
}
const shore = (f: Fake, s: Scenario): void => { for (let i = 0; i < 3; i++) expect(carry(f, s, PropKind.CRATE, i), `timber ${i}`).toBe(true); };
/** One shovel-press per cooldown, `n` times. */
function dig(f: Fake, s: Scenario, n: number, sid = "p1"): void {
  put(f, sid, FALL.x, FALL.z + 1.5);
  for (let i = 0; i < n; i++) {
    press(f, s, sid);
    run(f, s, 1.2);
  }
}
const objective = (f: Fake, id: string): string => lastView(f).objectives.find((o) => o.id === id)?.text ?? "";
/** Chooses an option of the parley now on the owner's screen (a second round, after `ask`). */
function choose(f: Fake, s: Scenario, re: RegExp, sid = "p1"): void {
  const v = lastParley(f, sid)!.view!;
  expect(v, "a parley is open").toBeDefined();
  const i = labelIndex(v, re);
  expect(i, `${re} among ${v.options.map((o) => o.label).join(" | ")}`).toBeGreaterThanOrEqual(0);
  s.onPick(sid, i);
}

describe("the runner: start, publish, dispose (The Lower Gallery)", () => {
  it("spawns the foreman, the Guild and eleven miners within the cast cap, starts unresolved, and publishes the Vesper view", () => {
    const { f, s } = newRun();
    expect(npcKeys(f).length).toBe(14);
    expect(npcKeys(f).length).toBeLessThanOrEqual(NPC_CAP);
    expect(MINER_KEYS(f)).toHaveLength(11);
    expect(f.commits).toEqual([]);
    expect(lastView(f)).toMatchObject({ template: "mine_rescue", title: "The Lower Gallery" });
    expect(lastView(f).resolution).toBeUndefined();
    expect(s.template).toBe("mine_rescue");
    const roles = new Set([...f.players.values()].map((r) => (r as unknown as { npc?: number }).npc));
    for (const r of [NPC.FOREMAN, NPC.MOURNER, NPC.MINER]) expect(roles.has(r), `role ${r}`).toBe(true);
    s.dispose();
    expect(npcKeys(f)).toEqual([]);
  });

  it("the people stand where Vesper's plan puts them, and the miners are behind the fall", () => {
    const { f } = newRun();
    const at = (id: string): { x: number; z: number } => f.players.get(npcKey(id))!;
    expect(at("foreman")).toMatchObject(VESPER_SITES.foreman);
    expect(at("dirge-master")).toMatchObject(VESPER_SITES.dirgeMaster);
    for (const k of MINER_KEYS(f)) expect(f.players.get(k)!.z, k).toBeLessThan(-98);
  });

  it("the stock is placed through the host: five crates of timber and the keg", () => {
    const { f } = newRun();
    const kinds = [...f.props.values()].map((p) => p.kind);
    expect(kinds.filter((k) => k === PropKind.CRATE)).toHaveLength(5);
    expect(kinds.filter((k) => k === PropKind.BARREL)).toHaveLength(1);
  });
});

describe("the four endings through the real runner, one commit each", () => {
  it("dug_out: three sets of shoring, then forty shovel-presses: the fall is dug and the miners come out", () => {
    const { f, s } = newRun();
    shore(f, s);
    expect(f.consumed).toEqual(["timber0", "timber1", "timber2"]);
    expect(objective(f, "timber")).toMatch(/3 of 3/);
    dig(f, s, 39);
    expect(f.commits).toHaveLength(0);
    expect(objective(f, "dig")).toMatch(/\(9\d%\)/);
    dig(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "mine_rescue", resolution: "dug_out", region: "vesper", toll: 0, bridge: "intact", brokePromise: false, paid: 0 });
    expect(lastView(f).resolution).toBe("dug_out");
    expect(f.cast.groupOrders("foreman")).toContain("stand_down");
    run(f, s, RESOLVED_LINGER_S + 2);
    expect(f.commits, "one commit, whatever happens after").toHaveLength(1);
    expect(npcKeys(f), "the gorge is despawned after the linger").toEqual([]);
  });

  it("without timber the face will not hold past a quarter, and the schedule seals it", () => {
    const { f, s } = newRun();
    dig(f, s, 30);
    expect(objective(f, "dig")).toMatch(/\(25%\)/);
    expect(f.commits).toHaveLength(0);
    run(f, s, 260);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "sealed", region: "vesper" });
  });

  it("blasted_through: the keg is set (and consumed), goes off at the fall five seconds later, and the dead are counted in between", () => {
    const { f, s } = newRun();
    expect(carry(f, s, PropKind.BARREL, 0)).toBe(true);
    expect(f.consumed).toEqual(["keg0"]);
    expect(lastView(f).phase).toBe("rigging");
    run(f, s, 5.5);
    expect(f.blasts).toHaveLength(1);
    expect(f.blasts[0]).toMatchObject({ x: VESPER_STOCK.blast.x, z: VESPER_STOCK.blast.z, owner: "p1" });
    expect(f.commits).toHaveLength(0);
    // the roof moves: three miners do not enjoy it, and the room tells the runner so
    for (const k of MINER_KEYS(f).slice(0, 3)) { down(f, k); s.onDamage(k, "p1", 1, true); }
    run(f, s, 3.5);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "blasted_through", region: "vesper" });
    expect(f.commits[0]!.tally.civiliansHarmed).toBe(3);
    expect(f.commits[0]!.tally.downed).toBe(3);
    expect(f.commits[0]!.brokePromise, "miners are not a party to anything").toBe(false);
    expect(f.blasts, "the blast is called once").toHaveLength(1);
  });

  it("a second keg after the first is not taken (nothing is consumed twice)", () => {
    const { f, s } = newRun();
    carry(f, s, PropKind.BARREL, 0);
    expect(carry(f, s, PropKind.BARREL, 1), "the press is taken (the fuse is lit) but changes nothing").toBe(true);
    expect(f.consumed).toEqual(["keg0"]);
    run(f, s, 9);
    expect(f.blasts).toHaveLength(1);
    expect(f.commits).toHaveLength(1);
  });

  it("sealed: nobody settles the schedule and the whistle blows inside the seal window", () => {
    const { f, s } = newRun();
    run(f, s, 90);
    expect(f.commits).toHaveLength(0);
    run(f, s, 150);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "sealed", region: "vesper", paid: 0 });
    expect(f.cast.groupOrders("foreman")).toContain("stand_down");
    expect(lastView(f).resolution).toBe("sealed");
  });

  it("consecrated by the bill: the Dirge-Master is paid, and the gallery is the Guild's", () => {
    const { f, s } = newRun();
    pick(f, s, "dirge-master", /Settle the Guild's bill/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "consecrated", region: "vesper" });
    expect(f.commits[0]!.paid).toBeGreaterThanOrEqual(45 * 0.75);
    expect(f.commits[0]!.paid).toBeLessThanOrEqual(90);
    expect(f.cast.groupOrders("guild")).toContain("stand_down");
    expect(lastParley(f, "p1")!.closed).toBe(true);
  });

  it("consecrated by the air: the schedule is bought off, the air runs out and the choir files up the road", () => {
    const { f, s } = newRun();
    pick(f, s, "foreman", /handling charge/);
    expect(f.commits).toHaveLength(0);
    run(f, s, 300);
    expect(f.commits, "a schedule that has been paid for is not met").toHaveLength(0);
    run(f, s, 200);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "consecrated", region: "vesper" });
    expect(f.commits[0]!.paid).toBeGreaterThan(0);
    expect(f.commits[0]!.seconds).toBeGreaterThanOrEqual(420);
  });

  it("abandoned: the whole party down", () => {
    const { f, s } = newRun();
    down(f, "p1");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "abandoned", region: "vesper" });
  });

  it("every outcome the runner commits is one of the template's declared resolutions and applies cleanly to the ledger", () => {
    const allowed = new Set<string>(TEMPLATE_RESOLUTIONS.mine_rescue);
    for (const k of ["seal", "bill", "powder", "dig"] as const) {
      const { f, s } = newRun();
      if (k === "seal") run(f, s, 260);
      if (k === "bill") pick(f, s, "dirge-master", /Settle the Guild's bill/);
      if (k === "powder") { carry(f, s, PropKind.BARREL, 0); run(f, s, 10); }
      if (k === "dig") { shore(f, s); dig(f, s, 40); }
      expect(f.commits, k).toHaveLength(1);
      expect(allowed.has(f.commits[0]!.resolution), k).toBe(true);
      const c = applyOutcome(newCampaign(11), f.commits[0]!);
      expect(c.history.at(-1), k).toMatchObject({ region: "vesper", template: "mine_rescue" });
      expect(c.sites.ends.mine_rescue, k).toBe(f.commits[0]!.resolution);
      expect(c.crossing, "Kessar's crossing is not Vesper's business").toEqual(newCampaign(11).crossing);
    }
  });
});

describe("the parleys: the foreman's schedule and the Guild's offers", () => {
  it("a Variance Form is stamped after forty-five seconds and moves the seal out; filing it twice changes nothing", () => {
    const { f, s } = newRun();
    pick(f, s, "foreman", /Variance Form/);
    expect(notices(f).join(" ")).toMatch(/Variance Form is filed/);
    run(f, s, 50);
    expect(notices(f).join(" ")).toMatch(/is stamped/);
    pick(f, s, "foreman", /Variance Form/);
    run(f, s, 150);
    expect(f.commits, "the stamp bought time past the plain schedule").toHaveLength(0);
    run(f, s, 200);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: expect.stringMatching(/^(sealed|consecrated)$/) });
  });

  it("asking the foreman reveals the seal time in the hint; asking the Guild reveals the air clock", () => {
    const { f, s } = newRun();
    expect(lastView(f).hint).not.toMatch(/seals at/);
    pick(f, s, "foreman", /Ask when the schedule/);
    choose(f, s, /handling charge/);
    // (round two: the price may have moved)
    expect(lastView(f).hint).toMatch(/seals at \d+ seconds/);
    pick(f, s, "dirge-master", /Ask what the Guild knows/);
    expect(lastParley(f, "p1")!.view).toBeDefined();
    s.onParleyClose("p1");
    expect(lastView(f).hint).toMatch(/choir arrives at the end of the air/);
  });

  it("the Guild's vigil buys air once; the objection stays a seal the foreman meant, but only once the Guild has been asked what it knows", () => {
    const { f, s } = newRun();
    pick(f, s, "foreman", /handling charge/);       // the schedule is not the point of this test
    pick(f, s, "dirge-master", /Propose a vigil/);
    run(f, s, 505);
    expect(f.commits, "420-460 s of air plus the 90 s of vigil").toHaveLength(0);
    run(f, s, 70);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "consecrated" });
    expect(f.commits[0]!.seconds).toBeGreaterThanOrEqual(510);
    // the objection without being told: the option is not even on the table in round one
    const g = newRun();
    pick(g.f, g.s, "dirge-master", /Ask what the Guild knows/);
    const v = lastParley(g.f, "p1")!.view!;
    expect(labelIndex(v, /Tell him the Company means to seal/)).toBeGreaterThanOrEqual(0);
    g.s.onPick("p1", labelIndex(v, /Tell him the Company means to seal/));
    expect(notices(g.f).join(" ")).toMatch(/restraint of mourning/);
  });

  it("a purse too small re-issues the round and charges nothing", () => {
    const { f, s } = newRun(4);
    pick(f, s, "foreman", /handling charge/);
    expect(lastParley(f, "p1")!.view, "the round is re-issued").toBeDefined();
    run(f, s, 260);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "sealed", paid: 0 });
    const g = newRun(4);
    pick(g.f, g.s, "dirge-master", /Settle the Guild's bill/);
    expect(g.f.commits).toHaveLength(0);
  });
});

describe("blood in the yard", () => {
  it("a shot at the foreman is a declaration: he and the choir run, the parley closes, nothing commits yet", () => {
    const { f, s } = newRun();
    beside(f, "p1", "foreman");
    press(f, s);
    expect(lastParley(f, "p1")!.view).toBeDefined();
    s.onDamage(npcKey("foreman"), "p1", 1, false);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.cast.groupOrders("foreman")).toContain("flee");
    expect(f.cast.groupOrders("guild")).toContain("flee");
    expect(lastView(f).phase).toBe("fighting");
    expect(f.commits).toEqual([]);
    // a hostile foreman is not to be talked to
    beside(f, "p1", "foreman");
    expect(press(f, s)).toBe(true);
    expect(lastParley(f, "p1")!.closed).toBe(true);
  });

  it("a dead foreman files no seals: the schedule never closes, the air does, and a broken promise is on the record", () => {
    const { f, s } = newRun();
    beside(f, "p1", "foreman");
    press(f, s);   // the promise: a parley was open when it turned
    s.onDamage(npcKey("foreman"), "p1", 1, true);
    down(f, npcKey("foreman"));
    run(f, s, 330);
    expect(f.commits, "no whistle").toHaveLength(0);
    run(f, s, 200);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "consecrated", brokePromise: true });
    expect(f.commits[0]!.tally.garrisonKilled).toBe(1);
  });
});

describe("leave: the room calls it before dispose", () => {
  it("commits nothing when nothing happened; the seal once something did; the Guild's consecration when the schedule had been bought; the blast when the keg was set", () => {
    const a = newRun();
    a.s.leave();
    expect(a.f.commits).toEqual([]);

    const b = newRun();
    shore(b.f, b.s);
    b.s.leave();
    expect(b.f.commits).toHaveLength(1);
    expect(b.f.commits[0]).toMatchObject({ resolution: "sealed", region: "vesper" });

    const c = newRun();
    pick(c.f, c.s, "foreman", /handling charge/);
    c.s.leave();
    expect(c.f.commits).toHaveLength(1);
    expect(c.f.commits[0]).toMatchObject({ resolution: "consecrated" });

    const d = newRun();
    carry(d.f, d.s, PropKind.BARREL, 0);
    d.s.leave();
    expect(d.f.commits).toHaveLength(1);
    expect(d.f.commits[0]).toMatchObject({ resolution: "blasted_through" });
  });
});

describe("hostile input at every entry point", () => {
  it("forged INTERACT (out of range, from an NPC key, from the downed, with a garbage or wrong carried id) is not taken, and nothing commits", () => {
    const f = fake();
    const s = setup(f, "mine_rescue", row("p1", 0, 118), row("p2", 3, 118));
    run(f, s, 1);
    expect(press(f, s), "far from everything").toBe(false);
    expect(s.onInteract("npc:foreman", me(f, "p1"))).toBe(false);
    expect(s.onInteract("p1", undefined as never)).toBe(false);
    down(f, "p2");
    expect(s.onInteract("p2", me(f, "p2"))).toBe(false);
    // at the fall: carrying but with nothing real in the hands, with a made-up id, with the wrong kind of prop
    put(f, "p1", FALL.x, FALL.z + 1.5);
    f.props.set("rug", { kind: PropKind.CHAIR, x: 0, z: 0 });
    me(f).flags |= FLAG.CARRYING;
    for (const id of ["nobody", "__proto__", "", undefined, "rug"]) expect(press(f, s, "p1", id), `carrying ${String(id)}`).toBe(false);
    expect(f.consumed).toEqual([]);
    expect(f.blasts).toEqual([]);
    // a barrel id without the CARRYING flag does not light a fuse (it is just an empty-handed shovel press)
    me(f).flags &= ~FLAG.CARRYING;
    f.props.set("kegX", { kind: PropKind.BARREL, x: 0, z: 0 });
    press(f, s, "p1", "kegX");
    run(f, s, 10);
    expect(f.blasts).toEqual([]);
    expect(f.consumed).toEqual([]);
    expect(f.commits).toEqual([]);
    s.dispose();
    expect(s.onInteract("p1", me(f), undefined)).toBe(false);
  });

  it("forged pressing: a hundred shovel-presses in one instant dig one press; the timber is not consumed past three sets", () => {
    const { f, s } = newRun();
    put(f, "p1", FALL.x, FALL.z + 1.5);
    for (let i = 0; i < 100; i++) press(f, s);
    expect(objective(f, "dig")).toMatch(/\(2%\)/);
    shore(f, s);
    expect(carry(f, s, PropKind.CRATE, 3), "a fourth set is a taken press that changes nothing").toBe(true);
    expect(f.consumed, "the runner consumes only what the machine accepted").toEqual(["timber0", "timber1", "timber2"]);
    expect(f.commits).toEqual([]);
  });

  it("onPick and onParleyClose with no parley, from a non-owner, with garbage options, or after the end do nothing", () => {
    const f = fake();
    const s = setup(f, "mine_rescue", row("p1", VESPER_SITES.foreman.x + 3, VESPER_SITES.foreman.z), row("p2", VESPER_SITES.foreman.x + 5, VESPER_SITES.foreman.z));
    for (const o of [0, 1, -1, 1.5, NaN, Infinity, "x" as never, undefined as never]) { s.onPick("p1", o); s.onPick("p2", o); }
    s.onParleyClose("p1");
    s.onParleyClose("nobody");
    expect(f.commits).toEqual([]);
    beside(f, "p1", "foreman");
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
    beside(f, "p2", "foreman", -0.8);
    expect(press(f, s, "p2")).toBe(true);   // taken, but no second parley is opened
    expect(lastParley(f, "p2")).toBeUndefined();
    // a wandering player's parley closes by the leash
    put(f, "p1", VESPER_SITES.foreman.x + 40, VESPER_SITES.foreman.z);
    run(f, s, 1);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.commits).toEqual([]);
    // after the end: nothing
    down(f, "p1");
    down(f, "p2");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    s.onPick("p1", 0);
    s.onNoise(0, 0, 100, "p1");
    s.onProp("destroyed", "x");
    s.onDamage(npcKey("foreman"), "p1", 1, true);
    expect(press(f, s)).toBe(false);
    expect(f.commits).toHaveLength(1);
  });

  it("a flood of forged inputs (600 sequences) never reaches an ending a client could not earn, never throws, never commits twice", () => {
    let seed = 0x5eed;
    const rnd = (): number => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0; return seed / 4294967296; };
    const garbage = [undefined, "", "b1", "npc:foreman", "__proto__", "prop-1", "keg0", "timber0", "rug"];
    const allowed = new Set<string>(TEMPLATE_RESOLUTIONS.mine_rescue);
    for (let i = 0; i < 600; i++) {
      const f = fake({ ...newCampaign(1 + (i % 40)), purse: i % 3 === 0 ? 4 : 400 });
      f.props.set("keg0", { kind: PropKind.BARREL, x: 0, z: 0 });
      f.props.set("timber0", { kind: PropKind.CRATE, x: 0, z: 0 });
      const s = setup(f, "mine_rescue", row("p1", FALL.x, FALL.z + 1.5), row("p2", VESPER_SITES.foreman.x + 1, VESPER_SITES.foreman.z));
      for (let k = 0; k < 14; k++) {
        const who = rnd() < 0.5 ? "p1" : "p2";
        switch (Math.floor(rnd() * 7)) {
          case 0: if (rnd() < 0.4) me(f, who).flags |= FLAG.CARRYING; else me(f, who).flags &= ~FLAG.CARRYING; s.onInteract(who, me(f, who), garbage[Math.floor(rnd() * garbage.length)]); break;
          case 1: s.onPick(who, [0, 1, 2, 3, -1, 1.5, NaN, 99][Math.floor(rnd() * 8)]!); break;
          case 2: s.onParleyClose(who); break;
          case 3: s.onNoise((rnd() - 0.5) * 1e6, (rnd() - 0.5) * 1e6, rnd() * 1e9, who); break;
          case 4: s.onProp("destroyed", garbage[Math.floor(rnd() * garbage.length)] as string); break;
          case 5: put(f, who, rnd() < 0.5 ? FALL.x : VESPER_SITES.foreman.x + 1, rnd() < 0.5 ? FALL.z + 1.5 : VESPER_SITES.foreman.z); break;
          default: s.onDamage(["npc:foreman", "npc:dirge-master", "npc:miner-0", "nobody"][Math.floor(rnd() * 4)]!, who, 1, rnd() < 0.5); break;
        }
        run(f, s, 5 + rnd() * 20);
      }
      expect(f.commits.length, `run ${i}`).toBeLessThanOrEqual(1);
      for (const c of f.commits) {
        expect(allowed.has(c.resolution), `run ${i}: ${c.resolution}`).toBe(true);
        expect(c.region).toBe("vesper");
        expect(c.paid).toBeLessThanOrEqual(400);
      }
      s.dispose();
    }
  }, 120_000);
});

void DT;
