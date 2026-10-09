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
    "\"State your cargo,\" says the Tide-Reeve. \"Then state it again, differently. We charge for the difference. The usual fee is £{price}.\"",
    "\"Welcome to the Customs House,\" says the Tide-Reeve. \"The Houses pay me to notice things. The Syndicate pays me not to. What shall I not see? £{price}.\"",
  ],
  round2: [
    "\"The patrol walks the boardwalk, seventy seconds each way,\" the Reeve whispers. \"Light the cove lantern and they go to look. You guessed that. £{price}.\"",
    "\"Between us,\" says the Reeve, \"a lit lantern at the cove draws the patrol off for a minute. A stamped pass keeps them polite for four. I said nothing. £{price}.\"",
  ],
  walk: "You step back. The Tide-Reeve writes down the time, the tide and the look on your face.",
  hostile: "The Tide-Reeve takes off his spectacles: the Constabulary's signal to fight. \"Gentlemen,\" he says, \"we have a declaration.\"",
  flatter: {
    ok: [
      "\"A stamp collector!\" The Reeve is delighted. \"Nobody admires the stamp. £{price}, then, and I shall use the large one.\"",
      "\"You have an eye for paperwork,\" says the Reeve. Nobody has been kind to him since spring. \"£{price}, then.\"",
    ],
    fail: [
      "\"Charming,\" says the Reeve. \"Flattery is a service, and services are billed. £{price}.\"",
      "\"I was flattered by the Houses themselves,\" says the Reeve. \"They billed me for it. £{price}.\"",
    ],
  },
  deal: {
    survey: "\"A declaration!\" says the Reeve, delighted. \"Four crates of salt, duty to the Houses. The patrol will let you pass. An honest smuggler: the rarest kind.\"",
    paid: "The money goes under the ledger. The Reeve stamps a slip and hands it over without looking. \"A stamped pass. The patrol will honour it for about four minutes.\"",
    tell: "\"Informing on your own barge?\" The Reeve writes happily. \"How honest. The Houses will pay you a finder's fee. The barge is seized, in your honour.\"",
  },
  short: "\"You are short of money,\" says the Reeve. \"The Constabulary gives no credit. Only deadlines.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "propose", label: "Declare the barge (free)", hint: "The patrol lets you pass for four minutes. The Houses take the cargo's profit.", cost: 0 },
          { key: "pay", label: `Pay the Reeve a courtesy (£${p})`, hint: "A polite bribe. A stamped pass for four minutes, and the cargo stays yours.", cost: p },
          { key: "ask", label: "Ask when the patrol changes", hint: "He might tell you. He will certainly enjoy it.", cost: 0 },
          { key: "flatter", label: "Admire the stamp", hint: "Flattery might lower his price. It might raise it.", cost: 0 },
          { key: "tell", label: "Inform on your own barge", hint: "The Houses pay you a finder's fee and seize the barge. The job ends here.", cost: 0 },
          { key: "threaten", label: "Remind him who has the rifles", hint: "This starts a fight. The Constabulary has rifles too, and loves them.", cost: 0 },
          walk,
        ]
      : [
          { key: "propose", label: "Declare the barge (free)", hint: "Free. The Houses take the profit.", cost: 0 },
          { key: "pay", label: `Pay the Reeve a courtesy (£${p})`, hint: "A stamped pass for four minutes. You keep the cargo.", cost: p },
          { key: "tell", label: "Inform on your own barge", hint: "A finder's fee. The barge is seized.", cost: 0 },
          walk,
        ];
  },
};

