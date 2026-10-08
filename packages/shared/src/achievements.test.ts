import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_RULES, evaluateAchievements } from "./achievements.ts";
import type { CampaignState, RegionId, ResolutionId, ScenarioTemplateId } from "./campaignTypes.ts";
import { newBill } from "./mayhem.ts";
import { applyOutcome, newCampaign } from "./factions.ts";
import { ACHIEVEMENTS, type AchievementId } from "./platform.ts";
import { ACHIEVEMENT_TEXT } from "./platformText.ts";
import { newPowers } from "./powers.ts";
import { PropKind } from "./props.ts";
import { deliverTo, newSettlements, techOf } from "./settlement.ts";
import type { PowersState, SettlementsState } from "./worldTypes.ts";

const zero = { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 };
const play = (c: CampaignState, scenario: ScenarioTemplateId, resolution: ResolutionId, extra: { bridge?: "intact" | "collapsed"; region?: RegionId } = {}): CampaignState =>
  applyOutcome(c, { scenario, resolution, toll: 40, paid: resolution === "paid" ? 20 : 0, bridge: extra.bridge ?? "intact", tally: zero, brokePromise: false, seconds: 30, region: extra.region });
const SEED = 17;
const fresh = (): { c: CampaignState; p: PowersState; s: SettlementsState } => ({ c: newCampaign(SEED), p: newPowers(SEED), s: newSettlements() });

/** One scripted way to earn each id. Contract endings go through the REAL `applyOutcome`/`deliverTo`/`techOf`; the few deep states (audiences, a grown town, trust) are legal field edits. */
const SCRIPT: Record<AchievementId, () => { c: CampaignState; p: PowersState; s: SettlementsState }> = {
  first_crossing: () => ({ ...fresh(), c: play(newCampaign(SEED), "secure_crossing", "bargained") }),
  paid_in_full: () => ({ ...fresh(), c: play(newCampaign(SEED), "secure_crossing", "paid") }),
  bridge_down: () => ({ ...fresh(), c: play(newCampaign(SEED), "secure_crossing", "sabotaged", { bridge: "collapsed" }) }),
  rescued_quim: () => ({ ...fresh(), c: play(newCampaign(SEED), "hostage_rescue", "rescued") }),
  wagon_taken: () => ({ ...fresh(), c: play(newCampaign(SEED), "convoy_ambush", "seized") }),
  border_mediated: () => ({ ...fresh(), c: play(newCampaign(SEED), "border_incident", "mediated") }),
  outpost_founded: () => {
    const f = fresh();
    let s = f.s;
    for (let i = 0; i < 4; i++) s = deliverTo(s, "kessar", PropKind.CRATE, f.c, SEED).s;
    return { ...f, s };
  },
  town_by_neglect: () => {
    const f = fresh();
    const s0 = deliverTo(deliverTo(deliverTo(deliverTo(f.s, "kessar", PropKind.CRATE, f.c, SEED).s, "kessar", PropKind.CRATE, f.c, SEED).s, "kessar", PropKind.CRATE, f.c, SEED).s, "kessar", PropKind.CRATE, f.c, SEED).s;
    const post = { ...s0.posts.kessar!, stage: "town" as const, foundedDay: 1 };
    return { ...f, c: { ...f.c, day: 12 }, s: { ...s0, posts: { kessar: post } } };
  },
  steam_launch: () => {
    const f = fresh();
    const post = { ...deliverTo(deliverTo(deliverTo(deliverTo(f.s, "kessar", PropKind.CRATE, f.c, SEED).s, "kessar", PropKind.CRATE, f.c, SEED).s, "kessar", PropKind.CRATE, f.c, SEED).s, "kessar", PropKind.CRATE, f.c, SEED).s.posts.kessar!, stage: "town" as const };
    const s = { ...f.s, posts: { kessar: post } };
    const tech = techOf(s, f.c, { security: 50, trade: 50, hostility: 0, rivalPressure: 0, labour: 50 });
    return { ...f, s: { ...s, tech } };
  },
  all_powers_met: () => {
    const f = fresh();
    const p = { ...f.p, minor: Object.fromEntries(Object.entries(f.p.minor).map(([k, v]) => [k, { ...v, lastAudienceDay: 2 }])) as PowersState["minor"] };
    return { ...f, c: play(newCampaign(SEED), "secure_crossing", "bargained"), p };
  },
  chair_settled: () => ({ ...fresh(), c: play(newCampaign(SEED), "succession_dispute", "backed_elder", { region: "highmark" }) }),
  four_at_once: () => {
    const f = fresh();
    const warm = { trust: 70, grievance: 0, fear: 10 };
    const minor = Object.fromEntries(Object.entries(f.p.minor).map(([k, v]) => [k, { ...v, ...warm }])) as PowersState["minor"];
    return { ...f, c: { ...f.c, factions: { ...f.c.factions, ward: { ...f.c.factions.ward, ...warm } } }, p: { ...f.p, minor } };
  },
  honest_measure: () => ({ ...fresh(), c: play(newCampaign(SEED), "reapers_strike", "honest_measure", { region: "highmark" }) }),
  miners_out: () => ({ ...fresh(), c: play(newCampaign(SEED), "mine_rescue", "blasted_through", { region: "vesper" }) }),
  engine_blown: () => ({ ...fresh(), c: play(newCampaign(SEED), "winding_engine", "engine_blown", { region: "vesper" }) }),
  claim_staked: () => ({ ...fresh(), c: play(newCampaign(SEED), "claim_race", "jumped", { region: "vesper" }) }),
  cargo_landed: () => ({ ...fresh(), c: play(newCampaign(SEED), "smuggling_run", "landed", { region: "saltmarket" }) }),
  lot_won: () => ({ ...fresh(), c: play(newCampaign(SEED), "flooded_market", "lot_won", { region: "saltmarket" }) }),
  post_held: () => ({ ...fresh(), c: play(newCampaign(SEED), "outpost_raid", "post_held") }),
  good_samaritan: () => {
    const f = fresh();
    return { ...f, c: { ...f.c, sites: { ...f.c.sites, lastIncident: { id: "wounded_traveller", result: "helped", day: 1, region: "kessar" } } } };
  },
  powder_salvaged: () => {
    const f = fresh();
    return { ...f, c: { ...f.c, sites: { ...f.c.sites, lastIncident: { id: "powder_wagon", result: "salvaged", day: 1, region: "kessar" } } } };
  },
  learned_society: () => withBill({}, true),
  unscheduled_flight: () => withBill({ flings: 1, longest: 21, longestWho: "Carter Obadiah Plume" }),
  museum_piece: () => withBill({ limbs: 5 }),
  umbrella_man: () => withBill({ brolly: 1, foes: 1 }),
};

