import type { Opt, ParleyScript } from "./parleys.ts";

/**
 * The Saltmarket Delta's three parleys (D-037, package D4): the Tide Constabulary's Reeve at the Customs House, the Exchange's auctioneer, a House-Head with a paddle. Authored copy (scanned by
 * noRealWorld.test.ts). The ENGINE decides what each key means (parleys.ts: pay -> paid, propose -> survey, tell -> tell, ask -> a second round plus `learn`, flatter moves the price, threaten -> hostile);
 * the two templates (scenarios/smugglingRun.ts, floodedMarket.ts) read what each result MEANS. Satire at institutions: a customs service that charges for being looked at, an auction house that sells the weather,
 * a merchant oligarchy whose every handshake is a lien.
 */
const walk: Opt = { key: "walk", label: "Walk away", hint: "Nothing lost, nothing gained.", cost: 0 };

const TIDE_REEVE: ParleyScript = {
  speaker: "Tide-Reeve Odell Marsh-Pettigrew, of the Customs House",
  open: [
    "The Tide-Reeve looks up from a ledger bound in what may once have been a sail. \"State your cargo,\" he says. \"Then state it again, differently. The Constabulary compares the two and charges for the difference. The usual handling charge is £{price}.\"",
    "\"Welcome to the Customs House,\" says the Tide-Reeve, \"where everything is declared and nothing is ever found. You are looking at a man who is paid by the Houses to notice and by the Syndicate to be somewhere else. What is it you would like me not to see? The courtesy is £{price}.\"",
  ],
  round2: [
    "\"The patrol,\" says the Reeve, lowering his voice by exactly as much as the form requires, \"walks the boardwalk from the Customs Bridge to the Exchange and back, and takes seventy seconds over each leg because the boards are wet. If somebody lit the signal lantern at the cove, they would walk to the cutter berth instead, to see who was lighting it. Do not tell them I said that. I will say you guessed. The courtesy remains £{price}.\"",
    "\"Between us,\" says the Reeve, \"the Constabulary has two men on the boardwalk and a great deal of faith in lanterns. A lamp lit at the cove draws them off for a minute; a stamped passage keeps them civil for four. I have said nothing, and I would like it noted that I have said it in a low voice. £{price}.\"",
  ],
  walk: "You step back. The Tide-Reeve makes a note of the time, the tide and your general demeanour, in that order.",
  hostile: "The Tide-Reeve takes his spectacles off, folds them, and puts them away, which in the Constabulary is the signal for everything else. \"Gentlemen,\" he says, \"we have a declaration.\"",
  flatter: {
    ok: [
      "\"A stamp collector!\" The Reeve is delighted. \"Nobody admires the stamp. £{price}, then, and I shall use the large one.\"",
      "\"You have an eye for administration,\" says the Reeve, who has not been looked at kindly since the spring. \"£{price}, and do come again, if you can arrange to have been here before.\"",
    ],
    fail: [
      "\"Charming,\" says the Reeve, \"and flattery is a service, and services are billed. £{price}.\"",
      "\"I was flattered by the Houses themselves,\" says the Reeve. \"They billed me for it. £{price}.\"",
    ],
  },
  deal: {
    survey: "\"A declaration,\" says the Reeve, with real tenderness. \"Unlabelled salt, forty crates of it, in the barge's keeping, duty owing to the Houses. Stamped, entered and filed under 'unlikely'. The patrol has been told that it has not been told. You are, for the moment, an honest smuggler, which is the rarest kind.\"",
    paid: "The courtesy changes hands under the ledger, where courtesies go. The Reeve stamps a slip with the large stamp and hands it across without looking at it. \"A stamped passage. It will be honoured by anyone who has been told to honour it, for about four minutes, and by the tide not at all.\"",
    tell: "\"You are informing,\" says the Reeve, very quietly, \"on your own barge.\" He writes for a long time. \"That is the most honest thing anybody has done in this building since it was built. The Houses will pay a finder's fee. I shall also have to impound the barge, in your honour, with a small ceremony.\"",
  },
  short: "\"You are short,\" says the Reeve, counting what is not there. \"The Constabulary does not extend credit. It extends deadlines.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "propose", label: "Declare the barge: unlabelled salt, duty to the Houses", hint: "Free. A stamped declaration: the patrol waves you through. The Houses take the duty, and with it the profit.", cost: 0 },
          { key: "pay", label: `Offer the Reeve a courtesy (£${p})`, hint: "A stamped passage for a few minutes. The cargo is yours to sell.", cost: p },
          { key: "ask", label: "Ask when the patrol changes", hint: "He might tell you. He will certainly enjoy it.", cost: 0 },
          { key: "flatter", label: "Admire the stamp", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
          { key: "tell", label: "Inform on your own barge", hint: "The Houses pay a finder's fee. The barge is impounded. You will be thanked, and watched.", cost: 0 },
          { key: "threaten", label: "Remind him who has the rifles", hint: "The Constabulary has four. They are very fond of them.", cost: 0 },
          walk,
        ]
      : [
          { key: "propose", label: "Declare the barge: unlabelled salt, duty to the Houses", hint: "Free, and stamped.", cost: 0 },
          { key: "pay", label: `Offer the Reeve a courtesy (£${p})`, hint: "A stamped passage for a few minutes.", cost: p },
          { key: "tell", label: "Inform on your own barge", hint: "The Houses pay a finder's fee. The barge is impounded.", cost: 0 },
          walk,
        ];
  },
};

