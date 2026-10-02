import { describe, expect, it } from "vitest";
import { FLAG, SALTMARKET_ANCHORS, SALTMARKET_SITES, TEMPLATES, askingToll, newCampaign, npcKey, type CampaignState, type ParleyView } from "@cb/shared";
import { Scenario } from "./Scenario.ts";
import { beside, down, fake, labelIndex, lastParley, lastView, me, npcKeys, pick, press, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";

/**
 * "The Auction at High Water" (D-037, package D4) through the REAL Scenario runner on a fake host: one scripted run per ending (one commit each, the Saltmarket's region), the auctioneer's price read off the parley the
 * runner opened, and hostile input at every entry point. The pure reducer has its own tests in packages/shared.
 */

const HALL = SALTMARKET_ANCHORS.exchange;
const SEED = 424242;   // the fake host's seed
const poor = (): CampaignState => ({ ...newCampaign(11), purse: 400 });
/** The state the runner starts from (same campaign, toll and seed as the fake host gives it). */
const state0 = (c: CampaignState) => TEMPLATES.flooded_market.init(c, askingToll(c), SEED) as unknown as { reserve: number; ceilings: number[]; factor: number; high: number };
const start = (c: CampaignState = poor()): { f: Fake; s: Scenario } => {
  const f = fake(c);
  const s = setup(f, "flooded_market", row("p1", HALL.x, HALL.z + 4), row("p2", HALL.x + 3, HALL.z + 4));
  run(f, s, 1);
  return { f, s };
};
/** The loudest paddle in the room at the start (a whisper takes a little off; nothing here whispers). */
const loudest = (c: CampaignState): number => { const s0 = state0(c); return Math.max(s0.reserve, ...s0.ceilings, s0.factor); };
const priceOf = (v: ParleyView): number => Number(/Bid £(\d+)/.exec(v.options.find((o) => /^Bid £/.test(o.label))?.label ?? "")?.[1] ?? NaN);
/** Lets the tide push the asking price up until it clears the loudest paddle, then opens the parley and returns its price (the parley is left open). */
function waitForPrice(f: Fake, s: Scenario, need: number): number {
  for (let i = 0; i < 40; i++) {
    beside(f, "p1", "auctioneer");
    expect(press(f, s)).toBe(true);
    const price = priceOf(lastParley(f, "p1")!.view!);
    if (price >= need) return price;
    s.onParleyClose("p1");
    run(f, s, 10);
  }
  throw new Error("the price never cleared the paddles");
}
/** A bid at the opening price (D-041: a consortium pools a BIDDER's purse, so the party must be in the bidding before anybody signs). */
function bidIn(f: Fake, s: Scenario): void {
  beside(f, "p1", "auctioneer");
  expect(press(f, s)).toBe(true);
  s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /^Bid £/));
}
const toHammer = (f: Fake, s: Scenario): void => {
  for (let t = 0; t < 700 && f.commits.length === 0; t += 5) run(f, s, 5);
};

