import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { HIGHMARK_ANCHORS, HIGHMARK_SITES, highmarkPlan } from "../highmark.ts";
import { clamp } from "../math.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";
import { ruleWhile } from "./terms.ts";

/**
 * SUCCESSION DISPUTE, "The Vacant Chair" (D-036, Highmark; docs/_notes/ship.md section 2). The King has been "pending" for six years. Two heirs (Princess Orla "by Seniority", Prince
 * Dunstan "by Acclamation"), a Lord Chamberlain who runs the court by form, the Thornfield Reapers' Assembly (three delegates, one scythe and one vote each, who ratify at the HARVEST
 * BELL: the run's clock) and a Syndicate envoy with a cheque all want the chair filled their way.
 *
 * The party decides nothing from a menu. It leans on four pressures and the ending is whatever they add up to:
 *  - the CHAMBERLAIN's Form 11: filed (stamped after FORM_S seconds) or expedited with an envelope (immediate). Nothing is ratified, and no cheque is cashed, without it.
 *  - each HEIR's price: pledge her (or him) the chair for money, or propose a regency (three signatures: both heirs and the Chamberlain). One pledge at a time.
 *  - the GRANGE: a barrel of grain to a delegate is that delegate's vote (INTERACT with a barrel). Two of three ratify; all of them present ring the bell early.
 *  - the ENVOY's cheque: INTERACT once to hear the figure, again to take it. The Syndicate pays the party and buys the Crown's concession.
 * Endings (first wins, then the state is frozen):
 *  `backed_elder` / `backed_younger`: the bell has rung, the form is in, the Assembly has two votes, and exactly one heir was pledged.
 *  `regency`: the same, with both heirs in for a regency instead.
 *  `crown_sold`: the cheque was taken and the Chamberlain's seal is on it; or nobody settled anything for GRACE_S after the bell and the Syndicate's cheque was cashed without you.
 *  `usurped`: the party broke the court guard and sat somebody in the chair (INTERACT with the throne). Sitting in it while the guard stands is a declaration.
 *  `abandoned`: the party is down. Leaving commits what happened (`leave`): nothing, `abandoned`, or `crown_sold` once a cheque is in the pocket.
 * Complications (existing ids only): rain hurries the bell (the Grange wants the barley in), fog lengthens it (nobody finds the hall), outriders shorten the Syndicate's patience.
 */

export const SUCCESSION = {
  /** The harvest bell tolls this many seconds in (a seeded value in this range; the Assembly ratifies then, or at once if every delegate present has been fed). */
  bellMin: 300, bellMax: 420,
  /** After the bell, the Syndicate's cheque is cashed without you this long after, unless the court is at war with itself. */
  graceS: 150,
  /** A stamped form takes this long; an envelope is immediate. */
  formS: 45,
  /** Delegates, votes to ratify, and the haste of a fed Assembly. */
  delegates: 3, votesToRatify: 2, fedBellS: 20,
  /** D-041: seconds from a ready court (form, two votes, one heir or a regency) to the bell. */
  readyBellS: 25,
  /** Court guards broken: share of the four who must be down or routed before the chair is unguarded. */
  brokenFraction: 0.6,
  /** Reach of INTERACT with the chair, the envoy, a delegate (metres). */
  throneR: 2.4, personR: 2.4, courtR: 16,
  rainBell: -60, fogBell: 60, outridersGrace: -60,
  /** Prices (pounds, multiples of five). */
  priceElder: [55, 90], priceYounger: [35, 70], priceBribe: [25, 55], priceCheque: [80, 130],
} as const;

type Heir = "none" | "pledged" | "regency";
export type FormState = "none" | "pending" | "filed" | "bribed";
export type ChequeState = "none" | "offered" | "taken";
type Who = "elder" | "younger";

export interface SuccessionState extends BaseState {
  complication: ComplicationId; rain: number;
  near: { court: number };
  form: FormState; formAt: number;
  heir: { elder: Heir; younger: Heir };
  price: { elder: number; younger: number; bribe: number; cheque: number };
  /** Delegates fed (bit i = delegate i has his grain) and delegates downed. */
  fed: number; downD: number;
  cheque: ChequeState;
  bell: number; bellRung: boolean; grace: number; deadlocked: boolean;
  hostile: boolean; sat: boolean; guards: { alive: number; routed: number; down: number; total: number };
  down: { chamberlain: boolean; elder: boolean; younger: boolean; envoy: boolean };
  asked: { chamberlain: boolean; elder: boolean; younger: boolean };
  purse: number; spent: number; paid: number; loot: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));
