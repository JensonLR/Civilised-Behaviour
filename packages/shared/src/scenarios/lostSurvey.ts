import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import { NPC_SIDE, type NpcSpec } from "../expeditionTypes.ts";
import { hash3 } from "../rng.ts";
import { SALTMARKET_SURVEY } from "../saltmarket.ts";
import type { ScenarioInput } from "../scenario.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";
import { ruleWhile } from "./terms.ts";

/**
 * THE LOST SURVEY (D-093, the Saltmarket Delta's third contract; the GDD's "missing expedition"). The Society's Delta Mensuration Party went into the west reeds a week ago
 * to chart the Brine Houses' private canals, for the Admiralty's map and the Committee's dinner. It has not come back. Its surveyor, Mr. Augustus Pellow-Brane, is alive and
 * well in a reed-cutter's house in the north-west reeds, as the guest of the Houses, who are holding him, and his field books, until the harbour dues on every canal he measured are
 * paid. The Committee wants him home, or failing that the books ("which are the property of the Society, as is he, in a sense").
 *
 * The party decides nothing from a menu. Its pressures, and the ending is what they add up to:
 *  - the TRAIL (optional): his survey peg by the west bridge, with a note tied to it, and his chalk on the windpump's leg. Each one marks the next on the strip; the house is
 *    there to be found without them, slowly.
 *  - the COLLECTOR of canal dues at the house (parley `dues_collector`): pay the dues and the books are the surveyor's again; cede the chart (the Houses keep the books and
 *    the Society keeps its man); or sell the Houses the survey outright (they pay; the surveyor, it turns out, has been offered a position, and stays).
 *  - the SURVEYOR (parley `lost_surveyor`): he will not leave without his books, unless he is persuaded that the Society can measure the delta again.
 *  - the WARDENS (two, with rifles): a threat or a shot at the house brings them on; break them and the books are taken by force.
 *  - the TIDE: the reeds flood at `tideS`. A surveyor still at the house is cut off until spring.
 * Once the books are settled the surveyor follows whoever settled it; he must reach the quay on foot.
 * Endings (first wins, then the state is frozen):
 *  `survey_home`: the surveyor at the quay with his books (paid for, or taken).   `chart_ceded`: the surveyor at the quay, the books left with the Houses.
 *  `survey_sold`: the party sold the Houses the survey (they pay; the Society loses its surveyor to a pilot's career).   `survey_lost`: the tide came first, or the surveyor fell.
 *  `abandoned`: the party is down. Leaving commits what happened (`leave`): nothing, or `survey_lost` once the surveyor has been reached.
 * Complications (existing ids only): rain brings the tide forward, fog holds it off.
 */

export const LOST = {
  /** The reeds flood this many seconds in (seeded in range); rain brings it forward, fog holds it off. */
  tideMin: 420, tideMax: 500, rainTide: -75, fogTide: 45,   // (a straight run is two minutes, a bot's; a party that follows the trail, haggles and loses its way needs the rest)
  /** The harbour dues (the party pays), and what the Houses pay for the survey outright (the party is paid); pounds, multiples of five. */
  priceDues: [45, 85], priceSale: [40, 70],
  /** Reach of INTERACT with a person or a mark; the house's site radius; the quay's (the surveyor has arrived inside it). */
  personR: 2.4, markR: 2.4, houseR: 16, quayR: 8,
  /** Wardens at the house; broken (down or routed) this many and the books can be taken. */
  wardens: 2, wardensBroken: 2,
} as const;

type Count = { alive: number; routed: number; down: number; total: number };
export type BooksState = "held" | "surveyor" | "ceded";

