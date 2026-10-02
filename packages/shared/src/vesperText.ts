import type { CampaignState } from "./campaignTypes.ts";
import type { EndingCopy, RegionCopy, VesperEnding } from "./regionEndings.ts";

/**
 * Vesper Gorge's authored copy (D-037, package C3): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch, the signs, the chart note, the presence lines, the parley heading.
 * Satire aimed at INSTITUTIONS: a guild that bills per outcome and certifies its own diagnoses (the Low Vesper Lamentation Guild), a company that counts a collapse as a schedule variance (the Lower Gallery
 * Company), an assay house that registers whoever arrives first with the form, and a Syndicate that pegs a claim with a brochure. The miners, mourners and clerks are people with names; the only things
 * laughed at are the offices they hold. Fictional cultures only (scanned by noRealWorld.test.ts). Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */
export const VESPER_COPY: Record<VesperEnding, EndingCopy> = {
  dug_out: {
    piece: { kind: "stone", surface: "table", label: "A lump of the Lower Gallery's fall, sawn in half to show eleven bands of shale, one for each man who walked out." },
    memoryLine: [
      "I hear you took a gallery apart by hand in Vesper, eleven men and a great deal of timber. The Guild is said to be quietly furious. I find this encouraging.",
      "News from the gorge: a rescue with no funeral at the end of it. They tell me the Guild asked for a refund on the bell.",
    ],
    headlines: [
      "Eleven Miners Dug Out of the Lower Gallery; Guild Disappointed, Professionally",
      "Vesper Rescue Done by Hand, Behind Shoring; Company Calls It 'Ahead of a Revised Schedule'",
      "Society Digs, Foreman Writes It Down; Choir Stands By With a Bell and Nowhere to Ring It",
    ],
    standfirsts: [
      "The fall was shored with pit-props and shovelled by hand in the better part of a morning, and eleven men were handed back to the Company, which has asked who authorised it. Purse: £{purse}. {spin}",
      "Nobody was billed for the rescue, which has been described by the Low Vesper Lamentation Guild as 'a reckless disregard for outcomes'. Purse: £{purse}. {spin}",
      "Eleven miners were found alive, which the Company's register had not foreseen. The register is being amended. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"assisted a gallery in resuming operations\", with timber, by hand.",
      "Eleven men were \"returned to a state of employment\" at the Lower Gallery, over the Guild's objection.",
    ],
    debrief: "Vesper Gorge: the Lower Gallery was dug out by hand behind shoring; eleven men walked out and the Guild has not forgiven it.",
    news: {
      head: ["{A} Loses a Funeral, Files a Complaint", "Gorge Choir Stands Down, Slowly, Without Its Bell Rung", "{A} Calls Rescue 'Premature'"],
      body: [
        "{A} had arrived at the Lower Gallery with the lamps, the bell and the invoice, and found that the miners had been dug out of it. The Dirge-Master asked, for the record, who had authorised the survival.",
        "The choir stood at the fall in full mourning for a ceremony that did not occur. It has billed the Company for the preparation, and the Society for the disappointment.",
        "A spokesman for {A} said that rescues by hand were 'unseemly' and that the Guild would 'continue to monitor the situation, as it always does, after the fact'.",
      ],
    },
  },
  blasted_through: {
    piece: { kind: "barrel", surface: "chest", label: "A scorched stave of the Company's powder keg, mounted on a plaque that reads REGRETTABLY EFFICIENT." },
    memoryLine: [
      "I hear you blew a gallery open in Vesper, with the men still behind it. I keep powder myself. I know what the roof is thinking.",
      "News from the gorge: a keg, a fuse, a way through. The Guild is delighted. I do not think that is a compliment.",
    ],
    headlines: [
      "Lower Gallery Opened by Powder; Roof Relocated, Miners Partly Recovered",
      "Vesper Blast Clears the Fall in Four Seconds; Company Says 'Under Schedule'",
      "Society Brings the Fall Down, and Some of the Roof With It",
    ],
    standfirsts: [
      "A barrel of the Company's powder was set in the fall and the fuse was lit; the fall came down, and so did the part of the gallery behind it. Some of the miners are out. The Guild has been told. Purse: £{purse}. {spin}",
      "The blast was heard in four counties and the Assay House. The Guild's choir, who had been waiting, were first to the scene, and had the lamps already lit. Purse: £{purse}. {spin}",
      "'A very fast rescue,' said the foreman, 'by any standard, including the one we used to measure the roof.' Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"expedited access\" to the Lower Gallery, with a barrel.",
      "A fall was \"cleared with some force\"; the roof was \"relocated\" and has been \"written up\".",
    ],
    debrief: "Vesper Gorge: the Lower Gallery was blasted open; the way is clear, the roof has moved and some of the men did not enjoy it.",
    news: {
      head: ["{A} Reports a 'Gratifying' Turnout After the Blast", "Guild Praises Society's 'Direct Approach' to Mourning", "{A} Orders More Lamps"],
      body: [
        "{A}'s choir was on the scene before the dust had settled, with books open and the bell already hung. The Dirge-Master called the blast 'a most efficient referral'.",
        "The Guild has asked that the Society continue to solve its problems with powder: it finds the results 'consistent, and in season'.",
        "Eleven men were behind the fall. {A} is understood to have sent condolences to every family, with a form to sign for the courtesy.",
      ],
    },
  },
  sealed: {
    piece: { kind: "board", surface: "wall", label: "The Company's red plate, WORK CONTINUES, which was nailed over the Lower Gallery's face, and is now over your desk." },
    memoryLine: [
      "I hear a gallery in Vesper was sealed with men behind it, and a plate nailed on that says work continues. I know that plate. I have seen it on a bridge.",
      "News from the gorge: the Company met its schedule by closing the thing. Nobody can say I did not warn the Society about companies.",
    ],
    headlines: [
      "Lower Gallery Sealed to Protect the Schedule; Guild to Bill for 'Having Been Told'",
      "Company Meets Deadline by Closing the Mine; Eleven Names Struck From the Roll",
      "Vesper Gallery Sealed, Plate Reads 'Work Continues'",
    ],
    standfirsts: [
      "The foreman's whistle blew at the hour the Company had set, and the Lower Gallery was boarded, ironed and plated before anyone could point out what was in it. Purse: £{purse}. {spin}",
      "A sealed gallery cannot be behind schedule, the Company reports, and has described the decision as 'a clean finish'. The Guild has described it as 'billable'. Purse: £{purse}. {spin}",
      "The Society was in the gorge for the sealing and signed the visitors' book on the way out, as the book requires. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"was present at the completion of a gallery\", by the Company's schedule.",
      "A gallery was \"concluded\", and a plate was \"applied\" to the result.",
    ],
    debrief: "Vesper Gorge: the Lower Gallery was sealed by the Company with the miners behind it; the schedule is met and the Guild will bill for it.",
    news: {
      head: ["{A} Bills the Company for Being Told", "Guild Calls Seal 'an Opportunity'", "{A} Attends the Sealing, Late, as Always"],
      body: [
        "{A} was informed of the sealing by letter, which it counts as notice, and has invoiced the Company for the information and the Society for the delay.",
        "The Dirge-Master stood at the sealed face for some time and then drew up, on the spot, a bill for 'services to the future'. The Company has called it a 'courtesy'.",
        "A gallery that is sealed generates, the Guild notes, 'a very long period of mourning, at a very reasonable rate'.",
      ],
    },
  },
  consecrated: {
    piece: { kind: "lamp", surface: "table", label: "A Guild lamp of black glass, kept lit at a rate per hour, with the invoice folded under its foot." },
    memoryLine: [
      "I hear the Guild took a gallery in Vesper, and held a funeral for the men inside it. They were, I gather, still inside it. They were not consulted.",
      "News from the gorge: a consecration, with lamps, a bell and a very long hymn, and eleven men who did not ask for it. The Guild's invoice was prompt.",
    ],
    headlines: [
      "Guild Consecrates Lower Gallery; Funeral Held for the Living, Prompt and Invoiced",
      "Choir Takes Over Vesper Gallery; Miners Behind the Fall Asked to Be Patient",
      "Society Hands the Gallery to the Guild, Which Has Held a Service",
    ],
    standfirsts: [
      "The Low Vesper Lamentation Guild took possession of the Lower Gallery at the hour the air ran out, or at the hour the bill was paid, whichever came first. Purse: £{purse}. {spin}",
      "A funeral was held at the face for a congregation that could be heard, at times, through the rock. The Guild described the attendance as 'excellent'. Purse: £{purse}. {spin}",
      "'We were so very sorry for your loss,' said the Dirge-Master, 'that we did not wait for it.' Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"left a gallery in the Guild's capable hands\", with a lamp.",
      "A gallery was \"consecrated, in advance of need\".",
    ],
    debrief: "Vesper Gorge: the Guild took the Lower Gallery and held its funeral for the living; the fall is the Guild's problem and the bill is yours.",
    news: {
      head: ["{A} Has Its Best Season in Years", "Guild Consecrates, Counts, Consecrates Again", "{A} Calls the Gorge 'Fully Booked'"],
      body: [
        "{A} reports that a consecration of the Lower Gallery has 'exceeded all forecasts' and has opened a second bell, a second choir and a second ledger to deal with the demand.",
        "The Dirge-Master wept openly at the face, and the weeping, like everything at the Guild, was recorded and billed at a flat rate.",
        "Observers at the gorge noted that the choir had been at the mouth since before the fall. {A} says this was 'a coincidence, in the sense that all coincidences are'.",
      ],
    },
  },
  staked: {
    piece: { kind: "pennant", surface: "wall", label: "A rag-topped peg from the west bench, mounted on felt, with the claim's number written on it in the clerk's own hand." },
    memoryLine: [
      "I hear the Society pegged a claim in Vesper, first at the counter, and the Syndicate's brochure came second. I would like that sort of luck.",
      "News from the gorge: a claim registered to the Society, in order, with the form. I wonder what the Syndicate has had printed about it.",
    ],
    headlines: [
      "Society Registers West Bench Claim, First at the Counter, With the Form",
      "Syndicate Brochure Filed Under 'Late'; Society Pegs the Gorge",
      "Four Pegs, One Fee, One Stamp: Vesper's Claim Goes to the Society",
    ],
    standfirsts: [
      "Three pegs went in before the Syndicate's surveyors had finished unpacking the theodolite, and the Assay House stamped the form with the stamp it had been saving. Purse: £{purse}. {spin}",
      "The Syndicate's brochure for the claim was described by the clerk as 'very attractive' and 'regrettably second'. Purse: £{purse}. {spin}",
      "The claim was registered in the order of arrival, which is the only order the House has ever been seen to respect. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"established a presence\" on the west bench, with pegs.",
      "A claim was \"secured through diligence\", and a form.",
    ],
    debrief: "Vesper Gorge: the Society's claim on the west bench is registered, first at the counter, with the form; the Syndicate's brochure is filed under Late.",
    news: {
      head: ["{A} Disputes the Claim, in Print", "{A} Reprints Its Brochure, Larger", "{A} Takes the Matter to the Assay House's Appeals Window"],
      body: [
        "{A}'s surveyors have been heard to say that the claim was 'theirs in spirit', which the Assay House has noted as an unusual basis for tenure. The {b} was on hand to certify nothing in particular.",
        "A larger brochure is in preparation. It will carry the claim's number, and a picture of the claim, taken from a better angle than the claimant's.",
        "The Syndicate has applied to the clerk for a review. The clerk has applied for a larger stamp.",
      ],
    },
  },
  jumped: {
    piece: { kind: "key", surface: "chest", label: "A surveyor's brass key to a theodolite case, which nobody can account for taking, and which fits." },
    memoryLine: [
      "I hear the Society pulled the Syndicate's pegs in Vesper and filed in their place. A peg is a poor thing to fight over. People do it all the time.",
      "News from the gorge: a claim jumped, by force or by form, and the Assay House writes it down as a clarification.",
    ],
    headlines: [
      "Syndicate Pegs 'Clarified' Out of the West Bench; Society Files in Their Place",
      "Claim Jumped at Vesper, or, Properly, 'Corrected'",
      "Surveyors Flee Pegging Ground; Assay House Registers Whoever Was Left",
    ],
    standfirsts: [
      "The Syndicate's pegs came out of the ground one corner at a time, and three of the Society's went in behind them. The clerk, a professional, stamped whatever was on the counter. Purse: £{purse}. {spin}",
      "'A misunderstanding,' said the Society, 'about whose pegs these were.' 'A form,' said the clerk. 'Now it is filed.' Purse: £{purse}. {spin}",
      "The Syndicate's brochure was found in the dust, face down. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"corrected a boundary\" on the west bench.",
      "A rival's pegs were \"relocated to the spoil heap\", in the interests of accuracy.",
    ],
    debrief: "Vesper Gorge: the Society filed the west bench claim after the Syndicate's pegs came out of the ground; the Syndicate will not forget it.",
    news: {
      head: ["{A} Swears Revenge, in Triplicate", "{A} Calls Claim 'Jumped, Plainly, and in Public'", "{A} Brings the Guard Down the Road, Late"],
      body: [
        "{A}'s surveyors reported to the headframe at a speed their guards found impressive, and their guards reported to the pegging ground at a speed they found embarrassing. The {b}'s seal was affixed, at once, to nothing in particular.",
        "The Syndicate has lodged a grievance with the Assay House. The House has lodged it with the other grievances, which are in a very good order.",
        "A spokesman said that jumping a claim was 'a barbarous and unsportsmanlike act', and that {A} intended to do it better next time.",
      ],
    },
  },
  partnered: {
    piece: { kind: "frame", surface: "wall", label: "A joint claim, signed twice and sealed once by a Guild that was already there before anybody sent for it." },
    memoryLine: [
      "I hear the Society shared a claim with the Syndicate in Vesper, sealed by the Guild. I have always said everybody should have half of something.",
      "News from the gorge: a joint claim, certified. I should like to see the accounts.",
    ],
    headlines: [
      "Society and Syndicate Share the West Bench; Guild Certifies, Promptly",
      "Joint Claim at Vesper: Everybody Has Half of Something",
      "Pegs Divided at the Line; Surveyors and Society Shake Hands, in Public",
    ],
    standfirsts: [
      "The clerk produced a form for exactly this, and the Syndicate signed it with the face of a person told that a cheque was real. The Guild's seal arrived before it was sent for. Purse: £{purse}. {spin}",
      "The ore, when it comes, will be shared at a ratio the Assay House has been delighted to calculate. Purse: £{purse}. {spin}",
      "Both sides left the counter claiming a victory, which is the point of the form. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"entered a partnership\" on the west bench, under seal.",
      "A claim was \"shared at the line\", to general disappointment.",
    ],
    debrief: "Vesper Gorge: the west bench claim is shared with the Syndicate, sealed by the Guild; neither side is happy and both are on the books.",
    news: {
      head: ["{A} Shakes Hands, Counts Fingers", "{A} and the Society Share a Seam, and a Grudge", "{A} Calls Partnership 'a Temporary Arrangement, Permanently'"],
      body: [
        "{A} described the joint claim as 'the most productive misunderstanding in the gorge's history'. The Guild's seal, affixed by the {b}, was admired by all parties and read by none.",
        "Both sides have asked the Assay House to calculate who got the better of it. The House has declined, citing a conflict of interest, and has billed them for the answer.",
        "The Syndicate's brochure now carries a line about 'our valued partners'. The Society has asked for a larger line.",
      ],
    },
  },
  outpaced: {
    piece: { kind: "envelope", surface: "table", label: "The Syndicate's brochure for the claim you did not file, with your own notes stapled behind it, as an appendix." },
    memoryLine: [
      "I hear the Syndicate registered a claim in Vesper while the Society was still pacing the bench. I have been outpaced by the Syndicate myself. It is not a sensation you grow out of.",
      "News from the gorge: the Syndicate first at the counter, the Society's notes accepted as an appendix. I keep a lamp for appendices.",
    ],
    headlines: [
      "Syndicate First at the Assay Counter; Society's Notes Entered as an Appendix",
      "Vesper Claim to the Syndicate by a Margin of One Stamp",
      "Society Outpaced at Vesper; Brochure Wins by Default",
    ],
    standfirsts: [
      "The Syndicate's clerk arrived with a binder so thick it had a ribbon, and the Assay House's stamp came down on it with a sound the Society heard from across the bench. Purse: £{purse}. {spin}",
      "An unfiled claim is registered to whoever's brochure is on the counter, and the counter held only the one. Purse: £{purse}. {spin}",
      "'Regrettably second,' said the clerk, in writing, in the margin of the Society's notes. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"observed a claim being registered\", with notes.",
      "A claim was \"lost to a prior brochure\".",
    ],
    debrief: "Vesper Gorge: the Syndicate registered the west bench claim first; the Society's notes are an appendix.",
    news: {
      head: ["{A} Celebrates With a Second Brochure", "{A} Registers the Bench; Guild Certifies, Prompt as Ever", "{A} Offers the Society a Copy of the Brochure, at Cost"],
      body: [
        "{A} filed first and filed thick. The {b} was on hand to certify the filing, the ribbon and the stamp, and has been paid for all three.",
        "The Syndicate's surveyors, who had been driving pegs for an hour, were last seen being photographed with them. The brochure, it is said, will use the photograph.",
        "The Assay House has commended {A} on its 'punctuality', and has asked the Society, politely, to take its notes home.",
      ],
    },
  },
};

