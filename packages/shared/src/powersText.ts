import type { NeedId } from "./campaignTypes.ts";
import { endingNews } from "./regionEndings.ts";
import { ENGINE_COPY } from "./engineText.ts";
import { RAID_COPY } from "./raidText.ts";
import { REAPERS_COPY } from "./reapersText.ts";
import { SALTMARKET_COPY } from "./saltmarketText.ts";
import { VESPER_COPY } from "./vesperText.ts";
import type { MinorPowerId, PairKey, PowerEffects, PowerId } from "./worldTypes.ts";

/**
 * Authored copy for the five powers (D-035). Satire aimed at INSTITUTIONS: a merchant oligarchy that auctions the weather, a farming co-operative that
 * decides by show of hands, a mourning guild that bills per corpse, a trading syndicate that calls ownership "streamlining". Every name is invented; no real
 * nation, people or faith is meant or named (scanned by noRealWorld.test.ts). Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */

export interface Leader { name: string; title: string; speaker: string }
export const LEADERS: Record<PowerId, Leader> = {
  ward: { name: "Ysolde Hask", title: "Lamp-Warden", speaker: "Lamp-Warden Ysolde Hask" },
  rival: { name: "Lucan Dunmarrow-Vesk", title: "Director of Streamlining", speaker: "Director Lucan Dunmarrow-Vesk" },
  brine: { name: "Corvin Saltreach", title: "Tide-Reeve (this quarter)", speaker: "Tide-Reeve Corvin Saltreach" },
  reapers: { name: "Hettie Bramblewick", title: "Speaker of the Grange", speaker: "Grange-Speaker Hettie Bramblewick" },
  choir: { name: "Osric Veil-Mourne", title: "Dirge-Master", speaker: "Dirge-Master Osric Veil-Mourne" },
};

/** How each power decides, in a sentence: the shape of the institution. */
export const STRUCTURE: Record<PowerId, string> = {
  ward: "One Lamp-Warden, nine lamps, and a ledger that outranks both.",
  rival: "A board of shareholders who have never seen the colony, represented in it by a very polite man with a very long chain of command.",
  brine: "Seven House-Heads and one rotating Tide-Reeve; every decision is sold to the highest bidder among them, and the winner pays the others an indemnity for the inconvenience.",
  reapers: "A Grange Assembly where every member holds one vote and one scythe. They decide slowly by show of hands, and then astonishingly.",
  choir: "A Dirge-Master and the Rota: a rotating roll of mourners who decide by precedent, by ceremony and by who is owed what for the last funeral.",
};

export const ECONOMY: Record<PowerId, { produces: string; wants: string; priceMul: number }> = {
  ward: { produces: "bridge access and receipts", wants: "coin, salutes and fewer surprises", priceMul: 1 },
  rival: { produces: "contracts, wagons and optimism", wants: "the bridge, the road and all adjacent land", priceMul: 1.1 },
  brine: { produces: "salt, tide-tables and weather insurance", wants: "arms and a monopoly on everything wet", priceMul: 1.35 },
  reapers: { produces: "grain, labour and a very long memory", wants: "medicine and fair prices", priceMul: 0.8 },
  choir: { produces: "funerals, rumour and the lowlands' only reliable records", wants: "deference, and corpses it can bill", priceMul: 1.2 },
};

export const MILITARY: Record<PowerId, { style: string; base: number; garrison: string }> = {
  ward: { style: "pikes on a wall, clerks behind it", base: 55, garrison: "the Wall Watch" },
  rival: { style: "hired escorts with a brochure", base: 45, garrison: "the Enforcement Division" },
  brine: { style: "fast cutters; strong at sea, thin ashore", base: 50, garrison: "the Tide Constabulary" },
  reapers: { style: "a harvest militia that is weak until the barley is in", base: 30, garrison: "the Scythe Rota" },
  choir: { style: "no army, a great deal of leverage; they know who died of what", base: 10, garrison: "the Pallbearers' Reserve" },
};

