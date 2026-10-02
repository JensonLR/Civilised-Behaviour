import type { CampaignState } from "./campaignTypes.ts";
import type { EndingCopy, RegionCopy, SaltmarketEnding } from "./regionEndings.ts";

/**
 * The Saltmarket Delta's authored copy (D-037, package D4): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch, the signs, the chart note, the presence lines, the parley heading.
 * Satire aimed at INSTITUTIONS (a merchant oligarchy that auctions the weather, a customs service that charges for being looked at, an exchange that floods and holds the sale anyway); fictional cultures only
 * (scanned by noRealWorld.test.ts). Pending developer review (docs/AI_CONTENT_REGISTER.md). Placeholders in the paper's lines: {toll} {bridge} {dead} {routed} {wounded} {limbs} {civ} {spin} {purse} {lies}; in the
 * powers' dispatch {a} {A} {b} (the powers' short names).
 */
export const SALTMARKET_COPY: Record<SaltmarketEnding, EndingCopy> = {
  // ---- The Quiet Barge --------------------------------------------------------------------------------------------------------------------------
  landed: {
    piece: { kind: "crate", surface: "chest", label: "A crate lid stencilled SALT, which it was not. The stencil is very confident." },
    memoryLine: [
      "I hear the Society landed something in the Houses' reeds without being asked for the duty. I would like the name of your lawyer. For my own purposes.",
      "Word from the delta: a barge was quietly relieved of its crates. The Houses are livid, in writing. I merely note that nobody has said it was you.",
    ],
    headlines: [
      "Cargo Lands Unseen in Delta; Customs Reports \"No Cargo\"",
      "Saltmarket Reeds Receive Unmarked Barge; Houses Fail to Notice, Loudly",
      "The Quiet Barge Was Very Quiet: Duty Unpaid, Tide Unbothered",
      "Contraband Is Not the Word: Society \"Moved Goods Between Reeds\"",
    ],
    standfirsts: [
      "A barge of unmarked crates crossed the Houses' customs lines and arrived at a drop-house in the west reeds, which has since declined to confirm that it exists. Purse: £{purse}. {spin}",
      "The Tide Constabulary reports that nothing was landed at Saltmarket, in a statement that took eleven minutes and mentioned the tide eleven times. Purse: £{purse}. {spin}",
      "Four crates went in. The Constabulary's ledger says three were never there. The Houses' ledger says the fourth is theirs. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"facilitated the discreet movement of goods\", which were not goods and not discreet.",
      "A barge was \"relieved of its encumbrances\" at the reed cove, by persons who left no footprints and a very large crate-shaped hole in the dust.",
    ],
    debrief: "At Saltmarket the barge was landed unseen; the Houses are owed duty they will not be paid.",
    news: {
      head: ["{A} Finds Its Duty Unpaid; Calls It a \"Rounding\"", "Cargo Slips Past {a}'s Customs; {a} Slips Past Its Own Rules", "{A} Reviews Its Tide Tables, and Its Tide-Reeve"],
      body: [
        "{A} has launched an inquiry into a barge that was not there, which has so far established that it was not there at some length. {b} sends its compliments and a very small receipt.",
        "A shipment of unmarked crates crossed the delta in the dark and landed in the reeds. {A} describes the incident as 'a sudden gap in an otherwise complete record' and has hired a second Tide-Reeve to look at the first.",
        "{A} wants it known that nothing happened, and that if anything did, it was somebody else's, and that either way the duty is owed and will be collected, with interest, from whoever turns out to have been standing nearest.",
      ],
    },
  },
  impounded: {
    piece: { kind: "frame", surface: "wall", label: "A Tide Constabulary seizure notice, framed. It thanks the Society for its cooperation, in advance." },
    memoryLine: [
      "I hear the Houses' Constabulary took your barge. Ours has been trying to take things for years. I should like to know what they are using.",
      "Word from the delta: a cargo was impounded, with a form. The form was returned stamped 'received'. It is the same stamp as 'seized'.",
    ],
    headlines: [
      "Constabulary Impounds Unmarked Barge; Society Expresses \"Surprise\"",
      "Tide Constabulary Seizes Cargo; the Barge, Reportedly, Never Existed",
      "Saltmarket Customs Catches Society With Crates, Calls It \"Routine\"",
      "Cargo Impounded at Saltmarket: the Houses Thank Everybody Involved, Individually",
    ],
    standfirsts: [
      "The Tide Constabulary took the Society's barge into its keeping at the reed cove on Wednesday, with a stamp, a witness and a small brass band. The cargo will be sold at the Houses' next auction. Purse: £{purse}. {spin}",
      "A patrol found the barge, the crates and the party in that order, and wrote them down in that order too. The Houses are \"considering their position\", which is on top of the crates. Purse: £{purse}. {spin}",
      "Four unmarked crates are now marked: the Houses' mark, in black, on every side. The Society has not been charged with anything, only billed. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A cargo was \"taken into the Constabulary's custody\", along with the Society's good opinion of itself.",
      "The Society's barge was \"rehomed by the Houses' Customs service\", with its cargo, at a figure.",
    ],
    debrief: "At Saltmarket the Constabulary impounded the barge and the cargo, and the Houses added a handling charge.",
    news: {
      head: ["{A} Seizes a Barge; Calls It a \"Favour to the Community\"", "Customs Triumph at Saltmarket: {a} Buys Itself a Cargo", "{A}'s Constabulary Reports a Record Seizure"],
      body: [
        "{A}'s Tide Constabulary has impounded a barge, four crates and the paperwork, and {b} was seen in the gallery taking notes. The cargo will be sold on, at a modest profit, to the people it was taken from.",
        "A customs victory of the sort {a} has been waiting for. The barge has been listed as 'recovered', the crates as 'in evidence' and the Society as 'regrettably cooperative'.",
        "{A} says the patrol was merely walking along the boardwalk with its eyes open, which is a thing it has been told to do and has now, for the first time, done.",
      ],
    },
  },
  scuttled: {
    piece: { kind: "bridge", surface: "table", label: "A model of a barge, going down by the stern, to scale. It is sulking." },
    memoryLine: [
      "I hear you sank a barge rather than be caught with it. I have always held that a toll is better than a wreck, but I respect the commitment.",
      "Word from the delta: a barge went down in the cove, taking its cargo and the case against it. The Houses have asked for the weight of the evidence in writing.",
    ],
    headlines: [
      "Barge Goes Down at Reed Cove; Evidence Goes With Her",
      "Smugglers Scuttle Own Cargo; Delta Divers Enjoy a Busy Week",
      "Saltmarket Cove Gains an Attraction: One Barge, Slightly Under",
      "Unmarked Barge Sinks Dignified, Unclaimed and Wet",
    ],
    standfirsts: [
      "A barge was scuttled at the reed cove on Thursday, to the visible disappointment of a patrol that had come with a form. The cargo is now the property of the delta, which has not asked for it. Purse: £{purse}. {spin}",
      "The Houses are examining the wreck. So far they have established that she was wet, that she was heavy, and that somebody pulled a plug. Purse: £{purse}. {spin}",
      "Four crates of nothing in particular lie under a fathom of silt, where the Houses' inspectors cannot reach them without getting their ledgers wet. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A barge was \"retired from service\", abruptly, in about two fathoms of water.",
      "The Society \"discharged its obligations to the evidence\", in a manner that left no evidence.",
    ],
    debrief: "At Saltmarket the barge is on the bottom of the cove, and so is the cargo; the Guild has offered to bury the paperwork.",
    news: {
      head: ["{A} Surveys a Wreck and Finds It Insufficiently Documented", "Barge Down in {a}'s Cove; {b} Offers a Wreath", "{A} Bills the Cove for the Wreck"],
      body: [
        "{A} has declared the wreck 'a hazard to navigation and to its own reputation' and has sent a bill to the sea. {b} has offered to bury what is left, at a modest rate, with lilies.",
        "A barge sank at the cove, took four crates with her, and has not given a statement. {A} is said to be relieved, which is not a feeling it has had in a customs matter before.",
        "{A}'s divers found nothing. {A}'s lawyers found a great deal of nothing and have begun to charge for it. {b} sent a basket.",
      ],
    },
  },
  informed: {
    piece: { kind: "envelope", surface: "chest", label: "A finder's-fee envelope, opened. The Houses pay in new notes, which is how you know they are ashamed." },
    memoryLine: [
      "I hear you informed on yourselves to the Houses and were paid for it. In my line of work that is called a statement, and nobody ever pays for them.",
      "Word from the delta: the Society told the Houses about its own barge. I find this admirable, and I should like to know the rate.",
    ],
    headlines: [
      "Society Informs on Own Barge; Houses Pay Finder's Fee, Wince",
      "\"A Tip Is a Tip\": Houses Reward Unusual Candour in Delta",
      "Smuggler Reports Self: Saltmarket Has Not Seen Anything Like It Since the Flood",
      "Houses Pay a Finder's Fee for Their Own Barge; Society Calls It \"Cooperation\"",
    ],
    standfirsts: [
      "The Society walked into the Customs House, declared its own barge's whereabouts to the Tide-Reeve and left with a finder's fee and a certificate of good standing. The barge did not leave. Purse: £{purse}. {spin}",
      "It is the first recorded case at Saltmarket of an informer who was also the informed-upon, and the Houses are still working out whom to bill. Purse: £{purse}. {spin}",
      "The Tide-Reeve is said to have wept, quietly, into a ledger. It is not clear whether this was pride or the damp. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"contributed information to the Houses' enquiries\", and was thanked, in cash.",
      "A cargo was \"brought to the Constabulary's attention\", by the people who had brought it.",
    ],
    debrief: "At Saltmarket the Houses paid you for informing on your own barge, and the barge is theirs.",
    news: {
      head: ["{A} Pays an Informer and Is Mildly Offended", "{A} Thanks a Source It Cannot Name Without a Mirror", "Finder's Fee Paid at {a}'s Customs House"],
      body: [
        "{A} has paid a finder's fee to a source that turned out to be the barge's owner, which its lawyers describe as 'unprecedented, and therefore billable'. {b} has been told that the Houses know everything, and has been left in the dark about how.",
        "The Tide-Reeve is said to be 'moved'. {A} has granted him a day's leave to get over it, and a form to say so.",
        "An informer walked into {a}'s Customs House with a story that was entirely true. {A} is investigating how it got hold of one.",
      ],
    },
  },
  // ---- The Auction at High Water ----------------------------------------------------------------------------------------------------------------
  lot_won: {
    piece: { kind: "board", surface: "wall", label: "A lot ticket: THE TIDE CONCESSION OF OSSUARY BAY, knocked down to the Society. Damp at one corner." },
    memoryLine: [
      "I hear the Society now owns the right to charge for the weather in Ossuary Bay. I charge for weather here, too. I do not call it a concession.",
      "Word from the delta: the Exchange knocked a lot down to the Society in an inch of water. The Houses are very quiet. I have learned to fear that.",
    ],
    headlines: [
      "Society Wins the Tide Concession; Houses Bid, Lose, Float Away",
      "Hammer Falls at High Water: Lot Goes to the Society, Water Goes Everywhere",
      "Ossuary Bay's Weather Now Owned by Outsiders; Weather Unavailable for Comment",
      "Exchange Sells Tide to Newcomers; Newcomers Billed for Damp",
    ],
    standfirsts: [
      "The Brine Houses' auction ended at high water with the Society's bid standing at the hammer, and the Society's feet in about eighteen inches of the Exchange. The Houses' paddles are being dried. Purse: £{purse}. {spin}",
      "A lot that the Houses have been selling to each other since the founding has gone to a stranger. The Auctioneer was heard to say 'going, going, oh dear'. Purse: £{purse}. {spin}",
      "The Society holds the Tide Concession of Ossuary Bay, in perpetuity or until it rains. It was raining at the time. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"secured a long-term interest in the region's weather\", on a standing bid.",
      "A concession was \"acquired through the Exchange's ordinary processes\", in an unusual quantity of water.",
    ],
    debrief: "At Saltmarket the lot was knocked down to you; the Houses will not forget the figure, and neither will your purse.",
    news: {
      head: ["{A} Loses Its Own Auction and Is Told to Mind the Step", "Tide Concession Leaves {a}'s Hands; So Does the Dignity", "{A} Wins Nothing, Pays Attention"],
      body: [
        "{A} has been out-bid at its own Exchange by outsiders with a purse and a clock, and has taken a meeting about it, in the lobby, above the waterline. {b} was seen to smile and was asked to stop.",
        "The Tide Concession was knocked down to the Society at high water. {A} describes it as 'a temporary reallocation of the weather' and has begun drafting a very long clause.",
        "{A}'s Heads left the hall in order of seniority, carrying their paddles over their heads. The Auctioneer left last, wet to the shin, still saying 'gone'.",
      ],
    },
  },
  consortium: {
    piece: { kind: "pennant", surface: "wall", label: "A pennant of two Houses and a Society, sewn together with salt thread. It will not last the winter." },
    memoryLine: [
      "I hear the Society pooled a lot with two of the Houses. A consortium. It is a committee that has found a way to hold property. We have one here; it is called the garrison.",
      "Word from the delta: the Houses and the Society share a concession, on a sheet nobody has read. I wish them joy of the minutes.",
    ],
    headlines: [
      "Society and Houses Pool the Tide: Salt-Stained Sheet Signed by Two",
      "Consortium Formed at High Water; Nobody Has Read It, All Agree It Is Fair",
      "Saltmarket's Weather Goes to a Committee; Committee Delighted",
      "Houses and Society Share a Lot, and Each Other's Opinion of the Rest",
    ],
    standfirsts: [
      "Two signatures in two inks, on a single sheet, in a hall that was by then rather wet: the Brine Houses and the Society now hold the Tide Concession jointly. The shares will be announced when the water goes down. Purse: £{purse}. {spin}",
      "The Exchange has pooled a lot for the first time in living memory, and the Auctioneer is said to be dining out on the phrase 'a spirit of partnership'. Purse: £{purse}. {spin}",
      "A consortium of unlikely partners has taken the weather of Ossuary Bay on lease, subject to the tide, the Houses' goodwill and a clause that nobody can find. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"entered a joint arrangement with local partners\", on salt-stained paper.",
      "A concession was \"shared in a spirit of mutual indebtedness\", the Houses holding most of the debt.",
    ],
    debrief: "At Saltmarket you pooled the lot with the Houses; the profits are shared, and so are the grievances.",
    news: {
      head: ["{A} Shares a Lot; Calls It Generosity", "{A} Signs for a Consortium, Reads It Later", "Joint Venture at {a}'s Exchange: Shares to Follow, Eventually"],
      body: [
        "{A} has taken the Society into partnership over the Tide Concession, in a spirit of cooperation that {b} describes as 'a considerable change of heart'. The ink was salt. The shares are in the post.",
        "The Houses and the Society will share the profits of the weather, if any, and the blame for it, if there is any left. {A} has appointed a clerk to keep the minutes dry.",
        "{A} notes that a consortium is only a lease with friends in it. It has begun, quietly, to count the friends.",
      ],
    },
  },
  shorted: {
    piece: { kind: "key", surface: "chest", label: "A key to a lot that was never quite ours. The Houses have asked for it back, twice, in rising type." },
    memoryLine: [
      "I hear the Society sold what it did not own at the Houses' own auction. It is the most Society thing I have ever heard of, and I have a file.",
      "Word from the delta: a short sale at the Exchange, in the flood. They say the Auctioneer applauded and then called the guard. I understand it was in that order.",
    ],
    headlines: [
      "Society Sells Short at the Exchange; Houses Short of Words",
      "Lot Knocked Down to Nobody in Particular; Payment \"Expected\"",
      "Tide Concession Sold Before It Was Bought: Auctioneer Calls It \"A Vocation\"",
      "Delta Stunned by Credit Sale; Hall Floods in Sympathy",
    ],
    standfirsts: [
      "The Society took the Tide Concession on a bid with no money behind it and offered it onward before the hammer fell, a manoeuvre the Houses describe as 'a theft in the grammatical mood'. Purse: £{purse}. {spin}",
      "The lot is the Society's, unpaid for. The Houses have begun drafting an account of how this happened, and a second account of how it will not happen again. Purse: £{purse}. {spin}",
      "Nobody has been paid, everybody has been promised, and the hall is under two feet of water, which is, the Auctioneer says, the most solid thing in it. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"made use of the Exchange's flexible settlement terms\", which are flexible in one direction only.",
      "A lot was \"disposed of ahead of acquisition\", an innovation the Houses will be citing for years.",
    ],
    debrief: "At Saltmarket you sold the lot short and it stuck; the Houses want a word with you, and a signature.",
    news: {
      head: ["{A} Shorted at Its Own Sale; Lawyers Summoned", "{A} Discovers the Tide Concession Has Two Owners and Neither Paid", "Credit Sale at the Exchange Leaves {a} Without Credit"],
      body: [
        "{A} has been out-manoeuvred at its own auction by a bid with no money behind it, which it describes as 'a theft in the grammatical mood'. {b} was seen in the gallery, delighted, drawing a small diagram.",
        "The lot was sold before it was bought, then bought before it was paid for, then paid for, according to the Auctioneer, 'in principle'. {A} has asked for a principle in cash.",
        "{A} wants it said that it has never been shorted in its history, and that if it has, the history will be amended. {b} has offered to help with the amending.",
      ],
    },
  },
  washed_out: {
    piece: { kind: "stone", surface: "table", label: "A water-line stone from the Exchange's second step. It has been underwater and has opinions." },
    memoryLine: [
      "I hear the Houses' sale washed out at high water and nobody got the lot. I find that fitting. I have been meaning to wash out my own for years.",
      "Word from the delta: the Exchange held its sale regardless, and the water won. They say the Auctioneer finished the hammer under the surface.",
    ],
    headlines: [
      "Exchange Floods, Sale Closes: \"The Lot Is Gone\", Says Auctioneer, Dripping",
      "Tide Takes the Tide Concession; Nobody Wins, Everybody Pays",
      "Auction at High Water Washed Out; Houses Bill the Tide",
      "Hall Deluged at Saltmarket; Hammer Falls on Water",
    ],
    standfirsts: [
      "The Brine Houses' Exchange flooded on schedule and held its sale regardless, and the sale was lost to the water in the third lot. The Houses regret the weather and have invoiced it. Purse: £{purse}. {spin}",
      "The hammer fell at high water on nothing in particular, which in the Exchange's accounts is described as 'a conclusive result'. The lot will be re-offered at the next spring tide. Purse: £{purse}. {spin}",
      "Nobody has the Tide Concession of Ossuary Bay and the sea has made no claim. The Society, which was present, is said to be 'drying'. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"observed the Exchange's ordinary conclusion\", up to the knee.",
      "A sale was \"closed by the prevailing conditions\", which were all of them.",
    ],
    debrief: "At Saltmarket the sale washed out at high water; nobody holds the lot, and the Houses are drying.",
    news: {
      head: ["{A} Closes the Sale; the Sea Declines to Comment", "{A}'s Exchange Floods on Schedule, to General Applause", "Auction Washed Out; {a} Blames the Weather It Sold"],
      body: [
        "{A} has described the afternoon's events as 'a conclusive result', and the water in the hall as 'a seasonal feature'. {b} sent a boat.",
        "The hammer fell at high water on a lot that was by then largely submerged. {A} has billed the tide for the inconvenience and is awaiting its reply.",
        "{A} notes that its Exchange has now flooded on schedule at every spring tide since the founding and that it considers this, on balance, a success.",
      ],
    },
  },
};

