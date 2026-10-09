import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { clamp } from "../math.ts";
import { PropKind } from "../props.ts";
import { hash3 } from "../rng.ts";
import { SALTMARKET_ANCHORS, SALTMARKET_SITES, SALTMARKET_SPOTS } from "../saltmarket.ts";
import type { ScenarioInput } from "../scenario.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";
import { ruleWhile } from "./terms.ts";

/**
 * SMUGGLING RUN, "The Quiet Barge" (D-037, the Saltmarket Delta; docs/_notes/regions34.md section 4). Four unmarked crates lie at the reed cove, on a barge that is not, on paper, anywhere. The drop-house stands in
 * the west reeds, a hundred and twenty metres of boardwalk, two bridges and one Constabulary patrol away. Nobody has declared anything, and the Houses' Customs House would like it to stay that way until it can
 * be billed for.
 *
 * The party decides nothing from a menu. It leans on five pressures, and the ending is whatever they add up to:
 *  - the CRATES: pick one up at the cove and carry it to the drop-house door (INTERACT with a crate in hand). Three of the four land the cargo.
 *  - the PATROL: two Constabulary men walk the boardwalk between the Customs Bridge and the Exchange, seventy seconds a leg. Once the party has been to the cargo, being SEEN by one of them (or by the Customs
 *    House's own men, who see less far) is a challenge: eight seconds to answer it, or the cargo is impounded. Fog and rain shorten their sight.
 *  - the TIDE-REEVE at the Customs House: declare the barge (free: the duty goes to the Houses, the patrol waves you through for a few minutes, and the cargo's profit goes with it), or slip him a courtesy
 *    (the same stamped passage, and the cargo is yours to sell), or inform on your own barge (the Houses pay a finder's fee, and the barge is impounded in your honour).
 *  - the LANTERN at the cove: lit once, it draws the patrol to the cutter berth for a minute, to see who is lighting it.
 *  - the BARGE's PLUG: INTERACT with empty hands at her stern and she goes down with the cargo rather than be caught.
 * Endings (first wins, then the state is frozen):
 *  `landed`: the third crate is at the drop-house and the Constabulary is not on the party's heels (no alarm, or the guard is broken). An alarm that is not won leaves HOT_S seconds before the patrol arrives.
 *  `impounded`: a challenge ran out; or the patrol arrived on a hot landing; or slack water ended with the cargo still on the barge.
 *  `scuttled`: somebody pulled the plug.
 *  `informed`: the party told the Tide-Reeve about its own run. The Houses pay for the tip.
 *  `abandoned`: the party is down. Leaving commits what happened (`leave`): nothing, `abandoned`, or `impounded` once a crate has been carried.
 * Complications (existing ids only): fog and rain narrow the patrol's sight (the runner does that), a Ward patrol adds a third Constabulary man at 90 s, and the Houses' own patrol is the one that matters.
 */

export const SMUGGLE = {
  /** The tide's window: slack water ends this many seconds in, and the Constabulary finds the barge. */
  slackS: 600,
  /** Crates on the barge, and how many make a landing. */
  crates: 4, need: 3,
  /** Metres: how far a patrolman sees at clear weather; the Customs House's own men see less (they are indoors in spirit). */
  sightPatrol: 14, sightCustoms: 10,
  /** Seconds the party has to answer a challenge before the cargo is impounded. */
  challengeS: 8,
  /** A stamped passage (declaration or courtesy) holds this long; the lantern draws the patrol away this long. */
  permitS: 240, lureS: 70,
  /** A hot landing (an alarm that was not won) lasts this long before the patrol arrives. */
  hotS: 25,
  /** The patrol turns round at the end of each leg after this many seconds. */
  legS: 70,
  /** Noise (0..100) that wakes the Customs House; the rain muffles it. */
  alarmNoise: 60, rainNoiseBonus: 15, noiseDecay: 4,
  /** A Ward patrol is dealt as a third man this many seconds in. */
  extraAt: 90,
  /** Reach of INTERACT with a door, a plug, a lantern, a person (metres), and of the three site circles. */
  doorR: 2.4, plugR: 2.0, lanternR: 2.0, personR: 2.4, coveR: 16, dropR: 12, customsR: 18,
  /** Prices (pounds, multiples of five): the courtesy, and the Houses' finder's fee. */
  priceCourtesy: [30, 60], priceTip: [40, 85],
  /** Cargo's worth when the party sells it itself (undeclared), per crate, and the party's share. */
  perCrate: 12, base: 30,
} as const;

