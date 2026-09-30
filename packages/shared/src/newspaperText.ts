import type { ResolutionId, FactionStance } from "./campaignTypes.ts";

/**
 * Authored text for the Society's house paper. The paper is the Expeditionary Society talking about itself: every defeat is a "repositioning", every corpse a
 * "staffing adjustment". Satire aimed at institutions and their press offices. Everything named is fictional.
 * Placeholders: {toll} {bridge} {dead} {routed} {wounded} {limbs} {civ} {spin} {purse} {lies}.
 */

export type HeadKey = ResolutionId | "none";

export const MASTHEADS: readonly string[] = [
  "The Hollowmere Expeditionary Gazette",
  "The Society Sentinel & Evening Reassurance",
  "The Hollowmere Bugle of Progress (Revised Daily)",
  "The Depot Dispatch, Approved for Circulation",
];

export const DATELINE_TAIL: readonly string[] = [
  "Weather: improving, as instructed.", "Price: one penny, or a modest opinion.", "All news approved by the News.", "Weather: a matter for the Committee.",
  "Circulation: rising, in a sense.", "Corrections appear on page nine, in small type.",
];

export const HEADLINES: Record<HeadKey, readonly string[]> = {
  paid: [
    "Society Settles Kessar Toll in Full; Ledger Delighted",
    "£{toll} Buys Passage and Mutual Respect at Kessar Crossing",
    "Orderly Payment Ends Kessar Standoff: Nobody Shot, Everybody Invoiced",
    "Toll Paid at Kessar: A Triumph of Receipts",
    "Gentlemen Cross Bridge After Brisk Exchange of Coin",
  ],
  bargained: [
    "Society Talks Kessar Toll Down to £{toll}; Warden \"Practically Smiles\"",
    "Haggle at the Nine Lamps Ends in Handshake and Discount",
    "Diplomacy Triumphs at Kessar: Toll Reduced to £{toll}",
    "Lamp-Warden Concedes Point on Price; Point Was Sharp",
    "Tea, Tact and a Bargain: Kessar Crossing Opens Cheaply",
  ],
  bribed: [
    "Quiet Gratuity Eases Passage at Kessar Bridge",
    "Society Commends Kessar Quartermaster's Hospitality",
    "\"Facilitation Fee\" Opens Kessar Crossing; Toll Waived",
    "Garrison Welfare Fund Enjoys Generous Week",
    "Bridge Opens After Informal Understanding, Informally Understood",
  ],
  forced: [
    "Decisive Strategic Repositioning of Kessar Garrison Achieved",
    "Kessar Crossing Liberated; {dead} Residents Relocated Permanently",
    "Society Secures Kessar Bridge by Firm Persuasion",
    "Garrison Yields to Sustained Enthusiasm; Toll Abolished",
    "Gunfire at Kessar: Society Calls It \"Robust Dialogue\"",
  ],
  sabotaged: [
    "Kessar Bridge Succumbs to Structural Enthusiasm",
    "Bridge Takes Early Retirement; Society \"Nowhere Near\"",
    "Sudden Fluvial Improvement at Kessar: Bridge Now River",
    "Unscheduled Demolition Closes Kessar Crossing",
    "Engineers Baffled as Kessar Bridge Leaves Service Abruptly",
  ],
  rival_secured: [
    "Syndicate Acquires Kessar Crossing; Society \"Was Just About To\"",
    "Dunmarrow-Vesk Men Buy Kessar Bridge While Society Dithers",
    "Rivals Take Toll at Kessar; Society Reviews Its Punctuality",
    "Competitive Courtesy: Syndicate Secures Bridge at Kessar",
    "Kessar Crossing Changes Hands; Society Notes It Was Not Invited",
  ],
  abandoned: [
    "Society Achieves Decisive Strategic Repositioning at Kessar",
    "Expedition Returns Early, on Purpose",
    "Kessar Left for Later, Says Society; Later Not Specified",
    "Tactical Pause at Kessar Bridge Expected to Continue Indefinitely",
    "Society Withdraws With Honour, Some of It",
  ],
  none: [
    "Society Announces Bold New Programme of Improving Places",
    "Expedition Fund Open; Prospectuses at the Depot",
    "Kessar Reach Awaits Its Benefactors",
    "Map Room Open; Colonies Reported to Be There",
    "Hollowmere Depot Readies for Departures",
  ],
};

