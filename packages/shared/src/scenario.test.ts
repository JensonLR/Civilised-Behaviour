import { describe, expect, it } from "vitest";
import type { CampaignState, ResolutionId, ScenarioEffect, ScenarioPhase } from "./campaignTypes.ts";
import { RESOLVED_LINGER_S, RIVAL_ARRIVES_S, RIVAL_PARLEY_S } from "./campaignTypes.ts";
import { newCampaign } from "./factions.ts";
import { Rng } from "./rng.ts";
import {
  SCENARIO, lingerOver, newScenario, reduceScenario, scenarioOutcome, scenarioView, zeroTally, type CrossingPhase,
  type ScenarioInput, type ScenarioState,
} from "./scenario.ts";

const camp = (seed = 7, patch?: (c: CampaignState) => void): CampaignState => {
  const c = newCampaign(seed);
  patch?.(c);
  return c;
};
/** Feeds events in order; returns the final state and every effect emitted. */
const run = (s: ScenarioState, ...events: ScenarioInput[]): { s: ScenarioState; fx: ScenarioEffect[] } => {
  const fx: ScenarioEffect[] = [];
  for (const e of events) {
    const r = reduceScenario(s, e);
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx };
};
const tick = (s: ScenarioState, seconds: number, dt = 0.5): { s: ScenarioState; fx: ScenarioEffect[] } => {
  const fx: ScenarioEffect[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const r = reduceScenario(s, { t: "tick", dt });
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx };
};
// a campaign where the Syndicate does not come early, so timing tests are exact
const calm = (): CampaignState => {
  for (let seed = 1; seed < 500; seed++) {
    const c = camp(seed);
    if (newScenario(c).complication === "none") return c;
  }
  throw new Error("no calm seed");
};
const base = (): ScenarioState => newScenario(calm(), 40);
const at = (phase: ScenarioPhase & (CrossingPhase | "resolved")): ScenarioState => {
  const s = base();
  switch (phase) {
    case "approach": return s;
    case "standoff": return run(s, { t: "arrive", party: 2 }).s;
    case "parley": return run(s, { t: "arrive", party: 2 }, { t: "parley_open" }).s;
    case "fighting": return run(s, { t: "arrive", party: 2 }, { t: "hostile" }).s;
    case "rigging": return run(s, { t: "arrive", party: 2 }, { t: "charge_set" }).s;
    case "resolved": return run(s, { t: "arrive", party: 2 }, { t: "parley_open" }, { t: "deal", resolution: "paid", toll: 40, paid: 40 }).s;
  }
};

const EVENTS: ScenarioInput[] = [
  { t: "tick", dt: 1 }, { t: "arrive", party: 1 }, { t: "arrive", party: 0 }, { t: "parley_open" }, { t: "parley_close" },
  { t: "deal", resolution: "paid", toll: 40, paid: 40 }, { t: "deal", resolution: "bribed", toll: 20, paid: 20 }, { t: "hostile" },
  { t: "garrison", alive: 2, routed: 1, total: 6 }, { t: "charge_set" }, { t: "bridge_fell", onBridge: 0 }, { t: "party_down" },
  { t: "tally", add: { wounded: 1 } }, { t: "weather", rain: 0.9 },
];
const PHASES: (CrossingPhase | "resolved")[] = ["approach", "standoff", "parley", "fighting", "rigging", "resolved"];

