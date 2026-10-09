import type { EndingCopy, SiegeEnding } from "./regionEndings.ts";

/**
 * The Siege of the Counting-House's authored copy (D-095, Kessar's sixth contract: the GDD's siege): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch.
 * Satire aimed at the Society and its War Committee: a siege conducted from Whitehall by the Articles (revised), with summonses, pickets and the honours of war, against a flagpole, a
 * tent and a counter; and at a Syndicate that will sell anything, its own surrender included. The Ward and its picket boys are Kessar's own (fictional) and are never the joke: they
 * hire out the pickets and keep the invoice. Scanned by noRealWorld.test.ts. Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */
export const SIEGE_COPY: Record<SiegeEnding, EndingCopy> = {
  siege_honours: {
    piece: { kind: "pennant", surface: "wall", label: "The Syndicate's flag from the Kessar post, folded by the regulations, with the factor's receipt for it pinned on: ONE (1) FLAG, SURRENDERED, AS FOUND." },
    memoryLine: [
      "I watched the Society besiege the Syndicate's tent from my wall, by the book, with pickets. My boys made a penny an hour each standing your pickets. I have never been so well entertained for so little.",
      "Word from my south bank: the Syndicate's factor marched out with the honours of war and his ledger held up for colours. You have made a war of a shop and a ceremony of a war. My sentries applauded, quietly.",
    ],
    headlines: [
      "The Siege of Kessar Ends: Counting-House Surrenders With the Honours of War",
      "Syndicate Post Capitulates to Society Investment; Ledger Carried Out \"As Colours\"",
      "Articles of Siege Observed in Full at Kessar; Garrison Marches Out, Arms Reversed",
      "Britannia Takes the Counting-House: A Siege by the Book, the Book Being Four Pages",
    ],
    standfirsts: [
      "The Society's party invested the Syndicate's post on three sides, summoned its factor according to the Articles (revised), and accepted his surrender with the honours of war. Nobody was shot who did not insist on it. Purse: £{purse}. {spin}",
      "The War Committee's first siege in a generation was conducted against a flagpole, a tent and a counter, and conducted correctly. The garrison marched out to the river with its ledger held up for colours. Purse: £{purse}. {spin}",
      "Whitehall reports a capitulation; Kessar reports a factor walking down to a launch with a receipt. Both are true. The Society's flag now flies on the Syndicate's pole, which is a little short for it. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A Syndicate post was \"reduced by regular siege\" at Kessar, the regularity being the chief feature.",
      "The Society \"received the capitulation of a commercial establishment\" on Kessar's south bank, with drums, notionally.",
    ],
    debrief: "At Kessar the Syndicate's post surrendered with the honours of war; its flag is the Society's and its factor is on the river.",
    news: {
      head: ["{A}'s Kessar Post Surrenders to a Siege", "{A} Strikes Its Flag on the South Bank", "{A}'s Factor Marches Out Under {b}'s Eye"],
      body: [
        "{A} has given up its post on Kessar's south bank to a siege conducted by the Society according to its own Articles. The factor marched out with his ledger for colours; {b} provided the pickets and the invoice.",
        "The Society has taken {a}'s counting-house by investment and summons, without a storm. {A} describes the surrender as \"a relocation\"; {b} describes it as the best thing it has seen from the fort in years.",
        "{A}'s factor at Kessar accepted the honours of war and went down to the river with his garrison. The boys of {b}, who held the pickets at a penny an hour, have asked to be told the date of the next siege.",
      ],
    },
  },
  siege_stormed: {
    piece: { kind: "board", surface: "wall", label: "The Syndicate's counter from the Kessar post, with a bullet hole through the brass scale and a card in the Committee's hand: TAKEN BY ASSAULT. THE SCALE WAS SHORT." },
    memoryLine: [
      "I saw your storm of the Syndicate's post from my wall. It was quick. It was also on my bank, and some of it is still there. The Ward will want to talk about the clearing up.",
      "Word from my south bank: you took the Syndicate's counting-house at a run, over its own counter. My sentries were impressed. My clerks are counting the graves, which is also a kind of impression.",
    ],
    headlines: [
      "Counting-House Taken by Storm; Society's Flag Raised Over Kessar Post",
      "Syndicate Post Falls to Assault; Factor Found Under Counter, Unhurt, Indignant",
      "The Storming of Kessar: The Society Goes in Over the Counter",
      "Britannia Carries the Counting-House at the Point of the Bayonet, and the Ledger",
    ],
    standfirsts: [
      "The Society's party stormed the Syndicate's trading post on Kessar's south bank and raised its own flag on the Syndicate's pole. The factor surrendered from under his counter. Casualties: {dead}. Purse: £{purse}. {spin}",
      "The War Committee had asked for a regular siege and has received an assault, which it is describing as \"the regular siege, accelerated\". The post is the Society's. Casualties: {dead}. Purse: £{purse}. {spin}",
      "The Syndicate's garrison at Kessar fought from behind a tent and a counter, which is to say not for long. The Ward watched from the fort and has begun to send the bills. Casualties: {dead}. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A commercial dispute at Kessar was \"concluded by assault\", the assault being the conclusion.",
      "The Society \"took possession of a trading post\" on the south bank, over its counter.",
    ],
    debrief: "At Kessar the Syndicate's post was taken by storm; its flag is the Society's and the Ward's bank is a mess.",
    news: {
      head: ["{A}'s Kessar Post Stormed", "{A} Loses Its Counting-House at a Run", "Blood on the South Bank at Kessar"],
      body: [
        "{A}'s trading post on Kessar's south bank has been taken by storm by a party of the Society's. {A} calls it an act of war against a shop; {b} calls it an act of war on its bank, which is a different complaint.",
        "The Society stormed {a}'s counting-house at Kessar and raised its own flag on the pole. The factor has asked for a receipt for the post; {b} has asked for one for the bank.",
        "{A} confirms the loss of its post at Kessar to an assault and has promised to remember it. So has {b}, which watched it all from the fort, separately.",
      ],
    },
  },
  siege_bought: {
    piece: { kind: "envelope", surface: "table", label: "The factor's receipt, in a Syndicate envelope: ONE (1) TRADING POST, AS A GOING CONCERN, GOODWILL INCLUDED. The goodwill is not itemised." },
    memoryLine: [
      "I hear the Society bought the Syndicate's post on my bank instead of besieging it. You have found a way to pay the Syndicate for leaving. The Syndicate has found a way to be paid for it. One of you is a merchant.",
      "Word from my south bank: you laid siege to a shop and then paid for it at the counter. My clerks have entered it under TRADE. My sentries have entered it under something else.",
    ],
    headlines: [
      "Society Concludes Siege of Kessar Post by Purchase; \"Goodwill Included\"",
      "Counting-House Changes Hands at the Counter; War Committee Bewildered",
      "The Siege That Was a Sale: Syndicate Factor Leaves With a Profit",
      "Society Buys the Post It Was Besieging, at a Fair Price, Allegedly",
    ],
    standfirsts: [
      "The Society's party, having invested the Syndicate's post with every formality, bought it from the factor as a going concern. The Syndicate's ledger records a sale. Purse: £{purse}. {spin}",
      "The War Committee, which ordered a siege, has received a receipt instead, and is said to be consulting the Articles on whether a purchase counts as a capitulation. Purse: £{purse}. {spin}",
      "The factor struck his own flag, counted the Society's money twice and marched his garrison down to the river at his own pace. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A Syndicate post was \"acquired by negotiation\" at Kessar, the negotiation being a price.",
      "The Society \"concluded hostilities on commercial terms\", the terms being the Syndicate's.",
    ],
    debrief: "At Kessar the Society bought the Syndicate's post from its factor; the post is struck and the Syndicate is the richer.",
    news: {
      head: ["{A} Sells Its Kessar Post to Its Besiegers", "A Siege Settled at the Counter", "{A}'s Factor Leaves Kessar in Profit"],
      body: [
        "{A} reports the sale of its trading post on Kessar's south bank to the Society, which was besieging it at the time. The factor calls the price fair and the siege \"good for business\".",
        "The Society has paid {a} to strike its post at Kessar, as a going concern. {A} announces that it is considering more posts, in places the Society might like to besiege.",
        "{A}'s counting-house at Kessar has changed hands at its own counter. Asked who owns the bank now, the Lamp-Warden says the Ward always has, and that the Society and {a} are welcome to argue about it somewhere else.",
      ],
    },
  },
  siege_lifted: {
    piece: { kind: "frame", surface: "wall", label: "A sketch by the expedition's artist: the Syndicate's relief marching into the Counting-House's yard, cheering. The Committee has hung it facing the wall." },
    memoryLine: [
      "I watched the Syndicate relieve its post on my bank while the Society was besieging it. My boys came home with their pennies. They say it was the best day's work they ever did for nothing.",
      "Word from my south bank: your siege was lifted by a launch and a few men in a hurry. The Syndicate's flag is still up. So, I notice, is mine.",
    ],
    headlines: [
      "Siege of Kessar Lifted; Syndicate Relief Reaches the Counting-House",
      "Relief Column Marches Into Syndicate Post; Society's Investment \"Discontinued\"",
      "The Counting-House Holds: Society Raises Siege of a Tent",
      "War Committee Regrets the Outcome at Kessar, and the Articles",
    ],
    standfirsts: [
      "The Syndicate's relief launch put in on Kessar's south bank and marched its men into the yard of the besieged post, and the Society's siege was lifted. The factor sent the party his compliments. Purse: £{purse}. {spin}",
      "The War Committee's siege of the Syndicate's counting-house ended when the Syndicate's relief arrived, which the Committee describes as \"not in the Articles\". Purse: £{purse}. {spin}",
      "The Ward's picket boys were paid off at a penny an hour and went home. The Syndicate's flag stays up on its pole. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A siege at Kessar was \"discontinued in favour of other priorities\", the priority being the relief.",
      "The Society \"concluded its investment\" of a Syndicate post, the post having concluded otherwise.",
    ],
    debrief: "At Kessar the Syndicate's relief reached its post and the siege was lifted; the post stands and the Ward saw it all.",
    news: {
      head: ["{A}'s Kessar Post Relieved", "The Siege That Was Lifted", "{A} Holds the South Bank"],
      body: [
        "{A} reports its trading post at Kessar relieved by launch, and a siege by the Society lifted. The factor has thanked his relief and invoiced the Society for the inconvenience; a copy hangs in the fort of {b}.",
        "The Society's siege of {a}'s counting-house has been raised by a relief that came down the river on time, which {b} says is the first thing in the whole affair that did.",
        "{A}'s post on Kessar's south bank stands. From the fort, {b} describes the Society's siege as \"thorough, in the paperwork\".",
      ],
    },
  },
};

/** The paper's story heads for the siege (keyed by template id, spread into `STORY_HEADS`). */
export const SIEGE_STORY_HEADS = {
  counting_house: ["The Siege of Kessar, in Figures", "From the Lines Before the Counting-House", "On the Matter of a Siege"],
} as const;
