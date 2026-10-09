import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { HIGHMARK_ANCHORS, HIGHMARK_SITES } from "../highmark.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { WEAPON } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import { ruleWhile } from "./terms.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";

/**
 * THE GREAT GREY (D-094, Highmark's third contract; the GDD's "hunt"). The old grey sire of Thornfield's herds has come down off the high pasture into the Reapers' barley and is eating
 * the harvest a mouthful at a time. The Crown, as host, has asked its guests the Society to see to it before the harvest bell. The Society's Natural History Committee has asked for
 * its head, for the Club's wall in Pall Mall; the drovers would like it back in their fold, alive, it being the luck of the herds; the Syndicate's menagerie agent would like it in his pen.
 *
 * It is a real animal (`NPC.BEAST`: Cast's `beast` brain, `BEAST_SHAPES` for every hit test): it walks away from anyone near it, trots from anyone close, bolts from a shot and charges
 * whoever wounds it. The party decides nothing from a menu; the ending is what the beast is made to do:
 *  - SHOT down: `grey_trophy` (won: the Committee gets its head). Every beast on the grassland is the Crown's: the Master of the Royal Hunt (parley `master_of_hunt`) sells a licence; a
 *    shot at it without one is poaching on the Crown's grass (a broken promise, whatever happens after).
 *  - DRIVEN back to its herd on the west grass (walk at it from the far side: it walks away from people; it jinks, and left alone it ambles back to the barley): `grey_driven` (won, alive).
 *  - SOLD: agree it with the agent (parley `menagerie_agent`) and he opens his pen by the river; driven in, `grey_sold` (settled short of a win: the Syndicate pays).
 *  - LOST: driven or bolting off the herd ground (it has gone home to the high pasture), or the harvest bell rings first: `grey_escaped`.
 *  `abandoned`: the party is down. Leaving commits `grey_escaped` once anything has happened.
 * Complications (existing ids only): rain brings the bell forward (the harvest hurries in before it), fog hides the beast in the barley.
 */

export const HUNT = {
  /** The harvest bell rings this many seconds in (seeded in range); rain brings it forward. */
  bellMin: 480, bellMax: 560, rainBell: -75,
  /** The Master's licence (the party pays) and the agent's price for the beast alive (the party is paid); pounds, multiples of five. */
  priceLicence: [25, 45], priceSale: [60, 95],
  /** Reach of INTERACT with a person; the barley's circle (finding it) is the strike's field. */
  personR: 2.4,
} as const;