describe("reducer: every (phase, event) pair", () => {
  it("never throws, keeps a legal phase, and never reopens a resolution", () => {
    for (const p of PHASES) {
      for (const e of EVENTS) {
        const s0 = at(p);
        const { s, fx } = reduceScenario(s0, e);
        expect(PHASES, `${p} + ${e.t}`).toContain(s.phase);
        if (p === "resolved") {
          expect(s.resolution, `${p} + ${e.t}`).toBe(s0.resolution);
          expect(s.phase).toBe("resolved");
          expect(fx, "no effects after the end").toEqual([]);
        }
        // the input is never mutated
        expect(s0).toEqual(at(p));
        if (e.t !== "tick") expect(s.t).toBe(s0.t);
      }
    }
  });

  const next: [CrossingPhase | "resolved", ScenarioInput, CrossingPhase | "resolved"][] = [
    ["approach", { t: "arrive", party: 3 }, "standoff"],
    ["approach", { t: "arrive", party: 0 }, "approach"],
    ["approach", { t: "hostile" }, "fighting"],
    ["approach", { t: "deal", resolution: "paid", toll: 40, paid: 40 }, "approach"],
    ["standoff", { t: "parley_open" }, "parley"],
    ["standoff", { t: "hostile" }, "fighting"],
    ["standoff", { t: "charge_set" }, "rigging"],
    ["standoff", { t: "deal", resolution: "paid", toll: 40, paid: 40 }, "standoff"],
    ["parley", { t: "parley_close" }, "standoff"],
    ["parley", { t: "hostile" }, "fighting"],
    ["parley", { t: "charge_set" }, "rigging"],
    ["parley", { t: "deal", resolution: "bargained", toll: 25, paid: 25 }, "resolved"],
    ["fighting", { t: "parley_open" }, "fighting"],
    ["fighting", { t: "charge_set" }, "rigging"],
    ["fighting", { t: "deal", resolution: "paid", toll: 40, paid: 40 }, "fighting"],
    ["rigging", { t: "parley_open" }, "rigging"],
    ["rigging", { t: "hostile" }, "rigging"],
    ["rigging", { t: "bridge_fell", onBridge: 0 }, "resolved"],
    ["approach", { t: "party_down" }, "resolved"],
    ["fighting", { t: "party_down" }, "resolved"],
  ];
  for (const [from, ev, to] of next) {
    it(`${from} + ${ev.t}${"resolution" in ev ? `(${ev.resolution})` : ""} -> ${to}`, () => {
      expect(reduceScenario(at(from), ev).s.phase).toBe(to);
    });
  }
});