describe("The Auction at High Water through the runner", () => {
  it("starts with the Auctioneer, four House-Heads and the Syndicate's factor in the hall, nothing committed, and a High-water timer", () => {
    const f = fake();
    const s = setup(f, "flooded_market", row("p1", 0, 0));
    for (const id of ["auctioneer", "head-0", "head-1", "head-2", "head-3", "factor"]) expect(f.players.has(npcKey(id)), id).toBe(true);
    expect(npcKeys(f).length).toBeLessThanOrEqual(14);
    expect(f.commits).toEqual([]);
    expect(lastView(f).template).toBe("flooded_market");
    s.dispose();
    expect(npcKeys(f)).toEqual([]);
  });

  it("washed_out: the hammer falls at high water on a party that bid nothing; one commit; and the end is the end", () => {
    const { f, s } = start();
    toHammer(f, s);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "flooded_market", resolution: "washed_out", region: "saltmarket", bridge: "intact", toll: 0 });
    run(f, s, 120);
    expect(f.commits).toHaveLength(1);
  });

  it("lot_won: a bid at the price that clears the loudest paddle, then the hammer; the lot is paid for from the purse", () => {
    const c = poor();
    const { f, s } = start(c);
    const price = waitForPrice(f, s, loudest(c));
    const v = lastParley(f, "p1")!.view!;
    s.onPick("p1", labelIndex(v, /^Bid £/));
    expect(f.commits, "a bid is not yet the lot").toEqual([]);
    toHammer(f, s);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "flooded_market", resolution: "lot_won", region: "saltmarket" });
    expect(f.commits[0]!.paid).toBeGreaterThanOrEqual(price - 1);
  });

  it("a bid below the loudest paddle loses at the hammer", () => {
    const c = poor();
    const { f, s } = start(c);
    beside(f, "p1", "auctioneer");
    expect(press(f, s)).toBe(true);
    expect(priceOf(lastParley(f, "p1")!.view!), "the opening price is below the paddles").toBeLessThan(loudest(c));
    s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /^Bid £/));
    toHammer(f, s);
    expect(f.commits.map((x) => x.resolution)).toEqual(["washed_out"]);
  });

  it("shorted: the sell-short pick at a price that clears the paddles, then the hammer; the commission is the loot and the promise is broken", () => {
    const c = poor();
    const { f, s } = start(c);
    waitForPrice(f, s, loudest(c));
    s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /Sell short/));
    toHammer(f, s);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ resolution: "shorted", region: "saltmarket", brokePromise: true });
    expect(f.commits[0]!.loot).toBeGreaterThan(0);
  });

  it("consortium: two House-Heads agree to a pool (two signatures); one commit; the Syndicate's factor counts as a signature too", () => {
    const { f, s } = start();
    // a spectator is refused: no bid, no signature
    pick(f, s, "head-0", /Propose a consortium/);
    pick(f, s, "head-1", /Propose a consortium/);
    expect(f.commits).toEqual([]);
    bidIn(f, s);
    pick(f, s, "head-2", /Propose a consortium/);
    expect(f.commits).toEqual([]);
    pick(f, s, "head-3", /Propose a consortium/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "flooded_market", resolution: "consortium", region: "saltmarket" });
    const g = start();
    bidIn(g.f, g.s);
    beside(g.f, "p1", "factor");
    expect(press(g.f, g.s)).toBe(true);   // hears the offer
    expect(press(g.f, g.s)).toBe(true);   // pools with him
    pick(g.f, g.s, "head-2", /Propose a consortium/);
    expect(g.f.commits.map((x) => x.resolution)).toEqual(["consortium"]);
  });

  it("a House-Head's contribution takes a paddle out of the bidding and the money out of the purse; asked for something else, it does not", () => {
    const c = poor();
    const { f, s } = start(c);
    pick(f, s, "head-0", /contribution/);
    expect(f.commits).toEqual([]);
    expect(lastParley(f, "p1")?.closed).toBe(true);
    // the same head, a second time, is simply a conversation
    beside(f, "p1", "head-0");
    expect(press(f, s)).toBe(true);
    s.onParleyClose("p1");
  });

  it("violence suspends the sale: a House-Head or the Auctioneer shot down, or a weapon at the heads, washes it out with one commit", () => {
    for (const victim of ["head-1", "auctioneer"]) {
      const { f, s } = start();
      f.players.get(npcKey(victim))!.flags |= FLAG.DOWNED;
      s.onDamage(npcKey(victim), "p1", 0, true);
      run(f, s, 1);
      expect(f.commits.map((c) => c.resolution), victim).toEqual(["washed_out"]);
      expect(f.commits[0]!.brokePromise, "no promise had been made").toBe(false);
    }
    const { f, s } = start();
    s.onDamage(npcKey("head-0"), "p1", 0, false);
    expect(f.commits.map((c) => c.resolution)).toEqual(["washed_out"]);
    // a weapon drawn after a bid was made is a broken promise
    const h = start();
    beside(h.f, "p1", "auctioneer");
    press(h.f, h.s);
    h.s.onPick("p1", labelIndex(lastParley(h.f, "p1")!.view!, /^Bid £/));
    h.s.onDamage(npcKey("head-0"), "p1", 0, false);
    expect(h.f.commits.map((c) => [c.resolution, c.brokePromise])).toEqual([["washed_out", true]]);
    // the factor is a bystander: shooting him does not end the sale
    const g = start();
    g.s.onDamage(npcKey("factor"), "p1", 0, true);
    expect(g.f.commits).toEqual([]);
  });

  it("abandoned: the whole party down; leave: nothing done commits nothing, a standing bid commits abandoned, twice commits once", () => {
    const a = start();
    down(a.f, "p1");
    down(a.f, "p2");
    run(a.f, a.s, 1);
    expect(a.f.commits.map((c) => c.resolution)).toEqual(["abandoned"]);
    const quiet = fake();
    const sq = setup(quiet, "flooded_market", row("p1", 0, 118));
    sq.leave();
    expect(quiet.commits).toEqual([]);
    const c = poor();
    const { f, s } = start(c);
    beside(f, "p1", "auctioneer");
    press(f, s);
    s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /^Bid £/));
    s.leave();
    s.leave();
    expect(f.commits.map((x) => x.resolution)).toEqual(["abandoned"]);
  });

  it("the four endings are four different ledgers (resolution, money, promise)", () => {
    const c = poor();
    const outs = new Map<string, string>();
    {
      const { f, s } = start(c);
      toHammer(f, s);
      outs.set("washed_out", JSON.stringify([f.commits[0]!.paid, f.commits[0]!.loot ?? 0, f.commits[0]!.brokePromise]));
    }
    {
      const { f, s } = start(c);
      waitForPrice(f, s, loudest(c));
      s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /^Bid £/));
      toHammer(f, s);
      outs.set(f.commits[0]!.resolution, JSON.stringify([f.commits[0]!.paid, f.commits[0]!.loot ?? 0, f.commits[0]!.brokePromise]));
    }
    {
      const { f, s } = start(c);
      waitForPrice(f, s, loudest(c));
      s.onPick("p1", labelIndex(lastParley(f, "p1")!.view!, /Sell short/));
      toHammer(f, s);
      outs.set(f.commits[0]!.resolution, JSON.stringify([f.commits[0]!.paid, f.commits[0]!.loot ?? 0, f.commits[0]!.brokePromise]));
    }
    {
      const { f, s } = start(c);
      bidIn(f, s);
      pick(f, s, "head-0", /Propose a consortium/);
      pick(f, s, "head-1", /Propose a consortium/);
      outs.set(f.commits[0]!.resolution, JSON.stringify([f.commits[0]!.paid, f.commits[0]!.loot ?? 0, f.commits[0]!.brokePromise]));
    }
    expect([...outs.keys()].sort()).toEqual(["consortium", "lot_won", "shorted", "washed_out"]);
    expect(new Set(outs.values()).size, "money and promises differ").toBeGreaterThanOrEqual(3);
  });
});

