import { describe, expect, it } from "vitest";
import { FLAG, HIGHMARK_SITES, NPC, NPC_CAP, PropKind, newCampaign, npcKey } from "@cb/shared";
import { beside, fake, lastParley, lastView, me, notices, npcKeys, pick, press, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";
import type { Scenario } from "./Scenario.ts";

/**
 * "The Reapers' Strike" (D-042, Highmark's second contract) through the REAL runner on a fake host and a fake Cast: the endings as a client could reach them (a parley option index, the royal
 * bushel carried to the Steward, the barge's men walking into the barley, first blood on them), one commit each. The pure rules are in packages/shared (scenarios/reapersStrike.test.ts); this
 * file judges what the runner observes and carries out, above all the D-042 `prop` gate: the royal bushel is a barrel, but not any barrel.
 */

const S = HIGHMARK_SITES.strike;
const newRun = (purse = 300): { f: Fake; s: Scenario } => {
  const f = fake({ ...newCampaign(11), purse });
  const s = setup(f, "reapers_strike", row("p1", S.foreperson.x + 4, S.foreperson.z + 4));
  run(f, s, 1);
  return { f, s };
};
/** The prop id the runner spawned for the royal bushel (the only barrel the template places). */
const bushelId = (f: Fake): string => [...f.props.entries()].find(([, p]) => p.kind === PropKind.BARREL && p.x === S.scale.x && p.z === S.scale.z)![0];
/** Stands beside the Steward carrying `prop` and presses INTERACT. */
function show(f: Fake, s: Scenario, prop: string, sid = "p1"): boolean {
  me(f, sid).flags |= FLAG.CARRYING;
  beside(f, sid, "steward");
  const taken = press(f, s, sid, prop);
  me(f, sid).flags &= ~FLAG.CARRYING;
  return taken;
}
const objective = (f: Fake, id: string): string => lastView(f).objectives.find((o) => o.id === id)?.text ?? "";
const bargeIn = (f: Fake): number => (lastView(f).endsAtWorldMs - f.clock.ms) / 1000;

describe("the runner: start (The Reapers' Strike)", () => {
  it("spawns the Compact and the Steward at their posts, holds the barge's men back, and sets the royal bushel on the granary scale", () => {
    const { f, s } = newRun();
    expect(s.template).toBe("reapers_strike");
    expect(npcKeys(f).sort()).toEqual(["npc:foreperson", "npc:picket-0", "npc:picket-1", "npc:steward"]);
    expect(f.players.get(npcKey("foreperson"))).toMatchObject(S.foreperson);
    expect(f.players.get(npcKey("steward"))).toMatchObject(S.steward);
    expect((f.players.get(npcKey("steward")) as unknown as { npc: number }).npc).toBe(NPC.CHAMBERLAIN);
    expect(bushelId(f)).toBeDefined();
    expect(lastView(f)).toMatchObject({ template: "reapers_strike", title: "The Reapers' Strike" });
    expect(lastView(f).timerLabel).toMatch(/barge/);
    expect(f.commits).toEqual([]);
  });
});

describe("the endings through the real runner, one commit each", () => {
  it("honest_measure: any other barrel is just a barrel; the royal bushel is the proof, consumed once; then both signatures", () => {
    const { f, s } = newRun();
    // a barrel from the quay is not the royal bushel: the press is not taken and nothing is consumed
    f.props.set("quay-barrel", { kind: PropKind.BARREL, x: 0, z: 110 });
    expect(show(f, s, "quay-barrel")).toBe(false);
    expect(f.consumed).toEqual([]);
    // the Steward will not sign on the party's word
    pick(f, s, "steward", /honest measure/);
    expect(notices(f).join(" ")).toMatch(/On whose evidence/);
    // the royal bushel is
    const id = bushelId(f);
    expect(show(f, s, id)).toBe(true);
    expect(f.consumed).toEqual([id]);
    expect(objective(f, "bushel")).toMatch(/a third too large/);
    show(f, s, id);
    expect(f.consumed, "a second press with the same barrel consumes nothing more").toEqual([id]);
    pick(f, s, "steward", /honest measure/);
    expect(f.commits).toHaveLength(0);
    pick(f, s, "foreperson", /honest measure/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "reapers_strike", resolution: "honest_measure", region: "highmark", paid: 0, brokePromise: false });
    expect(f.cast.groupOrders("late:breakers")).toContain("stand_down");
  });

  it("bought_back: the Foreperson's bonus is paid from the purse and work resumes", () => {
    const { f, s } = newRun();
    pick(f, s, "foreperson", /harvest bonus/);
    expect(lastParley(f, "p1")!.closed).toBe(true);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "bought_back" });
    expect(f.commits[0]!.paid).toBeGreaterThanOrEqual(40);
  });

  it("strike_broken: the barge lands on the clock, its men muster and march, and two of them in the barley break the strike", () => {
    const { f, s } = newRun();
    run(f, s, bargeIn(f) + 1);
    expect(npcKeys(f).filter((k) => k.startsWith("npc:breaker-")).length).toBe(4);
    expect(f.cast.groupOrders("late:breakers")).not.toContain("march");
    expect(lastView(f).timerLabel).toBe("The strike-breakers march");
    run(f, s, bargeIn(f) + 1);
    expect(f.cast.orders).toContainEqual({ group: "late:breakers", order: { o: "march", route: "breakers" } });
    expect(npcKeys(f).length).toBeLessThanOrEqual(NPC_CAP);
    put(f, npcKey("breaker-0"), S.barley.x, S.barley.z);
    run(f, s, 1);
    expect(f.commits).toHaveLength(0);
    put(f, npcKey("breaker-1"), S.barley.x + 2, S.barley.z - 2);
    run(f, s, 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "strike_broken" });
  });

  it("first blood on the barge's men turns them on the party: they no longer break the strike, and the rain ends it", () => {
    const { f, s } = newRun();
    run(f, s, bargeIn(f) + 1);
    s.onDamage(npcKey("breaker-3"), "p1", 1, false);
    expect(lastView(f).timerLabel, "a fought crew never marches: the clock is the rain's").toBe("The rain");
    expect(f.cast.groupOrders("late:breakers")).toContain("alert");
    expect(lastView(f).phase).toBe("fighting");
    for (const i of [0, 1, 2]) put(f, npcKey(`breaker-${i}`), S.barley.x, S.barley.z);
    run(f, s, 2);
    expect(f.commits).toHaveLength(0);
    run(f, s, bargeIn(f) + 1);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "barley_lost" });
    expect(f.commits[0]!.tally.wounded).toBe(1);
  });

  it("the Steward's fee is earned on results: taken, then the bonus paid, the party nets the difference", () => {
    const { f, s } = newRun();
    pick(f, s, "steward", /his fee/);
    pick(f, s, "foreperson", /harvest bonus/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "bought_back" });
    expect(f.commits[0]!.loot).toBeGreaterThanOrEqual(30);
  });
});