describe("resolutions", () => {
  it("a deal needs an open parley and one of the three negotiated endings", () => {
    const parley = at("parley");
    for (const r of ["forced", "sabotaged", "rival_secured", "abandoned"] as const) {
      const bad = { t: "deal", resolution: r, toll: 1, paid: 1 } as unknown as ScenarioInput;
      expect(reduceScenario(parley, bad).s.phase).toBe("parley");
    }
    const { s, fx } = reduceScenario(parley, { t: "deal", resolution: "bribed", toll: 22, paid: 22 });
    expect(s.resolution).toBe("bribed");
    expect(fx).toEqual(["garrison_stand_down", "gate_open", "commit"]);
  });

  it("forced needs a hostile garrison and 60% dead or routed", () => {
    const s = at("fighting");
    expect(reduceScenario(s, { t: "garrison", alive: 4, routed: 0, total: 6 }).s.phase).toBe("fighting"); // 2 of 6 is 33%
    expect(reduceScenario(s, { t: "garrison", alive: 3, routed: 1, total: 6 }).s.phase).toBe("fighting"); // 50%
    const r = reduceScenario(s, { t: "garrison", alive: 2, routed: 1, total: 6 });
    expect(r.s.resolution).toBe("forced");
    expect(r.fx).toContain("commit");
    // not hostile (the garrison merely left): nothing is forced
    expect(reduceScenario(at("standoff"), { t: "garrison", alive: 0, routed: 6, total: 6 }).s.phase).toBe("standoff");
  });

  it("bridge_fell beats fighting, and a rout cannot steal it while the fuse burns", () => {
    let s = at("fighting");
    s = run(s, { t: "charge_set" }).s;
    expect(s.phase).toBe("rigging");
    s = reduceScenario(s, { t: "garrison", alive: 0, routed: 0, total: 6 }).s; // everyone dead, fuse still lit
    expect(s.phase).toBe("rigging");
    expect(reduceScenario(s, { t: "bridge_fell", onBridge: 2 }).s.resolution).toBe("sabotaged");
  });

  it("bridge_fell without a lit charge is ignored (nothing but a charge can drop the bridge)", () => {
    for (const p of ["approach", "standoff", "parley", "fighting"] as const) expect(reduceScenario(at(p), { t: "bridge_fell", onBridge: 0 }).s.phase).toBe(p);
  });

  it("party_down abandons the expedition", () => {
    expect(run(at("fighting"), { t: "party_down" }).s.resolution).toBe("abandoned");
  });

  it("a second charge and a second hostile are ignored", () => {
    const a = run(at("standoff"), { t: "charge_set" });
    const b = reduceScenario(a.s, { t: "charge_set" });
    expect(b.fx).toEqual([]);
    expect(b.s.fuse).toBe(a.s.fuse);
    expect(reduceScenario(at("fighting"), { t: "hostile" }).fx).toEqual([]);
  });

  it("talking first and then turning on her counts as a broken promise; shooting cold does not", () => {
    expect(run(at("parley"), { t: "hostile" }).s.brokePromise).toBe(true);
    expect(run(at("parley"), { t: "charge_set" }).s.brokePromise).toBe(true);
    expect(run(at("parley"), { t: "parley_close" }, { t: "hostile" }).s.brokePromise).toBe(false);
    expect(run(at("standoff"), { t: "hostile" }).s.brokePromise).toBe(false);
  });

  it("the first resolution wins: nothing afterwards changes it or commits again", () => {
    const done = at("resolved");
    const { s, fx } = run(done, { t: "hostile" }, { t: "charge_set" }, { t: "bridge_fell", onBridge: 1 }, { t: "party_down" }, { t: "garrison", alive: 0, routed: 0, total: 6 });
    expect(s.resolution).toBe("paid");
    expect(fx).toEqual([]);
    expect(tick(done, RIVAL_ARRIVES_S + 200).fx).toEqual([]);
  });

  it("fuzz: any event sequence commits at most once and never changes a resolution", () => {
    const rng = new Rng(99);
    for (let run_ = 0; run_ < 300; run_++) {
      let s = newScenario(camp(run_ + 1), 40);
      let commits = 0;
      let first: ResolutionId | undefined;
      for (let i = 0; i < 80; i++) {
        const e = EVENTS[rng.int(0, EVENTS.length - 1)]!;
        const r = reduceScenario(s, e.t === "tick" ? { t: "tick", dt: rng.range(0, 90) } : e);
        commits += r.fx.filter((f) => f === "commit").length;
        s = r.s;
        if (first === undefined) first = s.resolution;
        expect(s.resolution).toBe(first);
      }
      expect(commits).toBeLessThanOrEqual(1);
      expect(commits).toBe(first === undefined ? 0 : 1);
    }
  });
});

