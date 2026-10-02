import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { HIGHMARK_SITES } from "../highmark.ts";
import { PropKind } from "../props.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";

/**
 * THE REAPERS' STRIKE (D-042, Highmark's second contract; docs/_notes/reapers.md). Harvest week. The Reapers' Compact has laid down its scythes: the Crown's royal bushel, the measure every
 * reaper's day is paid by, is a third larger than the bushel the Crown SELLS by. The barley stands, the rain is coming, the Crown's Steward of the Granary wants the harvest in without an inquiry,
 * and the Syndicate has a barge of bonded strike-breakers on the river and a contract for the grain that pays it either way.
 *
 * The party decides nothing from a menu. Four pressures, and the ending is what they add up to:
 *  - the FOREPERSON (parley `reaper`): a harvest bonus out of the party's purse ends it today (`bought_back`); an honest measure she signs only once the fraud is proven; a threat ends her dealing.
 *  - the ROYAL BUSHEL (a barrel on the granary scale, up the hill): carried to the Steward and weighed in front of him, it is the proof. Any other barrel is just a barrel.
 *  - the STEWARD (parley `steward`): decrees an honest measure once the bushel is weighed; before that, he offers the party a fee to talk the Compact back (`tip`), and sends the barge word to hurry.
 *  - the STRIKE-BREAKERS (`late:breakers`, four, landed at the quay at `barge`, marching to the barley): two in the field with the Compact still out break the strike. Fight them and they stop
 *    marching to fight you; whatever else happens, they are not cutting barley this afternoon.
 * Endings (first wins, then the state is frozen):
 *  `honest_measure`: the bushel weighed AND both the Steward and the Foreperson signed (either order).  `bought_back`: the bonus was paid.
 *  `strike_broken`: two strike-breakers reached the barley unopposed.  `barley_lost`: the rain arrived with the Compact still out.  `abandoned`: the party is down.
 * Leaving commits what happened (`leave`): nothing; or the barge's work if it has landed and nobody turned it; or the rain's.
 * Complications (existing ids only): rain brings the rain forward, outriders the barge, fog delays both. The Steward's fee is paid only on results (back at work, nothing reformed).
 */

export const STRIKE = {
  /** The barge lands this many seconds in (seeded in range); outriders bring it forward, fog delays it; once the Steward has sent word it lands no later than `hurriedS` after. */
  bargeMin: 150, bargeMax: 190, outridersBarge: -60, fogBarge: 30, hurriedS: 20,
  /** The rain reaches the barley (seeded in range); the rain complication brings it forward, fog holds it off. */
  rainMin: 380, rainMax: 440, rainRain: -90, fogRain: 40,
  /** Strike-breakers on the barge, and how many in the field break the strike. */
  breakers: 4, breakersNeeded: 2,
  /** The Compact's harvest bonus (the party pays), the Steward's fee (the party is paid, on results); pounds, multiples of five. */
  priceBonus: [40, 75], priceFee: [30, 55],
  /** Reach of INTERACT with a person; the picket line's site radius. */
  personR: 2.4, lineR: 16,
} as const;

export interface StrikeState extends BaseState {
  complication: ComplicationId;
  near: { line: number };
  asked: { reaper: boolean; steward: boolean };
  /** The royal bushel has been weighed in front of the Steward. */
  proof: boolean;
  agreed: { steward: boolean; compact: boolean };
  /** The Compact will not deal (threatened, attacked, or its Foreperson is down). */
  refused: boolean;
  /** Nobody is left to decree a measure (the Steward was threatened, attacked or is down). */
  stewardGone: boolean;
  /** The party took the Steward's fee. */
  tipped: boolean;
  barge: number; landed: boolean;
  /** Strike-breakers who reached the barley unopposed; `fight`: the party has fought them (they stopped marching). */
  inField: number; fight: boolean;
  crew: { alive: number; routed: number; down: number; total: number };
  rainAt: number;
  price: { bonus: number; fee: number };
  purse: number; spent: number; paid: number; loot: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): StrikeState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "reapers_strike", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x5717 + k);
  const barge = STRIKE.bargeMin + (h(1) % (STRIKE.bargeMax - STRIKE.bargeMin + 1)) + (complication === "outriders" ? STRIKE.outridersBarge : complication === "fog" ? STRIKE.fogBarge : 0);
  const rainAt = STRIKE.rainMin + (h(2) % (STRIKE.rainMax - STRIKE.rainMin + 1)) + (complication === "rain" ? STRIKE.rainRain : complication === "fog" ? STRIKE.fogRain : 0);
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, near: { line: 0 }, asked: { reaper: false, steward: false }, proof: false, agreed: { steward: false, compact: false },
    refused: false, stewardGone: false, tipped: false, barge: Math.round(barge), landed: false, inField: 0, fight: false,
    crew: { alive: 0, routed: 0, down: 0, total: STRIKE.breakers }, rainAt: Math.round(rainAt),
    price: { bonus: rnd5(...STRIKE.priceBonus, h(3)), fee: rnd5(...STRIKE.priceFee, h(4)) },
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, loot: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const affordable = (s: StrikeState, n: number): boolean => n >= 0 && n <= s.purse - s.spent;
const phaseOf = (s: StrikeState): StrikeState["phase"] =>
  s.parley ? "parley" : s.fight ? "fighting" : s.landed ? "tension" : s.near.line > 0 || s.asked.reaper || s.asked.steward ? "waiting" : "approach";
