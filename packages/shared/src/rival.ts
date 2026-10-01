import type { CampaignState, RegionId, ResolutionId } from "./campaignTypes.ts";
import { RIVAL_ARRIVES_S } from "./campaignTypes.ts";
import { clampI } from "./factions.ts";
import { cloneState, hasFlag, pairKey, withFlag, withLog } from "./relations.ts";
import { hash3 } from "./rng.ts";
import { pluck } from "./regionEndings.ts";
import { SALTMARKET_ENDINGS } from "./saltmarketLedger.ts";
import { VESPER_ENDINGS } from "./vesperLedger.ts";
import { crossingSettled } from "./scenarios/crossing.ts";
import { EVENT_NEWS, GOAL_NEWS, SPOT_TEXT } from "./rivalText.ts";
import type { PaperItem, PowerEvent, PowersState, RivalAgent, RivalEvent, RivalGoal, RivalPresence, RivalSighting, RivalSpot } from "./worldTypes.ts";

/**
 * The Syndicate as an agent (D-035). Pure and deterministic from (campaign, powers, day counter): it scores six goals by utility, keeps one for at least three days,
 * advances it, and pays it out. Fairness is part of the rules, not of the tuning:
 *  - a goal pays out only `RIVAL.leadMin` days after it was set, and the paper prints the goal from the day it is set (`rivalDispatch`), so every payout is announced;
 *  - every goal has counterplay: `COUNTER` lists at least two resolutions that cut its progress by 15 or more;
 *  - a crossing that is SETTLED (paid within SETTLED_DAYS) blocks `buy_crossing`, and a bridge that has fallen is not worth buying;
 *  - three abandoned runs in a row make the Ward look weak enough to buy.
 * Idle time: the host passes `c.day + idle` (whole idle days, capped); only the rival's own clock moves, never `c.day`.
 */

export const RIVAL = { leadMin: 2, dwell: 3, maxDays: 10, income: 5, purseMax: 400, hysteresis: 8, wardWeak: 60 } as const;
export const RIVAL_GOALS: readonly RivalGoal[] = ["buy_crossing", "survey_route", "arm_brine", "found_post", "sabotage_party", "lie_low"];
const GOAL_COST: Record<RivalGoal, number> = { buy_crossing: 60, survey_route: 0, arm_brine: 40, found_post: 80, sabotage_party: 0, lie_low: 0 };

export function newRival(seed: number): RivalAgent {
  return {
    day: 1, goal: "survey_route", since: 1, progress: 0, purse: 120 + (hash3(seed >>> 0, 1, 0x51) % 40), escort: 40 + (hash3(seed >>> 0, 2, 0x51) % 15), grudge: 0, posts: 0,
    where: { region: "kessar", spot: "camp" }, seenDay: 0, lead: 4,
  };
}

/** Progress a goal loses to each ending (>= 15 for at least two endings per goal: the counterplay the player always has). */
export const COUNTER: Record<RivalGoal, Partial<Record<ResolutionId, number>>> = {
  buy_crossing: { paid: 20, bargained: 20, bribed: 18, sided_ward: 15, tipped_off: 15 },
  survey_route: { seized: 20, burned: 20, tipped_off: 15, rescued: 15 },
  arm_brine: { seized: 30, tipped_off: 25, burned: 25, mediated: 15 },
  found_post: { sided_ward: 20, seized: 15, burned: 20, mediated: 15 },
  sabotage_party: { tipped_off: 25, mediated: 20, paid: 15, bargained: 15 },
  lie_low: { rescued: 15, seized: 20, burned: 15 },
};
/** How an ending sits with the Syndicate: grudge in points (exhaustive, so a new resolution must choose). */
export const GRUDGE_FX: Record<ResolutionId, number> = {
  ...pluck(VESPER_ENDINGS, "grudge"), ...pluck(SALTMARKET_ENDINGS, "grudge"),   // D-037 (regionEndings.ts)
  paid: 0, bargained: 0, bribed: 0, forced: 2, sabotaged: 4, rival_secured: -10, abandoned: 0,
  ransomed: -3, rescued: 6, slipped_away: 0, hostage_lost: -2, seized: 12, tipped_off: 8, burned: 12, passed: -8, mediated: -2, sided_ward: 8, sided_syndicate: -8, provoked: 4, escalated: 3,
  // D-036: a chair the Society filled is a concession the Syndicate did not get (a regency stalls it longest, a usurpation shuts it); a sold crown is the Syndicate's own good day
  backed_elder: 5, backed_younger: 4, regency: 7, usurped: 9, crown_sold: -8,
};