describe("the Syndicate and the weather (chaos director)", () => {
  it("walks at rivalAt, and buys the crossing RIVAL_PARLEY_S later if nobody has settled it", () => {
    const s = at("standoff");
    expect(s.rivalAt).toBe(RIVAL_ARRIVES_S);
    const a = tick(s, RIVAL_ARRIVES_S - 1);
    expect(a.s.rivalAdvanced).toBe(false);
    const b = tick(a.s, 2);
    expect(b.fx).toEqual(["rival_advance"]);
    const c = tick(b.s, RIVAL_PARLEY_S - 3);
    expect(c.s.phase).toBe("standoff");
    const d = tick(c.s, 4);
    expect(d.s.resolution).toBe("rival_secured");
    expect(d.fx).toContain("commit");
  });

  it("dawdlers lose it too: the party need never arrive", () => {
    expect(tick(base(), RIVAL_ARRIVES_S + RIVAL_PARLEY_S + 2).s.resolution).toBe("rival_secured");
  });

  it("holds back while a fuse burns or the garrison is fighting", () => {
    const rigging = run(at("standoff"), { t: "charge_set" }).s;
    const r = { ...rigging, t: RIVAL_ARRIVES_S + RIVAL_PARLEY_S + 5, rivalAdvanced: true, fuse: 3 };
    expect(reduceScenario(r, { t: "tick", dt: 0.1 }).s.phase).toBe("rigging");
    const f = { ...at("fighting"), t: RIVAL_ARRIVES_S + RIVAL_PARLEY_S + 5, rivalAdvanced: true };
    expect(reduceScenario(f, { t: "tick", dt: 0.1 }).s.phase).toBe("fighting");
  });

  it("a precedent-sniffing Syndicate (high influence) arrives early; it is deterministic in the campaign", () => {
    const c = camp(5, (x) => { x.factions.ward.rivalInfluence = 80; });
    const a = newScenario(c), b = newScenario(c);
    expect(a).toEqual(b);
    expect(a.complication).toBe("rival_scouts");
    expect(a.rivalAt).toBe(RIVAL_ARRIVES_S - SCENARIO.rivalEarlyBy);
    let early = 0;
    for (let i = 1; i <= 200; i++) if (newScenario(camp(i)).complication === "rival_scouts") early++;
    expect(early).toBeGreaterThan(20);
    expect(early).toBeLessThan(180);
  });

  it("rain wets the fuse: it burns at half speed, and the timer says so", () => {
    const dry = run(at("standoff"), { t: "charge_set" }).s;
    const wet = run(dry, { t: "weather", rain: 0.8 }).s;
    expect(tick(dry, 4).s.fuse).toBeCloseTo(SCENARIO.fuseSeconds - 4, 5);
    expect(tick(wet, 4).s.fuse).toBeCloseTo(SCENARIO.fuseSeconds - 2, 5);
    const v = scenarioView(wet, 1000);
    expect(v.timerLabel).toBe("Fuse");
    expect(v.endsAtWorldMs).toBe(1000 + SCENARIO.fuseSeconds * 2 * 1000);
    expect(v.hint).toMatch(/raining/);
  });
});

describe("pre-collapsed bridge", () => {
  const ruined = (): ScenarioState => newScenario(camp(3, (c) => { c.crossing.bridge = "collapsed"; }), 40);
  it("starts resolved with nothing to commit, forever", () => {
    const s = ruined();
    expect(s.phase).toBe("resolved");
    expect(scenarioOutcome(s)).toBeUndefined();
    const r = tick(s, RIVAL_ARRIVES_S + 300);
    expect(r.fx).toEqual([]);
    expect(lingerOver(r.s)).toBe(false);
    expect(scenarioView(r.s, 0).hint).toMatch(/ford/);
  });
});

