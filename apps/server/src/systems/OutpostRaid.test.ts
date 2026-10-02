import { describe, expect, it } from "vitest";
import { KESSAR_OUTPOST, RAID, RAID_SITES, newCampaign, npcKey } from "@cb/shared";
import { down, fake, lastView, npcKeys, pick, row, run, setup, type Fake } from "./vesperFake.testkit.ts";
import type { Scenario } from "./Scenario.ts";

/**
 * "The Raid on the Post" (D-045, Kessar's fifth contract) through the REAL runner on a fake host and a fake Cast: the raiders land on their clock, the captain's parley, two raiders standing in the
 * yard for the torch time, the party breaking them; one commit each. The pure rules are in packages/shared (scenarios/outpostRaid.test.ts).
 */

const S = KESSAR_OUTPOST.site;
const newRun = (purse = 300): { f: Fake; s: Scenario } => {
  const f = fake({ ...newCampaign(11), purse });
  const s = setup(f, "outpost_raid", row("p1", S.x, S.z + 4));
  run(f, s, 1);
  return { f, s };
};
const raiders = (f: Fake): string[] => npcKeys(f).filter((k) => k.startsWith("npc:raider-"));
/** Runs the clock to the landing (the fake Cast puts each raider at its post, the landing). */
function land(f: Fake, s: Scenario): void {
  for (let i = 0; i < 400 && raiders(f).length === 0; i++) run(f, s, 1);
  expect(raiders(f).length, "the raiders landed").toBeGreaterThanOrEqual(RAID.raiders);
  run(f, s, 1);
}
const walkIn = (f: Fake, keys: readonly string[]): void => { for (const k of keys) { const r = f.players.get(k)!; r.x = S.x + 1; r.z = S.z; } };

describe("the runner: The Raid on the Post", () => {
  it("nobody is on the bank until the landing; then the raiders and their captain, marching to the muster", () => {
    const { f, s } = newRun();
    expect(s.template).toBe("outpost_raid");
    expect(npcKeys(f)).toEqual([]);
    expect(lastView(f)).toMatchObject({ template: "outpost_raid", title: "The Raid on the Post", timerLabel: "The raiders land" });
    land(f, s);
    expect(f.players.get(npcKey("captain"))).toBeDefined();
    const r0 = f.players.get(raiders(f)[0]!)!;
    expect(Math.hypot(r0.x - RAID_SITES.landing.x, r0.z - RAID_SITES.landing.z)).toBeLessThan(6);
    expect(f.cast.groupOrders("late:raiders")).toContain("march");
    expect(lastView(f).timerLabel).toBe("The captain's watch");
  });

  it("protection_paid: the captain's price through the parley sheet, one commit, the raiders go home", () => {
    const { f, s } = newRun();
    land(f, s);
    pick(f, s, "captain", /protection/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "outpost_raid", resolution: "protection_paid", region: "kessar" });
    expect(f.commits[0]!.paid).toBeGreaterThanOrEqual(RAID.priceProtection[0]);
  });

  it("post_burned: after the demand runs out, two raiders reaching the yard and staying the torch time; one commit", () => {
    const { f, s } = newRun();
    land(f, s);
    run(f, s, RAID.demandS + 1);
    expect(f.cast.groupOrders("late:raiders").filter((o) => o === "march").length).toBe(2);
    walkIn(f, raiders(f).slice(0, 2));
    run(f, s, RAID.torchS + 2);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "post_burned" });
  });

  it("post_held: the party drops one of the pair before the torches catch, then breaks the rest; the stores stand", () => {
    const { f, s } = newRun();
    land(f, s);
    run(f, s, RAID.demandS + 1);
    const rs = raiders(f);
    walkIn(f, rs.slice(0, 2));
    run(f, s, RAID.torchS - 5);
    down(f, rs[1]!);
    run(f, s, 10);
    expect(f.commits, "one raider alone does not burn the stores").toHaveLength(0);
    for (const k of rs.slice(2, 2 + Math.ceil(rs.length * RAID.brokenFraction) - 1)) down(f, k);
    run(f, s, 2);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "post_held" });
    expect(f.cast.groupOrders("late:raiders")).toContain("flee");
  });
});
