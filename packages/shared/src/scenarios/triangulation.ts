import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { PropKind } from "../props.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { VESPER_ANCHORS, VESPER_SITES, VESPER_TRIG } from "../vesper.ts";
import { WEAPON } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import { ruleWhile } from "./terms.ts";
import type { BaseState, Fx, ObserveSpec, Reduction, TemplateDef } from "./types.ts";

/**
 * THE TRIANGULATION (D-096, Vesper Gorge's fourth contract; the GDD's "survey"). The Society's Great Trigonometrical Survey has reached Vesper Gorge, and the Committee in Pall Mall has resolved
 * that the gorge be measured and its seven nameless needles NAMED, after the Committee's members, by seniority. The Low Vesper Lamentation Guild observes that the needles have had names for nine
 * hundred years, each of them somebody's, and that it keeps the ledger. The Syndicate's surveyors are running their own line up the gorge for a railway: whichever survey is filed in London first
 * is the gorge.
 *  - CARRY the theodolite (in its case on the wharf: a prop of its own, `PropKind.INSTRUMENT`; anybody may carry it, and it falls where its carrier does) to three trig stations that see one another over the gorge, and at each take a round
 *    of angles: `TRIG.presses` presses of INTERACT with it in your arms, one per `TRIG.coolS` per person (fog and rain: more).
 *  - At the pegging ground station the Guild holds a VIGIL for a while (its mourners walk there from the Cloister). Observing during it can be done; it is noticed (a broken promise), and the
 *    Guild will not sell its names to a party that measured its dead at their vigil.
 *  - Then NAME the needles, at the Dirge-Master's (parley `needle_names`): the Guild's names, for the Guild's fee (`trig_guild`, won), or the Committee's, told to his face (`trig_committee`,
 *    won). Or sell the whole triangulation to the Syndicate's surveyor for its railway (parley `railway_surveyor`, `trig_sold`, settled short of a win: the Syndicate pays).
 *  - `trig_outsurveyed` (lost): the Syndicate files first (its clock; the rival_bid complication brings it forward). Shooting at its surveyors stops their survey (they run) and is a broken promise.
 *  `abandoned`: the party is down. Leaving once anything has happened is to be outsurveyed.
 */

export const TRIG = {
  /** Presses at a station for its round of angles (fog or rain: the second figure), one per person per `coolS`. */
  presses: 6, foulPresses: 9, coolS: 1.1,
  /** The Syndicate files its survey this many seconds in (seeded); rival_bid brings it forward; `warnS` before, its surveyors are seen packing. */
  fileMin: 330, fileMax: 390, rivalBid: -60, warnS: 45,
  /** The Guild's vigil at the pegging ground station: when it begins (seeded) and how long it lasts. */
  vigilMin: 80, vigilMax: 140, vigilS: 75,
  /** Reach of INTERACT at a station (round the signal), and with a person. */
  stationR: 3.2, personR: 2.4,
  /** The Guild's fee for its names, and the Syndicate's price for the triangulation (pounds, multiples of five). */
  priceNames: [40, 70], priceSale: [60, 100],
} as const;

/** The stations' names, for the copy (index = station). */
export const STATION_NAMES = ["Assay", "West Bench", "Terrace"] as const;
/** The station where the Guild holds its vigil (the pegging ground's). */
export const VIGIL_STATION = 1;

