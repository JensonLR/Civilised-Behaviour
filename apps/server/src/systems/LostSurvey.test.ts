import { describe, expect, it } from "vitest";
import { LOST, SALTMARKET_SURVEY, TEMPLATES, askingToll, newCampaign, npcKey, type CampaignState } from "@cb/shared";
import { Scenario } from "./Scenario.ts";
import { beside, down, fake, labelIndex, lastParley, lastView, me, npcKeys, pick, press, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";

/**
 * "The Lost Survey" (D-093, the Saltmarket's third contract) through the REAL Scenario runner on a fake host: one scripted run per ending (one commit each, the Saltmarket's region), the `follow` the
 * runner turns into a Cast order for whoever settled the books, the trail's marks, and hostile input. The pure reducer has its own tests in packages/shared.
 */

const P = SALTMARKET_SURVEY;
const SEED = 424242;   // the fake host's seed
const purse = (): CampaignState => ({ ...newCampaign(11), purse: 400 });
const state0 = (c: CampaignState) => TEMPLATES.lost_survey.init(c, askingToll(c), SEED) as unknown as { price: { dues: number; sale: number }; tideAt: number };
const start = (c: CampaignState = purse()): { f: Fake; s: Scenario } => {
  const f = fake(c);
  const s = setup(f, "lost_survey", row("p1", P.surveyor.x + 3, P.surveyor.z + 3), row("p2", P.surveyor.x + 4, P.surveyor.z + 3));
  run(f, s, 1);
  return { f, s };
};
/** The surveyor walks to the quay (Cast is faked: the test moves him), and the runner sees him arrive. */
const walkHome = (f: Fake, s: Scenario): void => {
  put(f, npcKey("surveyor"), P.quay.x, P.quay.z);
  run(f, s, 1);
};
const followed = (f: Fake): { o: string; target?: unknown }[] => f.cast.orders.filter((o) => o.group === "surveyor").map((o) => o.order as { o: string; target?: unknown });

describe("The Lost Survey through the runner", () => {
  it("starts with the surveyor, the Collector and two wardens at the hut, nothing committed, the trail on the strip and the tide on the clock", () => {
    const { f, s } = start();
    for (const id of ["surveyor", "collector", "warden-0", "warden-1"]) expect(f.players.has(npcKey(id)), id).toBe(true);
    expect(npcKeys(f)).toHaveLength(4);
    expect(f.commits).toEqual([]);
    const v = lastView(f);
    expect(v.template).toBe("lost_survey");
    expect(v.objectives[0]!.id).toBe("house");   // (the party starts beside the hut here: it is found)
    expect(v.timerLabel).toMatch(/tide/i);
    s.dispose();
    expect(npcKeys(f)).toEqual([]);
  });

  it("survey_home: the dues paid at the Collector's parley; the surveyor is ordered to follow the payer; his arrival at the quay is one commit", () => {
    const c = purse();
    const { f, s } = start(c);
    pick(f, s, "collector", /Pay the harbour dues/);
    expect(followed(f).at(-1)).toEqual({ o: "follow", target: "p1" });
    expect(f.commits).toEqual([]);
    walkHome(f, s);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "lost_survey", resolution: "survey_home", region: "saltmarket", paid: state0(c).price.dues, brokePromise: false });
    run(f, s, 60);
    expect(f.commits).toHaveLength(1);
  });

  it("chart_ceded: the surveyor talked into leaving his books (or the Collector given the chart); he follows whoever did it; home is a settlement", () => {
    for (const [who, re] of [["lost_surveyor", /Persuade him/], ["collector", /Cede the chart/]] as const) {
      const { f, s } = start();
      pick(f, s, who === "lost_surveyor" ? "surveyor" : "collector", re, "p2");
      expect(followed(f).at(-1)).toEqual({ o: "follow", target: "p2" });
      walkHome(f, s);
      expect(f.commits.map((x) => x.resolution)).toEqual(["chart_ceded"]);
      expect(f.commits[0]!.paid).toBe(0);
    }
  });

  it("survey_sold: the Houses buy the survey on the spot: one commit, the sale is the loot, and the surveyor is told to follow nobody", () => {
    const c = purse();
    const { f, s } = start(c);
    pick(f, s, "collector", /Sell the Houses the survey/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "survey_sold", region: "saltmarket", loot: state0(c).price.sale });
    expect(followed(f).some((o) => o.o === "follow")).toBe(false);
  });

  it("survey_lost: the tide comes with the surveyor still at the hut; and once he follows, the tide no longer matters", () => {
    const c = purse();
    const a = start(c);
    run(a.f, a.s, state0(c).tideAt + 5, 1);
    expect(a.f.commits.map((x) => x.resolution)).toEqual(["survey_lost"]);
    const b = start(c);
    pick(b.f, b.s, "collector", /Pay the harbour dues/);
    run(b.f, b.s, state0(c).tideAt + 5, 1);
    expect(b.f.commits).toEqual([]);
    // ...but he must be kept alive on the way
    down(b.f, npcKey("surveyor"));
    run(b.f, b.s, 1);
    expect(b.f.commits.map((x) => x.resolution)).toEqual(["survey_lost"]);
  });

  it("forced: a shot at a warden ends the talking; both wardens down and the surveyor takes his books and follows; home is a win with a broken promise", () => {
    const { f, s } = start();
    s.onShotAt("p1", npcKey("warden-0"));
    run(f, s, 1);
    expect(f.cast.groupOrders("wardens")).toContain("alert");
    beside(f, "p1", "collector");
    const parleys = f.sent.filter((m) => m.type === "parley").length;
    press(f, s);
    expect(f.sent.filter((m) => m.type === "parley").length, "the Collector is behind his ledger: no talks").toBe(parleys);
    down(f, npcKey("warden-0"));
    run(f, s, 1);
    expect(followed(f).some((o) => o.o === "follow"), "one warden is not enough").toBe(false);
    down(f, npcKey("warden-1"));
    run(f, s, 1);
    expect(followed(f).at(-1)!.o).toBe("follow");
    walkHome(f, s);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "survey_home", brokePromise: true });
    expect(f.commits[0]!.tally.garrisonKilled).toBeGreaterThanOrEqual(0);
  });

  it("the trail: Use at the peg, then at the windpump's chalk, moves the strip's mark along; a stranger's pick and an option out of range do nothing", () => {
    const f = fake();
    const s = setup(f, "lost_survey", row("p1", P.peg.x + 1, P.peg.z), row("p2", 0, 110));
    run(f, s, 1);
    expect(lastView(f).objectives[0]!.id).toBe("peg");
    expect(press(f, s)).toBe(true);
    expect(lastView(f).objectives[0]!.id).toBe("pump");
    put(f, "p1", P.pumpMark.x + 1, P.pumpMark.z);
    expect(press(f, s)).toBe(true);
    expect(lastView(f).objectives[0]!.id).toBe("house");
    // hostile input: the Collector's parley picked by somebody else, and an option past the end
    put(f, "p1", P.collector.x + 0.8, P.collector.z);
    me(f).x = P.collector.x + 0.8;
    expect(press(f, s)).toBe(true);
    const v = lastParley(f, "p1")!.view!;
    s.onPick("p2", labelIndex(v, /Pay the harbour dues/));
    s.onPick("p1", 99);
    expect(f.commits).toEqual([]);
    expect(f.cast.orders.some((o) => o.group === "surveyor")).toBe(false);
    s.onParleyClose("p1");
    expect(LOST.wardens).toBe(2);
  });
});
