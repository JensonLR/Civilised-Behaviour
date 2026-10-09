import type { EndingCopy, SiegeEnding } from "./regionEndings.ts";

/**
 * The Siege of the Counting-House's authored copy (D-095, Kessar's sixth contract: the GDD's siege): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch.
 * Satire aimed at the Society and its War Committee: a siege conducted from Whitehall by the Articles (revised), with summonses, pickets and the honours of war, against a flagpole, a
 * tent and a counter; and at a Syndicate that will sell anything, its own surrender included. The Ward and its picket boys are Kessar's own (fictional) and are never the joke: they
 * hire out the pickets and keep the invoice. Scanned by noRealWorld.test.ts. Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */
export const SIEGE_COPY: Record<SiegeEnding, EndingCopy> = {
  siege_honours: {
    piece: { kind: "pennant", surface: "wall", label: "The Syndicate's flag from the Kessar post, folded by the rules. The factor's receipt is pinned to it: ONE (1) FLAG, SURRENDERED, AS FOUND." },
    memoryLine: [
      "I watched your siege of the Syndicate's tent from my wall. My boys earned a penny an hour holding your pickets. I have never been so well entertained for so little.",
      "Word from my south bank: the factor marched out with the honours of war, holding up his ledger like a flag. You made a war of a shop. My sentries clapped, quietly.",
    ],
    headlines: [
      "The Siege of Kessar Ends: Counting-House Surrenders With the Honours of War",
      "Syndicate Post Surrenders to Society Siege; Ledger Carried Out \"As Colours\"",
      "Kessar Siege Done Entirely by the Book; Garrison Marches Out, Guns Pointed Down",
      "Britannia Takes the Counting-House: A Siege by the Book, the Book Being Four Pages",
    ],
    standfirsts: [
      "The Society surrounded the Syndicate's post and summoned the factor by the rules. He surrendered with honours. Nobody was shot who did not insist on it. Purse: £{purse}. {spin}",
      "The War Committee's first siege in a generation was fought against a flagpole, a tent and a counter, and fought correctly. Purse: £{purse}. {spin}",
      "Whitehall reports a surrender; Kessar reports a factor strolling to his boat with a receipt. Both are true. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A Syndicate post at Kessar was \"reduced by regular siege\", mostly by paperwork.",
      "The Society \"accepted the surrender of a commercial establishment\" at Kessar. It was a shop.",
    ],
    debrief: "At Kessar the Syndicate's post surrendered with honours. The Society has its flag, and the factor has gone downriver.",
    news: {
      head: ["{A}'s Kessar Post Surrenders to a Siege", "{A} Strikes Its Flag on the South Bank", "{A}'s Factor Marches Out Under {b}'s Eye"],
      body: [
        "{A} has given up its post on Kessar's south bank to a Society siege, run by the rule book. {b} supplied the pickets, and the bill.",
        "The Society has taken {a}'s counting-house without a fight. {A} calls the surrender \"a relocation\". {b} calls it the best show it has seen from the fort in years.",
        "{A}'s factor at Kessar surrendered with honours and walked his men to the river. The boys of {b}, paid a penny an hour, want to know when the next siege is.",
      ],
    },
  },
  siege_stormed: {
    piece: { kind: "board", surface: "wall", label: "The counter from the Syndicate's Kessar post, with a bullet hole in its brass scale. The Committee's card reads: TAKEN BY STORM. THE SCALE WAS SHORT." },
    memoryLine: [
      "I saw you storm the Syndicate's post from my wall. It was quick. It was also on my bank, and some of it is still there. The Ward will want to talk about the clean-up.",
      "Word from my south bank: you took the Syndicate's counting-house at a run. My sentries were impressed. My clerks are counting the graves.",
    ],
    headlines: [
      "Counting-House Taken by Storm; Society's Flag Raised Over Kessar Post",
      "Syndicate Post Falls to Assault; Factor Found Under Counter, Unhurt, Indignant",
      "The Storming of Kessar: The Society Goes in Over the Counter",
      "Britannia Takes the Counting-House at Bayonet Point, Ledger and All",
    ],
    standfirsts: [
      "The Society stormed the Syndicate's trading post at Kessar and raised its own flag. The factor surrendered from under his counter. Casualties: {dead}. Purse: £{purse}. {spin}",
      "The War Committee asked for a proper siege and got an assault. It calls this \"the regular siege, accelerated\". Casualties: {dead}. Purse: £{purse}. {spin}",
      "The Syndicate's men at Kessar fought from behind a tent and a counter, so not for long. The Ward watched, and is sending bills. Casualties: {dead}. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A trade dispute at Kessar was \"settled firmly\", with bayonets.",
      "The Society \"took possession of a trading post\" on the south bank, over its counter.",
    ],
    debrief: "At Kessar the Syndicate's post was taken by storm. The Society has its flag, and the Ward's bank is a mess.",
    news: {
      head: ["{A}'s Kessar Post Stormed", "{A} Loses Its Counting-House at a Run", "Blood on the South Bank at Kessar"],
      body: [
        "A Society party has stormed {A}'s trading post at Kessar. {A} calls it an act of war against a shop. {b} calls it an act of war on its bank.",
        "The Society stormed {a}'s counting-house at Kessar and raised its own flag. The factor wants a receipt for the post. {b} wants one for the bank.",
        "{A} confirms it lost its post at Kessar to an assault, and promises to remember it. So does {b}, which watched it all from the fort.",
      ],
    },
  },
  siege_bought: {
    piece: { kind: "envelope", surface: "table", label: "The factor's receipt, in a Syndicate envelope: ONE (1) TRADING POST, IN WORKING ORDER, GOODWILL INCLUDED. The goodwill is not listed." },
    memoryLine: [
      "I hear the Society bought the Syndicate's post on my bank instead of taking it. You paid the Syndicate to leave. Only one of you is a merchant.",
      "Word from my south bank: you laid siege to a shop and then paid for it at the counter. My clerks have entered it under TRADE. My sentries have entered it under something else.",
    ],
    headlines: [
      "Society Ends Siege of Kessar Post by Buying It; \"Goodwill Included\"",
      "Counting-House Changes Hands at the Counter; War Committee Bewildered",
      "The Siege That Was a Sale: Syndicate Factor Leaves With a Profit",
      "Society Buys the Post It Was Besieging, at a Fair Price, Allegedly",
    ],
    standfirsts: [
      "The Society's party surrounded the Syndicate's post with every formality, then bought it from the factor. The Syndicate's ledger records a sale. Purse: £{purse}. {spin}",
      "The War Committee ordered a siege and got a receipt. It is checking the rule book to see if buying counts as a surrender. Purse: £{purse}. {spin}",
      "The factor took down his own flag, counted the Society's money twice and walked his men to the river at his own pace. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A Syndicate post at Kessar was \"acquired by negotiation\". The negotiation was a price.",
      "The Society \"ended the fighting on commercial terms\". The terms were the Syndicate's.",
    ],
    debrief: "At Kessar the Society bought the Syndicate's post from its factor. The post is gone, and the Syndicate is richer.",
    news: {
      head: ["{A} Sells Its Kessar Post to Its Besiegers", "A Siege Settled at the Counter", "{A}'s Factor Leaves Kessar in Profit"],
      body: [
        "{A} has sold its trading post at Kessar to the Society, which was besieging it at the time. The factor calls the price fair and the siege \"good for business\".",
        "The Society has paid {a} to give up its post at Kessar. {A} says it is now planning more posts, in places the Society might like to besiege.",
        "{A}'s counting-house at Kessar was sold over its own counter. Who owns the bank now? The Lamp-Warden says the Ward always has. {a} and the Society may argue elsewhere.",
      ],
    },
  },
  siege_lifted: {
    piece: { kind: "frame", surface: "wall", label: "A sketch by the expedition's artist: the Syndicate's relief marching into the Counting-House yard, cheering. The Committee has hung it facing the wall." },
    memoryLine: [
      "I watched the Syndicate's relief reach its post while you were besieging it. My boys came home with their pennies. They call it the best day's work they ever did for nothing.",
      "Word from my south bank: your siege was broken by a boat and a few men in a hurry. The Syndicate's flag is still up. So, I notice, is mine.",
    ],
    headlines: [
      "Siege of Kessar Lifted; Syndicate Relief Reaches the Counting-House",
      "Relief Column Marches Into Syndicate Post; Society's Siege \"Discontinued\"",
      "The Counting-House Holds: Society Gives Up Siege of a Tent",
      "War Committee Regrets the Outcome at Kessar, and Blames the Rule Book",
    ],
    standfirsts: [
      "The Syndicate's relief boat landed at Kessar and marched its men into the besieged post. The siege was over. The factor sent the party his compliments. Purse: £{purse}. {spin}",
      "The War Committee's siege ended when the Syndicate's relief arrived. The Committee complains this was \"not in the rule book\". Purse: £{purse}. {spin}",
      "The Ward's picket boys were paid off at a penny an hour and went home. The Syndicate's flag stays up on its pole. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A siege at Kessar was \"discontinued in favour of other priorities\", chiefly the enemy.",
      "The Society \"brought its siege to a close\" at Kessar. The Syndicate's relief closed it.",
    ],
    debrief: "At Kessar the Syndicate's relief reached its post and broke the siege. The post stands, and the Ward saw it all.",
    news: {
      head: ["{A}'s Kessar Post Relieved", "The Siege That Was Lifted", "{A} Holds the South Bank"],
      body: [
        "{A} reports its post at Kessar saved by a relief boat, and the Society's siege lifted. The factor has billed the Society for the trouble. {b} has framed a copy.",
        "The Society's siege of {a}'s counting-house was broken by a relief that came downriver on time. {b} says it was the only thing in the affair that was.",
        "{A}'s post on Kessar's south bank stands. From the fort, {b} describes the Society's siege as \"thorough, in the paperwork\".",
      ],
    },
  },
};

/** The paper's story heads for the siege (keyed by template id, spread into `STORY_HEADS`). */
export const SIEGE_STORY_HEADS = {
  counting_house: ["The Siege of Kessar, in Figures", "From the Lines Before the Counting-House", "On the Matter of a Siege"],
} as const;
