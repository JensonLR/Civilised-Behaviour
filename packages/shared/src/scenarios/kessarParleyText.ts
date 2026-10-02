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

export const KESSAR_PARLEYS = { raid_captain } as const satisfies Partial<Record<"raid_captain", ParleyScript>>;