export interface SurveyState extends BaseState {
  complication: ComplicationId;
  near: { house: number };
  /** The trail's marks found: 0 none, 1 the peg, 2 the windpump too. */
  trail: number;
  asked: { surveyor: boolean; collector: boolean };
  books: BooksState;
  /** The books were taken by force (a broken promise to the Houses, whatever the ending). */
  forced: boolean;
  surveyor: "house" | "following" | "home" | "down";
  hostile: boolean;
  wardens: Count;
  tideAt: number;
  price: { dues: number; sale: number };
  purse: number; spent: number; paid: number; loot: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): SurveyState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "lost_survey", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x5b4e + k);
  const tide = LOST.tideMin + (h(1) % (LOST.tideMax - LOST.tideMin + 1)) + (complication === "rain" ? LOST.rainTide : complication === "fog" ? LOST.fogTide : 0);
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, near: { house: 0 }, trail: 0, asked: { surveyor: false, collector: false }, books: "held", forced: false,
    surveyor: "house", hostile: false, wardens: { alive: LOST.wardens, routed: 0, down: 0, total: LOST.wardens }, tideAt: Math.round(tide),
    price: { dues: rnd5(...LOST.priceDues, h(2)), sale: rnd5(...LOST.priceSale, h(3)) },
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, loot: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const affordable = (s: SurveyState, n: number): boolean => Number.isFinite(n) && n >= 0 && n <= s.purse - s.spent;
/** The dues as the parley settled them (admiring the ledger moves the price; the band is the other parleys'). */
const paidOk = (s: SurveyState, paid: number): boolean => Number.isFinite(paid) && paid >= Math.round(s.price.dues * 0.75) && paid <= Math.round(s.price.dues * 1.25) && affordable(s, paid);
const broken = (c: Count): number => c.routed + c.down;
const phaseOf = (s: SurveyState): SurveyState["phase"] =>
  s.parley ? "parley" : s.hostile ? "fighting" : s.surveyor === "following" ? "extract" : s.near.house > 0 || s.asked.surveyor || s.asked.collector ? "waiting" : "approach";
const fin = (s: SurveyState): SurveyState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const FOLLOW: ScenarioFx = { k: "follow", group: "surveyor" };
const CALM: ScenarioFx[] = [{ k: "order", group: "wardens", order: { o: "stand_down" } }, { k: "order", group: "collector", order: { o: "stand_down" } }];

/** The books are settled (paid for, ceded, or taken): the surveyor gathers his hat and follows whoever settled it. Once. */
function release(s: SurveyState, books: BooksState, line: string, patch: Partial<SurveyState> = {}): Reduction<SurveyState> {
  if (s.surveyor !== "house") return { s: fin({ ...s, ...patch, books }), fx: [say(line)] };
  return { s: fin({ ...s, ...patch, books, surveyor: "following" }), fx: [FOLLOW, say(line)] };
}

