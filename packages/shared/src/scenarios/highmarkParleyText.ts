import type { Opt, ParleyScript } from "./parleys.ts";

/**
 * The Reapers' Strike's two parleys (D-042, Highmark): the Compact's Foreperson at the picket line and the Crown's Steward of the Granary, come down to shout at it. Scripts, not code (the engine in
 * parleys.ts keeps the rules: the key picked decides the result, the price gate; the template reads what each result MEANS). The Foreperson's price is the harvest bonus the party may pay; the
 * Steward's is the fee he offers the party to talk the Compact back (a `tip`: paid only if they go back without a reform). Authored copy (scanned by noRealWorld.test.ts), pending developer review:
 * satire aimed at a Crown granary that pays by one bushel and sells by another, not at the people who cut the barley.
 */

const walk: Opt = { key: "walk", label: "Walk away", hint: "Nothing lost, nothing gained.", cost: 0 };

const reaper: ParleyScript = {
  speaker: "Foreperson Agnes Stook, of the Reapers' Compact",
  open: [
    "\"The Compact is out,\" says the Foreperson, leaning on a scythe she has not put down since dawn, \"and the barley is in the field, and the rain is in the sky, and the Crown is in its granary counting. We are paid by the royal bushel. Ask anybody what a royal bushel holds. Ask the Crown what it sells by. The bonus to bring us back today is £{price}, and it would not fix a thing.\"",
    "The Foreperson looks you up and down, as a farmer looks at weather. \"You are the Society. You want the barley in, like everybody, and you have a purse, unlike everybody. £{price} as a harvest bonus and we cut today. Or you could find out why we stopped. That is cheaper and takes longer.\"",
  ],
  round2: [
    "\"Up the hill,\" says the Foreperson, pointing with the scythe, \"on the granary terrace, by the first granary, there is a scale, and on the scale is the royal bushel: the measure every reaper's day is paid by. It is a third bigger than the bushel the Crown sells by. Everybody knows it. Nobody can prove it. A thing carried down to the Steward and weighed in front of witnesses is proof.\"",
    "\"We do not want money,\" says the Foreperson, \"or rather we do, but we want the right amount of it. The royal bushel sits on the granary scale up the hill. Put it in front of the Steward next to his own selling measure and see if he can still count. Then talk to me about an honest measure.\"",
  ],
  walk: "You step back from the picket line. The Foreperson goes back to watching the sky and the river, in that order.",
  hostile: "The Foreperson hears you out, and then turns her back on you, and so does every reaper on the line. \"The Compact does not deal with people who threaten it,\" she says, to the barley. \"The Crown can have its harvest when it can cut it.\"",
  deal: {
    paid: "The Foreperson counts it twice and pockets it once. \"Back to the field,\" she calls, and the line becomes a line of scythes. \"This is a bonus,\" she says to you, \"not a settlement. We will be out again next harvest, on the same bushel. Do bring your purse.\"",
    survey: "\"An honest measure,\" says the Foreperson, slowly, as if it were a word in a language she used to speak.",
  },
  short: "\"You are short,\" says the Foreperson, who has been short every harvest for forty years. \"The bonus stands.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Pay the harvest bonus (£${p})`, hint: "They go back to work today. Nothing changes; the grievance stands, and so does the bushel.", cost: p };
    const propose: Opt = { key: "propose", label: "Propose an honest measure", hint: "Needs the fraud proven to the Steward first, and the Steward's signature as well as hers.", cost: 0 };
    return round === 1
      ? [pay, propose, { key: "ask", label: "Ask why the Compact stopped", hint: "She will tell you. It may tell you where to look.", cost: 0 },
        { key: "threaten", label: "Tell the Compact to go hang", hint: "They will not deal with the Society again today.", cost: 0 }, walk]
      : [pay, propose, walk];
  },
};

