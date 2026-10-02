import { describe, expect, it } from "vitest";
import type { CampaignState, Leverage, ParleyStep, ParleyView, FactionStance } from "./campaignTypes.ts";
import { applyOutcome, askingToll, leverageOf, newCampaign, stanceOf } from "./factions.ts";
import { MAX_ROUND, answerParley, bribeCost, flatterAvailable, flatterOdds, openParley, pleadOdds, threatenOdds } from "./negotiation.ts";
import type { ScenarioOutcome } from "./campaignTypes.ts";

const STANCE_STATE: Record<FactionStance, { trust: number; grievance: number; fear: number }> = {
  hostile: { trust: 0, grievance: 40, fear: 0 }, wary: { trust: 10, grievance: 10, fear: 0 }, neutral: { trust: 35, grievance: 15, fear: 10 },
  warm: { trust: 60, grievance: 10, fear: 0 }, allied: { trust: 90, grievance: 5, fear: 0 },
};
const campaignAt = (s: FactionStance, need: CampaignState["factions"]["ward"]["need"] = "coin"): CampaignState => {
  const c = newCampaign(21);
  c.factions.ward = { ...c.factions.ward, ...STANCE_STATE[s], need };
  return c;
};
const lv = (c: CampaignState, over: Partial<Leverage> = {}): Leverage => ({ ...leverageOf(c, { armed: 4, garrisonAlive: 6, garrisonTotal: 6, partyWounded: 0 }), ...over });
const ids = (v: ParleyView): string[] => v.options.map((o) => o.id);

/** Play a policy to the end: pick `want` whenever offered, else the fallback list in order. Returns the final step and rounds taken. */
function play(c: CampaignState, l: Leverage, seed: number, want: string[]): { step: ParleyStep; rounds: number } {
  let view = openParley(c, l, seed);
  for (let n = 1; n <= 10; n++) {
    const i = want.map((w) => ids(view).indexOf(w)).find((k) => k >= 0) ?? ids(view).length - 1;
    const step = answerParley(c, l, seed, view, i);
    if (step.done) return { step, rounds: n };
    view = step.view;
  }
  throw new Error("parley did not end");
}

describe("openParley", () => {
  it("opens at the asking toll with the Lamp-Warden speaking, deterministic, no stray placeholders", () => {
    for (const s of ["hostile", "wary", "neutral", "warm", "allied"] as const) {
      const c = campaignAt(s);
      const a = openParley(c, lv(c), 7), b = openParley(c, lv(c), 7);
      expect(a).toEqual(b);
      expect(a).toMatchObject({ round: 1, toll: askingToll(c), mood: s });
      expect(a.speaker).toContain("Ysolde Hask");
      expect(a.line).toContain(`£${a.toll}`);
      expect(a.line).not.toMatch(/[{}]|undefined|NaN/);
      expect(ids(a)).toContain("walk_away");
    }
    expect(stanceOf(campaignAt("wary").factions.ward)).toBe("wary");
  });

  it("varies with the seed and remembers the last visit", () => {
    const c = campaignAt("neutral");
    expect(new Set(Array.from({ length: 30 }, (_, s) => openParley(c, lv(c), s).line)).size).toBeGreaterThan(3);
    const out: ScenarioOutcome = { scenario: "secure_crossing", resolution: "forced", toll: 50, paid: 0, bridge: "intact", tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 1, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 }, brokePromise: false, seconds: 60 };
    const after = applyOutcome(c, out);
    expect(openParley(after, lv(after), 3).line).toMatch(/guns|dents|bed named/);
  });
});