/** The house wakes: the wardens fight, the collector takes cover. First cause wins. */
function raise(s: SurveyState, why: string, brokePromise = false): Reduction<SurveyState> {
  const bp = s.brokePromise || brokePromise;
  if (s.hostile) return { s: fin({ ...s, brokePromise: bp }), fx: [] };
  return {
    s: fin({ ...s, hostile: true, parley: undefined, brokePromise: bp }),
    fx: [{ k: "order", group: "wardens", order: { o: "alert" } }, { k: "order", group: "collector", order: { o: "flee" } }, say(why)],
  };
}

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: SurveyState, e: ScenarioInput): Reduction<SurveyState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const n: SurveyState = { ...s, t: s.t + dtOf(e) };
      if (n.t >= n.tideAt && n.surveyor === "house") {
        return resolveWith({ ...n, parley: undefined }, "survey_lost", {}, [...CALM,
          say("The tide comes up through the reeds like a rumour, and by the time it has finished the reed-cutter's house is an island and Mr. Pellow-Brane its only resident. He waves, with a theodolite. The Houses will send him home in the spring, with the bill.")]);
      }
      const fx: ScenarioFx[] = [];
      if (s.t < s.tideAt - 90 && n.t >= n.tideAt - 90 && n.surveyor === "house") fx.push(say("The water in the reeds is rising. The paths to the house will be under it in a minute and a half, and so, in a manner of speaking, will the Society's surveyor."));
      return { s: fin(n), fx };
    }
    case "near": {
      if (e.at !== "house") return stay(s);
      const n = Math.max(0, Math.min(8, int(e.party, 0, 8, 0)));
      if (s.near.house === n) return stay(s);
      const first = s.near.house === 0 && n > 0 && s.phase === "approach";
      return {
        s: fin({ ...s, near: { house: n } }),
        fx: first ? [say("The reed-cutter's house. Mr. Pellow-Brane is on a crate under the stilts in his shirtsleeves with a cup of the Houses' tea, which is on the bill; the Collector of Canal Dues is beside him with a ledger, which is the bill; two wardens with rifles are why nobody has left. Speak to the Collector about the books, or to the surveyor about leaving.")] : [],
      };
    }
    case "use": {
      if (e.target === "peg" && s.trail < 1) return { s: fin({ ...s, trail: 1 }), fx: [say("A survey peg, painted the Society's red, with a note tied on in a hand that slopes with indignation: \"Day 4. Measured canal to the windpump. Charged for it. Went on to the house to protest. Charged for that.\" The windpump is marked on your strip.")] };
      if (e.target === "pump" && s.trail < 2) return { s: fin({ ...s, trail: 2 }), fx: [say("Chalk on the windpump's leg, in the same indignant hand: an arrow, a bearing, and \"HOSPITALITY. SEND MONEY.\" The arrow points north, up the reeds; the reed-cutter's house there is marked on your strip.")] };
      return stay(s);
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "wardens" && e.at !== "collector") return stay(s);
      return raise(s, "A shot at the house, and the Houses' hospitality ends at once: the wardens come off the wall with their rifles and the Collector goes behind the ledger, which is thick enough to stop a ball.", s.parley !== undefined || s.books !== "held");
    }
    case "count": {
      if (e.group !== "wardens") return stay(s);
      const w: Count = { alive: int(e.alive, 0, 9), routed: int(e.routed, 0, 9), down: int(e.down, 0, 9), total: Math.max(1, int(e.total, 0, 9, LOST.wardens)) };
      const n = fin({ ...s, wardens: w });
      if (s.hostile && s.books === "held" && broken(w) >= LOST.wardensBroken) {
        return release(n, "surveyor", "The wardens are done. Mr. Pellow-Brane takes his field books off the Collector's table with the expression of a man repossessing his own umbrella, and is ready to go. The Houses have noted it, in the ledger, in red.", { forced: true, brokePromise: true });
      }
      return stay(n);
    }
    case "actor": {
      if (e.id !== "surveyor") return stay(s);
      if (e.state === "down" && s.surveyor !== "down") {
        return resolveWith({ ...s, surveyor: "down" }, "survey_lost", {}, [...CALM, say("Mr. Pellow-Brane is down in the reeds, with his books under him. The Society will publish the survey posthumously, in a black border, at a loss.")]);
      }
      if (e.state === "arrived" && s.surveyor === "following") {
        const n = { ...s, surveyor: "home" as const };
        if (s.books === "ceded") return resolveWith(n, "chart_ceded", {}, [...CALM, say("Mr. Pellow-Brane reaches the quay without his books and stands looking back at the reeds as if they owed him money. They do not: he owes them. The Houses keep the chart of their canals; the Society keeps its surveyor, who has already started a second set of notes, from memory, in the boat.")]);
        return resolveWith(n, "survey_home", {}, [...CALM, say(s.forced
          ? "Mr. Pellow-Brane reaches the quay with his field books under his arm and a warden's hat he says he found. The Society has its survey, and the Houses have a grievance with a page number."
          : "Mr. Pellow-Brane reaches the quay with his field books under his arm and a receipt in his pocket for the dues, which he intends to frame. The Society has its survey; the Houses have their money; the Admiralty will have a map with the delta in it, and the delta's name spelled three ways.")]);
      }
      return stay(s);
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

function talk(s: SurveyState, kind: string, result: string, paid: number): Reduction<SurveyState> {
  if (kind === "dues_collector") return talkCollector(s, result, paid);
  if (kind === "lost_surveyor") return talkSurveyor(s, result);
  return stay(s);
}

function talkCollector(s: SurveyState, result: string, paid: number): Reduction<SurveyState> {
  if (result === "open") {
    if (s.parley || s.hostile || s.books !== "held") return stay(s);
    return { s: fin({ ...s, parley: "dues_collector" }), fx: [{ k: "parley", kind: "dues_collector", price: s.price.dues }] };
  }
  if (s.parley !== "dues_collector") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, collector: true } }));
    case "hostile": return raise({ ...s, parley: undefined }, "You have explained to the Collector, with a weapon, that the Society does not pay dues on its own measurements. The wardens come off the wall to explain the opposite.", true);
    case "paid": {
      const p = Number.isFinite(paid) ? Math.round(paid) : 0;
      if (!paidOk(s, p) || s.books !== "held") return stay(fin({ ...s, parley: undefined }));
      return release({ ...s, parley: undefined, spent: s.spent + p, paid: s.paid + p }, "surveyor", `£${p} goes into the ledger, which closes on it like a clam. The Collector hands Mr. Pellow-Brane his field books with a receipt for the dues, a receipt for the receipt, and the compliments of the Houses. He is ready to go, and he will follow you to the quay.`);
    }
    case "survey": {
      if (s.books !== "held") return stay(fin({ ...s, parley: undefined }));
      return release({ ...s, parley: undefined }, "ceded", "The chart is ceded to the Houses, who will keep their canals' secrets and the Society's books, with thanks. Mr. Pellow-Brane takes this badly and his hat well, and follows you to the quay, measuring the distance under his breath.");
    }
    case "tip": {
      if (s.books !== "held") return stay(fin({ ...s, parley: undefined }));
      return resolveWith({ ...s, parley: undefined }, "survey_sold", { loot: s.price.sale }, [...CALM,
        say(`The Houses buy the survey outright for £${s.price.sale}, books, bearings and the bad temper in the margins. Mr. Pellow-Brane, consulted at last, discovers that the Houses have been meaning to offer him a position as a pilot, at a salary the Society has never mentioned to anyone. He stays. He waves you off from the step, with his tea.`)]);
    }
    default: return stay(fin({ ...s, parley: undefined }));
  }
}