type Count = { alive: number; routed: number; down: number; total: number };

export interface SmugglingState extends BaseState {
  complication: ComplicationId; rain: number;
  near: { cove: number; drop: number; customs: number };
  /** The party has been to the cargo: from now on a sighting is a challenge. */
  loaded: boolean;
  delivered: number;
  /** Until when a stamped passage holds (0: none), and whether the cargo was declared (the Houses take the duty and the profit). */
  permit: number; declared: boolean;
  /** The lantern: lit once; the patrol is drawn off until `lureUntil`. */
  lit: boolean; lureUntil: number;
  /** Seconds left to answer a sighting (0: none). */
  challenge: number;
  alarm: boolean; hostile: boolean; noise: number;
  /** A hot landing's seconds left (0: none). */
  hot: number;
  guards: { customs: Count; patrol: Count; extra: Count };
  extra: boolean; leg: number; legAt: number;
  down: { reeve: boolean };
  price: { courtesy: number; tip: number };
  parleyPrice: number; asked: boolean; told: boolean;
  purse: number; spent: number; paid: number; loot: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));
const NOCOUNT = (n: number): Count => ({ alive: n, routed: 0, down: 0, total: n });

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): SmugglingState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "smuggling_run", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x5a91 + k);
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, rain: 0, near: { cove: 0, drop: 0, customs: 0 }, loaded: false, delivered: 0, permit: 0, declared: false, lit: false, lureUntil: 0,
    challenge: 0, alarm: false, hostile: false, noise: 0, hot: 0,
    guards: { customs: NOCOUNT(2), patrol: NOCOUNT(2), extra: NOCOUNT(0) }, extra: false, leg: 0, legAt: 0, down: { reeve: false },
    price: { courtesy: rnd5(...SMUGGLE.priceCourtesy, h(1)), tip: rnd5(...SMUGGLE.priceTip, h(2)) },
    parleyPrice: 0, asked: false, told: false,
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, loot: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const permitted = (s: SmugglingState): boolean => s.permit > s.t;
const lured = (s: SmugglingState): boolean => s.lureUntil > s.t;
const broken = (c: Count): number => c.routed + c.down;
const guardTotal = (s: SmugglingState): number => s.guards.customs.total + s.guards.patrol.total + s.guards.extra.total;
const brokenAll = (s: SmugglingState): number => broken(s.guards.customs) + broken(s.guards.patrol) + broken(s.guards.extra);
const guardBroken = (s: SmugglingState): boolean => {
  const total = guardTotal(s);
  return total === 0 || brokenAll(s) >= Math.ceil(total * 0.6);
};
const affordable = (s: SmugglingState, n: number): boolean => Number.isFinite(n) && n >= 0 && n <= s.purse - s.spent;
const noiseLimit = (s: SmugglingState): number => SMUGGLE.alarmNoise + (s.rain >= 0.45 || s.complication === "rain" ? SMUGGLE.rainNoiseBonus : 0);
const phaseOf = (s: SmugglingState): SmugglingState["phase"] =>
  s.parley ? "parley" : s.alarm || s.hostile ? "fighting" : s.challenge > 0 ? "standoff" : s.loaded ? "extract" : "approach";
const fin = (s: SmugglingState): SmugglingState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const GUARD_GROUPS = ["customs", "patrol", "late:extra"] as const;
const stand = (): ScenarioFx[] => GUARD_GROUPS.map((g) => ({ k: "order", group: g, order: { o: "stand_down" } }));

/** The patrol's leg: it walks the boardwalk line one way, then the other (routes `line` and `back`); the lantern sends it to the cutter berth (`lure`). */
const route = (leg: number): string => (leg % 2 === 0 ? "line" : "back");