const popcount = (n: number): number => { let c = 0; for (let v = n & 7; v; v &= v - 1) c++; return c; };

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): SuccessionState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "succession_dispute", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x5ec0 + k);
  const bell = SUCCESSION.bellMin + (h(1) % (SUCCESSION.bellMax - SUCCESSION.bellMin + 1)) + (complication === "rain" ? SUCCESSION.rainBell : complication === "fog" ? SUCCESSION.fogBell : 0);
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, rain: 0, near: { court: 0 }, form: "none", formAt: 0, heir: { elder: "none", younger: "none" },
    price: { elder: rnd5(...SUCCESSION.priceElder, h(2)), younger: rnd5(...SUCCESSION.priceYounger, h(3)), bribe: rnd5(...SUCCESSION.priceBribe, h(4)), cheque: rnd5(...SUCCESSION.priceCheque, h(5)) },
    fed: 0, downD: 0, cheque: "none", bell: Math.round(bell), bellRung: false, grace: SUCCESSION.graceS + (complication === "outriders" ? SUCCESSION.outridersGrace : 0), deadlocked: false,
    hostile: false, sat: false, guards: { alive: 4, routed: 0, down: 0, total: 4 },
    down: { chamberlain: false, elder: false, younger: false, envoy: false }, asked: { chamberlain: false, elder: false, younger: false },
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, loot: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const formOk = (s: SuccessionState): boolean => s.form === "filed" || s.form === "bribed";
const votes = (s: SuccessionState): number => popcount(s.fed & ~s.downD);
const present = (s: SuccessionState): number => SUCCESSION.delegates - popcount(s.downD);
/** Exactly one heir pledged, or both in for a regency: what the Assembly would ratify if it sat now. */
const courtReady = (s: SuccessionState): boolean => {
  const { elder: e, younger: y } = s.heir;
  return (e === "pledged") !== (y === "pledged") || (e === "regency" && y === "regency");
};
const broken = (s: SuccessionState): number => s.guards.routed + s.guards.down;
const guardBroken = (s: SuccessionState): boolean => s.guards.total === 0 || broken(s) >= Math.ceil(s.guards.total * SUCCESSION.brokenFraction);
const affordable = (s: SuccessionState, n: number): boolean => n >= 0 && n <= s.purse - s.spent;
const phaseOf = (s: SuccessionState): SuccessionState["phase"] =>
  s.parley ? "parley" : s.hostile ? "fighting" : s.bellRung ? "tension" : s.near.court > 0 ? "waiting" : "approach";
const fin = (s: SuccessionState): SuccessionState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const NAME: Record<Who, string> = { elder: "Princess Orla", younger: "Prince Dunstan" };

// ---- the ending rules, in one place -----------------------------------------------------------------------------------------------------------

