import type { ParleyKind, ParleyOption, ParleyView, TalkResult } from "../campaignTypes.ts";
import { clampI } from "../factions.ts";
import { hash3 } from "../rng.ts";
import { SALTMARKET_PARLEYS } from "./saltmarketParleyText.ts";
import { VESPER_PARLEYS } from "./vesperParleyText.ts";

/**
 * The site parleys (D-034): the deserters' ransom, the Ward's border patrol, the Syndicate's surveyor and the Ward's ford post. Authored here, pure,
 * hostile-safe like negotiation.ts: the CLIENT only ever sends an option index; the options (and what each costs) are re-derived on the server from
 * (kind, round), so a forged index or a stale view re-issues the round instead of advancing it. The Ward's own parley with the Warden stays in negotiation.ts.
 * Wire ids are the nearest slice-1 id (the client shows the label, never the id); the meaning lives in `key` here.
 */

export type SiteParleyKind = Exclude<ParleyKind, "warden">;
/** D-037: the six parley kinds of Vesper Gorge and the Saltmarket Delta are SCRIPTS (data: `ParleyScript`, authored in `scenarios/<region>ParleyText.ts`), not branches of the code below. */
export type ScriptKind = "foreman" | "dirge_master" | "assayer" | "tide_reeve" | "auctioneer" | "house_head";
type LegacyKind = Exclude<SiteParleyKind, ScriptKind>;
export type Key = "pay" | "flatter" | "threaten" | "walk" | "propose" | "ask" | "tell" | "envelope" | "tip";
const WIRE: Record<Key, ParleyOption["id"]> = {
  pay: "pay", flatter: "haggle_flatter", threaten: "haggle_threaten", walk: "walk_away", propose: "haggle_flatter", ask: "haggle_flatter", tell: "bribe", envelope: "bribe", tip: "bribe",
};
export interface SiteParleyCtx { price: number; purse: number; seed: number; day: number }
export interface Opt { key: Key; label: string; hint: string; cost: number }

/**
 * One scripted parley (D-037). The wire ids and the result each key reports are fixed by the engine below: pay -> `paid` (the price is taken from the purse), propose -> `survey`, tell -> `tell`,
 * envelope -> `envelope`, tip -> `tip`, ask -> the second round plus a `learn` event, flatter -> the price moves 20% down (45%) or 10% up, threaten -> `hostile`, walk -> `walked`; `deal` holds the line
 * for each result the script offers. The template decides what each result MEANS (its `talk` event carries kind + result). Lists hold >= 2 variants (picked by hash3).
 */
export interface ParleyScript {
  speaker: string;
  open: readonly string[];
  /** The line after `ask` (and the second round's opening). */
  round2: readonly string[];
  walk: string;
  hostile: string;
  /** "{price}" is filled in. Required only when a round offers `flatter`; absent, a `flatter` press re-issues the round. */
  flatter?: { ok: readonly string[]; fail: readonly string[] };
  deal: Partial<Record<"paid" | "survey" | "tell" | "envelope" | "tip", string>>;
  /** The line when `pay` is chosen with too little in the purse. */
  short: string;
  /** The options of round 1, 2 and 3 for a price `p` (>= 1 of them; always includes a `walk`). */
  options(round: number, p: number): readonly Opt[];
}
const PARLEY_SCRIPTS: Readonly<Partial<Record<ParleyKind, ParleyScript>>> = { ...VESPER_PARLEYS, ...SALTMARKET_PARLEYS };
/** The scripted kinds only (exported for the tests that prove every script is complete). */
export const SCRIPTED_KINDS: readonly ScriptKind[] = Object.keys(PARLEY_SCRIPTS) as ScriptKind[];
export const parleyScript = (kind: ParleyKind): ParleyScript | undefined => PARLEY_SCRIPTS[kind];

/** A step of a site parley: the next round (optionally reporting what was learnt on the way), or the end. */
export type SiteStep =
  | { view: ParleyView; line: string; emit?: TalkResult; done?: undefined }
  | { done: { result: TalkResult | "walked"; paid: number }; line: string; view?: undefined; emit?: undefined };

