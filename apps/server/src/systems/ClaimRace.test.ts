import { describe, expect, it } from "vitest";
import { FLAG, NPC, NPC_CAP, PropKind, RESOLVED_LINGER_S, TEMPLATE_RESOLUTIONS, VESPER_ANCHORS, VESPER_SITES, applyOutcome, newCampaign, npcKey } from "@cb/shared";
import { beside, down, fake, labelIndex, lastParley, lastView, me, notices, npcKeys, pick, press, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";
import type { Scenario } from "./Scenario.ts";

/**
 * "The Claim Race" (D-037, Vesper Gorge, package C3) through the REAL runner on a fake host and a fake Cast: the four endings (and the party-down abandonment) as a client could reach them (INTERACT at
 * a peg, a parley option index with the clerk, the cast's counts), one commit each, and hostile input at every entry point. The pure rules are in packages/shared (scenarios/claimRace.test.ts).
 * No server source is touched by package C3.
 */

const PEGS = VESPER_SITES.claimPegs;
const GROUND = VESPER_ANCHORS.pegging;
const newRun = (purse = 400): { f: Fake; s: Scenario } => {
  const f = fake({ ...newCampaign(11), purse });
  const s = setup(f, "claim_race", row("p1", GROUND.x + 4, GROUND.z + 4));
  run(f, s, 1);
  return { f, s };
};
const SURVEYORS = ["npc:surveyor-0", "npc:surveyor-1"] as const;
/** Stakes peg `i` (INTERACT with empty hands beside it). */
function stake(f: Fake, s: Scenario, i: number, sid = "p1"): boolean {
  put(f, sid, PEGS[i]!.x + 1, PEGS[i]!.z);
  return press(f, s, sid);
}
const objective = (f: Fake, id: string): string => lastView(f).objectives.find((o) => o.id === id)?.text ?? "";
const pegsMine = (f: Fake): number => lastView(f).objectives.filter((o) => /^peg-/.test(o.id) && o.done).length;
/** Breaks the Syndicate's surveyors: both are shot and down, the way the room reports it. */
function breakSurveyors(f: Fake, s: Scenario): void {
  for (const k of SURVEYORS) { s.onDamage(k, "p1", 1, true); down(f, k); }
  run(f, s, 1);
}
function choose(f: Fake, s: Scenario, re: RegExp, sid = "p1"): void {
  const v = lastParley(f, sid)!.view!;
  const i = labelIndex(v, re);
  expect(i, `${re} among ${v.options.map((o) => o.label).join(" | ")}`).toBeGreaterThanOrEqual(0);
  s.onPick(sid, i);
}

describe("the runner: start, publish, dispose (The Claim Race)", () => {
  it("spawns the clerk, two surveyors and four guards within the cast cap, starts unresolved, and publishes the Vesper view", () => {
    const { f, s } = newRun();
    expect(npcKeys(f).length).toBe(7);
    expect(npcKeys(f).length).toBeLessThanOrEqual(NPC_CAP);
    expect(f.commits).toEqual([]);
    expect(lastView(f)).toMatchObject({ template: "claim_race", title: "The Claim Race" });
    expect(lastView(f).resolution).toBeUndefined();
    expect(s.template).toBe("claim_race");
    const roles = new Set([...f.players.values()].map((r) => (r as unknown as { npc?: number }).npc));
    for (const r of [NPC.CHAMBERLAIN, NPC.RIVAL_SURVEYOR, NPC.RIVAL_GUARD]) expect(roles.has(r), `role ${r}`).toBe(true);
    s.dispose();
    expect(npcKeys(f)).toEqual([]);
  });

  it("the people stand where Vesper's plan puts them", () => {
    const { f } = newRun();
    const at = (id: string): { x: number; z: number } => f.players.get(npcKey(id))!;
    expect(at("assayer")).toMatchObject(VESPER_SITES.assayer);
    VESPER_SITES.rivalSurveyors.forEach((p, i) => expect(at(`surveyor-${i}`)).toMatchObject(p));
    VESPER_SITES.guards.forEach((p, i) => expect(at(`guard-${i}`)).toMatchObject(p));
  });
});

describe("the four endings through the real runner, one commit each", () => {
  it("staked: three pegs before the Syndicate drives one, the fee paid at the clerk's counter", () => {
    const { f, s } = newRun();
    for (const i of [0, 1, 2]) expect(stake(f, s, i), `peg ${i}`).toBe(true);
    expect(pegsMine(f)).toBe(3);
    expect(f.commits).toHaveLength(0);
    pick(f, s, "assayer", /File the claim/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "claim_race", resolution: "staked", region: "vesper", toll: 0, bridge: "intact", brokePromise: false });
    expect(f.commits[0]!.paid).toBeGreaterThanOrEqual(30 * 0.75);
    expect(f.commits[0]!.paid).toBeLessThanOrEqual(60 * 1.25);
    expect(lastView(f).resolution).toBe("staked");
    run(f, s, RESOLVED_LINGER_S + 2);
    expect(f.commits, "one commit, whatever happens after").toHaveLength(1);
    expect(npcKeys(f), "the bench is despawned after the linger").toEqual([]);
  });

  it("the clerk will not file on fewer than three pegs, and takes nothing for it", () => {
    const { f, s } = newRun();
    stake(f, s, 0);
    stake(f, s, 1);
    pick(f, s, "assayer", /File the claim/);
    expect(f.commits).toHaveLength(0);
    expect(notices(f).join(" ")).toMatch(/A claim wants 3 pegs/);
    stake(f, s, 2);
    pick(f, s, "assayer", /File the claim/);
    expect(f.commits[0]).toMatchObject({ resolution: "staked" });
  });

  it("jumped: the Syndicate drives a peg, the surveyors are broken, their peg comes out and the claim is filed", () => {
    const { f, s } = newRun();
    stake(f, s, 2);
    run(f, s, 110);                       // the Syndicate pegs the lowest open corner
    expect(objective(f, "peg-0")).toMatch(/is the Syndicate's$/);
    // before the surveyors are broken their peg stays in the ground
    stake(f, s, 0);
    expect(objective(f, "peg-0")).toMatch(/is the Syndicate's$/);
    breakSurveyors(f, s);
    expect(lastView(f).phase).toBe("fighting");
    expect(objective(f, "peg-0")).toMatch(/^Pull the Syndicate's peg/);
    expect(stake(f, s, 0), "the peg comes out").toBe(true);
    expect(objective(f, "peg-0")).toMatch(/^Peg the north-west corner \(Use\)$/);
    for (const i of [0, 1, 3]) stake(f, s, i);
    expect(pegsMine(f)).toBe(4);
    pick(f, s, "assayer", /File the claim/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "jumped", region: "vesper" });
    expect(f.commits[0]!.tally.rivalKilled).toBe(2);
  });

  it("jumped by fraud: the clerk is told the survey is unsound (after asking), stamps it PROVISIONAL, and their pegs come out without a shot", () => {
    const { f, s } = newRun();
    stake(f, s, 2);
    run(f, s, 110);
    pick(f, s, "assayer", /Ask what the Syndicate has filed/);
    choose(f, s, /Tell him the Syndicate's chain is short/);
    expect(notices(f).join(" ")).toMatch(/PROVISIONAL/);
    expect(lastView(f).objectives.map((o) => o.id)).toContain("provisional");
    for (const i of [0, 1, 3]) expect(stake(f, s, i), `peg ${i}`).toBe(true);
    pick(f, s, "assayer", /File the claim/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "jumped", brokePromise: false });
    expect(f.commits[0]!.tally.rivalKilled).toBe(0);
  });

  it("the Syndicate cannot file on a PROVISIONAL survey however many pegs it holds", () => {
    const { f, s } = newRun();
    pick(f, s, "assayer", /Ask what the Syndicate has filed/);
    choose(f, s, /Tell him the Syndicate's chain is short/);
    run(f, s, 320);
    expect(f.commits, "nobody files; the House closes at 330 s").toHaveLength(0);
    run(f, s, 20);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "outpaced" });
  });

  it("partnered: a peg each and the peace kept, and the Guild certifies the joint claim", () => {
    const { f, s } = newRun();
    stake(f, s, 2);
    pick(f, s, "assayer", /Propose a joint claim/);
    expect(f.commits, "joint with whom? the Syndicate has not driven a peg").toHaveLength(0);
    run(f, s, 110);
    pick(f, s, "assayer", /Propose a joint claim/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "partnered", region: "vesper", paid: 0, brokePromise: false });
    expect(f.commits[0]!.tally).toMatchObject({ wounded: 0, downed: 0, rivalKilled: 0 });
  });

  it("no joint claim after a shot: the clerk has been shot at in that chair", () => {
    const { f, s } = newRun();
    stake(f, s, 2);
    run(f, s, 110);
    s.onDamage(SURVEYORS[0], "p1", 1, false);
    pick(f, s, "assayer", /Propose a joint claim/);
    expect(f.commits).toHaveLength(0);
    expect(notices(f).join(" ")).toMatch(/I am not in the mood/);
  });

  it("outpaced: the Syndicate pegs three corners and files first", () => {
    const { f, s } = newRun();
    run(f, s, 300);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "outpaced", region: "vesper", paid: 0 });
    expect(f.commits[0]!.seconds).toBeLessThan(300);
    expect(lastView(f).resolution).toBe("outpaced");
  });

  it("outpaced: the House closes on a gorge where nobody filed (the Syndicate's pegs are broken by force and nobody is quick)", () => {
    const { f, s } = newRun();
    breakSurveyors(f, s);
    run(f, s, 300);
    expect(f.commits, "no surveyor stands to drive a peg, so nobody has three").toHaveLength(0);
    run(f, s, 40);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "outpaced" });
    expect(f.commits[0]!.seconds).toBeGreaterThanOrEqual(330);
  });

  it("abandoned: the whole party down", () => {
    const { f, s } = newRun();
    down(f, "p1");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "abandoned", region: "vesper" });
  });

  it("every outcome the runner commits is one of the template's declared resolutions and applies cleanly to the ledger", () => {
    const allowed = new Set<string>(TEMPLATE_RESOLUTIONS.claim_race);
    for (const k of ["staked", "outpaced", "partnered", "jumped"] as const) {
      const { f, s } = newRun();
      stake(f, s, 2);
      if (k === "staked") { stake(f, s, 0); stake(f, s, 1); pick(f, s, "assayer", /File the claim/); }
      if (k === "outpaced") run(f, s, 340);
      if (k === "partnered") { run(f, s, 110); pick(f, s, "assayer", /Propose a joint claim/); }
      if (k === "jumped") { run(f, s, 110); breakSurveyors(f, s); for (const i of [0, 0, 1]) stake(f, s, i); pick(f, s, "assayer", /File the claim/); }
      expect(f.commits, k).toHaveLength(1);
      expect(f.commits[0]!.resolution, k).toBe(k);
      expect(allowed.has(f.commits[0]!.resolution), k).toBe(true);
      const c = applyOutcome(newCampaign(11), f.commits[0]!);
      expect(c.history.at(-1), k).toMatchObject({ region: "vesper", template: "claim_race" });
      expect(c.sites.ends.claim_race, k).toBe(k);
      expect(c.crossing, "Kessar's crossing is not Vesper's business").toEqual(newCampaign(11).crossing);
    }
  });
});