/** After every change: does the court now add up to an ending? (The first that does wins.) */
function settle(s: SuccessionState, said: ScenarioFx[] = []): Reduction<SuccessionState> {
  if (s.phase === "resolved") return { s, fx: said };
  // the cheque: the Chamberlain's seal on the Syndicate's money
  if (s.cheque === "taken" && formOk(s)) {
    return resolveWith(s, "crown_sold", { loot: s.price.cheque }, [
      ...said, { k: "order", group: "guards", order: { o: "stand_down" } },
      say(`The Chamberlain's seal thumps down on the cheque. £${s.price.cheque} is yours, the Crown's trade rights are the Syndicate's, and the chair is sold. The envoy has the contract ready.`),
    ]);
  }
  // D-041: a court that is READY (the form in, two votes in the barley, one heir pledged or a regency signed) sends for the Assembly: the bell comes forward. The bot playtest
  // set the whole court up by minute three and then stood about for three more with nothing left to do but wait for a bell on a schedule.
  if (!s.bellRung && formOk(s) && votes(s) >= SUCCESSION.votesToRatify && courtReady(s) && s.bell > s.t + SUCCESSION.readyBellS) {
    s = fin({ ...s, bell: Math.round(s.t + SUCCESSION.readyBellS) });
    said = [...said, say("The Chamberlain checks the form, the votes and the pledge, and can find nothing to object to. It pains her. A boy is sent up the bell tower.")];
  }
  // the Assembly votes at the bell (or at once if it is already ringing and the court is ready)
  if (s.bellRung && formOk(s) && votes(s) >= SUCCESSION.votesToRatify) {
    const { elder: e, younger: y } = s.heir;
    if (e === "pledged" && y !== "pledged") return resolveWith(s, "backed_elder", {}, [...said, { k: "order", group: "guards", order: { o: "stand_down" } }, say("The Assembly votes by a show of hands, which is also how it harvests. Princess Orla takes the chair, by Seniority. Prince Dunstan claps, which is what he does.")]);
    if (y === "pledged" && e !== "pledged") return resolveWith(s, "backed_younger", {}, [...said, { k: "order", group: "guards", order: { o: "stand_down" } }, say("The Assembly votes by cheering, which is not a number but is very loud. Prince Dunstan takes the chair. Princess Orla notes, in writing, that she is the elder.")]);
    if (e === "regency" && y === "regency") return resolveWith(s, "regency", {}, [...said, { k: "order", group: "guards", order: { o: "stand_down" } }, say("Three signatures on one sheet: the Chamberlain's, the Princess's and the Prince's. The Assembly approves a regency. The chair stays empty, which everyone now calls stable.")]);
    if (e === "pledged" && y === "pledged" && !s.deadlocked) {
      return { s: fin({ ...s, deadlocked: true }), fx: [...said, say("You have promised the chair to BOTH heirs, so the Assembly votes for neither. \"A scythe cuts one thing at a time,\" says the senior delegate. The Chamberlain makes a note.")] };
    }
  }
  return { s: fin(s), fx: said };
}

/** The court draws its guard: first cause wins; later ones change nothing. */
function raise(s: SuccessionState, why: string, brokePromise = false): Reduction<SuccessionState> {
  const bp = s.brokePromise || brokePromise;
  if (s.hostile) return { s: fin({ ...s, brokePromise: bp }), fx: [] };
  const fx: ScenarioFx[] = [
    { k: "order", group: "guards", order: { o: "alert" } }, { k: "order", group: "court", order: { o: "flee" } }, { k: "order", group: "claimants", order: { o: "flee" } },
    { k: "order", group: "envoy", order: { o: "flee" } }, say(why),
  ];
  return { s: fin({ ...s, hostile: true, parley: undefined, brokePromise: bp }), fx };
}

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: SuccessionState, e: ScenarioInput): Reduction<SuccessionState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const dt = dtOf(e);
      let n: SuccessionState = { ...s, t: s.t + dt };
      const fx: ScenarioFx[] = [];
      if (n.form === "pending" && n.t >= n.formAt) {
        n = { ...n, form: "filed" };
        fx.push(say("Form 11 is stamped. The stamp is a very large stamp; the clerk has been waiting to use it since the spring."));
      }
      if (!n.bellRung && n.t >= n.bell) {
        n = { ...n, bellRung: true };
        fx.push(say("The harvest bell rings once for each year the King has been 'pending', then runs out of rope. The Reapers' Assembly takes its seats to vote."));
      }
      // the Syndicate's cheque is cashed without you, unless the court is busy fighting itself
      if (n.bellRung && n.t >= n.bell + n.grace && (!n.hostile || guardBroken(n))) {
        const r = resolveWith(n, "crown_sold", {}, [...fx, say("Nobody settled anything, so the Chamberlain takes the only offer on the table. The envoy's cheque is cashed without you. The Syndicate has bought the chair.")]);
        return r;
      }
      return settle(n, fx);
    }
    case "weather": return stay(fin({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 }));
    case "near": {
      if (e.at !== "court") return stay(s);
      const n = int(e.party, 0, 8, 0);
      return s.near.court === n ? stay(s) : stay(fin({ ...s, near: { court: n } }));
    }
    case "count": {
      if (e.group !== "guards") return stay(s);
      const total = int(e.total, 0, 4, s.guards.total);
      const alive = int(e.alive, 0, total), routed = int(e.routed, 0, total - alive), down = int(e.down, 0, total - alive - routed);
      const was = guardBroken(s) && s.hostile;
      const n = fin({ ...s, guards: { alive, routed, down, total } });
      if (!was && n.hostile && guardBroken(n)) return { s: n, fx: [say("The court's guard is broken. Nothing now stands between you and the chair but good manners.")] };
      return stay(n);
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "guards" && e.at !== "court" && e.at !== "claimants") return stay(s);
      return raise({ ...s }, "Blood in the court. The guards have waited six years for something to do, and they are delighted.", s.parley !== undefined || formOk(s) || s.heir.elder !== "none" || s.heir.younger !== "none");
    }
    case "actor": {
      const id = e.id;
      if (e.state !== "down") return stay(s);
      if (id === "chamberlain" && !s.down.chamberlain) {
        const r = raise({ ...s, down: { ...s.down, chamberlain: true } }, "The Lord Chamberlain is down. Every form in Highmark is now on hold, and the guards know whom to blame.");
        return settle(r.s, r.fx as ScenarioFx[]);
      }
      if ((id === "claimant-elder" || id === "claimant-younger") && !s.down[id === "claimant-elder" ? "elder" : "younger"]) {
        const who: Who = id === "claimant-elder" ? "elder" : "younger";
        const r = raise({ ...s, down: { ...s.down, [who]: true }, heir: { ...s.heir, [who]: "none" } }, `${NAME[who]} is down. The court turns out to care about heirs after all. The Reapers' delegates start counting their scythes.`);
        return settle(r.s, r.fx as ScenarioFx[]);
      }
      if (id === "envoy" && !s.down.envoy) return stay(fin({ ...s, down: { ...s.down, envoy: true }, cheque: s.cheque === "taken" ? "taken" : "none" }));
      const m = /^grange-([0-2])$/.exec(id);
      if (m) {
        const bit = 1 << Number(m[1]);
        if ((s.downD & bit) !== 0) return stay(s);
        return settle(fin({ ...s, downD: s.downD | bit }), [say("A Reapers' delegate is down. The others stand up together, then sit down together. In Highmark, that is a protest.")]);
      }
      return stay(s);
    }
    case "use": {
      const t = e.target;
      if (t === "throne") return useThrone(s);
      if (t === "envoy") return useEnvoy(s);
      const m = /^grange([0-2])$/.exec(t);
      if (m) return useGrange(s, Number(m[1]));
      return stay(s);
    }
    case "talk": return talk(s, e.kind, e.result, e.paid);
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, r === "crown_sold" ? { loot: s.price.cheque } : {});
    }
    default: return stay(s);
  }
}

