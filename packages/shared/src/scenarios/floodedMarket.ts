import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { clamp } from "../math.ts";
import { hash3 } from "../rng.ts";
import { SALTMARKET_ANCHORS, SALTMARKET_SITES, SALTMARKET_SPOTS } from "../saltmarket.ts";
import type { ScenarioInput } from "../scenario.ts";
import { WEAPON } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";
import { ruleWhile } from "./terms.ts";

/**
 * FLOODED MARKET, "The Auction at High Water" (D-037, the Saltmarket Delta; docs/_notes/regions34.md section 4). The Brine Houses decide by auction, in an Exchange that floods at every spring tide and holds
 * its sale regardless. The lot is the Tide Concession of Ossuary Bay: the right to charge visitors for the weather. Four House-Heads with numbered paddles, the Syndicate's factor with a cheque, and an Auctioneer
 * who stands in the water to the ankle, the shin and, by the hammer, rather more. The run's CLOCK is the tide: the hammer falls at HIGH WATER (`endsAtWorldMs`), and the water in the hall rises toward it.
 *
 * The party decides nothing from a menu. It leans on five pressures, and the ending is whatever they add up to:
 *  - the AUCTIONEER's price, which rises with the water (six pounds every half minute): a BID is a promise of the purse and stands until somebody bids higher; a SHORT bid is a promise of nothing, offered onward.
 *  - the four HOUSE-HEADS: each has a ceiling at which the paddle stops. Buy a head off (his paddle goes, the money goes), pool with one (a signature on a consortium), or whisper about the factor's shorting (every
 *    ceiling comes down a little). The loudest paddle goes first: that is who is raising it.
 *  - the SYNDICATE's FACTOR: a cheque, a ceiling and a hand to shake. Pool with him (INTERACT twice) and he counts as a signature; put him down and his ceiling is out of the room (a bystander, as the Houses
 *    see it).
 *  - the PURSE: bids and buy-offs come out of it, and nothing more.
 *  - the WATER: at high water the hammer falls on whatever is standing.
 * Endings (first wins, then the state is frozen):
 *  `consortium`: two signatures (two Houses, or a House and the factor). The pool is immediate.
 *  `lot_won`: at the hammer (or as soon as no paddle is left) the party's standing bid is the highest and meets the reserve.
 *  `shorted`: the same, with a short bid that no cash backs: the lot is the party's, unpaid, and the Houses will remember.
 *  `washed_out`: the hammer falls on nothing the party can win, or somebody drew a weapon in the hall and the sale was suspended; the water, by the end of it, is over the rostrum.
 *  `abandoned`: the party is down. Leaving commits what happened (`leave`): nothing, or `abandoned`.
 * Complications (existing ids only): rain hurries the tide (the hammer falls a minute early), fog lengthens it (the hall is hard to find: a minute late).
 */

export const MARKET = {
  /** The hammer falls this many seconds in (a seeded value in this range): high water. */
  highMin: 330, highMax: 450,
  rainHigh: -60, fogHigh: 60,
  /** The lot's reserve (pounds, multiples of five), and what the price adds every half minute. */
  reserve: [40, 60], riseStep: 6, riseEvery: 30,
  /** The paddles' ceilings above the reserve, and the factor's: a factor with a worse Syndicate is cheaper. */
  headAbove: [10, 60], factorAbove: 25,
  /** A House-Head's price to withdraw (pounds, multiples of five), and what a whisper takes off every ceiling. */
  priceHead: [30, 55], whisper: 15, whispers: 3,
  /** The party's share of a consortium, and what a short lot pays the party in commission. */
  share: 25, commission: 35,
  /** Signatures that make a pool. */
  signatures: 2,
  /** Reach of INTERACT with a person (metres), and the hall's circle. */
  personR: 2.4, hallR: 22,
} as const;

type Heads = readonly [number, number, number, number];

