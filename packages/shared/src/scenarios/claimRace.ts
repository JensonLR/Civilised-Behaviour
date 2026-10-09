import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { clamp } from "../math.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { VESPER_ANCHORS, VESPER_SITES } from "../vesper.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";
import { ruleWhile } from "./terms.ts";

/**
 * VESPER GORGE "The Claim Race" (D-037, package C3; docs/_notes/regions34.md section 3, docs/_notes/vesper.md). A seam of something expensive has been found on the pegging ground, and the Syndicate's
 * surveyors (two, with a theodolite and a brochure) are PHYSICALLY there, with four guards at the headframe a minute's walk away. A claim is four pegs and a filing at the Assay House; the clerk files
 * whoever arrives first with the form.
 *
 * The party decides nothing from a menu. It leans on four pressures and the ending is whatever they add up to:
 *  - the PEGS (INTERACT at a peg, hands empty): an open peg is the party's. The Syndicate pegs the lowest open corner at PEG_FIRST_S and every PEG_EVERY_S after, for as long as a surveyor of theirs is
 *    standing; a Syndicate peg can be pulled only once the surveyors are broken (shot, or driven off) or the clerk has marked their survey provisional.
 *  - the CLERK (parley `assayer`): pay the filing fee to FILE (three pegs, and no peg of the Syndicate's standing), propose a JOINT claim (both sides hold a peg, nobody has fired a shot; the Guild
 *    certifies), ask what the Syndicate filed (`learn`), tell him the Syndicate's survey is unsound (`tell`, once you know why: the clerk stamps it PROVISIONAL, its pegs may be pulled by hand and the
 *    Syndicate cannot file).
 *  - the SYNDICATE'S CLOCK: three pegs and PEG_FILE_S later the Syndicate files; the Assay House closes at CLOSE_S and registers the brochure by default.
 *  - FORCE: a shot at a surveyor or a guard is a declaration; the surveyors run, the guards come down the road.
 * Endings (first wins, then the state is frozen):
 *  `staked`: three pegs and no Syndicate peg, filed. `jumped`: filed with three pegs after Syndicate pegs were pulled (by force or because the clerk had marked their survey provisional).
 *  `partnered`: a joint claim, one peg each at least, with the peace kept. `outpaced`: the Syndicate files first, or the House closes first, or the party sails away from an unfinished race.
 *  `abandoned`: the party is down. Leaving commits what happened (`leave`).
 * Complications (existing ids only): rival scouts have been out since dawn (the first Syndicate peg is early), outriders carry the Syndicate's form (it files sooner).
 */

export const CLAIM = {
  /** The Syndicate's first peg (+ a seeded 0..pegSpread), then one every `pegEvery` while a surveyor stands. */
  pegFirst: 80, pegSpread: 20, pegEvery: 55, scoutsFirst: -30,
  /** After the Syndicate holds three pegs it files this much later; the House closes at `closeS` and registers the Syndicate's brochure by default. */
  pegFile: 35, outridersFile: -15, closeS: 330,
  /** Reach of INTERACT at a peg and at a person; how near the pegging ground counts as "there". */
  pegR: 2.4, personR: 2.4, nearR: 16,
  /** Pegs a claim needs. */
  need: 3,
  priceFee: [30, 60],
} as const;

type Owner = 0 | 1 | 2;
const CORNERS = ["north-west", "north-east", "south-east", "south-west"] as const;

export interface ClaimState extends BaseState {
  complication: ComplicationId; rain: number;
  near: { ground: number };
  /** Each peg: 0 open, 1 the party's, 2 the Syndicate's. */
  pegs: Owner[];
  rivalAt: number; rivalFilesAt: number; closeAt: number; pegFile: number;
  pulled: number; fraud: boolean; asked: boolean;
  hostile: boolean; clerkDown: boolean;
  surveyors: { alive: number; down: number; routed: number; total: number };
  guards: { alive: number; down: number; routed: number; total: number };
  price: { fee: number };
  purse: number; spent: number; paid: number;
  tally: CasualtyTally; brokePromise: boolean;
}

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): ClaimState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "claim_race", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x7a30 + k);
  const first = CLAIM.pegFirst + (h(1) % (CLAIM.pegSpread + 1)) + (complication === "rival_scouts" ? CLAIM.scoutsFirst : 0) + (presence?.goal === "sabotage_party" ? -10 : 0);
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, rain: 0, near: { ground: 0 },
    pegs: [0, 0, 0, 0], rivalAt: first, rivalFilesAt: 0, closeAt: CLAIM.closeS, pegFile: CLAIM.pegFile + (complication === "outriders" ? CLAIM.outridersFile : 0),
    pulled: 0, fraud: false, asked: false, hostile: false, clerkDown: false,
    surveyors: { alive: 2, down: 0, routed: 0, total: 2 }, guards: { alive: 4, down: 0, routed: 0, total: 4 },
    price: { fee: CLAIM.priceFee[0] + 5 * (h(2) % Math.floor((CLAIM.priceFee[1] - CLAIM.priceFee[0]) / 5 + 1)) },
    purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -------------------------------------------------------------------------------------------------------------------------