function useThrone(s: SuccessionState): Reduction<SuccessionState> {
  if (guardBroken(s) && s.hostile) {
    return resolveWith(s, "usurped", {}, [{ k: "order", group: "guards", order: { o: "stand_down" } }, say("Somebody sits in the chair. From the floor, the Chamberlain says this is not the proper form. Nobody still standing disagrees with the chair. Highmark has a new ruler.")]);
  }
  if (s.hostile) return { s, fx: [say("Several hands lift you out of the chair. The guard is still standing, and you are not the only one with a sabre.")] };
  // sitting in it with the guard standing is a declaration
  const r = raise({ ...s, sat: true }, "You sit in the Vacant Chair. Silence. \"That,\" says the Chamberlain, \"is not on the form.\" The guards have never had a more interesting afternoon.", true);
  return r;
}

function useEnvoy(s: SuccessionState): Reduction<SuccessionState> {
  if (s.down.envoy) return stay(s);
  if (s.cheque === "none") {
    return { s: fin({ ...s, cheque: "offered" }), fx: [say(`The Syndicate's envoy offers a cheque for £${s.price.cheque}, for the Crown's trade rights. \"The Chamberlain seals anything with a form,\" he says. \"Come back to take it.\"`)] };
  }
  if (s.cheque === "taken") return { s, fx: [say("The cheque is already in your pocket. The envoy is waiting, politely, for the Chamberlain's seal.")] };
  // taking it: the heirs' money is wasted and the Syndicate's is not
  const bp = s.heir.elder === "pledged" || s.heir.younger === "pledged";
  const r = settle(fin({ ...s, cheque: "taken", brokePromise: s.brokePromise || bp }), [say(formOk(s)
    ? "You take the cheque. The envoy, who has been smiling since last year, hands you a copy for the Society's files."
    : "You take the cheque. \"It needs the Chamberlain's seal,\" says the envoy. \"Everything does. Be a good citizen and get Form 11 filed.\"")]);
  return r;
}

