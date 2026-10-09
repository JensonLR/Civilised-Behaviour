import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { KESSAR_SITES, NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import { ruleWhile } from "./terms.ts";
import type { BaseState, Fx, ObserveSpec, Reduction, TemplateDef } from "./types.ts";

/**
 * THE SIEGE OF THE COUNTING-HOUSE (D-095, Kessar's sixth contract; the GDD's "siege"). Offered only while the Syndicate keeps its post on Kessar's south bank (`presence.postStage`).
 * The Society's War Committee has read of the post in its own paper and resolved, in Whitehall, that it be "reduced by regular siege, according to the Articles (revised)": a flagpole,
 * a tent and, at its second stage, a plank hut with a counter. The Syndicate's factor regards the whole thing as a dispute about rent. Four hired guns hold the yard; a relief launch
 * is on the river.
 *  - INVEST it: stand at the three picket marks (north, east, south; the west is the Society's own ground). A boy from the Ward takes up each picket, at a penny an hour.
 *    While all three stand, the garrison's stores run down. Twice the garrison SALLIES: two men march out for a picket; one who reaches it with nobody standing on it strikes it,
 *    and the stores clock stops until it is planted again.
 *  - `siege_honours` (won): the post invested, the factor summoned (parley `siege_factor`, "propose") once his case is hopeless: stores out, relief beaten, or half his garrison down.
 *    The garrison marches out to the river with its ledger held up for colours.
 *  - `siege_stormed` (won): three of its four guns down or run. A shot into the post, even a miss, brings the whole garrison out: the storm has begun.
 *  - `siege_bought` (partial): the factor's price for the post "as a going concern", paid.  `siege_lifted` (lost): two of the relief stand in the yard together.
 *  `abandoned`: the party is down. Leaving once anything has happened lifts the siege.
 * A won siege strikes the post: the Syndicate's posts at Kessar go to none (`siegeAftermath`, run by WorldRoom.commitOutcome) and the world is rebuilt without it.
 * Complications (existing ids only): reinforcements enlarge the relief; fog delays its launch; rain fills the garrison's water butts (the stores last longer).
 */

export const SIEGE = {
  /** Seconds of investment (all three pickets standing) that empty the garrison's stores; rain adds. */
  storesS: 120, rainStores: 40,
  /** Seconds into the stores clock at which each sally goes out. */
  sallyAt: [35, 80],
  /**
   * The relief launch puts in this many seconds in (seeded); fog delays it. It forms up for `formS`, then marches; `warnS` before it lands, smoke on the river. (At 300..360 it never
   * mattered: the bot playtest's lone picket-keeper had the factor's surrender at 156 s. Now a quick investment beats it, and a slow one has the relief to fight as well.)
   */
  reliefMin: 210, reliefMax: 270, fogRelief: 45, formS: 20, warnS: 30,
  relief: 4, extraRelief: 2,
  /** Seconds after a sally breaks or strikes in which it is still the sortie's fight (its men run home through the post: a round after them is not the storm). */
  crossfireS: 10,
  /** Share of the relief down or routed that breaks it; garrison down or routed that is a storm; that makes the factor's case hopeless; relief men in the yard that lift the siege. */
  brokenFraction: 0.7, stormed: 3, hopeless: 2, reliefIn: 2,
  /** Radii: a picket mark (standing on it plants it), the post (the party "at the post"). */
  picketR: 3.5, postR: 24,
  /** The post as a going concern (pounds, multiples of five). */
  priceBuy: [90, 140],
  /** Reach of INTERACT with the factor: across his counter (a metre deep) as well as in front of it. */
  personR: 3,
} as const;

const S = KESSAR_SITES.siege;
export const SIEGE_SITES = S;
/** Where the garrison goes when it marches out (honours, or a sale): the river bank where the relief forms up, by a walk planned on the nav grid (a `guard` order). */
const OUT = { x: S.relief[1]!.x, z: S.relief[1]!.z, r: 5 };
/** The marks' names, for the copy (index = picket). */
export const PICKET_NAMES = ["north", "east", "south"] as const;

type Crew = { alive: number; routed: number; down: number; total: number };
const crew = (n: number): Crew => ({ alive: n, routed: 0, down: 0, total: n });

export interface SiegeState extends BaseState {
  complication: ComplicationId;
  near: { post: number; pickets: number[] };
  /** Each picket standing now; and whether its boy has been hired yet (the first planting spawns him, a later one sends him back). */
  pickets: boolean[]; hired: boolean[];
  /** Seconds the stores clock has run (it runs only while all three pickets stand) and how long it must run. */
  starve: number; storesS: number; storesOut: boolean;
  /** Sallies sent so far; the picket the one out now is going for (-1: none) and whether it has reached it. */
  sallies: number; sallyOut: number; sallyThere: boolean; crossfireUntil: number;
  garrison: Crew; sally: Crew;
  /** The storm: the garrison stood to (a shot into the post, or the factor told to come and try). */
  storm: boolean;
  reliefAt: number; warned: boolean; reliefLanded: boolean; marchAt: number; marching: boolean; relief: Crew; reliefBroken: boolean; reliefIn: string[];
  factorDown: boolean; asked: boolean;
  price: number;
  purse: number; spent: number; paid: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): SiegeState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "counting_house", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x51e6 + k);
  const n = SIEGE.relief + (complication === "reinforcements" ? SIEGE.extraRelief : 0);
  return {
    phase: "planning", t: 0, resolvedAt: 0, complication, near: { post: 0, pickets: [0, 0, 0] }, pickets: [false, false, false], hired: [false, false, false],
    starve: 0, storesS: SIEGE.storesS + (complication === "rain" ? SIEGE.rainStores : 0), storesOut: false,
    sallies: 0, sallyOut: -1, sallyThere: false, crossfireUntil: 0, garrison: crew(2), sally: crew(2), storm: false,
    reliefAt: Math.round(SIEGE.reliefMin + (h(1) % (SIEGE.reliefMax - SIEGE.reliefMin + 1)) + (complication === "fog" ? SIEGE.fogRelief : 0)),
    warned: false, reliefLanded: false, marchAt: 0, marching: false, relief: crew(n), reliefBroken: false, reliefIn: [],
    factorDown: false, asked: false, price: rnd5(...SIEGE.priceBuy, h(2)), purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const lost = (c: Crew): number => c.down + c.routed;
const invested = (s: SiegeState): boolean => s.pickets.every((p) => p);
const garrisonLost = (s: SiegeState): number => lost(s.garrison) + lost(s.sally);
const reliefNeeded = (s: SiegeState): number => Math.ceil(s.relief.total * SIEGE.brokenFraction);
/** The factor's case is hopeless: nothing left to eat, nobody coming, or half his guns gone. */
export const hopeless = (s: SiegeState): boolean => s.storesOut || s.reliefBroken || garrisonLost(s) >= SIEGE.hopeless;
const affordable = (s: SiegeState, n: number): boolean => Number.isFinite(n) && n >= 0 && n <= s.purse - s.spent;
const paidOk = (s: SiegeState, paid: number): boolean => Number.isFinite(paid) && paid >= Math.round(s.price * 0.75) && paid <= Math.round(s.price * 1.25) && affordable(s, paid);
const phaseOf = (s: SiegeState): SiegeState["phase"] =>
  s.parley ? "parley" : s.storm || s.marching || s.sallyOut >= 0 ? "fighting" : invested(s) ? "standoff" : s.near.post > 0 || s.pickets.some((p) => p) ? "tension" : "planning";
const fin = (s: SiegeState): SiegeState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const order = (group: string, o: Extract<ScenarioFx, { k: "order" }>["order"]): ScenarioFx => ({ k: "order", group, order: o });
const picketGroup = (k: number): string => `late:picket-${k}`;
const set = (a: readonly boolean[], k: number, v: boolean): boolean[] => a.map((x, i) => (i === k ? v : x));

/** Everyone of the Syndicate's stops fighting (an ending that is not a storm). */
const CEASE: ScenarioFx[] = [order("garrison", { o: "stand_down" }), order("sally", { o: "stand_down" }), order("factor", { o: "stand_down" }), order("late:relief", { o: "stand_down" })];

/** The storm begins: the whole garrison stands to; the factor keeps behind his counter (he is a factor, not a fifth gun). */
function storm(s: SiegeState, why: string, extra: Partial<SiegeState> = {}): Reduction<SiegeState> {
  if (s.storm) return stay(fin({ ...s, ...extra }));
  return {
    s: fin({ ...s, ...extra, storm: true }),
    fx: [order("garrison", { o: "alert" }), order("sally", { o: "alert" }), order("factor", { o: "hold_fire" }), say(why)],
  };
}

/** A sally reached a picket nobody was standing on: the boy runs, the picket is struck, the stores clock stops, and the sally goes home. */
function strike(s: SiegeState, k: number): Reduction<SiegeState> {
  const n = fin({ ...s, pickets: set(s.pickets, k, false), sallyOut: -1, sallyThere: false, crossfireUntil: s.t + SIEGE.crossfireS });
  return {
    s: n,
    fx: [order(picketGroup(k), { o: "flee" }), order("sally", { o: "post" }),
      say(`The sally reaches the ${PICKET_NAMES[k]} picket. The Ward's boy runs for the fort, pennant and all. The siege is broken: plant the picket again, or the garrison eats.`)],
  };
}

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: SiegeState, e: ScenarioInput): Reduction<SiegeState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      let n: SiegeState = { ...s, t: s.t + dtOf(e) };
      const fx: Fx[] = [];
      // the stores clock: only while the place is invested on all three sides
      if (invested(n) && !n.storesOut) {
        n = { ...n, starve: n.starve + dtOf(e) };
        if (n.starve >= n.storesS) {
          n = { ...n, storesOut: true };
          fx.push(say("Inside the post, the factor eats the last biscuit with great dignity. The garrison's stores are out. Summon him to surrender."));
        }
      }
      // a sally, twice, at its time on the stores clock (not in a storm: then the whole garrison is out anyway)
      if (invested(n) && !n.storm && n.sallyOut < 0 && n.sallies < SIEGE.sallyAt.length && n.starve >= SIEGE.sallyAt[n.sallies]! && n.sally.alive > 0) {
        const k = hash3(n.reliefAt, n.sallies, 0x5a11) % 3;
        n = { ...n, sallies: n.sallies + 1, sallyOut: k, sallyThere: false };
        fx.push(order("sally", { o: "alert" }), order("sally", { o: "march", route: `sally${k}` }),
          say(`A sally! ${n.sally.alive} men charge out of the gate for the ${PICKET_NAMES[k]} picket. Stand on the mark, or stop them before they reach it.`));
      }
      // the relief: smoke on the river, then the launch, then the march
      if (!n.warned && !n.reliefLanded && n.t >= n.reliefAt - SIEGE.warnS) {
        n = { ...n, warned: true };
        fx.push(say("Smoke on the river to the north-west: the Syndicate's relief boat is coming. Its men will land and march on the yard."));
      }
      if (!n.reliefLanded && n.t >= n.reliefAt) {
        n = { ...n, warned: true, reliefLanded: true, marchAt: n.t + SIEGE.formS };
        fx.push({ k: "spawn", group: "late:relief" }, order("late:relief", { o: "guard", x: S.relief[1]!.x, z: S.relief[1]!.z, r: 6 }),
          say(`The relief boat lands ${n.relief.total} armed Syndicate men on the river bank. They form up to march on the yard. If two of them get in, the siege is over.`));
      }
      if (n.reliefLanded && !n.marching && !n.reliefBroken && n.t >= n.marchAt) {
        n = { ...n, marching: true };
        fx.push(order("late:relief", { o: "alert" }), order("late:relief", { o: "march", route: "relief", join: true }));
      }
      return { s: fin(n), fx };
    }
    case "near": {
      const k = int(e.party, 0, 8, 0);
      if (e.at === "post") return s.near.post === k ? stay(s) : stay(fin({ ...s, near: { ...s.near, post: k } }));
      const m = /^picket-(\d)$/.exec(e.at);
      if (!m) return stay(s);
      const i = Number(m[1]);
      if (!(i >= 0 && i < 3) || s.near.pickets[i] === k) return stay(s);
      const near = { ...s.near, pickets: s.near.pickets.map((v, j) => (j === i ? k : v)) };
      // stepping off a mark the sally is standing on: it strikes it
      if (k === 0 && s.sallyOut === i && s.sallyThere && s.pickets[i] && s.sally.alive > 0) return strike({ ...s, near }, i);
      if (k === 0 || s.pickets[i]) return stay(fin({ ...s, near }));
      const n = fin({ ...s, near, pickets: set(s.pickets, i, true), hired: set(s.hired, i, true) });
      const fx: Fx[] = [s.hired[i] ? order(picketGroup(i), { o: "post" }) : { k: "spawn", group: picketGroup(i) }];
      if (invested(n)) {
        fx.push(say(n.starve > 0
          ? "The picket is back up and the post is surrounded again. The garrison's stores start running down once more."
          : "The Counting-House is surrounded on three sides, as the rules require. The fourth side is the Society's own camp, which the rules forgot. Its stores are now running down."));
      } else fx.push(say(`A boy from the Ward holds the ${PICKET_NAMES[i]} picket with the Society's pennant. A penny an hour, billed by the Lamp-Warden.`));
      return { s: n, fx };
    }
    case "hostile": {
      // a sortie that is out is fair game; a shot into the post (the garrison at home, the factor) is the storm. While a sally is out, a round that only passes close by the post
      // is that fight's crossfire (a picket's defender fires toward the post: the bot playtest's every miss at a sally grazed the yard's guns behind it); a hit on the post's men is not
      // (and for a few seconds after it breaks: its men run home through the post, and the bot playtest's next round after them started the storm)
      const sortie = s.sallyOut >= 0 || s.t < s.crossfireUntil;
      if (e.at === "sally" && sortie) return stay(s);
      const truce = e.at === "factor" && s.parley === "siege_factor";
      if (e.near === true && sortie && !truce) return stay(s);
      if (e.at === "garrison" || e.at === "sally" || e.at === "factor") {
        return storm(s, truce
          ? "You shot at the factor under a flag of truce. The rules have a word for that, and the garrison has a gun for it. The whole post takes up arms."
          : "Shots into the post! The garrison takes cover, and the factor hides under his counter. The storm has begun: drop three of its four guards, or make them run.",
          truce ? { brokePromise: true, parley: undefined } : {});
      }
      if (e.at === "late:relief" && s.reliefLanded && !s.marching && !s.reliefBroken) {
        return { s: fin({ ...s, marching: true }), fx: [order("late:relief", { o: "alert" }), order("late:relief", { o: "march", route: "relief", join: true }), say("You fired on the relief while it formed up. It marches at once.")] };
      }
      return stay(s);
    }
    case "count": {
      if (e.group === "garrison" || e.group === "sally") {
        if (!(e.total > 0)) return stay(s);
        const tot = int(e.total, 1, 2, 2);
        const alive = int(e.alive, 0, tot), routed = int(e.routed, 0, tot - alive), down = int(e.down, 0, tot - alive - routed);
        const c: Crew = { alive, routed, down, total: tot };
        let n: SiegeState = e.group === "garrison" ? { ...s, garrison: c } : { ...s, sally: c };
        const fx: Fx[] = [];
        // the sally that was out is broken: it reaches nothing
        if (e.group === "sally" && alive === 0 && n.sallyOut >= 0) {
          n = { ...n, sallyOut: -1, sallyThere: false, crossfireUntil: n.t + SIEGE.crossfireS };
          fx.push(say("The sally is broken before it can do any harm. The picket stands."));
        }
        if (garrisonLost(n) >= SIEGE.stormed) {
          return resolveWith(n, "siege_stormed", {}, [...fx, order("garrison", { o: "flee" }), order("sally", { o: "flee" }), order("factor", { o: "stand_down" }), order("late:relief", { o: "flee" }),
            say("The Counting-House falls! Its last guards run for the river. The factor crawls out from under his counter, asking for a receipt. The Society's flag goes up, a little crooked.")]);
        }
        return { s: fin(n), fx };
      }
      // (the runner counts every observed group every tick: before the landing the Cast reports an empty group, which says nothing about the relief)
      if (e.group !== "late:relief" || !s.reliefLanded || !(e.total > 0)) return stay(s);
      const tot = int(e.total, 1, SIEGE.relief + SIEGE.extraRelief, s.relief.total);
      const alive = int(e.alive, 0, tot), routed = int(e.routed, 0, tot - alive), down = int(e.down, 0, tot - alive - routed);
      const n = fin({ ...s, relief: { alive, routed, down, total: tot } });
      if (!n.reliefBroken && lost(n.relief) >= reliefNeeded(n)) {
        return {
          s: fin({ ...n, reliefBroken: true, reliefIn: [] }),
          fx: [order("late:relief", { o: "flee" }),
            say(invested(n) ? "The relief breaks and runs for its boat. The factor watches it go and closes his ledger. He will talk terms now."
              : "The relief breaks and runs for its boat. Nobody is coming to help the factor now. Surround the post on all three sides and he will talk terms.")],
        };
      }
      return stay(n);
    }
    case "actor": {
      const sm = /^sally-\d@p(\d)$/.exec(e.id);
      if (sm && e.state === "arrived") {
        const k = Number(sm[1]);
        if (s.sallyOut !== k || s.sallyThere) return stay(s);
        const n = fin({ ...s, sallyThere: true });
        if (!s.pickets[k]) return { s: { ...n, sallyOut: -1, sallyThere: false, crossfireUntil: n.t + SIEGE.crossfireS }, fx: [order("sally", { o: "post" })] };
        if ((s.near.pickets[k] ?? 0) > 0) return { s: n, fx: [say(`The sally reaches the ${PICKET_NAMES[k]} picket and finds you standing on it. They mean to move you.`)] };
        return strike(n, k);
      }
      const rm = /^relief-(\d)$/.exec(e.id);
      if (rm && e.state === "arrived") {
        if (s.reliefBroken || s.reliefIn.includes(e.id)) return stay(s);
        const n = fin({ ...s, reliefIn: [...s.reliefIn, e.id] });
        if (n.reliefIn.length >= SIEGE.reliefIn) {
          const flee = [0, 1, 2].filter((k) => s.hired[k]).map((k) => order(picketGroup(k), { o: "flee" }));
          return resolveWith(n, "siege_lifted", {}, [...flee, order("garrison", { o: "stand_down" }), order("sally", { o: "stand_down" }), order("late:relief", { o: "stand_down" }),
            say("The relief marches into the yard and shakes the factor's hand. The siege is over. The Ward's boys go home with their pennies, and the Syndicate's flag stays up.")]);
        }
        return { s: n, fx: [say("One relief man is in the yard. One more, and the siege is over.")] };
      }
      if (rm && (e.state === "down" || e.state === "left")) return s.reliefIn.includes(e.id) ? stay(fin({ ...s, reliefIn: s.reliefIn.filter((id) => id !== e.id) })) : stay(s);
      if (e.id === "factor" && e.state === "down" && !s.factorDown) return stay(fin({ ...s, factorDown: true, parley: s.parley === "siege_factor" ? undefined : s.parley }));
      return stay(s);
    }
    case "talk": return e.kind === "siege_factor" ? talk(s, e.result, e.paid) : stay(s);
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, {});
    }
    default: return stay(s);
  }
}

