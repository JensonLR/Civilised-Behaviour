import type { Opt, ParleyScript } from "./parleys.ts";

/**
 * Vesper Gorge's three parleys (D-037, package C3): the mine's foreman, the Guild's Dirge-Master, the Assay House's clerk. Scripts, not code (the engine in parleys.ts keeps the rules: the key picked
 * decides the result, the price gate, the flatter roll; the templates read what each result MEANS). Authored copy (scanned by noRealWorld.test.ts), pending developer review: satire aimed at an
 * institution that bills per outcome (the Guild), a company that counts a collapse as a schedule variance (the Company), and an office that registers whoever arrives first with the right form (the Assay House).
 */

const walk: Opt = { key: "walk", label: "Walk away", hint: "Nothing lost, nothing gained.", cost: 0 };

const foreman: ParleyScript = {
  speaker: "Foreman Jedediah Slack-Moreland",
  open: [
    "\"Eleven men trapped, and the gallery behind schedule,\" says the foreman, from a safe distance. \"The Company will seal it, unless you pay the handling charge: £{price}.\"",
    "The foreman looks up from his ledger. \"Nobody touches the fall without a Variance Form,\" he says. \"Fast costs £{price}. Free is also available. Free is very slow.\"",
  ],
  round2: [
    "\"The Company seals the gallery at the hour it has set,\" says the foreman. \"The hour is on a board in my office. My office is locked, for your safety. £{price}.\"",
    "\"A sealed gallery is never behind schedule,\" says the foreman. \"It is simply finished. To revise the schedule: £{price}. It is not a bribe. It has a receipt.\"",
  ],
  walk: "You step back. The foreman writes down the time and your face, in a column headed ATTENDANCE.",
  hostile: "The foreman backs away from his desk. \"Whistle!\" he cries, to nobody. \"Somebody blow the whistle!\"",
  flatter: {
    ok: [
      "\"A clean record!\" says the foreman, softening. \"I did not do it on purpose, but I am proud of it. £{price}, for a friend of the schedule.\"",
      "\"You read the Company's report!\" says the foreman. \"Nobody reads it. It has no pages. £{price}, and I will tell the board you were pleasant.\"",
    ],
    fail: [
      "\"Flattery is not a form,\" says the foreman. \"But it is billable. £{price}, to cover the speech.\"",
      "\"I have been flattered by a better class of company,\" says the foreman. \"£{price}.\"",
    ],
  },
  deal: {
    paid: "The foreman files the money under HANDLING. \"The gallery will not be sealed today,\" he says. \"Not because of the money. Well. Because of the money.\"",
    survey: "\"A Variance Form, in triplicate,\" sighs the foreman. \"It will be stamped in forty-five seconds. The seal will not wait for the stamp, but it will be sorry.\"",
  },
  short: "\"You are short,\" says the foreman, counting it twice to be sure. \"The charge stands.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Pay the handling charge (£${p})`, hint: "The seal is delayed for a long time. Not a bribe: it has a receipt.", cost: p };
    const form: Opt = { key: "propose", label: "File a Variance Form (free, stamped in 45 seconds)", hint: "Once stamped, the seal is delayed a little. Useless if the seal comes first.", cost: 0 };
    return round === 1
      ? [pay, form, { key: "ask", label: "Ask when the gallery will be sealed", hint: "He may tell you. He will not enjoy it.", cost: 0 }, { key: "flatter", label: "Praise the Company's record", hint: "The price may drop. Or rise, if he sees through you.", cost: 0 },
        { key: "threaten", label: "Tell him what you will do to his schedule", hint: "He blows his whistle and the yard turns on you. This will be remembered.", cost: 0 }, walk]
      : [pay, form, walk];
  },
};