const AUCTIONEER: ParleyScript = {
  speaker: "Mr. Crispin Spate-Holloway, Auctioneer to the Houses",
  open: [
    "\"Lot one,\" says the Auctioneer, who is standing in water to the ankle and has been doing so since the lot was catalogued, \"is the Tide Concession of Ossuary Bay: the right to charge visitors for the weather, in perpetuity or until it rains. The reserve is £{price}, and the reserve rises with the water, which I did not design, but I do invoice.\"",
    "\"Madam, sir, persons unknown,\" says the Auctioneer, tapping the hammer on the rail, which is now a little wet, \"the Exchange sells at high water, and the high water sells at the Exchange. The lot stands at £{price}. It stood at less a moment ago. It will stand at more a moment hence. That is called price discovery. It is also called the ankle.\"",
  ],
  round2: [
    "\"The reserve,\" says the Auctioneer, lowering the hammer in the manner of a man lowering his voice, \"is the lowest sum at which a House will pretend it has not been offered more. It stood at forty this morning and rises six pounds for every half-minute of tide. The Heads have their ceilings and I have mine; mine is the roof, and the roof has a leak. Bid now at £{price}, or bid later at more.\"",
    "\"I will tell you what I tell everybody at this point,\" says the Auctioneer, \"which is nothing, slowly, in several languages of finance. The Heads each have a figure at which they stop raising the paddle. The Syndicate's factor has one too and a cheque to go with it. A bid below the highest of those is a donation to the Houses' reputation for restraint. £{price}, at this moment.\"",
  ],
  walk: "You step back. The Auctioneer notes your absence from the bidding, which in this hall counts as a bid of nil, and is accepted.",
  hostile: "The hammer comes down on the rail, once, and the sale is suspended. \"Gentlemen, ladies, creditors,\" says the Auctioneer, with the calm of a man who has been shouted at by the sea, \"the lot is withdrawn. The water, I regret, is not.\"",
  flatter: {
    ok: [
      "\"A person of taste,\" says the Auctioneer, and the hammer dips a fraction. \"£{price}, then. The ankle thanks you.\"",
      "\"You flatter the hammer,\" says the Auctioneer. \"The hammer blushes, in its way. £{price}.\"",
    ],
    fail: [
      "\"Flattery is not a paddle,\" says the Auctioneer. \"£{price}, to cover the compliment.\"",
      "\"I have been flattered by the tide itself,\" says the Auctioneer, \"and it still rose. £{price}.\"",
    ],
  },
  deal: {
    paid: "\"A bid,\" announces the Auctioneer, to the room and to the water, \"from the party at the back, which has an accent of the Society. Noted, entered and rising. The lot stands in your name until somebody higher says otherwise, or the tide does.\"",
    tip: "The Auctioneer's eyebrows rise by half an inch, which is their entire range. \"You propose,\" he says, \"to offer the lot onward before you own it. That is called selling short, and in this hall it is called a vocation. The Houses will be furious, in that order, once the hammer falls. I record your offer at the stated sum. Whoever pays for it, you will have been paid.\"",
  },
  short: "\"The purse,\" says the Auctioneer, glancing at the part of the room where it ought to be, \"appears to be elsewhere. Bids are cash, or credit, or, in the old tradition, cash described as credit. Try again with something that exists.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "pay", label: `Bid £${p} on the lot`, hint: "A bid is a promise of the purse: it stands until somebody bids higher. The highest standing bid at the hammer wins.", cost: p },
          { key: "tip", label: "Sell short: bid on credit and offer the lot onward", hint: "No cash down. If it is the highest at the hammer, the lot is yours, unpaid, and the Houses will not forget it.", cost: 0 },
          { key: "ask", label: "Ask what the reserve really is", hint: "He might tell you what the paddles go to. He will certainly bill you for the answer.", cost: 0 },
          { key: "flatter", label: "Admire the hammer", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
          { key: "threaten", label: "Suggest the hammer is a poor investment", hint: "The Exchange has guards. They are standing in the water too.", cost: 0 },
          walk,
        ]
      : [
          { key: "pay", label: `Bid £${p} on the lot`, hint: "A bid is a promise of the purse.", cost: p },
          { key: "tip", label: "Sell short: bid on credit and offer the lot onward", hint: "No cash down. The Houses will not forget it.", cost: 0 },
          walk,
        ];
  },
};