export interface TrigState extends BaseState {
  complication: ComplicationId;
  /** Presses booked at each station, and how many it needs. */
  obs: number[]; need: number;
  /** When each player slot last pressed (the per-person cooldown). */
  lastPress: number[];
  vigilAt: number; vigilBegun: boolean; vigilOver: boolean;
  /** Observed at the vigil (the Guild noticed). */
  rude: boolean;
  fileAt: number; warned: boolean;
  /** The Syndicate's surveyors ran (their survey is abandoned). */
  surveyorsGone: boolean;
  /** A shot at the Guild's people. */
  guildHurt: boolean;
  asked: { names: boolean; rival: boolean };
  price: { names: number; sale: number };
  purse: number; spent: number; paid: number; loot: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): TrigState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "triangulation", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x7a16 + k);
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, obs: [0, 0, 0], need: complication === "fog" || complication === "rain" ? TRIG.foulPresses : TRIG.presses, lastPress: [-9, -9, -9, -9],
    vigilAt: TRIG.vigilMin + (h(1) % (TRIG.vigilMax - TRIG.vigilMin + 1)), vigilBegun: false, vigilOver: false, rude: false,
    fileAt: TRIG.fileMin + (h(2) % (TRIG.fileMax - TRIG.fileMin + 1)) + (complication === "rival_bid" ? TRIG.rivalBid : 0), warned: false,
    surveyorsGone: false, guildHurt: false, asked: { names: false, rival: false },
    price: { names: rnd5(...TRIG.priceNames, h(3)), sale: rnd5(...TRIG.priceSale, h(4)) },
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, loot: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const done = (s: TrigState, k: number): boolean => (s.obs[k] ?? 0) >= s.need;
/** All three rounds booked: the triangle is closed. */
export const closed = (s: TrigState): boolean => s.obs.every((_, k) => done(s, k));
const vigilOn = (s: TrigState): boolean => s.vigilBegun && !s.vigilOver;
const affordable = (s: TrigState, n: number): boolean => Number.isFinite(n) && n >= 0 && n <= s.purse - s.spent;
const paidOk = (s: TrigState, paid: number): boolean => Number.isFinite(paid) && paid >= Math.round(s.price.names * 0.75) && paid <= Math.round(s.price.names * 1.25) && affordable(s, paid);
const phaseOf = (s: TrigState): TrigState["phase"] => (s.parley ? "parley" : closed(s) ? "standoff" : s.obs.some((n) => n > 0) ? "waiting" : "approach");
const fin = (s: TrigState): TrigState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const set = (a: readonly number[], k: number, v: number): number[] => a.map((x, i) => (i === k ? v : x));

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: TrigState, e: ScenarioInput): Reduction<TrigState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      let n: TrigState = { ...s, t: s.t + dtOf(e) };
      const fx: Fx[] = [];
      if (!n.surveyorsGone) {
        if (!n.warned && n.t >= n.fileAt - TRIG.warnS) {
          n = { ...n, warned: true };
          fx.push(say("On the West Bench, the Syndicate's surveyors are folding their tripod. Their survey leaves for London on the next barge. Finish yours and name the needles first!"));
        }
        if (n.t >= n.fileAt) {
          return resolveWith(n, "trig_outsurveyed", {}, [...fx,
            say("The Syndicate's surveyors load their field books onto the ore barge. Their survey will reach London first. Officially, the gorge is now a railway.")]);
        }
      }
      // the Guild's vigil at the west bench station: the mourners walk out from the Cloister, keep it, and go home
      if (!n.vigilBegun && n.t >= n.vigilAt) {
        const st = VESPER_TRIG.stations[VIGIL_STATION]!;
        n = { ...n, vigilBegun: true };
        fx.push({ k: "spawn", group: "late:vigil" }, { k: "order", group: "late:vigil", order: { o: "guard", x: st.x, z: st.z, r: 3 } },
          say("A bell from the Long Cloister. The Guild's mourners are walking to the West Bench station to hold a vigil. Taking angles there during it would be rude, and noticed."));
      } else if (vigilOn(n) && n.t >= n.vigilAt + TRIG.vigilS) {
        n = { ...n, vigilOver: true };
        fx.push({ k: "order", group: "late:vigil", order: { o: "post" } }, say("The vigil at the West Bench is over. The mourners walk home, leaving a candle on the station's cairn."));
      }
      return { s: fin(n), fx };
    }
    case "use": {
      const m = /^station-(\d)$/.exec(e.target);
      if (!m) return stay(s);
      const k = Number(m[1]);
      if (!(k >= 0 && k < 3) || done(s, k)) return stay(s);
      const slot = int(e.slot, 0, 3, 0);
      // (too soon after this person's last press: no angle, but the press is TAKEN, a fresh state, so the runner keeps it and the instrument stays in your arms; a booked station's press
      // is refused, the same state, and falls through to the room, which sets the instrument down)
      if (s.t - s.lastPress[slot]! < TRIG.coolS) return { s: { ...s }, fx: [] };
      let n: TrigState = { ...s, lastPress: set(s.lastPress, slot, s.t), obs: set(s.obs, k, s.obs[k]! + 1) };
      const fx: Fx[] = [];
      if (k === VIGIL_STATION && vigilOn(s) && !s.rude) {
        n = { ...n, rude: true, brokePromise: true };
        fx.push(say("You take angles right over the mourners' heads, in the middle of their vigil. The singing stops. The Dirge-Master starts writing."));
      }
      if (done(n, k)) {
        fx.push(say(closed(n)
          ? "The last round is done and the gorge is measured. Now the needles need names. The Dirge-Master at the Long Cloister has the Guild's. The Committee's list is in your pocket."
          : `The round of angles at the ${STATION_NAMES[k]} station is booked.`));
      }
      return { s: fin(n), fx };
    }
    case "hostile": {
      if (e.at === "surveyors" && !s.surveyorsGone) {
        return { s: fin({ ...s, surveyorsGone: true, brokePromise: true }), fx: [{ k: "order", group: "surveyors", order: { o: "flee" } },
          say("The Syndicate's surveyors drop their tripod and run for the wharf. Their survey is abandoned. The Committee will call the shooting \"a regrettable incident\".")] };
      }
      if ((e.at === "guild" || e.at === "late:vigil") && !s.guildHurt) {
        return { s: fin({ ...s, guildHurt: true, brokePromise: true }), fx: [say("Shots among the Guild's people. Nobody in Vesper Gorge will sell the Society a name now, and the Guild will remember the date.")] };
      }
      return stay(s);
    }
    case "actor": {
      if (e.id === "dirge" && e.state === "down") return stay(fin({ ...s, guildHurt: true, parley: s.parley === "needle_names" ? undefined : s.parley }));
      return stay(s);
    }
    case "talk": return e.kind === "needle_names" ? talkNames(s, e.result, e.paid) : e.kind === "railway_surveyor" ? talkRival(s, e.result) : stay(s);
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, {});
    }
    default: return stay(s);
  }
}