export const NEEDS_TEXT: Record<PowerId, Record<NeedId, string>> = {
  ward: {
    coin: "The Ward's coffers have a draught in them.",
    arms: "The Ward's armoury is mostly enthusiasm and one good pike.",
    medicine: "The Ward's infirmary is out of lint, and out of patience.",
    deference: "The Ward has not been saluted properly since the Society arrived, and it has noticed.",
  },
  rival: {
    coin: "The Syndicate's quarterly projections have a hole where the money was.",
    arms: "The Syndicate's escorts have been told to look intimidating on a budget.",
    medicine: "The Syndicate's surgeons are billing by the bandage and running short.",
    deference: "The Syndicate would like to be thanked for its contribution to your difficulties.",
  },
  brine: {
    coin: "The Houses are short of coin, which they will tell you is a temporary condition of everybody else.",
    arms: "The Tide Constabulary has more cutters than cannon, and the Houses find this embarrassing in public.",
    medicine: "A fever has come in on the spring tide and the Houses are pricing the cure.",
    deference: "The Houses require to be addressed by their full titles, all seven, in rotation.",
  },
  reapers: {
    coin: "The strike fund is full; the seed fund is empty; the Assembly is arguing about which is which.",
    arms: "The Scythe Rota would like something that is not a scythe, for the occasions that call for it.",
    medicine: "The Granges are down with the cough, in the one month when nobody can afford to be.",
    deference: "The Assembly would like it minuted that somebody finally asked them first.",
  },
  choir: {
    coin: "The Guild's rates have not kept pace with the Guild's ambitions.",
    arms: "The Guild has no army and would like the record to show it has never wanted one. It would like a small one.",
    medicine: "Business is poor: the lowlands are alarmingly healthy this season.",
    deference: "The Dirge-Master requires a proper bow, held for as long as a proper bow is held.",
  },
};

export const LIKES: Record<PowerId, readonly string[]> = {
  ward: ["receipts", "being asked first", "a proper salute", "tea that arrives hot"],
  rival: ["a signed form in triplicate", "exclusive rights", "optimistic projections", "the word synergy"],
  brine: ["an opening bid", "early payment", "being outbid with grace", "anything with a manifest"],
  reapers: ["a plain answer", "a show of hands", "fair weights", "being here before the rain"],
  choir: ["a fully paid funeral", "a correct bow", "precedent", "a witness who remembers the details"],
};
export const DISLIKES: Record<PowerId, readonly string[]> = {
  ward: ["surprises", "shortcuts across her bridge", "anyone who says 'improvement'"],
  rival: ["audits", "counter-offers", "a witness"],
  brine: ["tolls on tidal water", "dumping", "a fixed price"],
  reapers: ["being rushed", "middlemen", "a promise with an escape clause"],
  choir: ["unmarked graves", "people who die without paperwork", "levity at the wrong volume"],
};

/** Who cannot stand whom, and why. Symmetric: if A names B, B names A (tested). */
export const RIVALRIES: Record<PowerId, readonly { id: PowerId; why: string }[]> = {
  ward: [
    { id: "rival", why: "The Dunmarrow-Vesk Syndicate keeps offering to 'streamline' the crossing, which means owning it." },
    { id: "brine", why: "The Brine Houses charge her for the rain that falls on her own wall." },
    { id: "choir", why: "The Lamentation Guild keeps a better list of her dead than she does, and quotes it at her." },
  ],
  rival: [
    { id: "ward", why: "The Ward is an obstacle with a lamp on it." },
    { id: "brine", why: "The Houses undercut the Syndicate's freight and then sell it back the insurance." },
  ],
  brine: [
    { id: "ward", why: "The Ward will not pay for a tide that she can see for herself." },
    { id: "rival", why: "The Syndicate dumps cargo at a loss; the Houses regard that as a personal attack on arithmetic." },
    { id: "reapers", why: "The Granges sell grain at a fair price, which makes everyone else look bad." },
  ],
  reapers: [
    { id: "choir", why: "The Guild sends a bill for every harvest accident, and sometimes in advance." },
    { id: "brine", why: "The Houses buy the harvest at the dock and sell it back to the farmers as a luxury." },
  ],
  choir: [
    { id: "reapers", why: "The Granges bury their own, in silence, and for free. It is a scandal." },
    { id: "ward", why: "The Ward keeps people alive in a manner the Guild considers uncooperative." },
  ],
};

