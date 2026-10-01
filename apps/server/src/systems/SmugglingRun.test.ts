import { describe, expect, it } from "vitest";
import { FLAG, PropKind, SALTMARKET_ANCHORS, SALTMARKET_SITES, SALTMARKET_SPOTS, TEMPLATES, askingToll, newCampaign, npcKey, type CampaignState } from "@cb/shared";
import { Scenario } from "./Scenario.ts";
import { beside, down, fake, labelIndex, lastParley, lastView, me, npcKeys, pick, press, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";

/**
 * "The Quiet Barge" (D-037, package D4) through the REAL Scenario runner on a fake host: one scripted run per ending (commit exactly once, the right resolution, the Saltmarket's region), the courtesy and the lantern as the
 * runner delivers them, and hostile input at every entry point (a forged crate use, a stranger's pick, an option out of range, input after the end). The pure reducer has its own tests in packages/shared.
 */

const S = SALTMARKET_SITES;
const SP = SALTMARKET_SPOTS;
const COVE = SALTMARKET_ANCHORS.cove;
const CARRY = FLAG.GROUNDED | FLAG.CARRYING;
const crateIds = (f: Fake): string[] => [...f.props.entries()].filter(([, p]) => p.kind === PropKind.CRATE).map(([id]) => id);
const start = (c?: CampaignState): { f: Fake; s: Scenario } => {
  const f = c ? fake(c) : fake();
  const s = setup(f, "smuggling_run", row("p1", COVE.x, COVE.z));
  run(f, s, 1);   // the party is at the cove: the barge is loaded
  return { f, s };
};
/** Carries one crate to the drop-house and presses at the door. */
const deliver = (f: Fake, s: Scenario, id: string): boolean => {
  const p = me(f);
  p.flags = CARRY;
  put(f, "p1", SP.dropDoor.x, SP.dropDoor.z);
  return press(f, s, "p1", id);
};
/** Stands within sight of the Constabulary's walking patrol. */
const intoSight = (f: Fake): void => put(f, "p1", S.customs[2]!.x + 5, S.customs[2]!.z);

describe("The Quiet Barge through the runner", () => {
  it("starts with the barge's four crates on the ground, the Reeve and the Customs House's men in place, and nothing committed", () => {
    const f = fake();
    const s = setup(f, "smuggling_run", row("p1", 0, 118));
    expect(crateIds(f)).toHaveLength(4);
    expect(npcKeys(f).length).toBe(7);   // the Reeve, four Constabulary men, two bargemen
    expect(f.players.has(npcKey("reeve"))).toBe(true);
    expect(f.players.has(npcKey("extra-0"))).toBe(false);   // the late patrolman is dealt later
    expect(f.commits).toEqual([]);
    expect(lastView(f).template).toBe("smuggling_run");
    expect(lastView(f).phase).toBe("approach");
    s.dispose();
    expect(npcKeys(f)).toEqual([]);
  });

  it("landed: three crates at the drop-house door, each consumed once, one commit, the cast stands down after the linger", () => {
    const { f, s } = start();
    expect(lastView(f).phase).toBe("extract");
    const ids = crateIds(f);
    for (let i = 0; i < 3; i++) expect(deliver(f, s, ids[i]!), `crate ${i}`).toBe(true);
    expect(f.consumed).toEqual(ids.slice(0, 3));
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "smuggling_run", resolution: "landed", region: "saltmarket", bridge: "intact", toll: 0 });
    expect(s.resolution).toBe("landed");
    run(f, s, 60);
    expect(f.commits).toHaveLength(1);
    expect(f.cast.despawned.length).toBeGreaterThan(0);
  });

  it("impounded: seen by the patrol once the cargo is loaded, and eight seconds without an answer", () => {
    const { f, s } = start();
    intoSight(f);
    run(f, s, 1);
    expect(lastView(f).phase).toBe("standoff");
    expect(f.commits).toEqual([]);
    run(f, s, 10);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "smuggling_run", resolution: "impounded", region: "saltmarket" });
  });

  it("being seen before the barge is loaded is nothing at all", () => {
    const f = fake();
    const s = setup(f, "smuggling_run", row("p1", S.customs[2]!.x + 5, S.customs[2]!.z));
    run(f, s, 30);
    expect(f.commits).toEqual([]);
    expect(lastView(f).phase).not.toBe("standoff");
  });

  it("scuttled: the plug, with empty hands, in reach; the barge goes down with a commit", () => {
    const { f, s } = start();
    put(f, "p1", SP.plug.x + 6, SP.plug.z);
    expect(press(f, s), "too far").toBe(false);
    me(f).flags = CARRY;
    put(f, "p1", SP.plug.x, SP.plug.z);
    expect(press(f, s, "p1", crateIds(f)[0]), "a crate in the hands is not a plug").toBe(false);
    me(f).flags = FLAG.GROUNDED;
    expect(press(f, s)).toBe(true);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "scuttled", region: "saltmarket" });
  });

  it("informed: the Reeve's parley, the pick that informs on one's own barge, a finder's fee and a commit", () => {
    const f = fake();
    const s = setup(f, "smuggling_run", row("p1", S.tideReeve.x, S.tideReeve.z + 1));
    pick(f, s, "reeve", /Inform on your own barge/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "smuggling_run", resolution: "informed", region: "saltmarket" });
    expect(f.commits[0]!.loot).toBeGreaterThan(0);
  });

  it("abandoned: the whole party down after the cargo is loaded", () => {
    const { f, s } = start();
    down(f, "p1");
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "abandoned", region: "saltmarket" });
  });

  it("a declaration (free) is a stamped passage: the patrol that sees you afterwards does not impound the barge; without one it does", () => {
    const { f, s } = start();
    me(f).x = S.tideReeve.x;
    pick(f, s, "reeve", /Declare the barge/);
    expect(f.commits).toEqual([]);
    intoSight(f);
    run(f, s, 20);
    expect(f.commits, "waved through").toEqual([]);
  });

  it("a courtesy is paid from the purse and honoured; with a purse that cannot cover it the same pick buys nothing", () => {
    const rich = start();
    pick(rich.f, rich.s, "reeve", /courtesy/);
    intoSight(rich.f);
    run(rich.f, rich.s, 20);
    expect(rich.f.commits, "a stamped passage").toEqual([]);
    const poor = start({ ...newCampaign(11), purse: 3 });
    beside(poor.f, "p1", "reeve");
    expect(press(poor.f, poor.s)).toBe(true);
    const v = lastParley(poor.f, "p1")!.view!;
    const i = labelIndex(v, /courtesy/);
    expect(i).toBeGreaterThanOrEqual(0);
    poor.s.onPick("p1", i);
    poor.s.onParleyClose("p1");
    intoSight(poor.f);
    run(poor.f, poor.s, 12);
    expect(poor.f.commits.map((c) => c.resolution), "no stamp bought").toEqual(["impounded"]);
  });

  it("the lantern: a press at the post with empty hands draws the patrol off, so being seen by them does not start a challenge", () => {
    const { f, s } = start();
    put(f, "p1", SP.lantern.x, SP.lantern.z);
    expect(press(f, s)).toBe(true);
    intoSight(f);
    run(f, s, 12);
    expect(f.commits, "they are looking at a lantern").toEqual([]);
    expect(f.cast.groupOrders("patrol")).toContain("march");
  });

  it("the Ward's patrolman is dealt after ninety seconds, and only when the day's complication says so", () => {
    const dealt = (want: boolean): CampaignState => {
      for (let day = 1; day < 400; day++) {
        const c = { ...newCampaign(11), day, purse: 400 };   // (the complication is dealt from the seed and the day)
        if ((TEMPLATES.smuggling_run.init(c, askingToll(c), 424242) as unknown as { complication: string }).complication === "ward_patrol" === want) return c;
      }
      throw new Error("no such campaign");
    };
    for (const want of [true, false]) {
      const f = fake(dealt(want));
      const s = setup(f, "smuggling_run", row("p1", 0, 118));
      run(f, s, 80);
      expect(f.players.has(npcKey("extra-0")), "not yet").toBe(false);
      run(f, s, 30);
      expect(f.players.has(npcKey("extra-0")), want ? "dealt" : "not dealt").toBe(want);
    }
  });

  it("leave: nothing happened commits nothing; a loaded barge sailed away from is abandoned, one with a crate already carried is impounded; leaving twice commits once", () => {
    const quiet = fake();
    const sq = setup(quiet, "smuggling_run", row("p1", 0, 118));
    sq.leave();
    expect(quiet.commits).toEqual([]);
    const idle = start();
    idle.s.leave();
    idle.s.leave();
    expect(idle.f.commits.map((c) => c.resolution)).toEqual(["abandoned"]);
    const { f, s } = start();
    expect(deliver(f, s, crateIds(f)[0]!)).toBe(true);
    s.leave();
    s.leave();
    expect(f.commits.map((c) => c.resolution)).toEqual(["impounded"]);
  });

  it("violence raises the alarm; a landing under it is not a quiet one", () => {
    const { f, s } = start();
    s.onDamage(npcKey("patrol-0"), "p1", 0, true);
    expect(lastView(f).phase).toBe("fighting");
    const ids = crateIds(f);
    for (let i = 0; i < 3; i++) deliver(f, s, ids[i]!);
    run(f, s, 40);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]!.resolution).not.toBe("landed");
  });
});