export interface MarketState extends BaseState {
  complication: ComplicationId; rain: number;
  near: { hall: number };
  /** The lot's reserve and the moment of the hammer (seconds in). */
  reserve: number; high: number;
  /** The four House-Heads' ceilings, loudest first, and the factor's. */
  ceilings: Heads; factor: number;
  /** Heads out of the bidding, loudest first (bought off or pooled), and whispers heard. */
  gone: number; whispers: number;
  factorOffered: boolean; factorPooled: boolean; factorDown: boolean;
  /** Signatures on a pool (heads pooled, plus the factor). */
  signed: number; bought: number;
  /** The party's standing bid (promised cash) and short bid (promised nothing). */
  bid: number; short: number;
  price: { head: number[] };
  parleyPrice: number;
  asked: { head: boolean; auctioneer: boolean };
  down: { auctioneer: boolean };
  hostile: boolean;
  purse: number; spent: number; paid: number; loot: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): MarketState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "flooded_market", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x3a6e + k);
  const high = MARKET.highMin + (h(1) % (MARKET.highMax - MARKET.highMin + 1)) + (complication === "rain" ? MARKET.rainHigh : complication === "fog" ? MARKET.fogHigh : 0);
  const reserve = rnd5(...MARKET.reserve, h(2));
  const cs = [0, 1, 2, 3].map((i) => reserve + rnd5(...MARKET.headAbove, h(3 + i))).sort((a, b) => b - a);
  const rivalPush = c.factions.ward.rivalInfluence;
  const factor = reserve + MARKET.factorAbove + 5 * Math.round(rivalPush / 25);
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, rain: 0, near: { hall: 0 }, reserve, high: Math.round(high), ceilings: [cs[0]!, cs[1]!, cs[2]!, cs[3]!], factor,
    gone: 0, whispers: 0, factorOffered: false, factorPooled: false, factorDown: false, signed: 0, bought: 0, bid: 0, short: 0,
    price: { head: [0, 1, 2, 3].map((i) => rnd5(...MARKET.priceHead, h(8 + i))) }, parleyPrice: 0,
    asked: { head: false, auctioneer: false }, down: { auctioneer: false }, hostile: false,
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, loot: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

/** What the Auctioneer is asking right now: the reserve, climbing with the tide. */
export const askAt = (s: Pick<MarketState, "reserve" | "t">): number => s.reserve + MARKET.riseStep * Math.floor(Math.max(0, s.t) / MARKET.riseEvery);
/** The loudest paddle still in the bidding (0: none). A whisper takes a little off every House's ceiling (never below the reserve). */
export function rivalMax(s: MarketState): number {
  let best = 0;
  for (let i = s.gone; i < 4; i++) best = Math.max(best, Math.max(s.reserve, s.ceilings[i]! - MARKET.whisper * s.whispers));
  if (!s.factorDown && !s.factorPooled) best = Math.max(best, s.factor);
  return best;
}
const headsLeft = (s: MarketState): number => 4 - s.gone;
/** Cash the party can still promise: the purse less what it has spent buying paddles off. */
const free = (s: MarketState): number => Math.max(0, s.purse - s.spent);
const phaseOf = (s: MarketState): MarketState["phase"] =>
  s.parley ? "parley" : s.hostile ? "fighting" : s.near.hall > 0 ? (s.t >= s.high - 90 ? "tension" : "waiting") : "approach";
const fin = (s: MarketState): MarketState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const hush = (): ScenarioFx[] => [{ k: "order", group: "heads", order: { o: "stand_down" } }, { k: "order", group: "auction", order: { o: "stand_down" } }];

// ---- the ending rules, in one place -----------------------------------------------------------------------------------------------------------

/** The hammer: what stands at high water (or when nobody is left to outbid). */
function hammer(s: MarketState, said: ScenarioFx[], atHighWater: boolean): Reduction<MarketState> {
  const rival = rivalMax(s);
  const bar = Math.max(s.reserve, rival);
  const real = s.bid > 0 && s.bid >= bar;
  const short = s.short > 0 && s.short >= bar;
  if (real && (!short || s.bid >= s.short)) {
    return resolveWith(s, "lot_won", { paid: s.spent + s.bid }, [...said, ...hush(), say(`\"Going, going, gone!\" The hammer falls at £${s.bid}. The Tide Concession is the Society's: the right to charge visitors for the weather. It is, right now, raining.`)]);
  }
  if (short) {
    return resolveWith({ ...s, brokePromise: true }, "shorted", { paid: s.spent, loot: MARKET.commission }, [...said, ...hush(), say(`The hammer falls on your bid of £${s.short}, with no money behind it. The lot is the Society's, unpaid, and so is a commission. The Houses are furious, in order of rank.`)]);
  }
  if (!atHighWater) return { s: fin(s), fx: said };
  return resolveWith(s, "washed_out", { paid: s.spent }, [...said, ...hush(), say("The water reaches the rostrum. The hammer falls anyway, with a splash, on a rival's bid. The lot is gone, and so is the afternoon.")]);
}