/** After an ending: the Syndicate's grudge moves and the goal in hand loses what the ending counters. Pure. */
export function rivalAfterOutcome(r: RivalAgent, resolution: ResolutionId, rivalKilled: number): RivalAgent {
  const cut = COUNTER[r.goal][resolution] ?? 0;
  return {
    ...r, where: { ...r.where }, grudge: clampI(r.grudge + GRUDGE_FX[resolution] + Math.min(15, rivalKilled * 3), 0, 100, r.grudge),
    progress: clampI(r.progress - cut, 0, 100, r.progress),
  };
}

const SPOT: Record<RivalGoal, (p: PowersState) => RivalSpot> = {
  buy_crossing: () => "fort", survey_route: () => "road", arm_brine: () => "sea", found_post: (p) => (hasFlag(p, "party_post") ? "outpost" : "ford"),
  sabotage_party: (p) => (hasFlag(p, "party_post") ? "outpost" : "road"), lie_low: () => "camp",
};
const VISIBLE: ReadonlySet<RivalSpot> = new Set(["road", "ford", "fort", "outpost"]);

/** Utility of each goal today. Integer-ish, a little seeded jitter (0..6) so two campaigns with the same ledger still differ. */
export function scoreGoals(c: CampaignState, p: PowersState, day: number): Record<RivalGoal, number> {
  const r = p.rival, w = c.factions.ward;
  const blocked = crossingSettled(c) || c.crossing.control === "rival" || c.crossing.bridge === "collapsed";
  const post = hasFlag(p, "party_post");
  const base: Record<RivalGoal, number> = {
    buy_crossing: blocked ? 0 : r.purse >= GOAL_COST.buy_crossing ? 30 + (RIVAL.wardWeak - w.militaryStrength) * 0.6 + r.purse / 20 + (c.crossing.control === "contested" ? 12 : 0) : 6,
    survey_route: 22 + r.escort / 5 + (r.posts > 0 ? 10 : 0),
    arm_brine: r.purse >= GOAL_COST.arm_brine ? 18 + r.grudge / 4 + (p.minor.brine.militaryStrength < 60 ? 10 : 0) + ((p.rel[pairKey("rival", "brine")!] ?? 0) > -20 ? 8 : -6) : 4,
    found_post: r.posts >= 2 ? 0 : r.purse >= GOAL_COST.found_post ? 26 + r.purse / 25 + (post ? 10 : 0) : 6,
    sabotage_party: 4 + r.grudge * 0.85 + (post ? 18 : 0) - (r.escort < 30 ? 14 : 0),
    lie_low: r.purse < 50 ? 55 : r.escort < 25 ? 28 : 6,
  };
  RIVAL_GOALS.forEach((g, i) => {
    if (base[g] > 0) base[g] += hash3(c.seed >>> 0, day, 0x7100 + i) % 7;   // a blocked goal stays at exactly 0
  });
  return base;
}

const rateOf = (r: RivalAgent): number => (r.goal === "lie_low" ? 20 : 12 + Math.floor(r.escort / 10) + (r.purse >= 150 ? 3 : 0));

/** True when the Ward looks weak enough to buy: a thin garrison, or three abandoned runs in a row. */
function wardWeak(c: CampaignState): boolean {
  const h = c.history;
  const lastThree = h.length >= 3 && h.slice(-3).every((x) => x.resolution === "abandoned");
  return c.factions.ward.militaryStrength <= RIVAL.wardWeak || lastThree;
}

const pushEvent = (p: PowersState, events: RivalEvent[], ev: RivalEvent, n: number): void => {
  events.push(ev);
  const log: PowerEvent = { day: ev.day, kind: `rival_${ev.kind}`, a: "rival", n };
  if (ev.power) log.b = ev.power;
  p.log = withLog(p.log, log);
};