describe("options are honest", () => {
  it("flatter only when the Ward needs deference or trust >= 40; threaten only with >= 2 armed", () => {
    for (const s of ["hostile", "wary", "neutral", "warm", "allied"] as const) {
      for (const need of ["coin", "arms", "medicine", "deference"] as const) {
        const c = campaignAt(s, need);
        for (const armed of [0, 1, 2, 5]) {
          const v = openParley(c, lv(c, { armed }), 1);
          expect(ids(v).includes("haggle_flatter")).toBe(need === "deference" || c.factions.ward.trust >= 40);
          expect(ids(v).includes("haggle_threaten")).toBe(armed >= 2);
        }
      }
    }
    expect(flatterAvailable(campaignAt("neutral", "deference"))).toBe(true);
  });

  it("pay and bribe need the money; walking away is always there", () => {
    const c = campaignAt("neutral");
    const broke = openParley(c, lv(c, { purse: 0 }), 1);
    expect(ids(broke)).not.toContain("pay");
    expect(ids(broke)).not.toContain("bribe");
    expect(ids(broke)).toContain("walk_away");
    const cost = bribeCost(c, broke.toll, "neutral");
    expect(ids(openParley(c, lv(c, { purse: cost }), 1))).toContain("bribe");
    expect(ids(openParley(c, lv(c, { purse: cost - 1 }), 1))).not.toContain("bribe");
    expect(cost).toBeLessThan(broke.toll);
    expect(bribeCost(campaignAt("hostile"), 50, "hostile")).toBeGreaterThan(bribeCost(campaignAt("neutral"), 50, "neutral"));
  });

  it("the odds read the state: fear, a bloodied garrison and extra guns help a threat; trust and deference help flattery", () => {
    const c = campaignAt("neutral");
    const base = threatenOdds(c, lv(c));
    expect(threatenOdds({ ...c, factions: { ...c.factions, ward: { ...c.factions.ward, fear: 80 } } }, lv(c))).toBeGreaterThan(base);
    expect(threatenOdds(c, lv(c, { garrisonAlive: 2 }))).toBeGreaterThan(base);
    expect(threatenOdds(c, lv(c, { armed: 8 }))).toBeGreaterThan(base);
    expect(threatenOdds(c, lv(c, { armed: 2 }))).toBeLessThan(base);
    const f0 = flatterOdds(c, "neutral");
    expect(flatterOdds(campaignAt("neutral", "deference"), "neutral")).toBeGreaterThan(f0);
    expect(flatterOdds(campaignAt("allied"), "neutral")).toBeGreaterThan(f0);
    expect(flatterOdds({ ...c, factions: { ...c.factions, ward: { ...c.factions.ward, rivalInfluence: 100 } } }, "neutral")).toBeLessThan(f0);
    for (const s of ["hostile", "allied"] as const) { const p = flatterOdds(campaignAt(s), s); expect(p).toBeGreaterThanOrEqual(0.1); expect(p).toBeLessThanOrEqual(0.9); }
  });
});