/**
 * D-041: a consortium pools a BIDDER's purse with a paddle, so the party must be in the bidding (a standing bid, or a short one) before anybody signs. The bot playtest pooled the
 * Tide Concession with two free signatures in thirty seconds of a sale meant to run until the water was over the rostrum.
 */
const inBidding = (s: MarketState): boolean => s.bid > 0 || s.short > 0;
const NO_POOL_HEAD = "\"The family partners with bidders, not spectators,\" says the House-Head. \"Place a bid with the Auctioneer first. Then we can talk.\"";
const NO_POOL_FACTOR = "The factor pulls his hand back. \"A partner is somebody already bidding. Place a bid, then come back, and we shall be partners at once.\"";

/** After every change: does the sale add up to an ending? (The first that does wins.) */
function settle(s: MarketState, said: ScenarioFx[] = []): Reduction<MarketState> {
  if (s.phase === "resolved") return { s, fx: said };
  if (s.signed >= MARKET.signatures) {
    const share = Math.min(MARKET.share, free(s));
    return resolveWith(s, "consortium", { paid: s.spent + share }, [...said, ...hush(), say("Two signatures on one salt-stained sheet: the deal is made. The Houses and the Society now own the Tide Concession together. Nobody will read the small print.")]);
  }
  // nobody left to outbid: the Auctioneer calls the lot early
  if ((s.bid > 0 || s.short > 0) && rivalMax(s) === 0) return hammer(s, said, false);
  return { s: fin(s), fx: said };
}

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

/** The Exchange suspends the sale: somebody drew a weapon in the hall. First cause wins; the water does the rest. */
function suspend(s: MarketState, why: string, brokePromise = false): Reduction<MarketState> {
  const bp = s.brokePromise || brokePromise;
  return resolveWith({ ...s, hostile: true, brokePromise: bp }, "washed_out", { paid: s.spent }, [
    { k: "order", group: "heads", order: { o: "flee" } }, { k: "order", group: "auction", order: { o: "flee" } }, say(why),
  ]);
}

