import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { clamp } from "../math.ts";
import { PropKind } from "../props.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { VESPER_ANCHORS, VESPER_SITES, VESPER_STOCK } from "../vesper.ts";
import { WEAPON } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";
import { ruleWhile } from "./terms.ts";

/**
 * VESPER GORGE "The Lower Gallery" (D-037, package C3; docs/_notes/regions34.md section 3, docs/_notes/vesper.md). The mine rescue: eleven miners behind a rock fall, a foreman with a schedule, the Low
 * Vesper Lamentation Guild with a fee schedule and a very prompt choir, a barrel of blasting powder in the Company's yard and a stack of pit-prop timber.
 *
 * The party decides nothing from a menu. It leans on four pressures and the ending is whatever they add up to:
 *  - the AIR CLOCK: nobody knows how much air the pocket has, so the Guild has estimated it, at a profit. When it runs out the Guild arrives, uninvited, to hold a funeral for the living (`consecrated`).
 *  - the FOREMAN's schedule (parley `foreman`): the Company seals a gallery whose rescue is behind schedule, at the hour its schedule says. A handling charge revises the schedule past the air clock; a Variance
 *    Form (stamped after FORM_S) buys a little; a foreman who is dead files no seals. The party can also simply be quick.
 *  - TIMBER: a crate of pit-props carried to the fall (INTERACT with a crate in the hands) is a set of shoring. The face will not hold past 25% without it, and 25% more with each set (three shore it).
 *  - the POWDER: a barrel carried to the fall and set (INTERACT) goes off a few seconds later. Fast, and the roof moves.
 * Endings (first wins, then the state is frozen):
 *  `dug_out`: the fall was dug by hand (every press of INTERACT with empty hands at the fall is a few shovelfuls) behind three sets of shoring: the fewest dead.
 *  `blasted_through`: the keg went off. Some of the miners did not enjoy it.
 *  `sealed`: the schedule ran out (or the party left with the schedule running): the Company seals the gallery to protect its record, and the Guild bills for the privilege of being told.
 *  `consecrated`: the air ran out, or the Dirge-Master's bill was paid, or the party left with the schedule bought off: the Guild takes the gallery and holds a funeral for the living.
 *  `abandoned`: the party is down. Leaving commits what happened (`leave`): nothing, or the ending the room was heading for.
 * The Guild's other offers: a vigil (the choir sings at the face and the miners breathe slower: the air clock +VIGIL_S, once) and an objection (the Guild disputes the sealing of a gallery with customers in it:
 * the seal +OBJECT_S, once, if it has been asked what it knows).
 * Complications (existing ids only): rain shortens the Company's schedule (it wants the gallery shut before the dry river runs), fog lengthens it (nobody hears the whistle).
 */

export const MINE = {
  /** The air clock, seconds (+ a seeded 0..airSpread). */
  airS: 420, airSpread: 40,
  /** The Company's schedule: the gallery is sealed this many seconds in (+ a seeded 0..sealSpread), unless it has been revised. */
  sealS: 170, sealSpread: 30, rainSeal: -35, fogSeal: 35,
  /** Paying the handling charge pushes the seal this far out; a stamped form this far; the Guild's objection this far. */
  handlingDefer: 400, formDefer: 150, objectS: 120, formS: 45,
  /** The Guild's vigil buys this much air, once. */
  vigilS: 90,
  /** Shoring: the dig cannot pass `digBase + digPerSet * sets` percent (three sets shore it all). */
  timberNeed: 3, digBase: 25, digPerSet: 25,
  /** Each press of INTERACT at the fall digs this many percent; one player's press counts at most once per `digCoolS`. */
  digPerPress: 2.5, digCoolS: 1.1,
  /** The keg's fuse, then the settling time before the ending is called (casualties are counted in between). */
  fuseS: 5, settleS: 3,
  /** Reach of INTERACT at the fall and at a person, and the radius of "at the fall" for the objective. */
  fallR: 3.4, personR: 2.4, nearR: 10,
  priceHandling: [35, 70], priceBill: [45, 90],
} as const;