/** Hook kinds, three per minor power, in this order: a purchase, a favour, a price of refusal. */
export type HookKind = "purchase" | "favour" | "refusal";
export interface HookDef {
  kind: HookKind; id: string; title: string; text: string;
  /** Purchase: pounds. Favour: a signing sweetener the power pays (unused). Refusal: 0. */
  cost: number;
  /** Purchase: what the standing deal changes (carried by `flag`). Refusal: what the price of refusing changes. */
  fx?: Partial<PowerEffects>;
  /** The authored flag the hook sets (purchase on accept, favour = the errand in progress, refusal = the penalty). */
  flag: string;
  /** Favour: the resolutions that satisfy it. Refusal: unused. */
  satisfiedBy?: readonly string[];
  /** The relation the hook moves: on accept (purchase, favour) or when the price falls due (refusal). */
  rel?: Partial<Record<PairKey, number>>;
}

export const HOOKS: Record<MinorPowerId, readonly [HookDef, HookDef, HookDef]> = {
  brine: [
    { kind: "purchase", id: "tide_tables", title: "The Tide-Tables and a Weather Policy", cost: 45, flag: "brine_tides", fx: { sailDelta: -1, manifestPct: -5 }, rel: { "ward|brine": -4 },
      text: "A bound set of tide-tables, correct to the quarter-hour, and a policy against weather, valid until it rains." },
    { kind: "favour", id: "delayed_wagon", title: "A Syndicate Wagon, Misplaced", cost: 0, flag: "errand_brine", satisfiedBy: ["seized", "burned"], rel: { "rival|brine": -6 },
      text: "A Syndicate wagon is due at the ford. The Houses would be most obliged if it were late, or in a different condition. They will remember the kindness, at a rate." },
    { kind: "refusal", id: "markup", title: "The Houses Remember", cost: 0, flag: "brine_markup", fx: { manifestPct: 10, sailDelta: 1 }, rel: { "rival|brine": 10 },
      text: "Three refusals: the Houses mark up the quay, find the tides unsympathetic and take a meeting with the Syndicate." },
  ],
  reapers: [
    { kind: "purchase", id: "grain_contract", title: "A Contract for the Barley", cost: 30, flag: "reaper_grain", fx: { manifestPct: -10 }, rel: { "brine|reapers": 6 },
      text: "Grain at a fair weight, delivered to the dock before the rain, and a handshake that is also a contract." },
    { kind: "favour", id: "bring_home", title: "Bring a Hand Home", cost: 0, flag: "errand_reapers", satisfiedBy: ["rescued", "ransomed", "slipped_away"], rel: { "ward|reapers": 4 },
      text: "A harvest hand has gone missing in the scrub. The Assembly will be grateful. It will also minute the gratitude, which is the stronger of the two." },
    { kind: "refusal", id: "strike", title: "The Granges Down Tools", cost: 0, flag: "reaper_strike", fx: { manifestPct: 10 }, rel: { "ward|reapers": -10 },
      text: "Three refusals: the Assembly votes (a show of hands, unanimously) to see how you manage without grain." },
  ],
  choir: [
    { kind: "purchase", id: "ledger_of_the_dead", title: "The Ledger of the Dead", cost: 40, flag: "choir_ledger", fx: { intelDays: 1 }, rel: { "ward|choir": -4 },
      text: "The lowlands' only reliable records: who is where, who died of what, and who was seen leaving, in a hand that never tires." },
    { kind: "favour", id: "season_of_mourning", title: "A Respectable Season of Mourning", cost: 0, flag: "errand_choir", satisfiedBy: ["forced", "provoked", "escalated", "sabotaged"], rel: { "reapers|choir": -4 },
      text: "The Guild has a quiet season. It would not presume to suggest how business might improve. It has, however, drawn up a list." },
    { kind: "refusal", id: "gossip", title: "The Guild Talks", cost: 0, flag: "choir_gossip", fx: { tollDelta: 5 }, rel: { "ward|choir": 8 },
      text: "Three refusals: the Guild remembers, aloud and in detail, at every funeral in the lowlands, what you did." },
  ],
};

