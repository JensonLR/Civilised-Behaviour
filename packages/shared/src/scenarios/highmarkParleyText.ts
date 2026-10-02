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

export const REAPERS_PARLEYS = {
  reaper,
  steward,
} as const satisfies Partial<Record<"reaper" | "steward", ParleyScript>>;