export interface HuntState extends BaseState {
  complication: ComplicationId;
  near: { barley: number };
  asked: { master: boolean; agent: boolean };
  licence: boolean;
  /** The agent has agreed a price and opened his pen. */
  deal: boolean;
  /** A shot was fired at it without the licence. */
  poached: boolean;
  /** The pen was reached before any deal (said once). */
  penShut: boolean;
  bellAt: number;
  price: { licence: number; sale: number };
  purse: number; spent: number; paid: number; loot: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): HuntState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "great_grey", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x6a27 + k);
  const bell = HUNT.bellMin + (h(1) % (HUNT.bellMax - HUNT.bellMin + 1)) + (complication === "rain" ? HUNT.rainBell : 0);
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, near: { barley: 0 }, asked: { master: false, agent: false }, licence: false, deal: false, poached: false, penShut: false,
    bellAt: Math.round(bell), price: { licence: rnd5(...HUNT.priceLicence, h(2)), sale: rnd5(...HUNT.priceSale, h(3)) },
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, loot: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const affordable = (s: HuntState, n: number): boolean => Number.isFinite(n) && n >= 0 && n <= s.purse - s.spent;
const paidOk = (s: HuntState, paid: number): boolean => Number.isFinite(paid) && paid >= Math.round(s.price.licence * 0.75) && paid <= Math.round(s.price.licence * 1.25) && affordable(s, paid);
const phaseOf = (s: HuntState): HuntState["phase"] => (s.parley ? "parley" : s.near.barley > 0 || s.asked.master || s.asked.agent || s.licence || s.deal ? "waiting" : "approach");
const fin = (s: HuntState): HuntState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const CALM: ScenarioFx[] = [{ k: "order", group: "agent", order: { o: "stand_down" } }];

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: HuntState, e: ScenarioInput): Reduction<HuntState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const n: HuntState = { ...s, t: s.t + dtOf(e) };
      if (n.t >= n.bellAt) {
        return resolveWith({ ...n, parley: undefined }, "grey_escaped", {}, [...CALM,
          say("The harvest bell rings from the capital, the Reapers come down the hill with their scythes, and the Great Grey, who has eaten as much barley as he wanted, walks back up to the high pasture at his own pace. The Committee's wall stays bare.")]);
      }
      const fx: ScenarioFx[] = [];
      if (s.t < s.bellAt - 90 && n.t >= n.bellAt - 90) fx.push(say("A bell rings once from the capital: the harvest is ninety seconds off, and so, as far as the barley is concerned, is the end of this."));
      return { s: fin(n), fx };
    }
    case "near": {
      if (e.at !== "barley") return stay(s);
      const n = Math.max(0, Math.min(8, int(e.party, 0, 8, 0)));
      if (s.near.barley === n) return stay(s);
      const first = s.near.barley === 0 && n > 0 && s.phase === "approach";
      return {
        s: fin({ ...s, near: { barley: n } }),
        fx: first ? [say("The Great Grey stands in the barley up to his knees, chewing with the air of a creditor. He is the size of a cart, grey as a church, and his horns are wider than the Society's dining table. He does not like people near him. He likes them less when they shout.")] : [],
      };
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "grey") return stay(s);
      if (s.licence || s.poached) return stay(s);
      return {
        s: fin({ ...s, poached: true, brokePromise: true }),
        fx: [say("A shot at the Crown's beast, on the Crown's grass, without the Master's licence. Somewhere up the hill a clerk opens a ledger headed POACHING.")],
      };
    }
    case "actor": {
      if (e.state === "down" && e.id.startsWith("grey")) {
        return resolveWith({ ...s, parley: undefined }, "grey_trophy", {}, [...CALM, say(s.licence
          ? "The Great Grey goes down in the barley like a felled oak, slowly and then all at once. The Master of the Royal Hunt enters it in the game book in a fine hand; the Committee will have its head, and the Reapers will have the rest of the barley, and a long memory."
          : "The Great Grey goes down in the barley. Nobody bought the licence. The Master of the Royal Hunt enters it in the game book under POACHED, in red, and the drovers stand at the edge of the field with their hats off.")]);
      }
      if (e.id === "grey@fold" && e.state === "arrived") {
        return resolveWith({ ...s, parley: undefined }, "grey_driven", {}, [...CALM,
          say("The Great Grey walks back in among his herd as if it had been his idea, which, by now, he believes it was. The drovers come up from their camp and give the party a cup of something that is mostly smoke. The Committee's wall stays bare; the herds keep their luck.")]);
      }
      if (e.id === "grey@pen" && e.state === "arrived") {
        if (s.deal) {
          return resolveWith({ ...s, parley: undefined }, "grey_sold", { loot: s.price.sale }, [...CALM,
            say(`The Great Grey walks into the Syndicate's pen and the agent drops the bar behind him before he has noticed. £${s.price.sale} is counted out on a crate, with a receipt for "one (1) sire, grey, as found". The drovers watch from the grass and say nothing at all.`)]);
        }
        if (s.penShut) return stay(s);
        return { s: fin({ ...s, penShut: true }), fx: [say("The Syndicate's pen is shut: the agent has not agreed a price. The Great Grey looks at the bars, and at you, and goes round.")] };
      }
      if (e.id === "grey@range" && e.state === "left") {
        return resolveWith({ ...s, parley: undefined }, "grey_escaped", {}, [...CALM,
          say("The Great Grey has had enough of the Society and walks off the edge of the herd ground towards the high pasture, at the steady pace of an animal that has never been hurried in its life. He will not be back this season.")]);
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

function talk(s: HuntState, kind: string, result: string, paid: number): Reduction<HuntState> {
  if (kind === "master_of_hunt") return talkMaster(s, result, paid);
  if (kind === "menagerie_agent") return talkAgent(s, result);
  return stay(s);
}

function talkMaster(s: HuntState, result: string, paid: number): Reduction<HuntState> {
  if (result === "open") {
    if (s.parley || s.licence) return stay(s);
    return { s: fin({ ...s, parley: "master_of_hunt" }), fx: [{ k: "parley", kind: "master_of_hunt", price: s.price.licence }] };
  }
  if (s.parley !== "master_of_hunt") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, master: true } }));
    case "paid": {
      const p = Number.isFinite(paid) ? Math.round(paid) : 0;
      if (!paidOk(s, p)) return stay(fin({ ...s, parley: undefined }));
      return {
        s: fin({ ...s, parley: undefined, licence: true, spent: s.spent + p, paid: s.paid + p }),
        fx: [say(`£${p}, and the Master writes out a licence "to take one (1) beast, grey, on the Crown's grass, by the Society's own hand, at the Society's own risk". She adds, unasked, that it charges.`)],
      };
    }
    default: return stay(fin({ ...s, parley: undefined }));
  }
}