function talkSurveyor(s: SurveyState, result: string): Reduction<SurveyState> {
  if (result === "open") {
    if (s.parley || s.hostile || s.surveyor !== "house") return stay(s);
    return { s: fin({ ...s, parley: "lost_surveyor" }), fx: [{ k: "parley", kind: "lost_surveyor", price: 0 }] };
  }
  if (s.parley !== "lost_surveyor") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, surveyor: true } }));
    case "survey": {
      if (s.books !== "held") return stay(fin({ ...s, parley: undefined }));
      return release({ ...s, parley: undefined }, "ceded", "Mr. Pellow-Brane is persuaded, at length and against his principles, that the Society can measure the delta again and that he would rather be in it when it does. He leaves the books on the Collector's table with a look that will be in the minutes. He follows you to the quay.");
    }
    default: return stay(fin({ ...s, parley: undefined }));
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: SurveyState): ReturnType<TemplateDef<SurveyState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  const nothing = tallyEmpty(s.tally) && s.near.house === 0 && !s.hostile && !s.parley && s.trail === 0 && s.spent === 0 && s.books === "held" && s.surveyor === "house";
  return nothing ? undefined : "survey_lost";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const DONE: Record<string, string> = {
  survey_home: "The surveyor and his books are home. Take the boat and send the Admiralty its map.",
  chart_ceded: "The surveyor is home and the Houses keep the chart. Take the boat home; he will want to talk about it.",
  survey_sold: "The survey is sold and the surveyor is a pilot now. Take the boat home with the Houses' money.",
  survey_lost: "The survey is lost to the reeds. Take the boat home and write the letter.",
  abandoned: "The expedition is down. The reeds are unmoved. Take the boat home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  rain: "Rain on the delta: the tide is early.",
  fog: "Fog in the reeds: the trail is hard to see, and the tide is late for it.",
};

function view(s: SurveyState, now: number): ScenarioView {
  const res = s.resolution;
  const home = res === "survey_home" || res === "chart_ceded";
  const settled = s.books !== "held";
  const found = s.near.house > 0 || s.asked.surveyor || s.asked.collector || settled;
  // the strip follows his trail: the peg, then the chalk, then the house (each mark names the next; the house can be found by walking, without them)
  const search = found || s.trail >= 2
    ? { id: "house", text: found ? "Surveyor found, at the reed-cutter's house" : "Find the surveyor: the reed-cutter's house, north-west" }
    : s.trail === 1
      ? { id: "pump", text: "Find the surveyor: follow his chalk to the windpump" }
      : { id: "peg", text: "Find the surveyor: a survey peg by the west bridge" };
  const objectives: ObjectiveView[] = [
    { ...search, done: found },
    { id: "books", text: settled ? (s.books === "ceded" ? "The books stay with the Houses" : "The surveyor has his books") : `Settle his books with the Collector (dues £${s.price.dues})`, done: settled || res === "survey_sold" },
    { id: "quay", text: res === "survey_lost" ? "Lost: the surveyor never reached the quay" : res === "survey_sold" ? "Not needed: the surveyor has taken a post with the Houses" : "Walk the surveyor back to the quay", done: home || res === "survey_sold" },
  ];
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the quay", done: false });
  let hint = res !== undefined ? DONE[res] ?? "" : s.surveyor === "following" ? "Mr. Pellow-Brane is following you. Walk him back to the quay; he walks at the pace of a man who has been charged for every step." : s.near.house > 0 ? "Talk to the Collector about the books (pay the dues, cede the chart, or sell him the survey), or persuade the surveyor to come without them." : "The Society's surveyor is somewhere in the west reeds. His trail starts at a survey peg by the west bridge: Use it.";
  if (res === undefined && s.asked.collector) hint += ` (The Collector's terms: £${s.price.dues} in dues, or the chart, or £${s.price.sale} for the survey outright.)`;
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remain = res !== undefined || s.surveyor !== "house" ? 0 : s.tideAt - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer("The tide in the reeds", remain, now), template: "lost_survey", title: "The Lost Survey", ...ruleWhile("lost_survey", res === undefined && !s.hostile) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: SurveyState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  const o: ScenarioOutcome = {
    scenario: "lost_survey", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise,
    seconds: Math.round(s.resolvedAt), complication: s.complication, region: "saltmarket",
  };
  if (s.loot > 0) o.loot = s.loot;
  return o;
}