describe("The Auction at High Water: hostile input at every entry point", () => {
  it("INTERACT from an NPC key, the downed, out of range, or with a crate in the hands: not taken, nothing committed", () => {
    const { f, s } = start();
    beside(f, "p1", "auctioneer");
    expect(s.onInteract("npc:head-0", me(f)), "an NPC key").toBe(false);
    me(f).flags |= FLAG.CARRYING;
    expect(press(f, s, "p1", "forged"), "hands full").toBe(false);
    me(f).flags = FLAG.GROUNDED | FLAG.DOWNED;
    expect(press(f, s)).toBe(false);
    me(f).flags = FLAG.GROUNDED;
    put(f, "p1", HALL.x, HALL.z + 20);
    expect(press(f, s), "too far").toBe(false);
    expect(f.commits).toEqual([]);
    expect(lastParley(f, "p1")).toBeUndefined();
  });

  it("onPick and onParleyClose with no parley, from a stranger, with garbage options, or after the end do nothing", () => {
    const { f, s } = start();
    s.onPick("p1", 0);
    s.onParleyClose("p1");
    beside(f, "p1", "auctioneer");
    expect(press(f, s, "p1")).toBe(true);
    const v = lastParley(f, "p1")!.view!;
    s.onPick("p2", labelIndex(v, /^Bid £/));
    for (const bad of [-1, 99, 2.5, NaN, Infinity, "0" as unknown as number, null as unknown as number, undefined as unknown as number]) s.onPick("p1", bad);
    s.onParleyClose("p2");
    expect(f.commits).toEqual([]);
    // the second member cannot talk over the first
    beside(f, "p2", "head-0");
    expect(press(f, s, "p2")).toBe(true);
    expect(lastParley(f, "p2")?.view).toBeUndefined();
    s.onParleyClose("p1");
    toHammer(f, s);
    expect(f.commits).toHaveLength(1);
    s.onPick("p1", 0);
    s.onParleyClose("p1");
    expect(press(f, s, "p1")).toBe(false);
    s.onDamage(npcKey("head-0"), "p1", 0, true);
    s.onNoise(HALL.x, HALL.z, 50, "p1");
    s.leave();
    run(f, s, 60);
    expect(f.commits).toHaveLength(1);
  });

  it("walking away from a parley closes it; a bid that was never made is not a lot won", () => {
    const { f, s } = start();
    beside(f, "p1", "auctioneer");
    press(f, s);
    expect(lastParley(f, "p1")?.view).toBeDefined();
    put(f, "p1", HALL.x + 40, HALL.z);
    run(f, s, 1);
    expect(lastParley(f, "p1")?.closed).toBe(true);
    toHammer(f, s);
    expect(f.commits.map((c) => c.resolution)).toEqual(["washed_out"]);
  });

  it("a flood of forged inputs never reaches lot_won or a consortium a client could not earn", () => {
    const { f, s } = start();
    const spots = [SALTMARKET_SITES.auctioneer, ...SALTMARKET_SITES.houseHeads, { x: 12, z: -52 }, { x: 0, z: 118 }];
    for (let i = 0; i < 3000; i++) {
      const p = spots[i % spots.length]!;
      put(f, "p1", p.x + 0.8, p.z);
      me(f).flags = i % 5 === 0 ? FLAG.GROUNDED | FLAG.CARRYING : FLAG.GROUNDED;
      s.onInteract("p1", me(f), i % 3 === 0 ? undefined : `forged-${i}`);
      // option 0 of any parley is a bid or a contribution; garbage indexes and strangers' picks are mixed in, and the party is never allowed to win
      if (i % 4 === 0) s.onPick("p1", 99);
      else if (i % 4 === 1) s.onPick("p2", 0);
      else if (i % 4 === 2) s.onParleyClose("p1");
      if (i % 50 === 0) run(f, s, 0.25);
    }
    expect(f.commits.length).toBeLessThanOrEqual(1);
    expect(f.commits.map((c) => c.resolution).filter((r) => r === "lot_won" || r === "consortium" || r === "shorted")).toEqual([]);
  });
});
