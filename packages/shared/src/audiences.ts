import type { CampaignState, FactionStance, Leverage, ParleyOption, ParleyView } from "./campaignTypes.ts";
import { NEEDS, STANCES, clampI } from "./factions.ts";
import { powerStance, MINOR_IDS } from "./powers.ts";
import { hasFlag, withFlag, withLog } from "./relations.ts";
import { cloneState } from "./relations.ts";
import { hash3 } from "./rng.ts";
import { HOOKS, INTRO, LEADERS, REPLY, type HookDef, type HookKind } from "./powersText.ts";
import { PAIR_KEYS, type MinorPowerId, type PowersState } from "./worldTypes.ts";

/**
 * Audiences (D-035): the powers' hooks, played at HQ over the existing parley sheet. A pure function of state and day says who is asking for you; `openAudience` and
 * `answerAudience` reuse the toll-bar parley's option ids (pay, haggle_flatter, haggle_threaten, bribe, walk_away) and its four-round limit, so every path ends;
 * `applyAudience` turns the ending into campaign and powers state (always several fields at once). Authored copy: powersText.ts.
 */

export const AUDIENCE = { maxRound: 4, minGapDays: 2, refusalWindowDays: 20, refusalsForPrice: 3, owesDiscount: 0.25, maxPending: 2 } as const;

export interface Audience { id: string; power: MinorPowerId; speaker: string; title: string; intro: string; hook: HookKind }
export type AudienceKind = "accepted" | "haggled" | "bribed" | "refused" | "hostile";
export interface AudienceDone { kind: AudienceKind; paid: number }
export type AudienceStep = { view: ParleyView; done?: undefined; line?: undefined } | { done: AudienceDone; line: string; view?: undefined };

const TOLL_FLOOR = 5;
const hookOf = (id: MinorPowerId, kind: HookKind): HookDef => HOOKS[id][kind === "purchase" ? 0 : kind === "favour" ? 1 : 2];

/** Which hook the power brings today, or undefined when neither is available (the purchase is held, the errand is already out). */
function hookFor(c: CampaignState, p: PowersState, id: MinorPowerId, idx: number): HookKind | undefined {
  const buy = !hasFlag(p, hookOf(id, "purchase").flag);
  const errand = !hasFlag(p, hookOf(id, "favour").flag);
  if (buy && errand) return (c.day + idx) % 2 === 0 ? "purchase" : "favour";
  return buy ? "purchase" : errand ? "favour" : undefined;
}

/** How loudly a power is asking for the party: need pressing, a refusal due, time since it last saw you. */
function pressure(c: CampaignState, p: PowersState, id: MinorPowerId): number {
  const m = p.minor[id];
  return (m.grievance >= 40 ? 3 : 0) + (m.prosperity <= 35 ? 2 : 0) + (m.refusals.length >= 2 ? 4 : 0) + (c.day - m.lastAudienceDay >= 4 ? 2 : 0) + (c.expeditions > 0 ? 1 : 0);
}

/** At most two powers asking for you at HQ today (none before the first expedition: there is nothing to ask about yet). */
export function audiencesAt(c: CampaignState, p: PowersState): Audience[] {
  if (c.expeditions < 1) return [];
  const rows: { a: Audience; score: number }[] = [];
  MINOR_IDS.forEach((id, i) => {
    const m = p.minor[id];
    if (m.lastAudienceDay > 0 && c.day - m.lastAudienceDay < AUDIENCE.minGapDays) return;
    const hook = hookFor(c, p, id, i);
    if (!hook) return;
    const score = pressure(c, p, id);
    if (score < 1) return;
    const lead = LEADERS[id];
    const intro = INTRO[id][hash3(c.seed >>> 0, c.day, 0xa0d1, i) % INTRO[id].length]!.replace(/\{speaker\}/g, lead.speaker);
    rows.push({ a: { id: `${id}:${hook}`, power: id, speaker: lead.speaker, title: lead.title, intro, hook }, score });
  });
  rows.sort((x, y) => y.score - x.score || (x.a.id < y.a.id ? -1 : 1));
  return rows.slice(0, AUDIENCE.maxPending).map((r) => r.a);
}

/** What the hook costs this party today: a favour owed to us takes a quarter off each time (never below the floor). */
export function hookPrice(p: PowersState, a: Pick<Audience, "power" | "hook">): number {
  const h = hookOf(a.power, a.hook);
  if (a.hook !== "purchase") return 0;
  return Math.max(TOLL_FLOOR, Math.round(h.cost * (1 - AUDIENCE.owesDiscount * p.minor[a.power].owes)));
}
const bribePrice = (p: PowersState, a: Audience): number => (a.hook === "purchase" ? Math.max(TOLL_FLOOR, Math.round(hookPrice(p, a) * 0.5)) : 15);

