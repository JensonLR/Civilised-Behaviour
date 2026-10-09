import type { ResolutionId, FactionStance } from "./campaignTypes.ts";
import { pluck } from "./regionEndings.ts";
import { ENGINE_COPY, ENGINE_STORY_HEADS } from "./engineText.ts";
import { RAID_COPY, RAID_STORY_HEADS } from "./raidText.ts";
import { HUNT_COPY, HUNT_STORY_HEADS } from "./huntText.ts";
import { REAPERS_COPY, REAPERS_STORY_HEADS } from "./reapersText.ts";
import { SALTMARKET_COPY, SALTMARKET_STORY_HEADS } from "./saltmarketText.ts";
import { VESPER_COPY, VESPER_STORY_HEADS } from "./vesperText.ts";

/**
 * Authored text for the Society's house paper. The paper is the Expeditionary Society talking about itself: every defeat is a "repositioning", every corpse a
 * "staffing adjustment". Satire aimed at institutions and their press offices. Everything named is fictional.
 * Placeholders: {toll} {bridge} {dead} {routed} {wounded} {limbs} {civ} {spin} {purse} {lies}.
 */

export type HeadKey = ResolutionId | "none";

export const MASTHEADS: readonly string[] = [
  "The Imperial Gazette of London & Hollowmere",
  "The Britannia Sentinel & Evening Reassurance",
  "The Hollowmere Bugle of Empire (Revised Daily)",
  "The Depot Dispatch, By Appointment to Her Majesty",
];

export const DATELINE_TAIL: readonly string[] = [
  "Weather: improving, as instructed.", "Price: one penny, or a modest opinion.", "All news approved by the News.", "Weather: a matter for the Committee.",
  "Circulation: rising, in a sense.", "Corrections appear on page nine, in small type.",
];

