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
    "\"The Compact is out,\" says the Foreperson. \"The Crown pays us by one bushel and sells by a smaller one. Pay a £{price} bonus and we cut today. It fixes nothing.\"",
    "The Foreperson looks at you the way a farmer looks at the sky. \"You have a purse. Pay £{price} as a harvest bonus and we cut today. Or ask why we stopped. Cheaper, but slower.\"",
  ],
  round2: [
    "\"The royal bushel sits on a scale up the hill, on the granary terrace,\" says the Foreperson. \"It is a third too big. Carry it to the Steward and weigh it. That is proof.\"",
    "\"We want fair pay, not a bonus,\" says the Foreperson. \"The royal bushel is on the granary scale, up the hill. Set it beside the Steward's own bushel. Then we can talk.\"",
  ],
  walk: "You step back from the picket line. The Foreperson goes back to watching the sky for rain.",
  hostile: "The Foreperson turns her back on you, and so does the whole line. \"We do not deal with people who threaten us,\" she says. \"The Crown can cut its own barley.\"",
  deal: {
    paid: "The Foreperson counts it twice. \"Back to the field!\" she calls. Then, to you: \"This is a bonus, not a fix. We strike again next harvest. Bring your purse.\"",
    survey: "\"An honest measure,\" the Foreperson repeats slowly, like a word from a language she once spoke.",
  },
  short: "\"You are short,\" says the Foreperson, who has been short every harvest for forty years. \"The bonus stands.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Pay the harvest bonus (£${p})`, hint: "They cut today. The bushel stays too big.", cost: p };
    const propose: Opt = { key: "propose", label: "Propose an honest measure", hint: "Prove the fraud to the Steward first. It needs his signature and hers.", cost: 0 };
    return round === 1
      ? [pay, propose, { key: "ask", label: "Ask why the Compact stopped", hint: "She tells you why, and where the proof is.", cost: 0 },
        { key: "threaten", label: "Threaten the Compact", hint: "They will not deal with you again today.", cost: 0 }, walk]
      : [pay, propose, walk];
  },
};