function talkNames(s: TrigState, result: string, paid: number): Reduction<TrigState> {
  if (result === "open") {
    if (s.parley || s.guildHurt) return s.guildHurt ? { s, fx: [say("The Dirge-Master does not look up from his ledger. The Guild is not speaking to the Society today.")] } : stay(s);
    return { s: fin({ ...s, parley: "needle_names" }), fx: [{ k: "parley", kind: "needle_names", price: s.price.names }] };
  }
  if (s.parley !== "needle_names") return stay(s);
  const n = fin({ ...s, parley: undefined });
  switch (result) {
    case "close": return stay(n);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, names: true } }));
    case "paid": {
      if (!closed(s)) return { s: n, fx: [say("\"Measure them first,\" says the Dirge-Master, pushing your money back. \"Then we will talk names. The dead do not like to be named twice.\"")] };
      if (s.rude) return { s: n, fx: [say("\"You measured our dead at their vigil,\" says the Dirge-Master. \"The Guild's names are not for sale to you. Use your Committee's, and we will send the bill.\"")] };
      if (!paidOk(s, paid)) return stay(n);
      return resolveWith({ ...n, spent: s.spent + paid, paid: s.paid + paid }, "trig_guild", {}, [
        say(`£${paid} goes into the Guild's ledger. Seven names go on your chart, like the Aunt Who Waited and Old Tamsey's Debt. The Committee knows none of them.`)]);
    }
    case "tell": {
      if (!closed(s)) return { s: n, fx: [say("\"You cannot name what you have not measured,\" says the Dirge-Master, \"though your Committee has tried.\"")] };
      return resolveWith(n, "trig_committee", {}, [
        say("You read out the Committee's list: Mount Fothergill-Pym, the Lesser Bunce, Point Secretary (Honorary) and the rest. The Dirge-Master writes each one down, with a price.")]);
    }
    default: return stay(n);
  }
}