function talkAgent(s: HuntState, result: string): Reduction<HuntState> {
  if (result === "open") {
    if (s.parley || s.deal) return stay(s);
    return { s: fin({ ...s, parley: "menagerie_agent" }), fx: [{ k: "parley", kind: "menagerie_agent", price: s.price.sale }] };
  }
  if (s.parley !== "menagerie_agent") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, agent: true } }));
    case "survey": return {
      s: fin({ ...s, parley: undefined, deal: true }),
      fx: [say(`The agent shakes on £${s.price.sale} and goes to open his pen by the river. "Alive, mind," he says. "A head is no use to a menagerie. Ask the Club."`)],
    };
    default: return stay(fin({ ...s, parley: undefined }));
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: HuntState): ReturnType<TemplateDef<HuntState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  const nothing = tallyEmpty(s.tally) && s.near.barley === 0 && !s.parley && !s.licence && !s.deal && !s.poached && s.spent === 0;
  return nothing ? undefined : "grey_escaped";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const DONE: Record<string, string> = {
  grey_trophy: "The Great Grey is down and the Committee will have its head. Take the boat home and arrange the carriage.",
  grey_driven: "The Great Grey is back with his herd, alive. Take the boat home; the Committee will want to know why.",
  grey_sold: "The Great Grey is in the Syndicate's pen and the money is in your purse. Take the boat home.",
  grey_escaped: "The Great Grey has gone back to the high pasture. Take the boat home and explain the bare wall.",
  abandoned: "The expedition is down in the barley. Take the boat home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  rain: "Rain coming: the harvest is hurried, and the bell will be early.",
  fog: "Fog on the grass: the Great Grey is a grey shape in a grey morning.",
};