export interface MineState extends BaseState {
  complication: ComplicationId; rain: number;
  near: { fall: number };
  airOut: number; sealAt: number;
  /** The schedule has been bought off (handling charge) / a form is with the stamp / the Guild's offers taken. */
  bought: boolean; form: "none" | "pending" | "filed"; formAt: number; vigil: boolean; objected: boolean;
  timber: number; dig: number; lastDig: number[];
  keg: "none" | "set" | "fired"; blastAt: number;
  hostile: boolean; foremanDown: boolean; guildDown: boolean;
  price: { handling: number; bill: number };
  asked: { foreman: boolean; guild: boolean };
  purse: number; spent: number; paid: number;
  miners: { alive: number; down: number; routed: number; total: number };
  tally: CasualtyTally; brokePromise: boolean;
}

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): MineState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "mine_rescue", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x31e0 + k);
  const sealAt = MINE.sealS + (h(1) % (MINE.sealSpread + 1)) + (complication === "rain" ? MINE.rainSeal : complication === "fog" ? MINE.fogSeal : 0);
  const rnd5 = (lo: number, hi: number, k: number): number => lo + 5 * (h(k) % Math.floor((hi - lo) / 5 + 1));
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, rain: 0, near: { fall: 0 },
    airOut: MINE.airS + (h(2) % (MINE.airSpread + 1)), sealAt,
    bought: false, form: "none", formAt: 0, vigil: false, objected: false, timber: 0, dig: 0, lastDig: [-9, -9, -9, -9], keg: "none", blastAt: 0,
    hostile: false, foremanDown: false, guildDown: false,
    price: { handling: rnd5(MINE.priceHandling[0], MINE.priceHandling[1], 3), bill: rnd5(MINE.priceBill[0], MINE.priceBill[1], 4) },
    asked: { foreman: false, guild: false },
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, miners: { alive: 11, down: 0, routed: 0, total: 11 },
    tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -------------------------------------------------------------------------------------------------------------------------

const digCap = (s: MineState): number => Math.min(100, MINE.digBase + MINE.digPerSet * Math.min(MINE.timberNeed, s.timber));
const sealLive = (s: MineState): boolean => !s.foremanDown && !s.bought;
const affordable = (s: MineState, n: number): boolean => n >= 0 && n <= s.purse - s.spent;
const paidOk = (s: MineState, paid: number, price: number): boolean => Number.isFinite(paid) && paid >= Math.round(price * 0.75) && paid <= Math.round(price * 1.25) && affordable(s, paid);
const phaseOf = (s: MineState): MineState["phase"] => (s.parley ? "parley" : s.keg === "set" ? "rigging" : s.hostile ? "fighting" : s.near.fall > 0 ? "waiting" : "approach");
const fin = (s: MineState): MineState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const dead = (s: MineState): number => s.miners.down + s.miners.routed;

/** The party broke the peace: the Company's people and the Guild's take sides against it. First cause wins. */
function raise(s: MineState, why: string, brokePromise = false): Reduction<MineState> {
  const bp = s.brokePromise || brokePromise;
  if (s.hostile) return { s: fin({ ...s, brokePromise: bp }), fx: [] };
  const fx: ScenarioFx[] = [{ k: "order", group: "foreman", order: { o: "flee" } }, { k: "order", group: "guild", order: { o: "flee" } }, say(why)];
  return { s: fin({ ...s, hostile: true, parley: undefined, brokePromise: bp }), fx };
}

// ---- the reducer -----------------------------------------------------------------------------------------------------------------------------