const steward: ParleyScript = {
  speaker: "Steward Ambrose Tithe-Wexley, of the Granary",
  open: [
    "\"The Crown,\" says the Steward of the Granary, dabbing at a ledger with a handkerchief as if it had sneezed on him, \"pays by the royal bushel. Whatever anybody has weighed this afternoon, that is what royal means. If the Society could see its way to persuading the Compact back into the field before the rain, there would be a fee of £{price}. Payable on results. No reforms.\"",
    "The Steward does not look up from his figures. \"A strike,\" he says, \"is a failure of arithmetic on the part of the strikers. The Syndicate has a barge of bonded labour on the river that has never once been out on strike. I would prefer the Compact, by this afternoon, on the measure we have. £{price}, to whoever arranges it.\"",
  ],
  round2: [
    "\"The royal bushel,\" says the Steward, a little too quickly, \"is kept on the granary scale, sealed, by the first granary up the hill, where it is perfectly safe from anybody who might weigh it. It has been the royal bushel since the King was not pending. I have never measured it. One does not measure a measure.\"",
    "\"There is no fraud,\" says the Steward. \"There is a difference between the bushel the Crown buys by and the bushel the Crown sells by, and the difference is called administration. If somebody were to carry the royal bushel down here and set it beside the selling bushel, in front of the Compact, I should of course be obliged to look at it. I would rather not be obliged.\"",
  ],
  walk: "You withdraw. The Steward makes a note of your name under a heading you cannot read upside down.",
  hostile: "The Steward goes white, then red, then up the hill at a pace a man of his figure should not be able to manage. \"The Crown will hear of this!\" he calls back. The Crown, being pending, will not.",
  deal: {
    survey: "\"An honest measure,\" the Steward repeats, turning the words over as if they might be counterfeit.",
    tip: "\"Splendid,\" says the Steward, writing your name in a column that already has the Syndicate's in it. \"The fee is on results: the Compact back at work, the bushel untouched. I shall send word down the river that the barge need not dawdle.\"",
  },
  short: "\"The Granary does not take money,\" says the Steward. \"It takes grain. By the royal bushel.\"",
  options: (round, p): readonly Opt[] => {
    const propose: Opt = { key: "propose", label: "Demand an honest measure", hint: "He signs only once the royal bushel from the granary scale has been weighed in front of him.", cost: 0 };
    const tip: Opt = { key: "tip", label: `Take his fee to talk them back (£${p} on results)`, hint: "Paid if the Compact goes back with nothing reformed. He sends for the Syndicate's barge to hurry it along.", cost: 0 };
    return round === 1
      ? [propose, { key: "ask", label: "Ask about the royal bushel", hint: "He would rather you did not.", cost: 0 }, tip,
        { key: "threaten", label: "Threaten to take the granary apart", hint: "He will run up the hill, and he will not sign anything after that.", cost: 0 }, walk]
      : [propose, tip, walk];
  },
};

/**
 * D-094, the Great Grey: the Crown's Master of the Royal Hunt (who sells the licence to shoot it: `pay`) and the Syndicate's menagerie agent (who will buy it alive: `propose` agrees the
 * price and opens his pen). The template (scenarios/greatGrey.ts) reads what each result MEANS. Satire aimed at the Society's trophy-hunting and the Syndicate's commerce, not at the drovers.
 */
