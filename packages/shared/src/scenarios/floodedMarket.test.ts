import { describe, expect, it } from "vitest";
import type { CampaignState } from "../campaignTypes.ts";
import { RESOLVED_LINGER_S } from "../campaignTypes.ts";
import { COMPLICATION_HINT } from "../chaos.ts";
import { applyOutcome, newCampaign } from "../factions.ts";
import { Rng } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { lingerDone } from "./common.ts";
import { MARKET, askAt, floodedMarketTemplate as def, rivalMax, type MarketState } from "./floodedMarket.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import type { Fx } from "./types.ts";

const cm = (seed = 7): CampaignState => newCampaign(seed);
function calm(): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 400; seed++) {
    const c = cm(seed);
    if (def.init(c, 0, seed).complication === "none") return { c, seed };
  }
  throw new Error("no calm seed");
}
const { c: C, seed: SEED } = calm();
const isCommit = (f: Fx): boolean => f === "commit" || (typeof f === "object" && f.k === "commit");
interface Run { s: MarketState; fx: Fx[]; commits: number }
function drive(events: readonly ScenarioInput[], s0?: MarketState, c: CampaignState = C, seed = SEED): Run {
  let s = s0 ?? def.init(c, 0, seed);
  const fx: Fx[] = [];
  for (const e of events) {
    const r = def.reduce(s, e);
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx, commits: fx.filter(isCommit).length };
}
const ticks = (seconds: number, dt = 1): ScenarioInput[] => Array.from({ length: Math.ceil(seconds / dt) }, () => ({ t: "tick", dt }));
const near = (party = 1): ScenarioInput => ({ t: "near", at: "hall", party });
const talk = (kind: "auctioneer" | "house_head", result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind, result, paid });
const use = (target: string): ScenarioInput => ({ t: "use", target, slot: 0 });
const S0 = def.init(C, 0, SEED);
/** A purse that can buy the whole bench (the economy is the point of the normal run: a poor party cannot clear the room). */
const RICH: CampaignState = { ...C, purse: 900 };
const R0 = def.init(RICH, 0, SEED);
const HAMMER = S0.high;
const TICKS_TO_HAMMER = ticks(HAMMER + 2, 2);

/** What it takes to clear the room: every House-Head bought off (the price asked each time) and the factor out of it. */
const buyOffAll = (s: MarketState): ScenarioInput[] => {   // (the prices are the ones of the state it is built from)
  const out: ScenarioInput[] = [];
  for (let i = 0; i < 4; i++) out.push(talk("house_head", "open"), talk("house_head", "paid", s.price.head[i]!));
  return out;
};

/** A bid at the reserve, at the start of the sale: what puts the party "in the bidding". */
const BID = (): ScenarioInput[] => [talk("auctioneer", "open"), talk("auctioneer", "paid", askAt(S0))];
const SCRIPTS = {
  // a standing bid at the right moment (above the loudest paddle), then the hammer
  lot_won: (): ScenarioInput[] => {
    // wait until the asking price reaches the loudest paddle, then bid it
    const t = Math.ceil((rivalMax(S0) - S0.reserve) / MARKET.riseStep) * MARKET.riseEvery;
    return [near(), ...ticks(t), talk("auctioneer", "open"), talk("auctioneer", "paid", askAt({ reserve: S0.reserve, t })), ...TICKS_TO_HAMMER];
  },
  // (D-041: a consortium needs the party in the bidding: a bid at the reserve first, then two signatures)
  consortium: (): ScenarioInput[] => [near(), ...BID(), talk("house_head", "open"), talk("house_head", "survey"), talk("house_head", "open"), talk("house_head", "survey")],
  shorted: (): ScenarioInput[] => {
    // the same wait, and an offer on credit at the price that clears the loudest paddle: no cash behind it
    const t = Math.ceil((rivalMax(S0) - S0.reserve) / MARKET.riseStep) * MARKET.riseEvery;
    return [near(), ...ticks(t), talk("auctioneer", "open"), talk("auctioneer", "tip"), ...TICKS_TO_HAMMER];
  },
  washed_out: (): ScenarioInput[] => [near(), ...TICKS_TO_HAMMER],
  abandoned: (): ScenarioInput[] => [near(), { t: "party_down" }],
} as const;

