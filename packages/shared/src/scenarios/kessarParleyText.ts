import type { Opt, ParleyScript } from "./parleys.ts";

/**
 * D-045, the Raid on the Post: the Syndicate's raiding captain, halted at the edge of the Society's outpost with torches and a price. A script, not code (the engine in parleys.ts keeps the
 * rules; the template reads what each result MEANS). Authored copy (scanned by noRealWorld.test.ts), pending developer review: satire aimed at a company that raids by invoice.
 */

const walk: Opt = { key: "walk", label: "Walk away", hint: "He waits until his watch runs out, then his men come in with torches.", cost: 0 };

const raid_captain: ParleyScript = {
  speaker: "Captain Ignatius Pell-Dunmarrow, Security Consultant to the Syndicate",
  open: [
    "\"Good afternoon,\" says the captain, tipping his hat with a lit torch. \"The Syndicate has inspected your post. It is very flammable. Pay £{price}, and it stays unburnt for a season.\"",
    "The captain reads from a list. \"Stores, yard, one flagpole. We are told to burn all three, or take £{price} instead. I am a reasonable man. My men have torches.\"",
  ],
  round2: [
    "\"Here is how it works,\" says the captain quietly. \"When my watch runs out, my men go into your yard. Two of them in there for fifteen seconds, and your stores burn.\"",
    "\"Between us,\" says the captain, \"the Syndicate does not want your post. It just wants it gone. Two men in the yard, fifteen seconds, whoosh. I would pay, if I were you.\"",
  ],
  walk: "You step back. The captain checks his watch, which he holds up so you can see it too.",
  hostile: "The captain sighs and drops his torch into the grass. \"Gentlemen,\" he says, \"the yard.\"",
  deal: {
    paid: "The captain counts the money, writes a receipt and blows out his torch. \"A pleasure,\" he says. \"See you next season.\" His men walk back to their boat, disappointed.",
  },
  short: "\"You do not have enough,\" says the captain. \"Security is not a charity.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Pay for a season's protection (£${p})`, hint: "They leave, and the post is safe. The Ward will hear that you paid.", cost: p };
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
    "The factor stays seated. \"So you are the besiegers? My creditors did it better. Summon me if you like, or buy the post for £{price}. Just do not shoot the ledger.\"",
    "\"Good afternoon,\" says the factor. \"We do not recognise your siege, but we do recognise money. The post is yours for £{price}. If not, I have stores, and help coming.\"",
  ],
  round2: [
    "\"What would it take?\" The factor thinks. \"Surround all three sides. Then starve me out, beat my relief or drop half my guards. Until then, the post is £{price}.\"",
    "\"Between us,\" says the factor, \"I give up when this post stops paying. Picket every side, then empty my stores, beat my relief or drop half my guards. Or just pay £{price} now.\"",
  ],
  walk: "You step back. The factor goes back to his ledger and writes the siege down under 'Minor Nuisances'.",
  hostile: "\"Then come and get it,\" says the factor, and dives under his counter, surprisingly fast.",
  deal: {
    paid: "The factor counts the money twice and writes a receipt for \"one (1) trading post\". Then he lowers his own flag.",
    survey: "You read him the summons from the rules, all four pages, drums included. The factor listens with folded hands, then answers.",
  },
  short: "\"You do not have enough,\" says the factor. \"Sieges are expensive. I thought you knew.\"",
  options: (round, p): readonly Opt[] => {
    const summon: Opt = { key: "propose", label: "Summon him to surrender", hint: "Works only when the post is surrounded and his stores, his relief or half his guards are gone.", cost: 0 };
    const buy: Opt = { key: "pay", label: `Buy the post outright (£${p})`, hint: "He lowers his flag and leaves with a receipt. The Committee has bought its siege.", cost: p };
    const dare: Opt = { key: "threaten", label: "Tell him to come and get it", hint: "The talking ends, and the attack on the post begins.", cost: 0 };
    const leave: Opt = { key: "walk", label: "Walk away", hint: "The siege goes on.", cost: 0 };
    return round === 1
      ? [summon, buy, { key: "ask", label: "Ask what it would take", hint: "He will tell you. He likes talking business.", cost: 0 }, dare, leave]
      : [summon, buy, dare, leave];
  },
};

export const KESSAR_PARLEYS = { raid_captain, siege_factor } as const satisfies Partial<Record<"raid_captain" | "siege_factor", ParleyScript>>;