function talkRival(s: TrigState, result: string): Reduction<TrigState> {
  if (result === "open") {
    if (s.parley || s.surveyorsGone) return stay(s);
    return { s: fin({ ...s, parley: "railway_surveyor" }), fx: [{ k: "parley", kind: "railway_surveyor", price: s.price.sale }] };
  }
  if (s.parley !== "railway_surveyor") return stay(s);
  const n = fin({ ...s, parley: undefined });
  switch (result) {
    case "close": return stay(n);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, rival: true } }));
    case "survey": {
      if (!closed(s)) return { s: n, fx: [say("\"Half a triangle,\" says the surveyor, \"is just two lines. Finish it and we will talk money.\"")] };
      return resolveWith({ ...n, loot: s.price.sale }, "trig_sold", {}, [
        say(`The surveyor counts out £${s.price.sale} and takes your field books. Next season a railway will run up Vesper Gorge. The needles will be named whatever fits on a timetable.`)]);
    }
    default: return stay(n);
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: TrigState): ReturnType<TemplateDef<TrigState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  const nothing = tallyEmpty(s.tally) && s.obs.every((n) => n === 0) && !s.asked.names && !s.asked.rival && !s.parley && s.spent === 0 && !s.surveyorsGone;
  return nothing ? undefined : "trig_outsurveyed";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const DONE: Record<string, string> = {
  trig_guild: "The gorge is measured, and the needles keep the Guild's names. Take the boat home and break the news to the Committee.",
  trig_committee: "The gorge is measured, and the needles carry the Committee's names. The Guild has sent the bill. Take the boat home.",
  trig_sold: "You sold the survey to the Syndicate for its railway. The money is in your purse. Take the boat home.",
  trig_outsurveyed: "The Syndicate's survey will reach London first. Take the boat home and explain why yours is late.",
  abandoned: "The survey party is down in the gorge. Take the boat home and explain.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  fog: "Fog in the gorge: the signals come and go, so each round of angles takes longer.",
  rain: "Rain: water beads on the theodolite's glass, so each round of angles takes longer.",
  rival_bid: "The Syndicate is rushing its survey. It will file sooner than the Committee expected.",
};