describe("a shot on the pegging ground", () => {
  it("is a declaration: the surveyors run, the guards are alerted, the parley closes and a promise broken mid-parley is on the record", () => {
    const { f, s } = newRun();
    beside(f, "p1", "assayer");
    press(f, s);
    expect(lastParley(f, "p1")!.view).toBeDefined();
    s.onDamage(npcKey("guard-0"), "p1", 1, false);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.cast.groupOrders("surveyors")).toContain("flee");
    expect(f.cast.groupOrders("guards")).toContain("alert");
    expect(lastView(f).phase).toBe("fighting");
    expect(f.commits).toEqual([]);
    run(f, s, 340);
    expect(f.commits[0]).toMatchObject({ resolution: "outpaced", brokePromise: true });
  });

  it("a shot at the clerk himself is not a declaration against the Syndicate, and a downed clerk cannot be dealt with", () => {
    const { f, s } = newRun();
    s.onDamage(npcKey("assayer"), "p1", 1, true);
    down(f, npcKey("assayer"));
    run(f, s, 1);
    expect(lastView(f).phase).not.toBe("fighting");
    beside(f, "p1", "assayer");
    expect(press(f, s), "nobody home").toBe(false);
    expect(f.commits).toEqual([]);
  });
});

describe("leave: the room calls it before dispose", () => {
  it("commits nothing when nothing happened; outpaced once something did", () => {
    const a = newRun();
    a.s.leave();
    expect(a.f.commits).toEqual([]);
    const b = newRun();
    stake(b.f, b.s, 0);
    b.s.leave();
    expect(b.f.commits).toHaveLength(1);
    expect(b.f.commits[0]).toMatchObject({ resolution: "outpaced", region: "vesper" });
    const c = newRun();
    pick(c.f, c.s, "assayer", /Ask what the Syndicate has filed/);
    c.s.leave();
    expect(c.f.commits).toHaveLength(1);
    expect(c.f.commits[0]).toMatchObject({ resolution: "outpaced" });
  });
});