/** Every flag a PowersState may carry (<= 12): parsePowers drops anything else. */
export const AUTHORED_FLAGS: readonly string[] = [
  "brine_tides", "brine_markup", "reaper_grain", "reaper_strike", "choir_ledger", "choir_gossip", "errand_brine", "errand_reapers", "errand_choir", "party_post", "party_post_raided", "rival_unmasked",
];

/** What each flag changes elsewhere (summed by powerEffects). */
export const FLAG_FX: Readonly<Record<string, Partial<PowerEffects>>> = {
  brine_tides: { sailDelta: -1, manifestPct: -5 }, brine_markup: { manifestPct: 10, sailDelta: 1 }, reaper_grain: { manifestPct: -10 }, reaper_strike: { manifestPct: 10 },
  choir_ledger: { intelDays: 1 }, choir_gossip: { tollDelta: 5 },
};

/** The audience: how each minor power opens (>= 3 each; picked by hash3) and answers. `{speaker}` `{cost}` `{title}` are filled in. */
export const INTRO: Record<MinorPowerId, readonly string[]> = {
  brine: [
    "{speaker} receives you on the quay with a pen in one hand and a parasol in the other. 'Everything is for sale, including this conversation. I am discounting it for you.'",
    "{speaker} has the harbour bell rung once, which is the signal that a deal is in the air. 'We have been waiting for somebody who reads small print.'",
    "'The tide waits for no one,' says {speaker}, 'except at a surcharge.'",
  ],
  reapers: [
    "{speaker} meets you at the edge of a field, boots in the stubble, and does not stop work. 'Walk with me. I can listen and cut at the same time.'",
    "The Assembly votes to hear you. It is carried by a show of hands, narrowly, and the hands are very large.",
    "{speaker} lays down a scythe, which is how you know it is serious. 'Say it plain. We are plain people.'",
  ],
  choir: [
    "{speaker} arrives in full black, a half step behind a procession that has no corpse in it. 'Rehearsal,' he says. 'One must be ready.'",
    "In the Long Cloister, {speaker} holds out a hand to be kissed, then to be shaken, then to be paid. 'Do sit. The chairs are from the last funeral.'",
    "{speaker} produces a ledger with your name already on a page. 'Only a courtesy entry. We like to be early.'",
  ],
};

export const REPLY: Record<MinorPowerId, Record<"accepted" | "haggled" | "bribed" | "refused" | "hostile", readonly string[]>> = {
  brine: {
    accepted: ["'Done. The Houses are delighted, which is expensive for somebody.'", "'A pleasure. Sign here, here and, in a smaller hand, here.'", "'Excellent. It is so rare to be paid on the first bid.'"],
    haggled: ["'You drive a hard bargain. The Houses will mention it to their grandchildren, and charge for the story.'", "'A discount! We will not forget it. We will invoice it.'", "'Fine. But the tide takes its own cut.'"],
    bribed: ["'This did not happen, and I have the receipt to prove it.'", "'How thoughtful. I will pretend I did not count it.'", "'A gift, between friends, entered under miscellaneous.'"],
    refused: ["'Of course. The offer remains open, at the price of next time.'", "'No? How refreshingly cheap of you.'", "'The Houses will note it. The Houses note everything.'"],
    hostile: ["'You have insulted the tide. The tide does not accept apologies.'", "'Escort them to the pier. The long way. Over the water.'", "'Threats! We had those seven years ago. We bought them out.'"],
  },
  reapers: {
    accepted: ["'Agreed, and written down, and every hand raised. That is as binding as stone.'", "'Good. We shake on it. Count your fingers afterwards, it is a joke.'", "'Then it is done. Come to the Grange for the harvest supper.'"],
    haggled: ["'Fair. Not generous, but fair, which lasts longer.'", "'You have a way with a sum. The Assembly approves.'", "'We will take that. We have taken less from stranger folk.'"],
    bribed: ["'We do not take that sort of thing. ... Put it on the table. Under the cloth.'", "'The Assembly did not see this. Several members did, individually.'", "'Hm. Well. The barley does not care how it was paid for.'"],
    refused: ["'Plain enough. We will remember it plainly.'", "'No is an answer. It is a cheap answer. It will cost more later.'", "'The Assembly will vote on how much to mind.'"],
    hostile: ["'You raise your voice in a field full of scythes. That is a decision.'", "'Go home. Quickly. Not to say we will not follow.'", "'We were polite. We have been polite since the autumn. We are tired.'"],
  },
  choir: {
    accepted: ["'Splendid. The Guild will see you are properly attended, whichever way it goes.'", "'Marked in the book, in the good ink.'", "'A transaction. How refreshing: so few of our clients are alive for it.'"],
    haggled: ["'A discount rate. We have those for the families of the recently bereaved. You will do.'", "'Very well. The Guild is generous in the shadow of a great loss.'", "'Done. But we sing the reduced version.'"],
    bribed: ["'Your sorrow is noted, and so is the amount.'", "'The Guild does not accept tips. It accepts gratuities, which are different.'", "'How kind. How very, very kind. We shall be gentle with the details.'"],
    refused: ["'We shall wait. We are, by training, very patient.'", "'Of course. Come back when you are bereaved.'", "'It is noted. It is noted in several columns.'"],
    hostile: ["'You will be remembered. Not fondly. At length.'", "'Show them the door. It is the black one, with the lilies.'", "'Rude. Rude and, I note, mortal.'"],
  },
};