function view(s: HuntState, now: number): ScenarioView {
  const res = s.resolution;
  const out = res === "grey_trophy" || res === "grey_driven" || res === "grey_sold";
  const objectives: ObjectiveView[] = [
    { id: "barley", text: "Find the Great Grey in the Reapers' barley", done: s.near.barley > 0 || s.asked.master || s.asked.agent || res !== undefined },
    { id: "out", text: "Shoot it for the Club, or drive it back to its herd", done: out },
    { id: "licence", text: s.licence ? "The Master's licence: bought" : `Buy the Master's licence before you shoot (£${s.price.licence})`, done: s.licence || out, optional: true },
  ];
  if (s.deal && !out) objectives.push({ id: "pen", text: "Or drive it into the agent's pen by the river", done: false, optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the landing", done: false });
  let hint = res !== undefined ? DONE[res] ?? ""
    : s.near.barley > 0 ? "It walks away from people: come at it from the side opposite where you want it to go (its herd is west, past the drovers' camp), and walk, do not run. It veers, and left alone it goes back to the barley. A shot sends it bolting; a wound turns it on whoever fired."
    : "The Great Grey is in the Reapers' barley west of the road. The Master of the Royal Hunt waits at the field's east edge with her licences.";
  if (res === undefined && s.asked.agent && !s.deal) hint += ` (The Syndicate's agent pays £${s.price.sale} for it alive, in his pen by the river.)`;
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remain = res !== undefined ? 0 : s.bellAt - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer("The harvest bell", remain, now), template: "great_grey", title: "The Great Grey", ...ruleWhile("great_grey", res === undefined && !s.licence) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: HuntState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  const o: ScenarioOutcome = {
    scenario: "great_grey", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise,
    seconds: Math.round(s.resolvedAt), complication: s.complication, region: "highmark",
  };
  if (s.loot > 0) o.loot = s.loot;
  return o;
}

// ---- the people (and the beast) ---------------------------------------------------------------------------------------------------------------

const DROVERS = ["Drover Ninian Hask-Bellweather", "Drover Tamsin Oakhurst"] as const;

function roster(_c: CampaignState, seed: number, _s: HuntState): NpcSpec[] {
  const H = HIGHMARK_SITES.hunt, D = HIGHMARK_SITES.drovers;
  const mk = (id: string, role: number, faction: NpcSpec["faction"], side: NpcSpec["side"], group: string, post: { x: number; z: number }, name: string, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction, side, group, post: { x: post.x, z: post.z }, weapon: WEAPON.FISTS, lookSeed: hash3(seed >>> 0, i, role), name, skill: 10, bravery, brain,
  });
  return [
    mk("grey", NPC.BEAST, "ward", "neutral", "grey", H.grey, "The Great Grey", 100, "beast", 0),
    mk("master", NPC.CHAMBERLAIN, "ward", "ward", "master", H.master, "Lady Isolde Thrushcote, Master of the Royal Hunt", 60, "civil", 1),
    mk("agent", NPC.RIVAL_SURVEYOR, "rival", "rival", "agent", H.agent, "Mr. Barnabas Quill-Ferris, Menagerie Agent to the Syndicate", 25, "civil", 2),
    // (the drovers stand where the Vacant Chair's do: by the fire, clear of the shelters)
    mk("drover-0", NPC.HERDER, "ward", "neutral", "drovers", { x: D.x + 1.4, z: D.z + 0.6 }, DROVERS[0], 40, "civil", 3),
    mk("drover-1", NPC.HERDER, "ward", "neutral", "drovers", { x: D.x - 1.2, z: D.z - 1.0 }, DROVERS[1], 40, "civil", 4),
  ];
}

const H = HIGHMARK_SITES.hunt;
const observe: ObserveSpec = {
  near: [{ id: "barley", x: HIGHMARK_SITES.strike.barley.x, z: HIGHMARK_SITES.strike.barley.z, r: HIGHMARK_SITES.strike.barley.r + 6 }],
  use: [
    { id: "master", npc: "master", r: HUNT.personR, talk: "master_of_hunt", carry: "none" },
    { id: "agent", npc: "agent", r: HUNT.personR, talk: "menagerie_agent", carry: "none" },
  ],
  count: [],
  seen: [],
  // the beast watched three ways: back into its herd, into the agent's pen, and off the herd ground (`left` once it is out past the range)
  actors: [
    { id: "grey", as: "grey@fold", goal: { x: H.fold.x, z: H.fold.z, r: H.fold.r } },
    { id: "grey", as: "grey@pen", goal: { x: H.pen.x, z: H.pen.z, r: H.pen.r } },
    { id: "grey", as: "grey@range", goal: { x: HIGHMARK_ANCHORS.herdGround.x, z: HIGHMARK_ANCHORS.herdGround.z, r: H.range }, leaves: true },
  ],
  hostileGroups: ["grey"],
};

export const greatGreyTemplate: TemplateDef<HuntState> = {
  id: "great_grey", title: "The Great Grey",
  brief: "The old grey sire of Thornfield's herds has come down into the Reapers' barley, and the Crown has asked its guests to see to him before the harvest bell. The Society's Natural History Committee would like his head for the Club's wall in Pall Mall; the drovers would like him back in their fold alive; the Syndicate's menagerie agent would like him in his pen. He walks away from people, bolts from a shot and charges whoever wounds him. Every beast on the grassland is the Crown's: the Master of the Royal Hunt sells the licence.",
  init, reduce, view, outcome, roster, leave, observe,
  noPowderStore: true, // (D-084: nobody armed is set against you here; a keg in the barley would be the Society's own)
  sites: { barley: HIGHMARK_SITES.strike.barley, fold: H.fold, pen: H.pen },
};
