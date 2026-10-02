import { describe, expect, it } from "vitest";
import { FLAG, PropKind, VESPER_SITES, newCampaign, npcKey } from "@cb/shared";
import { fake, lastView, me, npcKeys, pick, press, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";
import type { Scenario } from "./Scenario.ts";

/**
 * "The Winding Engine" (D-044, Vesper Gorge's third contract) through the REAL runner on a fake host and a fake Cast: the endings as a client could reach them (a crate or a keg carried to the
 * boiler's feed, a parley option index, the clock), one commit each. The pure rules are in packages/shared (scenarios/windingEngine.test.ts).
 */

const E = VESPER_SITES.engine;
const newRun = (purse = 300): { f: Fake; s: Scenario } => {
  const f = fake({ ...newCampaign(11), purse });
  const s = setup(f, "winding_engine", row("p1", E.yard.x + 30, E.yard.z));   // (off the terrace, out of the guards' sight)
  run(f, s, 1);
  return { f, s };
};
/** Stands at the boiler's feed carrying a prop of `kind` and presses INTERACT. */
function carryIn(f: Fake, s: Scenario, kind: number, id: string): boolean {
  f.props.set(id, { kind, x: 0, z: 0 });
  me(f).flags |= FLAG.CARRYING;
  put(f, "p1", E.boiler.x - 1, E.boiler.z);
  const taken = press(f, s, "p1", id);
  me(f).flags &= ~FLAG.CARRYING;
  return taken;
}

describe("the runner: The Winding Engine", () => {
  it("spawns the terrace (two guards, the beat-man, the engineer) and sets out the grit and the Company's keg", () => {
    const { f, s } = newRun();
    expect(s.template).toBe("winding_engine");
    expect(npcKeys(f).sort()).toEqual(["npc:beat-0", "npc:engineer", "npc:guard-0", "npc:guard-1"]);
    expect([...f.props.values()].filter((p) => p.kind === PropKind.CRATE).length).toBe(2);
    expect([...f.props.values()].filter((p) => p.kind === PropKind.BARREL).length).toBe(1);
    expect(lastView(f)).toMatchObject({ template: "winding_engine", title: "The Winding Engine", timerLabel: "The cross-cut reaches the vein" });
  });

  it("engine_fouled: a crate carried to the feed unseen, consumed, one commit", () => {
    const { f, s } = newRun();
    expect(carryIn(f, s, PropKind.CRATE, "grit-x")).toBe(true);
    expect(f.consumed).toEqual(["grit-x"]);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "winding_engine", resolution: "engine_fouled", region: "vesper" });
  });

  it("a guard who sees the party on the terrace challenges it; staying out the challenge wakes the terrace", () => {
    const { f, s } = newRun();
    put(f, "p1", VESPER_SITES.guards[0]!.x + 2, VESPER_SITES.guards[0]!.z);
    run(f, s, 1);
    expect(lastView(f).phase).toBe("standoff");
    run(f, s, 12);
    expect(f.cast.groupOrders("guards")).toContain("alert");
    expect(f.cast.groupOrders("beat")).toContain("alert");
    // now the feed is refused, and nothing is consumed
    carryIn(f, s, PropKind.CRATE, "grit-y");
    expect(f.consumed).toEqual([]);
    expect(f.commits).toHaveLength(0);
  });

  it("engine_blown: a barrel lit at the feed, the terrace runs, the blast, one commit", () => {
    const { f, s } = newRun();
    expect(carryIn(f, s, PropKind.BARREL, "keg-x")).toBe(true);
    expect(f.consumed).toEqual(["keg-x"]);
    expect(f.cast.groupOrders("guards")).toContain("flee");
    run(f, s, 10);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "engine_blown" });
  });

  it("engine_bought: the engineer's inspection, paid through the parley sheet", () => {
    const { f, s } = newRun();
    pick(f, s, "engineer", /inspection/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "engine_bought" });
    expect(f.commits[0]!.paid).toBeGreaterThanOrEqual(60);
    expect(f.players.get(npcKey("engineer"))).toBeDefined();
  });
});