describe("hostile input at every entry point", () => {
  it("forged INTERACT (out of range, from an NPC key, from the downed, from afar at a peg) is not taken, and nothing commits", () => {
    const f = fake();
    const s = setup(f, "claim_race", row("p1", 0, 118), row("p2", 3, 118));
    run(f, s, 1);
    expect(press(f, s), "far from everything").toBe(false);
    expect(s.onInteract("npc:assayer", me(f, "p1"))).toBe(false);
    expect(s.onInteract("p1", undefined as never)).toBe(false);
    down(f, "p2");
    expect(s.onInteract("p2", me(f, "p2"))).toBe(false);
    put(f, "p1", PEGS[0]!.x + 6, PEGS[0]!.z);
    expect(press(f, s), "a peg out of reach").toBe(false);
    // carrying a crate you cannot stake with: a peg press with something in the hands is not taken
    f.props.set("crate-1", { kind: PropKind.CRATE, x: 0, z: 0 });
    put(f, "p1", PEGS[0]!.x + 1, PEGS[0]!.z);
    me(f).flags |= FLAG.CARRYING;
    expect(press(f, s, "p1", "crate-1")).toBe(false);
    expect(f.consumed).toEqual([]);
    expect(f.commits).toEqual([]);
    s.dispose();
    expect(s.onInteract("p1", me(f), undefined)).toBe(false);
  });

  it("the Syndicate's peg stays in the ground against a press while their surveyors stand; a peg you hold is a taken press that changes nothing", () => {
    const { f, s } = newRun();
    stake(f, s, 2);
    run(f, s, 110);
    expect(stake(f, s, 0), "taken (it is a conversation with a surveyor)").toBe(true);
    expect(objective(f, "peg-0")).toMatch(/is the Syndicate's$/);
    expect(stake(f, s, 2)).toBe(true);
    expect(pegsMine(f)).toBe(1);
    expect(notices(f).join(" ")).toMatch(/already yours/);
    expect(f.commits).toEqual([]);
  });

  it("onPick and onParleyClose with no parley, from a non-owner, with garbage options, or after the end do nothing", () => {
    const f = fake();
    const s = setup(f, "claim_race", row("p1", VESPER_SITES.assayer.x + 3, VESPER_SITES.assayer.z), row("p2", VESPER_SITES.assayer.x + 5, VESPER_SITES.assayer.z));
    for (const o of [0, 1, -1, 1.5, NaN, Infinity, "x" as never, undefined as never]) { s.onPick("p1", o); s.onPick("p2", o); }
    s.onParleyClose("p1");
    s.onParleyClose("nobody");
    expect(f.commits).toEqual([]);
    beside(f, "p1", "assayer");
    expect(press(f, s)).toBe(true);
    const v = lastParley(f, "p1")!.view!;
    expect(v.options.length).toBeGreaterThanOrEqual(4);
    const sent = f.sent.length;
    s.onPick("p2", 0);
    s.onParleyClose("p2");
    s.onPick("p1", v.options.length);
    s.onPick("p1", -1);
    s.onPick("p1", 1.5);
    s.onPick("p1", NaN);
    expect(f.sent.length, "nothing was sent for a non-owner or an out-of-range pick").toBe(sent);
    beside(f, "p2", "assayer", -0.8);
    expect(press(f, s, "p2")).toBe(true);
    expect(lastParley(f, "p2")).toBeUndefined();
    put(f, "p1", VESPER_SITES.assayer.x + 40, VESPER_SITES.assayer.z);
    run(f, s, 1);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.commits).toEqual([]);
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

  it("a forged `pay` with a purse too small re-issues the round and files nothing", () => {
    const { f, s } = newRun(4);
    for (const i of [0, 1, 2]) stake(f, s, i);
    pick(f, s, "assayer", /File the claim/);
    expect(lastParley(f, "p1")!.view, "the round is re-issued").toBeDefined();
    expect(f.commits).toHaveLength(0);
  });

  it("a flood of forged inputs (600 sequences) never reaches an ending a client could not earn, never throws, never commits twice", () => {
    let seed = 0xc1a1;
    const rnd = (): number => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0; return seed / 4294967296; };
    const garbage = [undefined, "", "b1", "npc:assayer", "__proto__", "prop-1", "crate-1"];
    const allowed = new Set<string>(TEMPLATE_RESOLUTIONS.claim_race);
    for (let i = 0; i < 600; i++) {
      const f = fake({ ...newCampaign(1 + (i % 40)), purse: i % 3 === 0 ? 4 : 400 });
      f.props.set("crate-1", { kind: PropKind.CRATE, x: 0, z: 0 });
      const s = setup(f, "claim_race", row("p1", GROUND.x, GROUND.z), row("p2", VESPER_SITES.assayer.x + 1, VESPER_SITES.assayer.z));
      for (let k = 0; k < 14; k++) {
        const who = rnd() < 0.5 ? "p1" : "p2";
        switch (Math.floor(rnd() * 7)) {
          case 0: if (rnd() < 0.3) me(f, who).flags |= FLAG.CARRYING; else me(f, who).flags &= ~FLAG.CARRYING; s.onInteract(who, me(f, who), garbage[Math.floor(rnd() * garbage.length)]); break;
          case 1: s.onPick(who, [0, 1, 2, 3, -1, 1.5, NaN, 99][Math.floor(rnd() * 8)]!); break;
          case 2: s.onParleyClose(who); break;
          case 3: s.onNoise((rnd() - 0.5) * 1e6, (rnd() - 0.5) * 1e6, rnd() * 1e9, who); break;
          case 4: { const p = rnd() < 0.5 ? PEGS[Math.floor(rnd() * 4)]! : VESPER_SITES.assayer; put(f, who, p.x + 1, p.z); break; }
          case 5: s.onProp("destroyed", garbage[Math.floor(rnd() * garbage.length)] as string); break;
          default: s.onDamage(["npc:surveyor-0", "npc:guard-1", "npc:assayer", "nobody"][Math.floor(rnd() * 4)]!, who, 1, rnd() < 0.5); break;
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