// ---- the people -------------------------------------------------------------------------------------------------------------------------------

const WARDEN_NAMES = ["Warden Ezra Bulrush-Teal", "Warden Hesper Quillgate"] as const;
const WARDEN_ARMS: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.PISTOL];

function roster(_c: CampaignState, seed: number, _s: SurveyState): NpcSpec[] {
  const P = SALTMARKET_SURVEY;
  const mk = (id: string, role: number, faction: NpcSpec["faction"], side: NpcSpec["side"], group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction, side, group, post: { x: post.x, z: post.z }, weapon, lookSeed: hash3(seed >>> 0, i, role), name, skill, bravery, brain,
  });
  return [
    mk("surveyor", NPC.HOSTAGE, "ward", NPC_SIDE[NPC.HOSTAGE]!, "surveyor", P.surveyor, WEAPON.FISTS, "Mr. Augustus Pellow-Brane, Surveyor to the Society", 10, 40, "civil", 0),
    mk("collector", NPC.CUSTOMS, "ward", "ward", "collector", P.collector, WEAPON.FISTS, "Mr. Silas Tench-Varley, Collector of Canal Dues", 10, 55, "civil", 1),
    ...P.wardens.map((p, i) => mk(`warden-${i}`, NPC.CUSTOMS, "ward", "ward", "wardens", p, WARDEN_ARMS[i]!, WARDEN_NAMES[i]!, 40 + (hash3(seed >>> 0, i, 0x5b51) % 12), 45 + (hash3(seed >>> 0, i, 0xb8) % 18), "garrison", 2 + i)),
  ];
}

const observe: ObserveSpec = {
  near: [{ id: "house", x: SALTMARKET_SURVEY.house.x, z: SALTMARKET_SURVEY.house.z, r: LOST.houseR }],
  use: [
    { id: "peg", at: SALTMARKET_SURVEY.peg, r: LOST.markR },
    { id: "pump", at: SALTMARKET_SURVEY.pumpMark, r: LOST.markR },
    { id: "surveyor", npc: "surveyor", r: LOST.personR, talk: "lost_surveyor", carry: "none" },
    { id: "collector", npc: "collector", r: LOST.personR, talk: "dues_collector", carry: "none" },
  ],
  count: [{ group: "wardens", routed: "garrisonRouted" }],
  seen: [],
  actors: [{ id: "surveyor", goal: { x: SALTMARKET_SURVEY.quay.x, z: SALTMARKET_SURVEY.quay.z, r: LOST.quayR }, boards: true }, { id: "collector" }],
  hostileGroups: ["wardens", "collector"],
};

export const lostSurveyTemplate: TemplateDef<SurveyState> = {
  id: "lost_survey", title: "The Lost Survey",
  brief: "The Society's Delta Mensuration Party went into the west reeds a week ago to chart the Brine Houses' private canals, and has not come back. Its surveyor, Mr. Pellow-Brane, is the Houses' guest at a reed-cutter's house in the north-west reeds, held with his field books until the harbour dues on every canal he measured are paid. Bring him home with his books: pay the dues, cede the chart, or take them; or sell the Houses the survey. The tide floods the reeds before long.",
  init, reduce, view, outcome, roster, leave, observe,
  sites: { house: SALTMARKET_SURVEY.house, quay: SALTMARKET_SURVEY.quay },
};