const fin = (s: StrikeState): StrikeState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
/** The Steward pays his fee on results: the Compact back at work with nothing reformed (bought), or the barley cut by somebody else (broken). */
const feeFor = (s: StrikeState): Partial<StrikeState> => (s.tipped ? { loot: s.price.fee } : {});
const CALM: ScenarioFx = { k: "order", group: "late:breakers", order: { o: "stand_down" } };

// ---- the ending rules, in one place -----------------------------------------------------------------------------------------------------------

/** After every change: does the harvest now add up to an ending? (The first that does wins.) */
function settle(s: StrikeState, said: ScenarioFx[] = []): Reduction<StrikeState> {
  if (s.phase === "resolved") return { s, fx: said };
  if (s.proof && s.agreed.steward && s.agreed.compact) {
    return resolveWith(s, "honest_measure", { brokePromise: s.brokePromise || s.tipped }, [...said, CALM,
      say("Two signatures on one sheet: the Steward's, small and reluctant, and the Foreperson's, a cross and a scythe. The royal bushel is sawn down to size on the spot, by a reaper who has waited forty harvests to do it. The Compact walks into the barley singing something the Steward pretends not to hear.")]);
  }
  if (s.inField >= STRIKE.breakersNeeded) {
    return resolveWith(s, "strike_broken", feeFor(s), [...said,
      say("The strike-breakers are in the barley, sickles out, armbands on, and the Crown's harvest begins without the people who grew it. The Compact's picket line stands where it stood, which is now simply a place where some people are standing. The Steward makes a note.")]);
  }
  return { s: fin(s), fx: said };
}

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: StrikeState, e: ScenarioInput): Reduction<StrikeState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      let n: StrikeState = { ...s, t: s.t + dtOf(e) };
      const fx: ScenarioFx[] = [];
      if (!n.landed && n.t >= n.barge) {
        n = { ...n, landed: true, crew: { ...n.crew, alive: STRIKE.breakers } };
        fx.push({ k: "spawn", group: "late:breakers" }, { k: "order", group: "late:breakers", order: { o: "march", route: "breakers" } },
          say("A barge noses into the quay below the hill and lets down a plank. Four men in Syndicate armbands come down it with sickles, a contract and a supervisor: \"seasonal operatives, bonded\". They form up and set off up the road for the barley. If two of them get there before the Compact is back at work, the strike is broken."));
      }
      if (n.t >= n.rainAt) {
        return resolveWith(n, "barley_lost", {}, [...fx, CALM,
          say("The rain comes over the hill in a grey wall and lies down on the barley, and the barley lies down under it. The Compact stands in it with its scythes. The Steward stands under an umbrella with his ledger. Nobody has won, and the grain will be bought from the delta, at the delta's prices.")]);
      }
      return settle(n, fx);
    }
    case "near": {
      if (e.at !== "line") return stay(s);
      const k = int(e.party, 0, 8, 0);
      return s.near.line === k ? stay(s) : stay(fin({ ...s, near: { line: k } }));
    }
    case "count": {
      if (e.group !== "late:breakers") return stay(s);
      const total = int(e.total, 0, STRIKE.breakers, s.crew.total);
      const alive = int(e.alive, 0, total), routed = int(e.routed, 0, total - alive), down = int(e.down, 0, total - alive - routed);
      return stay(fin({ ...s, crew: { alive, routed, down, total } }));
    }
    case "hostile": return hostile(s, e.at);
    case "actor": {
      if (e.state === "arrived" && /^breaker-[0-3]$/.test(e.id)) {
        if (s.fight) return stay(s);
        const n = fin({ ...s, inField: s.inField + 1 });
        return settle(n, n.inField < STRIKE.breakersNeeded ? [say("A strike-breaker steps off the road into the barley and looks about for a supervisor. The Compact's picket line goes very quiet. One more and the strike is broken.")] : []);
      }
      if (e.state !== "down") return stay(s);
      if (e.id === "foreperson" && !s.refused) return { s: fin({ ...s, refused: true, parley: s.parley === "reaper" ? undefined : s.parley }), fx: [say("The Foreperson is down. The Compact closes ranks around her, and nobody on that line will sign anything for the Society today.")] };
      if (e.id === "steward" && !s.stewardGone) return { s: fin({ ...s, stewardGone: true, parley: s.parley === "steward" ? undefined : s.parley }), fx: [say("The Steward of the Granary is down, and with him the only signature the Crown sends to a harvest. There will be no decree today.")] };
      return stay(s);
    }
    case "use": {
      if (e.target !== "proof") return stay(s);
      if (s.proof || s.stewardGone) return stay(s);
      const n = fin({ ...s, proof: true });
      return settle(n, [say("You set the royal bushel down beside the Steward's selling measure and fill both from the same sack. The selling bushel is full. The royal bushel takes a third as much again and still has room for the Steward's hat. The Compact, who have come to watch, say nothing very loudly.")]);
    }
    case "talk": return e.kind === "reaper" ? talkReaper(s, e.result, e.paid) : e.kind === "steward" ? talkSteward(s, e.result) : stay(s);
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, r === "strike_broken" ? feeFor(s) : {});
    }
    default: return stay(s);
  }
}