const AUCTIONEER: ParleyScript = {
  speaker: "Mr. Crispin Spate-Holloway, Auctioneer to the Houses",
  open: [
    "\"Lot one: the Tide Concession,\" says the Auctioneer, ankle-deep in water. \"The right to charge visitors for the weather. £{price}, and rising with the tide.\"",
    "\"The lot stands at £{price},\" says the Auctioneer, tapping his hammer on a wet rail. \"It was less a moment ago. It will be more soon. The tide sets the price.\"",
  ],
  round2: [
    "\"The price rises six pounds every half-minute,\" the Auctioneer whispers. \"Each House stops at its own figure. To win, beat them all. £{price}, for now.\"",
    "\"Each House-Head stops at a secret figure,\" says the Auctioneer. \"So does the Syndicate's factor. Bid below the highest, and you lose. £{price}, for now.\"",
  ],
  walk: "You step back. The Auctioneer records it as a bid of nothing, and accepts it.",
  hostile: "The hammer comes down on the rail and the sale stops. \"The lot is withdrawn,\" says the Auctioneer calmly. \"The water, I regret, is not.\"",
  flatter: {
    ok: [
      "\"A person of taste,\" says the Auctioneer, lowering the hammer a little. \"£{price}, then.\"",
      "\"You flatter the hammer,\" says the Auctioneer. \"The hammer blushes, in its way. £{price}.\"",
    ],
    fail: [
      "\"Flattery is not a bid,\" says the Auctioneer. \"£{price}, to cover the compliment.\"",
      "\"I have been flattered by the tide itself,\" says the Auctioneer, \"and it still rose. £{price}.\"",
    ],
  },
  deal: {
    paid: "\"A bid from the back of the room!\" announces the Auctioneer. \"It stands in your name until somebody bids higher. Or the tide does.\"",
    tip: "The Auctioneer's eyebrows rise. \"You will sell the lot on before you own it? That is selling short. I shall write it down. The Houses will be furious.\"",
  },
  short: "\"Your purse seems to be elsewhere,\" says the Auctioneer. \"Bids are cash, or credit, or cash called credit. Try again with money that exists.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "pay", label: `Bid £${p} on the lot`, hint: "Your bid stands until someone bids higher. The highest bid at the hammer wins.", cost: p },
          { key: "tip", label: "Sell short: bid money you do not have", hint: "No cash down. If it is highest at the hammer, you win unpaid. The Houses will not forget.", cost: 0 },
          { key: "ask", label: "Ask how the price works", hint: "He might tell you how high the bidding goes. He will bill you for it.", cost: 0 },
          { key: "flatter", label: "Admire the hammer", hint: "Flattery might lower the price. It might raise it.", cost: 0 },
          { key: "threaten", label: "Threaten to break the hammer", hint: "The sale is called off at once. The guards are standing in the water too.", cost: 0 },
          walk,
        ]
      : [
          { key: "pay", label: `Bid £${p} on the lot`, hint: "Your bid stands until someone bids higher.", cost: p },
          { key: "tip", label: "Sell short: bid money you do not have", hint: "No cash down. The Houses will not forget it.", cost: 0 },
          walk,
        ];
  },
};