function reduce(s: MarketState, e: ScenarioInput): Reduction<MarketState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const dt = dtOf(e);
      const n: MarketState = { ...s, t: s.t + dt };
      if (n.t >= n.high) return hammer({ ...n, parley: undefined }, [], true);
      const fx: ScenarioFx[] = [];
      if (s.t < s.high - 90 && n.t >= n.high - 90) fx.push(say("The water is over the second step and rising. The regulars hitch up their coats. The Auctioneer has started saying 'going'. The hammer falls soon."));
      return settle(n, fx);
    }
    case "weather": return stay(fin({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 }));
    case "near": {
      if (e.at !== "hall") return stay(s);
      const n = Math.max(0, Math.min(8, int(e.party, 0, 8, 0)));
      if (s.near.hall === n) return stay(s);
      const first = s.near.hall === 0 && n > 0 && s.phase === "approach";
      return { s: fin({ ...s, near: { hall: n } }), fx: first ? [say("The Exchange. The lot is the Tide Concession of Ossuary Bay, and the water is at your ankles. Four paddles are up, and a factor waits with a cheque. Mind your purse.")] : [] };
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "heads" && e.at !== "auction") return stay(s);
      return suspend(s, "A weapon in the hall! Every paddle drops, the hammer slams on the rail, and the sale is called off.", s.parley !== undefined || s.signed > 0 || s.bid > 0);
    }
    case "actor": {
      if (e.state !== "down") return stay(s);
      if (e.id === "auctioneer" && !s.down.auctioneer) return suspend({ ...s, down: { auctioneer: true } }, "The Auctioneer is down. Nobody is left to sell the lot, and the sale is off.");
      if (/^head-[0-3]$/.test(e.id)) return suspend(s, "A House-Head is down, still holding his paddle. The Houses will not take that lying down. The sale is called off.", true);
      if (e.id === "factor" && !s.factorDown) {
        return settle(fin({ ...s, factorDown: true }), [say("The Syndicate's factor is down, cheque and all. The Houses call it bad luck. The Syndicate calls it a grudge. His bid is out of the sale.")]);
      }
      return stay(s);
    }
    case "use": {
      if (e.target !== "factor" || s.factorDown || s.factorPooled) return stay(s);
      if (!s.factorOffered) return { s: fin({ ...s, factorOffered: true }), fx: [say("The Syndicate's factor takes out a cheque and a pen. \"A partnership,\" he says. \"The Syndicate pays, you sign, the Houses rage. Shake my hand again to agree.\"")] };
      if (!inBidding(s)) return { s: fin(s), fx: [say(NO_POOL_FACTOR)] };
      return settle(fin({ ...s, factorPooled: true, signed: s.signed + 1 }), [say("You shake the factor's hand. It is dry, which is remarkable in this hall. He signs. One signature of two.")]);
    }
    case "talk": return talk(s, e.kind, e.result, e.paid);
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, {});
    }
    default: return stay(s);
  }
}

// ---- the parleys ------------------------------------------------------------------------------------------------------------------------------

const paidOk = (s: MarketState, paid: number, cap: number): boolean => Number.isFinite(paid) && paid >= Math.round(s.parleyPrice * 0.75) && paid <= Math.round(s.parleyPrice * 1.25) && paid <= cap;

function talk(s: MarketState, kind: string, result: string, paid: number): Reduction<MarketState> {
  if (kind === "auctioneer") return talkAuctioneer(s, result, paid);
  if (kind === "house_head") return talkHead(s, result, paid);
  return stay(s);
}

function talkAuctioneer(s: MarketState, result: string, paid: number): Reduction<MarketState> {
  if (result === "open") {
    if (s.parley || s.hostile || s.down.auctioneer) return stay(s);
    const p = askAt(s);
    return { s: fin({ ...s, parley: "auctioneer", parleyPrice: p }), fx: [{ k: "parley", kind: "auctioneer", price: p }] };
  }
  if (s.parley !== "auctioneer") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "hostile": return suspend({ ...s, parley: undefined }, "You threaten the Auctioneer with a weapon. His hammer slams the rail, and the sale is called off.", true);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, auctioneer: true } }));
    case "paid": {
      if (!paidOk(s, paid, free(s))) return stay(fin({ ...s, parley: undefined }));
      const bid = Math.max(s.bid, paid);
      return settle(fin({ ...s, parley: undefined, bid }), [say(`A bid of £${paid} is entered in your name. It stands until somebody bids higher, or the water does.`)]);
    }
    case "tip": {
      const short = Math.max(s.short, s.parleyPrice);
      return settle(fin({ ...s, parley: undefined, short }), [say(`A short bid of £${short} goes in, with no money behind it. The Auctioneer writes it in the other ledger, the water-stained one.`)]);
    }
    default: return stay(fin({ ...s, parley: undefined }));
  }
}

