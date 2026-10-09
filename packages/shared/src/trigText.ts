import type { EndingCopy, TrigEnding } from "./regionEndings.ts";

/**
 * The Triangulation's authored copy (D-096, Vesper Gorge's fourth contract: the GDD's survey): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch. Satire aimed
 * at the Society and its Committee: a Great Trigonometrical Survey that measures a gorge to the second of arc in order to name its needles after the people who paid for the theodolite, in a
 * country where every needle already has a name and a person under it. The Guild keeps the names (and the ledger) and is never the joke; the Syndicate wants a gradient. Fictional cultures only
 * (scanned by noRealWorld.test.ts). Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */
export const TRIG_COPY: Record<TrigEnding, EndingCopy> = {
  trig_guild: {
    piece: { kind: "frame", surface: "wall", label: "The Society's chart of Vesper Gorge. The needles carry the Guild's names, like the Aunt Who Waited and Old Tamsey's Debt. The Committee's list is pinned beside it, crossed out." },
    memoryLine: [
      "I hear the Society measured Vesper Gorge and let the Guild name the needles. A survey that asked the locals! I shall need to sit down.",
      "Word from the gorge: your chart has the Guild's names on it, and your Committee is furious. Keep the chart. It is the most accurate thing your Society ever made.",
    ],
    headlines: [
      "Vesper Gorge Measured; Needles Keep Their Own Names, to Committee's Distress",
      "The Great Survey Closes Its Triangle; the Guild Opens a Ledger",
      "Society Chart Shows \"The Aunt Who Waited\" Where \"Mount Fothergill-Pym\" Was Expected",
      "Seven Needles, Seven Names, None of Them the Committee's",
    ],
    standfirsts: [
      "The Society's surveyors measured Vesper Gorge, then paid the Guild to write the needles' own names on the chart. The Committee has called an emergency meeting. Purse: £{purse}. {spin}",
      "Mount Fothergill-Pym will be on no map of Vesper Gorge. The Aunt Who Waited will, and so will Old Tamsey's Debt, who still owes the Guild money. Purse: £{purse}. {spin}",
      "The Society's surveyors measured the gorge, then asked what it was called. The Committee calls this a dangerous precedent. The Guild calls it a start. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "Vesper Gorge was \"surveyed with the advice of local experts\", at a fee per name.",
      "The Society \"respected the local names\" in the gorge. The local names insisted.",
    ],
    debrief: "In Vesper Gorge the survey is done, and the needles keep the Guild's names on the Society's chart.",
    news: {
      head: ["{A} Names the Needles on the Society's Chart", "The Gorge Keeps Its Names", "{A} Enters Seven Names, and a Fee"],
      body: [
        "{A} reports the Society's survey of Vesper Gorge is done. The needles are entered under their proper names, for the usual fee. {b} has filed nothing.",
        "The Society's chart of the gorge now shows the Aunt Who Waited and Small Ottilie. {A} says the Society is improving. {b} says the chart is useless for a railway.",
        "{A} confirms the needles of Vesper Gorge keep their names. The Committee had other names in mind. {a} has kept those too, in a drawer.",
      ],
    },
  },
  trig_committee: {
    piece: { kind: "envelope", surface: "table", label: "The Guild's bill to the Society: seven lines, one per needle, each a Committee member's name and a price. It is headed NAMES IMPOSED, ITEMISED." },
    memoryLine: [
      "I hear Vesper Gorge now has a Mount Fothergill-Pym. I also hear the Guild has sent you a bill for it. I wonder which will last longer.",
      "Word from the gorge: you measured it beautifully, then named it after your Committee. The Guild wrote every name down. In Vesper, that is not an honour.",
    ],
    headlines: [
      "Mount Fothergill-Pym Rises Over Vesper Gorge; Committee Delighted",
      "Great Survey Names Seven Needles for Its Committee, by Seniority",
      "The Lesser Bunce, Point Secretary (Honorary): Vesper Gorge on the Society's Chart",
      "Committee Immortalised in Rock; Guild Sends the Bill",
    ],
    standfirsts: [
      "The Society's surveyors measured Vesper Gorge and named the needles after the Committee. The Dirge-Master wrote each name down, with a price beside it. Purse: £{purse}. {spin}",
      "Snodgrass Pinnacle and Viscount Dimsdale's Needle now stand on the Society's chart, in place of the Guild's dead. The Committee is delighted. The Guild is billing. Purse: £{purse}. {spin}",
      "In one afternoon the Committee won the fame its members never earned any other way. The Guild's bill runs to two pages. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "Vesper Gorge's needles were \"given sensible names\", in order of Committee seniority.",
      "Seven peaks were \"named for distinguished patrons\", each of whom has since received a bill.",
    ],
    debrief: "In Vesper Gorge the survey is done and the needles carry the Committee's names. The Guild has sent the bill.",
    news: {
      head: ["{A} Bills the Society for Seven Names", "Mount Fothergill-Pym, Itemised", "{A} Writes Down the Committee"],
      body: [
        "{A} reports the Society has put its Committee's names on the needles of Vesper Gorge. An itemised bill has been sent. {b} has offered to buy the names for a railway timetable.",
        "On the Society's chart, the needles of Vesper Gorge are now a list of its Committee. {A} has put each name in its ledger of debts it will never collect, but never forget.",
        "{A} confirms that Mount Fothergill-Pym is not the needle's name, whatever the chart says. It has told the Society so in writing, at length, at the usual rate.",
      ],
    },
  },
  trig_sold: {
    piece: { kind: "envelope", surface: "table", label: "The Syndicate's receipt for \"one (1) survey of Vesper Gorge, with field books\", and a leaflet: THE VESPER GORGE RAILWAY, SHARES NOW ON SALE." },
    memoryLine: [
      "I hear the Society measured Vesper Gorge and sold the figures to the Syndicate for a railway. You surveyed a country so someone else could lay iron on it. How very like you.",
      "Word from the gorge: the Syndicate has your field books, and a railway will follow. The Guild says the needles will be named after stations. The Guild is seldom wrong about endings.",
    ],
    headlines: [
      "Society Survey of Vesper Gorge Sold to Syndicate; Railway Promised",
      "The Great Survey's Field Books Change Hands on the West Bench",
      "Vesper Gorge Railway Announced, Built on the Society's Sums",
      "Committee Learns Its Survey Is Now a Railway Brochure",
    ],
    standfirsts: [
      "The Society's surveyors measured Vesper Gorge and sold the field books to the Syndicate's railway man. The Committee's names will be on no map at all. Purse: £{purse}. {spin}",
      "The Syndicate has announced the Vesper Gorge Railway. It will be built on a survey of the very best quality, which it did not make. Purse: £{purse}. {spin}",
      "The needles of Vesper Gorge have no names for now. The Syndicate plans to name them after the stations it will build beneath them. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A survey of Vesper Gorge was \"shared with commercial partners\", for cash.",
      "The Society \"helped bring transport to the gorge\", by selling its field books.",
    ],
    debrief: "In Vesper Gorge the finished survey was sold to the Syndicate for a railway. The needles have no names on anyone's chart.",
    news: {
      head: ["The Society's Survey Sold for a Railway", "A Railway Up Vesper Gorge", "{A} Mourns the Needles in Advance"],
      body: [
        "{A} reports the Society's survey of Vesper Gorge has been sold to {b}, who call it money well spent. Railways, the Guild notes, are good for its business.",
        "The Society's survey of the gorge now belongs to {b}, who will build a railway on it. {A} asked what the needles will be called: Platform One to Platform Seven.",
        "{A} confirms a survey was sold over its head. It has opened a ledger for the railway's future funerals, and expects a good many.",
      ],
    },
  },
  trig_outsurveyed: {
    piece: { kind: "frame", surface: "wall", label: "The Society's half-finished chart of Vesper Gorge, with a note in the margin: SYNDICATE FILED FIRST. SEE ATTACHED. Nothing is attached." },
    memoryLine: [
      "I hear the Syndicate's survey of Vesper Gorge reached London before yours. You measured more carefully and arrived second. I have seen your Society do that before.",
      "Word from the gorge: the Syndicate filed first, so in London the gorge is a railway. Your Committee's names are on nothing. The Guild's are on everything. Nobody asked you.",
    ],
    headlines: [
      "Syndicate Survey of Vesper Gorge Filed First; Society's \"Still in the Post\"",
      "The Great Survey Loses the Race to London by a Barge",
      "Vesper Gorge Is, Officially, a Railway",
      "Committee's Needles Stay Unnamed; Syndicate's Railway Approved",
    ],
    standfirsts: [
      "The Syndicate's railway surveyors filed their survey of Vesper Gorge before the Society's was done. In London, the gorge is whatever the Syndicate says. Purse: £{purse}. {spin}",
      "The Society's survey of Vesper Gorge was the more accurate, and it arrived second. The Committee's names are held over for a future gorge. Purse: £{purse}. {spin}",
      "The Society's surveyors were still at work when the Syndicate's field books left on the ore barge. Asked for comment, the Guild sent a bill for its silence. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The survey of Vesper Gorge was \"overtaken by events\". The events were a barge.",
      "The Society's survey \"remains a valuable record\", of a race it lost.",
    ],
    debrief: "In Vesper Gorge the Syndicate filed its survey first. In London, the gorge is now a railway.",
    news: {
      head: ["The Syndicate Files First on Vesper Gorge", "The Gorge Goes to the Railway", "{A} Keeps Its Names, Unasked"],
      body: [
        "{A} reports that the survey of Vesper Gorge filed in London is the one by {b}, with a railway to follow. Nobody asked the Guild about the needles, as usual.",
        "The Society's survey of the gorge arrived second. {A} notes that the Society measured very carefully and named nothing, which the Guild finds restful.",
        "The gorge belongs to {b} on paper. {A} confirms it is the Guild's on the ground, as it has been for nine hundred years, and that paper burns.",
      ],
    },
  },
};

/** The paper's story heads for the survey (keyed by template id, spread into `STORY_HEADS`). */
export const TRIG_STORY_HEADS = {
  triangulation: ["The Great Survey, in Figures", "From the Trig Stations of Vesper Gorge", "On the Matter of the Needles"],
} as const;