/** The ledger story's heading per template (>= 3 each), by the paper's `lastTemplate`. */
export const VESPER_STORY_HEADS = {
  mine_rescue: ["The Lower Gallery, in Figures", "Vesper Gorge: the Guild Reports", "On the Matter of a Collapse"],
  claim_race: ["The Claim Race, in Figures", "Vesper Gorge: the Assay Reports", "On the Matter of a Peg"],
} as const;

/** Signage of the gorge (Latin capitals; the view letters these). */
export const VESPER_SIGNS: readonly string[] = [
  "STAITHE LANDING. ORE OUTWARD, MOURNERS INWARD.",
  "LONG CLOISTER. FUNERALS BY APPOINTMENT. APPOINTMENTS BY FUNERAL.",
  "ASSAY HOUSE. EVERY CLAIM IS PROVISIONAL, INCLUDING THIS SIGN.",
  "THE LOWER GALLERY. WORK CONTINUES. THE GUILD HAS BEEN INFORMED.",
  "PEGGING GROUND. FIRST COME, FIRST BILLED.",
  "COMPANY YARD. NO ADMITTANCE. NO EXCEPTIONS. NO REFUNDS.",
];

const NAME_MINE: Partial<Record<string, string>> = {
  dug_out: "dug out by hand", blasted_through: "blasted through", sealed: "sealed by the Company", consecrated: "consecrated by the Guild",
};
const NAME_CLAIM: Partial<Record<string, string>> = { staked: "staked, first", jumped: "jumped", partnered: "shared with the Syndicate", outpaced: "lost to a brochure" };