function talk(s: SiegeState, result: string, paid: number): Reduction<SiegeState> {
  if (result === "open") {
    if (s.parley || s.factorDown) return stay(s);
    return { s: fin({ ...s, parley: "siege_factor" }), fx: [{ k: "parley", kind: "siege_factor", price: s.price }] };
  }
  if (s.parley !== "siege_factor") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin({ ...s, asked: true }));
    case "hostile": return storm({ ...s, parley: undefined }, "\"Then come and get it,\" says the factor, and dives under his counter. The garrison takes up arms. The storm has begun.");
    case "survey": {
      const n = fin({ ...s, parley: undefined, asked: true });
      if (!invested(n)) {
        return { s: n, fx: [say("\"Your own rules say the place must be invested, surrounded on three sides,\" says the factor, who has read them. \"I can still see the river. Come back when I cannot.\"")] };
      }
      if (!hopeless(n)) {
        return { s: n, fx: [say("\"My stores are good, my relief is coming and my men are standing,\" says the factor. \"Ask me again when none of that is true.\"")] };
      }
      return resolveWith(n, "siege_honours", {}, [...CEASE, order("garrison", { o: "guard", ...OUT }), order("sally", { o: "guard", ...OUT }), order("factor", { o: "guard", ...OUT }),
        say("The factor surrenders, with the honours of war. His men march out to the river, holding the Syndicate's ledger up like a flag. The Society's flag goes up on the pole.")]);
    }
    case "paid": {
      if (!paidOk(s, paid)) return stay(fin({ ...s, parley: undefined }));
      const n = fin({ ...s, parley: undefined, spent: s.spent + paid, paid: s.paid + paid });
      return resolveWith(n, "siege_bought", {}, [...CEASE, order("garrison", { o: "guard", ...OUT }), order("sally", { o: "guard", ...OUT }), order("factor", { o: "guard", ...OUT }),
        say(`£${paid} is counted out on the counter. The factor writes a receipt for "one (1) trading post", takes down his flag and walks his men to the river. The Committee has bought a siege.`)]);
    }
    default: return stay(fin({ ...s, parley: undefined }));
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: SiegeState): ReturnType<TemplateDef<SiegeState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  // sailing before anything was done dismisses the run; once a picket went up, a shot was fired or a word said, the siege is lifted
  const nothing = tallyEmpty(s.tally) && !s.hired.some((h) => h) && !s.storm && !s.asked && s.spent === 0;
  return nothing ? undefined : "siege_lifted";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const DONE: Record<string, string> = {
  siege_honours: "The Counting-House surrendered with honours, and the Society's flag is on its pole. Take the boat home.",
  siege_stormed: "The Counting-House was taken by storm. The Society's flag is on its pole, a little crooked. Take the boat home.",
  siege_bought: "You bought the Counting-House, with a receipt. The Committee has its siege, sort of. Take the boat home.",
  siege_lifted: "The relief reached the yard and the siege is over. The Syndicate's flag stays up. Take the boat home.",
  abandoned: "The expedition is down in front of the Counting-House. Take the boat home and explain.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  reinforcements: "The relief force is bigger than the Committee's spies said.",
  fog: "Fog on the river: the relief boat is feeling its way, and will be late.",
  rain: "Rain: the garrison's water barrels are filling, so its stores will last longer.",
};