/** First blood (or a near miss) on somebody's side: the Compact closes ranks, the Steward runs, the strike-breakers stop marching and fight. */
function hostile(s: StrikeState, at: string | undefined): Reduction<StrikeState> {
  if (at === "late:breakers") {
    if (s.fight) return stay(s);
    return { s: fin({ ...s, fight: true }), fx: [{ k: "order", group: "late:breakers", order: { o: "alert" } },
      say("The strike-breakers drop their sickles and come for you instead, supervisor first. Whatever else happens, they are not cutting barley this afternoon.")] };
  }
  if (at === "compact" && !s.refused) {
    return { s: fin({ ...s, refused: true, parley: s.parley === "reaper" ? undefined : s.parley, brokePromise: s.brokePromise || s.agreed.compact || s.paid > 0 }),
      fx: [{ k: "order", group: "compact", order: { o: "flee" } }, say("Blood on the picket line. The Compact scatters into the barley, and whatever it was going to sign today it will not sign for the Society.")] };
  }
  if (at === "granary" && !s.stewardGone) {
    return { s: fin({ ...s, stewardGone: true, parley: s.parley === "steward" ? undefined : s.parley, brokePromise: s.brokePromise || s.tipped || s.agreed.steward }),
      fx: [{ k: "order", group: "granary", order: { o: "flee" } }, say("The Steward of the Granary runs for the hill, ledger first. There will be no decree from him today, and the Crown will hear about the manner of his going.")] };
  }
  return stay(s);
}

// ---- the parleys ------------------------------------------------------------------------------------------------------------------------------

function paidOk(s: StrikeState, paid: number, price: number): boolean {
  return Number.isFinite(paid) && paid >= Math.round(price * 0.75) && paid <= Math.round(price * 1.25) && affordable(s, paid);
}