const steward: ParleyScript = {
  speaker: "Steward Ambrose Tithe-Wexley, of the Granary",
  open: [
    "\"The Crown pays by the royal bushel,\" says the Steward, dabbing at his ledger. \"Get the Compact back to work before the rain and I pay you £{price}. On results. No reforms.\"",
    "The Steward does not look up from his figures. \"A strike is bad arithmetic. The Syndicate has a barge of bonded men who never strike. Get the Compact back today and £{price} is yours.\"",
  ],
  round2: [
    "\"The royal bushel is sealed on the granary scale, up the hill,\" says the Steward, a little too quickly. \"I have never measured it. One does not measure a measure.\"",
    "\"There is no fraud,\" says the Steward. \"We buy by one bushel and sell by another. That is called administration. If someone brought the royal bushel here, I would have to look.\"",
  ],
  walk: "You step back. The Steward writes your name under a heading you cannot read upside down.",
  hostile: "The Steward goes white, then red, then runs up the hill. \"The Crown will hear of this!\" The Crown has no King just now, so it will not.",
  deal: {
    survey: "\"An honest measure,\" the Steward repeats, as if the words might be forged.",
    tip: "\"Splendid,\" says the Steward, and writes your name under the Syndicate's. \"You are paid when they are back at work, bushel untouched. I shall tell the barge to hurry.\"",
  },
  short: "\"The Granary does not take money,\" says the Steward. \"It takes grain. By the royal bushel.\"",
  options: (round, p): readonly Opt[] => {
    const propose: Opt = { key: "propose", label: "Demand an honest measure", hint: "He signs only after the royal bushel is weighed in front of him.", cost: 0 };
    const tip: Opt = { key: "tip", label: `Take his fee to talk them back (£${p} on results)`, hint: "Paid only if they go back with nothing fixed. He tells the barge to hurry.", cost: 0 };
    return round === 1
      ? [propose, { key: "ask", label: "Ask about the royal bushel", hint: "He would rather you did not.", cost: 0 }, tip,
        { key: "threaten", label: "Threaten to take the granary apart", hint: "He runs up the hill and will sign nothing after that.", cost: 0 }, walk]
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
    "\"Every beast here is the Crown's,\" says the Master of the Royal Hunt, \"even that one, though he does not know it. A licence to shoot him is £{price}. Without one, it is poaching.\"",
    "\"You are the Society,\" says the Master, as if naming a weed. \"You will want to shoot him. The licence is £{price}. And do remember that he charges.\"",
  ],
  round2: [
    "\"The drovers call him the luck of the herds,\" says the Master. \"Walk at him from the far side and he walks home to their camp. To shoot him, the fee is £{price}.\"",
    "\"Between ourselves,\" says the Master, \"the Crown likes him walked home as much as shot. It likes a Syndicate cage least. To shoot, it is £{price}. Aim for the head.\"",
  ],
  walk: "You step back. The Master returns to her game book and writes something short.",
  hostile: "The Master snaps her game book shut. \"I have written that down,\" she says. \"In red.\"",
  flatter: {
    ok: [
      "\"The Society has manners now?\" says the Master. \"Then £{price}. And some free advice: do not stand in front of him.\"",
      "\"Yes, the Crown's grass is beautiful,\" says the Master. \"You are about to shoot on it. £{price}.\"",
    ],
    fail: [
      "\"Flattery is not money,\" says the Master. \"Not on the Crown's grass. £{price}.\"",
      "\"I have been flattered by better shots than you,\" says the Master. \"Most of them are buried in the barley. £{price}.\"",
    ],
  },
  deal: { paid: "The Master writes out the licence. \"One grey beast, for the Society. He charges. That is twice I have told you. There may not be a third time.\"" },
  short: "\"The Crown does not give credit to guests,\" says the Master. \"Least of all guests with rifles.\"",
  options(round, p): readonly Opt[] {
    return round === 1
      ? [
          { key: "pay", label: `Buy a licence to shoot him (£${p})`, hint: "Shooting him without one is poaching.", cost: p },
          { key: "ask", label: "Ask what the Crown wants done", hint: "She has views on the Society, and on the bull.", cost: 0 },
          { key: "flatter", label: "Admire the Crown's grassland", hint: "The price may drop. Or rise.", cost: 0 },
          walk,
        ]
      : [{ key: "pay", label: `Buy a licence to shoot him (£${p})`, hint: "The licence makes the shot the Crown's business, not a crime.", cost: p }, walk];
  },
};
const menagerie_agent: ParleyScript = {
  speaker: "Mr. Barnabas Quill-Ferris, Menagerie Agent to the Syndicate",
  frame: { heading: "A word at the menagerie pen", asked: "Offered: £{price} · Round {round} · The agent seems {mood}." },
  open: [
    "The agent waves a handbill: THE BEAST OF THE HIGH PASTURE. \"Alive in my pen, he is worth £{price},\" he says. \"Dead, he is only worth a wall in Pall Mall.\"",
    "\"A bull like that tours the river towns for years, at twopence a look,\" says the agent. \"£{price} for him alive, in my pen. The drovers will not like it. They do not buy tickets.\"",
  ],
  round2: [
    "\"Walk at him from the far side; he walks away from people,\" says the agent. \"Walk him into my pen and I pay £{price}. Shoot him and I pay nothing. Nor will your Committee.\"",
    "\"The Master says he is the Crown's,\" says the agent. \"The Crown has sold me three beasts this year. For this one, £{price}, alive, in the pen.\"",
  ],
  walk: "You step back. The agent goes back to his handbill and adds an exclamation mark.",
  hostile: "The agent ducks behind his pen, which is built for a bull and very solid. \"My employers will hear of this,\" he says.",
  deal: { survey: "\"Done,\" says the agent, and goes to open his pen. \"£{price} for the bull, alive, in the pen. Alive is the important word. Write it on your hand.\"" },
  short: "\"I am buying,\" says the agent, \"not selling.\"",
  options(round): readonly Opt[] {
    return round === 1
      ? [
          { key: "propose", label: "Agree to sell him the bull, alive", hint: "He opens his pen by the river. Drive the bull into it and he pays.", cost: 0 },
          { key: "ask", label: "Ask how to sell a bull", hint: "Slowly, and from behind.", cost: 0 },
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