export const STANDFIRSTS: Record<HeadKey, readonly string[]> = {
  paid: [
    "The Society settled the Ward's £{toll} toll at Kessar in full and in coin. The bridge is {bridge}. {spin}",
    "Having paid £{toll} at the toll bar, the expedition crossed with dignity and receipts intact; the bridge is {bridge}. {spin}",
    "A £{toll} toll, cheerfully disputed and then paid, leaves Kessar's bridge {bridge} and the Lamp-Warden unusually punctual. {spin}",
    "Officials call the £{toll} payment \"an investment in goodwill\". The bridge is {bridge}. {spin}",
  ],
  bargained: [
    "After robust courtesy the Ward accepted £{toll}, well below its opening figure. The bridge is {bridge}. {spin}",
    "The toll fell to £{toll} across a single tense pot of tea. The bridge is {bridge}. {spin}",
    "The Lamp-Warden was talked down to £{toll} and is said to be \"reviewing her position\", with pikes nearby. The bridge is {bridge}. {spin}",
    "Society negotiators secured a £{toll} crossing and a story they will tell for years. The bridge is {bridge}. {spin}",
  ],
  bribed: [
    "A discreet gratuity opened Kessar's crossing; the official toll (£{toll} now recorded) is waived. The bridge is {bridge}. {spin}",
    "Nobody paid the toll (£{toll}) and nobody saw who did not. The bridge is {bridge}. {spin}",
    "The garrison's welfare fund enjoyed an unscheduled windfall; the toll stands at £{toll}. The bridge is {bridge}. {spin}",
    "Sources near the quartermaster confirm a generous misunderstanding and a toll of £{toll}. The bridge is {bridge}. {spin}",
  ],
  forced: [
    "The Kessar garrison was persuaded, at length and from close range, to abolish its toll (now £{toll}). The bridge is {bridge}. {spin}",
    "Society forces took the crossing after what officials call \"a frank exchange of lead\". Toll: £{toll}. Bridge: {bridge}. {spin}",
    "The hill fort's defenders withdrew in good order, or at least in some order. Toll £{toll}; the bridge is {bridge}. {spin}",
    "Kessar is \"secured\". The toll (£{toll}) has been abolished with extreme prejudice. The bridge is {bridge}. {spin}",
  ],
  sabotaged: [
    "An unexplained event at mid-span has left Kessar's bridge {bridge}. The toll, £{toll}, now has nothing to be collected on. {spin}",
    "Engineers attribute the bridge's new state, {bridge}, to \"structural enthusiasm\". Toll: £{toll}. {spin}",
    "The Society was \"nowhere near\" when Kessar's bridge became {bridge}, and has receipts to prove it. Toll: £{toll}. {spin}",
    "The crossing is closed: the bridge is {bridge} and the £{toll} toll is academic. {spin}",
  ],
  rival_secured: [
    "While the Society considered its options, the Syndicate bought Kessar's crossing. Toll: £{toll}. Bridge: {bridge}. {spin}",
    "Dunmarrow-Vesk agents took the toll bar (£{toll}) in one tidy minute. The bridge is {bridge}. {spin}",
    "Rivals now collect £{toll} at Kessar and have put up a sign about it. The bridge is {bridge}. {spin}",
    "The Society \"graciously conceded\" Kessar, which it had not yet reached. Toll £{toll}; bridge {bridge}. {spin}",
  ],
  abandoned: [
    "The expedition has left Kessar in what officials call \"decisive strategic repositioning\". The bridge is {bridge}; the toll, £{toll}, remains. {spin}",
    "Having looked at Kessar, the Society has elected to look elsewhere. Toll: £{toll}. Bridge: {bridge}. {spin}",
    "Nothing was crossed, nothing was paid, and all of it was deliberate. The bridge is {bridge}; toll £{toll}. {spin}",
    "The retreat from Kessar, previously described as a retreat, is now described as timing. Bridge {bridge}; toll £{toll}. {spin}",
  ],
  none: [
    "The Society's programme for Kessar Reach is \"fully costed\", apart from the costs. The Ward's asking toll is £{toll}; the bridge is {bridge}.",
    "Expeditions depart at the Depot's convenience. Kessar's toll is reported at £{toll}; the bridge is {bridge}.",
    "Kessar Reach awaits: toll £{toll}, bridge {bridge}, garrison unamused.",
  ],
};