/** The ledger story's heading per template (>= 3 each), by the paper's `lastTemplate`. */
export const SALTMARKET_STORY_HEADS = {
  smuggling_run: ["The Quiet Barge, in Figures", "Saltmarket: the Customs Report", "On the Matter of a Cargo"],
  flooded_market: ["The High-Water Sale, in Figures", "Saltmarket: the Exchange Reports", "On the Matter of a Lot"],
} as const;

/** Signage of the delta (Latin capitals; the view letters these). */
export const SALTMARKET_SIGNS: readonly string[] = [
  "SALTMARKET QUAY. THE TIDE IS OURS. YOU ARE RENTING IT.",
  "CUSTOMS HOUSE. DECLARE EVERYTHING. WE WILL DECIDE WHAT IT WAS.",
  "THE EXCHANGE. LOTS CLOSE AT HIGH WATER. SO DOES THE EXCHANGE.",
  "NO WAKE. NO WEATHER. NO COMMENT.",
];

export const SALTMARKET_REGION: RegionCopy = {
  chartNote: (c: CampaignState): string => {
    const cargo = c.sites.ends.smuggling_run, market = c.sites.ends.flooded_market;
    if (!c.history.some((h) => h.region === "saltmarket")) return "Not yet visited. Braided channels, stilted warehouses and an exchange that floods on schedule.";
    const parts: string[] = [];
    if (cargo !== undefined) parts.push(`the barge was ${cargo.replace("_", " ")}`);
    if (market !== undefined) parts.push(`the sale ${market === "lot_won" ? "went to you" : market === "consortium" ? "was pooled" : market === "shorted" ? "was shorted" : market === "washed_out" ? "washed out" : "was left"}`);
    return `Last time: ${parts.length ? parts.join("; ") : "an expedition that left no mark"}. The Houses keep the receipts.`;
  },
  presence: ["Day {day}: {party} at Saltmarket, bidding on weather", "Day {day} at Saltmarket, {party}, in the Houses' ledger"],
  parley: { heading: "A word on the quay", asked: "Price asked: £{price} · Round {round} · The Houses seem {mood}." },
};
