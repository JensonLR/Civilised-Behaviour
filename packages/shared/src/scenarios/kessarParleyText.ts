import type { Opt, ParleyScript } from "./parleys.ts";

/**
 * D-045, the Raid on the Post: the Syndicate's raiding captain, halted at the edge of the Society's outpost with torches and a price. A script, not code (the engine in parleys.ts keeps the
 * rules; the template reads what each result MEANS). Authored copy (scanned by noRealWorld.test.ts), pending developer review: satire aimed at a company that raids by invoice.
 */

const walk: Opt = { key: "walk", label: "Walk away", hint: "He will wait out his demand, then come in with the torches.", cost: 0 };

const raid_captain: ParleyScript = {
  speaker: "Captain Ignatius Pell-Dunmarrow, Security Consultant to the Syndicate",
  open: [
    "\"Good afternoon,\" says the captain, touching his hat with a lit torch. \"The Dunmarrow-Vesk Syndicate is conducting a security consultation of your post. Our finding is that it is very flammable. For £{price} we can arrange for it to remain unburnt for a season. The alternative is our recommendation.\"",
    "The captain unrolls a list. \"Stores, yard, one flagpole,\" he reads. \"We are instructed to remove all three, or to accept a retainer of £{price} in lieu. I am a reasonable man. My men are a reasonable number of men. They have torches.\"",
  ],
  round2: [
    "\"The arrangement,\" says the captain, lowering his voice, \"is that we stand here until my watch says otherwise, and then we go into your yard, and then the yard is warm. Two of my lads in the yard for a quarter of a minute is all it takes. I mention this purely in the spirit of consultation.\"",
    "\"Between us,\" says the captain, \"the Syndicate does not want your post. It wants your post not to be there. Those are different things, and the second one is cheaper for everybody, except you. Two men in the yard, fifteen seconds, whoosh. I would pay.\"",
  ],
  walk: "You step back. The captain checks his watch, which he holds up so you can see it too.",
  hostile: "The captain sighs, as a man sighs whose consultation has been rejected, and drops his torch into the grass. \"Gentlemen,\" he says, \"the yard.\"",
  deal: {
    paid: "The captain counts it, writes a receipt with the renewal date already filled in, and blows out his torch. \"A pleasure,\" he says, \"and a precedent.\" His men file back down the bank, disappointed and unlit.",
  },
  short: "\"You are short,\" says the captain. \"Security is not a charity. It is barely a business.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Pay for a season's protection (£${p})`, hint: "They leave. The post stands. The Syndicate has a client, and the Ward will hear what you paid for.", cost: p };
    return round === 1
      ? [pay, { key: "ask", label: "Ask what happens if you say no", hint: "He will tell you. He enjoys this part.", cost: 0 },
        { key: "threaten", label: "Tell him to come and try", hint: "They come in at once, torches first.", cost: 0 }, walk]
      : [pay, { key: "threaten", label: "Tell him to come and try", hint: "They come in at once.", cost: 0 }, walk];
  },
};

/**
 * D-095, the Siege of the Counting-House: the Syndicate's factor, behind the counter of the post the Society is besieging. He regards the siege as a dispute about rent and the Articles
 * as a document he has read more carefully than the Society has. "Propose" reads him the summons; whether he accepts the honours of war is the template's (the post must be invested
 * and his case hopeless), so the deal line is the reading, not his answer. Satire aimed at a War Committee that besieges a tent by the book, and a company that sells anything, a siege included.
 */
const siege_factor: ParleyScript = {
  speaker: "Mr. Aurelian Coot-Vesk, Factor to the Syndicate",
  frame: { heading: "A word at the Counting-House counter", asked: "His price for the post: £{price} · Round {round} · The factor seems {mood}." },
  open: [
    "The factor does not get up. \"You are the besiegers,\" he says, licking a pencil. \"I have been besieged before, by creditors, who were better at it. If you mean to summon me, summon me. If you mean to buy the post, it is £{price} as a going concern, goodwill included. If you mean to shoot, kindly not at the ledger.\"",
    "\"Good afternoon,\" says the factor, over the counter. \"The Dunmarrow-Vesk Syndicate does not recognise the siege, but it does recognise an offer. The post is £{price}, stock and flagpole. Otherwise I have stores, a relief on the river, and four men who are paid by the week whether you shoot them or not.\"",
  ],
  round2: [
    "\"What would it take?\" The factor considers. \"Hunger, mostly. Invest the place on all three sides and my stores will run down, slowly; I have a good deal of biscuit. Beat my relief, or put half my men on the ground, and I become a reasonable man very suddenly. Until then the post is £{price}.\"",
    "\"Between ourselves,\" says the factor, \"I would surrender this tent to anybody who made it unprofitable. You have not. A picket on each side, my stores out, my relief sent home or my guns halved, and you may have the honours of war and the receipt. Or £{price}, now, and nobody gets muddy.\"",
  ],
  walk: "You step back. The factor goes back to his ledger and enters the siege under SUNDRIES.",
  hostile: "\"Then come and get it,\" says the factor, and gets under his counter with remarkable speed for a man of his figure.",
  deal: {
    paid: "The factor counts it twice, writes a receipt for \"one (1) trading post, as a going concern, goodwill included\", and reaches for the flag halyard himself.",
    survey: "You read him the summons from the Articles (revised), all four pages, including the clause about drums. The factor listens with his hands folded on the counter, and then answers.",
  },
  short: "\"You are short,\" says the factor. \"Sieges are expensive. I had assumed you knew.\"",
  options: (round, p): readonly Opt[] => {
    const summon: Opt = { key: "propose", label: "Summon him: offer the honours of war", hint: "He accepts only if the post is invested and his case is hopeless: stores out, relief beaten or half his guns down.", cost: 0 };
    const buy: Opt = { key: "pay", label: `Buy the post as a going concern (£${p})`, hint: "He strikes his flag and marches out with a receipt. The Committee will have bought its siege.", cost: p };
    const dare: Opt = { key: "threaten", label: "Tell him to come and get it", hint: "The garrison stands to: the storm begins.", cost: 0 };
    const leave: Opt = { key: "walk", label: "Walk away", hint: "The siege goes on.", cost: 0 };
    return round === 1
      ? [summon, buy, { key: "ask", label: "Ask what it would take", hint: "He will tell you; he is a factor.", cost: 0 }, dare, leave]
      : [summon, buy, dare, leave];
  },
};

export const KESSAR_PARLEYS = { raid_captain, siege_factor } as const satisfies Partial<Record<"raid_captain" | "siege_factor", ParleyScript>>;
