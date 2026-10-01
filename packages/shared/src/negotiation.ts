import type { CampaignState, Leverage, ParleyOption, ParleyStep, ParleyView, ResolutionId, FactionStance } from "./campaignTypes.ts";
import { STANCES, TOLL_MAX, WARD, askingToll, clampI, stanceOf, wardMemory } from "./factions.ts";
import { hash3 } from "./rng.ts";
import { HINT, LABEL, LIES_LINE, MEMORY_LINE, NEED_LINE, OPEN, REPLY, fillTemplate, pickFrom } from "./negotiationText.ts";

/**
 * The toll-bar parley, as pure functions. State lives in the ParleyView the host hands back (round, toll, mood), so the server keeps nothing
 * but the last view, and a hostile client can only choose an index into options the server itself produced.
 *
 * Rules (one table, no hidden state):
 *  - Rounds 1..3 allow haggling; round 4 is the last call: pay, bribe or walk away. So every path ends in at most 4 rounds.
 *  - Flatter is offered only when the Ward needs deference or trust >= 40. Threaten only with >= 2 armed in the party.
 *  - Every roll is hash3(seed, round, slot) compared to an odds function of trust/fear/need/armed/rivalInfluence/memory. No hidden dice.
 *  - A called bluff ends the talking ("hostile"); every other branch continues with a counter-offer or finishes. Walking away is always possible.
 */

export const MAX_ROUND = 4;
const TOLL_FLOOR = 10;
const TOLL_CEIL = TOLL_MAX + 30;

type OptionId = ParleyOption["id"];
const SLOT_FLATTER = 1, SLOT_THREATEN = 2;
function hashUnit(seed: number, round: number, slot: number): number { return hash3(seed, round, slot) / 4294967296; }

const moodShift = (s: FactionStance, d: number): FactionStance => STANCES[Math.min(STANCES.length - 1, Math.max(0, STANCES.indexOf(s) + d))]!;
const clamp01 = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const flatterAvailable = (c: CampaignState): boolean => c.factions.ward.need === "deference" || c.factions.ward.trust >= 40;
export const threatenAvailable = (lv: Leverage): boolean => lv.armed >= 2;

/** Chance flattery lands, 0.1..0.9. Trust and a deference-starved Ward help; memory of bribes and broken promises hurts; the Syndicate's hold hurts. */
export function flatterOdds(c: CampaignState, mood: FactionStance): number {
  const f = c.factions.ward, m = wardMemory(c);
  const needAdj = f.need === "deference" ? 0.25 : f.need === "coin" ? -0.05 : f.need === "medicine" ? 0.05 : 0;
  const p = 0.3 + f.trust / 250 + needAdj + m.gratitude / 400 - m.resentment / 300 - m.contempt / 500 - f.rivalInfluence / 500 + (STANCES.indexOf(mood) - 2) * 0.05;
  return clamp01(p, 0.1, 0.9);
}

/** Chance a threat works, 0.05..0.85: fear, a bloodied garrison, extra guns in the party and a Ward short of arms all count; her strength counts against. */
export function threatenOdds(c: CampaignState, lv: Leverage): number {
  const f = c.factions.ward;
  const lost = lv.garrisonTotal > 0 ? 1 - lv.garrisonAlive / lv.garrisonTotal : 0;
  const p = 0.15 + f.fear / 200 + lost * 0.45 + (lv.armed - 2) * 0.07 + (f.need === "arms" ? 0.08 : 0) - f.militaryStrength / 300;
  return clamp01(p, 0.05, 0.85);
}

/** The quartermaster's price: half the toll, dearer when the Syndicate is bidding against you, cheaper when the Ward is short of coin, steep if she is hostile. */
export function bribeCost(c: CampaignState, toll: number, mood: FactionStance): number {
  const f = c.factions.ward;
  const raw = toll * WARD.price.bribeShare * (1 + f.rivalInfluence / 200) * (f.need === "coin" ? 0.85 : 1) * (mood === "hostile" ? 1.5 : 1);
  return Math.max(TOLL_FLOOR, Math.round(raw));
}

const word = (p: number): string => (p >= 0.6 ? "Good odds." : p >= 0.4 ? "Even odds." : "Long odds.");

function optionsFor(c: CampaignState, lv: Leverage, round: number, toll: number, mood: FactionStance): ParleyOption[] {
  const out: ParleyOption[] = [];
  if (lv.purse >= toll) out.push({ id: "pay", label: fillTemplate(LABEL.pay, { cost: toll }), cost: toll, hint: HINT.pay });
  if (round < MAX_ROUND && flatterAvailable(c)) {
    out.push({ id: "haggle_flatter", label: LABEL.haggle_flatter, cost: 0, hint: `${HINT.haggle_flatter} ${word(flatterOdds(c, mood))}` });
  }
  if (round < MAX_ROUND && threatenAvailable(lv)) {
    out.push({ id: "haggle_threaten", label: LABEL.haggle_threaten, cost: 0, hint: `${HINT.haggle_threaten} ${word(threatenOdds(c, lv))}` });
  }
  const cost = bribeCost(c, toll, mood);
  if (lv.purse >= cost) out.push({ id: "bribe", label: fillTemplate(LABEL.bribe, { cost }), cost, hint: HINT.bribe });
  out.push({ id: "walk_away", label: LABEL.walk_away, cost: 0, hint: HINT.walk_away });
  return out;
}