function withBill(over: Partial<ReturnType<typeof newBill>>, met = false): { c: CampaignState; p: PowersState; s: SettlementsState } {
  const f = fresh();
  return { ...f, c: { ...f.c, sites: { ...f.c.sites, lastBill: { day: 1, region: "kessar", bill: { ...newBill(), ...over }, request: "flight", met, spectacle: 0 } } } };
}

describe("achievements", () => {
  it("a fresh campaign earns nothing", () => {
    const { c, p, s } = fresh();
    expect(evaluateAchievements(c, p, s, [])).toEqual([]);
  });

  it("every id is reachable in a scripted campaign, and has text (twelve at D-036; thirteen more for the later contracts, incidents and D-084)", () => {
    expect(ACHIEVEMENTS).toHaveLength(25);
    expect(ACHIEVEMENTS.slice(0, 12)).toEqual(["first_crossing", "paid_in_full", "bridge_down", "rescued_quim", "wagon_taken", "border_mediated", "outpost_founded", "town_by_neglect", "steam_launch", "all_powers_met", "chair_settled", "four_at_once"]); // (append-only: a stored id never moves)
    for (const id of ACHIEVEMENTS) {
      const { c, p, s } = SCRIPT[id]();
      expect(evaluateAchievements(c, p, s, []), id).toContain(id);
      expect(ACHIEVEMENT_TEXT[id].title.length, id).toBeGreaterThan(2);
      expect(ACHIEVEMENT_TEXT[id].blurb.length, id).toBeGreaterThan(10);
    }
  });

  it("chair_settled is Highmark's: it needs the ledger's succession to move (a pre-D-036 campaign never earns it)", () => {
    const { c, p, s } = fresh();
    expect(c.sites.succession).toBe("open");
    expect(evaluateAchievements(c, p, s, [])).not.toContain("chair_settled");
    const done = SCRIPT.chair_settled();
    expect(done.c.sites.succession).not.toBe("open");
    // an old save that has no `succession` field at all is tolerated by name
    const old = { ...c, sites: { ...c.sites } } as CampaignState;
    delete (old.sites as Partial<CampaignState["sites"]>).succession;
    expect(() => evaluateAchievements(old, p, s, [])).not.toThrow();
    expect(ACHIEVEMENT_RULES.chair_settled(old, p, s)).toBe(false);
  });

  it("deterministic, ordered like the table, and never repeats an id already held", () => {
    const { c, p, s } = SCRIPT.paid_in_full();
    const a = evaluateAchievements(c, p, s, []);
    expect(evaluateAchievements(c, p, s, [])).toEqual(a);
    expect(a).toEqual(ACHIEVEMENTS.filter((id) => a.includes(id)));
    expect(a).toEqual(expect.arrayContaining(["first_crossing", "paid_in_full"]));
    expect(evaluateAchievements(c, p, s, a)).toEqual([]);
    expect(evaluateAchievements(c, p, s, ["first_crossing"])).not.toContain("first_crossing");
  });

  it("one partial or hostile state earns nothing and never throws", () => {
    const { c, p, s } = fresh();
    expect(() => evaluateAchievements({} as CampaignState, p, s, [])).not.toThrow();
    expect(() => evaluateAchievements(c, {} as PowersState, {} as SettlementsState, [])).not.toThrow();
    expect(evaluateAchievements(c, {} as PowersState, {} as SettlementsState, [])).toEqual([]);
  });

  it("is a pure function of its inputs (no mutation)", () => {
    const { c, p, s } = SCRIPT.four_at_once();
    const before = JSON.stringify([c, p, s]);
    evaluateAchievements(c, p, s, []);
    expect(JSON.stringify([c, p, s])).toBe(before);
  });
});