const count = (s: ClaimState, who: Owner): number => s.pegs.filter((p) => p === who).length;
const broken = (s: ClaimState): boolean => s.surveyors.total > 0 && s.surveyors.alive === 0;
const affordable = (s: ClaimState, n: number): boolean => n >= 0 && n <= s.purse - s.spent;
const paidOk = (s: ClaimState, paid: number, price: number): boolean => Number.isFinite(paid) && paid >= Math.round(price * 0.75) && paid <= Math.round(price * 1.25) && affordable(s, paid);
const phaseOf = (s: ClaimState): ClaimState["phase"] => (s.parley ? "parley" : s.hostile ? "fighting" : s.near.ground > 0 ? "waiting" : "approach");
const fin = (s: ClaimState): ClaimState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const NAME = (i: number): string => CORNERS[i] ?? "far";

/** A shot at the Syndicate's people: the surveyors run, the guards come. The clerk, a professional, goes on stamping. First cause wins. */
function raise(s: ClaimState, why: string, brokePromise = false): Reduction<ClaimState> {
  const bp = s.brokePromise || brokePromise;
  if (s.hostile) return { s: fin({ ...s, brokePromise: bp }), fx: [] };
  const fx: ScenarioFx[] = [{ k: "order", group: "guards", order: { o: "alert" } }, { k: "order", group: "surveyors", order: { o: "flee" } }, say(why)];
  return { s: fin({ ...s, hostile: true, parley: undefined, brokePromise: bp }), fx };
}

// ---- the reducer -----------------------------------------------------------------------------------------------------------------------------

