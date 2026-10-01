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
      say(`The Chamberlain's seal comes down on the cheque with a thump that echoes in several offices. £${s.price.cheque} is yours; the Crown's concession is the Syndicate's; the chair is, by a majority of one cheque, sold. \"Subject to contract,\" says the envoy, who has already printed the contract.`),
    ]);
  }
  // the Assembly votes at the bell (or at once if it is already ringing and the court is ready)
  if (s.bellRung && formOk(s) && votes(s) >= SUCCESSION.votesToRatify) {
    const { elder: e, younger: y } = s.heir;
    if (e === "pledged" && y !== "pledged") return resolveWith(s, "backed_elder", {}, [...said, { k: "order", group: "guards", order: { o: "stand_down" } }, say("The Assembly votes by a show of hands, which is also how it harvests. Princess Orla is seated, by Seniority, to the rattle of three scythes laid carefully on the floor. Prince Dunstan applauds, which is what he does.")]);
    if (y === "pledged" && e !== "pledged") return resolveWith(s, "backed_younger", {}, [...said, { k: "order", group: "guards", order: { o: "stand_down" } }, say("The Assembly votes, and the vote is carried by acclamation, which is not a number but is nonetheless loud. Prince Dunstan takes the chair. Princess Orla notes, in writing, that she is the elder.")]);
    if (e === "regency" && y === "regency") return resolveWith(s, "regency", {}, [...said, { k: "order", group: "guards", order: { o: "stand_down" } }, say("Three signatures on one sheet, in three inks: the Chamberlain's, the Princess's and the Prince's. The Assembly ratifies a regency, the King remains pending, and the chair is left empty in a way that everybody can now describe as stable.")]);
    if (e === "pledged" && y === "pledged" && !s.deadlocked) {
      return { s: fin({ ...s, deadlocked: true }), fx: [...said, say("The Assembly has been pledged TWO heirs by one party, and it has votes for neither. \"A scythe,\" says the senior delegate, \"is for cutting one thing at a time.\" The Chamberlain makes a note.")] };
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
        fx.push(say("The harvest bell tolls over Highmark, once for each year the King has been pending, and then stops because it has run out of rope. The Reapers' Assembly takes its seats, in the straw-hatted order of precedence."));
      }
      // the Syndicate's cheque is cashed without you, unless the court is busy fighting itself
      if (n.bellRung && n.t >= n.bell + n.grace && (!n.hostile || guardBroken(n))) {
        const r = resolveWith(n, "crown_sold", {}, [...fx, say("Nobody settled anything, so the Chamberlain does what the court does when nobody settles anything: it takes the best offer on the table, which has been on the table for some time. The envoy's cheque is cashed, the concession is signed, and the Crown keeps the hat.")]);
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
      if (!was && n.hostile && guardBroken(n)) return { s: n, fx: [say("The court's guard is broken, which in Highmark means somebody has finally been in the room when it mattered. The chair is, in the narrowest sense, unguarded.")] };
      return stay(n);
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "guards" && e.at !== "court" && e.at !== "claimants") return stay(s);
      return raise({ ...s }, "Blood in the court. The guards, who have waited six years for the King to be pending about something, are delighted.", s.parley !== undefined || formOk(s) || s.heir.elder !== "none" || s.heir.younger !== "none");
    }
    case "actor": {
      const id = e.id;
      if (e.state !== "down") return stay(s);
      if (id === "chamberlain" && !s.down.chamberlain) {
        const r = raise({ ...s, down: { ...s.down, chamberlain: true } }, "The Lord Chamberlain is down. Every form in Highmark is, as of this moment, in abeyance, and the guards know whom to blame.");
        return settle(r.s, r.fx as ScenarioFx[]);
      }
      if ((id === "claimant-elder" || id === "claimant-younger") && !s.down[id === "claimant-elder" ? "elder" : "younger"]) {
        const who: Who = id === "claimant-elder" ? "elder" : "younger";
        const r = raise({ ...s, down: { ...s.down, [who]: true }, heir: { ...s.heir, [who]: "none" } }, `${NAME[who]} is down, and the court discovers it has strong opinions about heirs after all. The Grange has stopped looking at its scythes and started counting them.`);
        return settle(r.s, r.fx as ScenarioFx[]);
      }
      if (id === "envoy" && !s.down.envoy) return stay(fin({ ...s, down: { ...s.down, envoy: true }, cheque: s.cheque === "taken" ? "taken" : "none" }));
      const m = /^grange-([0-2])$/.exec(id);
      if (m) {
        const bit = 1 << Number(m[1]);
        if ((s.downD & bit) !== 0) return stay(s);
        return settle(fin({ ...s, downD: s.downD | bit }), [say("A Reapers' delegate is down. The Assembly's remaining members rise, as one, and sit again, as one, which is how a strike looks from the outside.")]);
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
    return resolveWith(s, "usurped", {}, [{ k: "order", group: "guards", order: { o: "stand_down" } }, say("Somebody sits in the chair. The Chamberlain, from the floor, observes that this is not the proper form. Nobody who is still standing disagrees with the chair. The court has a new occupant; the Society reports that the furniture was found in that condition.")]);
  }
  if (s.hostile) return { s, fx: [say("Several hands lift you out of the chair. The guard, still standing, has opinions about it, and you are not the only one with a sabre.")] };
  // sitting in it with the guard standing is a declaration
  const r = raise({ ...s, sat: true }, "You sit in the Vacant Chair. There is a silence of the kind that gets minuted. \"Madam,\" says the Chamberlain, \"that is not on the form.\" The guard has never had a more interesting afternoon.", true);
  return r;
}