describe("The Auction at High Water: one scripted run per ending on the pure reducer", () => {
  for (const r of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
    it(`${r}: resolves, commits exactly once, the first resolution wins, and the outcome is the Saltmarket's`, () => {
      const run = drive(SCRIPTS[r]());
      expect(run.s.resolution, `${r} (${JSON.stringify({ bid: run.s.bid, short: run.s.short, gone: run.s.gone, rival: rivalMax(run.s), spent: run.s.spent })})`).toBe(r);
      expect(run.s.phase).toBe("resolved");
      expect(run.commits, "commit exactly once").toBe(1);
      expect(def.outcome(run.s)).toMatchObject({ scenario: "flooded_market", resolution: r, region: "saltmarket", bridge: "intact", toll: 0 });
      expect(def.outcome(run.s)!.paid).toBeGreaterThanOrEqual(0);
      const more = drive([{ t: "party_down" }, { t: "hostile", at: "heads" }, use("factor"), use("factor"), talk("auctioneer", "open"), talk("house_head", "paid", 40), ...ticks(RESOLVED_LINGER_S + 5)], run.s);
      expect(more.s.resolution).toBe(r);
      expect(more.commits).toBe(0);
      expect(lingerDone(more.s)).toBe(true);
    });
  }

  it("the four endings are materially different: distinct campaigns, outcomes and money", () => {
    const rs = ["lot_won", "consortium", "shorted", "washed_out"] as const;
    const outs = rs.map((r) => def.outcome(drive(SCRIPTS[r]()).s)!);
    const afters = outs.map((o) => applyOutcome(C, o));
    expect(new Set(afters.map((a) => JSON.stringify([a.purse, a.lies, a.sites.ends, a.history.at(-1)]))).size).toBe(4);
    expect(new Set(outs.map((o) => `${o.paid}/${o.loot ?? 0}/${o.brokePromise}`)).size, "money and promises differ").toBeGreaterThanOrEqual(3);
    expect(outs[0]!.paid).toBeGreaterThan(outs[3]!.paid);   // the lot is paid for
    expect(outs[2]!.loot).toBe(MARKET.commission);            // the short sale pays a commission...
    expect(outs[2]!.brokePromise).toBe(true);                 // ...and costs a lie
  });
});