function reduce(s: ClaimState, e: ScenarioInput): Reduction<ClaimState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const dt = dtOf(e);
      let n: ClaimState = { ...s, t: s.t + dt };
      const fx: ScenarioFx[] = [];
      // the Syndicate's surveyors drive a peg while one of them stands
      if (n.t >= n.rivalAt) {
        const i = n.pegs.indexOf(0);
        if (i >= 0 && !broken(n)) {
          const pegs = n.pegs.slice();
          pegs[i] = 2;
          n = { ...n, pegs, rivalAt: n.t + CLAIM.pegEvery };
          fx.push(say(`A Syndicate surveyor drives a peg at the ${NAME(i)} corner with an engraved mallet. He waves a brochure saying the claim is already theirs.`));
        } else n = { ...n, rivalAt: n.t + CLAIM.pegEvery };
      }
      // three pegs and they file; the clerk has marked their survey provisional, they cannot
      if (n.rivalFilesAt === 0 && count(n, 2) >= CLAIM.need && !n.fraud) n = { ...n, rivalFilesAt: n.t + n.pegFile };
      if (n.rivalFilesAt > 0 && n.fraud) n = { ...n, rivalFilesAt: 0 };
      if (n.rivalFilesAt > 0 && n.t >= n.rivalFilesAt) {
        return resolveWith(n, "outpaced", {}, [...fx, say("The Syndicate files its claim at the Assay House, in a binder so thick it has a ribbon. The clerk stamps it. The Society's notes are added as an appendix.")]);
      }
      if (n.t >= n.closeAt) {
        return resolveWith(n, "outpaced", {}, [...fx, say("The Assay House bell rings and the shutters come down. By house rules, the claim goes to whoever's brochure is on the counter: the Syndicate's. The clerk apologises, in writing.")]);
      }
      return { s: fin(n), fx };
    }
    case "weather": return stay(fin({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 }));
    case "near": {
      if (e.at !== "ground") return stay(s);
      const n = int(e.party, 0, 8, 0);
      return s.near.ground === n ? stay(s) : stay(fin({ ...s, near: { ground: n } }));
    }
    case "count": {
      if (e.group !== "surveyors" && e.group !== "guards") return stay(s);
      const total = int(e.total, 0, 4, e.group === "guards" ? s.guards.total : s.surveyors.total);
      const alive = int(e.alive, 0, total), routed = int(e.routed, 0, total - alive), down = int(e.down, 0, total - alive - routed);
      return stay(fin(e.group === "guards" ? { ...s, guards: { alive, routed, down, total } } : { ...s, surveyors: { alive, routed, down, total } }));
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "surveyors" && e.at !== "guards") return stay(s);
      return raise(s, "A shot, and the pegging ground is a different place. The Syndicate's surveyors drop the chain and run; four guards at the headframe put their cups down and start down the road.", s.parley !== undefined || s.paid > 0);
    }
    case "actor": {
      if (e.state !== "down") return stay(s);
      if (e.id === "assayer" && !s.clerkDown) return stay(fin({ ...s, clerkDown: true, parley: s.parley === "assayer" ? undefined : s.parley }));
      return stay(s);
    }
    case "use": {
      const m = /^peg([0-3])$/.exec(e.target);
      return m ? usePeg(s, Number(m[1])) : stay(s);
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

function usePeg(s: ClaimState, i: number): Reduction<ClaimState> {
  const who = s.pegs[i];
  const set = (v: Owner): Owner[] => s.pegs.map((p, k) => (k === i ? v : p));
  if (who === 0) {
    const n = fin({ ...s, pegs: set(1) });
    const k = count(n, 1);
    return { s: n, fx: [say(`The ${NAME(i)} peg is yours (${k <= CLAIM.need ? `${k} of ${CLAIM.need}` : `${k} pegs; ${CLAIM.need} were needed, and the law admires thoroughness`}). It is a stick with a rag on it, which is what the law calls a boundary.`)] };
  }
  if (who === 1) return { s, fx: [say(`The ${NAME(i)} peg is already yours. Staking it twice does not make it twicer.`)] };
  // the Syndicate's peg: it comes out only once their people are broken or the clerk has marked their survey provisional
  if (broken(s) || s.fraud) {
    const n = fin({ ...s, pegs: set(0), pulled: s.pulled + 1 });
    return { s: n, fx: [say(s.fraud && !broken(s)
      ? `The Syndicate's ${NAME(i)} peg comes out of the ground as easily as a rumour: the survey it marks is PROVISIONAL, in red, on the clerk's own authority.`
      : `You pull the Syndicate's ${NAME(i)} peg. Nobody stops you. A brochure falls out of the hole, which is the first thing that has been in it.`)] };
  }
  return { s, fx: [say("A Syndicate surveyor puts a hand flat on his peg and reaches, with the other, for a form. \"Prior claim,\" he says. \"I have it in writing, and I have it in a very large binder.\"")] };
}

// ---- the clerk ---------------------------------------------------------------------------------------------------------------------------------

function talk(s: ClaimState, kind: string, result: string, paidIn: number): Reduction<ClaimState> {
  if (kind !== "assayer") return stay(s);
  if (result === "open") {
    if (s.parley || s.clerkDown) return stay(s);
    return { s: fin({ ...s, parley: "assayer" }), fx: [{ k: "parley", kind: "assayer", price: s.price.fee }] };
  }
  if (s.parley !== "assayer") return stay(s);
  const mine = count(s, 1), theirs = count(s, 2);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "hostile": return raise({ ...s, parley: undefined }, "You shout at the clerk. He writes down the time, faster than he has ever done anything. The surveyors run. The guards get up.", true);
    case "learn": return stay(fin({ ...s, asked: true }));
    case "tell": {
      if (!s.asked || s.fraud) return stay(fin({ ...s, parley: undefined }));
      return { s: fin({ ...s, parley: undefined, fraud: true }), fx: [say("The clerk has waited years for this. \"Their chain has been shortened,\" he says, stamping the Syndicate's survey PROVISIONAL in red. Their pegs are now just decoration.")] };
    }
    case "survey": {
      if (s.hostile || s.fraud) return { s: fin({ ...s, parley: undefined }), fx: [say("\"A joint claim is a gentleman's arrangement,\" says the clerk, looking at the surveyors' empty chain. \"I have been shot at in this chair; I am not in the mood for one.\"")] };
      if (mine < 1 || theirs < 1) return { s: fin({ ...s, parley: undefined }), fx: [say(mine < 1 ? "\"Joint with whom, madam?\" says the clerk. \"You have no pegs. A partnership needs something to be a partner in.\"" : "\"Joint with whom?\" says the clerk. \"The Syndicate has not driven a peg. I cannot certify a partnership with a brochure.\"")] };
      return resolveWith(fin({ ...s, parley: undefined }), "partnered", {}, [say("The clerk has a form for exactly this. Both sides sign, and the Guild's seal arrives before anyone sends for it. The claim and its ore are shared, at a ratio the clerk will work out.")]);
    }
    case "paid": {
      if (!paidOk(s, paidIn, s.price.fee)) return stay(fin({ ...s, parley: undefined }));
      if (mine < CLAIM.need) return { s: fin({ ...s, parley: undefined }), fx: [say(`\"A claim wants ${CLAIM.need} pegs,\" says the clerk, regretfully. \"You hold ${mine}. The fee is returned to your pocket, as nothing has been filed.\"`)] };
      const standing = s.fraud ? 0 : theirs;
      if (standing > 0) return { s: fin({ ...s, parley: undefined }), fx: [say("\"The Syndicate has a peg inside your corners,\" says the clerk. \"Claims may not overlap. Pull it out first. I cannot; I have been neutral for eleven years.\"")] };
      const jumped = s.pulled > 0 || (s.fraud && theirs > 0);
      const n = fin({ ...s, parley: undefined, spent: s.spent + paidIn, paid: s.paid + paidIn });
      return resolveWith(n, jumped ? "jumped" : "staked", {}, [say(jumped
        ? `£${paidIn} and a signature, and the claim is the Society's. The Syndicate's pegs are now called 'a misunderstanding'. The surveyors are told, by form.`
        : `£${paidIn} and a signature, and the claim is the Society's: ${CLAIM.need} pegs, first at the counter. The Syndicate's brochure is filed under "Late".`)]);
    }
    default: return stay(s);
  }
}