function useEnvoy(s: SuccessionState): Reduction<SuccessionState> {
  if (s.down.envoy) return stay(s);
  if (s.cheque === "none") {
    return { s: fin({ ...s, cheque: "offered" }), fx: [say(`The Syndicate's envoy produces a cheque for £${s.price.cheque} against the Crown's concession, and a pen. \"A signature here,\" he says, \"or, failing that, anywhere. The Chamberlain has agreed to countersign anything on a form. Do come again if you would like to take it.\"`)] };
  }
  if (s.cheque === "taken") return { s, fx: [say("The cheque is already in your pocket. The envoy is not a charity: he is waiting, politely, for a countersignature.")] };
  // taking it: the heirs' money is wasted and the Syndicate's is not
  const bp = s.heir.elder === "pledged" || s.heir.younger === "pledged";
  const r = settle(fin({ ...s, cheque: "taken", brokePromise: s.brokePromise || bp }), [say(formOk(s)
    ? "You take the cheque. The envoy, who has not stopped smiling since the fourth quarter of last year, hands over a second copy for the Society's files."
    : "You take the cheque. \"It needs the Chamberlain's seal,\" says the envoy. \"Everything does. Be a good citizen and have the form seen to.\"")]);
  return r;
}

function useGrange(s: SuccessionState, i: number): Reduction<SuccessionState> {
  const bit = 1 << i;
  if ((s.downD & bit) !== 0 || (s.fed & bit) !== 0) return stay(s);
  let n: SuccessionState = fin({ ...s, fed: s.fed | bit });
  const fx: ScenarioFx[] = [say(votes(n) >= SUCCESSION.votesToRatify
    ? "The delegate weighs the barrel, taps it, listens to it, and passes it down the bench. That is two scythes, and in the Assembly two scythes are a majority. He has noted the weight, in writing."
    : "The delegate weighs the barrel, taps it, listens to it and writes the weight down. \"Fair,\" he says, which from a farmer is a speech. That is one vote in the barley.")];
  // an Assembly that has been fed is an Assembly in a hurry: the bell is rung early (never later than it was going to be)
  if (!n.bellRung && votes(n) >= present(n) && votes(n) >= SUCCESSION.votesToRatify) {
    const at = n.t + SUCCESSION.fedBellS;
    if (at < n.bell) {
      n = { ...n, bell: Math.round(at) };
      fx.push(say("Every delegate present has had his grain. The Assembly, being fed, grows impatient with procedure and sends a boy up the tower with instructions to ring the bell early."));
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
    case "hostile": return raise({ ...s, parley: undefined }, "You have made your point to the Lord Chamberlain, with a raised voice and a lowered weapon. The court's guards unfold.", true);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, chamberlain: true } }));
    case "survey": {
      // file Form 11: the stamp takes its time
      if (s.form !== "none") return stay(fin({ ...s, parley: undefined }));
      return { s: fin({ ...s, parley: undefined, form: "pending", formAt: s.t + SUCCESSION.formS }), fx: [say(`Form 11 is filed, in triplicate, at the Window. \"The Stamp will see it,\" says the Chamberlain, \"in forty-five seconds, which is what we call prompt.\"`)] };
    }
    case "paid": {
      if (s.form !== "none" || !paidOk(s, paid, s.price.bribe)) return stay(fin({ ...s, parley: undefined }));
      const n = fin({ ...s, parley: undefined, form: "bribed", spent: s.spent + paid, paid: s.paid + paid });
      return settle(n, [say(`An envelope, £${paid} thick, changes hands under the counter of the Window, which is a counter of a very respectable thickness. \"Form 11,\" says the Chamberlain, stamping it twice, \"is hereby in order, retroactively.\"`)]);
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
    case "hostile": return raise({ ...s, parley: undefined }, `${NAME[who]} takes your meaning, and the court takes it with her. The guards unfold with a speed that suggests rehearsal.`, true);
    case "learn": return stay(fin({ ...s, asked: { ...s.asked, [who]: true } }));
    case "survey": {
      // a regency: three signatures, so the other heir must not already be your pledge
      if (s.heir[other] === "pledged") return { s: fin({ ...s, parley: undefined }), fx: [say(`\"A regency?\" ${NAME[who]} laughs. \"You have already taken ${NAME[other]}'s money. I will not be the second option in a first-class conspiracy.\"`)] };
      return settle(fin({ ...s, parley: undefined, heir: { ...s.heir, [who]: "regency" } }), [say(`${NAME[who]} signs for a regency, with a flourish and the expression of someone who has agreed to share a wardrobe. One of three signatures.`)]);
    }
    case "paid": {
      if (s.heir[who] === "pledged" || !paidOk(s, paid, s.price[who])) return stay(fin({ ...s, parley: undefined }));
      if (s.heir[other] === "pledged") return { s: fin({ ...s, parley: undefined }), fx: [say(`${NAME[who]} looks at the receipt in ${NAME[other]}'s hand, then at yours. \"I will not be bought twice over,\" ${who === "elder" ? "she" : "he"} says. \"Have the money back off the other one, if you like. I know how that goes.\"`)] };
      const n = fin({ ...s, parley: undefined, spent: s.spent + paid, paid: s.paid + paid, heir: { ...s.heir, [who]: "pledged", [other]: s.heir[other] === "regency" ? "none" : s.heir[other] } });
      return settle(n, [say(`£${paid} changes hands, and ${NAME[who]} is yours: ${who === "elder" ? "\"by Seniority, which I shall remember to mention\"" : "\"by Acclamation, which will be arranged\""}. ${s.heir[other] === "regency" ? `${NAME[other]}, who had signed for a regency, says that was before and this is now.` : "The Chamberlain adds a footnote."}`)]);
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
  approach: "Highmark's court sits at the top of five terraces, up a switchback road that exists to give petitioners time to reconsider. The King has been pending for six years; the chair is vacant in a procedural sense. Walk up to the Chamberlain's Window.",
  waiting: "The court is open and the chair is not. Four things move it: the Chamberlain's Form 11, each heir's price (or a regency), a barrel of grain for each of the Reapers' three delegates, and the Syndicate envoy's cheque. The Assembly votes at the harvest bell.",
  parley: "They are listening. Mind what you promise; the court minutes everything, and the minutes outlive both heirs.",
  fighting: "The guard has been drawn. Break it, and then there is only the chair, and a great deal of explaining.",
  tension: "The harvest bell has rung. The Assembly will ratify whatever it has been persuaded of; if it has been persuaded of nothing, the Syndicate's cheque will be cashed by default.",
};
const DONE: Record<string, string> = {
  backed_elder: "Princess Orla sits the chair, by Seniority and by two scythes. Sail home from the Reed Landing.",
  backed_younger: "Prince Dunstan sits the chair, by Acclamation, and by two scythes and some applause. Sail home from the landing.",
  regency: "A regency: three signatures and a chair nobody sits in, which is what stability looks like. Sail home from the landing.",
  usurped: "The chair has an occupant, and the court is learning to describe it as an early succession. Sail home from the landing.",
  crown_sold: "The Crown's concession is the Syndicate's, countersigned and stamped. The chair is a very expensive hat stand. Sail home from the landing.",
  abandoned: "The expedition is down. The King is, as ever, pending. Sail home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  rain: "Rain is coming, and the Grange wants the barley in: the bell will ring early.",
  fog: "Fog on the terraces: the Assembly is lost somewhere on the granary level and the bell will ring late.",
  outriders: "Syndicate outriders have ridden ahead with the cheque: the envoy's patience is short.",
};

function view(s: SuccessionState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res !== undefined && res !== "abandoned";
  const v3 = votes(s);
  const objectives: ObjectiveView[] = [
    { id: "court", text: "Climb the Processional Road to the court", done: s.near.court > 0 || s.phase !== "approach" },
    { id: "form", text: s.form === "pending" ? "Form 11 is with the Stamp" : "Get the Chamberlain's Form 11 in order (filed, or expedited)", done: formOk(s), optional: true },
    { id: "heir", text: s.heir.elder === "regency" && s.heir.younger === "regency" ? "A regency: three signatures" : s.heir.elder === "pledged" ? "Princess Orla is pledged the chair" : s.heir.younger === "pledged" ? "Prince Dunstan is pledged the chair" : "Back an heir, or broker a regency (both heirs)", done: s.heir.elder === "pledged" || s.heir.younger === "pledged" || (s.heir.elder === "regency" && s.heir.younger === "regency"), optional: true },
    { id: "grange", text: `Win the Grange: a barrel of grain for each delegate (${Math.min(v3, 3)} of ${Math.max(SUCCESSION.votesToRatify, present(s))})`, done: v3 >= SUCCESSION.votesToRatify, optional: true },
    { id: "chair", text: res === "abandoned" ? "Lost: the expedition went down" : res === "crown_sold" ? "Settled: the Crown was sold" : "Settle the chair, by whatever means", done: won },
  ];
  if (s.cheque !== "none") objectives.push({ id: "cheque", text: s.cheque === "taken" ? "The Syndicate's cheque is in your pocket" : "Decide about the Syndicate's cheque", done: s.cheque === "taken", optional: true });
  if (s.hostile && res === undefined) objectives.push({ id: "break", text: `Break the court guard (${Math.min(Math.ceil(s.guards.total * SUCCESSION.brokenFraction), broken(s))} of ${Math.ceil(s.guards.total * SUCCESSION.brokenFraction)})`, done: guardBroken(s), optional: true });
  if (s.hostile && guardBroken(s) && res === undefined) objectives.push({ id: "sit", text: "Sit somebody in the Vacant Chair (INTERACT)", done: false, optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Sail home from the Reed Landing", done: false });

  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  if (res === undefined && s.asked.chamberlain) hint += " (The Chamberlain's order of precedence: herself, then the heirs by seniority, then the Assembly, then Anyone Else.)";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remain = res !== undefined ? 0 : !s.bellRung ? s.bell - s.t : s.bell + s.grace - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(!s.bellRung ? "The harvest bell" : "The Syndicate buys the chair", remain, now), template: "succession_dispute", title: "The Vacant Chair" };
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
  brief: "The King of Highmark has been pending for six years and two heirs have opinions about the chair. Back one, broker a regency, sit somebody down by force, or watch a cheque do it for you; the Reapers' Assembly ratifies at the harvest bell.",
  init, reduce, view, outcome, roster, leave, observe,
  sites: { throne: THRONE(), court: HIGHMARK_ANCHORS.capital.court },
};