describe("outcomes: each way ends somewhere different", () => {
  const ways: Record<string, () => ScenarioState> = {
    paid: () => run(at("standoff"), { t: "parley_open" }, { t: "deal", resolution: "paid", toll: 45, paid: 45 }).s,
    bargained: () => run(at("standoff"), { t: "parley_open" }, { t: "deal", resolution: "bargained", toll: 28, paid: 28 }).s,
    bribed: () => run(at("standoff"), { t: "parley_open" }, { t: "deal", resolution: "bribed", toll: 45, paid: 22 }).s,
    forced: () => run(at("standoff"), { t: "hostile" }, { t: "tally", add: { garrisonKilled: 3, garrisonRouted: 1, downed: 3 } }, { t: "garrison", alive: 2, routed: 1, total: 6 }).s,
    sabotaged: () => run(at("standoff"), { t: "charge_set" }, { t: "bridge_fell", onBridge: 0 }).s,
    rival_secured: () => tick(at("standoff"), RIVAL_ARRIVES_S + RIVAL_PARLEY_S + 1).s,
    abandoned: () => run(at("fighting"), { t: "party_down" }).s,
  };
  const outcomes = Object.fromEntries(Object.entries(ways).map(([k, f]) => [k, scenarioOutcome(f())!]));

  it("reaches the named resolution with a defined outcome", () => {
    for (const [k, o] of Object.entries(outcomes)) {
      expect(o, k).toBeDefined();
      expect(o.resolution).toBe(k);
      expect(o.scenario).toBe("secure_crossing");
    }
  });
  it("only sabotage takes the bridge; only the deals take money", () => {
    for (const [k, o] of Object.entries(outcomes)) expect(o.bridge, k).toBe(k === "sabotaged" ? "collapsed" : "intact");
    expect(outcomes.paid!.paid).toBe(45);
    expect(outcomes.bargained!.paid).toBe(28);
    expect(outcomes.bribed!.paid).toBe(22);
    expect(outcomes.forced!.paid).toBe(0);
  });
  it("forced carries its dead; every outcome is materially distinct", () => {
    expect(outcomes.forced!.tally.garrisonKilled).toBe(3);
    const keys = Object.keys(outcomes).map((k) => JSON.stringify({ r: outcomes[k]!.resolution, b: outcomes[k]!.bridge, t: outcomes[k]!.toll, p: outcomes[k]!.paid, y: outcomes[k]!.tally }));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("clamps hostile numbers in a deal", () => {
    const s = run(at("parley"), { t: "deal", resolution: "paid", toll: Number.NaN, paid: 1e12 }).s;
    expect(Number.isInteger(s.paid) && s.paid <= 9999).toBe(true);
    expect(Number.isFinite(s.toll)).toBe(true);
  });
});

describe("linger and view", () => {
  it("lingers RESOLVED_LINGER_S after a real resolution", () => {
    const s = at("resolved");
    expect(lingerOver(s)).toBe(false);
    expect(lingerOver(tick(s, RESOLVED_LINGER_S - 1).s)).toBe(false);
    expect(lingerOver(tick(s, RESOLVED_LINGER_S + 1).s)).toBe(true);
  });

  it("the view tells the truth at every phase", () => {
    for (const p of PHASES) {
      const v = scenarioView(at(p), 5000);
      expect(v.phase).toBe(p);
      expect(v.objectives.length).toBeGreaterThanOrEqual(2);
      expect(v.hint.length).toBeGreaterThan(10);
      if (p !== "resolved") expect(v.endsAtWorldMs).toBeGreaterThan(5000);
    }
    expect(scenarioView(at("approach"), 0).objectives[0]).toMatchObject({ id: "reach", done: false });
    expect(scenarioView(at("standoff"), 0).objectives[0]).toMatchObject({ id: "reach", done: true });
    const won = scenarioView(at("resolved"), 0);
    expect(won.resolution).toBe("paid");
    expect(won.objectives.find((o) => o.id === "secure")!.done).toBe(true);
    expect(won.objectives.some((o) => o.id === "home")).toBe(true);
    expect(won.endsAtWorldMs).toBe(0);
    const lost = scenarioView(tick(at("standoff"), RIVAL_ARRIVES_S + RIVAL_PARLEY_S + 1).s, 0);
    expect(lost.objectives.find((o) => o.id === "secure")).toMatchObject({ done: false });
    expect(lost.objectives.find((o) => o.id === "secure")!.text).toMatch(/Lost/);
  });

  it("the rout objective counts toward 60%", () => {
    const s = run(at("standoff"), { t: "hostile" }, { t: "garrison", alive: 4, routed: 0, total: 6 }).s;
    const o = scenarioView(s, 0).objectives.find((x) => x.id === "rout")!;
    expect(o).toMatchObject({ optional: true, done: false });
    expect(o.text).toContain("2 of 4");
  });

  it("zeroTally is fresh each time", () => {
    const a = zeroTally();
    a.wounded = 9;
    expect(zeroTally().wounded).toBe(0);
  });
});