const HOUSE_HEAD: ParleyScript = {
  speaker: "A House-Head, with a paddle",
  open: [
    "The House-Head keeps his wet paddle raised. \"I bid for my House, my cousins' Houses and the salt,\" he says. \"The family's attention costs £{price}.\"",
    "\"We do not call it a bribe,\" says the House-Head, raising his heron paddle. \"We call it a contribution to the tide. £{price}, in cash, before witnesses.\"",
  ],
  round2: [
    "\"My House stops at its figure, and not a penny past it,\" says the House-Head. \"The highest paddle in the hall stops somewhere too. I did not say where. £{price}.\"",
    "\"The highest paddle here is mine,\" says the House-Head. \"The Syndicate's cheque comes second. Take one of us out of the bidding, and do the sums. £{price}.\"",
  ],
  walk: "You step back. The House-Head's paddle follows you for a moment, then goes back up.",
  hostile: "The paddle comes down, and every other paddle with it. The polite auction is suddenly a room of angry people with one exit.",
  flatter: {
    ok: [
      "\"The heron,\" says the House-Head, softening, \"is an acquired taste. £{price}, then, and I shall say your name when I lose.\"",
      "\"You know the family badge,\" says the House-Head. \"Very few do. It is on all our debts. £{price}.\"",
    ],
    fail: [
      "\"We have heard every compliment there is,\" says the House-Head. \"£{price}.\"",
      "\"The paddle,\" says the House-Head, \"is not moved by charm. £{price}.\"",
    ],
  },
  deal: {
    paid: "The money is paid before witnesses. The House-Head lowers his paddle for the first time in eleven years. \"My House withdraws,\" he says, and sits in the water.",
    survey: "\"A consortium,\" says the House-Head, writing on a slate. \"My family's paddle and your purse, as partners. Sign here, and here, and here. The ink is salt.\"",
    tell: "\"The factor will sell short? Here?\" The House-Head's paddle trembles. \"I shall tell nobody, and everybody.\" Every House will now bid a little lower.",
  },
  short: "\"You cannot pay,\" says the House-Head, who has never lacked anything. \"The family does not take instalments. It takes interest.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "pay", label: `Pay a contribution to drop his paddle (£${p})`, hint: "He stops bidding: one rival fewer. The money is gone.", cost: p },
          { key: "propose", label: "Propose a consortium: bid as partners", hint: "Free, once you have a bid in. Two signatures, from Houses or the factor, win the lot together.", cost: 0 },
          { key: "tell", label: "Whisper that the factor plans to sell short", hint: "Every House bids a little lower. Nobody likes being shorted.", cost: 0 },
          { key: "ask", label: "Ask how high the Houses will bid", hint: "He will not say. He will hint where the highest paddle stops.", cost: 0 },
          { key: "flatter", label: "Admire the heron", hint: "Flattery might lower his price. It might raise it.", cost: 0 },
          { key: "threaten", label: "Point out that a paddle is a poor shield", hint: "The sale is called off. The Exchange has guards, and so does every House.", cost: 0 },
          walk,
        ]
      : [
          { key: "pay", label: `Pay a contribution to drop his paddle (£${p})`, hint: "He stops bidding: one rival fewer.", cost: p },
          { key: "propose", label: "Propose a consortium: bid as partners", hint: "Free, once you have a bid in. Two signatures win it.", cost: 0 },
          { key: "tell", label: "Whisper that the factor plans to sell short", hint: "Every House bids a little lower.", cost: 0 },
          walk,
        ];
  },
};


/**
 * D-093, the Lost Survey: the Houses' Collector of Canal Dues (pay the dues, cede the chart, or sell them the survey outright) and the Society's own surveyor, who will not
 * leave without his books unless he is persuaded that the Society can measure the delta again. The template (scenarios/lostSurvey.ts) reads what each result MEANS:
 * paid = the dues, survey = the chart ceded (the collector) or left (the surveyor), tip = the survey sold.
 */
const HOUSE = "A word at the reed-cutter's house";
const DUES_COLLECTOR: ParleyScript = {
  speaker: "Mr. Silas Tench-Varley, Collector of Canal Dues to the Brine Houses",
  frame: { heading: HOUSE, asked: "Dues owing: £{price} · Round {round} · The Collector seems {mood}." },
  open: [
    "The Collector opens a huge ledger. \"Your surveyor measured nineteen of our canals, and a pond. He owes £{price} in dues. He stays as our guest until it is paid.\"",
    "\"The Houses never hold anybody,\" says the Collector. \"We offer hospitality until the bill is paid. He owes £{price}. His books stay here until then.\"",
  ],
  round2: [
    "\"Between ourselves,\" says the Collector, \"we would rather have the chart than £{price}. Give it up, and he goes home. Or sell it to us, and we keep him too.\"",
    "\"Three choices,\" says the Collector. \"Pay £{price} in dues. Give us the chart, free, and keep your man. Or sell us the survey, and we keep him as a pilot.\"",
  ],
  walk: "You step back. The Collector writes your chat in the ledger, under 'consultations', and bills for it.",
  hostile: "The Collector slams his ledger shut: the wardens' signal. \"Gentlemen,\" he says, hiding behind it, \"this account is in dispute.\"",
  flatter: {
    ok: [
      "\"Nobody admires the ledger,\" says the Collector, softening. \"£{price}, then, and I shall not charge for the biscuits.\"",
      "\"A person who appreciates a well-kept account,\" says the Collector, and rounds down, with visible pain. \"£{price}.\"",
    ],
    fail: [
      "\"Compliments are a service,\" says the Collector, \"and services are dues. £{price}.\"",
      "\"I was complimented by a House-Head once,\" says the Collector. \"He billed me for it. £{price}.\"",
    ],
  },
  deal: {
    paid: "The dues are paid. The Collector hands over the field books, a receipt, and a receipt for the receipt.",
    survey: "\"The chart is ours,\" says the Collector, stamping it twice. \"The books stay here. The gentleman may go, and complain about it. Complaining is free.\"",
    tip: "\"Sold,\" says the Collector, before you can change your mind. \"The Houses buy the survey and the books. We keep the gentleman too. He will be happy here, eventually.\"",
  },
  short: "\"You are short,\" says the Collector. \"The Houses give hospitality, not credit. The tea, however, continues.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "pay", label: `Pay the harbour dues (£${p})`, hint: "The surveyor gets his books back and follows you to the quay.", cost: p },
          { key: "propose", label: "Cede the chart: give it to the Houses", hint: "Free. The Houses keep the books. The surveyor comes home without them.", cost: 0 },
          { key: "tip", label: "Sell the Houses the survey outright", hint: "The Houses pay you and keep the books and the surveyor. The job ends here.", cost: 0 },
          { key: "ask", label: "Ask what the Houses really want", hint: "He might tell you. He will certainly bill you for it.", cost: 0 },
          { key: "flatter", label: "Admire the ledger", hint: "Flattery might lower the dues. It might raise them.", cost: 0 },
          { key: "threaten", label: "Point out that you are armed and he is not", hint: "His wardens are armed too. This starts a fight.", cost: 0 },
          walk,
        ]
      : [
          { key: "pay", label: `Pay the harbour dues (£${p})`, hint: "The surveyor gets his books back.", cost: p },
          { key: "propose", label: "Cede the chart: give it to the Houses", hint: "Free. The books stay. The surveyor goes home.", cost: 0 },
          { key: "tip", label: "Sell the Houses the survey outright", hint: "They pay you; they keep him.", cost: 0 },
          walk,
        ];
  },
};