/** The euphemism treadmill: tiers by count. First tier whose `upTo` holds; variety by hash. */
export const SPIN_DEAD: readonly { upTo: number; lines: readonly string[] }[] = [
  { upTo: 0, lines: ["Nobody was inconvenienced in any lasting way.", "Not one person was repurposed.", "The mortality figures remain pleasingly theoretical."] },
  { upTo: 2, lines: ["Persons retired from active service: {dead}.", "The garrison's roll was tidied by {dead}.", "{dead} names were struck from the rota, with regret and a blotter."] },
  { upTo: 5, lines: ["{dead} defenders were \"rebalanced out of the workforce\".", "A modest {dead} were relocated to the hillside, horizontally.", "Garrison strength was \"streamlined\" by {dead}."] },
  { upTo: 9999, lines: ["{dead} residents underwent decisive strategic repositioning.", "The hill received {dead} new permanent residents.", "Manpower was \"right-sized\" by {dead} in a single afternoon."] },
];
export const SPIN_ROUTED: readonly string[] = [
  "{routed} defenders made a decisive strategic repositioning, at speed, in several directions.",
  "{routed} sentries \"rapidly explored other careers\".",
  "{routed} members of the garrison \"withdrew to prepared positions\", namely anywhere else.",
];
export const SPIN_LIMBS: readonly string[] = [
  "{limbs} limbs were \"reallocated to other departments\".",
  "{limbs} limbs have left the expedition early, for personal reasons.",
  "{limbs} limbs are \"under review\" and, mostly, under the bridge.",
];
export const SPIN_WOUNDED: readonly string[] = [
  "{wounded} persons reported \"a spirited bruising\".",
  "{wounded} casualties are being described as \"enthusiastically inconvenienced\".",
];
export const SPIN_CIVIL: readonly string[] = [
  "{civ} locals were \"cooperatively relocated\".",
  "{civ} villagers took \"an unplanned holiday\".",
];
export const BRIDGE_CASUAL: Record<"intact" | "rigged" | "collapsed", readonly string[]> = {
  intact: ["The bridge stands, to its credit.", "The bridge is, for the moment, a bridge."],
  rigged: ["The bridge has been \"prepared for maintenance\".", "The bridge has been given a great deal of attention."],
  collapsed: ["The bridge has \"left the service\".", "The bridge has been reclassified as a river feature."],
};

export const LEDGER_TAIL: readonly string[] = [
  "Figures audited by the people who made them.", "All figures are provisional and most are final.", "The Society regrets any accuracy.",
  "Please do not compare with the Ward's figures, which are worse and earlier.",
];

export const STORY_HEADS = {
  ledger: ["The Crossing in Figures", "Kessar by the Numbers", "What the Ledger Says"],
  casualty: ["The Casualty Desk Reports", "Regarding Recent Events, Briefly", "Health and Vigour Notes"],
  ward: ["The Lamp-Warden Responds", "From the Hill: A Statement", "Kessar Speaks, Briefly"],
  rival: ["Rivals Watch: the Dunmarrow-Vesk Syndicate", "The Syndicate Would Like a Word", "Competitors' Corner"],
  scandal: ["Quartermaster's Boots Raise Questions", "A Gratuity Recalled", "Whispers From the Toll Bar"],
  promise: ["Promises, Kept and Otherwise", "On the Matter of Our Word"],
  filler: ["Hollowmere Parish Notes", "Depot Diary", "Notes From the Notice Board"],
  prospectus: ["Kessar Reach in Brief", "Prospectus: Kessar", "The Colony, Explained"],
} as const;

export const WARD_SAYS: Record<FactionStance, readonly string[]> = {
  hostile: [
    "\"The Society's name is now a swearword on the wall. We use it at roll-call.\"",
    "\"Put it in the ledger that we are not speaking to you, and that the ledger is also not speaking to you.\"",
  ],
  wary: [
    "\"We will keep the lamps lit and the ledger open. You may take that however you like.\"",
    "\"I have no complaints. I have a list, and it is not finished.\"",
  ],
  neutral: [
    "\"Business is business. We do it on a bridge.\"",
    "\"The Society pays or does not, and I write it down either way. It is restful.\"",
  ],
  warm: [
    "\"The Society is welcome at Kessar. Our welcome is priced, but warmly.\"",
    "\"We have put a chair out for the Society. It is a good chair. Do not sit on the other one.\"",
  ],
  allied: [
    "\"The Nine Lamps stand with our friends. The ninth especially, it is the one with the tax.\"",
    "\"Between the Ward and the Society there is perfect trust, and a perfectly audited ledger.\"",
  ],
};