function talkReaper(s: StrikeState, result: string, paid: number): Reduction<StrikeState> {
  if (result === "open") {
    if (s.parley) return stay(s);
    if (s.refused) return { s, fx: [say("The Foreperson keeps her back to you. The Compact has nothing to say to the Society today.")] };
    if (s.agreed.compact) return { s, fx: [say("\"We have said yes,\" says the Foreperson. \"The Steward has not. Go and stand next to him until he does.\"")] };
    return { s: fin({ ...s, parley: "reaper" }), fx: [{ k: "parley", kind: "reaper", price: s.price.bonus }] };
  }
  if (s.parley !== "reaper") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, reaper: true } }));
    case "hostile": return stay(fin({ ...s, parley: undefined, refused: true, brokePromise: s.brokePromise || s.agreed.compact }));
    case "paid": {
      if (!paidOk(s, paid, s.price.bonus)) return stay(fin({ ...s, parley: undefined }));
      const n = fin({ ...s, parley: undefined, spent: s.spent + paid, paid: s.paid + paid });
      return resolveWith(n, "bought_back", feeFor(n), [CALM,
        say(n.tipped
          ? `The Compact goes back into the barley on £${paid} of the Society's money. The Steward, watching from the road, pays you his £${n.price.fee} for the result with the face of a man who has just been charged twice for the same harvest.`
          : `The Compact goes back into the barley on £${paid} of the Society's money. The royal bushel stays on its scale, as large as ever. The Steward thanks you, in writing, on the Crown's paper.`)]);
    }
    case "survey": {
      const n = fin({ ...s, parley: undefined });
      if (!n.proof) return { s: n, fx: [say("\"Prove it to the Steward first,\" says the Foreperson. \"Up the hill, on the granary scale. A grievance with no evidence is a hobby, and we have had this one forty years.\"")] };
      return settle(fin({ ...n, agreed: { ...n.agreed, compact: true } }), [say(n.agreed.steward
        ? "\"Then the Compact signs,\" says the Foreperson, and makes her cross under the Steward's name with great care, and then a small scythe beside it, for the avoidance of doubt."
        : "\"The Compact signs,\" says the Foreperson, \"the minute the Steward does. Not one minute before. We have been here before, and he had a pen then too.\"")]);
    }
    default: return stay(s);
  }
}

function talkSteward(s: StrikeState, result: string): Reduction<StrikeState> {
  if (result === "open") {
    if (s.parley || s.stewardGone) return stay(s);
    if (s.agreed.steward) return { s, fx: [say("\"I have signed,\" says the Steward, as a man says he has had a tooth out. \"Kindly take it to the Compact before I recover.\"")] };
    return { s: fin({ ...s, parley: "steward" }), fx: [{ k: "parley", kind: "steward", price: s.price.fee }] };
  }
  if (s.parley !== "steward") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, steward: true } }));
    case "hostile": {
      const n = fin({ ...s, parley: undefined, stewardGone: true, brokePromise: s.brokePromise || s.tipped || s.agreed.steward });
      return { s: n, fx: [{ k: "order", group: "granary", order: { o: "flee" } }] };
    }
    case "tip": {
      if (s.tipped) return stay(fin({ ...s, parley: undefined }));
      const n = fin({ ...s, parley: undefined, tipped: true, barge: s.landed ? s.barge : Math.min(s.barge, Math.round(s.t + STRIKE.hurriedS)) });
      return { s: n, fx: s.landed ? [] : [say("A boy runs down to the quay with the Steward's note. Somewhere on the river, a barge stops dawdling.")] };
    }
    case "survey": {
      const n = fin({ ...s, parley: undefined });
      if (!n.proof) return { s: n, fx: [say("\"On whose evidence?\" says the Steward. \"The royal bushel is on the granary scale, up the hill, sealed. Nobody has carried it down here, and I am certainly not going up there.\"")] };
      return settle(fin({ ...n, agreed: { ...n.agreed, steward: true } }), [say(n.agreed.compact
        ? "The Steward signs an honest measure, retroactive to this afternoon and not one minute earlier, under the Compact's cross."
        : "The Steward signs an honest measure, retroactive to this afternoon and not one minute earlier. \"Take it to them,\" he says, \"before I think about it.\"")]);
    }
    default: return stay(s);
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: StrikeState): ReturnType<TemplateDef<StrikeState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  const nothing = tallyEmpty(s.tally) && !s.fight && !s.refused && !s.stewardGone && !s.tipped && !s.proof && !s.agreed.steward && !s.agreed.compact && s.paid === 0 && !s.parley;
  if (nothing) return undefined;
  // the Compact is still out: the barge's men cut the barley if they landed and nobody turned them, else the rain has it
  return s.landed && !s.fight ? "strike_broken" : "barley_lost";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const HINT: Record<string, string> = {
  approach: "Harvest week at Highmark, and the Reapers' Compact has laid down its scythes at the foot of the hill. The barley stands; the rain is coming. Walk up to the picket line, west of the road.",
  waiting: "The Compact says the royal bushel it is paid by is a third larger than the one the Crown sells by. Pay the harvest bonus, or prove it: the royal bushel sits on the granary scale up the hill. Carry it down to the Steward. An honest measure needs both signatures.",
  parley: "They are listening. The Compact remembers who paid it and who threatened it; the Steward remembers everything, in a ledger.",
  tension: "The Syndicate's strike-breakers are on the road from the quay. If two reach the barley before the Compact is back at work, the strike is broken. Settle it first, stop them, or let them through.",
  fighting: "The strike-breakers have turned on you instead of the barley. Whatever is agreed today will be agreed over this, before the rain.",
};
const DONE: Record<string, string> = {
  honest_measure: "An honest bushel, two signatures, and the Compact back in the barley at the old rate. Sail home from the Reed Landing.",
  bought_back: "The Compact is back at work on the Society's money. The royal bushel is as large as ever. Sail home from the landing.",
  strike_broken: "The Syndicate's men are cutting the Crown's barley, and the Compact is watching them do it. Sail home from the landing.",
  barley_lost: "The rain has the barley. Nobody won; everybody will pay for bread. Sail home from the landing.",
  abandoned: "The expedition is down. The barley is still standing, for now. Sail home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  rain: "The rain is early this year: the barley has less time than anyone would like.",
  outriders: "Syndicate outriders came up the river road ahead of the barge: it will land soon.",
  fog: "Fog on the river: the barge is feeling its way upstream, and the rain is in no hurry either.",
};