function view(s: TrigState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "trig_guild" || res === "trig_committee" || res === "trig_sold";
  const objectives: ObjectiveView[] = [];
  // (the id names the station, so the compass strip walks the party round the unbooked ones: compassMarks.ts)
  for (let k = 0; k < 3; k++) {
    objectives.push({ id: `station${k}`, text: done(s, k) ? `The ${STATION_NAMES[k]} station is done` : `Take angles at the ${STATION_NAMES[k]} station (${s.obs[k]}/${s.need})`, done: done(s, k) || won });
  }
  objectives.push({ id: "names", text: res === "trig_outsurveyed" ? "Lost: the Syndicate filed first" : res === "abandoned" ? "Lost: the survey party went down" : "Name the needles with the Dirge-Master",
    done: res === "trig_guild" || res === "trig_committee" });
  if (res === undefined && !s.surveyorsGone) objectives.push({ id: "sell", text: `Or sell the survey to the Syndicate (£${s.price.sale})`, done: false, optional: true });
  // (the vigil stays on the list once it is over: its candle is on the station's cairn, and the scenery reads it from here)
  if (res === undefined && vigilOn(s)) objectives.push({ id: "vigil", text: "The Guild keeps a vigil at the West Bench station", done: false, optional: true });
  else if (s.vigilOver) objectives.push({ id: "vigil", text: "The vigil is over; a candle burns at the West Bench", done: true, optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the wharf", done: false });
  let hint = res !== undefined ? DONE[res] ?? ""
    : closed(s) ? "The gorge is measured. At the Long Cloister, buy the Guild's names from the Dirge-Master, or read him the Committee's. Or sell the survey to the Syndicate on the West Bench."
    : "Pick up the theodolite on the wharf. Carry it to the three trig stations (Assay bench, West Bench, headframe terrace) and take angles at each. Anyone can carry it.";
  if (res === undefined && s.rude) hint += " The Guild saw you measure its vigil.";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remain = res !== undefined || s.surveyorsGone ? 0 : s.fileAt - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer("The Syndicate files", remain, now), template: "triangulation", title: "The Triangulation", ...ruleWhile("triangulation", res === undefined) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: TrigState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  const o: ScenarioOutcome = {
    scenario: "triangulation", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise,
    seconds: Math.round(s.resolvedAt), complication: s.complication, region: "vesper",
  };
  if (s.loot > 0) o.loot = s.loot;
  return o;
}

// ---- the people -------------------------------------------------------------------------------------------------------------------------------

const MOURNERS = ["Mourner Hesketh Dole-Ashby", "Mourner Clemency Vane-Lowe", "Mourner Ambrose Pall"] as const;

/** The Dirge-Master at the Cloister, the Syndicate's two railway surveyors at their instrument on the west bench, and the Guild's vigil (held back until the bell). */
function roster(_c: CampaignState, seed: number, _s: TrigState): NpcSpec[] {
  const out: NpcSpec[] = [
    {
      id: "dirge", role: NPC.MOURNER, faction: "ward", side: "neutral", group: "guild", post: { ...VESPER_SITES.dirgeMaster }, weapon: WEAPON.FISTS,
      lookSeed: hash3(seed >>> 0, 1, NPC.MOURNER), name: "Dirge-Master Osric Veil-Mourne", skill: 10, bravery: 55, brain: "civil",
    },
  ];
  VESPER_TRIG.surveyors.forEach((p, i) => out.push({
    id: `surveyor-${i}`, role: NPC.RIVAL_SURVEYOR, faction: "rival", side: "rival", group: "surveyors", post: { ...p }, weapon: WEAPON.FISTS,
    lookSeed: hash3(seed >>> 0, 10 + i, NPC.RIVAL_SURVEYOR), name: i === 0 ? "Railway Surveyor Ptolemy Gradient-Hythe" : "Chainman Ivo Benchmark", skill: 10, bravery: 25, brain: "civil",
  }));
  // the vigil: a garrison brain, unarmed and on nobody's side (it walks where it is sent: a civil brain stands), drawn as the Guild's own people
  VESPER_SITES.mourners.forEach((p, i) => out.push({
    id: `vigil-${i}`, role: NPC.MOURNER, faction: "ward", side: "neutral", group: "late:vigil", post: { ...p }, weapon: WEAPON.FISTS,
    lookSeed: hash3(seed >>> 0, 20 + i, NPC.MOURNER), name: MOURNERS[i]!, skill: 5, bravery: 40, brain: "garrison",
  }));
  return out;
}

const observe: ObserveSpec = {
  near: [],
  use: [
    ...VESPER_TRIG.stations.map((p, k) => ({ id: `station-${k}`, at: { x: p.x, z: p.z }, r: TRIG.stationR, carry: "instrument" as const, prop: "theodolite", prompt: "Take a round of angles", until: `station${k}` })),
    { id: "dirge", npc: "dirge", r: TRIG.personR, talk: "needle_names", carry: "none" },
    { id: "surveyor", npc: "surveyor-0", r: TRIG.personR, talk: "railway_surveyor", carry: "none" },
  ],
  count: [],
  seen: [],
  actors: [{ id: "dirge" }],
  hostileGroups: ["surveyors", "guild", "late:vigil"],
};

export const triangulationTemplate: TemplateDef<TrigState> = {
  id: "triangulation", title: "The Triangulation",
  brief: "Survey Vesper Gorge and name its seven rock needles. The Committee wants its own names on them. The Guild says they have had names for 900 years. Beat the Syndicate's railway survey.",
  init, reduce, view, outcome, roster, leave, observe,
  noPowderStore: true, // (D-084: nobody armed is set against you: surveyors and mourners)
  props: [{ id: "theodolite", kind: PropKind.INSTRUMENT, x: VESPER_TRIG.theodolite.x, z: VESPER_TRIG.theodolite.z }],
  sites: { wharf: VESPER_ANCHORS.landing, cloister: VESPER_ANCHORS.cloister },
};
