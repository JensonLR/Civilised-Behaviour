import type { EndingCopy, RaidEnding } from "./regionEndings.ts";

/**
 * The Raid on the Post's authored copy (D-045, Kessar's fifth contract): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch. Satire aimed at INSTITUTIONS: a
 * Syndicate that raids by invoice and calls it "a security consultation", a Society that defends its outposts with the same zeal it founded them with paperwork, and a Ward that watches
 * the whole thing from its fort and minutes who won. Fictional cultures only (scanned by noRealWorld.test.ts). Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */
export const RAID_COPY: Record<RaidEnding, EndingCopy> = {
  post_held: {
    piece: { kind: "pennant", surface: "wall", label: "A Syndicate raiding torch, burnt out, with a label tied to it in the quartermaster's hand: RETURNED UNLIT, MOSTLY." },
    memoryLine: [
      "I watched the Syndicate try your post from my wall. I watched it stop trying. My sentries were impressed, and asked me not to tell you so. I am telling you so.",
      "Your post on my south bank stood when the Syndicate came with torches. I have revised my estimate of the Society upward, by a small amount, in pencil.",
    ],
    headlines: [
      "Syndicate Raiders Repelled at the Society's Post; Torches \"Returned Unused\"",
      "South-Bank Post Holds; Raiders Discover the Yard Is Occupied",
      "The Post Stands: Society Defends Its Stores and, Briefly, Its Reputation",
    ],
    standfirsts: [
      "A raiding party in Syndicate colours came up the south bank with torches and a list, and went back down it with neither. Casualties: {dead}. Purse: £{purse}. {spin}",
      "The Society's outpost at Kessar was visited by a security consultation from the Dunmarrow-Vesk Syndicate, which the outpost declined. Purse: £{purse}. {spin}",
      "The Lamp-Warden watched the defence from the fort's wall and is said to have nodded once, which the Society is counting as a medal. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"maintained the integrity of its stores\" at Kessar, against a determined consultation.",
      "A raid was \"politely declined\" at the south-bank post, at rifle range.",
    ],
    debrief: "At Kessar the Syndicate's raiders were broken in the post's yard; the stores stand and the watch is steadier for it.",
    news: {
      head: ["{A}'s Raid on the Society's Post Fails", "{A} Counts Its Torches, and Its Raiders", "Kessar Post Holds Against {a}"],
      body: [
        "The raiding party the Syndicate sent against the Society's post at Kessar has come back without the stores and without several raiders; {b} watched from the fort and took notes.",
        "The Syndicate's attempt on the south-bank post ended in the post's yard, badly. It now describes the raid as \"a reconnaissance\", and {b} describes it as finished.",
        "A Syndicate raid with torches, a list and a captain met a defended yard at Kessar; {b} has entered the result in its book of things it saw from its wall.",
      ],
    },
  },
  post_burned: {
    piece: { kind: "crate", surface: "chest", label: "A scorched crate lid from the Kessar post's stores, the stencil half burnt away: PROPERTY OF THE SOC" },
    memoryLine: [
      "I saw the smoke from your post on my south bank. I sent no one. It was not my bank's fire to put out, and you did not ask. Next time, perhaps, ask.",
      "The Syndicate burned your stores within sight of my gate. My sentries counted the torches. They also counted the defenders, and the second number was smaller.",
    ],
    headlines: [
      "Society Post Raided at Kessar; Stores \"Reallocated by Fire\"",
      "Syndicate Torches the South-Bank Stores; Society Regrets the Inconvenience",
      "Smoke Over the Kessar Post: Raiders Leave With Everything but the Flag",
    ],
    standfirsts: [
      "Raiders in Syndicate colours reached the yard of the Society's post at Kessar and set its stores alight. The post stands; its larder does not. Purse: £{purse}. {spin}",
      "The Society has described the burning of its south-bank stores as \"an unscheduled inventory\". The Syndicate has described it as a success. Purse: £{purse}. {spin}",
      "The Lamp-Warden watched the smoke from the fort and did not comment, at length. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society's stores at Kessar were \"reduced by external factors\", chiefly torches.",
      "An outpost \"experienced a supply interruption\", visible from the fort.",
    ],
    debrief: "At Kessar the Syndicate's raiders torched the post's stores; the post is weaker and the Ward saw it all.",
    news: {
      head: ["{A} Burns the Society's Stores at Kessar", "Smoke on the South Bank; {A} Claims It", "{A}'s Raiders Reach the Post's Yard"],
      body: [
        "The Syndicate's raiding party reached the Society's post at Kessar and set its stores alight, then left, slowly; {b} watched from the fort and did not intervene.",
        "The Society's south-bank stores are ash. The Syndicate calls the raid \"a market correction\", and {b} calls it a fire on its bank that it did not start.",
        "Raiders with Syndicate torches burned everything on a Syndicate list. {b} notes that they left the post's flag flying, out of politeness or by mistake.",
      ],
    },
  },
  protection_paid: {
    piece: { kind: "envelope", surface: "table", label: "A Syndicate receipt for \"one season's security consultation, the south-bank post\", with a renewal date already filled in." },
    memoryLine: [
      "I hear the Society paid the Syndicate not to burn its post on my bank. It is a reasonable arrangement. I shall be proposing a similar one at the toll bar.",
      "Word from the south bank: your post stands because you bought it. The Syndicate is very pleased with its new client. So, I confess, am I, in a different way.",
    ],
    headlines: [
      "Society Engages Syndicate for \"Security Consultation\"; Post Unburned",
      "Kessar Post Pays the Raiders, Keeps the Stores, Loses the Argument",
      "Protection Purchased at the South Bank; Renewal Notice Already Received",
    ],
    standfirsts: [
      "A raiding party arrived at the Society's post with torches and a price, and left with the price. The stores stand. So does the Syndicate's new account. Purse: £{purse}. {spin}",
      "The Society describes the payment to the Syndicate's raiding captain as \"a prudent retainer\". The Syndicate describes it as Tuesday. Purse: £{purse}. {spin}",
      "Nobody was hurt at Kessar, except the principle, which was not on the inventory. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"secured the post's continuity\" at Kessar, at the Syndicate's rates.",
      "A raid was \"converted into a contract\" at the south-bank post, payable in advance.",
    ],
    debrief: "At Kessar the Society paid the Syndicate's raiders to leave; the post is whole and the Syndicate has a client.",
    news: {
      head: ["{A} Sells the Society Its Own Safety", "{A}'s Raiders Paid to Go Home", "{A} Opens a Protection Account at Kessar"],
      body: [
        "The Syndicate's raiding captain accepted the Society's money at the edge of the post's yard and marched his party home unlit; {b} has asked to see the receipt.",
        "The Society's post at Kessar stands, paid for twice: once in crates, once in protection. The Syndicate has called it \"a partnership\", and {b} has called it something shorter.",
        "No shot was fired at the south-bank post. The Syndicate was paid instead, and has sent a renewal notice, and {b} has made a note of the rate.",
      ],
    },
  },
};

/** The ledger story's heading for the raid (>= 3), by the paper's `lastTemplate`. */
export const RAID_STORY_HEADS = {
  outpost_raid: ["The Raid on the Post, in Figures", "Kessar: the Post Reports", "On the Matter of a Yard"],
} as const;