const HOUSE_HEAD: ParleyScript = {
  speaker: "A House-Head, with a paddle",
  open: [
    "The House-Head does not lower the paddle, which is numbered, lacquered and, you notice, wet. \"One of seven families,\" he says, \"and the only one of them speaking to you at this hour. I am bidding on behalf of my House, my cousins' Houses and the salt. What can the family do for you? The family's attention costs £{price}.\"",
    "\"We do not call it a bribe,\" says the House-Head, lifting a paddle painted with a number and a heron. \"We call it a contribution to the tide. It is traditionally made in cash, in advance and in front of witnesses, who are also a contribution. £{price}. And I do have a paddle, as you can see, and I intend to raise it.\"",
  ],
  round2: [
    "\"My House,\" says the House-Head, glancing along the row to see who is looking, \"will raise the paddle to the figure it has always raised it to, and not a penny past it, because past it is the family's reputation. The Syndicate's factor, I notice, will go higher, which is why he is not asked to dinner. The figure I may not mention is the loudest in the hall. I have not mentioned it. £{price}.\"",
    "\"I will say only this,\" says the House-Head. \"The loudest paddle in the room is mine, and the Syndicate's cheque is the second. If either of us were taken out of the bidding, the other would be unbearable. Do the arithmetic. I have done it in my head, twice, and billed myself. £{price}.\"",
  ],
  walk: "You step back. The House-Head's paddle follows you for a moment, then returns to the air above the bidding, where it lives.",
  hostile: "The paddle comes down. A second later every other paddle in the hall comes down with it, and the Exchange, which has been bidding politely for an hour, discovers that it is a room full of people with a great many creditors and one exit.",
  flatter: {
    ok: [
      "\"The heron,\" says the House-Head, softening, \"is an acquired taste. £{price}, then, and I shall say your name when I lose.\"",
      "\"You know the family badge,\" says the House-Head. \"Very few do. It is on all our debts. £{price}.\"",
    ],
    fail: [
      "\"We are a family of compliments,\" says the House-Head. \"We have been given every one there is. £{price}.\"",
      "\"The paddle,\" says the House-Head, \"is not moved by charm. £{price}.\"",
    ],
  },
  deal: {
    paid: "The contribution is made in front of witnesses, who are also a contribution. The House-Head lowers the paddle for the first time since the opening, a gesture the room has not seen in eleven years. \"My House withdraws,\" he says, \"for reasons of the tide.\" He walks to the back and sits in the water with great dignity.",
    survey: "\"A consortium,\" says the House-Head, writing it down, with a flourish, on a slate he was holding for that purpose. \"The family's paddle and the Society's purse, one lot, one hammer, and a very long and affectionate agreement that nobody will read. Sign here, and here, and here. The ink, you will notice, is salt.\"",
    tell: "\"The Syndicate's factor is selling the lot before he owns it?\" The House-Head's paddle is trembling. \"In the Exchange? In front of the Houses? Thank you. I shall not mention where I heard it, and I shall mention it to everybody. The family's figure has just come down. Mine, personally, has gone up.\"",
  },
  short: "\"You are short,\" says the House-Head, who has never been short of anything. \"The family does not take instalments. It takes interest.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "pay", label: `Make a contribution to the tide (£${p})`, hint: "The House-Head withdraws his paddle: one rival fewer. The money is gone.", cost: p },
          { key: "propose", label: "Propose a consortium: the family's paddle and your purse", hint: "Free, once you are in the bidding: the family pools with bidders, not spectators. Two signatures (any mix of Houses and the Syndicate's factor) make a pooled lot.", cost: 0 },
          { key: "tell", label: "Whisper that the Syndicate's factor means to sell short", hint: "Every House's ceiling comes down a little: nobody likes to be shorted at their own auction.", cost: 0 },
          { key: "ask", label: "Ask what the family's figure is", hint: "He will not say. He will, however, hint at where the loudest paddle stops.", cost: 0 },
          { key: "flatter", label: "Admire the heron", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
          { key: "threaten", label: "Suggest a paddle is a poor shield", hint: "The Exchange has guards. So does every House.", cost: 0 },
          walk,
        ]
      : [
          { key: "pay", label: `Make a contribution to the tide (£${p})`, hint: "The House-Head withdraws his paddle.", cost: p },
          { key: "propose", label: "Propose a consortium: the family's paddle and your purse", hint: "Free, once you have a bid standing. Two signatures make a pool.", cost: 0 },
          { key: "tell", label: "Whisper that the Syndicate's factor means to sell short", hint: "Every House's ceiling comes down a little.", cost: 0 },
          walk,
        ];
  },
};

export const SALTMARKET_PARLEYS = {
  tide_reeve: TIDE_REEVE,
  auctioneer: AUCTIONEER,
  house_head: HOUSE_HEAD,
} as const satisfies Partial<Record<"tide_reeve" | "auctioneer" | "house_head", ParleyScript>>;