const viewOf = (c: CampaignState, lv: Leverage, round: number, toll: number, mood: FactionStance, line: string): ParleyView => ({
  round, speaker: WARD.leader.speaker, line, toll, options: optionsFor(c, lv, round, toll, mood), mood,
});

/** Round 1: she names the price, then either remembers your last visit or complains about what she lacks. */
export function openParley(c: CampaignState, lv: Leverage, seed: number, powers?: { flags: readonly string[] }): ParleyView {
  const toll = askingToll(c, powers);
  const mood = stanceOf(c.factions.ward);
  const m = wardMemory(c);
  let line = fillTemplate(pickFrom(OPEN[mood], seed, 1, 0), { toll });
  if (m.last) {
    line += ` ${pickFrom(MEMORY_LINE[m.last], seed, 1, 1)}`;
    if (c.lies >= 2) line += pickFrom(LIES_LINE, seed, 1, 2);
  } else {
    line += ` ${pickFrom(NEED_LINE[c.factions.ward.need], seed, 1, 1)}`;
  }
  return viewOf(c, lv, 1, toll, mood, line);
}

const done = (resolution: ResolutionId | "walked_away" | "hostile", toll: number, paid: number, line: string): ParleyStep => ({ done: { resolution, toll, paid }, line });

/**
 * One answer. `option` indexes view.options. Anything invalid (bad index, option the current state no longer offers, garbage view)
 * re-issues the same round instead of throwing or advancing: a client cannot skip rounds or buy what it cannot afford.
 */
export function answerParley(c: CampaignState, lv: Leverage, seed: number, view: ParleyView, option: number, powers?: { flags: readonly string[] }): ParleyStep {
  const round = clampI(view?.round, 1, MAX_ROUND, 1);
  const toll = clampI(view?.toll, 1, TOLL_CEIL, askingToll(c, powers));
  const mood: FactionStance = STANCES.includes(view?.mood) ? view.mood : stanceOf(c.factions.ward);
  const offered = Array.isArray(view?.options) && Number.isInteger(option) ? view.options[option]?.id : undefined;
  const live = optionsFor(c, lv, round, toll, mood);
  const chosen = live.find((o) => o.id === (offered as OptionId | undefined));
  if (!chosen) return { view: viewOf(c, lv, round, toll, mood, typeof view?.line === "string" ? view.line.slice(0, 400) : "") };

  const say = (list: readonly string[], slot: number, vars: Record<string, number> = { toll }): string => fillTemplate(pickFrom(list, seed, round, slot), vars);
  const next = (t: number, m: FactionStance, line: string): ParleyStep => {
    const r = round + 1;
    return { view: viewOf(c, lv, r, t, m, r === MAX_ROUND ? `${line} ${pickFrom(REPLY.lastCall, seed, r, 9)}` : line) };
  };

  switch (chosen.id) {
    case "pay": {
      const bargained = toll < askingToll(c, powers);
      return done(bargained ? "bargained" : "paid", toll, toll, say(bargained ? REPLY.bargained : REPLY.paid, 3, { cost: toll, toll }));
    }
    case "bribe":
      return done("bribed", toll, chosen.cost, say(REPLY.bribed, 4));
    case "walk_away":
      return done("walked_away", toll, 0, say(REPLY.walk, 5));
    case "haggle_flatter": {
      if (hashUnit(seed, round, SLOT_FLATTER) < flatterOdds(c, mood)) {
        const t = Math.max(TOLL_FLOOR, Math.round(toll * 0.75));
        return next(t, moodShift(mood, 1), say(REPLY.flatterOk, 6, { toll: t }));
      }
      const t = Math.min(TOLL_CEIL, Math.ceil(toll * 1.1));
      return next(t, moodShift(mood, -1), say(REPLY.flatterFail, 7, { toll: t }));
    }
    case "haggle_threaten": {
      const p = threatenOdds(c, lv), r = hashUnit(seed, round, SLOT_THREATEN);
      if (r < p) {
        const t = Math.max(TOLL_FLOOR, Math.round(toll * 0.6));
        return next(t, moodShift(mood, -1), say(REPLY.threatenOk, 8, { toll: t }));
      }
      if (r < p + 0.25) {
        const t = Math.min(TOLL_CEIL, Math.ceil(toll * 1.2));
        return next(t, moodShift(mood, -1), say(REPLY.threatenSoft, 10, { toll: t }));
      }
      return done("hostile", toll, 0, say(REPLY.hostile, 11));
    }
  }
}