/** The Customs House wakes: everybody who can fight is told. First cause wins; later ones change nothing. */
function raise(s: SmugglingState, why: string, brokePromise = false): Reduction<SmugglingState> {
  const bp = s.brokePromise || brokePromise;
  if (s.alarm) return { s: fin({ ...s, brokePromise: bp }), fx: [] };
  const fx: ScenarioFx[] = [
    { k: "order", group: "customs", order: { o: "alert" } }, { k: "order", group: "patrol", order: { o: "alert" } }, { k: "order", group: "late:extra", order: { o: "alert" } },
    { k: "order", group: "reeve", order: { o: "flee" } }, { k: "order", group: "bargemen", order: { o: "flee" } }, say(why),
  ];
  return { s: fin({ ...s, alarm: true, hostile: true, challenge: 0, parley: undefined, brokePromise: bp }), fx };
}

/** After every change: does the run add up to an ending? (The first that does wins.) */
function settle(s: SmugglingState, said: ScenarioFx[] = []): Reduction<SmugglingState> {
  if (s.phase === "resolved") return { s, fx: said };
  if (s.delivered >= SMUGGLE.need) {
    if (!s.alarm || guardBroken(s)) {
      const loot = s.declared ? 0 : SMUGGLE.base + SMUGGLE.perCrate * s.delivered;
      return resolveWith(s, "landed", { loot }, [
        ...said, ...stand(),
        say(s.declared
          ? "The third crate is in the drop-house. But you declared it all, so none of it is yours. The Houses get the salt and the duty. You get a receipt, in triplicate."
          : "The third crate is in, and the drop-house door shuts quietly. Nobody saw a thing, and the Constabulary will swear to it. The cargo is landed, and its price is yours."),
      ]);
    }
    if (s.hot === 0) return { s: fin({ ...s, hot: SMUGGLE.hotS }), fx: [...said, say("The cargo is in, but the Constabulary is right behind you. Drop them or send them running before they reach the drop-house, or they seize the lot.")] };
  }
  return { s: fin(s), fx: said };
}

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: SmugglingState, e: ScenarioInput): Reduction<SmugglingState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const dt = dtOf(e);
      let n: SmugglingState = { ...s, t: s.t + dt, noise: Math.max(0, s.noise - SMUGGLE.noiseDecay * dt) };
      const fx: ScenarioFx[] = [];
      // the patrol's legs: each way down the boardwalk and back, unless it is fighting or has been drawn off to the berth
      if (!n.alarm && !n.hostile && n.t >= n.legAt && !lured(n)) {
        fx.push({ k: "order", group: "patrol", order: { o: "march", route: route(n.leg) } });
        if (n.extra) fx.push({ k: "order", group: "late:extra", order: { o: "march", route: route(n.leg + 1) } });
        n = { ...n, leg: n.leg + 1, legAt: n.t + SMUGGLE.legS };
      }
      if (n.lit && n.lureUntil > 0 && n.t >= n.lureUntil) {
        n = { ...n, lureUntil: 0, legAt: n.t };
        if (!n.alarm) fx.push(say("The patrol finds nobody at the cove lantern, only some lamp-oil. They walk back to the boardwalk to write it down."));
      }
      if (s.complication === "ward_patrol" && !n.extra && n.t >= SMUGGLE.extraAt) {
        n = { ...n, extra: true, guards: { ...n.guards, extra: NOCOUNT(1) }, legAt: n.t };
        fx.push({ k: "spawn", group: "late:extra" }, say("A Ward patrolman comes down the Customs Bridge, writing something down. He is now on the boardwalk, and in your way."));
      }
      if (n.challenge > 0 && !n.parley && !n.alarm) {
        n = { ...n, challenge: Math.max(0, n.challenge - dt) };
        if (n.challenge === 0) {
          return resolveWith(n, "impounded", {}, [...fx, ...stand(), say("\"That is a cargo,\" says the patrolman, writing. \"I have a form for that.\" The Constabulary seizes the cargo. It has never lost money on a seizure.")]);
        }
      }
      if (n.hot > 0) {
        n = { ...n, hot: Math.max(0, n.hot - dt) };
        if (n.hot === 0) return resolveWith(n, "impounded", {}, [...fx, ...stand(), say("The Constabulary reaches the drop-house with a lantern and a warrant. Everything inside now belongs to the Houses.")]);
      }
      if (n.t >= SMUGGLE.slackS) {
        return resolveWith(n, "impounded", {}, [...fx, ...stand(), say("Slack water ends. The tide turns, and the Constabulary finds the barge at the cove. It has waited patiently since dawn.")]);
      }
      return settle(n, fx);
    }
    case "weather": return stay(fin({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 }));
    case "near": {
      const at = e.at;
      if (at !== "cove" && at !== "drop" && at !== "customs") return stay(s);
      const n = Math.max(0, Math.min(8, int(e.party, 0, 8, 0)));
      if (s.near[at] === n) return stay(s);
      const loads = at === "cove" && n > 0 && !s.loaded;
      return { s: fin({ ...s, near: { ...s.near, [at]: n }, loaded: s.loaded || loads }), fx: loads ? [say("The barge sits low in the cove: four unmarked crates under a tarpaulin, and a lantern post at the bow. Carry the crates to the drop-house in the west reeds.")] : [] };
    }
    case "noise": {
      const level = clamp(Number.isFinite(e.level) ? e.level : 0, 0, 100);
      if (level <= s.noise) return stay(s);
      const n = { ...s, noise: level };
      return level >= noiseLimit(n) ? raise(n, "A shot rings across the reeds. The Customs House is awake, and the patrol is running.") : stay(n);
    }
    case "seen": {
      if (e.group !== "patrol" && e.group !== "customs" && e.group !== "late:extra") return stay(s);
      if (s.alarm || s.challenge > 0) return stay(s);
      if (e.group !== "customs" && lured(s)) return stay(s);   // (the patrol is looking at a lantern)
      if (!s.loaded) return stay(s);   // nothing to answer for yet
      if (permitted(s)) return { s, fx: [say("The patrolman looks at your stamped pass and waves you through. Somebody has told him which way to look.")] };
      return { s: fin({ ...s, challenge: SMUGGLE.challengeS }), fx: [say("\"Halt for inspection!\" A Constabulary man has seen you. He is not shooting yet, only writing. Answer him quickly, or the cargo is seized.")] };
    }
    case "count": {
      if (e.group !== "customs" && e.group !== "patrol" && e.group !== "late:extra") return stay(s);
      const total = int(e.total, 0, 4, 0);
      const alive = int(e.alive, 0, total), routed = int(e.routed, 0, total - alive), down = int(e.down, 0, total - alive - routed);
      const c: Count = { alive, routed, down, total };
      const g = e.group === "customs" ? "customs" : e.group === "patrol" ? "patrol" : "extra";
      const n = fin({ ...s, guards: { ...s.guards, [g]: c } });
      return settle(n);
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "customs" && e.at !== "patrol" && e.at !== "late:extra" && e.at !== "reeve") return stay(s);
      const r = raise(s, "Blood on the boards. The Customs House remembers that it has rifles.", s.parley !== undefined || s.permit > 0 || s.declared);
      return settle(r.s, r.fx as ScenarioFx[]);
    }
    case "actor": {
      if (e.state !== "down" || e.id !== "reeve" || s.down.reeve) return stay(s);
      const r = raise({ ...s, down: { ...s.down, reeve: true } }, "The Tide-Reeve is down. All his paperwork stops at once, and the patrol knows who to blame.");
      return settle(r.s, r.fx as ScenarioFx[]);
    }
    case "use": {
      switch (e.target) {
        case "drop": {
          if (s.delivered >= SMUGGLE.crates) return stay(s);
          const delivered = s.delivered + 1;
          return settle(fin({ ...s, delivered }), delivered >= SMUGGLE.need ? [] : [say(`A crate goes through the drop-house door and does not come back. ${delivered} of ${SMUGGLE.need}.`)]);
        }
        case "plug": {
          if (!s.loaded) return stay(s);
          return resolveWith(s, "scuttled", {}, [...stand(), say("You pull the plug. The barge sinks into the cove, taking four crates of evidence with her. Nobody will ever find them, least of all the Constabulary.")]);
        }
        case "lantern": {
          if (s.lit) return { s, fx: [say("The lantern is already lit. It can only fool the patrol once.")] };
          return { s: fin({ ...s, lit: true, lureUntil: s.t + SMUGGLE.lureS }), fx: [{ k: "order", group: "patrol", order: { o: "march", route: "lure" } }, { k: "order", group: "late:extra", order: { o: "march", route: "lure" } }, say("You light the lantern at the cove. The patrol spots it and walks off to the cutter berth to look, which is the wrong way. That buys you about a minute.")] };
        }
        default: return stay(s);
      }
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

// ---- the parley with the Tide-Reeve -------------------------------------------------------------------------------------------------------------

const paidOk = (s: SmugglingState, paid: number): boolean => Number.isFinite(paid) && paid >= Math.round(s.parleyPrice * 0.75) && paid <= Math.round(s.parleyPrice * 1.25) && affordable(s, paid);

function talk(s: SmugglingState, kind: string, result: string, paid: number): Reduction<SmugglingState> {
  if (kind !== "tide_reeve") return stay(s);
  if (result === "open") {
    if (s.parley || s.hostile || s.down.reeve) return stay(s);
    return { s: fin({ ...s, parley: "tide_reeve", parleyPrice: s.price.courtesy }), fx: [{ k: "parley", kind: "tide_reeve", price: s.price.courtesy }] };
  }
  if (s.parley !== "tide_reeve") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "hostile": {
      const r = raise({ ...s, parley: undefined }, "You threaten the Tide-Reeve with a weapon. The whole Customs House comes out to fight.", true);
      return settle(r.s, r.fx as ScenarioFx[]);
    }
    case "learn": return stay(fin({ ...s, asked: true }));
    case "survey": {
      // a declaration: free, stamped, and the cargo's profit is the Houses'
      // (D-086: a stamped slip answers a patrolman who is waiting for one: the challenge ends, as the orders always said it would)
      return { s: fin({ ...s, parley: undefined, declared: true, challenge: 0, permit: Math.max(s.permit, s.t + SMUGGLE.permitS) }), fx: [say("The barge is declared. Your stamped pass holds for four minutes, so the patrol will let you through. The Houses will take the duty, and later the cargo.")] };
    }
    case "paid": {
      if (!paidOk(s, paid)) return stay(fin({ ...s, parley: undefined }));
      return { s: fin({ ...s, parley: undefined, spent: s.spent + paid, paid: s.paid + paid, challenge: 0, permit: Math.max(s.permit, s.t + SMUGGLE.permitS) }), fx: [say(`You slip the Reeve £${paid}. Your stamped pass holds for four minutes, and the cargo stays yours.`)] };
    }
    case "tell": {
      return resolveWith({ ...s, parley: undefined, told: true }, "informed", { loot: s.price.tip }, [...stand(), say(`You inform on your own barge. The Tide-Reeve happily counts out a finder's fee of £${s.price.tip}. A Constabulary boat sets off for the cove.`)]);
    }
    default: return stay(fin({ ...s, parley: undefined }));
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: SmugglingState): ReturnType<TemplateDef<SmugglingState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  if (s.delivered > 0 || s.challenge > 0) return "impounded";
  const nothing = tallyEmpty(s.tally) && !s.loaded && !s.hostile && !s.parley && s.permit === 0 && !s.lit && s.spent === 0;
  return nothing ? undefined : "abandoned";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const HINT: Record<string, string> = {
  approach: "Go to the barge at the reed cove. Its four crates must reach the drop-house in the west reeds. The Constabulary patrols the boardwalk and its three bridges.",
  extract: "Carry each crate to the drop-house door and press Use. Crouch to hide from the patrol. The Tide-Reeve sells passes. The cove lantern lures the patrol away.",
  standoff: "A patrolman has seen you. Answer him in time, or lose the cargo. Get a pass from the Tide-Reeve (talking to him stops the count), fight, or sink the barge.",
  parley: "The Tide-Reeve is listening. Careful what you declare: he keeps copies.",
  fighting: "The Customs House is awake. Drop most of its men or send them running. Then only the cargo is left to explain.",
};
const DONE: Record<string, string> = {
  landed: "The cargo is landed. The Houses will notice tomorrow, and the Constabulary the day after. Take the boat home from the quay.",
  impounded: "The Constabulary has the cargo. The Houses will auction it for far more than anyone paid, including you. Take the boat home.",
  scuttled: "The barge, the evidence and the profit are all at the bottom of the cove. Take the boat home from the quay.",
  informed: "You informed on yourselves, and got paid for it. The Houses are delighted. The Syndicate hears that someone talked. Take the boat home from the quay.",
  abandoned: "The expedition is down. The reeds are unmoved. Take the boat home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  fog: "Fog on the delta: the patrol sees only half as far. So do you.",
  rain: "Rain on the boards: footsteps and shots are quieter, and the patrol squints.",
  ward_patrol: "A Ward patrolman joins the boardwalk patrol after about ninety seconds. He writes everything down.",
};

function view(s: SmugglingState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "landed";
  const objectives: ObjectiveView[] = [
    { id: "cove", text: "Reach the barge at the reed cove", done: s.loaded },
    { id: "carry", text: `Carry the crates to the drop-house door (${Math.min(s.delivered, SMUGGLE.need)} of ${SMUGGLE.need})`, done: s.delivered >= SMUGGLE.need },
    { id: "reeve", text: s.declared ? "The barge is declared at the Customs House" : permitted(s) ? "You have a stamped pass" : "Get a pass from the Tide-Reeve: declare, or pay him", done: s.declared || s.permit > 0, optional: true },
    { id: "lamp", text: s.lit ? "The lantern is lit: the patrol is at the berth" : "Light the lantern at the cove to draw the patrol off", done: s.lit, optional: true },
    { id: "land", text: res === "abandoned" ? "Lost: the expedition went down" : res === "impounded" ? "Lost: the cargo was seized" : res === "scuttled" ? "Settled: the barge was scuttled" : res === "informed" ? "Settled: you informed on yourselves" : "Land the cargo before slack water ends", done: won },
  ];
  if (s.challenge > 0 && res === undefined) objectives.push({ id: "answer", text: `Answer the patrolman (${Math.ceil(s.challenge)} s): show a pass, or sink the barge`, done: false, optional: true });
  if (s.alarm && res === undefined) objectives.push({ id: "break", text: `Drop the Customs men or send them running (${Math.min(brokenAll(s), Math.ceil(guardTotal(s) * 0.6))} of ${Math.ceil(guardTotal(s) * 0.6)})`, done: guardBroken(s), optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the quay", done: false });
  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  if (res === undefined && s.asked) hint += " (The Reeve's tip: the cove lantern draws the patrol off for a minute. A stamped pass keeps them friendly for four.)";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remain = res !== undefined ? 0 : s.hot > 0 ? s.hot : SMUGGLE.slackS - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(s.hot > 0 ? "The Constabulary arrives" : "Slack water ends", remain, now), template: "smuggling_run", title: "The Quiet Barge", ...ruleWhile("smuggling_run", res === undefined && !s.alarm) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: SmugglingState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  const o: ScenarioOutcome = {
    scenario: "smuggling_run", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise || (s.hostile && (s.declared || s.permit > 0)),
    seconds: Math.round(s.resolvedAt), complication: s.complication, region: "saltmarket",
  };
  if (s.loot > 0) o.loot = s.loot;
  return o;
}

// ---- the people ---------------------------------------------------------------------------------------------------------------------------------

const CUSTOMS_NAMES = ["Tide-Constable Wick Harbury", "Tide-Constable Moll Greene-Ketch", "Tide-Constable Piers Saltwell", "Tide-Constable Hester Tarrow"] as const;
const CUSTOMS_ARMS: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.PISTOL, WEAPON.SABRE, WEAPON.RIFLE];
const BARGEMEN = ["Bargeman Odo Reedley (not here)", "Bargeman Tansy Slack (also not here)"] as const;

function roster(_c: CampaignState, seed: number, _s: SmugglingState): NpcSpec[] {
  const S = SALTMARKET_SITES;
  const out: NpcSpec[] = [];
  const mk = (id: string, role: number, faction: NpcSpec["faction"], side: NpcSpec["side"], group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction, side, group, post: { x: post.x, z: post.z }, weapon, lookSeed: hash3(seed >>> 0, i, role), name, skill, bravery, brain,
  });
  out.push(mk("reeve", NPC.CUSTOMS, "ward", "ward", "reeve", S.tideReeve, WEAPON.FISTS, "Tide-Reeve Odell Marsh-Pettigrew", 10, 60, "civil", 0));
  S.customs.slice(0, 2).forEach((p, i) => out.push(mk(`customs-${i}`, NPC.CUSTOMS, "ward", "ward", "customs", p, CUSTOMS_ARMS[i]!, CUSTOMS_NAMES[i]!, 36 + (hash3(seed >>> 0, i, 0x5a2) % 14), 40 + (hash3(seed >>> 0, i, 0xb6) % 20), "garrison", 1 + i)));
  S.customs.slice(2).forEach((p, i) => out.push(mk(`patrol-${i}`, NPC.CUSTOMS, "ward", "ward", "patrol", p, CUSTOMS_ARMS[2 + i]!, CUSTOMS_NAMES[2 + i]!, 38 + (hash3(seed >>> 0, i, 0x5a3) % 14), 40 + (hash3(seed >>> 0, i, 0xb7) % 20), "garrison", 3 + i)));
  S.bargemen.forEach((p, i) => out.push(mk(`bargeman-${i}`, NPC.BARGEMAN, "ward", "neutral", "bargemen", p, WEAPON.FISTS, BARGEMEN[i]!, 10, 30, "civil", 5 + i)));
  out.push(mk("extra-0", NPC.CUSTOMS, "ward", "ward", "late:extra", { x: -14, z: 72 }, WEAPON.RIFLE, "Patrolman Gideon Marl (on loan from the Ward)", 40, 45, "garrison", 7));
  return out;
}

const SP = SALTMARKET_SPOTS;
const observe: ObserveSpec = {
  near: [
    { id: "cove", x: SALTMARKET_ANCHORS.cove.x, z: SALTMARKET_ANCHORS.cove.z, r: SMUGGLE.coveR },
    { id: "drop", x: SALTMARKET_ANCHORS.drop.x, z: SALTMARKET_ANCHORS.drop.z, r: SMUGGLE.dropR },
    { id: "customs", x: SALTMARKET_ANCHORS.customs.x, z: SALTMARKET_ANCHORS.customs.z, r: SMUGGLE.customsR },
  ],
  use: [
    { id: "reeve", npc: "reeve", r: SMUGGLE.personR, talk: "tide_reeve", carry: "none" },
    { id: "drop", at: SP.dropDoor, r: SMUGGLE.doorR, carry: "crate", consume: true, prompt: "Pass the crate in at the door" },
    { id: "plug", at: SP.plug, r: SMUGGLE.plugR, carry: "none" },
    { id: "lantern", at: SP.lantern, r: SMUGGLE.lanternR, carry: "none" },
  ],
  count: [{ group: "customs", routed: "garrisonRouted" }, { group: "patrol", routed: "garrisonRouted" }, { group: "late:extra", routed: "garrisonRouted" }],
  seen: [{ group: "patrol", sight: SMUGGLE.sightPatrol }, { group: "customs", sight: SMUGGLE.sightCustoms }, { group: "late:extra", sight: SMUGGLE.sightPatrol }],
  noise: { x: SALTMARKET_SITES.tideReeve.x, z: SALTMARKET_SITES.tideReeve.z },
  actors: [{ id: "reeve" }],
  hostileGroups: ["customs", "patrol", "late:extra", "reeve"],
};

/** The patrol's lines along the boardwalk (named walks for `order march`): out to the Exchange's apron and back, and the lure to the cutter berth. */
const LINE: readonly { x: number; z: number }[] = [{ x: -14, z: 70 }, { x: -12, z: 55 }, { x: -10, z: 40 }, { x: -4, z: 26 }, { x: 0, z: 12 }, { x: 0, z: -14 }, { x: 8, z: -26 }];

export const smugglingRunTemplate: TemplateDef<SmugglingState> = {
  id: "smuggling_run", title: "The Quiet Barge",
  brief: "Sneak a barge's unmarked crates past the Tide Constabulary to a drop-house in the reeds. The Society will not say what is in them, or it would have to declare it.",
  init, reduce, view, outcome, roster, leave, observe,
  routes: { line: LINE, back: [...LINE].reverse(), lure: [{ x: -34, z: 70 }, { x: -44, z: 76 }] },
  props: Array.from({ length: SMUGGLE.crates }, (_, i) => ({ id: `cargo-${i}`, kind: PropKind.CRATE, x: SALTMARKET_SITES.cargo.x + [-1.2, 0.2, 1.4, -0.2][i]!, z: SALTMARKET_SITES.cargo.z + [-0.8, 0.9, -0.5, -1.8][i]! })),
  sites: { cove: SALTMARKET_ANCHORS.cove, drop: SP.dropDoor },
};