function reduce(s: MineState, e: ScenarioInput): Reduction<MineState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const dt = dtOf(e);
      let n: MineState = { ...s, t: s.t + dt };
      const fx: ScenarioFx[] = [];
      if (n.form === "pending" && n.t >= n.formAt) {
        n = { ...n, form: "filed", sealAt: Math.max(n.sealAt, n.t) + MINE.formDefer };
        fx.push(say("The Variance Form is stamped, with a stamp that has the word VARIANCE cut backwards into it. The schedule moves, for once, in your favour."));
      }
      // the keg: a fuse, then the roof moves, then the ending is called once the casualties are in
      if (n.keg === "set" && n.t >= n.blastAt) {
        n = { ...n, keg: "fired" };
        fx.push({ k: "explode", at: "blast" }, say("The powder goes. The gorge says so, at length, and a great deal of the Lower Gallery's roof says so with it."));
      }
      if (n.keg === "fired" && n.t >= n.blastAt + MINE.settleS) {
        return resolveWith(n, "blasted_through", {}, [...fx, say(`The dust settles on a way through. Eleven men were behind the fall; ${n.miners.total - dead(n) <= 0 ? "the foreman has been asked to count again" : `${Math.max(0, n.miners.total - dead(n))} of them come out, coughing and in some cases cheering`}. The Guild's choir, who were waiting for exactly this, step forward with their books open.`)]);
      }
      if (n.t >= n.airOut) {
        return resolveWith(n, "consecrated", {}, [...fx, { k: "order", group: "guild", order: { o: "stand_down" } },
          say("The air is spent. The Guild's choir, which had been standing at the gorge mouth since before the fall, files up the road with the lamps, the bell and the invoice. \"We are so very sorry for your loss,\" says the Dirge-Master, \"which will be itemised.\"")]);
      }
      if (sealLive(n) && n.t >= n.sealAt) {
        return resolveWith(n, "sealed", {}, [...fx, { k: "order", group: "foreman", order: { o: "stand_down" } },
          say("The whistle blows, and the Company's schedule is met in the only way left: boards across the face, an iron seal, a red plate that says WORK CONTINUES. \"A gallery that is sealed,\" says the foreman, \"cannot be behind schedule.\"")]);
      }
      return { s: fin(n), fx };
    }
    case "weather": return stay(fin({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 }));
    case "near": {
      if (e.at !== "fall") return stay(s);
      const n = int(e.party, 0, 8, 0);
      return s.near.fall === n ? stay(s) : stay(fin({ ...s, near: { fall: n } }));
    }
    case "count": {
      if (e.group !== "miners") return stay(s);
      const total = int(e.total, 0, 11, s.miners.total);
      const alive = int(e.alive, 0, total), routed = int(e.routed, 0, total - alive), down = int(e.down, 0, total - alive - routed);
      return stay(fin({ ...s, miners: { alive, down, routed, total } }));
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "foreman" && e.at !== "guild") return stay(s);
      return raise(s, e.at === "guild" ? "Blood in front of the Dirge-Master. The Guild has seen worse, and invoiced for it, but it takes the point."
        : "Blood in the Company's yard. The foreman, who has not been touched by anything real since the survey, goes pale and then, remarkably, paler.", s.parley !== undefined || s.paid > 0);
    }
    case "actor": {
      if (e.state !== "down") return stay(s);
      if (e.id === "foreman" && !s.foremanDown) {
        const r = raise({ ...s, foremanDown: true, form: s.form === "pending" ? "none" : s.form }, "The foreman is down. There is a pause in the gorge in which every schedule in Vesper stops being anybody's, and then the whistle, which nobody is left to blow, does not blow.");
        return r;
      }
      if (e.id === "dirge-master" && !s.guildDown) return stay(fin({ ...s, guildDown: true }));
      return stay(s);
    }
    case "use": return use(s, e.target, e.slot);
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