const LOST_SURVEYOR: ParleyScript = {
  speaker: "Mr. Augustus Pellow-Brane, Surveyor to the Society",
  frame: { heading: HOUSE, asked: "Round {round} · The surveyor seems {mood}, and indignant." },
  open: [
    "\"At last,\" says Mr. Pellow-Brane, putting down his teacup. \"I have been the Houses' guest for a week. I will not leave without my field books. That man has them.\"",
    "Mr. Pellow-Brane stands up, tall and cross. \"The Society sent me to measure the delta. I did. The delta sent me the bill. I go home with my books, or not at all.\"",
  ],
  round2: [
    "\"The Collector wants my chart more than money,\" says Mr. Pellow-Brane. \"Give it up and I go free. Or he buys it, and keeps me as a pilot. I am flattered, and furious.\"",
    "\"The Houses want dues if you have money,\" says the surveyor. \"The chart if you have none. And me, if they can get me. They offered me a job. I said no. Mostly.\"",
  ],
  walk: "You step back. Mr. Pellow-Brane goes back to his tea. He will be writing a complaint about this.",
  hostile: "Mr. Pellow-Brane looks at your weapon, then at you. \"I am the person you came to rescue,\" he says. \"I believe that is in my letter of appointment.\"",
  deal: {
    survey: "Mr. Pellow-Brane agrees, unhappily, that the Society can measure the delta again. He leaves his books on the Collector's table, with a long, sad look.",
  },
  short: "\"I do not want your money,\" says Mr. Pellow-Brane. \"I want my books.\"",
  options(round): readonly Opt[] {
    return round === 1
      ? [
          { key: "ask", label: "Ask what the Houses want", hint: "He has had a week to find out.", cost: 0 },
          { key: "propose", label: "Persuade him to leave without his books", hint: "Free. The Houses keep the chart. He comes home with you.", cost: 0 },
          walk,
        ]
      : [
          { key: "propose", label: "Persuade him to leave without his books", hint: "Free. The Houses keep the chart.", cost: 0 },
          walk,
        ];
  },
};

export const SALTMARKET_PARLEYS = {
  tide_reeve: TIDE_REEVE,
  auctioneer: AUCTIONEER,
  house_head: HOUSE_HEAD,
  dues_collector: DUES_COLLECTOR,   // D-093
  lost_surveyor: LOST_SURVEYOR,
} as const satisfies Partial<Record<"tide_reeve" | "auctioneer" | "house_head" | "dues_collector" | "lost_surveyor", ParleyScript>>;