const dirge_master: ParleyScript = {
  speaker: "Dirge-Master Osric Veil-Mourne",
  open: [
    "\"We are so sorry for your loss,\" says the Dirge-Master. \"We are sorry in advance, as it is cheaper. The Guild's bill for the Lower Gallery is £{price}.\"",
    "The Dirge-Master takes your hand in two cold ones. \"We have mourned these men already,\" he says. \"Nobody has told them yet. £{price}.\"",
  ],
  round2: [
    "\"The air behind the fall lasts until our choir arrives,\" says the Dirge-Master. \"We are never early, and never wrong. £{price}.\"",
    "\"Sealing a gallery with customers inside?\" says the Dirge-Master. \"The Guild would object, if someone told it. In verse. £{price} for the verse.\"",
  ],
  walk: "You step back. The Dirge-Master bows, and seems to make a note of the angle.",
  hostile: "The Dirge-Master takes your meaning, and so does the choir. The bell is put down with great care. Then everybody is somewhere else.",
  flatter: {
    ok: [
      "\"You have a feeling for the work,\" says the Dirge-Master, thawing a little. \"£{price}. The choir will learn your name, for your funeral.\"",
      "\"We are rarely praised before the funeral,\" says the Dirge-Master. \"£{price}, for a friend of the nearly dead.\"",
    ],
    fail: [
      "\"Kind,\" says the Dirge-Master, \"and billable. £{price}.\"",
      "\"We have been flattered by every family in the lowlands,\" says the Dirge-Master. \"£{price}.\"",
    ],
  },
  deal: {
    paid: "Two people count the money into a black velvet bag. \"The Guild takes the gallery,\" says the Dirge-Master. \"We shall bring the lamps.\"",
    survey: "\"A vigil,\" says the Dirge-Master. \"We sing at the fall, very slowly, and the men inside breathe in time. We rarely do this for the living.\"",
    tell: "\"Sealed, with customers inside?\" The Dirge-Master goes white, then red. \"The Guild objects, in verse, at length. The seal must wait.\"",
  },
  short: "\"You are short,\" says the Dirge-Master, gently, as if noting a death. \"The bill stands.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Settle the Guild's bill (£${p})`, hint: "The Guild takes the gallery and holds the funeral. The men are still alive.", cost: p };
    const vigil: Opt = { key: "propose", label: "Propose a vigil: the choir sings at the fall", hint: "The men breathe slower, so the air lasts longer. The families get the bill.", cost: 0 };
    return round === 1
      ? [pay, vigil, { key: "ask", label: "Ask what the Guild knows about the air", hint: "He may tell you. Then you can ask the Guild to object to the seal.", cost: 0 }, { key: "flatter", label: "Admire the Guild's punctuality", hint: "The price may drop. Or rise, if he sees through you.", cost: 0 },
        { key: "threaten", label: "Tell him to take his choir elsewhere", hint: "The whole choir takes offence at once. This will be remembered.", cost: 0 }, walk]
      : [pay, { key: "tell", label: "Tell him the Company will seal the gallery with men inside", hint: "The Guild objects, in verse. The seal is delayed a while.", cost: 0 }, vigil, walk];
  },
};

const assayer: ParleyScript = {
  speaker: "Clerk Lemuel Tarn-Ledger (Assay House)",
  open: [
    "\"Claims go to whoever arrives first with the right form,\" says the clerk, not looking up. \"The fee is £{price}. I never go out to look at pegs.\"",
    "The clerk stamps something that was already stamped. \"We weigh, we measure, we register,\" he says. \"We do not judge. Registration is £{price}.\"",
  ],
  round2: [
    "\"The Syndicate measured the bench with a shortened chain,\" whispers the clerk. \"If someone reported that, I would have to act. £{price} to file your own.\"",
    "\"A very fine binder,\" says the clerk. \"But their chain was a foot short. Say so at this counter, and I must stamp their survey PROVISIONAL. £{price}.\"",
  ],
  walk: "You step back. The clerk writes down that you stepped back, and the hour.",
  hostile: "The surveyors run and the guards come. \"This counter is not part of the dispute,\" says the clerk, and goes on stamping.",
  flatter: {
    ok: [
      "\"A person who admires procedure!\" says the clerk, lowering his stamp a little. \"£{price}, and I shall use the good blotter.\"",
      "\"I am seldom noticed,\" says the clerk. \"£{price}, and I shall not tell the Syndicate you were civil.\"",
    ],
    fail: [
      "\"Procedure thanks you,\" says the clerk. \"£{price}.\"",
      "\"I have been admired by better,\" says the clerk. \"£{price}.\"",
    ],
  },
  deal: {
    paid: "The clerk reads the form twice and sadly finds nothing wrong. The stamp comes down. \"Registered to the Society,\" he says. \"The Syndicate may complain, in a queue.\"",
    survey: "\"A joint claim,\" says the clerk, pulling out a form made for exactly this. \"Both sides sign, and the Guild seals it.\" The Guild is already here.",
    tell: "The clerk has waited years for an excuse. He takes out a red stamp. \"PROVISIONAL,\" he tells their binder, tenderly. Their pegs are now decoration.",
  },
  short: "\"You are short,\" says the clerk, without malice. \"I have no form for that.\"",
  options: (round, p): readonly Opt[] => {
    const file: Opt = { key: "pay", label: `File the claim (£${p})`, hint: "Needs three of your pegs, with no Syndicate peg inside them.", cost: p };
    const joint: Opt = { key: "propose", label: "Propose a joint claim with the Syndicate", hint: "Needs one peg each, and no fighting. Everybody gets half of something.", cost: 0 };
    return round === 1
      ? [file, joint, { key: "ask", label: "Ask what the Syndicate has filed", hint: "He may mention the chain. He will pretend he did not.", cost: 0 }, { key: "flatter", label: "Admire the House's procedures", hint: "The price may drop. Or rise, if he sees through you.", cost: 0 },
        { key: "threaten", label: "Demand he pull the Syndicate's pegs", hint: "The surveyors run, and their guards come for you. This will be remembered.", cost: 0 }, walk]
      : [file, { key: "tell", label: "Tell him the Syndicate's chain is short", hint: "He stamps their survey PROVISIONAL. Then you can pull their pegs.", cost: 0 }, joint, walk];
  },
};