function view(s: StrikeState, now: number): ScenarioView {
  const res = s.resolution;
  const back = res === "honest_measure" || res === "bought_back";
  const told = s.asked.reaper || s.asked.steward || s.proof;
  const objectives: ObjectiveView[] = [
    { id: "line", text: "Walk up to the Compact's picket line at the barley", done: s.near.line > 0 || s.phase !== "approach" },
  ];
  if (told) {
    objectives.push({ id: "bushel", text: s.proof ? "The royal bushel is weighed: a third too large" : s.stewardGone ? "Nobody is left to weigh the royal bushel for" : "Carry the royal bushel from the granary scale to the Steward", done: s.proof, optional: true });
    objectives.push({ id: "steward", text: s.stewardGone && !s.agreed.steward ? "The Steward has gone up the hill" : "The Steward signs an honest measure", done: s.agreed.steward, optional: true });
    objectives.push({ id: "compact", text: s.refused && !s.agreed.compact ? "The Compact will not deal with the Society today" : `The Compact signs too (or takes a bonus of £${s.price.bonus})`, done: s.agreed.compact || res === "bought_back", optional: true });
  }
  objectives.push({ id: "settle", text: res === "abandoned" ? "Lost: the expedition went down" : res === "strike_broken" ? "Broken: the Syndicate's men are in the barley" : res === "barley_lost" ? "Lost: the rain reached the barley first" : "Get the Compact back in the barley before the rain", done: back });
  if (s.landed && res === undefined) {
    objectives.push({ id: "breakers", text: s.fight ? "The strike-breakers are fighting you instead of reaping" : `Strike-breakers on the road (${Math.min(s.inField, STRIKE.breakersNeeded)} of ${STRIKE.breakersNeeded} in the barley)`, done: s.fight, optional: true });
  }
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Sail home from the Reed Landing", done: false });

  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  if (res === undefined && s.asked.reaper && !s.proof) hint += " (The Foreperson: \"Up the hill, on the granary terrace, by the first granary. A thing weighed in front of witnesses is proof.\")";
  if (res === undefined && s.tipped) hint += ` (You took the Steward's £${s.price.fee}, on results: the Compact back with nothing reformed.)`;
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remain = res !== undefined ? 0 : !s.landed && s.barge < s.rainAt ? s.barge - s.t : s.rainAt - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(!s.landed && s.barge < s.rainAt ? "The Syndicate's barge lands" : "The rain", remain, now), template: "reapers_strike", title: "The Reapers' Strike" };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: StrikeState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  const o: ScenarioOutcome = {
    scenario: "reapers_strike", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
    complication: s.complication, region: "highmark",
  };
  if (s.loot > 0) o.loot = s.loot;
  return o;
}

