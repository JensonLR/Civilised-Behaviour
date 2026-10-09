import type { ParleyKind, ParleyOption, ParleyView, TalkResult } from "../campaignTypes.ts";
import { clampI } from "../factions.ts";
import { hash3 } from "../rng.ts";
import { REAPERS_PARLEYS } from "./highmarkParleyText.ts";
import { KESSAR_PARLEYS } from "./kessarParleyText.ts";
import { SALTMARKET_PARLEYS } from "./saltmarketParleyText.ts";
import { VESPER_PARLEYS } from "./vesperParleyText.ts";

/**
 * The site parleys (D-034): the deserters' ransom, the Ward's border patrol, the Syndicate's surveyor and the Ward's ford post. Authored here, pure,
 * hostile-safe like negotiation.ts: the CLIENT only ever sends an option index; the options (and what each costs) are re-derived on the server from
 * (kind, round), so a forged index or a stale view re-issues the round instead of advancing it. The Ward's own parley with the Warden stays in negotiation.ts.
 * Wire ids are the nearest slice-1 id (the client shows the label, never the id); the meaning lives in `key` here.
 */

export type SiteParleyKind = Exclude<ParleyKind, "warden">;
/** D-037: the six parley kinds of Vesper Gorge and the Saltmarket Delta are SCRIPTS (data: `ParleyScript`, authored in `scenarios/<region>ParleyText.ts`), not branches of the code below; D-042: so are the strike's two. */
export type ScriptKind = "foreman" | "dirge_master" | "assayer" | "tide_reeve" | "auctioneer" | "house_head" | "reaper" | "steward" | "engineer" | "raid_captain" | "dues_collector" | "lost_surveyor" | "master_of_hunt" | "menagerie_agent" | "siege_factor" | "needle_names" | "railway_surveyor";
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
  /** D-093: talks held somewhere other than the region's usual place name it (the sheet's heading and asked line, as `ParleyView.frame`); absent, the region's own. */
  frame?: { heading: string; asked: string };
}
const PARLEY_SCRIPTS: Readonly<Partial<Record<ParleyKind, ParleyScript>>> = { ...VESPER_PARLEYS, ...SALTMARKET_PARLEYS, ...REAPERS_PARLEYS, ...KESSAR_PARLEYS };
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
    "\"Mr. Quim is insured,\" says the colour-sergeant, patting the cage. \"So he is worth more alive. A first for a surveyor. Pay £{price} and he is yours.\"",
    "\"We did not kidnap him,\" says the colour-sergeant. \"We are returning him, for a fee of £{price}. Cash, please. Nobody has ever paid us on time.\"",
  ],
  ward_post: [
    "The patrol-sergeant keeps her rifle up. \"What do you want at Marker Stone No. 4? Be quick. The Syndicate has been shouting at me for an hour.\"",
    "\"This stone is in the Ward's ford,\" says the patrol-sergeant. \"The Syndicate says it is in theirs. One of us is wrong, and I have the bigger gun. What do you want?\"",
  ],
  surveyor: [
    "The surveyor lowers his measuring chain an inch. For him, that is a warm welcome. \"The border is a detail, and details are my job. What can the Syndicate do for you?\"",
    "\"Ah, the Society,\" says the surveyor. \"We are settling this border with a ruler, a lawyer and, if needed, a rifle. Do sit. Not near the stone.\"",
  ],
  ford_post: [
    "The corporal looks up from his tea. \"Ward ford post. Got a complaint? We have a form. Got a tip? We have a form and a mug. Which is it?\"",
    "\"We are on guard,\" says the corporal. \"We watch the river, not the Syndicate road. Those are our orders, unless somebody tells us something.\"",
  ],
  chamberlain: [
    "\"The King is 'pending',\" says the Lord Chamberlain, not looking up from a huge form. \"So the chair is empty, officially. Take a number. You are 411. We are serving number 9.\"",
    "\"Welcome to the Chamberlain's Window,\" says the Lord Chamberlain. \"Everything needs Form 11. Form 11 is at the other Window. The other Window is closed for the harvest.\"",
  ],
  claimant_elder: [
    "\"I am the elder,\" says the Princess, \"and in Highmark the eldest rules. We all agreed on that, in order of age. My price is £{price}.\"",
    "Princess Orla does not stand up. \"My father has been 'pending' since I was a girl. If you want the chair settled my way, it will cost £{price}.\"",
  ],
  claimant_younger: [
    "\"The people love me,\" says the Prince, as somebody fans him with a palm leaf. \"Hear them cheer! Some of it is paid, but the passion is real. The passion costs £{price}.\"",
    "Prince Dunstan waves, and a small band starts to play outside. \"The people choose me, loudly and in advance. £{price} for the arrangements. The band is extra.\"",
  ],
};
const ROUND2: Record<LegacyKind, readonly string[]> = {
  ransom: [
    "\"Fine,\" says the colour-sergeant, scratching his stubble. \"£{price}, and I will throw in the cage for free.\"",
    "\"You bargain hard for somebody without a gun,\" says the colour-sergeant. \"£{price}. That is my last offer.\"",
  ],
  ward_post: ["\"Go on,\" says the sergeant."],
  surveyor: [
    "\"Between us,\" says the surveyor quietly, \"we mean to move Stone No. 4 four yards east one dark night. Then the ford is ours. Help us, and there is a thick envelope in it.\"",
    "\"The stone has been creeping east a yard a week,\" admits the surveyor, \"with my help. Pull it the last four feet for us, and you get a thick envelope of Syndicate money.\"",
  ],
  ford_post: ["\"Go on,\" says the corporal, setting down his tea."],
  chamberlain: ["\"Who outranks whom?\" says the Chamberlain happily. \"Me first. Then the heirs, oldest first. Then the Assembly, by vote. A foreign cheque beats them all, but I never said that.\""],
  claimant_elder: ["\"I will agree to a regency if my brother does,\" says Orla. \"He will not. Or crown me properly: Form 11 stamped, the Assembly sitting and the barley harvest in.\""],
  claimant_younger: ["\"The Assembly likes grain,\" says Dunstan quietly. \"A well-fed delegate votes for whoever stands by the buffet. I plan to stand by the buffet. Pledge me, and I will.\""],
};
const FLATTER_HM: Partial<Record<LegacyKind, { ok: readonly string[]; fail: readonly string[] }>> = {
  claimant_elder: {
    ok: ["\"At last, someone who respects age,\" says Orla, softening a little. \"£{price}, then. Do not tell my brother I lowered it.\"", "\"You know the old laws,\" says the Princess. \"£{price}, then. I do like a well-read visitor.\""],
    fail: ["\"Flattery is not an argument,\" says the Princess. \"Now it is £{price}, to pay for the speech.\"", "\"Better courtiers have flattered me,\" says Orla. \"The price is now £{price}.\""],
  },
  claimant_younger: {
    ok: ["\"You understand the people!\" says Dunstan, delighted. \"£{price}, then. I will thank you from the balcony, possibly by name.\"", "\"Say that again, louder, so the band hears,\" says the Prince. \"£{price}, for a friend.\""],
    fail: ["\"Charming,\" says Dunstan. \"Now it costs £{price}. Charm is a service, and services cost.\"", "\"Experts have flattered me before,\" says the Prince. \"The price is now £{price}.\""],
  },
};
const FLATTER_OK = ["\"You rob a man very politely,\" says the colour-sergeant. \"£{price}, then. Do not call it a discount.\"", "\"Manners!\" He looks around for witnesses. \"Fine, £{price}. Do not tell the lads.\""];
const FLATTER_FAIL = ["\"Lovely speech,\" says the colour-sergeant. \"Now it costs £{price}, to pay for the speech.\"", "\"Better men flattered me in a better regiment. The price is now £{price}.\""];
const WALK: Record<LegacyKind, string> = {
  ransom: "You leave. The colour-sergeant shakes the cage at you as you go. It is not a wave goodbye.",
  ward_post: "You step back. The sergeant writes down the time and your face, in that order.",
  surveyor: "You step back. The surveyor makes a small mark in a small book.",
  ford_post: "You leave. The corporal goes back to his tea and his river.",
  chamberlain: "You leave. The Chamberlain writes down that you left, when, and in which direction.",
  claimant_elder: "You step back. The Princess notices. She notices everything.",
  claimant_younger: "You step back. The Prince waves, to somebody behind you.",
};
const DEAL: Partial<Record<TalkResult, string>> = {
  ransom: "\"Done,\" says the colour-sergeant, pocketing the money with great care. \"Mr. Quim! You are free.\" The cage door opens. \"Mind the step.\"",
  survey: "\"A joint survey,\" the surveyor repeats, as if tasting a strange pie. \"Agreed. Three copies. Do not tell the other side which one I signed.\"",
  tell: "\"The Syndicate means to move the stone?\" The sergeant goes very still. \"Thank you. Lads: hold these people, politely, as witnesses.\"",
  envelope: "The thick envelope is somehow already in your coat. \"The stone weighs a quarter of a ton,\" says the surveyor. \"Lift with your knees.\"",
  tip: "\"A Syndicate wagon in the Cut, carrying Ward crates?\" The corporal stands up. \"Section! To the Cut, ambush positions. And bring the tea.\"",
};
const DEAL_BY_SPEAKER: Partial<Record<LegacyKind, Partial<Record<TalkResult, string>>>> = {
  ward_post: {
    survey: "\"A joint survey,\" the sergeant repeats, rifle still up. \"Both sides measure at once, in daylight, with a witness. I can report that without lying.\"",
  },
  chamberlain: {
    survey: "\"Form 11, in three copies,\" says the Chamberlain, taking it with both hands. \"It will be stamped. That takes forty-five seconds, which in Highmark is fast.\"",
    paid: "The envelope vanishes through the Window. \"Your Form 11,\" says the Chamberlain, stamping it twice, \"was always in order. Officially.\"",
  },
  claimant_elder: {
    paid: "\"Done,\" says the Princess, pocketing the money with practised ease. \"I will remember this when I sit in that chair.\"",
    survey: "\"A regency,\" says the Princess, as if tasting a suspicious pie. \"Very well. A third of a throne is more than I have now.\"",
  },
  claimant_younger: {
    paid: "\"Marvellous!\" says the Prince. \"The band will be told. The crowd will be told. The band will tell the crowd.\"",
    survey: "\"A regency,\" says the Prince. \"One throne, three bottoms. How cosy. Count me in.\"",
  },
};
const HOSTILE: Record<LegacyKind, string> = {
  ransom: "The colour-sergeant takes this in. So does the camp. Everyone reaches for a weapon at once.",
  ward_post: "\"Is that an order?\" asks the sergeant, very calmly. Rifles come up all along the bank.",
  surveyor: "The surveyor steps back, and his armed escort steps forward. His chain is heavier than it looks.",
  ford_post: "The corporal puts down his tea. This is a bad sign.",
  chamberlain: "The Chamberlain raises one finger. The court guards, who have waited all year for this, are delighted.",
  claimant_elder: "The Princess's guards arrive at once, as if they had been waiting for this one thing.",
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
        ? [{ key: "pay", label: `Pay £${p}`, hint: "Cash. The cage opens. No shooting.", cost: p }, { key: "flatter", label: "Flatter the camp", hint: "Compliment them. The price may drop, or it may rise.", cost: 0 },
          { key: "threaten", label: "Threaten them", hint: "They fight at once. There are five of them, all armed.", cost: 0 }, walk]
        : [{ key: "pay", label: `Pay £${p}`, hint: "Their last offer. The cage opens.", cost: p }, walk];
    case "ward_post":
      return [
        { key: "propose", label: "Propose a joint survey", hint: "Both sides measure the stone together, with you as the witness.", cost: 0 },
        { key: "tell", label: "Tell the patrol the Syndicate's plan", hint: "You need to know it first. Ask the surveyor.", cost: 0 },
        { key: "threaten", label: "Order the patrol off the bank", hint: "They will fight. The Ward will not forget it.", cost: 0 }, walk,
      ];
    case "surveyor":
      return round === 1
        ? [{ key: "propose", label: "Propose a joint survey", hint: "Both sides measure the stone together, with you as the witness.", cost: 0 },
          { key: "ask", label: "Ask what the chain is really measuring", hint: "He might tell you. He might offer you an envelope.", cost: 0 },
          { key: "threaten", label: "Demand he withdraw", hint: "His armed men will fight you.", cost: 0 }, walk]
        : [{ key: "envelope", label: "Take the envelope (and move the stone)", hint: "You must pull up Stone No. 4. The Ward will notice.", cost: 0 }, walk];
    case "ford_post":
      return [{ key: "tip", label: "Warn the post about the Syndicate wagon", hint: "Two Ward soldiers will stop it at the Cut. You need not fire a shot.", cost: 0 }, walk];
    case "chamberlain":
      return round === 1
        ? [{ key: "propose", label: "File Form 11 (stamped in forty-five seconds)", hint: "Free, but slow. Nothing at this court happens without it.", cost: 0 },
          { key: "ask", label: "Ask who outranks whom", hint: "She may tell you. She will enjoy it.", cost: 0 },
          { key: "pay", label: `Speed it up with an envelope (£${p})`, hint: "Done at once. It is not a bribe. It is a 'handling charge'.", cost: p },
          { key: "threaten", label: "Demand the chair", hint: "The court guards will fight you.", cost: 0 }, walk]
        : [{ key: "propose", label: "File Form 11 (stamped in forty-five seconds)", hint: "Free, but slow.", cost: 0 },
          { key: "pay", label: `Speed it up with an envelope (£${p})`, hint: "Done at once.", cost: p }, walk];
    case "claimant_elder":
    case "claimant_younger": {
      const her = kind === "claimant_elder";
      return round === 1
        ? [{ key: "pay", label: `Pledge ${her ? "her" : "him"} the chair (£${p})`, hint: `${her ? "She is" : "He is"} your candidate at the vote. You can back only one heir at a time.`, cost: p },
          { key: "propose", label: "Propose a regency (three signatures)", hint: "Both heirs and the Chamberlain rule together. Nobody gets the chair.", cost: 0 },
          { key: "flatter", label: her ? "Flatter her seniority" : "Flatter his popularity", hint: "The price may drop, or it may rise.", cost: 0 },
          { key: "ask", label: "Ask what it would take", hint: "The heir tells you what they need.", cost: 0 },
          { key: "threaten", label: `Remind ${her ? "her" : "him"} who has the rifles`, hint: "The court guards will fight. Highmark will not forget it.", cost: 0 }, walk]
        : [{ key: "pay", label: `Pledge ${her ? "her" : "him"} the chair (£${p})`, hint: "You can back only one heir.", cost: p },
          { key: "propose", label: "Propose a regency (three signatures)", hint: "Both heirs and the Chamberlain rule together.", cost: 0 }, walk];
    }
  }
}

function view(kind: SiteParleyKind, round: number, p: number, line: string): ParleyView {
  const v: ParleyView = {
    round, speaker: PARLEY_SCRIPTS[kind]?.speaker ?? SPEAKER[kind as LegacyKind], line, toll: p,
    options: options(kind, round, p).map((o): ParleyOption => ({ id: WIRE[o.key], label: o.label, cost: o.cost, hint: o.hint })),
    mood: "neutral",
  };
  const frame = PARLEY_SCRIPTS[kind]?.frame;
  if (frame) v.frame = { ...frame };
  return v;
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
      if (round !== 1 || !sc.flatter) return again("Nobody moves. The offer has not changed.");
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
  const again = (): SiteStep => ({ view: view(kind, round, p, "Nobody moves. The offer has not changed."), line: "Nobody moves. The offer has not changed." });
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
      if (ctx.purse < p || o.cost !== p) return { view: view(kind, round, p, hm ? "\"You do not have enough,\" says the court. The price stays the same." : "\"You do not have enough,\" says the colour-sergeant. The price stays the same."), line: "You do not have enough money." };
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