/** D-044, the Winding Engine: the Syndicate's engineer at the headframe, who knows exactly what his engine cannot stand and is paid by the hour to keep that to himself. */
const engineer: ParleyScript = {
  speaker: "Engineer Lucius Brack-Dunmarrow, of the Syndicate",
  open: [
    "\"She reaches the vein this afternoon,\" says the engineer, patting his engine. \"I am paid to keep her safe. Badly paid. For £{price}, I could find a fault.\"",
    "The engineer wipes his hands on a dirty rag. \"She strikes the vein by tea. Unless an inspection finds her unsafe. That costs £{price}. I am the inspector.\"",
  ],
  round2: [
    "\"Her feed is at the west wall,\" whispers the engineer, \"and she has no stomach for grit. One crate from the tailings heap would finish her. A guard passes every forty seconds.\"",
    "\"The Company's powder is in its magazine, by the fall,\" says the engineer, with regret. \"The lock was never fitted. And her feed at the west wall takes anything.\"",
  ],
  walk: "You step back. The engineer goes back to his gauge, which he taps, and which taps back.",
  hostile: "The engineer drops his rag and his manners at once. \"Guards!\" he calls, with real feeling. \"The Society is here to discuss my engine!\"",
  deal: {
    paid: "The engineer pockets the money and climbs up with a spanner. Something goes \"clunk\". \"Cracked flywheel,\" he calls down. \"Tragic. Nobody's fault.\"",
  },
  short: "\"You are short,\" says the engineer. \"Faults do not get cheaper for poorer customers. That is engineering.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Pay for an inspection (£${p})`, hint: "He finds a fault in his own engine, and it stops. No shots fired.", cost: p };
    return round === 1
      ? [pay, { key: "ask", label: "Ask what the engine cannot stand", hint: "He may tell you. He is not paid enough to keep quiet.", cost: 0 },
        { key: "threaten", label: "Tell him what you will do to his engine", hint: "He will call the guards. Loudly.", cost: 0 }, walk]
      : [pay, walk];
  },
};

/**
 * D-096, the Triangulation: the Dirge-Master again, at the Long Cloister, on the subject of names. The needles have had names for nine hundred years, each somebody's; the Guild will enter them
 * in the Society's chart for a fee (pay), or hear the Committee's (tell) and enter something else in its own ledger. Whether the gorge is measured yet, and whether the party measured the Guild's
 * vigil, are the template's (the deal lines are the conversation, not the verdict). Satire aimed at a Committee that names a country after itself.
 */