export const VESPER_REGION: RegionCopy = {
  chartNote: (c: CampaignState): string => {
    if (!c.history.some((h) => h.region === "vesper")) return "Not yet visited. A dry river's canyon, a headframe, a cloister cut into the cliff and a guild that bills per outcome.";
    const mine = c.sites.ends.mine_rescue, claim = c.sites.ends.claim_race;
    const parts: string[] = [];
    if (mine) parts.push(`the Lower Gallery was ${NAME_MINE[mine] ?? mine}`);
    if (claim) parts.push(`the west bench was ${NAME_CLAIM[claim] ?? claim}`);
    const engine = c.sites.ends.winding_engine;   // D-044
    if (engine) parts.push(engine === "engine_fouled" ? "the Syndicate's engine choked on grit" : engine === "engine_blown" ? "the Syndicate's engine was blown up" : engine === "engine_bought" ? "the Syndicate's engineer found a fault, for a fee" : engine === "vein_struck" ? "the Syndicate struck the vein" : "the engine was left running");
    return `Last time: ${parts.length ? parts.join("; ") : "an expedition that left no mark"}.`;
  },
  presence: ["Day {day}: {party} in Vesper Gorge, billed per outcome", "Day {day} in Vesper Gorge, {party}, in the Guild's books"],
  parley: { heading: "A word in the gorge", asked: "Price asked: £{price} · Round {round} · They seem {mood}." },
};