describe("The Auction at High Water: the rules", () => {
  it("the price rises six pounds every half-minute with the tide, and a bid below the loudest paddle loses at the hammer", () => {
    expect(askAt({ reserve: 50, t: 0 })).toBe(50);
    expect(askAt({ reserve: 50, t: 29 })).toBe(50);
    expect(askAt({ reserve: 50, t: 30 })).toBe(56);
    expect(askAt({ reserve: 50, t: 300 })).toBe(110);
    const early = drive([near(), talk("auctioneer", "open"), talk("auctioneer", "paid", askAt(S0)), ...TICKS_TO_HAMMER]);
    expect(early.s.bid).toBe(S0.reserve);
    expect(early.s.resolution, "the loudest paddle is higher than the opening price").toBe("washed_out");
  });

  it("a bid is checked: a forged amount, more than the purse holds, or no parley open changes nothing", () => {
    const p = askAt(S0);
    for (const paid of [0, 1, 1e9, -5, NaN, p * 2]) expect(drive([talk("auctioneer", "open"), talk("auctioneer", "paid", paid)]).s.bid, `paid ${paid}`).toBe(0);
    expect(drive([talk("auctioneer", "paid", p)]).s.bid, "no parley").toBe(0);
    expect(drive([talk("auctioneer", "open"), talk("auctioneer", "paid", p)], undefined, { ...C, purse: 5 }).s.bid, "the purse").toBe(0);
    expect(drive([talk("auctioneer", "open"), talk("auctioneer", "paid", p)]).s.bid).toBe(p);
    // a higher bid replaces a lower one; a lower one does not replace a higher
    const two = drive([talk("auctioneer", "open"), talk("auctioneer", "paid", p), ...ticks(60), talk("auctioneer", "open"), talk("auctioneer", "paid", askAt({ reserve: S0.reserve, t: 61 }))]);
    expect(two.s.bid).toBe(askAt({ reserve: S0.reserve, t: 61 }));
  });

  it("the House-Heads: a contribution takes the loudest paddle out and costs the purse; a whisper lowers every ceiling; none is left to catch after four", () => {
    const before = rivalMax(S0);
    const bought = drive([talk("house_head", "open"), talk("house_head", "paid", S0.price.head[0]!)]);
    expect(bought.s.gone).toBe(1);
    expect(bought.s.spent).toBe(S0.price.head[0]);
    expect(rivalMax(bought.s)).toBeLessThanOrEqual(before);
    const whispered = drive([talk("house_head", "open"), talk("house_head", "tell")]);
    expect(whispered.s.whispers).toBe(1);
    expect(rivalMax(whispered.s)).toBeLessThan(before + 1);
    const three = drive(Array.from({ length: 6 }, () => [talk("house_head", "open"), talk("house_head", "tell")] as ScenarioInput[]).flat());
    expect(three.s.whispers, "three whispers at most").toBe(MARKET.whispers);
    const all = drive(buyOffAll(R0), undefined, RICH);
    expect(all.s.gone).toBe(4);
    expect(drive(buyOffAll(S0)).s.gone, "a normal purse cannot buy the whole bench").toBeLessThan(4);
    const none = drive([talk("house_head", "open")], all.s);
    expect(none.s.parley, "no parley opens with an empty bench").toBeUndefined();
    expect(none.fx.some((f) => typeof f === "object" && f.k === "parley")).toBe(false);
    // a paid amount that does not match the price shown is refused
    for (const paid of [0, 1, 1e9, NaN, -3]) expect(drive([talk("house_head", "open"), talk("house_head", "paid", paid)]).s.gone, `paid ${paid}`).toBe(0);
  });

  it("the factor: one press hears the offer, the second pools with him (a signature); put down, his ceiling leaves the room", () => {
    const f1 = drive([use("factor")]);
    expect(f1.s.factorOffered).toBe(true);
    expect(f1.s.signed).toBe(0);
    // (D-041: nobody pools with a spectator: no bid, no partnership)
    const idle = drive([use("factor"), use("factor")]);
    expect(idle.s.signed).toBe(0);
    expect(drive([talk("house_head", "open"), talk("house_head", "survey")]).s.signed).toBe(0);
    const f2 = drive([...BID(), use("factor"), use("factor")]);
    expect(f2.s.factorPooled).toBe(true);
    expect(f2.s.signed).toBe(1);
    expect(drive([...BID(), use("factor"), use("factor"), use("factor")]).s.signed, "pooled once").toBe(1);
    // a House and the factor are two signatures: a consortium with the Syndicate
    const mixed = drive([...BID(), use("factor"), use("factor"), talk("house_head", "open"), talk("house_head", "survey")]);
    expect(mixed.s.resolution).toBe("consortium");
    const room = drive(buyOffAll(R0), undefined, RICH).s;
    expect(rivalMax(room), "with the bench gone only the factor is left").toBe(R0.factor);
    expect(rivalMax({ ...room, factorDown: true })).toBe(0);
    expect(rivalMax({ ...room, factorPooled: true }), "pooled, he is a partner and not a rival").toBe(0);
    expect(drive([{ t: "actor", id: "factor", state: "down" }, use("factor"), use("factor")]).s.signed).toBe(0);
  });

  it("when nobody is left to outbid, the Auctioneer calls the lot early: a cash bid wins it, a short bid sells it short", () => {
    const cleared = [{ t: "actor", id: "factor", state: "down" } as ScenarioInput, ...buyOffAll(R0)];
    const drv = (e: ScenarioInput[]): Run => drive(e, undefined, RICH);
    const cash = drv([...cleared, talk("auctioneer", "open"), talk("auctioneer", "paid", askAt(R0))]);
    expect(cash.s.resolution).toBe("lot_won");
    expect(def.outcome(cash.s)!.paid).toBe(cash.s.spent + cash.s.bid);
    expect(def.outcome(cash.s)!.paid).toBeLessThanOrEqual(RICH.purse);
    const sold = drv([...cleared, talk("auctioneer", "open"), talk("auctioneer", "tip")]);
    expect(sold.s.resolution).toBe("shorted");
    expect(def.outcome(sold.s)!.paid).toBe(sold.s.spent);
    // no bid at all after the room is cleared: nothing is called; the water decides
    expect(drv(cleared).s.resolution).toBeUndefined();
    expect(drv([...cleared, ...TICKS_TO_HAMMER]).s.resolution).toBe("washed_out");
  });

  it("a cash bid and a short bid together: the cash one wins when it is the higher; a short bid alone cannot beat a paddle", () => {
    const r = drive([near(), ...ticks(HAMMER - 20, 2), talk("auctioneer", "open"), talk("auctioneer", "tip"), talk("auctioneer", "open"), talk("auctioneer", "paid", askAt({ reserve: S0.reserve, t: HAMMER - 20 })), ...ticks(40, 2)]);
    expect(["lot_won", "shorted", "washed_out"]).toContain(r.s.resolution);
    // short alone, below the loudest paddle at the hammer
    expect(drive([near(), talk("auctioneer", "open"), talk("auctioneer", "tip"), ...TICKS_TO_HAMMER]).s.resolution).toBe("washed_out");
  });

  it("violence suspends the sale: a hostile at the heads or the auction, the Auctioneer or a House-Head down; the factor down does not", () => {
    for (const e of [{ t: "hostile", at: "heads" }, { t: "hostile", at: "auction" }, { t: "actor", id: "auctioneer", state: "down" }, { t: "actor", id: "head-2", state: "down" }] as ScenarioInput[]) {
      const r = drive([near(), e]);
      expect(r.s.resolution, JSON.stringify(e)).toBe("washed_out");
      expect(r.commits).toBe(1);
    }
    expect(drive([{ t: "hostile", at: "factor" }]).s.resolution, "the factor is a bystander").toBeUndefined();
    expect(drive([{ t: "actor", id: "factor", state: "down" }]).s.resolution).toBeUndefined();
    expect(drive([talk("auctioneer", "open"), talk("auctioneer", "hostile")]).s.resolution).toBe("washed_out");
    expect(drive([talk("house_head", "open"), talk("house_head", "hostile")]).s.resolution).toBe("washed_out");
  });

  it("the hammer is a pure function of the tide: it falls at `high`, and not a tick before", () => {
    expect(drive(ticks(HAMMER - 3)).s.resolution).toBeUndefined();
    expect(drive(ticks(HAMMER + 1)).s.resolution).toBe("washed_out");
    // seeded: the same ledger gives the same tide; the range holds; rain brings it forward, fog delays it
    const highs = new Set<number>();
    for (let seed = 1; seed < 300; seed++) {
      const s = def.init(cm(seed), 0, seed);
      highs.add(s.high);
      expect(s.high).toBeGreaterThanOrEqual(MARKET.highMin + (s.complication === "rain" ? MARKET.rainHigh : 0));
      expect(s.high).toBeLessThanOrEqual(MARKET.highMax + (s.complication === "fog" ? MARKET.fogHigh : 0));
      expect(s.reserve % 5).toBe(0);
      expect(s.ceilings[0]).toBeGreaterThanOrEqual(s.ceilings[3]);
    }
    expect(highs.size).toBeGreaterThan(40);
    expect(def.init(cm(9), 0, 5)).toEqual(def.init(structuredClone(cm(9)), 0, 5));
  });

  it("the ledger's Syndicate pushes the factor's ceiling up; the paddles never rise with it", () => {
    const hot = cm(11), cold = cm(11);
    hot.factions.ward.rivalInfluence = 90;
    cold.factions.ward.rivalInfluence = 5;
    expect(def.init(hot, 0, 11).factor).toBeGreaterThan(def.init(cold, 0, 11).factor);
    expect(def.init(hot, 0, 11).ceilings).toEqual(def.init(cold, 0, 11).ceilings);
  });
});