// ---- leaving ---------------------------------------------------------------------------------------------------------------------------------

function leave(s: ClaimState): ReturnType<TemplateDef<ClaimState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  const nothing = tallyEmpty(s.tally) && !s.hostile && !s.parley && count(s, 1) === 0 && s.paid === 0 && !s.fraud && !s.asked;
  return nothing ? undefined : "outpaced";
}

// ---- the view -------------------------------------------------------------------------------------------------------------------------------

const HINT: Record<string, string> = {
  approach: "The pegging ground is on the west bench, a long walk up the gorge. The Syndicate's surveyors are already there with a theodolite and a brochure.",
  waiting: "Use at the open corners to drive three pegs, then pay the fee at the Assay House on the east bench. The Syndicate pegs a corner every minute or so, and files at three.",
  parley: "The clerk is listening. He has been listening for eleven years and has not once been surprised.",
  fighting: "A shot has been fired. The surveyors have run and the guards are coming down the road. Beat both surveyors and their pegs can be pulled; the joint claim is off.",
};
const DONE: Record<string, string> = {
  staked: "Claim registered: three pegs and the form, first at the counter. The clerk was very nearly surprised. Take the ore barge home from Staithe Landing.",
  jumped: "Claim registered after the Syndicate's pegs came out of the ground. The paperwork will describe this as a clarification. Take the ore barge home.",
  partnered: "A joint claim, sealed by the Guild. Everybody has half of something, and nobody yet knows what. Take the ore barge home.",
  outpaced: "The Syndicate's claim is registered and the Society's notes are an appendix to it. Take the ore barge home.",
  abandoned: "The expedition is down. The pegging ground is unmoved. Take the ore barge home and explain yourselves.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  rival_scouts: "Syndicate scouts have been on the bench since dawn: the first Syndicate peg will come early.",
  outriders: "A Syndicate rider carries their form to the Assay House: they will file the moment they hold three pegs.",
};

function pegText(s: ClaimState, i: number): string {
  const who = s.pegs[i];
  return who === 1 ? `The ${NAME(i)} corner is pegged: yours` : who === 2 ? (broken(s) || s.fraud ? `Pull the Syndicate's peg at the ${NAME(i)} corner` : `The ${NAME(i)} corner is the Syndicate's`) : `Peg the ${NAME(i)} corner (Use)`;
}

