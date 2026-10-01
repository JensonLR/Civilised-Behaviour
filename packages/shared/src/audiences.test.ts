import { describe, expect, it } from "vitest";
import { AUDIENCE, answerAudience, applyAudience, audiencesAt, hookPrice, openAudience, type Audience, type AudienceDone, type AudienceStep } from "./audiences.ts";
import { newCampaign, leverageOf } from "./factions.ts";
import { MINOR_IDS, newPowers, parsePowers, powerStance, serializePowers } from "./powers.ts";
import { HOOKS } from "./powersText.ts";
import type { CampaignState, FactionStance, Leverage, ParleyView } from "./campaignTypes.ts";
import type { MinorPowerId, PowersState } from "./worldTypes.ts";

const lv = (c: CampaignState, armed = 3): Leverage => leverageOf(c, { armed, garrisonAlive: 0, garrisonTotal: 0, partyWounded: 0 });
const STANCE_TRUST: Record<FactionStance, number> = { hostile: 0, wary: 15, neutral: 30, warm: 50, allied: 90 };

function setup(seed: number, trust: number): { c: CampaignState; p: PowersState } {
  const c0 = newCampaign(seed);
  const c = { ...c0, day: 6, expeditions: 2, purse: 400 };
  const p0 = newPowers(seed);
  const minor = { ...p0.minor };
  for (const id of MINOR_IDS) minor[id] = { ...minor[id], trust, grievance: 45, fear: 0 };
  return { c, p: { ...p0, minor } };
}
const offerFor = (c: CampaignState, p: PowersState, power: MinorPowerId, hook: "purchase" | "favour"): Audience => ({ id: `${power}:${hook}`, power, speaker: "S", title: "T", intro: "I", hook });

/** Plays one fixed option choice every round; returns the ending and the number of rounds. */
function play(c: CampaignState, p: PowersState, a: Audience, pick: string, seed: number): { done: AudienceDone; rounds: number } {
  const l = lv(c);
  let view: ParleyView = openAudience(c, p, l, a, seed);
  for (let rounds = 1; rounds <= 8; rounds++) {
    let i = view.options.findIndex((o) => o.id === pick);
    if (i < 0) i = view.options.findIndex((o) => o.id === "walk_away");
    const step: AudienceStep = answerAudience(c, p, l, a, view, i, seed);
    if (step.done) return { done: step.done, rounds };
    view = step.view;
  }
  throw new Error("an audience never ended");
}