const needle_names: ParleyScript = {
  speaker: "Dirge-Master Osric Veil-Mourne",
  frame: { heading: "A word at the Long Cloister", asked: "The Guild's fee for its names: £{price} · Round {round} · The Dirge-Master seems {mood}." },
  open: [
    "\"Each needle is named for someone we could not bury,\" says the Dirge-Master. \"Our names cost £{price}. Your Committee's names are free. I could use a laugh.\"",
    "\"Your Committee wants to name the needles?\" says the Dirge-Master. \"So did the last two empires. Ours cost £{price}. Yours are free, and invoiced.\"",
  ],
  round2: [
    "\"The tall one is the Aunt Who Waited,\" says the Dirge-Master. \"The split one is the Two Who Argued. They still do, in a west wind. The rest cost £{price}.\"",
    "\"Old Tamsey's Debt is third from the river,\" says the Dirge-Master. \"He still owes us. £{price} for the whole set, his included.\"",
  ],
  walk: "You step back. The Dirge-Master marks the page with a ribbon and closes the ledger.",
  hostile: "The Dirge-Master shuts the ledger like a coffin lid. \"The Guild,\" he says, \"will see you at your funeral.\"",
  deal: {
    paid: "The fee is counted twice into a black velvet bag, and the Dirge-Master takes the Society's chart and a pen.",
    tell: "You take out the Committee's list and begin to read it aloud. The Dirge-Master takes out a second ledger and begins to write.",
  },
  short: "\"You are short,\" says the Dirge-Master. \"Names are the one thing the Guild never discounts.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Put the Guild's names on the chart (£${p})`, hint: "Close your triangle first. The needles keep their names; the Committee fumes.", cost: p };
    const tell: Opt = { key: "tell", label: "Read him the Committee's names", hint: "Mount Fothergill-Pym and six more go on the chart. The Guild sends a bill.", cost: 0 };
    const leave: Opt = { key: "walk", label: "Walk away", hint: "The needles stay unnamed for now. The Syndicate's survey goes on.", cost: 0 };
    return round === 1 ? [pay, tell, { key: "ask", label: "Ask what the needles are called", hint: "He tells you a few. The rest cost money.", cost: 0 }, leave] : [pay, tell, leave];
  },
};

/** D-096: the Syndicate's railway surveyor on the west bench, who will buy a closed triangle for a railway and sees no reason to name anything not on a timetable. */
const railway_surveyor: ParleyScript = {
  speaker: "Railway Surveyor Ptolemy Gradient-Hythe, of the Syndicate",
  frame: { heading: "A word at the Syndicate's tripod", asked: "His price for your survey: £{price} · Round {round} · The surveyor seems {mood}." },
  open: [
    "\"You measure for a map. We measure for a railway,\" says the surveyor. \"A railway is a map that pays. Close your triangle and I will buy it for £{price}.\"",
    "\"Your Committee wants names,\" says the surveyor. \"We want a railway. Close your triangle and I pay £{price}. The needles can be called whatever fits a timetable.\"",
  ],
  round2: [
    "\"We file when the next ore barge leaves. Soon,\" says the surveyor. \"The first survey to reach London wins the gorge. £{price} for yours.\"",
    "\"Between us, we are behind,\" says the surveyor. \"You have a better instrument and a worse employer. £{price} for your closed triangle.\"",
  ],
  walk: "You step back. The surveyor makes a mark in his field book, possibly about you.",
  hostile: "The surveyor looks at his chainman. The chainman looks at the wharf, ready to run.",
  deal: { survey: "\"Done,\" says the surveyor, taking out a purse. \"Show me the closed triangle.\"" },
  short: "\"I am buying,\" says the surveyor, \"not selling.\"",
  options: (round): readonly Opt[] => {
    const sell: Opt = { key: "propose", label: "Sell him your closed triangle", hint: "He pays, and lays a railway on your sums. The triangle must be closed.", cost: 0 };
    const leave: Opt = { key: "walk", label: "Walk away", hint: "His survey goes on.", cost: 0 };
    return round === 1 ? [sell, { key: "ask", label: "Ask when the Syndicate files its survey", hint: "He will tell you. He is a surveyor: he likes being asked.", cost: 0 }, leave] : [sell, leave];
  },
};

export const VESPER_PARLEYS = { foreman, dirge_master, assayer, engineer, needle_names, railway_surveyor } as const satisfies Partial<Record<"foreman" | "dirge_master" | "assayer" | "engineer" | "needle_names" | "railway_surveyor", ParleyScript>>;