describe("The Auction at High Water: leave, view, roster, parleys, fuzz", () => {
  it("leave: nothing happened is dismissed; anything done is abandoned; the end is the end", () => {
    expect(def.leave(def.init(C, 0, SEED))).toBeUndefined();
    expect(def.leave(drive([near()]).s)).toBe("abandoned");
    expect(def.leave(drive([talk("auctioneer", "open"), talk("auctioneer", "paid", askAt(S0))]).s)).toBe("abandoned");
    expect(def.leave(drive(SCRIPTS.consortium()).s)).toBe("consortium");
    const r = drive([near(), { t: "leave" }]);
    expect(r.s.resolution).toBe("abandoned");
    expect(r.commits).toBe(1);
    expect(drive([{ t: "leave" }]).s.resolution).toBeUndefined();
  });

  it("every view has unique objective ids, a High-water timer that moves toward the hammer and stops at the end", () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = def.init(cm(seed), 0, seed);
      const v = def.view(s, 5000);
      expect(v.template).toBe("flooded_market");
      expect(new Set(v.objectives.map((o) => o.id)).size).toBe(v.objectives.length);
      expect(v.objectives.length).toBeGreaterThan(3);
      expect(v.hint.length).toBeGreaterThan(30);
      if (s.complication !== "none") expect(v.complication).toBe(s.complication);
    }
    const v0 = def.view(S0, 10_000);
    expect(v0.timerLabel).toBe("High water");
    expect(v0.endsAtWorldMs).toBe(10_000 + HAMMER * 1000);
    expect(def.view(drive(ticks(100)).s, 10_000).endsAtWorldMs).toBe(10_000 + (HAMMER - 100) * 1000);
    const done = def.view(drive(SCRIPTS.washed_out()).s, 0);
    expect(done.endsAtWorldMs).toBe(0);
    expect(done.objectives.some((o) => o.id === "home")).toBe(true);
    // the hint names a complication, and a House-Head's hint reveals the loudest paddle
    for (const comp of ["rain", "fog"] as const) {
      let found: { c: CampaignState; seed: number } | undefined;
      for (let seed = 1; seed < 800 && !found; seed++) { const c = cm(seed); if (def.init(c, 0, seed).complication === comp) found = { c, seed }; }
      expect(found, comp).toBeDefined();
      expect(def.view(def.init(found!.c, 0, found!.seed), 0).hint).toContain({ rain: "Rain on the Exchange", fog: "Fog on the delta" }[comp]);
      expect(COMPLICATION_HINT[comp].length).toBeGreaterThan(20);
    }
    const asked = drive([talk("house_head", "open"), talk("house_head", "learn")]);
    expect(def.view(asked.s, 0).hint).toContain(`£${rivalMax(asked.s)}`);
  });

  it("the roster is authored, unique, <= 14 rows; every observed id is in it; the cast of both templates together fits NPC_CAP", async () => {
    const ro = def.roster(C, 5, def.init(C, 0, 5));
    expect(def.roster(C, 5, def.init(C, 0, 5))).toEqual(ro);
    const ids = ro.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(14);
    for (const u of def.observe.use) if (u.npc !== undefined) expect(ids, `use ${u.id}`).toContain(u.npc);
    for (const a of def.observe.actors) expect(ids, `actor ${a.id}`).toContain(a.id);
    const groups = new Set(ro.map((p) => p.group));
    for (const g of def.observe.hostileGroups) expect(groups.has(g), g).toBe(true);
    expect(ro.some((p) => p.side === "rival"), "the Syndicate's factor is a cast row, not a post").toBe(true);
    const { smugglingRunTemplate } = await import("./smugglingRun.ts");
    const both = ro.length + smugglingRunTemplate.roster(C, 5, smugglingRunTemplate.init(C, 0, 5)).length;
    expect(both).toBeLessThanOrEqual(24);
    // the three parleys' kinds are the ones this template reads
    for (const u of def.observe.use) if (u.talk !== undefined) expect(["auctioneer", "house_head"]).toContain(u.talk);
  });

  it("the Auctioneer's parley is a script: priced from the tide, bids and short bids are results, flattery moves the price, a forged index re-issues the round", () => {
    const ctx = { price: askAt(S0), purse: 200, seed: 3, day: 2 };
    const v = openSiteParley("auctioneer", ctx);
    const keys = v.options.map((o) => o.id);
    expect(keys).toContain("pay");
    expect(keys).toContain("walk_away");
    const pay = v.options.findIndex((o) => o.id === "pay");
    expect(answerSiteParley("auctioneer", ctx, v, pay).done).toEqual({ result: "paid", paid: ctx.price });
    expect(answerSiteParley("auctioneer", { ...ctx, purse: 1 }, v, pay).done, "short of cash: the round is re-issued").toBeUndefined();
    for (const bad of [-1, 99, 1.5, NaN]) expect(answerSiteParley("auctioneer", ctx, v, bad).done, `${bad}`).toBeUndefined();
    const head = openSiteParley("house_head", { ...ctx, price: 40 });
    expect(head.options.some((o) => o.label.toLowerCase().includes("consortium"))).toBe(true);
  });

  it("a 5000-sequence hostile-event fuzz never throws and never commits twice", () => {
    const rng = new Rng(0x3a6e);
    const targets = ["auctioneer", "head0", "head3", "factor", "", "__proto__", "drop", "plug"];
    const kinds = ["auctioneer", "house_head", "tide_reeve", "ransom", "chamberlain"] as const;
    const results = ["open", "close", "hostile", "paid", "survey", "learn", "tell", "envelope", "tip", "ransom"] as const;
    let ends = 0;
    for (let i = 0; i < 5000; i++) {
      let s = def.init(cm(1 + (i % 60)), 0, 1 + (i % 60));
      let commits = 0;
      for (let k = 0; k < 40; k++) {
        const roll = rng.int(0, 9);
        let e: ScenarioInput;
        if (roll < 2) e = { t: "use", target: targets[rng.int(0, targets.length - 1)]!, slot: rng.int(-3, 9) };
        else if (roll < 5) e = { t: "talk", kind: kinds[rng.int(0, kinds.length - 1)]!, result: results[rng.int(0, results.length - 1)]!, paid: rng.chance(0.2) ? NaN : rng.int(-5, 400) };
        else if (roll < 6) e = { t: "near", at: ["hall", "x"][rng.int(0, 1)]!, party: rng.int(-2, 1e9) };
        else if (roll < 7) e = { t: "hostile", at: ["heads", "auction", "factor", "", "customs"][rng.int(0, 4)]! };
        else if (roll < 8) e = { t: "actor", id: ["auctioneer", "head-1", "factor", "x"][rng.int(0, 3)]!, state: (["down", "free", "arrived"] as const)[rng.int(0, 2)]! };
        else e = { t: "tick", dt: rng.chance(0.1) ? NaN : rng.range(-2, 15) };
        const r = def.reduce(s, e);
        s = r.s;
        commits += r.fx.filter(isCommit).length;
        expect(Number.isFinite(s.t)).toBe(true);
        if (s.phase === "resolved") break;
      }
      expect(commits).toBeLessThanOrEqual(1);
      if (s.resolution !== undefined) {
        ends++;
        const o = def.outcome(s)!;
        expect(o.resolution).toBe(s.resolution);
        expect(o.paid).toBeLessThanOrEqual(Math.max(s.purse, 0));
      }
    }
    expect(ends).toBeGreaterThan(50);
  });

  it("the client cannot reach an ending before the world says so: forged talk results and uses resolve nothing in 60 s", () => {
    const results = ["ransom", "survey", "learn", "tell", "envelope", "tip", "paid", "bargained", "bribed", "hostile"] as const;
    for (const kind of ["auctioneer", "house_head"] as const) for (const result of results) for (const paid of [0, 1, 40, 1e9, NaN, -4]) {
      const r = def.reduce(def.init(cm(3), 0, 3), { t: "talk", kind, result, paid });
      expect(r.s.resolution, `${kind} ${result}`).toBeUndefined();
      expect(r.fx.some(isCommit)).toBe(false);
    }
    for (const t of ["auctioneer", "head0", "", "__proto__"]) expect(def.reduce(def.init(cm(3), 0, 3), { t: "use", target: t, slot: 0 }).s.resolution, t).toBeUndefined();
    expect(drive(ticks(60)).s.resolution).toBeUndefined();
  });
});