export const HEADLINES: Record<HeadKey, readonly string[]> = {
  ...pluck(VESPER_COPY, "headlines"), ...pluck(SALTMARKET_COPY, "headlines"), ...pluck(REAPERS_COPY, "headlines"), ...pluck(ENGINE_COPY, "headlines"), ...pluck(RAID_COPY, "headlines"), ...pluck(HUNT_COPY, "headlines"),   // D-037 (regionEndings.ts)
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
  // ---- D-034: the other three contracts (all fictional; the Society's press office talking about itself) ----
  ransomed: [
    "Mr. Quim Returns From Hangman's Orchard, Invoiced",
    "Deserters Accept Society's Offer; Society Insists It Was a Courtesy",
    "Ransom Paid at the Orchard, Described as \"Facilitation of Travel\"",
    "Surveyor Recovered at Competitive Rates",
  ],
  rescued: [
    "Mr. Quim Rescued; Rescue Described as \"Roughly on Schedule\"",
    "Orchard Cleared of Deserters in Brisk Society Operation",
    "Surveyor Home, Deserters Repositioned: Society Calls It \"a Rounded Result\"",
    "Cage Wagon Opened by Firm Persuasion; {dead} Persons Reassigned",
  ],
  slipped_away: [
    "Surveyor Quim Walks Out of the Orchard; Nobody Can Say How",
    "Society Achieves Quiet Triumph; Quiet Triumph Declines Comment",
    "Cage Found Open, Deserters Found Asleep, Society Found Elsewhere",
    "The Orchard Rescue That Did Not Happen, Successfully",
  ],
  hostage_lost: [
    "Surveyor Quim \"Detained Indefinitely\"; Society Cites Complexity",
    "Mr. Quim Reclassified as \"Overtaken by Events\"",
    "Insurers Unmoved as Orchard Matter Concludes Badly",
    "Syndicate Collects Surveyor at the Orchard, Politely, by Cheque",
  ],
  seized: [
    "Society Takes Syndicate Wagon in the Dry Cut; Syndicate Takes Notes",
    "Cargo \"Recovered\" From a Convoy Nobody Had Lost",
    "Three Crates Change Hands Without Receipts, Mostly",
    "Wagon Acquired in the Cut; Provenance Described as \"Brisk\"",
  ],
  tipped_off: [
    "Ward Pickets Foil Syndicate Convoy; Society \"Delighted to Have Been Nowhere Near\"",
    "Anonymous Tip Springs Ambush at the Dry Cut",
    "Ward and Society Not Co-operating, in Perfect Harmony",
    "Picket Corporal Thanks Public for Information It Did Not Give",
  ],
  burned: [
    "Syndicate Wagon Succumbs to Spontaneous Combustion",
    "Powder, Wagon, Crates Lost in \"Entirely Unattributable\" Blast",
    "The Dry Cut Lives Up to Its Name for About Four Seconds",
    "Convoy Reclassified as a Bonfire; Nobody Takes Credit",
  ],
  passed: [
    "Syndicate Wagon Reaches Ford; Society Reports Having Watched",
    "Convoy Arrives Unmolested; Syndicate Thanks Nobody in Particular",
    "Rivals Armed at the Ford While Society Reviews Its Options",
    "Wagon Delivered; Society's Intentions Declared Impeccable and Late",
  ],
  mediated: [
    "Marker Stone No. 4 Placed Under Joint Survey; Both Sides Claim Credit",
    "Peace at the Ford, Signed in Triplicate",
    "Border Dispute Settled by Paperwork, the Least Shootable Weapon",
    "Ward and Syndicate Agree to Measure the Same Stone, in the Same Hour",
  ],
  sided_ward: [
    "Ward Patrol Detains Society Witnesses; Syndicate Leaves the Ford",
    "Syndicate Plan Disclosed to Ward; Society Cites \"Civic Duty\"",
    "Surveyors Depart Marker Stone No. 4 in Good Order, and Some Haste",
    "Ward Thanks Society for Information, Then Detains It",
  ],
  sided_syndicate: [
    "Marker Stone No. 4 Found Missing; Society Said to Be Nearby, With an Envelope",
    "Ford Stone \"Relocated\" by Person or Persons Unknown, Paid",
    "Society Denies Taking Syndicate Envelope; Envelope Denies Society",
    "Border Moves Four Yards East; Ward Moves Several Opinions",
  ],
  provoked: [
    "Shots at the Ford: Society Says \"Somebody Fired First\"; Somebody Agrees",
    "Border Patrol Under Fire; Society Under Questioning",
    "Marker Stone No. 4 Now Features Ballistic Evidence",
    "Society Opens Negotiations With a Rifle, Closes Them Shortly After",
  ],
  escalated: [
    "Ward and Syndicate Trade Fire at the Marker Stone; Society \"Observing\"",
    "Border Dispute Reaches Its Natural Conclusion: Shooting",
    "Ford Closed for Ballistic Maintenance",
    "Two Powers Settle a Boundary the Old-Fashioned Way, Loudly",
  ],
  // ---- D-036: Highmark's empty chair ----
  backed_elder: [
    "Society Backs the Elder Claimant; Court Calls It \"Seniority, Again\"",
    "Highmark's Chair Goes to the Elder, With the Society's Compliments",
    "Elder Heir Seated at Highmark; Younger Heir Seated Nearby, Less Happily",
    "Seniority Wins at Highmark, as It Has Every Time It Was Tried",
  ],
  backed_younger: [
    "Society Backs the Younger Claimant; Highmark Calls It \"Fresh Thinking\"",
    "Younger Heir Takes the Chair; Elder Heir Reviews Her Options",
    "Highmark Crowns the Young: Seniority Files a Complaint",
    "Band Plays, Prince Accedes: Highmark Votes by Volume",
  ],
  regency: [
    "Highmark Settles on a Regency; Everyone Is Slightly Disappointed, Which Is Called Consensus",
    "Three Chairs, One Throne: the Society Brokers a Council",
    "Regency Declared at Highmark; the King Remains Pending",
    "Nobody Wins at Highmark, and the Court Calls It a Settlement",
  ],
  usurped: [
    "Highmark's Chair Changes Hands in a Manner the Court Is Still Naming",
    "Palace Calls Overnight Events \"an Early Succession\"",
    "A Throne Is Occupied at Highmark; the Society Was \"in the Building\"",
    "Guard Rearranged at Highmark; Chair Has Opinions About Its New Occupant",
  ],
  crown_sold: [
    "Syndicate Acquires the Crown's Concession; the Crown Retains the Hat",
    "Highmark's Chair Sold, Subject to Contract and a Small Coronation",
    "Dunmarrow-Vesk Buys Into Highmark; the Court Says It Was Consulted, Briefly",
    "Crown Concession Sold, Cheque Honoured, Hat Retained",
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
  ...pluck(VESPER_COPY, "standfirsts"), ...pluck(SALTMARKET_COPY, "standfirsts"), ...pluck(REAPERS_COPY, "standfirsts"), ...pluck(ENGINE_COPY, "standfirsts"), ...pluck(RAID_COPY, "standfirsts"), ...pluck(HUNT_COPY, "standfirsts"),   // D-037 (regionEndings.ts)
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
  // ---- D-034: the other three contracts ----
  ransomed: [
    "The Society paid the deserters' price for Mr. Quim without a shot being fired, which the Society calls \"efficiency\" and the deserters call \"Tuesday\". The purse is £{purse}. {spin}",
    "Hangman's Orchard has been paid in full and returned a surveyor in good order, apart from the receipt, which is on a biscuit lid. Purse: £{purse}. {spin}",
    "Mr. Quim is home, redeemed at a price the Treasury describes as \"within tolerance\". The purse stands at £{purse}. {spin}",
  ],
  rescued: [
    "The Orchard has been cleared of deserters and Mr. Quim restored to the Society, noisily and at some cost. {spin}",
    "Rescuers describe a \"textbook operation\", and the textbook is now a little singed. Mr. Quim is home. {spin}",
    "Mr. Quim was freed from a cage wagon after what officials call \"a vigorous exchange of views\". {spin}",
  ],
  slipped_away: [
    "Mr. Quim left the Orchard under his own steam and nobody at the Orchard noticed. The Society is unsure whose credit that is. {spin}",
    "A cage was opened, a surveyor removed, a camp left sleeping. The Society's press office has been told not to talk about it, which it has done at length. {spin}",
    "Not a shot was fired and the deserters are still dreaming of their pay. Mr. Quim is home. {spin}",
  ],
  hostage_lost: [
    "Mr. Quim did not return from Hangman's Orchard. His insurers have been informed and have asked for the Society's address. {spin}",
    "The Orchard matter has concluded badly for Mr. Quim, who is described as \"no longer a current concern\". {spin}",
    "The Syndicate has collected Mr. Quim. The Society regrets not collecting him first. {spin}",
  ],
  seized: [
    "A Syndicate wagon was taken in the Dry Cut and its crates are now the Society's, in a sense that has yet to be defined. The purse is £{purse}. {spin}",
    "The Syndicate's convoy was intercepted at the Cut. Its cargo was \"recovered\", although nobody can say from whom. Purse: £{purse}. {spin}",
    "Three crates, one wagon and a very tired horse have joined the expedition's holdings. Purse: £{purse}. {spin}",
  ],
  tipped_off: [
    "A tip reached the Ward's ford post, and the Ward's pickets did the rest. The Society was nowhere near, with witnesses. {spin}",
    "The Ward intercepted a Syndicate wagon at the Dry Cut, on information received. The Society describes the information as \"unremarkable\". {spin}",
    "Two Ward soldiers and a tin of tea ended a Syndicate convoy. The Society was not consulted, and consulted thoroughly. {spin}",
  ],
  burned: [
    "A powder barrel beside a Syndicate wagon in the Dry Cut went up this week. Investigators have concluded it did so on its own. {spin}",
    "The Syndicate's convoy is a smoking ground feature. Nobody did it, and the wagon was not available for comment. {spin}",
    "The Dry Cut has acquired a crater, a smell and a story, none of which the Society will own. {spin}",
  ],
  passed: [
    "The Syndicate's wagon reached the ford landing in good order. The Society observed it, which the Society calls \"engagement\". {spin}",
    "A convoy crossed the south bank while the Society looked on with great interest and no rifles. {spin}",
    "The Syndicate is better armed this morning and has the Society's good wishes, although not on purpose. {spin}",
  ],
  mediated: [
    "Marker Stone No. 4 is under a joint survey, and a patrol and three surveyors are, remarkably, not shooting. The Society takes credit. {spin}",
    "Both sides signed one sheet of paper at the ford and left on foot, in opposite directions, unharmed. {spin}",
    "The Ward and the Syndicate have agreed to measure a stone together. Officials call it \"a thaw\", and have ordered a thermometer. {spin}",
  ],
  sided_ward: [
    "The Syndicate's plan for Marker Stone No. 4 reached the Ward by way of the Society, which the Ward found \"helpful, and slightly suspect\". {spin}",
    "A Ward patrol has detained Society witnesses at the ford as a courtesy and the Syndicate has withdrawn as a precaution. {spin}",
    "The border held, thanks to the Ward, and the Society is holding some of the credit. {spin}",
  ],
  sided_syndicate: [
    "Marker Stone No. 4 left the ford this week with help. The Syndicate's surveyors say the help was unsolicited. The Ward is looking for it. {spin}",
    "An envelope changed hands at the ford, and so, shortly afterwards, did the border. The Society was present, but not in a moving capacity. {spin}",
    "The border has been adjusted by four yards. The Ward has been adjusted by considerably more. {spin}",
  ],
  provoked: [
    "Shots were fired at the ford and the Society's account of who fired first has been revised twice since breakfast. {spin}",
    "A patrol and a surveying party are not talking, in different ways, after a shot at Marker Stone No. 4. {spin}",
    "The Society has opened fire on a border and is now offering to close it. The border has not yet replied. {spin}",
  ],
  escalated: [
    "The Ward and the Syndicate have traded fire at Marker Stone No. 4 while a Society party watched, which was described as \"within our brief\". {spin}",
    "A border dispute has become a border incident, which in the language of the Committee is a promotion. {spin}",
    "The ford is closed to the public, the press and about a third of the Marker Stone. {spin}",
  ],
  // ---- D-036: Highmark's empty chair ----
  backed_elder: [
    "At Highmark the Society put its weight behind the elder heir, and the Grange raised its scythes in what the Court agrees was a vote. Purse: £{purse}. {spin}",
    "The elder claimant was seated after a long afternoon of protocol and a short one of arithmetic. Purse: £{purse}. {spin}",
    "Highmark has a ruler again, or at least a seating plan that names one. The elder heir is delighted; the Society is billed. Purse: £{purse}. {spin}",
  ],
  backed_younger: [
    "At Highmark the Society backed the younger heir, whom the crowds prefer and the Chamberlain's Office has not yet found a form for. Purse: £{purse}. {spin}",
    "The younger claimant was seated to cheering, mostly from the Society's own side of the hall. Purse: £{purse}. {spin}",
    "Highmark's chair has a new occupant, who is said to be \"looking forward to the paperwork\". Purse: £{purse}. {spin}",
  ],
  regency: [
    "Highmark has a regency: three signatures, one chair that nobody sits in, and a King who remains pending. Purse: £{purse}. {spin}",
    "The Society brokered a council of three at Highmark, which the Court describes as \"a solution\" and the heirs as \"a delay\". Purse: £{purse}. {spin}",
    "Neither heir won and both were thanked, which is how regencies begin. Purse: £{purse}. {spin}",
  ],
  usurped: [
    "The chair at Highmark was taken overnight, and the Court has called a meeting to decide what to call it. Purse: £{purse}. {spin}",
    "Somebody sat down at Highmark before the Chamberlain had finished the order of precedence. The Society says it was merely present. Purse: £{purse}. {spin}",
    "An early succession occurred at Highmark. Officials stress that it was early, not irregular. Purse: £{purse}. {spin}",
  ],
  crown_sold: [
    "The Syndicate has bought the Crown's concession at Highmark, and the Crown has kept the hat. Purse: £{purse}. {spin}",
    "A cheque changed hands at Highmark and so, by the end of the afternoon, did the chair. Purse: £{purse}. {spin}",
    "Highmark's court was \"consulted\" about the sale, in the sense that it was in the room. Purse: £{purse}. {spin}",
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
  cage: ["The Cartwright's Cage", "Hangman's Orchard: A Ledger", "Insured Persons, Briefly"],
  convoy: ["The Dry Cut Affair", "Syndicate Wagon: the Figures", "Notes on a Convoy"],
  marker: ["Marker Stone No. 4", "The Stone in the Ford", "On the Matter of a Border"],
  chair: ["The Vacant Chair, in Figures", "Highmark: the Court Reports", "On the Matter of a Throne"],
  ...VESPER_STORY_HEADS, ...SALTMARKET_STORY_HEADS, ...REAPERS_STORY_HEADS, ...ENGINE_STORY_HEADS, ...RAID_STORY_HEADS, ...HUNT_STORY_HEADS,   // D-037: mine_rescue, claim_race, smuggling_run, flooded_market; D-042: reapers_strike; D-044: winding_engine; D-045: outpost_raid (keyed by template id)
} as const;

/** The ledger story's euphemism per new resolution: what happened, in the Society's own words. */
export const SITE_LINES: Partial<Record<ResolutionId, readonly string[]>> = {
  ...pluck(VESPER_COPY, "siteLines"), ...pluck(SALTMARKET_COPY, "siteLines"), ...pluck(REAPERS_COPY, "siteLines"), ...pluck(ENGINE_COPY, "siteLines"), ...pluck(RAID_COPY, "siteLines"), ...pluck(HUNT_COPY, "siteLines"),   // D-037 (regionEndings.ts)
  ransomed: ["The Society \"facilitated a mutually agreeable repatriation\" of one surveyor.", "A sum was \"redistributed\" to the deserters, at the deserters' suggestion."],
  rescued: ["One surveyor was \"extracted\", along with the camp's morale.", "The deserters were \"encouraged into other careers\", several of them posthumously."],
  slipped_away: ["One surveyor \"departed the premises\" without consulting the premises.", "The camp was \"left in a state of undisturbed slumber\"."],
  hostage_lost: ["One surveyor \"concluded his engagement unexpectedly\".", "The Orchard matter was \"resolved by other parties\"."],
  seized: ["A wagon was \"recovered into the Society's custody\", with its crates.", "The Syndicate's escort was \"respectfully relieved of duty\"."],
  tipped_off: ["Information was \"shared in a spirit of neighbourly vigilance\".", "A picket \"exercised initiative on a rumour\"."],
  burned: ["A wagon underwent \"unscheduled thermal retirement\".", "A powder barrel \"expressed itself\"."],
  passed: ["A convoy was \"permitted to proceed\", in the absence of an alternative.", "The Society \"respected the Syndicate's right of way\", having no other."],
  // Highmark's chair (D-036)
  backed_elder: ["The Society \"supported a succession on grounds of seniority\", with a receipt.", "An heir was \"encouraged into office\", and the barley was \"consulted\"."],
  backed_younger: ["The Society \"supported a succession by acclamation\", which was audible.", "A prince was \"welcomed to the chair\" by a band that had been told when to start."],
  regency: ["The Society \"facilitated a shared stewardship\" of an item of furniture.", "Three signatures were \"harmonised\" on a single sheet."],
  usurped: ["The Society \"was present at an early succession\", in a supporting capacity and from fairly close.", "A chair was \"reassigned in the night\", with the assistance of the night."],
  crown_sold: ["The Society \"was not unduly obstructive\" about the sale of a concession.", "A cheque was \"honoured\", along with a considerable number of formalities."],
  mediated: ["Two powers \"aligned their rulers\".", "A border was \"reimagined as a shared challenge\"."],
  sided_ward: ["The Society \"supported the lawful patrol\" with information and its own detention.", "A Syndicate party \"relocated to a less contested ford\"."],
  sided_syndicate: ["A boundary marker was \"adjusted for clarity\".", "An envelope was \"received in a private capacity\"."],
  provoked: ["A patrol was \"reminded of the value of caution\", at range.", "The first shot was \"a clerical error with consequences\"."],
  escalated: ["Two powers \"exchanged views\" in a rapid and ballistic manner.", "A border was \"tested\" until it gave."],
};

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
  "The Society has given assurances it did not keep ({lies} at the last count). Officials prefer \"rolling commitments\".",
  "Undertakings \"in progress\": {lies}, where \"progress\" means a direction away from them.",
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