// ---- the people -------------------------------------------------------------------------------------------------------------------------------

const PICKETS = ["Picket Wat Gleaner (one scythe)", "Picket Hester Flail (one scythe)"] as const;
const CREW = ["Seasonal Operative No. 14 (bonded)", "Seasonal Operative No. 15 (bonded)", "Seasonal Operative No. 16 (bonded)", "Contract Supervisor Fenn Dunmarrow-Platt"] as const;
const CREW_ARMS: readonly WeaponId[] = [WEAPON.FISTS, WEAPON.FISTS, WEAPON.FISTS, WEAPON.PISTOL];

/** The people the run may spawn: the Compact's Foreperson and two pickets, the Steward, and four strike-breakers held back until the barge lands. 8 rows. */
function roster(_c: CampaignState, seed: number, _s: StrikeState): NpcSpec[] {
  const S = HIGHMARK_SITES.strike;
  const mk = (id: string, role: number, side: NpcSpec["side"], group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction: side === "rival" ? "rival" : "ward", side, group, post: { x: post.x, z: post.z }, weapon, lookSeed: hash3(seed >>> 0, i, role ^ 0x5717), name, skill, bravery, brain,
  });
  const out: NpcSpec[] = [mk("foreperson", NPC.HERDER, "neutral", "compact", S.foreperson, WEAPON.FISTS, "Foreperson Agnes Stook, of the Reapers' Compact", 12, 60, "civil", 0)];
  S.pickets.forEach((p, i) => out.push(mk(`picket-${i}`, NPC.HERDER, "neutral", "compact", p, WEAPON.FISTS, PICKETS[i]!, 12, 50, "civil", 1 + i)));
  out.push(mk("steward", NPC.CHAMBERLAIN, "neutral", "granary", S.steward, WEAPON.FISTS, "Steward Ambrose Tithe-Wexley, of the Granary", 10, 25, "civil", 3));
  S.breakers.forEach((p, i) => out.push(mk(`breaker-${i}`, NPC.RIVAL_GUARD, "rival", "late:breakers", p, CREW_ARMS[i]!, CREW[i]!, 24 + (hash3(seed >>> 0, i, 0x5b1) % 12), 30 + (hash3(seed >>> 0, i, 0x5b2) % 20), "garrison", 4 + i)));
  return out;
}

const S0 = HIGHMARK_SITES.strike;
const observe: ObserveSpec = {
  near: [{ id: "line", x: S0.foreperson.x, z: S0.foreperson.z, r: STRIKE.lineR }],
  use: [
    { id: "reaper", npc: "foreperson", r: STRIKE.personR, talk: "reaper", carry: "none" },
    { id: "steward", npc: "steward", r: STRIKE.personR, talk: "steward", carry: "none" },
    { id: "proof", npc: "steward", r: STRIKE.personR, carry: "barrel", consume: true, prop: "bushel" },
  ],
  count: [{ group: "late:breakers" }],
  seen: [],
  actors: [
    { id: "foreperson" }, { id: "steward" },
    ...S0.breakers.map((_, i) => ({ id: `breaker-${i}`, goal: { x: S0.barley.x, z: S0.barley.z, r: S0.barley.r } })),
  ],
  hostileGroups: ["late:breakers", "compact", "granary"],
};

export const reapersStrikeTemplate: TemplateDef<StrikeState> = {
  id: "reapers_strike", title: "The Reapers' Strike",
  brief: "Harvest week at Highmark, and the Reapers' Compact has laid down its scythes over a royal bushel a third too large. Pay them back to work, prove the fraud to the Crown's Steward, or watch the Syndicate's strike-breakers do the reaping; the rain is coming either way.",
  init, reduce, view, outcome, roster, leave, observe,
  routes: { breakers: [{ x: 0, z: 100 }, { x: -4, z: 84 }, { x: -14, z: 62 }, { x: -26, z: 46 }, { x: S0.barley.x, z: S0.barley.z }] },
  props: [{ id: "bushel", kind: PropKind.BARREL, x: S0.scale.x, z: S0.scale.z }],
  sites: { barley: { x: S0.barley.x, z: S0.barley.z }, scale: S0.scale },
};