const SPEAKER: Record<LegacyKind, string> = {
  ransom: "Colour-Sergeant Barnaby Cull (deserted)",
  ward_post: "Patrol-Sergeant Hettie Rook",
  surveyor: "Surveyor Ansel Quire-Dunmarrow",
  ford_post: "Picket Corporal Dunstan Aldous",
  // D-036: Highmark's court
  chamberlain: "Lord Chamberlain Ottoline Fenwick-Vane",
  claimant_elder: "Princess Orla, by Seniority",
  claimant_younger: "Prince Dunstan, by Acclamation",
};
const OPEN: Record<LegacyKind, readonly string[]> = {
  ransom: [
    "\"Mr. Quim,\" says the colour-sergeant, patting the cage, \"is insured. That makes him worth more alive to everyone, which is a first for a surveyor. The price is £{price}.\"",
    "\"We were not kidnapping him,\" says the colour-sergeant. \"We were repatriating him, with a handling fee of £{price}. Nobody here has ever been paid on time, so we are very keen on prompt settlement.\"",
  ],
  ward_post: [
    "The patrol-sergeant does not lower her rifle. \"State your business at Marker Stone No. 4. Be brief. The Syndicate has been brief at me for an hour and I am out of patience and forms.\"",
    "\"This stone,\" says the patrol-sergeant, \"is in the Ward's ford. The men across the water say it is in theirs. One of us is wrong and I have the bigger gun. What do you want?\"",
  ],
  surveyor: [
    "The surveyor lowers his measuring chain by an inch, which in his profession is practically an embrace. \"The border is a technicality, madam, and I am the technician. What can the Syndicate do for you?\"",
    "\"Ah. The Society,\" says the surveyor. \"We are about to settle a boundary with a ruler, a lawyer and, if it comes to it, the third thing. Do sit. Do not sit near the stone.\"",
  ],
  ford_post: [
    "The picket corporal looks at you over a tin of tea. \"Ford post, Ward of the Nine Lamps. If you have a grievance, we have a form. If you have a tip, we have a form and a mug. Which is it?\"",
    "\"We are on picket,\" says the corporal, \"which means we are looking at the river and not at the Syndicate road, and we have been told to keep it that way. Unless somebody tells us otherwise.\"",
  ],
  chamberlain: [
    "\"The King,\" says the Lord Chamberlain, without looking up from a form the size of a tablecloth, \"is pending. The chair is therefore vacant in a procedural sense. Kindly take a number. You are four hundred and eleven; we are serving number nine.\"",
    "\"Welcome to the Chamberlain's Window,\" says the Lord Chamberlain, through the Window, which is a window in the way that a pillory is a collar. \"Form 11 is required for everything. Form 11 is available at the other Window. The other Window is closed for the harvest. Do sit. The bench is also a form.\"",
  ],
  claimant_elder: [
    "\"I am the elder,\" says the Princess, from a chair a very slightly lower than the Vacant one, \"and in Highmark that is a policy. Seniority is the only principle we have ever agreed on, and we agreed on it by seniority. My price is £{price}.\"",
    "Princess Orla does not rise. \"You are the Society's. Everybody is somebody's. I am my father's, technically, and he has been pending since before I had a haircut. If you would like the chair settled my way, it will cost £{price}.\"",
  ],
  claimant_younger: [
    "\"The people love me,\" says the Prince, who is being fanned by somebody with a palm leaf, \"and I have the cheering to prove it. Some of it is paid, but the passion is real. The passion is £{price}.\"",
    "Prince Dunstan beams, then gestures, and a small band strikes up in the courtyard on cue. \"Acclamation,\" he says, \"is a form of consent that arrives in advance. £{price} for the arrangements, and the band is extra, and the band is also me.\"",
  ],
};
const ROUND2: Record<LegacyKind, readonly string[]> = {
  ransom: [
    "\"Fine,\" says the colour-sergeant, scratching a stubble you could strike matches on. \"£{price}, and I will throw in the cage.\"",
    "\"You drive a hard bargain for a person with no firearm,\" says the colour-sergeant. \"£{price}. Last offer. It is also the first.\"",
  ],
  ward_post: ["\"Go on,\" says the sergeant."],
  surveyor: [
    "\"Between us,\" says the surveyor, lowering his voice, \"we mean to move Stone No. 4 four yards east on a moonless night, which makes the ford ours, the river ours and the Ward's tea tax, regrettably, also ours. There is an envelope for a person who helps. It is a thick envelope. I measured it.\"",
    "\"The stone,\" admits the surveyor, \"has been walking east a yard a week, with my encouragement. A friend who pulls it the last four feet would find an envelope in her coat, in the Syndicate's own pocket.\"",
  ],
  ford_post: ["\"Go on,\" says the corporal, setting down his tea."],
  chamberlain: ["\"Order of precedence,\" says the Chamberlain, with relish. \"Myself. The heirs, by seniority. The Assembly, by show of hands. Everybody Else, by arrangement. A cheque from a foreign envoy outranks the lot on a rainy afternoon, but I did not say that, and Form 11 will say I did not.\""],
  claimant_elder: ["\"I will sign for a regency,\" says Orla, \"if my brother does, which he will not, because he cannot count. Or I will be crowned. Make it official: Form 11 stamped, the Assembly sitting, the barley in. I shall be very gracious about the price.\""],
  claimant_younger: ["\"The Assembly,\" says Dunstan, lowering his voice, \"likes grain. All farmers do. A delegate who has eaten votes for whoever is standing nearest the buffet. I intend to be standing nearest the buffet. Pledge me, and I shall be.\""],
};
const FLATTER_HM: Partial<Record<LegacyKind, { ok: readonly string[]; fail: readonly string[] }>> = {
  claimant_elder: {
    ok: ["\"Seniority,\" says Orla, softening by perhaps a degree, \"is at least noticed. £{price}, and do not tell my brother I cut it.\"", "\"You have read the precedents,\" says the Princess. \"£{price}, then. A reader is a rare thing in this court.\""],
    fail: ["\"Flattery is not a form,\" says the Princess. \"£{price}, to cover the speech.\"", "\"I was flattered by a better class of courtier,\" says Orla. \"£{price}.\""],
  },
  claimant_younger: {
    ok: ["\"You understand the people!\" says Dunstan, delighted. \"£{price}, then, and I shall mention you from the balcony. Possibly by name.\"", "\"Say that again, louder, for the band,\" says the Prince. \"£{price}, for a friend of the cheering.\""],
    fail: ["\"Charming,\" says Dunstan, \"and now it costs £{price}, because charm is a service.\"", "\"I have been flattered by experts,\" says the Prince. \"£{price}.\""],
  },
};
const FLATTER_OK = ["\"You have a kind way of robbing a man,\" says the colour-sergeant. \"£{price}, then, and I did not say it was a discount.\"", "\"Manners!\" He looks around for witnesses. \"£{price}. Do not tell the lads.\""];
const FLATTER_FAIL = ["\"That is a very nice speech,\" says the colour-sergeant, \"and now it costs £{price}, to cover the speech.\"", "\"I was flattered by better in a better regiment. £{price}.\""];
const WALK: Record<LegacyKind, string> = {
  ransom: "You excuse yourself. The colour-sergeant waves the cage at you as you go, which is not a farewell.",
  ward_post: "You step back. The sergeant notes the time and your face, in that order.",
  surveyor: "You step back. The surveyor makes a small mark in a small book.",
  ford_post: "You excuse yourself. The corporal returns to his tea and the river.",
  chamberlain: "You withdraw. The Chamberlain records that you withdrew, and at what time, and in which direction.",
  claimant_elder: "You step back. The Princess notes it, as seniority notes everything.",
  claimant_younger: "You step back. The Prince waves, to somebody behind you.",
};
const DEAL: Partial<Record<TalkResult, string>> = {
  ransom: "\"Done,\" says the colour-sergeant, pocketing the money with the care of a man who has never owned any. \"Mr. Quim! You are redeemed.\" The cage door opens. \"Do mind the step.\"",
  survey: "\"A joint survey,\" the surveyor repeats, as if tasting a pie. \"In triplicate. I shall sign the third copy. Do not let the other side see which one that is.\"",
  tell: "\"The Syndicate means to move the stone?\" The sergeant is very still. \"Thank you. You have just saved me a night of looking at it. Gentlemen: detain these people, kindly, as witnesses.\"",
  envelope: "The envelope is thick. It is also, somehow, already in your coat. \"The stone,\" says the surveyor, \"is a quarter-ton, so lift with your knees.\"",
  tip: "\"A wagon, in the Cut, with the Syndicate's flag on a Ward crate? I did not hear that,\" says the corporal, loudly, standing up. \"Section! The Cut. Ambush stations. And bring the tea.\"",
};
const DEAL_BY_SPEAKER: Partial<Record<LegacyKind, Partial<Record<TalkResult, string>>>> = {
  ward_post: {
    survey: "\"A joint survey,\" the sergeant repeats, without lowering the rifle. \"Both chains on the ground at once, in daylight, witnessed. I can put that in a report without having to lie in it.\"",
  },
  chamberlain: {
    survey: "\"Form 11, in triplicate,\" says the Chamberlain, receiving it with both hands and a faint sigh. \"It will be stamped. Stamping takes forty-five seconds, which in Highmark is called prompt.\"",
    paid: "The envelope disappears into the Window, where envelopes go. \"Form 11,\" says the Chamberlain, stamping it twice, \"is hereby in order, retroactively.\"",
  },
  claimant_elder: {
    paid: "\"Done,\" says the Princess, pocketing it with the practised ease of a woman who has been owed money by the Treasury since childhood. \"I shall remember this when I am remembering things.\"",
    survey: "\"A regency,\" says the Princess, as if tasting a pie she suspects. \"Very well. A third of a throne is a third more than I have now.\"",
  },
  claimant_younger: {
    paid: "\"Marvellous!\" says the Prince. \"The band will be told. The crowd will be told. The band will tell the crowd.\"",
    survey: "\"A regency,\" says the Prince. \"A throne with three bottoms. How cosy. Put me down.\"",
  },
};
const HOSTILE: Record<LegacyKind, string> = {
  ransom: "The colour-sergeant takes this in. The camp takes it in. Everyone reaches for something at the same time.",
  ward_post: "\"Is that an order?\" asks the sergeant, with great calm. The border wakes up.",
  surveyor: "The surveyor steps back, and an entourage steps forward. His chain is a lot heavier than it looks.",
  ford_post: "The corporal puts down his tea. This is a bad sign.",
  chamberlain: "The Chamberlain raises one finger, and the court's guards, who have been waiting all year, are pleased.",
  claimant_elder: "The Princess's retinue arrives at once, as if it had been waiting for this one thing.",
  claimant_younger: "The Prince's supporters, who are loud, become louder, and then armed.",
};

