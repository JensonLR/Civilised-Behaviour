import type { EndingCopy, TrigEnding } from "./regionEndings.ts";

/**
 * The Triangulation's authored copy (D-096, Vesper Gorge's fourth contract: the GDD's survey): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch. Satire aimed
 * at the Society and its Committee: a Great Trigonometrical Survey that measures a gorge to the second of arc in order to name its needles after the people who paid for the theodolite, in a
 * country where every needle already has a name and a person under it. The Guild keeps the names (and the ledger) and is never the joke; the Syndicate wants a gradient. Fictional cultures only
 * (scanned by noRealWorld.test.ts). Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */
export const TRIG_COPY: Record<TrigEnding, EndingCopy> = {
  trig_guild: {
    piece: { kind: "frame", surface: "wall", label: "The Society's chart of Vesper Gorge, the seven needles lettered in the Dirge-Master's hand: the Aunt Who Waited, Old Tamsey's Debt, Sister Narrow and four more. The Committee's list is pinned beside it, crossed through." },
    memoryLine: [
      "I hear the Society measured Vesper Gorge and then let the Guild name it. A survey that asks the people who live there what things are called. I shall need to sit down.",
      "Word from the gorge: your chart has the Guild's names on it, and your Committee is said to be beside itself. Keep the chart. It is the most accurate thing your Society has made.",
    ],
    headlines: [
      "Vesper Gorge Triangulated; Needles Keep Their Own Names, to Committee's Distress",
      "The Great Survey Closes Its Triangle and Opens a Ledger: Guild Names Entered at a Fee",
      "Society Chart Shows \"The Aunt Who Waited\" Where \"Mount Fothergill-Pym\" Was Expected",
      "Seven Needles, Seven Names, None of Them the Committee's",
    ],
    standfirsts: [
      "The Society's survey party closed its triangle over Vesper Gorge to within a second of arc, and paid the Lamentation Guild to letter the needles in their own names. The Committee has called an extraordinary meeting. Purse: £{purse}. {spin}",
      "Mount Fothergill-Pym will not appear on any map of Vesper Gorge. The Aunt Who Waited will, as will Old Tamsey's Debt, who is said to still owe the Guild money. Purse: £{purse}. {spin}",
      "The Society's surveyors measured the gorge and then asked what it was called, which the Committee describes as a dangerous precedent and the Guild as a beginning. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "Vesper Gorge was \"triangulated in consultation with local authorities\", the consultation costing a fee per name.",
      "The Society \"adopted the existing nomenclature\" of the gorge, the existing nomenclature having insisted.",
    ],
    debrief: "In Vesper Gorge the triangle was closed and the needles keep the Guild's names on the Society's chart.",
    news: {
      head: ["{A} Names the Needles on the Society's Chart", "The Gorge Keeps Its Names", "{A} Enters Seven Names, and a Fee"],
      body: [
        "{A} reports that the Society's survey of Vesper Gorge has been completed and its needles entered under their proper names, in a good hand, for the usual fee. Nothing has been filed by {b}.",
        "The Society's chart of the gorge now carries the Aunt Who Waited and Small Ottilie among its heights. {A} describes the Society as improving; {b} describes its chart as unusable for a railway.",
        "{A} confirms that the needles of Vesper Gorge keep their names. The Society's Committee had other names in mind; {a} has kept those too, in a drawer, for reference.",
      ],
    },
  },
  trig_committee: {
    piece: { kind: "envelope", surface: "table", label: "The Guild's invoice to the Society: seven lines, one per needle, each a Committee member's name and a sum, headed IMPOSITION OF NOMENCLATURE, ITEMISED." },
    memoryLine: [
      "I hear Vesper Gorge now has a Mount Fothergill-Pym. I hear also that the Guild has sent your Society a bill for it, itemised. I shall be watching to see which outlasts the other.",
      "Word from the gorge: you measured it beautifully and then named it after your Committee. The Guild has written every name down. In Vesper, being written down by the Guild is not an honour.",
    ],
    headlines: [
      "Mount Fothergill-Pym Rises Over Vesper Gorge; Committee Delighted",
      "Great Survey Names Seven Needles for Its Committee, by Seniority",
      "The Lesser Bunce, Point Secretary (Honorary): Vesper Gorge on the Society's Chart",
      "Committee Immortalised in Rock; Guild Responds With Invoice",
    ],
    standfirsts: [
      "The Society's survey party closed its triangle over Vesper Gorge and entered the needles under the Committee's own names, read aloud to the Dirge-Master of the Lamentation Guild, who wrote each down and a sum beside it. Purse: £{purse}. {spin}",
      "Snodgrass Pinnacle, Viscount Dimsdale's Needle and the Hollis-Crumb Aiguille now stand on the Society's chart where the Guild's dead stood on the Guild's. The Committee is delighted; the Guild is billing. Purse: £{purse}. {spin}",
      "The Committee has achieved, in a single afternoon, the immortality its members could not achieve by any other means. The Guild's invoice is said to run to two pages. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "Vesper Gorge was \"rationalised in its nomenclature\", the rationale being the Committee's seniority.",
      "Seven heights were \"named for distinguished patrons\", each of whom has received an invoice.",
    ],
    debrief: "In Vesper Gorge the triangle was closed and the needles carry the Committee's names; the Guild has sent the bill.",
    news: {
      head: ["{A} Bills the Society for Seven Names", "Mount Fothergill-Pym, Itemised", "{A} Writes Down the Committee"],
      body: [
        "{A} reports that the Society has put its Committee's names on the needles of Vesper Gorge and that an invoice for the imposition has been sent, itemised. An offer for the names, for a railway timetable, has come from {b}.",
        "The needles of Vesper Gorge are, on the Society's chart, a list of its Committee. {A} has entered each name in a ledger it keeps for debts it does not expect to collect, but does not forget.",
        "{A} confirms that Mount Fothergill-Pym is not the needle's name, whatever the chart says, and has said so to the Society in writing, at length, and at the usual rate.",
      ],
    },
  },
  trig_sold: {
    piece: { kind: "envelope", surface: "table", label: "The Syndicate's receipt for \"one (1) closed triangulation of Vesper Gorge, with field books\", and a prospectus: THE VESPER GORGE RAILWAY, PREFERENCE SHARES NOW AVAILABLE." },
    memoryLine: [
      "I hear the Society measured Vesper Gorge and sold the measurements to the Syndicate for a railway. You have surveyed a country so that somebody else could lay iron on it. That is, I think, the Society's purpose exactly.",
      "Word from the gorge: the Syndicate has your field books, and a railway will follow them. The Guild says the needles will be renamed after stations. The Guild is seldom wrong about endings.",
    ],
    headlines: [
      "Society Survey of Vesper Gorge Sold to Syndicate; Railway Promised",
      "The Great Survey's Field Books Change Hands on the West Bench",
      "Vesper Gorge Railway Announced, on the Society's Arithmetic",
      "Committee Learns Its Survey Has Become a Prospectus",
    ],
    standfirsts: [
      "The Society's survey party closed its triangle over Vesper Gorge and sold it, field books and all, to the Syndicate's railway surveyor on the west bench. The Committee's names will appear on no map at all. Purse: £{purse}. {spin}",
      "The Syndicate has announced the Vesper Gorge Railway, to be laid on a survey of the very highest quality, which it did not make. Purse: £{purse}. {spin}",
      "The needles of Vesper Gorge are, for now, unnamed; the Syndicate proposes to call them after the stations it means to build beneath them. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A survey of Vesper Gorge was \"made available to commercial partners\" on the west bench, for cash.",
      "The Society \"contributed to the development of transport\" in the gorge, by selling its field books.",
    ],
    debrief: "In Vesper Gorge the closed triangle was sold to the Syndicate for its railway; the needles have no names on anybody's chart.",
    news: {
      head: ["The Society's Survey Sold for a Railway", "A Railway Up Vesper Gorge", "{A} Mourns the Needles in Advance"],
      body: [
        "{A} reports that the Society's survey of Vesper Gorge has been bought by {b}, who call it the best money they have spent in the gorge. Railways, the Guild observes, are good for its business.",
        "The Society's triangulation of the gorge now belongs to {b}, who mean to lay a railway on it. {A} has asked what the needles will be called, and has been told: Platform One to Platform Seven.",
        "{A} confirms a survey has been sold over its head, and has opened a ledger for the railway's future funerals, of which it expects a good many.",
      ],
    },
  },
  trig_outsurveyed: {
    piece: { kind: "frame", surface: "wall", label: "The Society's half-finished chart of Vesper Gorge, two sides of a triangle and a note in the margin: SYNDICATE FILED FIRST. SEE ATTACHED (ATTACHED MISSING)." },
    memoryLine: [
      "I hear the Syndicate's survey of Vesper Gorge reached London before yours. Your Society measured more carefully and arrived second. I have seen that happen to your Society before.",
      "Word from the gorge: the Syndicate filed first, and the gorge is, in London, a railway. Your Committee's names are on nothing. The Guild's are on everything. Nobody asked you.",
    ],
    headlines: [
      "Syndicate Survey of Vesper Gorge Filed First; Society's \"Still in the Post\"",
      "The Great Survey Loses the Race to London by a Barge",
      "Vesper Gorge Is, Officially, a Railway",
      "Committee's Needles Remain Unnamed; Syndicate's Gradient Accepted",
    ],
    standfirsts: [
      "The Syndicate's railway surveyors filed their survey of Vesper Gorge before the Society's party had closed its triangle. In London, the gorge is whatever the Syndicate says it is. Purse: £{purse}. {spin}",
      "The Society's survey of Vesper Gorge, which was the more accurate, arrived second, which is the less useful. The Committee's names have been held over to a future gorge. Purse: £{purse}. {spin}",
      "The Society's surveyors were still at their instrument when the Syndicate's field books left on the ore barge. The Guild was asked for comment and sent an invoice for the silence. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The survey of Vesper Gorge was \"overtaken by events\", the events being a barge.",
      "The Society's triangulation \"remains a valuable record\", of a race it lost.",
    ],
    debrief: "In Vesper Gorge the Syndicate filed its survey first; in London the gorge is a railway.",
    news: {
      head: ["The Syndicate Files First on Vesper Gorge", "The Gorge Goes to the Railway", "{A} Keeps Its Names, Unasked"],
      body: [
        "{A} reports that the survey of Vesper Gorge filed in London is that of {b}, with a railway in prospect, and that nobody asked the Guild about the needles, which it considers the usual arrangement.",
        "The Society's survey of the gorge arrived second. {A} has noted that the Society measured very carefully and named nothing, which the Guild finds restful.",
        "The gorge belongs to {b} on paper. {A} confirms it is the Guild's on the ground, as it has been for nine hundred years, and that paper burns.",
      ],
    },
  },
};

/** The paper's story heads for the survey (keyed by template id, spread into `STORY_HEADS`). */
export const TRIG_STORY_HEADS = {
  triangulation: ["The Great Survey, in Figures", "From the Trig Stations of Vesper Gorge", "On the Matter of the Needles"],
} as const;
