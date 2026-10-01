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
    "\"Lower Gallery,\" says the foreman, from behind a desk that has been carried out of the office so that he can supervise the fall from a respectful distance. \"A schedule variance. Eleven names on the roll, none of them present. The Company's position is that the fall is behind schedule, and so, therefore, is the rescue. The handling charge is £{price}.\"",
    "The foreman looks at you over his ledger, as a man looks at a possible exception. \"Nobody is permitted at the fall without a Variance Form,\" he says. \"The Variance Form is available from the foreman. I am the foreman. The form is £{price} if you are in a hurry, and free if you are not, and then it is merely very slow.\"",
  ],
  round2: [
    "\"The schedule,\" says the foreman, lowering his voice to the level of a man confiding something that is on a notice-board, \"seals the gallery at the end of the hour the Company has set for it. I am not at liberty to say which hour. It is on the board. The board is on the wall. The wall is in my office. My office is locked, for your safety. £{price}.\"",
    "\"Between us,\" says the foreman, who has never been between anybody, \"the Company does not like a gallery that is behind schedule. A sealed gallery is never behind schedule; it is simply finished. The charge to revise the schedule is £{price}, and it is not, I wish to say, a bribe. It has a receipt.\"",
  ],
  walk: "You step back. The foreman notes the time, your face, and the direction you left in, in that order, in a column headed ATTENDANCE.",
  hostile: "The foreman takes a step back from his desk, and the desk, in a way you would not have thought a desk could, takes a step back too. \"Whistle!\" he cries, to nobody, \"someone blow the whistle!\"",
  flatter: {
    ok: [
      "\"A clean record,\" says the foreman, softening visibly. \"It is the only thing I have ever been proud of, and I did not do it on purpose. £{price}, then, for a friend of the schedule.\"",
      "\"You have read the Company's report!\" says the foreman. \"Nobody has read the Company's report; it has no pages. £{price}, and I shall tell the board you were pleasant.\"",
    ],
    fail: [
      "\"Flattery is not a form,\" says the foreman. \"It is, however, billable. £{price}, to cover the speech.\"",
      "\"I have been flattered by a better class of company,\" says the foreman. \"£{price}.\"",
    ],
  },
  deal: {
    paid: "The money disappears into the ledger under HANDLING, and the foreman writes REVISED beside a time that has not yet happened. \"The gallery,\" he says, \"is not going to be sealed. I would not like you to think that this has anything to do with the money. It has to do with the money, but I would not like you to think it.\"",
    survey: "\"A Variance Form,\" says the foreman, receiving it with both hands and a sigh. \"In triplicate. The Stamp will see it in forty-five seconds, which at the Company is called prompt. The seal, I should say, will not wait for the Stamp. But it will, I am told, be sorry.\"",
  },
  short: "\"You are short,\" says the foreman, counting what is not there with his lips. \"The charge stands.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Pay the handling charge (£${p})`, hint: "The schedule is revised: the gallery is not sealed. It is not a bribe; it has a receipt.", cost: p };
    const form: Opt = { key: "propose", label: "File a Variance Form (stamped in forty-five seconds)", hint: "Free, in triplicate, and slow. If the seal comes first the Stamp is wasted; if the Stamp comes first the schedule moves a little.", cost: 0 };
    return round === 1
      ? [pay, form, { key: "ask", label: "Ask when the schedule seals the gallery", hint: "He may tell you. He will not enjoy it.", cost: 0 }, { key: "flatter", label: "Praise the Company's record", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
        { key: "threaten", label: "Tell him what you will do to his schedule", hint: "He has a whistle. You have opinions. This will be remembered.", cost: 0 }, walk]
      : [pay, form, walk];
  },
};

