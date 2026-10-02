import type { EndingCopy, ReapersEnding } from "./regionEndings.ts";

/**
 * The Reapers' Strike's authored copy (D-042, Highmark's second contract): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch. Satire aimed at INSTITUTIONS: a Crown
 * granary that pays by one bushel and sells by another and calls the difference "the royal measure", a Syndicate that contracts bonded labour as a weather service, and a Society that will settle a strike
 * with whatever is in its pocket and file the receipt under Improvement. The reapers, stewards and labourers are people with names; only the offices they hold are laughed at. Fictional cultures only
 * (scanned by noRealWorld.test.ts). Pending developer review (docs/AI_CONTENT_REGISTER.md). Placeholders in the paper's lines: {toll} {bridge} {dead} {routed} {wounded} {limbs} {civ} {spin} {purse}
 * {lies}; in the powers' dispatch {a} {A} {b} (the powers' short names).
 */
export const REAPERS_COPY: Record<ReapersEnding, EndingCopy> = {
  honest_measure: {
    piece: { kind: "barrel", surface: "chest", label: "A bushel measure with a third of it sawn away and a brass plate screwed on: HONEST, BY ORDER, WITNESSED." },
    memoryLine: [
      "I hear the Society weighed the Crown's own bushel in front of the Crown's own Steward at Highmark. I have asked for a copy of the method. For the toll bar's scales, you understand.",
      "Word from the hill country: the reapers are back in the barley at an honest rate, and a Steward is writing a great many letters. I gather you carried the evidence yourselves. Unusual.",
    ],
    headlines: [
      "Royal Bushel Found to Be a Bushel and a Third; Crown Calls It \"Generous Rounding\"",
      "Highmark Barley In at an Honest Measure; Society Weighed Something Nobody Asked It To",
      "Reapers' Compact Returns to the Field; Steward Returns to His Arithmetic",
      "The Bushel Was Larger on the Inside: Granary Fraud Ends in a Brass Plate",
    ],
    standfirsts: [
      "The Crown's royal bushel was carried down from the granary scale and weighed against the bushel the Crown sells by, in front of witnesses and a Steward who wished there were fewer of them. The Compact went back to work at the old rate. Purse: £{purse}. {spin}",
      "An honest measure was decreed at Highmark after the Society produced, from the granary, a bushel a third larger than it had any right to be. The Syndicate's grain contract is said to be under review. Purse: £{purse}. {spin}",
      "The barley is in, the Compact is paid by a bushel that holds a bushel, and the Steward of the Granary has asked for leave to spend more time with his ledgers. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"assisted the Crown in recalibrating its expectations\", with a barrel and two witnesses.",
      "A royal measure was \"brought into line with the other measures\", which the Steward describes as a reduction.",
    ],
    debrief: "At Highmark the royal bushel was proven a third too large; the Compact went back on an honest measure.",
    news: {
      head: ["{A} Back in the Barley on an Honest Bushel", "{A} Win a Measure; {b} Loses a Contract", "Granary Fraud Weighed and Found Heavy; {a} Pleased"],
      body: [
        "{A} have returned to the harvest at the old rate, paid by a bushel the Crown has been asked to stop calling royal; {b} describes its grain contract as 'subject to a period of reflection'.",
        "The Crown's Steward of the Granary has decreed an honest measure, in writing, after a demonstration involving a barrel. {A} have hung the old bushel in their hall, upside down, and {b}, which was not consulted, has noticed.",
        "{A} report that a bushel now holds a bushel, a development their delegates have described as 'overdue by about forty harvests'; {b} has sent its regrets and its lawyers, in that order.",
      ],
    },
  },
  bought_back: {
    piece: { kind: "envelope", surface: "table", label: "A receipt from the Reapers' Compact for a harvest bonus, signed with a cross, a scythe and the words NOT A SETTLEMENT." },
    memoryLine: [
      "I hear the Society ended a strike at Highmark by paying it. Very efficient. I shall remember that strikes have a price, and that you carry the money.",
      "The reapers are back in the barley, I am told, on your coin and the same crooked bushel. It is a kind of peace. It is the kind you rent.",
    ],
    headlines: [
      "Society Pays Reapers to Reap; Crown Delighted, Bushel Unchanged",
      "Highmark Strike Ends in a Bonus; Grievance \"Carried Forward to Next Harvest\"",
      "Barley In, Purse Out: The Society Settles a Dispute It Was Not Party To",
    ],
    standfirsts: [
      "The Reapers' Compact took up its scythes again after the Society paid a harvest bonus out of its own purse, which the Crown's Steward has described as 'a most generous gesture by somebody else'. Purse: £{purse}. {spin}",
      "Nothing at the granary has changed except the Society's balance, which has. The royal bushel remains royal, and large. Purse: £{purse}. {spin}",
      "The Compact's Foreperson signed for the bonus with the words NOT A SETTLEMENT, which the Society's clerk has filed under Settlements. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"incentivised a return to productivity\" at Highmark, out of its own pocket.",
      "A labour dispute was \"resolved by a contribution\", which the Crown has thanked the Society for in a letter on the Crown's paper.",
    ],
    debrief: "At Highmark the Compact went back to work on the Society's money; the royal bushel is as large as ever.",
    news: {
      head: ["{A} Back at Work, Paid by a Stranger", "{A} Take the Bonus and Keep the Grievance", "Strike Bought Out at Highmark; {A} Count the Coin Twice"],
      body: [
        "{A} have returned to the barley on a bonus paid by the Society, which their Foreperson describes as 'a down payment on an argument'. The royal bushel was not discussed.",
        "The harvest at Highmark is in. {A} say they were paid for this one; they have begun, out loud, to wonder who pays for the next.",
        "{A} accepted a bonus from the Society's purse and a lecture from the Crown's Steward, and have kept the bonus. The bushel remains, by royal measure, enormous.",
      ],
    },
  },
  strike_broken: {
    piece: { kind: "pennant", surface: "wall", label: "A Syndicate armband: SEASONAL OPERATIVE, BONDED. It was found in the barley, by the gate, next to a scythe nobody picked up." },
    memoryLine: [
      "I hear the Syndicate landed a barge of bonded labour at Highmark and broke a strike with it while the Society watched. The reapers will not forget whose boots were in the barley. Nor whose were not.",
      "Word from the hill country: the barley was cut by the Syndicate's men and paid by the Crown's crooked bushel. I am sure you had excellent reasons. The reapers are composing a list of them.",
    ],
    headlines: [
      "Syndicate Labour Cuts Highmark Barley; Strike \"Concluded by Other Means\"",
      "Bonded Operatives Reach the Field; Compact Reaches the Conclusion It Feared",
      "Barge, Bushel and Barley: The Syndicate Brings In the Harvest, and the Bill",
    ],
    standfirsts: [
      "A barge of seasonal operatives, bonded, marched up from the quay and into the Crown's barley while the Reapers' Compact stood at its picket line, which is now a line of people standing. Purse: £{purse}. {spin}",
      "The Syndicate has delivered the Crown's harvest on contract, ahead of the rain and behind the reapers' backs. The royal bushel was used throughout. Purse: £{purse}. {spin}",
      "The strike at Highmark is over in the sense that it no longer has anything to strike against. The Compact's Foreperson declined to comment, at length. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"observed a transition in harvest staffing\" at Highmark, from a suitable distance.",
      "A labour dispute was \"overtaken by events\", which arrived by barge, in armbands.",
    ],
    debrief: "At Highmark the Syndicate's strike-breakers reached the barley; the Compact's grievance is now a grudge.",
    news: {
      head: ["{A} Cut Out of Their Own Barley by {b}", "Strike Broken by Barge; {A} Left Holding Their Scythes", "{A} Watch Strangers Reap Their Field"],
      body: [
        "Bonded operatives hired by {b} reached the Highmark barley before the rain and before any settlement. {A} have returned to their hall, where the scythes are being kept sharp for reasons the Crown would prefer not to hear.",
        "The Crown's harvest is in, cut by labour hired by {b}, on {b}'s terms, by the Crown's own bushel. {A} describe the arrangement as 'complete', which is not a compliment.",
        "{A} report that their strike ended when another man's boots crossed their field; {b} reports a profitable season and asks that its operatives be addressed by number.",
      ],
    },
  },
  barley_lost: {
    piece: { kind: "frame", surface: "wall", label: "A pressed ear of Highmark barley, black with rain, mounted under glass with the label UNCUT (BY AGREEMENT OF NOBODY)." },
    memoryLine: [
      "I hear the rain got to Highmark's barley before anybody got to an agreement. The price of bread at my gate has gone up by a ha'penny. I am told to thank the Society.",
      "News from the hill country: the reapers stood out, the Crown stood firm, and the barley lay down in the rain. Everyone was right, and nobody will eat.",
    ],
    headlines: [
      "Rain Settles Highmark Strike; Barley Lost, Positions Maintained",
      "Crown and Compact Agree on Nothing; Weather Agrees for Them",
      "Highmark Harvest Lies Down in the Wet; Grain Imports \"Already Arranged\"",
    ],
    standfirsts: [
      "The barley at the foot of the Highmark hill was left standing for a bushel nobody would measure and then lay down under the rain. The Brine Houses have announced a shipment of imported grain at a price. Purse: £{purse}. {spin}",
      "Both sides held firm, and the rain held firmer. The Steward of the Granary has described the harvest as 'deferred'; the Compact has described it as 'gone'. Purse: £{purse}. {spin}",
      "Nobody at Highmark lost the argument. Everybody lost the barley. The Society was in attendance. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"supported a period of reflection\" at Highmark, which the weather concluded.",
      "A harvest was \"deferred indefinitely\" by the rain, with the Society's full and present attention.",
    ],
    debrief: "At Highmark the rain reached the barley first; the harvest is lost and the Houses are selling imports.",
    news: {
      head: ["Barley Lies Down in the Rain; {A} Stand Firm in It", "Grain From {b} for a Hill That Grew Its Own", "Nobody Wins at Highmark; {b} Invoices Anyway"],
      body: [
        "{A} stood out and the barley stood in the field until the rain arrived to settle the matter; {b} has opened a grain account at the Highmark quay, at the delta's prices.",
        "The harvest at Highmark is lost. {A} blame the Crown's bushel; the Crown blames the weather; {b} blames nobody, being too busy unloading.",
        "{A} have asked the Crown to reconsider the royal bushel in light of there being nothing left to measure; {b} sends condolences and a price list.",
      ],
    },
  },
};

/** The ledger story's heading for the strike (>= 3), by the paper's `lastTemplate`. */
export const REAPERS_STORY_HEADS = {
  reapers_strike: ["The Reapers' Strike, in Figures", "Highmark: the Granary Reports", "On the Matter of a Bushel"],
} as const;