const price = (n: number): number => clampI(n, 5, 400, 40);
const fill = (t: string, p: number): string => t.replace(/\{price\}/g, String(p));
const pickText = (list: readonly string[], seed: number, tag: number): string => list[hash3(seed, tag, list.length) % list.length]!;

/** Round 1 is always the opening; later rounds are reached only through `answerSiteParley`, which carries the price in `view.toll`. */
function options(kind: SiteParleyKind, round: number, p: number): Opt[] {
  const script = PARLEY_SCRIPTS[kind];
  if (script) return [...script.options(round, p)];
  return legacyOptions(kind as LegacyKind, round, p);
}
function legacyOptions(kind: LegacyKind, round: number, p: number): Opt[] {
  const walk: Opt = { key: "walk", label: "Walk away", hint: "Nothing lost, nothing gained.", cost: 0 };
  switch (kind) {
    case "ransom":
      return round === 1
        ? [{ key: "pay", label: `Pay £${p}`, hint: "Cash. The cage opens. No shots.", cost: p }, { key: "flatter", label: "Flatter the camp", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
          { key: "threaten", label: "Threaten them", hint: "Five armed men and a cage. Bold.", cost: 0 }, walk]
        : [{ key: "pay", label: `Pay £${p}`, hint: "Last offer, and the first.", cost: p }, walk];
    case "ward_post":
      return [
        { key: "propose", label: "Propose a joint survey", hint: "Both sides measure the same stone, in the same hour, with witnesses.", cost: 0 },
        { key: "tell", label: "Tell the patrol the Syndicate's plan", hint: "Needs you to know it. Ask the surveyor first.", cost: 0 },
        { key: "threaten", label: "Order the patrol off the bank", hint: "You are not a Warden. This will be remembered.", cost: 0 }, walk,
      ];
    case "surveyor":
      return round === 1
        ? [{ key: "propose", label: "Propose a joint survey", hint: "Both sides measure the same stone, in the same hour, with witnesses.", cost: 0 },
          { key: "ask", label: "Ask what the chain is really measuring", hint: "He might tell you. He might mention an envelope.", cost: 0 },
          { key: "threaten", label: "Demand he withdraw", hint: "He has an entourage. You have opinions.", cost: 0 }, walk]
        : [{ key: "envelope", label: "Take the envelope (and the stone)", hint: "You will be asked to pull Stone No. 4. The Ward will notice.", cost: 0 }, walk];
    case "ford_post":
      return [{ key: "tip", label: "Tip the picket off about the wagon", hint: "Two Ward soldiers will meet it at the Cut. You need not fire a shot.", cost: 0 }, walk];
    case "chamberlain":
      return round === 1
        ? [{ key: "propose", label: "File Form 11 (stamped in forty-five seconds)", hint: "Free, in triplicate, and slow. Nothing at court happens without it.", cost: 0 },
          { key: "ask", label: "Ask the order of precedence", hint: "She may tell you. She will enjoy it.", cost: 0 },
          { key: "pay", label: `Expedite with an envelope (£${p})`, hint: "Immediate. It is not a bribe; it is a handling charge with a nice envelope.", cost: p },
          { key: "threaten", label: "Demand the chair", hint: "The court has a guard. You have opinions.", cost: 0 }, walk]
        : [{ key: "propose", label: "File Form 11 (stamped in forty-five seconds)", hint: "Free, in triplicate, and slow.", cost: 0 },
          { key: "pay", label: `Expedite with an envelope (£${p})`, hint: "Immediate.", cost: p }, walk];
    case "claimant_elder":
    case "claimant_younger": {
      const her = kind === "claimant_elder";
      return round === 1
        ? [{ key: "pay", label: `Pledge ${her ? "her" : "him"} the chair (£${p})`, hint: `${her ? "She is" : "He is"} yours at the ratification. One pledge at a time; the Assembly will not vote for two.`, cost: p },
          { key: "propose", label: "Propose a regency (three signatures)", hint: "Both heirs and the Chamberlain. Nobody sits in the chair, which is the compromise.", cost: 0 },
          { key: "flatter", label: her ? "Flatter her seniority" : "Flatter his popularity", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
          { key: "ask", label: "Ask what it would take", hint: "A hint, in the heir's own words.", cost: 0 },
          { key: "threaten", label: `Remind ${her ? "her" : "him"} who has the rifles`, hint: "The court has a guard of its own. This will be remembered.", cost: 0 }, walk]
        : [{ key: "pay", label: `Pledge ${her ? "her" : "him"} the chair (£${p})`, hint: "The Assembly votes for one at a time.", cost: p },
          { key: "propose", label: "Propose a regency (three signatures)", hint: "Both heirs and the Chamberlain.", cost: 0 }, walk];
    }
  }
}

function view(kind: SiteParleyKind, round: number, p: number, line: string): ParleyView {
  return {
    round, speaker: PARLEY_SCRIPTS[kind]?.speaker ?? SPEAKER[kind as LegacyKind], line, toll: p,
    options: options(kind, round, p).map((o): ParleyOption => ({ id: WIRE[o.key], label: o.label, cost: o.cost, hint: o.hint })),
    mood: "neutral",
  };
}

export function openSiteParley(kind: SiteParleyKind, ctx: SiteParleyCtx): ParleyView {
  const p = price(ctx.price);
  const open = PARLEY_SCRIPTS[kind]?.open ?? OPEN[kind as LegacyKind];
  return view(kind, 1, p, fill(pickText(open, ctx.seed, hash3(ctx.day, 1, 0x7a1) ), p));
}

const done = (result: TalkResult | "walked", paid: number, line: string): SiteStep => ({ done: { result, paid }, line });

/** The engine for a scripted kind (D-037): the key decides the result, the script supplies the words. */
function answerScripted(kind: SiteParleyKind, sc: ParleyScript, ctx: SiteParleyCtx, round: number, p: number, o: Opt, roll: number): SiteStep {
  const again = (line: string): SiteStep => ({ view: view(kind, round, p, line), line });
  switch (o.key) {
    case "walk": return done("walked", 0, sc.walk);
    case "threaten": return done("hostile", 0, sc.hostile);
    case "pay":
      if (ctx.purse < p || o.cost !== p || sc.deal.paid === undefined) return again(sc.short);
      return done("paid", p, sc.deal.paid);
    case "flatter": {
      if (round !== 1 || !sc.flatter) return again("Nobody moves. The offer stands as it was.");
      const lower = roll < 45;
      const np = price(lower ? Math.round((p * 0.8) / 5) * 5 : Math.round((p * 1.1) / 5) * 5);
      const line = fill(pickText(lower ? sc.flatter.ok : sc.flatter.fail, ctx.seed, round * 17 + (lower ? 1 : 2)), np);
      return { view: view(kind, 2, np, line), line };
    }
    case "ask": {
      const line = fill(pickText(sc.round2, ctx.seed, 29), p);
      return { view: view(kind, 2, p, line), line, emit: "learn" };
    }
    case "propose": return sc.deal.survey === undefined ? again(sc.short) : done("survey", 0, sc.deal.survey);
    case "tell": return sc.deal.tell === undefined ? again(sc.short) : done("tell", 0, sc.deal.tell);
    case "envelope": return sc.deal.envelope === undefined ? again(sc.short) : done("envelope", 0, sc.deal.envelope);
    case "tip": return sc.deal.tip === undefined ? again(sc.short) : done("tip", 0, sc.deal.tip);
  }
}

/** One answer. `option` indexes `view.options`; anything the current round does not offer re-issues the round. */
export function answerSiteParley(kind: SiteParleyKind, ctx: SiteParleyCtx, v: ParleyView, option: number): SiteStep {
  const round = clampI(v?.round, 1, 3, 1);
  const p = price(clampI(v?.toll, 5, 400, ctx.price));
  const opts = options(kind, round, p);
  const o = Number.isInteger(option) ? opts[option] : undefined;
  const again = (): SiteStep => ({ view: view(kind, round, p, "Nobody moves. The offer stands as it was."), line: "Nobody moves. The offer stands as it was." });
  if (!o) return again();
  const roll = hash3(ctx.seed, ctx.day, round, 0x7a2) % 100;
  const script = PARLEY_SCRIPTS[kind];
  if (script) return answerScripted(kind, script, ctx, round, p, o, roll);
  const lk = kind as LegacyKind;   // (every other kind is one of the older, hard-wired seven)
  switch (o.key) {
    case "walk": return done("walked", 0, WALK[lk]);
    case "threaten": return done("hostile", 0, HOSTILE[lk]);
    case "pay": {
      const hm = kind === "chamberlain" || kind === "claimant_elder" || kind === "claimant_younger";
      if (ctx.purse < p || o.cost !== p) return { view: view(kind, round, p, hm ? "\"You are short,\" says the court, counting what is not there. The price stands." : "\"You are short,\" says the colour-sergeant, counting what is not there. The price stands."), line: "You are short of the price." };
      return hm ? done("paid", p, DEAL_BY_SPEAKER[lk]!.paid!) : done("ransom", p, DEAL.ransom!);
    }
    case "flatter": {
      if (round !== 1) return again();
      const lower = roll < 45;
      const np = price(lower ? Math.round((p * 0.8) / 5) * 5 : Math.round((p * 1.1) / 5) * 5);
      const hmf = FLATTER_HM[lk];
      const line = fill(pickText(hmf ? (lower ? hmf.ok : hmf.fail) : lower ? FLATTER_OK : FLATTER_FAIL, ctx.seed, round * 17 + (lower ? 1 : 2)), np);
      return { view: view(kind, 2, np, line), line };
    }
    case "propose": return done("survey", 0, DEAL_BY_SPEAKER[lk]?.survey ?? DEAL.survey!);
    case "ask": {
      const line = pickText(ROUND2[lk], ctx.seed, 29);
      return { view: view(kind, 2, p, line), line, emit: "learn" };
    }
    case "tell": return done("tell", 0, DEAL.tell!);
    case "envelope": return done("envelope", 0, DEAL.envelope!);
    case "tip": return done("tip", 0, DEAL.tip!);
  }
}