describe("every road ends in at most four rounds", () => {
  const policies: Record<string, string[]> = {
    pay: ["pay", "walk_away"], bribe: ["bribe", "pay", "walk_away"], walk: ["walk_away"],
    flatter: ["haggle_flatter", "pay", "bribe", "walk_away"], threaten: ["haggle_threaten", "pay", "bribe", "walk_away"],
    haggleBoth: ["haggle_flatter", "haggle_threaten", "pay", "walk_away"],
  };
  it("from every stance, need and seed, each policy reaches a done; nothing is a dead end", () => {
    const seen = new Set<string>();
    for (const s of ["hostile", "wary", "neutral", "warm", "allied"] as const) {
      for (const need of ["coin", "deference"] as const) {
        const c = campaignAt(s, need);
        for (let seed = 0; seed < 60; seed++) {
          for (const [name, want] of Object.entries(policies)) {
            const { step, rounds } = play(c, lv(c, { purse: 500 }), seed, want);
            expect(rounds, `${s}/${need}/${seed}/${name}`).toBeLessThanOrEqual(MAX_ROUND);
            expect(step.done).toBeDefined();
            expect(step.done ? step.line : "").not.toMatch(/[{}]|undefined|NaN/);
            seen.add(step.done!.resolution);
            const d = step.done!;
            if (d.resolution === "paid" || d.resolution === "bargained") expect(d.paid).toBe(d.toll);
            if (d.resolution === "walked_away" || d.resolution === "hostile") expect(d.paid).toBe(0);
            if (d.resolution === "bribed") expect(d.paid).toBeGreaterThan(0);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(["bargained", "bribed", "hostile", "paid", "walked_away"]);   // every ending is reachable
  });

  it("a broke party still has a way out", () => {
    const c = campaignAt("hostile");
    const { step } = play(c, lv(c, { purse: 0, armed: 0 }), 4, ["pay", "walk_away"]);
    expect(step.done?.resolution).toBe("walked_away");
  });

  it("a successful haggle lowers the price and pays out as bargained; the last round offers no haggling", () => {
    const c = campaignAt("warm", "deference");
    let got = false;
    for (let seed = 0; seed < 40 && !got; seed++) {
      const v = openParley(c, lv(c), seed);
      const s1 = answerParley(c, lv(c), seed, v, ids(v).indexOf("haggle_flatter"));
      if (s1.view && s1.view.toll < v.toll) {
        got = true;
        expect(s1.view.round).toBe(2);
        const s2 = answerParley(c, lv(c), seed, s1.view, ids(s1.view).indexOf("pay"));
        expect(s2.done?.resolution).toBe("bargained");
        expect(s2.done!.paid).toBe(s1.view.toll);
      }
    }
    expect(got).toBe(true);
    let view = openParley(c, lv(c), 5);
    for (let r = 1; r < MAX_ROUND; r++) { const s = answerParley(c, lv(c), 5, view, ids(view).indexOf("haggle_flatter")); if (!s.view) break; view = s.view; }
    if (view.round === MAX_ROUND) expect(ids(view).some((i) => i.startsWith("haggle"))).toBe(false);
  });

  it("a threat can be called: with poor odds some seeds end the talking", () => {
    const c = campaignAt("neutral");
    const l = lv(c, { armed: 2, garrisonAlive: 6, garrisonTotal: 6 });
    const ends = new Set(Array.from({ length: 80 }, (_, seed) => {
      const v = openParley(c, l, seed);
      const s = answerParley(c, l, seed, v, ids(v).indexOf("haggle_threaten"));
      return s.done ? s.done.resolution : s.view.toll < v.toll ? "cheaper" : "dearer";
    }));
    expect(ends.has("hostile")).toBe(true);
    expect(ends.has("cheaper")).toBe(true);
    // with a bloodied garrison and a steady crowd it nearly always works
    const strong = { ...c, factions: { ...c.factions, ward: { ...c.factions.ward, fear: 80 } } };
    const ls = lv(strong, { armed: 6, garrisonAlive: 1, garrisonTotal: 6 });
    let worked = 0;
    for (let seed = 0; seed < 80; seed++) { const v = openParley(strong, ls, seed); const s = answerParley(strong, ls, seed, v, ids(v).indexOf("haggle_threaten")); if (s.view && s.view.toll < v.toll) worked++; }
    expect(worked).toBeGreaterThan(60);
  });
});

describe("hostile input", () => {
  it("bad indexes, forged or stale views never throw and never skip a round", () => {
    const c = campaignAt("neutral");
    const l = lv(c, { purse: 10 });
    const v = openParley(c, l, 2);
    for (const bad of [-1, 99, NaN, 1.5, Infinity, "0" as unknown as number, undefined as unknown as number]) {
      let s!: ParleyStep;
      expect(() => { s = answerParley(c, l, 2, v, bad); }).not.toThrow();
      expect(s.done).toBeUndefined();
      expect(s.view!.round).toBe(1);
    }
    // a forged view that claims an affordable pay at a silly price: the server recomputes what is on offer
    const forged: ParleyView = { ...v, toll: 1, round: 99, mood: "nonsense" as FactionStance, options: [{ id: "bribe", label: "x", cost: 0, hint: "" }] };
    let s!: ParleyStep;
    expect(() => { s = answerParley(c, lv(c, { purse: 0 }), 2, forged, 0); }).not.toThrow();
    expect(s.done).toBeUndefined();
    expect(() => answerParley(c, l, 2, null as unknown as ParleyView, 0)).not.toThrow();
    // an option the state does not offer (threaten with one gun) is refused, not granted
    const cheat: ParleyView = { ...v, options: [{ id: "haggle_threaten", label: "x", cost: 0, hint: "" }] };
    const s2 = answerParley(c, lv(c, { armed: 1 }), 2, cheat, 0);
    expect(s2.done).toBeUndefined();
  });

  it("is deterministic for a given seed and differs across seeds", () => {
    const c = campaignAt("neutral");
    const l = lv(c);
    const v = openParley(c, l, 11);
    const i = ids(v).indexOf("haggle_flatter") >= 0 ? ids(v).indexOf("haggle_flatter") : ids(v).indexOf("haggle_threaten");
    expect(answerParley(c, l, 11, v, i)).toEqual(answerParley(c, l, 11, v, i));
    const outs = new Set(Array.from({ length: 40 }, (_, s) => JSON.stringify(answerParley(c, l, s, openParley(c, l, s), i))));
    expect(outs.size).toBeGreaterThan(3);
  });
});

describe("D-047: a party short of the toll can turn out its pockets", () => {
  it("offered exactly when the purse is short of the toll but holds at least £10; it offers the whole purse, never more", () => {
    const c = campaignAt("wary", "coin");
    const toll = askingToll(c);
    expect(toll).toBeGreaterThan(12);
    const offer = (purse: number) => openParley(c, lv(c, { purse, armed: 0 }), 3).options.find((o) => o.id === "plead");
    expect(offer(toll), "a purse that covers the toll pays it").toBeUndefined();
    expect(offer(9), "under £10 there is nothing to plead with").toBeUndefined();
    const o = offer(toll - 3)!;
    expect(o.cost).toBe(toll - 3);
    expect(o.label).toContain(`£${toll - 3}`);
    expect(o.hint).toMatch(/odds/);
  });

  it("the D-041 case: alone, poor, at a Ward that neither needs deference nor trusts the Society, there is now more than the door", () => {
    const c = campaignAt("wary", "coin");
    const view = openParley(c, lv(c, { purse: Math.floor(askingToll(c) / 2), armed: 0 }), 5);
    expect(ids(view)).not.toContain("pay");
    expect(ids(view)).not.toContain("haggle_flatter");
    expect(ids(view)).not.toContain("haggle_threaten");
    expect(ids(view)).toContain("plead");
  });

  it("accepted, it settles as bargained at what was paid (paid == toll, never above the purse); refused, the price stands and the talk goes on; at the last call a refusal ends it at the door; always within four rounds", () => {
    let accepted = 0, refusedThenOn = 0, lastCallRefused = 0;
    for (const s of ["hostile", "wary", "neutral", "warm", "allied"] as const) {
      const c = campaignAt(s, "coin");
      const purse = Math.max(10, askingToll(c) - 8);
      for (let seed = 0; seed < 80; seed++) {
        const l = lv(c, { purse, armed: 0 });
        const { step, rounds } = play(c, l, seed, ["plead", "walk_away"]);
        expect(rounds).toBeLessThanOrEqual(MAX_ROUND);
        expect(step.done ? step.line : "").not.toMatch(/[{}]|undefined|NaN/);
        const d = step.done!;
        if (d.resolution === "bargained") {
          accepted++;
          expect(d.paid).toBe(purse);
          expect(d.toll).toBe(purse);
        } else {
          expect(d.resolution).toBe("walked_away");
          expect(d.paid).toBe(0);
        }
        const first = answerParley(c, l, seed, openParley(c, l, seed), ids(openParley(c, l, seed)).indexOf("plead"));
        if (first.view) {
          refusedThenOn++;
          expect(first.view.round).toBe(2);
          expect(first.view.toll).toBe(openParley(c, l, seed).toll);
        }
        if (rounds === MAX_ROUND && d.resolution === "walked_away") lastCallRefused++;
      }
    }
    expect(accepted).toBeGreaterThan(50);
    expect(refusedThenOn).toBeGreaterThan(20);
    expect(lastCallRefused).toBeGreaterThan(0);
  });

  it("the odds: nearer the toll, more trust, a Ward short of coin all help; anger and the Syndicate's hold hurt; always 0.1..0.85", () => {
    const c = campaignAt("neutral", "coin");
    const t = 60;
    const at = (cc: CampaignState, purse: number, mood: FactionStance = "neutral") => pleadOdds(cc, lv(cc, { purse }), t, mood);
    expect(at(c, 55)).toBeGreaterThan(at(c, 15));
    expect(at(campaignAt("warm", "coin"), 40)).toBeGreaterThan(at(c, 40));
    expect(at(c, 40)).toBeGreaterThan(at(campaignAt("neutral", "deference"), 40));
    expect(at(c, 40, "hostile")).toBeLessThan(at(c, 40));
    const syn = campaignAt("neutral", "coin");
    syn.factions.ward = { ...syn.factions.ward, rivalInfluence: 90 };
    expect(at(syn, 40)).toBeLessThan(at(c, 40));
    for (const s of ["hostile", "allied"] as const) for (const p of [10, 59]) for (const m of ["hostile", "allied"] as const) {
      const v = at(campaignAt(s), p, m);
      expect(v).toBeGreaterThanOrEqual(0.1);
      expect(v).toBeLessThanOrEqual(0.85);
    }
  });

  it("a forged plea (a bigger purse claimed in the view, or a plea where none was offered) changes nothing", () => {
    const c = campaignAt("wary");
    const rich = lv(c, { purse: 500 });
    const forged: ParleyView = { ...openParley(c, rich, 2), options: [{ id: "plead", label: "x", cost: 5, hint: "" }] };
    const step = answerParley(c, rich, 2, forged, 0);
    expect(step.done).toBeUndefined();
    expect(step.view!.round).toBe(1);
  });
});