export const RIVAL_TIERS: readonly { upTo: number; lines: readonly string[] }[] = [
  { upTo: 34, lines: ["The Dunmarrow-Vesk Syndicate was not available for comment, and was not seen near the powder cart.", "Syndicate surveyors are reported to be \"merely admiring the river\"."] },
  { upTo: 59, lines: ["Syndicate agents have been seen measuring the toll bar. For curtains, they say.", "The Syndicate has opened a \"friendly office\" near Kessar. It has a great many chairs."] },
  { upTo: 100, lines: ["The Syndicate now advises the Ward on \"efficiency\". The Ward has stopped returning our letters.", "It is increasingly difficult to tell where the Syndicate ends and the Ward's ledger begins."] },
];

export const SCANDAL = {
  landed: [
    "The Lamp-Warden has read the quartermaster's accounts and, it is said, his boots. The Society \"deplores any appearance of hospitality\".",
    "A Syndicate source has shared a receipt. The Society's position is that receipts are a matter of interpretation.",
  ],
  pending: [
    "Whispers at the toll bar suggest a quartermaster with new boots and no explanation. The Society has nothing to add.",
    "It is rumoured that somebody, somewhere, is about to be embarrassed. The Society is surprised to hear it.",
  ],
} as const;

export const PROMISES: readonly string[] = [
  "The Society has given {lies} assurances it did not keep. Officials prefer \"rolling commitments\".",
  "{lies} undertakings are \"in progress\", where \"progress\" means a direction away from them.",
];

export const FILLER: readonly string[] = [
  "The Hollowmere geese have again declined to be surveyed. A strongly worded form has been issued to them.",
  "The Clockkeeper reports it is very nearly the hour. The hour could not be reached for comment.",
  "A bench has been proposed for the green. Three committees will now decide how to sit on it.",
  "The baker wishes it known that the bread is not a metaphor. Orders are taken until the loaves run out.",
  "The ferryman thanks the public for its patience, and the water for its cooperation.",
  "Miss Pell's hens laid eleven eggs yesterday, a number the Registrar is treating as a rumour.",
];

export const NOTICES: readonly string[] = [
  "WANTED: one sturdy rope, no questions. Apply to the Depot stores.",
  "LOST: an opinion of the Committee's. Finder is asked to keep it.",
  "FOR SALE: pikes, lightly dented, from a clearance sale of the Kessar sort.",
  "THE Hollowmere Band practises nightly. Complaints may be addressed to the Band.",
  "WANTED: cheerful bearers for hire. Must tolerate bridges and opinions.",
  "FOUND: one boot, apparently an officer's. Claim at the geese.",
  "TO LET: a room with a view of a map. The map is better than the view.",
  "TEA IS AVAILABLE AT THE DEPOT. THE TEA IS NOT A METAPHOR.",
  "SEEKING: a surgeon of any kind. Hours flexible; blood no object.",
  "LOST: a dog named Procedure. Answers to nothing. Last seen near the ledger.",
  "NOTICE: the Depot's complaints box has been moved. Complaints are invited to find it.",
  "FOR SALE: ambition, one slightly used, going cheap after the Kessar review.",
  "TUITION: drill, salutes, and the proper folding of surrender. Ask for Mrs. Orme.",
  "WANTED: fresh linen. The Society's last supply has been put to a use.",
  "NOTICE: the new flag is the old flag, reversed. Please stop asking.",
  "REWARD for information leading to the return of a bridge.",
];

export const NOTICE_COND = {
  collapsed: "WANTED: one bridge, lightly used. Apply to the Lamp-Warden, Kessar.",
  free: "FREE CROSSINGS at Kessar. Terms apply. Terms are a pike.",
  rival: "NOTICE: Kessar crossing now under Dunmarrow-Vesk management. Smile for the camera.",
  scandal: "LOST: one quartermaster's discretion. Generous reward, quietly.",
} as const;