function view(s: SiegeState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "siege_honours" || res === "siege_stormed" || res === "siege_bought";
  const held = s.pickets.filter((p) => p).length;
  const objectives: ObjectiveView[] = [
    // (the id names the next mark to plant, so the compass strip walks the party round them: compassMarks.ts)
    { id: invested(s) || won ? "invest" : `picket${s.pickets.indexOf(false)}`, text: invested(s) ? "The post is surrounded on three sides" : `Plant pickets on the three marks around the post (${held}/3)`, done: invested(s) || won },
    { id: "take", text: res === "siege_lifted" ? "Lost: the relief reached the yard" : res === "abandoned" ? "Lost: the expedition went down" : "Take the Counting-House: by surrender or by storm", done: won },
  ];
  if (res === undefined && !s.factorDown) {
    objectives.push({
      id: "terms", optional: true, done: false,
      text: invested(s) && hopeless(s) ? "Summon the factor: he will surrender now" : "Summon him once his stores, relief or guards fail",
    });
    objectives.push({ id: "buy", text: `Or buy the post from the factor (£${s.price})`, done: false, optional: true });
  }
  if (res === undefined && s.sallyOut >= 0) objectives.push({ id: `sally${s.sallyOut}`, text: `Stop the sally on the ${PICKET_NAMES[s.sallyOut]} picket, or stand on it`, done: false, optional: true });
  if (res === undefined && s.storm) objectives.push({ id: "storm", text: `Storm it: drop or scatter ${SIEGE.stormed} of its 4 guards (${Math.min(garrisonLost(s), SIEGE.stormed)} so far)`, done: false, optional: true });
  if (res === undefined && s.reliefLanded && !s.reliefBroken) {
    objectives.push({ id: "relief", text: `Stop the relief: drop or scatter ${reliefNeeded(s)} of its ${s.relief.total} (${Math.min(lost(s.relief), reliefNeeded(s))} so far)`, done: false, optional: true });
    if (s.reliefIn.length > 0) objectives.push({ id: "yard", text: "Stop the relief man in the yard: two end the siege", done: false, optional: true });
  }
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the landing", done: false });
  let hint = res !== undefined ? DONE[res] ?? ""
    : s.storm ? "The garrison fights from behind the tent and the counter. Drop three of its four guards. Or make the factor's case hopeless, then summon him."
    : invested(s) ? (s.storesOut ? "The garrison's stores are out. Summon the factor at his counter." : "The post is surrounded and its stores are running down. Keep the pickets up. Twice, the garrison will sally out to knock one down.")
    : "The Syndicate's post is east of the Society's ground. Surround it: stand on each of the three picket marks, and a boy from the Ward will hold it.";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const clock: [string, number] = invested(s) && !s.storesOut && !s.storm ? ["The garrison's stores", s.storesS - s.starve]
    : !s.reliefLanded ? ["The relief lands", s.reliefAt - s.t] : !s.marching && !s.reliefBroken ? ["The relief marches", s.marchAt - s.t] : ["", 0];
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(clock[0], res !== undefined ? 0 : clock[1], now), template: "counting_house", title: "The Siege of the Counting-House", ...ruleWhile("counting_house", res === undefined && !s.storm) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: SiegeState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  return {
    scenario: "counting_house", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
    complication: s.complication, region: "kessar",
  };
}