function setGoal(c: CampaignState, p: PowersState, events: RivalEvent[], goal: RivalGoal, day: number): void {
  const r = p.rival;
  r.goal = goal;
  r.since = day;
  r.progress = 0;
  r.where = { region: r.where.region, spot: SPOT[goal](p) };
  r.lead = Math.ceil(100 / rateOf(r));
  if (VISIBLE.has(r.where.spot)) r.seenDay = day;
  pushEvent(p, events, { kind: "goal_set", day, region: r.where.region }, RIVAL_GOALS.indexOf(goal));
}

/** The best goal other than `not` (undefined = any). */
function bestGoal(c: CampaignState, p: PowersState, day: number, not?: RivalGoal): RivalGoal {
  const s = scoreGoals(c, p, day);
  let best: RivalGoal = "lie_low";
  let top = -Infinity;
  for (const g of RIVAL_GOALS) {
    if (g === not) continue;
    if (s[g] > top) {
      top = s[g];
      best = g;
    }
  }
  return best;
}

interface Pay { c: CampaignState }
function payout(c: CampaignState, p: PowersState, events: RivalEvent[], day: number): Pay {
  const r = p.rival;
  const region: RegionId = r.where.region;
  let cc = c;
  const cost = GOAL_COST[r.goal];
  const can = r.purse >= cost;
  switch (r.goal) {
    case "buy_crossing": {
      const ok = can && !crossingSettled(c) && c.crossing.control !== "rival" && c.crossing.bridge !== "collapsed" && wardWeak(c);
      if (ok) {
        cc = { ...c, crossing: { ...c.crossing, control: "rival" } };
        r.purse -= cost;
        pushEvent(p, events, { kind: "bought_crossing", day, region }, 0);
      } else {
        r.grudge = clampI(r.grudge + 5, 0, 100, r.grudge);
        pushEvent(p, events, { kind: "outbid", day, region }, 0);
      }
      break;
    }
    case "survey_route":
      pushEvent(p, events, { kind: "posted_surveyors", day, region }, 0);
      break;
    case "arm_brine":
      if (can) {
        r.purse -= cost;
        p.minor.brine.militaryStrength = clampI(p.minor.brine.militaryStrength + 15, 0, 100, 50);
        p.minor.brine.rivalInfluence = clampI(p.minor.brine.rivalInfluence + 10, 0, 100, 30);
        p.rel["ward|brine"] = clampI(p.rel["ward|brine"] - 10, -100, 100, 0);
        p.rel["rival|brine"] = clampI(p.rel["rival|brine"] + 10, -100, 100, 0);
        pushEvent(p, events, { kind: "armed_brine", day, region, power: "brine" }, 0);
      } else pushEvent(p, events, { kind: "outbid", day, region }, 0);
      break;
    case "found_post":
      if (can && r.posts < 2) {
        r.purse -= cost;
        r.posts = (r.posts + 1) as 1 | 2;
        pushEvent(p, events, { kind: "founded_post", day, region }, r.posts);
      } else pushEvent(p, events, { kind: "outbid", day, region }, 0);
      break;
    case "sabotage_party":
      if (hasFlag(p, "party_post") && !hasFlag(p, "party_post_raided")) {
        p.flags = withFlag(p.flags, "party_post_raided");
        pushEvent(p, events, { kind: "raided_outpost", day, region }, 0);
      } else pushEvent(p, events, { kind: "ambushed_party", day, region }, 0);
      r.grudge = clampI(r.grudge - 20, 0, 100, r.grudge);
      break;
    case "lie_low":
      r.purse = Math.min(RIVAL.purseMax, r.purse + 60);
      r.escort = clampI(r.escort + 5, 0, 100, r.escort);
      r.grudge = clampI(r.grudge - 10, 0, 100, r.grudge);
      pushEvent(p, events, { kind: "retreated", day, region }, 0);
      break;
  }
  return { c: cc };
}

/**
 * Plays the rival's days (rival.day, toDay], at most RIVAL.maxDays per call. Returns new campaign and powers (the inputs are never mutated) and what happened.
 * `c` changes only when the Syndicate buys the crossing.
 */