describe("The Quiet Barge: hostile input at every entry point", () => {
  it("INTERACT out of range, from an NPC key, from the downed, with the wrong thing in hand, or with a forged prop id: not taken, nothing committed", () => {
    const { f, s } = start();
    const ids = crateIds(f);
    put(f, "p1", 0, 118);
    expect(press(f, s, "p1", ids[0])).toBe(false);
    me(f).flags = CARRY;
    put(f, "p1", SP.dropDoor.x + 9, SP.dropDoor.z);
    expect(press(f, s, "p1", ids[0]), "too far from the door").toBe(false);
    put(f, "p1", SP.dropDoor.x, SP.dropDoor.z);
    expect(s.onInteract("npc:reeve", me(f), ids[0]), "an NPC key").toBe(false);
    f.props.set("barrel", { kind: PropKind.BARREL, x: SP.dropDoor.x, z: SP.dropDoor.z });
    expect(press(f, s, "p1", "barrel"), "a barrel is not cargo").toBe(false);
    expect(press(f, s, "p1", "nonsense"), "a prop that does not exist").toBe(false);
    expect(press(f, s, "p1", undefined), "carrying nothing the server knows").toBe(false);
    me(f).flags = CARRY | FLAG.DOWNED;
    expect(press(f, s, "p1", ids[0]), "the downed").toBe(false);
    expect(f.consumed).toEqual([]);
    expect(f.commits).toEqual([]);
    // the one honest press consumes the crate once
    me(f).flags = CARRY;
    expect(press(f, s, "p1", ids[0])).toBe(true);
    expect(f.consumed).toEqual([ids[0]]);
  });

  it("onPick and onParleyClose with no parley, from a stranger, with garbage options, or after the end do nothing", () => {
    const f = fake();
    const s = setup(f, "smuggling_run", row("p1", S.tideReeve.x, S.tideReeve.z + 1), row("p2", S.tideReeve.x + 2, S.tideReeve.z + 1));
    s.onPick("p1", 0);
    s.onParleyClose("p1");
    expect(f.commits).toEqual([]);
    beside(f, "p1", "reeve");
    expect(press(f, s, "p1")).toBe(true);
    const v = lastParley(f, "p1")!.view!;
    const tell = labelIndex(v, /Inform/);
    s.onPick("p2", tell);   // not the owner
    for (const bad of [-1, 99, 1.5, NaN, Infinity, "0" as unknown as number, null as unknown as number, undefined as unknown as number]) s.onPick("p1", bad);
    expect(f.commits, "no garbage option is a pick").toEqual([]);
    // a second member cannot talk over the first
    beside(f, "p2", "reeve");
    expect(press(f, s, "p2")).toBe(true);
    expect(lastParley(f, "p2")?.view).toBeUndefined();
    s.onPick("p1", tell);
    expect(f.commits).toHaveLength(1);
    // after the end: everything is ignored
    s.onPick("p1", 0);
    s.onParleyClose("p1");
    expect(press(f, s, "p1")).toBe(false);
    s.onDamage(npcKey("patrol-0"), "p1", 0, true);
    s.onNoise(S.tideReeve.x, S.tideReeve.z, 50, "p1");
    s.onProp("destroyed", "prop-1");
    run(f, s, 120);
    s.leave();
    expect(f.commits).toHaveLength(1);
  });

  it("a flood of forged inputs never reaches an ending a client could not earn", () => {
    const { f, s } = start();
    const pts = [COVE, SP.dropDoor, SP.plug, SP.lantern, S.tideReeve, { x: 0, z: 118 }];
    for (let i = 0; i < 3000; i++) {
      const p = pts[i % pts.length]!;
      put(f, "p1", p.x + ((i * 7) % 3) - 1, p.z);
      me(f).flags = i % 2 === 0 ? FLAG.GROUNDED : CARRY;
      // never a real crate, never an empty-handed press at the plug: forged props only
      if (!(p === SP.plug && i % 2 === 0)) s.onInteract("p1", me(f), i % 3 === 0 ? undefined : `forged-${i}`);
      s.onPick("p1", (i % 9) - 2);
      if (i % 40 === 0) run(f, s, 0.25);
    }
    expect(f.consumed).toEqual([]);
    expect(f.commits.map((c) => c.resolution).filter((r) => r === "landed")).toEqual([]);
    expect(f.commits.length).toBeLessThanOrEqual(1);
    expect(TEMPLATES.smuggling_run.id).toBe("smuggling_run");
  });
});