describe("audiences", () => {
  it("none before the first expedition; at most two; deterministic; a pure function of state and day", () => {
    const c = newCampaign(1), p = newPowers(1);
    expect(audiencesAt(c, p)).toEqual([]);
    const { c: c2, p: p2 } = setup(1, 30);
    const a = audiencesAt(c2, p2);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(AUDIENCE.maxPending);
    expect(audiencesAt(c2, p2)).toEqual(a);
    for (const x of a) expect(x.intro).not.toContain("{speaker}");
    // a power that was just seen does not ask again for two days
    const seen = { ...p2, minor: { ...p2.minor, [a[0]!.power]: { ...p2.minor[a[0]!.power], lastAudienceDay: c2.day } } };
    expect(audiencesAt(c2, seen).some((x) => x.power === a[0]!.power)).toBe(false);
  });

  it("a held purchase and an errand out leave nothing to ask", () => {
    const { c, p } = setup(2, 30);
    const flags = MINOR_IDS.flatMap((id) => [HOOKS[id][0].flag, HOOKS[id][1].flag]);
    expect(audiencesAt(c, { ...p, flags })).toEqual([]);
  });

  it("every power x every option reaches a ending in at most four rounds from every stance, deterministically", () => {
    for (const stance of Object.keys(STANCE_TRUST) as FactionStance[]) {
      for (const power of MINOR_IDS) {
        for (const hook of ["purchase", "favour"] as const) {
          const { c, p } = setup(7, STANCE_TRUST[stance]);
          expect(powerStance(p.minor[power])).toBeDefined();
          const a = offerFor(c, p, power, hook);
          for (const pick of ["pay", "haggle_flatter", "haggle_threaten", "bribe", "walk_away"]) {
            for (let seed = 0; seed < 12; seed++) {
              const r = play(c, p, a, pick, seed);
              expect(r.rounds, `${stance} ${power} ${hook} ${pick}`).toBeLessThanOrEqual(AUDIENCE.maxRound);
              expect(play(c, p, a, pick, seed)).toEqual(r);
              expect(r.done.paid).toBeGreaterThanOrEqual(0);
              expect(r.done.paid).toBeLessThanOrEqual(c.purse);
            }
          }
        }
      }
    }
  });

  it("forged and stale answers re-issue the round instead of advancing", () => {
    const { c, p } = setup(3, 30);
    const a = offerFor(c, p, "brine", "purchase");
    const v = openAudience(c, p, lv(c), a, 1);
    for (const bad of [-1, 99, 1.5, NaN, "x" as unknown as number]) {
      const s = answerAudience(c, p, lv(c), a, v, bad, 1);
      expect(s.view?.round).toBe(1);
    }
    const forged = { ...v, round: 99, toll: -5, mood: "nonsense" as never, options: [{ id: "pay" as const, label: "", cost: 0, hint: "" }] };
    const s = answerAudience(c, p, lv(c), a, forged, 0, 1);
    expect(s.done?.paid ?? 0).toBeLessThanOrEqual(hookPrice(p, a) * 2);
    // cannot afford: pay is not offered
    const poor = { ...c, purse: 1 };
    expect(openAudience(poor, p, lv(poor), a, 1).options.some((o) => o.id === "pay")).toBe(false);
  });

  it("a favour owed takes a quarter off the price; the price never falls below the floor", () => {
    const { p } = setup(3, 30);
    const a = offerFor(newCampaign(1), p, "brine", "purchase");
    const base = hookPrice(p, a);
    const owed = { ...p, minor: { ...p.minor, brine: { ...p.minor.brine, owes: 2 } } };
    expect(hookPrice(owed, a)).toBeLessThan(base);
    expect(hookPrice(owed, a)).toBeGreaterThanOrEqual(5);
  });

  it("applying an ending changes at least three fields, stays in range, round-trips, and never mutates", () => {
    for (const power of MINOR_IDS) {
      for (const hook of ["purchase", "favour"] as const) {
        for (const kind of ["accepted", "haggled", "bribed", "refused", "hostile"] as const) {
          const { c, p } = setup(5, 30);
          Object.freeze(p.minor[power]);
          const a = offerFor(c, p, power, hook);
          const paid = hook === "purchase" && kind !== "refused" && kind !== "hostile" ? hookPrice(p, a) : 0;
          const r = applyAudience(c, p, a, { kind, paid });
          let changed = 0;
          const m0 = p.minor[power] as unknown as Record<string, unknown>, m1 = r.p.minor[power] as unknown as Record<string, unknown>;
          for (const k of Object.keys(m0)) if (JSON.stringify(m0[k]) !== JSON.stringify(m1[k])) changed++;
          if (r.c.purse !== c.purse) changed++;
          if (r.p.flags.length !== p.flags.length) changed++;
          if (JSON.stringify(r.p.rel) !== JSON.stringify(p.rel)) changed++;
          expect(changed, `${power} ${hook} ${kind}`).toBeGreaterThanOrEqual(3);
          expect(parsePowers(serializePowers(r.p))).toEqual(r.p);
          expect(r.c.purse).toBe(c.purse - paid);
        }
      }
    }
  });

  it("a purchase sets its flag; an errand sets its flag; three refusals in twenty days trigger the price", () => {
    const { c, p } = setup(8, 30);
    const buy = applyAudience(c, p, offerFor(c, p, "reapers", "purchase"), { kind: "accepted", paid: 30 });
    expect(buy.p.flags).toContain("reaper_grain");
    const err = applyAudience(c, p, offerFor(c, p, "choir", "favour"), { kind: "accepted", paid: 0 });
    expect(err.p.flags).toContain("errand_choir");
    let st = { c, p };
    for (let i = 0; i < 3; i++) {
      st = applyAudience({ ...st.c, day: st.c.day + 1 }, st.p, offerFor(st.c, st.p, "brine", "purchase"), { kind: "refused", paid: 0 });
      if (i < 2) expect(st.p.flags).not.toContain("brine_markup");
    }
    expect(st.p.flags).toContain("brine_markup");
    expect(st.p.log.some((e) => e.kind === "price_brine")).toBe(true);
    expect(st.p.minor.brine.refusals).toEqual([]);
    // refusals spread over more than twenty days never add up
    let slow = { c, p };
    for (let i = 0; i < 4; i++) slow = applyAudience({ ...slow.c, day: slow.c.day + 25 }, slow.p, offerFor(slow.c, slow.p, "brine", "purchase"), { kind: "refused", paid: 0 });
    expect(slow.p.flags).not.toContain("brine_markup");
  });

  it("copy is free of unfilled placeholders", () => {
    const { c, p } = setup(2, 30);
    for (const power of MINOR_IDS) {
      const v = openAudience(c, p, lv(c), offerFor(c, p, power, "purchase"), 3);
      expect(v.line).not.toMatch(/\{/);
      for (const pick of ["pay", "bribe", "walk_away"]) expect(play(c, p, offerFor(c, p, power, "purchase"), pick, 3).done).toBeDefined();
    }
  });
});