function use(s: MineState, target: string, slot: number): Reduction<MineState> {
  if (target === "timber") {
    if (s.timber >= MINE.timberNeed) return { s, fx: [say("The face is shored. The foreman's stock of props is enormous, and the Company is welcome to the rest of it.")] };
    const n = fin({ ...s, timber: s.timber + 1 });
    return { s: n, fx: [say(n.timber >= MINE.timberNeed
      ? "The third set of props goes up, and the face stops making the noise it was making. It is shored: dig as fast as you like."
      : `Pit-props set against the fall (${n.timber} of ${MINE.timberNeed}). The face creaks, which is how a face says it is thinking about it.`)] };
  }
  if (target === "keg") {
    if (s.keg !== "none") return stay(s);
    const n = fin({ ...s, keg: "set", blastAt: s.t + MINE.fuseS });
    return { s: n, fx: [say(`The keg is wedged in the fall and the fuse is lit. ${MINE.fuseS} seconds. Run.`)] };
  }
  if (target === "dig") {
    const cap = digCap(s);
    const i = slot >= 0 && slot < 4 ? Math.floor(slot) : 0;
    if (s.t - s.lastDig[i]! < MINE.digCoolS) return stay(s);
    if (s.dig >= cap) {
      return cap < 100 ? { s, fx: [say(`The face will not hold past ${cap}% without more timber. There are crates in the Company's yard, and a foreman who would like a word about them.`)] } : stay(s);
    }
    const lastDig = s.lastDig.slice();
    lastDig[i] = s.t;
    const dig = Math.min(cap, Math.round((s.dig + MINE.digPerPress) * 10) / 10);
    const n = fin({ ...s, dig, lastDig });
    if (dig >= 100) {
      return resolveWith(n, "dug_out", {}, [{ k: "order", group: "foreman", order: { o: "stand_down" } },
        say("A hand comes through the last of the fall, then a face, then a miner who asks what the date is and whether the Company has noticed. Eleven men walk out into the light behind your shovels, blinking. The Guild's choir, standing ready with a bell, is informed that the funeral is postponed. \"Deferred,\" says the Dirge-Master. \"Funerals do not get cancelled; they get delayed.\"")]);
    }
    return { s: n, fx: [] };
  }
  return stay(s);
}

// ---- the parleys --------------------------------------------------------------------------------------------------------------------------------

function talk(s: MineState, kind: string, result: string, paidIn: number): Reduction<MineState> {
  if (kind === "foreman") return talkForeman(s, result, paidIn);
  if (kind === "dirge_master") return talkGuild(s, result, paidIn);
  return stay(s);
}

function talkForeman(s: MineState, result: string, paid: number): Reduction<MineState> {
  if (result === "open") {
    if (s.parley || s.hostile || s.foremanDown) return stay(s);
    if (s.bought) return { s, fx: [say("\"The schedule has been revised,\" says the foreman, with the strained joy of a man whose paperwork has been paid for. \"Do not touch anything.\"")] };
    return { s: fin({ ...s, parley: "foreman" }), fx: [{ k: "parley", kind: "foreman", price: s.price.handling }] };
  }
  if (s.parley !== "foreman") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "hostile": return raise({ ...s, parley: undefined }, "You have made your point to the foreman with a raised voice and a lowered shovel. The yard goes very quiet and then very loud.", true);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, foreman: true } }));
    case "survey": {
      if (s.form !== "none") return stay(fin({ ...s, parley: undefined }));
      return { s: fin({ ...s, parley: undefined, form: "pending", formAt: s.t + MINE.formS }), fx: [say(`The Variance Form is filed, in triplicate. \"The Stamp will see it in ${MINE.formS} seconds,\" says the foreman. \"The seal will not wait for the Stamp, but it will, I am told, be sorry.\"`)] };
    }
    case "paid": {
      if (s.bought || !paidOk(s, paid, s.price.handling)) return stay(fin({ ...s, parley: undefined }));
      return { s: fin({ ...s, parley: undefined, bought: true, spent: s.spent + paid, paid: s.paid + paid, sealAt: s.t + MINE.handlingDefer }), fx: [say(`£${paid} changes hands under the heading HANDLING. The foreman writes a note in the margin of the schedule: REVISED (SEE PAYMENT). The gallery will not be sealed today, or at any hour this contract can see.`)] };
    }
    default: return stay(s);
  }
}