const flatterOdds = (p: PowersState, a: Audience, mood: FactionStance): number => {
  const m = p.minor[a.power];
  return Math.min(0.9, Math.max(0.1, 0.35 + m.trust / 250 + (STANCES.indexOf(mood) - 2) * 0.06 - m.rivalInfluence / 500));
};
const threatenOdds = (p: PowersState, a: Audience, lv: Leverage): number => {
  const m = p.minor[a.power];
  return Math.min(0.85, Math.max(0.05, 0.15 + m.fear / 200 + (lv.armed - 2) * 0.07 - m.militaryStrength / 300));
};

function options(p: PowersState, lv: Leverage, a: Audience, round: number, toll: number): ParleyOption[] {
  const out: ParleyOption[] = [];
  const buy = a.hook === "purchase";
  if (!buy || lv.purse >= toll) out.push({ id: "pay", label: buy ? `Agree: £${toll}` : "Take the errand", cost: buy ? toll : 0, hint: buy ? "Sign, pay and be done." : "Do it, and be owed for it." });
  if (round < AUDIENCE.maxRound) {
    out.push({ id: "haggle_flatter", label: "Flatter them", cost: 0, hint: buy ? "Ask for a better price, nicely." : "Ask for something in advance, nicely." });
    if (lv.armed >= 2) out.push({ id: "haggle_threaten", label: "Lean on them", cost: 0, hint: "Mention the rifles, in passing." });
  }
  const bp = bribePrice(p, a);
  if (lv.purse >= bp) out.push({ id: "bribe", label: buy ? `Slip them £${bp}` : `Decline politely (£${bp})`, cost: bp, hint: buy ? "A quiet price, a quiet deal." : "No hard feelings, at a price." });
  out.push({ id: "walk_away", label: buy ? "Decline" : "Refuse", cost: 0, hint: "They will remember." });
  return out;
}

const viewOf = (p: PowersState, lv: Leverage, a: Audience, round: number, toll: number, mood: FactionStance, line: string): ParleyView => ({
  round, speaker: a.speaker, line, toll, options: options(p, lv, a, round, toll), mood,
});

/** Round 1: the power's own opening, then what it is offering. */
export function openAudience(_c: CampaignState, p: PowersState, lv: Leverage, a: Audience, _seed: number): ParleyView {
  const h = hookOf(a.power, a.hook);
  return viewOf(p, lv, a, 1, hookPrice(p, a), powerStance(p.minor[a.power]), `${a.intro} ${h.title}: ${h.text}`);
}

const say = (a: Audience, kind: keyof (typeof REPLY)["brine"], seed: number, round: number): string => {
  const l = REPLY[a.power][kind];
  return l[hash3(seed >>> 0, round, 0xa0d2, kind.length) % l.length]!;
};
const moodShift = (s: FactionStance, d: number): FactionStance => STANCES[Math.min(STANCES.length - 1, Math.max(0, STANCES.indexOf(s) + d))]!;