// ---- the people -------------------------------------------------------------------------------------------------------------------------------

const GARRISON = ["Guard Silas Penhallow-Vesk", "Guard Mabel Inkersole", "Guard Rufus Ledgerby", "Guard Agatha Coombe"] as const;
const RELIEF = ["Relief Corporal Ambrose Tallis", "Reliefman Cuthbert Mear", "Reliefwoman Iris Dunmarrow", "Reliefman Oswin Grail", "Reliefman Jory Fitch (sent for)", "Reliefwoman Lettice Brann (sent for)"] as const;
const RELIEF_ARMS: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.SABRE, WEAPON.PISTOL, WEAPON.SABRE, WEAPON.RIFLE, WEAPON.BLUNDERBUSS];
const PICKETS = ["Lamp-boy Teodric Quill, picket (a penny an hour)", "Lamp-girl Hesper Vane, picket (a penny an hour)", "Lamp-boy Orrin Sallow, picket (a penny an hour)"] as const;

/** The factor, his two guns in the yard and his two sallying behind them; the relief (held back until it lands); the Ward's three picket boys (held back until each mark is planted). */
function roster(_c: CampaignState, seed: number, s: SiegeState): NpcSpec[] {
  const out: NpcSpec[] = [];
  const guard = (id: string, group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, i: number): NpcSpec => ({
    id, role: NPC.RIVAL_GUARD, faction: "rival", side: "rival", group, post: { x: post.x, z: post.z }, weapon,
    lookSeed: hash3(seed >>> 0, i, 0x51e6), name, skill: 40 + (hash3(seed >>> 0, i, 0x51e7) % 16), bravery: 45 + (hash3(seed >>> 0, i, 0x51e8) % 20), brain: "garrison",
  });
  out.push(guard("garrison-0", "garrison", S.garrison[0]!, WEAPON.RIFLE, GARRISON[0], 0), guard("garrison-1", "garrison", S.garrison[1]!, WEAPON.PISTOL, GARRISON[1], 1));
  // (the sally is a rush with blades, as sorties were: a picket's defender can shoot it down across the open ground, and it hurts only at close quarters. With a pistol among them a lone
  // defender on the south mark was shot down from the yard 17 m off, through the post, in the bot playtest)
  out.push(guard("sally-0", "sally", S.sallyPosts[0]!, WEAPON.SABRE, GARRISON[2], 2), guard("sally-1", "sally", S.sallyPosts[1]!, WEAPON.SABRE, GARRISON[3], 3));
  // the relief: ashore in two ranks on the bank west of the river wall, held back until the launch puts in
  const L = S.relief[0]!;
  for (let i = 0; i < s.relief.total; i++) {
    out.push(guard(`relief-${i}`, "late:relief", { x: L.x - 5 + (i % 3) * 2.2, z: L.z + 0.2 + Math.floor(i / 3) * 2.2 }, RELIEF_ARMS[i]!, RELIEF[i]!, 10 + i));
  }
  // the Ward's picket boys: a garrison brain (they walk back to their mark when sent; nobody's side, so nobody fights them), unarmed, drawn as Kessar's own people, each with the
  // Society's pennant in hand (NPC.PICKET: the client gives them it). Not a porter's role: a porter is the party's hired hand to the client's roster and to the Butcher's Bill (a
  // stray round on a boy was billed as "a colleague shot")
  for (let k = 0; k < 3; k++) {
    out.push({
      id: `picket-${k}`, role: NPC.PICKET, faction: "ward", side: "neutral", group: picketGroup(k), post: { ...S.pickets[k]! }, weapon: WEAPON.FISTS,
      lookSeed: hash3(seed >>> 0, k, 0x91c7), name: PICKETS[k]!, skill: 5, bravery: 20, brain: "garrison",
    });
  }
  // (a garrison brain holding a pistol, like the raid's captain: he holds fire in a storm; he is a factor. Steady, too: he has been besieged by creditors. At the raid captain's
  // bravery of 30 the reports of a sally fight 23 m off broke him in the bot playtest, and he ran into his own counter and stayed there)
  out.push({
    id: "factor", role: NPC.RIVAL_SURVEYOR, faction: "rival", side: "rival", group: "factor", post: { ...S.factor }, weapon: WEAPON.PISTOL,
    lookSeed: hash3(seed >>> 0, 9, 0x51e6), name: "Mr. Aurelian Coot-Vesk, Factor to the Syndicate", skill: 30, bravery: 70, brain: "garrison",
  });
  return out;
}