function talkGuild(s: MineState, result: string, paid: number): Reduction<MineState> {
  if (result === "open") {
    if (s.parley || s.hostile || s.guildDown) return stay(s);
    return { s: fin({ ...s, parley: "dirge_master" }), fx: [{ k: "parley", kind: "dirge_master", price: s.price.bill }] };
  }
  if (s.parley !== "dirge_master") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "hostile": return raise({ ...s, parley: undefined }, "The Dirge-Master takes your meaning, and so does the choir. A bell, which was about to be rung, is put down with great care.", true);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, guild: true } }));
    case "survey": {
      if (s.vigil) return stay(fin({ ...s, parley: undefined }));
      return { s: fin({ ...s, parley: undefined, vigil: true, airOut: s.airOut + MINE.vigilS }), fx: [say("The choir takes up a vigil at the fall, and begins to sing very slowly. The miners, hearing it through the rock, find they can breathe in time with it, and then more slowly than that. The Guild bills the families for the atmosphere.")] };
    }
    case "tell": {
      if (!s.asked.guild || s.objected || !sealLive(s)) return stay(fin({ ...s, parley: undefined }));
      return { s: fin({ ...s, parley: undefined, objected: true, sealAt: s.sealAt + MINE.objectS }), fx: [say("The Dirge-Master is appalled. \"Sealing a gallery with customers in it,\" he says, \"is a restraint of mourning.\" The choir lodges an objection with the Company, in the form of several verses. The seal is, procedurally, stayed.")] };
    }
    case "paid": {
      if (!paidOk(s, paid, s.price.bill)) return stay(fin({ ...s, parley: undefined }));
      return resolveWith(fin({ ...s, spent: s.spent + paid, paid: s.paid + paid }), "consecrated", {}, [{ k: "order", group: "guild", order: { o: "stand_down" } },
        say(`£${paid} is counted twice, by two people, into a black velvet bag. \"The Guild takes the gallery,\" says the Dirge-Master. \"The foreman will be relieved to learn that it is nobody's schedule now.\" The choir files in past you with the lamps. You have, in the narrowest sense, been relieved of the problem.`)]);
    }
    default: return stay(s);
  }
}

// ---- leaving ---------------------------------------------------------------------------------------------------------------------------------

function leave(s: MineState): ReturnType<TemplateDef<MineState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  if (s.keg !== "none") return "blasted_through";
  const nothing = tallyEmpty(s.tally) && !s.hostile && !s.parley && s.dig === 0 && s.timber === 0 && s.paid === 0 && s.form === "none" && !s.vigil && !s.objected;
  if (nothing) return undefined;
  // sailing away from a half-dug gallery: the Company seals it behind you, or, if its schedule was bought off, the Guild takes it
  return s.bought ? "consecrated" : "sealed";
}

// ---- the view -------------------------------------------------------------------------------------------------------------------------------

const HINT: Record<string, string> = {
  approach: "The Lower Gallery is at the head of the gorge, behind a fall of rock the Company calls a schedule variance. Eleven men are on the other side. Walk up the ore road.",
  waiting: "The fall is shored with pit-props from the Company's yard (carry a crate to it) and dug by hand (Use at the fall with empty hands, over and over). The foreman has a schedule and the Guild has a bill. A barrel of powder by the magazine, carried to the fall, is faster, rather louder, and not kind to the men behind it.",
  parley: "They are listening. Mind what you promise; the Company minutes everything and the Guild minutes the minutes.",
  rigging: "The fuse is lit. Whatever else you meant to do at the fall, you now mean to do it somewhere else.",
  fighting: "The yard has taken sides. The foreman and the choir have run for it, and the fall is still a fall.",
};
const DONE: Record<string, string> = {
  dug_out: "Eleven miners out, by hand, behind the shoring. The Guild is disappointed in a professional way. Take the ore barge home from Staithe Landing.",
  blasted_through: "The way is open and the roof has been rearranged. The Guild has been informed, and is already on the road with a hymn and a tape measure. Take the ore barge home.",
  sealed: "The Lower Gallery is sealed on schedule, with eleven men behind it. The Company is satisfied. The Guild will bill you for having been told. Take the ore barge home.",
  consecrated: "The Guild has the gallery, a lamp, a bell and a very long hymn. The funeral is for the living and the invoice is for you. Take the ore barge home.",
  abandoned: "The expedition is down. The gorge is unmoved. Take the ore barge home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  rain: "Rain is gathering on the plateau, and the Company wants the gallery shut before the dry river runs: its schedule is short.",
  fog: "Fog in the gorge: nobody can hear the Company's whistle, and the schedule runs long.",
};