/** One answer. `option` indexes view.options; anything invalid re-issues the same round (a client can neither skip a round nor buy what it cannot afford). */
export function answerAudience(c: CampaignState, p: PowersState, lv: Leverage, a: Audience, view: ParleyView, option: number, seed: number): AudienceStep {
  const round = clampI(view?.round, 1, AUDIENCE.maxRound, 1);
  const base = hookPrice(p, a);
  const toll = a.hook === "purchase" ? clampI(view?.toll, TOLL_FLOOR, Math.max(base * 2, 20), base) : 0;
  const mood: FactionStance = STANCES.includes(view?.mood) ? view.mood : powerStance(p.minor[a.power]);
  const offered = Array.isArray(view?.options) && Number.isInteger(option) ? view.options[option]?.id : undefined;
  const live = options(p, lv, a, round, toll);
  const chosen = live.find((o) => o.id === offered);
  if (!chosen) return { view: viewOf(p, lv, a, round, toll, mood, typeof view?.line === "string" ? view.line.slice(0, 400) : "") };
  const r1 = round + 1;
  const next = (t: number, m: FactionStance, line: string): AudienceStep => ({ view: viewOf(p, lv, a, r1, t, m, line) });
  const roll = (slot: number): number => hash3(seed >>> 0, round, 0xa0d3, slot) / 4294967296;
  switch (chosen.id) {
    case "pay": return { done: { kind: toll < base ? "haggled" : "accepted", paid: a.hook === "purchase" ? toll : 0 }, line: say(a, toll < base ? "haggled" : "accepted", seed, round) };
    case "bribe": return { done: { kind: "bribed", paid: chosen.cost }, line: say(a, "bribed", seed, round) };
    case "walk_away": return { done: { kind: "refused", paid: 0 }, line: say(a, "refused", seed, round) };
    case "haggle_flatter":
      if (roll(1) < flatterOdds(p, a, mood)) {
        const t = a.hook === "purchase" ? Math.max(TOLL_FLOOR, Math.round(toll * 0.8)) : 0;
        return a.hook === "purchase" ? next(t, moodShift(mood, 1), say(a, "haggled", seed, round)) : { done: { kind: "haggled", paid: 0 }, line: say(a, "haggled", seed, round) };
      }
      return next(a.hook === "purchase" ? Math.ceil(toll * 1.1) : 0, moodShift(mood, -1), say(a, "refused", seed, round));
    case "haggle_threaten": {
      const pr = threatenOdds(p, a, lv), r = roll(2);
      if (r < pr) {
        return a.hook === "purchase" ? next(Math.max(TOLL_FLOOR, Math.round(toll * 0.6)), moodShift(mood, -1), say(a, "haggled", seed, round)) : { done: { kind: "haggled", paid: 0 }, line: say(a, "haggled", seed, round) };
      }
      if (r < pr + 0.25) return next(a.hook === "purchase" ? Math.ceil(toll * 1.2) : 0, moodShift(mood, -1), say(a, "refused", seed, round));
      return { done: { kind: "hostile", paid: 0 }, line: say(a, "hostile", seed, round) };
    }
    // (the toll bar's plea, D-047: an audience never offers it, so it is answered like any option the round did not offer)
    case "plead": return { view: viewOf(p, lv, a, round, toll, mood, typeof view?.line === "string" ? view.line.slice(0, 400) : "") };
  }
}

const pct = (v: number): number => Math.min(100, Math.max(0, Math.round(v)));
const relClamp = (v: number): number => Math.min(100, Math.max(-100, Math.round(v)));

/** What an ending does (several fields at once): the purse, a flag, the power's mood, the relation map, a refusal on the books and, at the third in twenty days, the price. */
export function applyAudience(c: CampaignState, p0: PowersState, a: Audience, done: AudienceDone): { c: CampaignState; p: PowersState } {
  const p = cloneState(p0);
  const m = p.minor[a.power];
  const h = hookOf(a.power, a.hook);
  const day = c.day;
  const paid = clampI(done.paid, 0, c.purse, 0);
  const cc: CampaignState = { ...c, purse: c.purse - paid };
  m.lastAudienceDay = Math.max(1, day);
  m.need = NEEDS[(NEEDS.indexOf(m.need) + 1) % NEEDS.length]!;
  const grant = done.kind === "accepted" || done.kind === "haggled" || (done.kind === "bribed" && a.hook === "purchase");
  if (grant) {
    p.flags = withFlag(p.flags, h.flag);
    m.trust = pct(m.trust + (done.kind === "accepted" ? 10 : done.kind === "haggled" ? 6 : -4));
    m.playerInfluence = pct(m.playerInfluence + 8);
    m.grievance = pct(m.grievance - 3);
    if (a.hook === "purchase" && p0.minor[a.power].owes > 0) m.owes = Math.max(0, m.owes - 1);
    for (const k of PAIR_KEYS) {
      const d = h.rel?.[k];
      if (d) p.rel[k] = relClamp(p.rel[k] + d);
    }
    if (a.hook === "purchase") p.log = withLog(p.log, { day, kind: `deal_${a.power}`, a: a.power, n: 1 });
  } else if (done.kind === "bribed") {
    m.trust = pct(m.trust - 2); // an excused errand: no hard feelings, a little cooling
  } else {
    // a refusal (or a threat that was called): on the books for twenty days
    m.refusals = [...m.refusals.filter((d) => day - d < AUDIENCE.refusalWindowDays), day].slice(-AUDIENCE.refusalsForPrice);
    m.trust = pct(m.trust - (done.kind === "hostile" ? 10 : 2));
    m.grievance = pct(m.grievance + (done.kind === "hostile" ? 12 : 2));
    if (m.refusals.length >= AUDIENCE.refusalsForPrice) {
      const price = hookOf(a.power, "refusal");
      p.flags = withFlag(p.flags, price.flag);
      m.refusals = [];
      m.grievance = pct(m.grievance + 10);
      for (const k of PAIR_KEYS) {
        const d = price.rel?.[k];
        if (d) p.rel[k] = relClamp(p.rel[k] + d);
      }
      p.log = withLog(p.log, { day, kind: `price_${a.power}`, a: a.power, n: 3 });
    }
  }
  return { c: cc, p };
}

export const isAudienceHook = (k: unknown): k is HookKind => k === "purchase" || k === "favour" || k === "refusal";