function talkHead(s: MarketState, result: string, paid: number): Reduction<MarketState> {
  if (result === "open") {
    if (s.parley || s.hostile) return stay(s);
    if (headsLeft(s) === 0) return { s, fx: [say("No House paddles are left in the bidding. The Houses have gone, in dignified silence.")] };
    const p = s.price.head[s.gone]!;
    return { s: fin({ ...s, parley: "house_head", parleyPrice: p }), fx: [{ k: "parley", kind: "house_head", price: p }] };
  }
  if (s.parley !== "house_head") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "hostile": return suspend({ ...s, parley: undefined }, "You threaten a House-Head with a weapon. Every paddle drops, and the sale is called off.", true);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, head: true } }));
    case "paid": {
      if (headsLeft(s) === 0 || !paidOk(s, paid, free(s) - s.bid)) return stay(fin({ ...s, parley: undefined }));
      return settle(fin({ ...s, parley: undefined, gone: s.gone + 1, spent: s.spent + paid, bought: s.bought + 1 }), [say(`£${paid} changes hands under the rail. A House-Head sits down in the water, paddle across his knees. One rival fewer.`)]);
    }
    case "survey": {
      if (headsLeft(s) === 0) return stay(fin({ ...s, parley: undefined }));
      if (!inBidding(s)) return { s: fin({ ...s, parley: undefined }), fx: [say(NO_POOL_HEAD)] };
      return settle(fin({ ...s, parley: undefined, gone: s.gone + 1, signed: s.signed + 1 }), [say(s.signed + 1 >= MARKET.signatures ? "The second signature goes down. The ink, you notice, is salt." : "A House-Head signs up as your partner. One signature of two. The heron on his badge looks hopeful for the first time.")]);
    }
    case "tell": {
      if (s.whispers >= MARKET.whispers) return stay(fin({ ...s, parley: undefined }));
      return settle(fin({ ...s, parley: undefined, whispers: s.whispers + 1 }), [say("The whisper runs down the row faster than the water. Every House will now bid a little lower, and pretends it was never told.")]);
    }
    default: return stay(fin({ ...s, parley: undefined }));
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: MarketState): ReturnType<TemplateDef<MarketState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  const nothing = tallyEmpty(s.tally) && s.near.hall === 0 && !s.hostile && !s.parley && s.bid === 0 && s.short === 0 && s.signed === 0 && s.spent === 0 && s.gone === 0 && s.whispers === 0;
  return nothing ? undefined : "abandoned";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const HINT: Record<string, string> = {
  approach: "The Exchange is at the end of the boardwalk. The Houses auction the Tide Concession there at high water, in the flood. Walk to the hall.",
  waiting: "Bid with the Auctioneer: to win, you must beat every rival's top figure. Or buy Houses off. Or bid, then get two partners to sign. The hammer falls at high water.",
  parley: "They are listening. Careful what you promise: the Exchange writes everything down.",
  fighting: "The sale has been suspended. The water has not.",
  tension: "The water is over the second step. When the hammer falls, the highest bid standing wins.",
};
const DONE: Record<string, string> = {
  lot_won: "The Tide Concession is the Society's, won in an inch of water. Take the boat home and charge somebody for the weather.",
  consortium: "A shared win: the Houses and the Society own the lot together. Take the boat home and wait for your share, and the arguments.",
  shorted: "The lot is the Society's, and nobody has been paid for it. The Houses will remember. Take the boat home while the hall still has a floor.",
  washed_out: "The sale ended in the flood, and the Society won nothing. Take the boat home and read about it in the papers.",
  abandoned: "The expedition is down. The tide is unmoved. Take the boat home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  rain: "Rain on the Exchange: the tide is early and the hammer falls a minute sooner.",
  fog: "Fog on the delta: the hall is hard to find, but the hammer falls a minute later.",
};