function view(s: MineState, now: number): ScenarioView {
  const res = s.resolution;
  const freed = res === "dug_out" || res === "blasted_through";
  const objectives: ObjectiveView[] = [
    { id: "approach", text: "Walk up the ore road to the Lower Gallery", done: s.near.fall > 0 || s.phase !== "approach" },
    { id: "timber", text: `Shore the fall: carry timber crates to it (${Math.min(s.timber, MINE.timberNeed)} of ${MINE.timberNeed})`, done: s.timber >= MINE.timberNeed, optional: true },
    { id: "dig", text: `Dig at the fall by hand, empty-handed (${Math.floor(s.dig)}%)`, done: s.dig >= 100, optional: true },
    { id: "foreman", text: s.bought ? "The foreman's schedule has been revised" : s.form === "filed" ? "The Variance Form is stamped" : s.form === "pending" ? "The Variance Form is with the Stamp" : "Stop the seal clock: pay the foreman or file a Variance Form", done: s.bought || s.form === "filed", optional: true },
    { id: "guild", text: s.vigil ? "The choir keeps its vigil at the fall" : `Ask the Guild for a vigil. Its £${s.price.bill} bill buries the miners`, done: s.vigil, optional: true },
    { id: "miners", text: res === "sealed" ? "Lost: the Company sealed the gallery" : res === "consecrated" ? "Lost: the Guild consecrated the gallery" : res === "abandoned" ? "Lost: the expedition went down" : `Eleven miners behind the fall: get them out (${Math.max(0, s.miners.total - dead(s))} alive)`, done: freed },
  ];
  if (s.keg !== "none" && res === undefined) objectives.push({ id: "keg", text: s.keg === "set" ? "The keg is lit. Get clear." : "The powder has gone off", done: s.keg === "fired", optional: true });
  if (s.hostile && res === undefined) objectives.push({ id: "peace", text: "The foreman and Guild have fled; keep shoring and digging", done: false, optional: true });
  if (res !== undefined) objectives.push({ id: "home", text: "Take the ore barge home from Staithe Landing", done: false });
  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  if (res === undefined && s.asked.foreman) hint += ` (The foreman's schedule seals at ${Math.round(s.sealAt)} seconds unless somebody pays for it.)`;
  if (res === undefined && s.asked.guild) hint += " (The Guild's choir arrives at the end of the air, which it has measured on its own account.)";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remainSeal = sealLive(s) ? s.sealAt - s.t : Infinity;
  const remainAir = s.airOut - s.t;
  const remain = res !== undefined ? 0 : Math.min(remainSeal, remainAir);
  const label = remainSeal <= remainAir ? "The Company seals the gallery" : "Air in the gallery";
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(label, remain, now), template: "mine_rescue", title: "The Lower Gallery", ...ruleWhile("mine_rescue", res === undefined && !s.hostile) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: MineState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  return {
    scenario: "mine_rescue", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
    complication: s.complication, region: "vesper",
  };
}

// ---- the people ------------------------------------------------------------------------------------------------------------------------------