export function rivalAdvance(c: CampaignState, p0: PowersState, toDay: number): { c: CampaignState; p: PowersState; events: RivalEvent[] } {
  const p = cloneState(p0);
  const events: RivalEvent[] = [];
  const from = p.rival.day;
  const to = Math.min(Math.max(from, clampI(toDay, 1, 9999, from)), from + RIVAL.maxDays);
  let cc = c;
  for (let day = from + 1; day <= to; day++) {
    const r = p.rival;
    r.day = day;
    r.purse = Math.min(RIVAL.purseMax, r.purse + RIVAL.income + (r.goal === "lie_low" ? 8 : 0));
    const target = cc.factions.rival.militaryStrength;
    r.escort = r.escort < target ? Math.min(target, r.escort + 1) : r.escort > target ? Math.max(target, r.escort - 1) : r.escort;
    if (day % 3 === 0 && r.grudge > 0) r.grudge -= 1;
    r.where = { region: r.where.region, spot: SPOT[r.goal](p) };
    if (VISIBLE.has(r.where.spot)) r.seenDay = day;
    // keep the goal at least `dwell` days; switch only for a clearly better one
    if (day - r.since >= RIVAL.dwell) {
      const s = scoreGoals(cc, p, day);
      const best = bestGoal(cc, p, day);
      if (best !== r.goal && s[best] >= s[r.goal] + RIVAL.hysteresis) setGoal(cc, p, events, best, day);
    }
    const rate = rateOf(p.rival);
    p.rival.progress = Math.min(100, p.rival.progress + rate);
    p.rival.lead = Math.max(0, Math.ceil((100 - p.rival.progress) / rate));
    if (p.rival.progress >= 100 && day - p.rival.since >= RIVAL.leadMin) {
      cc = payout(cc, p, events, day).c;
      setGoal(cc, p, events, bestGoal(cc, p, day, p.rival.goal), day);
    }
  }
  return { c: cc, p, events };
}

/** What the Syndicate physically has in the region NOW (drives the crossing's arrival time, the roster, the wagon). */
export function rivalPresence(_c: CampaignState, p: PowersState): RivalPresence {
  const r = p.rival;
  const sooner = Math.round(r.grudge * 1.2) + (r.goal === "sabotage_party" ? 60 : 0) - (r.goal === "lie_low" ? 60 : 0);
  return {
    goal: r.goal, arrivesInS: Math.min(480, Math.max(150, RIVAL_ARRIVES_S - sooner)), escort: Math.min(3, Math.max(1, 1 + Math.floor(r.escort / 35))),
    wagon: r.goal === "arm_brine" || r.goal === "found_post", surveyors: r.goal === "survey_route" ? 2 : r.goal === "lie_low" ? 0 : 1, postStage: r.posts,
  };
}

/** The map's marker: where the Syndicate was last seen, how stale that is, and (only with intel) what it is up to. */
export function rivalSighting(_c: CampaignState, p: PowersState, intelDays: number): RivalSighting | undefined {
  const r = p.rival;
  if (r.seenDay <= 0) return undefined;
  const s: RivalSighting = { region: r.where.region, where: SPOT_TEXT[r.where.spot], day: r.seenDay, age: Math.max(0, r.day - r.seenDay) };
  if (intelDays >= 1) s.goal = GOAL_NEWS[r.goal].head[0]!;
  return s;
}

/** The paper's announcement of what the Syndicate is doing now: printed from the day the goal is set, so every payout is announced. */
export function rivalDispatch(p: PowersState, seed: number): PaperItem {
  const r = p.rival;
  const t = GOAL_NEWS[r.goal];
  const pick = (list: readonly string[], tag: number): string => list[hash3(seed >>> 0, r.day, r.since, tag) % list.length]!;
  return { slug: "rival-goal", head: pick(t.head, 1), body: pick(t.body, 2).replace("{days}", String(Math.max(1, r.lead))) };
}

/** A paper item for one rival event (the log holds `rival_<kind>`). */
export function rivalEventItem(ev: PowerEvent, seed: number): PaperItem | undefined {
  const kind = ev.kind.startsWith("rival_") ? (ev.kind.slice(6) as keyof typeof EVENT_NEWS) : undefined;
  const t = kind ? EVENT_NEWS[kind] : undefined;
  if (!t) return undefined;
  const pick = (list: readonly string[], tag: number): string => list[hash3(seed >>> 0, ev.day, tag, ev.n) % list.length]!;
  return { slug: `rival-${kind}`, head: pick(t.head, 3), body: pick(t.body, 4) };
}
