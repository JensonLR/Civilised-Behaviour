import { describe, expect, it } from "vitest";
import { KESSAR_SITES, SIEGE, TEMPLATES, askingToll, newCampaign, npcKey, type CampaignState } from "@cb/shared";
import { Scenario } from "./Scenario.ts";
import { down, fake, lastView, npcKeys, pick, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";

/**
 * "The Siege of the Counting-House" (D-095, Kessar's sixth contract) through the REAL Scenario runner on a fake host: the picket marks (a near site each), the sally the runner sends
 * when the stores clock reaches it, one commit per ending, and the relief. The pure reducer has its own tests in packages/shared; the struck post is WorldRoom's (siegeAftermath).
 */

const P = KESSAR_SITES.siege;
const SEED = 424242;   // the fake host's seed
const purse = (): CampaignState => ({ ...newCampaign(11), purse: 400 });
const state0 = (c: CampaignState) => TEMPLATES.counting_house.init(c, askingToll(c), SEED) as unknown as { price: number; reliefAt: number; storesS: number; relief: { total: number } };
const start = (c: CampaignState = purse()): { f: Fake; s: Scenario } => {
  const f = fake(c);
  const s = setup(f, "counting_house", row("p1", P.yard.x - 30, P.yard.z), row("p2", P.yard.x - 31, P.yard.z));
  run(f, s, 1);
  return { f, s };
};
/** p1 stands on each picket mark in turn and steps off it again. */
const invest = (f: Fake, s: Scenario): void => {
  for (const m of P.pickets) {
    put(f, "p1", m.x, m.z);
    run(f, s, 1);
    put(f, "p1", m.x + 8, m.z + 8);
    run(f, s, 1);
  }
};
const orders = (f: Fake, group: string): string[] => f.cast.groupOrders(group);

describe("The Siege of the Counting-House through the runner", () => {
  it("starts with the factor, two guns in the yard and two sallying behind; the relief and the picket boys held back; the next mark on the strip and the relief on the clock", () => {
    const { f, s } = start();
    for (const id of ["factor", "garrison-0", "garrison-1", "sally-0", "sally-1"]) expect(f.players.has(npcKey(id)), id).toBe(true);
    expect(npcKeys(f)).toHaveLength(5);
    expect(f.commits).toEqual([]);
    const v = lastView(f);
    expect(v.template).toBe("counting_house");
    expect(v.objectives[0]!.id).toBe("picket0");
    expect(v.timerLabel).toBe("The relief lands");
    s.dispose();
    expect(npcKeys(f)).toEqual([]);
  });

  it("standing on a mark plants it: the Ward's boy appears on it; all three invest the post and the stores clock runs", () => {
    const { f, s } = start();
    put(f, "p1", P.pickets[0]!.x, P.pickets[0]!.z);
    run(f, s, 1);
    expect(f.players.has(npcKey("picket-0"))).toBe(true);
    expect(lastView(f).objectives[0]!.id).toBe("picket1");
    invest(f, s);
    for (const k of [0, 1, 2]) expect(f.players.has(npcKey(`picket-${k}`)), `picket-${k}`).toBe(true);
    expect(lastView(f).objectives[0]).toMatchObject({ id: "invest", done: true });
    expect(lastView(f).timerLabel).toBe("The garrison's stores");
  });

  it("the sally goes out on the stores clock; reaching a mark nobody stands on, it strikes it: the boy runs and the sally goes home", () => {
    const { f, s } = start();
    invest(f, s);
    run(f, s, SIEGE.sallyAt[0] + 1);
    const out = f.cast.orders.find((o) => o.group === "sally" && o.order.o === "march") as { order: { o: "march"; route: string } } | undefined;
    expect(out, "the sally marched").toBeDefined();
    const k = Number(out!.order.route.slice(5));
    expect(lastView(f).objectives.some((o) => o.id === `sally${k}`)).toBe(true);
    put(f, npcKey("sally-0"), P.pickets[k]!.x, P.pickets[k]!.z);
    run(f, s, 1);
    expect(orders(f, `late:picket-${k}`)).toContain("flee");
    expect(orders(f, "sally").at(-1)).toBe("post");
    expect(lastView(f).objectives[0]!.id).toBe(`picket${k}`);
    expect(f.commits).toEqual([]);
  });

  it("siege_honours: summoned once the stores are out, he accepts; one commit at Kessar, and the garrison walks down to the river", () => {
    const c = purse();
    const { f, s } = start(c);
    pick(f, s, "factor", /Summon him/);
    expect(f.commits, "refused: the post is not invested").toEqual([]);
    invest(f, s);
    // keep the sallies off the marks: stand a man on each in turn is the players' work; here the clock simply runs (the sally is put back at home)
    for (let t = 0; t < state0(c).storesS + 2; t += 5) {
      run(f, s, 5);
      put(f, npcKey("sally-0"), P.sallyPosts[0]!.x, P.sallyPosts[0]!.z);
      put(f, npcKey("sally-1"), P.sallyPosts[1]!.x, P.sallyPosts[1]!.z);
    }
    pick(f, s, "factor", /Summon him/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "counting_house", resolution: "siege_honours", region: "kessar", paid: 0, brokePromise: false });
    expect(orders(f, "garrison")).toEqual(expect.arrayContaining(["stand_down", "guard"]));
    run(f, s, 30);
    expect(f.commits).toHaveLength(1);
  });

  it("siege_stormed: a shot into the post stands the garrison to; three of its four down is the storm", () => {
    const { f, s } = start();
    s.onShotAt("p1", npcKey("garrison-0"));
    expect(orders(f, "garrison")).toContain("alert");
    expect(orders(f, "factor")).toContain("hold_fire");
    for (const id of ["garrison-0", "garrison-1", "sally-0"]) {
      down(f, npcKey(id));
      run(f, s, 1);
    }
    expect(f.commits.map((x) => x.resolution)).toEqual(["siege_stormed"]);
  });

  it("siege_bought: his price at the counter; siege_lifted: two of the relief in the yard", () => {
    const c = purse();
    const a = start(c);
    pick(a.f, a.s, "factor", /Buy the post/);
    expect(a.f.commits).toHaveLength(1);
    expect(a.f.commits[0]).toMatchObject({ resolution: "siege_bought", paid: state0(c).price });
    const b = start(c);
    run(b.f, b.s, state0(c).reliefAt + 2, 1);
    expect(b.f.players.has(npcKey("relief-0"))).toBe(true);
    expect(npcKeys(b.f).filter((k) => k.startsWith("npc:relief-"))).toHaveLength(state0(c).relief.total);
    put(b.f, npcKey("relief-0"), P.yard.x, P.yard.z);
    run(b.f, b.s, 1);
    expect(b.f.commits).toEqual([]);
    put(b.f, npcKey("relief-1"), P.yard.x + 1, P.yard.z);
    run(b.f, b.s, 1);
    expect(b.f.commits.map((x) => x.resolution)).toEqual(["siege_lifted"]);
  });
});