function useGrange(s: SuccessionState, i: number): Reduction<SuccessionState> {
  const bit = 1 << i;
  if ((s.downD & bit) !== 0 || (s.fed & bit) !== 0) return stay(s);
  let n: SuccessionState = fin({ ...s, fed: s.fed | bit });
  const fx: ScenarioFx[] = [say(votes(n) >= SUCCESSION.votesToRatify
    ? "The delegate weighs the barrel, taps it and passes it down the bench. That makes two votes, and two of three is a majority."
    : "The delegate weighs the barrel and taps it. \"Fair.\" From a farmer, that is a speech. That is one vote.")];
  // an Assembly that has been fed is an Assembly in a hurry: the bell is rung early (never later than it was going to be)
  if (!n.bellRung && votes(n) >= present(n) && votes(n) >= SUCCESSION.votesToRatify) {
    const at = n.t + SUCCESSION.fedBellS;
    if (at < n.bell) {
      n = { ...n, bell: Math.round(at) };
      fx.push(say("Every delegate here has had their grain. Fed and impatient, the Assembly sends a boy up the tower to ring the bell early."));
    }
  }
  return settle(n, fx);
}

// ---- the parleys ------------------------------------------------------------------------------------------------------------------------------

function talk(s: SuccessionState, kind: string, result: string, paidIn: number): Reduction<SuccessionState> {
  if (kind === "chamberlain") return talkChamberlain(s, result, paidIn);
  if (kind === "claimant_elder") return talkHeir(s, "elder", result, paidIn);
  if (kind === "claimant_younger") return talkHeir(s, "younger", result, paidIn);
  return stay(s);
}

function paidOk(s: SuccessionState, paid: number, price: number): boolean {
  return Number.isFinite(paid) && paid >= Math.round(price * 0.75) && paid <= Math.round(price * 1.25) && affordable(s, paid);
}

function talkChamberlain(s: SuccessionState, result: string, paid: number): Reduction<SuccessionState> {
  if (result === "open") {
    if (s.parley || s.hostile) return stay(s);
    if (s.down.chamberlain) return stay(s);
    if (formOk(s) || s.form === "pending") {
      return { s, fx: [say(s.form === "pending" ? "\"Form 11 is with the Stamp,\" says the Chamberlain, without looking up. \"One does not hurry the Stamp.\"" : "\"Form 11 is in order,\" says the Chamberlain, with the faint sadness of a woman who has nothing left to refuse.")] };
    }
    return { s: fin({ ...s, parley: "chamberlain" }), fx: [{ k: "parley", kind: "chamberlain", price: s.price.bribe }] };
  }
  if (s.parley !== "chamberlain") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "hostile": return raise({ ...s, parley: undefined }, "You threaten the Lord Chamberlain with a raised voice and a lowered weapon. The court's guards come running.", true);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, chamberlain: true } }));
    case "survey": {
      // file Form 11: the stamp takes its time
      if (s.form !== "none") return stay(fin({ ...s, parley: undefined }));
      return { s: fin({ ...s, parley: undefined, form: "pending", formAt: s.t + SUCCESSION.formS }), fx: [say(`Form 11 is filed, in three copies, at the Window. \"The Stamp will see it in forty-five seconds,\" says the Chamberlain. \"We call that prompt.\"`)] };
    }
    case "paid": {
      if (s.form !== "none" || !paidOk(s, paid, s.price.bribe)) return stay(fin({ ...s, parley: undefined }));
      const n = fin({ ...s, parley: undefined, form: "bribed", spent: s.spent + paid, paid: s.paid + paid });
      return settle(n, [say(`An envelope with £${paid} in it slides under the counter. \"Form 11,\" says the Chamberlain, stamping it twice, \"is now in order. It always was.\"`)]);
    }
    default: return stay(s);
  }
}