/** Pair-state headlines and bodies for the paper (>= 3 each). `{a}` and `{b}` are the powers' short names. */
export const POWER_SHORT: Record<PowerId, string> = { ward: "the Ward", rival: "the Syndicate", brine: "the Brine Houses", reapers: "the Reapers", choir: "the Guild" };
export interface NewsDef { head: readonly string[]; body: readonly string[] }
export const NEWS: Record<string, NewsDef> = {
  ...endingNews(VESPER_COPY), ...endingNews(SALTMARKET_COPY), ...endingNews(REAPERS_COPY), ...endingNews(ENGINE_COPY), ...endingNews(RAID_COPY),   // D-037: `end_<resolution>`, one dispatch per ending of Vesper Gorge and the Saltmarket Delta (regionEndings.ts)
  rel_feud: {
    head: ["{A} and {b} Not Speaking, Loudly", "Feud Declared Between {a} and {b}", "{A} Withdraws Its Compliments From {b}"],
    body: ["Insults have been exchanged in both directions, in writing, with a postage surcharge. Neither side has fired a shot, yet. Both sides have bought ammunition.", "Observers describe the rift as 'considerable' and 'fully catered'. The Society takes no side and has offered to sell to both.", "A representative of each said the other started it. The Society is minded to agree with both."],
  },
  rel_cold: {
    head: ["Frost Between {a} and {b}", "{A} Cools Toward {b}", "Chill in the Air: {a} and {b}"],
    body: ["Nobody has been rude on the record. This is considered ominous. The last time it was this quiet, an ambassador was lost in a cupboard.", "Bows are shorter, receipts are longer. The Society recommends not standing between them.", "Polite notes are being exchanged at a rate of one a day, each slightly more polite than the last."],
  },
  rel_civil: {
    head: ["{A} and {b} Resume Civilities", "Thaw: {a} Nods to {b}", "{A} and {b} Agree About the Weather"],
    body: ["A truce of the sort that can be written on a napkin has been written on a napkin.", "Both parties have agreed that neither will bring up the matter, which has been the matter for years.", "The nod was observed by three witnesses, all of whom billed for it."],
  },
  rel_trade: {
    head: ["{A} and {b} Open a Trading Account", "Goods Move Between {a} and {b}", "{A} Extends {b} a Line of Credit"],
    body: ["Carts are moving in both directions, which the Society regards as a rumour of civilisation. Tariffs will follow.", "Mutual dependency has been established. The paperwork is expected to be worse than the dependency.", "Both sides call it a partnership. Both sides have counted the spoons."],
  },
  rel_pact: {
    head: ["{A} and {b} Sign a Pact", "Alliance: {a} and {b} Close Ranks", "{A} Stands With {b}, Mostly"],
    body: ["A pact of mutual support has been signed in the presence of witnesses and a very small band. The Society has asked to be an observer and been placed on a list.", "Their friends are delighted. Their enemies are invoicing.", "A treaty so warm that the Society has been advised to look into its own."],
  },
  deal_brine: {
    head: ["Houses Strike a Deal With the Society", "Tide-Tables Change Hands", "Brine Houses Sell Society a Little Weather"],
    body: ["A set of tide-tables was bought at a price the Houses described as 'a friendship'. The Society has not been told to which friendship.", "The Houses report that the weather has been policy-covered and the sea is reminded of its obligations.", "Sailings are expected to be a touch shorter and the invoices a touch longer."],
  },
  deal_reapers: {
    head: ["Grain Contract Signed at the Granges", "Reapers Shake on It", "Barley Sold, Hands Raised"],
    body: ["The Granges have agreed a fair weight and a fair price, which has startled everyone present, including the weights.", "The Assembly voted and, for the first time in living memory, so did the barley.", "Provisions are expected to be cheaper and, extraordinarily, correct."],
  },
  deal_choir: {
    head: ["Lamentation Guild Opens Its Ledger", "Records Purchased From the Long Cloister", "The Dead Are Consulted"],
    body: ["The Guild has sold a set of its registers to the Society. The Guild says the dead did not object. The dead were not asked.", "Who lived where and who died of what is now, regrettably, a matter of public record, at a modest fee.", "Information is expected to travel faster. Mourning, as ever, travels at its own pace."],
  },
  price_brine: {
    head: ["Brine Houses Mark Up the Quay", "The Tide Turns, At a Price", "Houses Take a Meeting With the Syndicate"],
    body: ["Three refusals were more than the Houses could comfortably absorb. Quayside prices have risen to reflect hurt feelings.", "The Houses insist this is not a punishment. It is a rebalancing of expectations, with interest.", "A cutter flying a Syndicate pennant has been seen tied up at the Saltmarket. Nobody is saying anything. They are saying it loudly."],
  },
  price_reapers: {
    head: ["Granges Down Tools", "Strike at the Barley", "The Assembly Votes to Wait and See"],
    body: ["After three refusals the Reapers have voted, by a show of hands, to see how the expedition manages without them. Provisions have become expensive.", "No scythe was raised in anger. Several were raised in a meaningful way.", "It is the quietest strike in recent history and the most effective."],
  },
  price_choir: {
    head: ["The Guild Has Been Talking", "At Every Funeral in the Lowlands, A Mention", "Lamentation Guild Remembers"],
    body: ["After three refusals the Guild has begun to include the party in the eulogies. The Ward has noticed, and has put up the toll.", "It is not libel if it is read aloud at a graveside. The Society has consulted counsel, who was unavailable: he was at a funeral.", "Reputations, in the lowlands, are now arranged by committee. You were not on it."],
  },
  favour_brine: {
    head: ["Syndicate Wagon Delayed, Nobody Responsible", "Brine Houses Express Thanks, Quietly", "A Favour Is Owed at Saltmarket"],
    body: ["The Houses had no hand in the matter and will be sending a gift to whoever did. It will arrive at a moment of their choosing.", "A convoy was troubled. The Houses are grateful. Their gratitude is being entered in a ledger.", "Somebody owes somebody. It is the Houses who owe you, which is a first."],
  },
  favour_reapers: {
    head: ["A Harvest Hand Comes Home", "The Granges Are Grateful, in Writing", "The Assembly Minutes Its Thanks"],
    body: ["A missing hand has been returned to the Granges, hungry and cross, and gladdened to see the barley still standing.", "The Assembly has put the favour in the minutes, which is the rural equivalent of a statue.", "You have a friend in the lowland, which will not cost you anything until it does."],
  },
  favour_choir: {
    head: ["Lamentation Guild Enjoys a Busy Season", "Business at the Long Cloister Picks Up", "The Guild Sends Its Compliments"],
    body: ["The Guild wishes to thank the Society for the sudden uptick in custom. It has hired two additional mutes.", "It would not presume to say the expedition caused anything. It will, however, say it was in the neighbourhood.", "A basket of lilies has arrived at the Depot, unsolicited, and invoiced."],
  },
  // Highmark's chair (D-036): one dispatch per ending, printed from the Reapers' log entry `chair_<ending>`. {a} is the Reapers, {b} the Guild (the Houses at a sale).
  chair_backed_elder: {
    head: ["Assembly Ratifies Princess Orla; Barley Unaffected", "Highmark Seats the Elder, by a Show of Hands", "Reapers Vote Seniority, Then Go Home to the Harvest"],
    body: ["{A} raised two scythes, then three, and the chair at Highmark has an occupant who would like it noted that she is the elder. The Guild will certify the King's death at a fee, and the King will remain, for administrative purposes, in the building.", "The Assembly carried the vote by a majority of scythes. The Guild has begun drafting a certificate of pendingness, with a black border and a surcharge.", "The new reign began at the harvest bell and is expected to last until the next form. {A} has asked to be thanked in writing, in a large hand."],
  },
  chair_backed_younger: {
    head: ["Reapers Acclaim Prince Dunstan, Mostly Aloud", "Highmark Crowns the Young; Seniority Files a Complaint", "The Assembly Votes With Its Ears"],
    body: ["{A} was fed, and voted, in that order, for a prince who stood nearest the buffet. The Guild has agreed to certify the King, and has applied to certify the Princess's disappointment too.", "The vote was carried by acclamation, which is a number that only goes up. The band has been paid and will be paid again.", "Observers described the chair's new occupant as 'confident'. The Grange described him as 'a lot of band'."],
  },
  chair_regency: {
    head: ["Highmark Settles on Three Signatures and No Chair", "Regency at Highmark; the King Remains Pending", "Assembly Votes for a Committee, Which Is Called Stability"],
    body: ["{A} ratified a regency of three signatures, the barley-hands up in a show that the Guild declined to certify as a death. Nobody sits in the chair, which is the compromise.", "It is the first agreement the court has reached in six years and it is an agreement to keep disagreeing, in a nice room.", "The Chamberlain is said to be delighted, and has been seen to smile, which is being investigated."],
  },
  chair_usurped: {
    head: ["Chair at Highmark Occupied Overnight; Court Seeks Adjectives", "Palace Calls the Matter 'an Early Succession'", "Reapers Look Away, Politely, as the Guard Is Rearranged"],
    body: ["The chair changed hands in a manner the court is still deciding how to spell. {A} abstained; the Guild has been asked to certify something and has asked for a larger black border.", "The Assembly voted after the fact, which in Highmark is a form of procedure. The guard has been reassigned, mostly to the floor.", "Everyone has agreed it was irregular. Everyone has agreed to call it early. The Society was 'in the building'."],
  },
  chair_crown_sold: {
    head: ["Crown's Concession Sold to the Syndicate; Hat Retained", "Highmark's Chair Auctioned Subject to Contract", "Houses Furious: the Syndicate Has Their Concession"],
    body: ["A cheque changed hands and so, by the end of the afternoon, did the Crown. {A} took the news in silence and the barley in the usual way; {b} wanted to know who had priced it.", "The Chamberlain countersigned in the full seal of the court, which is large and has a stag on it. The Assembly was consulted, in the sense that it was in the room.", "The Houses have taken a meeting. The meeting has taken a long time, and a larger room."],
  },
  settle_founded: {
    head: ["Society Plants a Flag at Kessar", "A Post Is Founded; Brine Houses Pleased", "Foundation Laid, Syndicate Displeased"],
    body: ["A foundation of four crates has been laid south of the bridge. The Houses call it a market in waiting. The Syndicate calls it a competitor in waiting. The Ward calls it an assessment.", "The Society has a new post. It also has a new neighbour, who has just been told.", "The first crate went down at dawn. The fourth, by lunchtime, with a speech."],
  },
  settle_raided: {
    head: ["Society Post Subject to Unscheduled Inspection", "An Outpost Has Been Visited", "Raid on the Post: Everyone Regrets It Politely"],
    body: ["An outpost was visited in the night by persons who left no cards. Damage is described as 'communicative'.", "The Society regards the matter as an inspection and reserves its right to be inspected back.", "Nobody has claimed responsibility. Everyone has claimed to be shocked."],
  },
  settle_abandoned: {
    head: ["Outpost Left to the Weather", "A Foundation Goes Back to Grass", "Post Quietly Written Off"],
    body: ["The post has been written off the books. The grass has been told it may come back.", "What was a camp is a patch of trodden mud with some regrets in it.", "The Society insists that the post was 'rested', not abandoned, in the manner of a field."],
  },
};