function view(s: MarketState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "lot_won" || res === "consortium" || res === "shorted";
  const rival = rivalMax(s);
  const rivalsOut = s.gone + (s.factorDown || s.factorPooled ? 1 : 0);
  const standing = Math.max(s.bid, s.short);
  const objectives: ObjectiveView[] = [
    { id: "hall", text: "Walk the boardwalk to the Exchange", done: s.near.hall > 0 || s.phase !== "approach" },
    { id: "bid", text: standing > 0 ? `Your bid: £${standing}${s.short > s.bid ? " (short, no cash)" : ""}. Price now: £${askAt(s)}` : `Place a bid (the price is £${askAt(s)} and rising with the water)`, done: standing > 0, optional: true },
    { id: "paddles", text: `Remove rival bidders: buy off or sign up (${Math.min(5, rivalsOut)} of 5 out)`, done: rival === 0, optional: true },
    { id: "pool", text: `Pool a consortium: bid first, then get signatures (${Math.min(MARKET.signatures, s.signed)} of ${MARKET.signatures})`, done: s.signed >= MARKET.signatures, optional: true },
    { id: "lot", text: res === "abandoned" ? "Lost: the expedition went down" : res === "washed_out" ? "Lost: the sale closed in the flood" : "Win the lot: top cash bid at the hammer, or a consortium", done: won },
  ];
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the quay", done: false });
  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  if (res === undefined && s.asked.head) hint += ` (A House-Head's tip: the top rival bid stops at £${rival}.)`;
  if (res === undefined && s.asked.auctioneer) hint += ` (The Auctioneer's tip: the price started at £${s.reserve} and rises £${MARKET.riseStep} every half-minute.)`;
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remain = res !== undefined ? 0 : s.high - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer("High water", remain, now), template: "flooded_market", title: "The Auction at High Water", ...ruleWhile("flooded_market", res === undefined) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: MarketState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  const o: ScenarioOutcome = {
    scenario: "flooded_market", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise,
    seconds: Math.round(s.resolvedAt), complication: s.complication, region: "saltmarket",
  };
  if (s.loot > 0) o.loot = s.loot;
  return o;
}

// ---- the people -------------------------------------------------------------------------------------------------------------------------------

const HEAD_NAMES = ["House-Head Marrow Tideway (the heron)", "House-Head Sabine Quaymere (the eel)", "House-Head Corvin Drydock-Pell (the gull)", "House-Head Ottoline Brack-Saltry (the whelk)"] as const;

function roster(_c: CampaignState, seed: number, _s: MarketState): NpcSpec[] {
  const S = SALTMARKET_SITES;
  const out: NpcSpec[] = [];
  const mk = (id: string, faction: NpcSpec["faction"], side: NpcSpec["side"], group: string, post: { x: number; z: number }, name: string, bravery: number, i: number): NpcSpec => ({
    id, role: NPC.FACTOR, faction, side, group, post: { x: post.x, z: post.z }, weapon: WEAPON.FISTS, lookSeed: hash3(seed >>> 0, i, NPC.FACTOR), name, skill: 10, bravery, brain: "civil",
  });
  out.push(mk("auctioneer", "ward", "neutral", "auction", S.auctioneer, "Mr. Crispin Spate-Holloway, Auctioneer to the Houses", 70, 0));
  S.houseHeads.forEach((p, i) => out.push(mk(`head-${i}`, "ward", "neutral", "heads", p, HEAD_NAMES[i]!, 40 - 4 * i, 1 + i)));
  out.push(mk("factor", "rival", "rival", "factor", SALTMARKET_SPOTS.factor, "Factor Cosmo Dunmarrow-Pell, for the Syndicate", 30, 5));
  return out;
}

const observe: ObserveSpec = {
  near: [{ id: "hall", x: SALTMARKET_ANCHORS.exchange.x, z: SALTMARKET_ANCHORS.exchange.z, r: MARKET.hallR }],
  use: [
    { id: "auctioneer", npc: "auctioneer", r: MARKET.personR, talk: "auctioneer", carry: "none" },
    ...[0, 1, 2, 3].map((i) => ({ id: `head${i}`, npc: `head-${i}`, r: MARKET.personR, talk: "house_head" as const, carry: "none" as const })),
    { id: "factor", npc: "factor", r: MARKET.personR, carry: "none", prompt: "Shake the factor's hand" },
  ],
  count: [],
  seen: [],
  actors: [{ id: "auctioneer" }, { id: "head-0" }, { id: "head-1" }, { id: "head-2" }, { id: "head-3" }, { id: "factor" }],
  hostileGroups: ["heads", "auction"],
};

export const floodedMarketTemplate: TemplateDef<MarketState> = {
  id: "flooded_market", title: "The Auction at High Water",
  brief: "The Brine Houses auction the Tide Concession in an Exchange that floods at high tide. Outbid four House-Heads and a Syndicate factor, or strike deals with them. Violence ends the sale.",
  init, reduce, view, outcome, roster, leave, observe,
  sites: { hall: SALTMARKET_ANCHORS.exchange },
};