function view(s: ClaimState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "staked" || res === "jumped" || res === "partnered";
  const objectives: ObjectiveView[] = [
    { id: "ground", text: "Walk up the gorge to the pegging ground on the west bench", done: s.near.ground > 0 || s.phase !== "approach" },
    ...s.pegs.map((_, i): ObjectiveView => ({ id: `peg-${i}`, text: pegText(s, i), done: s.pegs[i] === 1, optional: true })),
    { id: "file", text: `File at the Assay House: ${CLAIM.need} pegs, none of theirs (£${s.price.fee})`, done: res === "staked" || res === "jumped", optional: true },
    { id: "claim", text: res === "outpaced" ? "Lost: the Syndicate's claim is registered" : res === "abandoned" ? "Lost: the expedition went down" : "Peg three corners, then file at the Assay House", done: won },
  ];
  if (res === undefined && s.fraud) objectives.push({ id: "provisional", text: "The Syndicate's survey is marked PROVISIONAL", done: true, optional: true });
  if (res !== undefined) objectives.push({ id: "home", text: "Take the ore barge home from Staithe Landing", done: false });
  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const remainFile = s.rivalFilesAt > 0 ? s.rivalFilesAt - s.t : Infinity;
  const remainClose = s.closeAt - s.t;
  const remain = res !== undefined ? 0 : Math.min(remainFile, remainClose);
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(remainFile <= remainClose ? "The Syndicate files" : "The Assay House closes", remain, now), template: "claim_race", title: "The Claim Race", ...ruleWhile("claim_race", res === undefined && !s.clerkDown) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: ClaimState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  return {
    scenario: "claim_race", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
    complication: s.complication, region: "vesper",
  };
}

// ---- the people ------------------------------------------------------------------------------------------------------------------------------

const GUARD_NAMES = ["Enforcer Roddy Vesk-Pym", "Enforcer Hilda Marrowgate", "Enforcer Cuthbert Loam", "Enforcer Ottilie Strake"] as const;
const GUARD_ARMS: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.PISTOL];
const SURVEYORS = ["Surveyor Ansel Quire-Dunmarrow", "Chainman Perpetua Vane"] as const;

/** The people the run may spawn: the Assay House's clerk, the Syndicate's two surveyors and four guards at the headframe. 7 rows. */
function roster(_c: CampaignState, seed: number, _s: ClaimState): NpcSpec[] {
  const S = VESPER_SITES;
  const out: NpcSpec[] = [];
  const mk = (id: string, role: number, faction: NpcSpec["faction"], side: NpcSpec["side"], group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction, side, group, post: { x: post.x, z: post.z }, weapon, lookSeed: hash3(seed >>> 0, i, role), name, skill, bravery, brain,
  });
  // (the clerk borrows the court official's role for his manner, not his people: D-041, he was drawn as one of Highmark's Marchers inside Vesper Gorge)
  out.push({ ...mk("assayer", NPC.CHAMBERLAIN, "ward", "ward", "assay", S.assayer, WEAPON.FISTS, "Clerk Lemuel Tarn-Ledger (Assay House)", 10, 90, "civil", 0), people: "vesperine" });
  S.rivalSurveyors.forEach((p, i) => out.push(mk(`surveyor-${i}`, NPC.RIVAL_SURVEYOR, "rival", "rival", "surveyors", p, WEAPON.FISTS, SURVEYORS[i]!, 10, 25, "civil", 1 + i)));
  S.guards.forEach((p, i) => out.push(mk(`guard-${i}`, NPC.RIVAL_GUARD, "rival", "rival", "guards", p, GUARD_ARMS[i]!, GUARD_NAMES[i]!, 50 + 5 * i, 55, "garrison", 3 + i)));
  return out;
}

const observe: ObserveSpec = {
  near: [{ id: "ground", x: VESPER_ANCHORS.pegging.x, z: VESPER_ANCHORS.pegging.z, r: CLAIM.nearR }],
  use: [
    ...VESPER_SITES.claimPegs.map((p, i) => ({ id: `peg${i}`, at: { x: p.x, z: p.z }, r: CLAIM.pegR, carry: "none" as const })),
    { id: "assayer", npc: "assayer", r: CLAIM.personR, talk: "assayer" as const, carry: "none" as const },
  ],
  count: [{ group: "surveyors" }, { group: "guards" }],
  seen: [],
  actors: [{ id: "assayer" }, { id: "surveyor-0" }, { id: "surveyor-1" }],
  hostileGroups: ["surveyors", "guards"],
};

export const claimRaceTemplate: TemplateDef<ClaimState> = {
  id: "claim_race", title: "The Claim Race",
  brief: "Something valuable is in the rock of the west bench. The claim goes to whoever files three pegs at the Assay House first. Out-peg the Syndicate, pull their pegs, or offer to share.",
  init, reduce, view, outcome, roster, leave, observe,
  sites: { pegging: VESPER_ANCHORS.pegging, assay: VESPER_ANCHORS.assay },
};