const observe: ObserveSpec = {
  near: [{ id: "post", x: S.yard.x, z: S.yard.z, r: SIEGE.postR }, ...S.pickets.map((p, k) => ({ id: `picket-${k}`, x: p.x, z: p.z, r: SIEGE.picketR }))],
  use: [{ id: "factor", npc: "factor", r: SIEGE.personR, talk: "siege_factor", carry: "none" }],
  count: [{ group: "garrison" }, { group: "sally" }, { group: "late:relief" }],
  seen: [],
  actors: [
    // each sallying man watched at each picket mark (`sally-0@p1`: the first of them at the east mark)
    ...[0, 1].flatMap((i) => S.pickets.map((p, k) => ({ id: `sally-${i}`, as: `sally-${i}@p${k}`, goal: { x: p.x, z: p.z, r: SIEGE.picketR } }))),
    ...Array.from({ length: SIEGE.relief + SIEGE.extraRelief }, (_, i) => ({ id: `relief-${i}`, goal: { x: S.yard.x, z: S.yard.z, r: S.yardR }, leaves: true })),
    { id: "factor" },
  ],
  hostileGroups: ["garrison", "sally", "factor", "late:relief"],
};

export const countingHouseTemplate: TemplateDef<SiegeState> = {
  id: "counting_house", title: "The Siege of the Counting-House",
  brief: "The War Committee wants the Syndicate's post at Kessar taken by a proper siege. Surround it on three sides, then summon the factor. It is a tent and a counter. A relief boat is coming.",
  init, reduce, view, outcome, roster, leave, observe,
  routes: { sally0: S.sallies[0]!, sally1: S.sallies[1]!, sally2: S.sallies[2]!, relief: S.relief },
  sites: { yard: S.yard, landing: S.relief[0]! },
};