const FIELD = "A word at the barley's edge";
const master_of_hunt: ParleyScript = {
  speaker: "Lady Isolde Thrushcote, Master of the Royal Hunt",
  frame: { heading: FIELD, asked: "Licence: £{price} · Round {round} · The Master seems {mood}." },
  open: [
    "The Master of the Royal Hunt looks up from her game book. \"Every beast on the grassland is the Crown's,\" she says, \"including that one, who does not know it. A licence to take him is £{price}. Without one, it is poaching, and I write poaching in red.\"",
    "\"You are the Society,\" says the Master, in the tone of one identifying a weed. \"You will want to shoot him. Everybody from the Society wants to shoot something. The licence is £{price}, and I would remind you that he charges.\"",
  ],
  round2: [
    "\"The drovers will tell you he is the luck of the herds,\" says the Master, \"and they are right, and the barley is still being eaten. Walk at him from the far side and he will walk away from you, home to their camp. Shoot him and I want the licence fee first. The fee is £{price}.\"",
    "\"Between ourselves,\" says the Master, \"the Crown would be as happy to see him walked home as shot, and happier than to see him in a Syndicate cage. But if you mean to shoot, it is £{price}, and you will aim for the head, which is where he keeps his opinions.\"",
  ],
  walk: "You step back. The Master returns to her game book and writes something short.",
  hostile: "The Master closes her game book on its pencil. \"I have written that down,\" she says, \"and I have written it down in red.\"",
  flatter: {
    ok: [
      "\"The Society has manners, now?\" says the Master. \"Unexpected. £{price}, then, and I will lend you the Crown's best loader's advice: do not stand in front of him.\"",
      "\"You flatter the Crown's grassland,\" says the Master, \"which is beautiful, and which you are about to shoot on. £{price}.\"",
    ],
    fail: [
      "\"Flattery is not legal tender on the Crown's grass,\" says the Master. \"£{price}.\"",
      "\"I have been flattered by better shots than you,\" says the Master. \"Most of them are buried in the barley. £{price}.\"",
    ],
  },
  deal: { paid: "The Master writes out the licence and blots it. \"One beast, grey, by the Society's hand. He charges. I have said that twice now. I will not say it at the inquest.\"" },
  short: "\"The Crown does not give credit to guests,\" says the Master. \"Least of all guests with rifles.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "pay", label: `Buy a licence to shoot him (£${p})`, hint: "A shot without one is poaching on the Crown's grass.", cost: p },
          { key: "ask", label: "Ask what the Crown would rather", hint: "She has opinions about the Society, and about the bull.", cost: 0 },
          { key: "flatter", label: "Admire the Crown's grassland", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
          walk,
        ]
      : [{ key: "pay", label: `Buy a licence to shoot him (£${p})`, hint: "The licence makes the shot the Crown's business, not a crime.", cost: p }, walk];
  },
};
const menagerie_agent: ParleyScript = {
  speaker: "Mr. Barnabas Quill-Ferris, Menagerie Agent to the Syndicate",
  frame: { heading: "A word at the menagerie pen", asked: "Offered: £{price} · Round {round} · The agent seems {mood}." },
  open: [
    "The agent leans on his pen by the river with a handbill already printed: THE BEAST OF THE HIGH PASTURE. \"Alive,\" he says, \"he is worth £{price} to my principals, delivered into this pen. Dead, he is worth a wall in Pall Mall, which my principals do not have.\"",
    "\"A bull like that,\" says the agent, \"tours the river towns for three seasons at twopence a look. I can offer £{price} for him alive, in my pen. The drovers will not like it. The drovers do not buy tickets.\"",
  ],
  round2: [
    "\"Drive him?\" says the agent. \"Walk at him from the far side; he walks away from people. Walk him here, and I drop the bar and count out £{price}. Shoot him and I count out nothing, and so, I suspect, does your Committee.\"",
    "\"The Master will tell you he is the Crown's,\" says the agent. \"The Crown has sold me three beasts this year already. The price for this one is £{price}, alive, in the pen.\"",
  ],
  walk: "You step back. The agent goes back to his handbill and adds an exclamation mark.",
  hostile: "The agent gets behind his pen, which is a pen for a bull and very solid. \"My principals,\" he says, \"will hear of this.\"",
  deal: { survey: "\"Done,\" says the agent, and goes to open his pen. \"£{price} for the bull, alive, in the pen. Alive is the important word. Write it on your hand.\"" },
  short: "\"I am buying,\" says the agent, \"not selling.\"",
  options(round): readonly Opt[] {
    return round === 1
      ? [
          { key: "propose", label: "Agree to sell him the bull, alive", hint: "He opens his pen by the river. Drive the bull into it and he pays.", cost: 0 },
          { key: "ask", label: "Ask how one sells a bull", hint: "Slowly, and from behind.", cost: 0 },
          walk,
        ]
      : [{ key: "propose", label: "Agree to sell him the bull, alive", hint: "Drive it into his pen and he pays.", cost: 0 }, walk];
  },
};

export const REAPERS_PARLEYS = {
  reaper,
  steward,
  master_of_hunt,   // D-094
  menagerie_agent,
} as const satisfies Partial<Record<"reaper" | "steward" | "master_of_hunt" | "menagerie_agent", ParleyScript>>;