function talkHeir(s: SuccessionState, who: Who, result: string, paid: number): Reduction<SuccessionState> {
  const kind = who === "elder" ? "claimant_elder" : "claimant_younger";
  const other: Who = who === "elder" ? "younger" : "elder";
  if (result === "open") {
    if (s.parley || s.hostile || s.down[who]) return stay(s);
    if (s.heir[who] === "pledged") return { s, fx: [say(`${NAME[who]} has your money and your word, and is practising the wave.`)] };
    return { s: fin({ ...s, parley: kind }), fx: [{ k: "parley", kind, price: s.price[who] }] };
  }
  if (s.parley !== kind) return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "hostile": return raise({ ...s, parley: undefined }, `${NAME[who]} understands the threat, and so does the court. The guards come running, as if they had practised.`, true);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, [who]: true } }));
    case "survey": {
      // a regency: three signatures, so the other heir must not already be your pledge
      if (s.heir[other] === "pledged") return { s: fin({ ...s, parley: undefined }), fx: [say(`\"A regency?\" ${NAME[who]} laughs. \"You already paid ${NAME[other]}. I will not be the second choice in a first-class plot.\"`)] };
      return settle(fin({ ...s, parley: undefined, heir: { ...s.heir, [who]: "regency" } }), [say(`${NAME[who]} signs for a regency, looking like someone who has agreed to share a wardrobe. That is one of three signatures.`)]);
    }
    case "paid": {
      if (s.heir[who] === "pledged" || !paidOk(s, paid, s.price[who])) return stay(fin({ ...s, parley: undefined }));
      if (s.heir[other] === "pledged") return { s: fin({ ...s, parley: undefined }), fx: [say(`${NAME[who]} sees the receipt in ${NAME[other]}'s hand. \"You have already bought one heir,\" ${who === "elder" ? "she" : "he"} says. \"I will not be the second.\"`)] };
      const n = fin({ ...s, parley: undefined, spent: s.spent + paid, paid: s.paid + paid, heir: { ...s.heir, [who]: "pledged", [other]: s.heir[other] === "regency" ? "none" : s.heir[other] } });
      return settle(n, [say(`£${paid} changes hands, and ${NAME[who]} is yours: ${who === "elder" ? "\"by Seniority, as I will often say\"" : "\"by Acclamation, to be arranged\""}. ${s.heir[other] === "regency" ? `${NAME[other]}'s signature for a regency is now worth nothing.` : "The Chamberlain adds a footnote."}`)]);
    }
    default: return stay(s);
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: SuccessionState): ReturnType<TemplateDef<SuccessionState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  if (s.cheque === "taken") return "crown_sold";
  const nothing = tallyEmpty(s.tally) && !s.hostile && !s.parley && s.form === "none" && s.heir.elder === "none" && s.heir.younger === "none" && s.fed === 0 && s.cheque === "none" && s.paid === 0;
  return nothing ? undefined : "abandoned";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const HINT: Record<string, string> = {
  approach: "Highmark's court sits at the top of five terraces, up a long winding road. The King has been 'pending' for six years, so the chair is empty. Walk up to the Chamberlain's Window.",
  waiting: "To seat a ruler: get Form 11 filed, back one heir (or both, for a regency), and give two of the three delegates a barrel of grain. Barrels are at the quay and the drovers' camp.",
  parley: "They are listening. Mind what you promise: the court writes everything down.",
  fighting: "The guards are fighting. Beat them and the chair is yours to fill, with a lot of explaining after.",
  tension: "The harvest bell has rung. The Assembly votes for whatever you have set up. If nothing is set up, the Syndicate buys the chair soon.",
};
const DONE: Record<string, string> = {
  backed_elder: "Princess Orla takes the chair, by Seniority and two votes. She has already asked to see the receipts. Take the boat home from the Reed Landing.",
  backed_younger: "Prince Dunstan takes the chair, by Acclamation, two votes and a band he did not pay for. Take the boat home from the landing.",
  regency: "A regency: three signatures and an empty chair. Highmark calls this stability. Take the boat home from the landing.",
  usurped: "Someone is in the chair, and the court is learning to call it an early succession. Take the boat home before it learns anything else.",
  crown_sold: "The Syndicate has the Crown's trade rights, signed and stamped. The chair is now a very expensive hat stand. Take the boat home from the landing.",
  abandoned: "The expedition is down. The King is still 'pending'. Take the boat home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  rain: "Rain is coming and the reapers want the barley in: the bell will ring early.",
  fog: "Fog on the terraces: the Assembly is lost on the granary level, so the bell will ring late.",
  outriders: "Syndicate riders came ahead with the cheque: the envoy will not wait long.",
};

function view(s: SuccessionState, now: number): ScenarioView {
  const res = s.resolution;
  const sold = res === "crown_sold" && s.cheque === "taken";
  const won = res !== undefined && res !== "abandoned" && (res !== "crown_sold" || sold);
  const v3 = votes(s);
  const objectives: ObjectiveView[] = [
    { id: "court", text: "Climb the Processional Road to the court", done: s.near.court > 0 || s.phase !== "approach" },
    { id: "form", text: s.form === "pending" ? "Form 11 is with the Stamp" : "Get the Chamberlain to file Form 11 (or pay to hurry it)", done: formOk(s), optional: true },
    { id: "heir", text: s.heir.elder === "regency" && s.heir.younger === "regency" ? "A regency: three signatures" : s.heir.elder === "pledged" ? "Princess Orla is promised the chair" : s.heir.younger === "pledged" ? "Prince Dunstan is promised the chair" : "Back an heir, or talk both heirs into a regency", done: s.heir.elder === "pledged" || s.heir.younger === "pledged" || (s.heir.elder === "regency" && s.heir.younger === "regency"), optional: true },
    { id: "grange", text: `Give the delegates a barrel of grain each (${Math.min(v3, SUCCESSION.votesToRatify)} of ${SUCCESSION.votesToRatify} needed)`, done: v3 >= SUCCESSION.votesToRatify, optional: true },
    { id: "chair", text: res === "abandoned" ? "Lost: the expedition went down" : res === "crown_sold" ? (sold ? "Settled: you sold the chair to the Syndicate" : "Lost: nothing was settled, so the Syndicate bought the chair") : "Have the court seat a ruler when the harvest bell rings", done: won },
  ];
  if (s.cheque !== "none") objectives.push({ id: "cheque", text: s.cheque === "taken" ? "The Syndicate's cheque is in your pocket" : "Take the envoy's cheque (with Form 11, it sells the chair)", done: s.cheque === "taken", optional: true });
  if (s.hostile && res === undefined) objectives.push({ id: "break", text: `Drop the court guard or send them running (${Math.min(Math.ceil(s.guards.total * SUCCESSION.brokenFraction), broken(s))} of ${Math.ceil(s.guards.total * SUCCESSION.brokenFraction)})`, done: guardBroken(s), optional: true });
  if (s.hostile && guardBroken(s) && res === undefined) objectives.push({ id: "sit", text: "Sit somebody in the Vacant Chair (Use)", done: false, optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the Reed Landing", done: false });

  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  if (res === undefined && s.asked.chamberlain) hint += " (The Chamberlain's order of importance: herself, the heirs by age, the Assembly, then Anyone Else.)";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remain = res !== undefined ? 0 : !s.bellRung ? s.bell - s.t : s.bell + s.grace - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(!s.bellRung ? "The harvest bell" : "The Syndicate buys the chair", remain, now), template: "succession_dispute", title: "The Vacant Chair", ...ruleWhile("succession_dispute", res === undefined && !s.hostile) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: SuccessionState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  const o: ScenarioOutcome = {
    scenario: "succession_dispute", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
    complication: s.complication, region: "highmark",
  };
  if (s.loot > 0) o.loot = s.loot;
  return o;
}

// ---- the people -------------------------------------------------------------------------------------------------------------------------------

const GUARD_NAMES = ["Halberdier Wimple Oakes", "Halberdier Brisa Tanner", "Staff-Sergeant Gideon Marl", "Halberdier Odo Fenwick-Lowe"] as const;
const GUARD_ARMS: readonly WeaponId[] = [WEAPON.SABRE, WEAPON.SABRE, WEAPON.RIFLE, WEAPON.PISTOL];
const DELEGATES = ["Delegate Bram Oatley (one scythe)", "Delegate Marl Hayward (one scythe)", "Delegate Tilly Garner (one scythe)"] as const;
const DROVERS = ["Drover Pim Cattermole", "Drover Anselm Ruck"] as const;

function roster(_c: CampaignState, seed: number, _s: SuccessionState): NpcSpec[] {
  const S = HIGHMARK_SITES;
  const out: NpcSpec[] = [];
  const mk = (id: string, role: number, faction: NpcSpec["faction"], group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction, side: role === NPC.RIVAL_SURVEYOR ? "rival" : role === NPC.CLAIMANT || role === NPC.HERDER ? "neutral" : "ward", group, post: { x: post.x, z: post.z }, weapon,
    lookSeed: hash3(seed >>> 0, i, role), name, skill, bravery, brain,
  });
  out.push(mk("chamberlain", NPC.CHAMBERLAIN, "ward", "court", S.chamberlain, WEAPON.FISTS, "Lord Chamberlain Ottoline Fenwick-Vane", 10, 70, "civil", 0));
  out.push(mk("claimant-elder", NPC.CLAIMANT, "ward", "claimants", S.claimants.elder, WEAPON.FISTS, "Princess Orla, by Seniority", 10, 40, "civil", 1));
  out.push(mk("claimant-younger", NPC.CLAIMANT, "ward", "claimants", S.claimants.younger, WEAPON.FISTS, "Prince Dunstan, by Acclamation", 10, 30, "civil", 2));
  S.grange.forEach((p, i) => out.push(mk(`grange-${i}`, NPC.HERDER, "ward", "grange", p, WEAPON.FISTS, DELEGATES[i]!, 12, 55, "civil", 3 + i)));
  out.push(mk("envoy", NPC.RIVAL_SURVEYOR, "rival", "envoy", S.envoy, WEAPON.FISTS, "Envoy Cosmo Dunmarrow-Pell", 10, 25, "civil", 6));
  S.guards.forEach((p, i) => out.push(mk(`guard-${i}`, NPC.COURT_GUARD, "ward", "guards", p, GUARD_ARMS[i]!, GUARD_NAMES[i]!, 38 + (hash3(seed >>> 0, i, 0x5a2) % 14), 40 + (hash3(seed >>> 0, i, 0xb6) % 20), "garrison", 7 + i)));
  out.push(mk("drover-0", NPC.HERDER, "ward", "drovers", { x: S.drovers.x + 1.4, z: S.drovers.z + 0.6 }, WEAPON.FISTS, DROVERS[0], 10, 40, "civil", 11));
  out.push(mk("drover-1", NPC.HERDER, "ward", "drovers", { x: S.drovers.x - 1.2, z: S.drovers.z - 1.0 }, WEAPON.FISTS, DROVERS[1], 10, 40, "civil", 12));
  return out;
}

const SD = HIGHMARK_SITES;
const THRONE = (): { x: number; z: number } => ({ x: highmarkPlan().throne.x, z: highmarkPlan().throne.z + highmarkPlan().throne.hz + 0.9 });
const observe: ObserveSpec = {
  near: [{ id: "court", x: HIGHMARK_ANCHORS.capital.court.x, z: HIGHMARK_ANCHORS.capital.court.z, r: SUCCESSION.courtR }],
  use: [
    { id: "chamberlain", npc: "chamberlain", r: SUCCESSION.personR, talk: "chamberlain", carry: "none" },
    { id: "elder", npc: "claimant-elder", r: SUCCESSION.personR, talk: "claimant_elder", carry: "none" },
    { id: "younger", npc: "claimant-younger", r: SUCCESSION.personR, talk: "claimant_younger", carry: "none" },
    { id: "grange0", npc: "grange-0", r: SUCCESSION.personR, carry: "barrel", consume: true },
    { id: "grange1", npc: "grange-1", r: SUCCESSION.personR, carry: "barrel", consume: true },
    { id: "grange2", npc: "grange-2", r: SUCCESSION.personR, carry: "barrel", consume: true },
    { id: "envoy", npc: "envoy", r: SUCCESSION.personR, carry: "none" },
    { id: "throne", at: THRONE(), r: SUCCESSION.throneR, carry: "none" },
  ],
  count: [{ group: "guards", routed: "garrisonRouted" }],
  seen: [],
  actors: [{ id: "chamberlain" }, { id: "claimant-elder" }, { id: "claimant-younger" }, { id: "grange-0" }, { id: "grange-1" }, { id: "grange-2" }, { id: "envoy" }],
  hostileGroups: ["guards", "court", "claimants"],
};
void SD;

export const successionTemplate: TemplateDef<SuccessionState> = {
  id: "succession_dispute", title: "The Vacant Chair",
  noPowderStore: true, // (D-084: see the template type)
  brief: "Highmark's King has been 'pending' for six years. Princess Orla, Prince Dunstan and a Syndicate cheque want the empty chair. Back an heir, arrange a regency, take the cheque, or use force.",
  init, reduce, view, outcome, roster, leave, observe,
  sites: { throne: THRONE(), court: HIGHMARK_ANCHORS.capital.court },
};