const dirge_master: ParleyScript = {
  speaker: "Dirge-Master Osric Veil-Mourne",
  open: [
    "\"We are so very sorry,\" says the Dirge-Master, rising from a bench he appears to have been sitting on since before the fall, \"for your loss. We are sorry in advance, which is cheaper. The Guild's bill for the Lower Gallery is £{price}, payable on delivery, and delivery, as we have always found, is soon.\"",
    "The Dirge-Master takes your hand in both of his, which are cold, and presses it, which is warm. \"The Low Vesper Lamentation Guild,\" he says, \"attends all outcomes. We have attended this one already; we have simply not been told it has happened. £{price} for the attendance, £{price} for the not being told.\"",
  ],
  round2: [
    "\"The air in a pocket like that,\" says the Dirge-Master, consulting a slim black book, \"lasts what the Guild has estimated it will last, which is exactly as long as it takes the choir to walk up the road. We are very punctual. We arrive when the air is spent. We have never once been early, and never once been wrong. £{price}.\"",
    "\"Sealing a gallery,\" says the Dirge-Master, drawing himself up, \"with customers in it is a restraint of mourning. The Guild would object, if it were asked what it knew. It has, I confess, a great deal of verse on the subject. £{price} for the verse.\"",
  ],
  walk: "You step back. The Dirge-Master bows, in a way that suggests he is making a note of the angle.",
  hostile: "The Dirge-Master takes your meaning, and the choir takes his. A bell that was about to be rung is lowered, with great care, to the ground, and then everybody is somewhere else.",
  flatter: {
    ok: [
      "\"You have a feeling for the work,\" says the Dirge-Master, thawing by a single degree. \"£{price}, and I shall have the choir learn your name, which they will pronounce, at the funeral, with real conviction.\"",
      "\"Seldom,\" says the Dirge-Master, \"are we noticed before the event. £{price}, for a patron of the pre-bereaved.\"",
    ],
    fail: [
      "\"Kind,\" says the Dirge-Master, \"and billable. £{price}.\"",
      "\"We have been flattered by every family in the lowlands,\" says the Dirge-Master. \"£{price}.\"",
    ],
  },
  deal: {
    paid: "The money is counted twice, by two people, into a black velvet bag. \"The Guild takes the gallery,\" says the Dirge-Master. \"The foreman will be relieved to learn that it is nobody's schedule now. We shall be along directly, with the lamps.\"",
    survey: "\"A vigil,\" says the Dirge-Master, as one tasting a pie that is also a hymn. \"We shall sing at the fall, very slowly, and the men behind it will breathe in time. It is a service we are not often asked to render to the living.\"",
    tell: "\"Sealed?\" says the Dirge-Master, the colour leaving his face and returning, with interest, as indignation. \"With customers in it? Madam, the Guild shall object. In verse. At length. Procedurally, the seal is stayed.\"",
  },
  short: "\"You are short,\" says the Dirge-Master, with great delicacy, as one noting a death. \"The bill stands.\"",
  options: (round, p): readonly Opt[] => {
    const pay: Opt = { key: "pay", label: `Settle the Guild's bill (£${p}): the Guild takes the gallery`, hint: "The funeral for the living, with lamps, a bell and a very long hymn. The gallery becomes the Guild's problem, which was the point.", cost: p };
    const vigil: Opt = { key: "propose", label: "Propose a vigil: the choir sings at the fall", hint: "The men behind it breathe slower, and the air lasts longer. The Guild bills the families for the atmosphere.", cost: 0 };
    return round === 1
      ? [pay, vigil, { key: "ask", label: "Ask what the Guild knows about the air", hint: "He may tell you, and the Guild's objections come with the knowledge.", cost: 0 }, { key: "flatter", label: "Admire the Guild's punctuality", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
        { key: "threaten", label: "Tell him to take his choir elsewhere", hint: "A choir takes offence the way a choir sings: as one. This will be remembered.", cost: 0 }, walk]
      : [pay, { key: "tell", label: "Tell him the Company means to seal the gallery with customers in it", hint: "The Guild objects, in verse. The seal is stayed for a while.", cost: 0 }, vigil, walk];
  },
};

const assayer: ParleyScript = {
  speaker: "Clerk Lemuel Tarn-Ledger (Assay House)",
  open: [
    "\"Claims,\" says the clerk, without looking up, from behind a counter that has been the same counter for eleven years, \"are registered to whoever arrives first with the right form and the right fee. The form is Form 3. The fee is £{price}. The pegs are the pegs. I do not, as a matter of policy, go out and look at them.\"",
    "The clerk stamps something that was already stamped. \"Assay House,\" he says. \"We weigh, we measure and we register. We do not judge. I have no views on pegs, claims, surveyors or the Syndicate's brochure, which is very attractive. Registration is £{price}.\"",
  ],
  round2: [
    "\"The Syndicate,\" says the clerk, lowering his voice from nothing to less, \"has filed a survey of the bench with a chain that they were, I observe, kind enough to shorten for the purpose. I have not said so. I have, however, made a note, and when a person tells me why it is unsound, the note becomes a stamp. £{price} to register your own.\"",
    "\"Their binder,\" says the clerk, \"is a very fine binder. The survey it holds was made with a chain that was, to my eye, a foot short of its marks. If somebody were to say so on the counter, with some degree of evidence, I should be obliged to mark it PROVISIONAL. £{price} for the filing.\"",
  ],
  walk: "You step back. The clerk writes down that you stepped back, and the direction, and the hour.",
  hostile: "\"I would ask you,\" says the clerk, to the air, as the surveyors bolt and the road fills with the sound of guards, \"to remember that this counter is not part of the dispute.\" He goes on stamping.",
  flatter: {
    ok: [
      "\"A person who admires procedure,\" says the clerk, lowering his stamp by a hair. \"£{price}, and I shall use the good blotter.\"",
      "\"Seldom noticed,\" says the clerk. \"£{price}, and I shall not tell the Syndicate you were civil.\"",
    ],
    fail: [
      "\"Procedure thanks you,\" says the clerk. \"£{price}.\"",
      "\"I have been admired by better,\" says the clerk. \"£{price}.\"",
    ],
  },
  deal: {
    paid: "The clerk takes the form, reads it twice, finds nothing wrong with it and is visibly disappointed. The stamp comes down. \"Registered,\" he says. \"To the Society, in the order of arrival. Should the Syndicate dispute it, they may do so in writing, at length, in a queue.\"",
    survey: "\"A joint claim,\" says the clerk, producing from beneath the counter a form that has plainly been waiting for exactly this. \"It is signed by both sides here, at the counter, and sealed by the Guild's seal, which will be here directly.\" It is.",
    tell: "The clerk takes your information with the face of a man who has waited years for an excuse, and brings a red stamp up from the drawer where it lives. \"PROVISIONAL,\" he says, to the binder, with real tenderness. Their pegs are, as of that stamp, decoration.",
  },
  short: "\"You are short,\" says the clerk, without malice. \"I have no form for that.\"",
  options: (round, p): readonly Opt[] => {
    const file: Opt = { key: "pay", label: `File the claim (£${p})`, hint: "Needs three pegs of yours and none of the Syndicate's standing inside them. First at the counter, with the form.", cost: p };
    const joint: Opt = { key: "propose", label: "Propose a joint claim (the Guild certifies)", hint: "Needs a peg each and the peace kept. Everybody has half of something.", cost: 0 };
    return round === 1
      ? [file, joint, { key: "ask", label: "Ask what the Syndicate has filed", hint: "He may mention the chain. He will pretend he did not.", cost: 0 }, { key: "flatter", label: "Admire the House's procedures", hint: "A gentleman never haggles. He remarks, graciously.", cost: 0 },
        { key: "threaten", label: "Demand the Syndicate's pegs be pulled", hint: "He is not a policeman. The guards at the headframe are. This will be remembered.", cost: 0 }, walk]
      : [file, { key: "tell", label: "Tell him the Syndicate's survey is unsound", hint: "Now that you know why: the clerk stamps it PROVISIONAL, and their pegs come out by hand.", cost: 0 }, joint, walk];
  },
};

export const VESPER_PARLEYS = { foreman, dirge_master, assayer } as const satisfies Partial<Record<"foreman" | "dirge_master" | "assayer", ParleyScript>>;