const MINERS = [
  "Hodge Tallow-Pit", "Maud Seam-Weller", "Osgood Pry-Bar", "Tilda Cinder-Lowe", "Edric Dross", "Agnes Wedge-Ryder", "Piers Adit-Moss", "Wilf Sump", "Beryl Coal-Hatch", "Ansel Fathom", "Dorcas Ore-Ledger",
] as const;

/** The people the run may spawn: the Company's foreman, the Guild's Dirge-Master and a junior mourner, eleven miners behind the fall. 13 rows. */
function roster(_c: CampaignState, seed: number, _s: MineState): NpcSpec[] {
  const S = VESPER_SITES;
  const out: NpcSpec[] = [];
  const mk = (id: string, role: number, group: string, post: { x: number; z: number }, name: string, bravery: number, i: number): NpcSpec => ({
    id, role, faction: "ward", side: role === NPC.FOREMAN ? "ward" : "neutral", group, post: { x: post.x, z: post.z }, weapon: WEAPON.FISTS, lookSeed: hash3(seed >>> 0, i, role), name, skill: 10, bravery, brain: "civil",
  });
  out.push(mk("foreman", NPC.FOREMAN, "foreman", S.foreman, "Foreman Jedediah Slack-Moreland", 45, 0));
  out.push(mk("dirge-master", NPC.MOURNER, "guild", S.dirgeMaster, "Dirge-Master Osric Veil-Mourne", 55, 1));
  out.push(mk("mourner-0", NPC.MOURNER, "guild", S.mourners[0]!, "Junior Mourner Pru Lowe-Whisper (rented)", 30, 2));
  MINERS.forEach((name, i) => {
    const g = S.miners[i % S.miners.length]!;
    const row = Math.floor(i / S.miners.length);
    out.push(mk(`miner-${i}`, NPC.MINER, "miners", { x: g.x + (row - 1) * 1.5, z: g.z - row * 0.9 }, name, 20, 3 + i));
  });
  return out;
}

const DIG = VESPER_STOCK.dig;
const observe: ObserveSpec = {
  near: [{ id: "fall", x: DIG.x, z: DIG.z, r: MINE.nearR }],
  use: [
    { id: "foreman", npc: "foreman", r: MINE.personR, talk: "foreman", carry: "none" },
    { id: "dirge", npc: "dirge-master", r: MINE.personR, talk: "dirge_master", carry: "none" },
    { id: "timber", at: { x: DIG.x, z: DIG.z }, r: MINE.fallR, carry: "crate", consume: true },
    { id: "keg", at: { x: DIG.x, z: DIG.z }, r: MINE.fallR, carry: "barrel", consume: true },
    { id: "dig", at: { x: DIG.x, z: DIG.z }, r: MINE.fallR, carry: "none" },
  ],
  count: [{ group: "miners" }],
  seen: [],
  actors: [{ id: "foreman" }, { id: "dirge-master" }],
  hostileGroups: ["foreman", "guild"],
};

export const mineRescueTemplate: TemplateDef<MineState> = {
  id: "mine_rescue", title: "The Lower Gallery",
  brief: "Eleven miners are behind a fall in the Lower Gallery, entered in the Company's books as a schedule variance. The foreman means to seal it on time; the Lamentation Guild has a choir standing by and an invoice for every outcome. Shore the fall and dig them out by hand, blast through with the Company's powder, and keep the foreman's schedule and the Guild's invoice off the miners for long enough to do it.",
  init, reduce, view, outcome, roster, leave, observe,
  props: [...VESPER_STOCK.timber.map((p, i) => ({ id: `timber${i}`, kind: PropKind.CRATE as number, x: p.x, z: p.z })), { id: "keg", kind: PropKind.BARREL as number, x: VESPER_STOCK.keg.x, z: VESPER_STOCK.keg.z }],
  sites: { blast: VESPER_STOCK.blast, fall: VESPER_STOCK.dig, adit: VESPER_ANCHORS.adit },
};
