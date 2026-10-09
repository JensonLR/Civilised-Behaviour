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
      "I hear you dug eleven men out of a gallery in Vesper, by hand. The Guild is quietly furious. I find that encouraging.",
      "News from the gorge: a rescue with no funeral at the end of it. They tell me the Guild asked for a refund on the bell.",
    ],
    headlines: [
      "Eleven Miners Dug Out of the Lower Gallery; Guild Disappointed, Professionally",
      "Vesper Rescue Done by Hand; Company Calls It 'Ahead of a Revised Schedule'",
      "Society Digs, Foreman Takes Notes; Choir Left Holding Its Bell",
    ],
    standfirsts: [
      "The fall was propped up and dug out by hand in one morning. Eleven men walked out. The Company has asked who allowed it. Purse: £{purse}. {spin}",
      "Nobody was billed for the rescue. The Low Vesper Lamentation Guild calls it 'a reckless disregard for outcomes'. Purse: £{purse}. {spin}",
      "Eleven miners were found alive, which the Company's records had not planned for. The records are being corrected. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"assisted a gallery in resuming operations\", with timber, by hand.",
      "Eleven men were \"returned to a state of employment\" at the Lower Gallery, over the Guild's objection.",
    ],
    debrief: "Vesper Gorge: the Lower Gallery was dug out by hand. Eleven men walked out, and the Guild has not forgiven it.",
    news: {
      head: ["{A} Loses a Funeral, Files a Complaint", "Gorge Choir Goes Home, Its Bell Unrung", "{A} Calls Rescue 'Premature'"],
      body: [
        "{A} came to the Lower Gallery with lamps, a bell and a bill, and found the miners already dug out. The Dirge-Master asked who had allowed the survival.",
        "The choir stood at the fall in full mourning, for a funeral that never came. It has billed the Company for its time and the Society for the disappointment.",
        "{A} calls rescues by hand 'unseemly'. It will 'keep watching the situation, as it always does, after the fact'.",
      ],
    },
  },
  blasted_through: {
    piece: { kind: "barrel", surface: "chest", label: "A scorched plank from the Company's powder keg, mounted on a plaque that reads REGRETTABLY EFFICIENT." },
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
      "A barrel of the Company's powder blew the fall open, and part of the gallery came down with it. Some miners are out. The Guild has been told. Purse: £{purse}. {spin}",
      "The blast was heard all over the gorge. The Guild's choir was first on the scene, with the lamps already lit. Purse: £{purse}. {spin}",
      "'A very fast rescue,' said the foreman. 'The roof came down even faster.' Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"expedited access\" to the Lower Gallery, with a barrel.",
      "A fall was \"cleared with some force\"; the roof was \"relocated\" and has been \"written up\".",
    ],
    debrief: "Vesper Gorge: the Lower Gallery was blasted open. The way is clear, the roof has moved, and not every man came out.",
    news: {
      head: ["{A} Reports a 'Gratifying' Turnout After the Blast", "Guild Praises Society's 'Direct Approach' to Mourning", "{A} Orders More Lamps"],
      body: [
        "{A}'s choir arrived before the dust had settled, with books open and the bell already hung. The Dirge-Master called the blast 'a most efficient referral'.",
        "The Guild hopes the Society will keep solving its problems with powder. It finds the results 'reliable, and good for business'.",
        "Eleven men were behind the fall. {A} sent condolences to every family, with a form to sign for the courtesy.",
      ],
    },
  },
  sealed: {
    piece: { kind: "board", surface: "wall", label: "The Company's red plate, WORK CONTINUES, once nailed over the sealed Lower Gallery. Now it hangs over your desk." },
    memoryLine: [
      "I hear a gallery in Vesper was sealed with men behind it, under a plate that says work continues. I know that plate. I have seen it on a bridge.",
      "News from the gorge: the Company met its schedule by closing the mine. Nobody can say I did not warn the Society about companies.",
    ],
    headlines: [
      "Lower Gallery Sealed to Protect the Schedule; Guild to Bill for 'Having Been Told'",
      "Company Meets Deadline by Closing the Mine; Eleven Names Struck From the Roll",
      "Vesper Gallery Sealed, Plate Reads 'Work Continues'",
    ],
    standfirsts: [
      "The foreman's whistle blew on the Company's hour. The Lower Gallery was boarded up before anyone could mention who was inside. Purse: £{purse}. {spin}",
      "A sealed gallery cannot be behind schedule, says the Company. It calls this 'a clean finish'. The Guild calls it 'billable'. Purse: £{purse}. {spin}",
      "The Society was in the gorge for the sealing, and signed the visitors' book on the way out, as the book requires. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"was present at the completion of a gallery\", by the Company's schedule.",
      "A gallery was \"concluded\", and a plate was \"applied\" to the result.",
    ],
    debrief: "Vesper Gorge: the Company sealed the Lower Gallery with the miners inside. The schedule is met, and the Guild will bill for it.",
    news: {
      head: ["{A} Bills the Company for Being Told", "Guild Calls Seal 'an Opportunity'", "{A} Attends the Sealing, Late, as Always"],
      body: [
        "{A} heard of the sealing by letter. It has billed the Company for the news, and the Society for the delay.",
        "The Dirge-Master stood at the sealed gallery for a while, then wrote a bill for 'services to the future'. The Company calls it a 'courtesy'.",
        "A sealed gallery, the Guild notes, means 'a very long period of mourning, at a very reasonable rate'.",
      ],
    },
  },
  consecrated: {
    piece: { kind: "lamp", surface: "table", label: "A Guild lamp of black glass, billed by the hour, with the invoice folded under its foot." },
    memoryLine: [
      "I hear the Guild took a gallery in Vesper and held a funeral for the men inside. They were, I gather, still alive. Nobody asked them.",
      "News from the gorge: a funeral with lamps, a bell and a very long hymn, for eleven men who did not ask for one. The Guild's bill was prompt.",
    ],
    headlines: [
      "Guild Takes Lower Gallery; Funeral Held for the Living, Prompt and Invoiced",
      "Choir Takes Over Vesper Gallery; Miners Behind the Fall Asked to Be Patient",
      "Society Hands the Gallery to the Guild, Which Has Held a Service",
    ],
    standfirsts: [
      "The Low Vesper Lamentation Guild took over the Lower Gallery when the air ran out, or when the bill was paid. Whichever came first. Purse: £{purse}. {spin}",
      "A funeral was held at the fall. The mourned could sometimes be heard through the rock. The Guild called the attendance 'excellent'. Purse: £{purse}. {spin}",
      "'We were so very sorry for your loss,' said the Dirge-Master, 'that we did not wait for it.' Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"left a gallery in the Guild's capable hands\", with a lamp.",
      "A gallery was \"consecrated, in advance of need\".",
    ],
    debrief: "Vesper Gorge: the Guild took the Lower Gallery and held a funeral for the living. The fall is the Guild's problem; the bill is yours.",
    news: {
      head: ["{A} Has Its Best Season in Years", "Guild Consecrates, Counts, Consecrates Again", "{A} Calls the Gorge 'Fully Booked'"],
      body: [
        "{A} says its Lower Gallery funeral 'beat all forecasts'. It has hired a second choir and opened a second ledger to meet the demand.",
        "The Dirge-Master wept openly at the fall. Like everything at the Guild, the weeping was billed at a flat rate.",
        "The choir was at the mine before the fall even happened. {A} calls this 'a coincidence, as all coincidences are'.",
      ],
    },
  },
  staked: {
    piece: { kind: "pennant", surface: "wall", label: "A rag-topped peg from the west bench, mounted on felt, with the claim's number written on it in the clerk's own hand." },
    memoryLine: [
      "I hear the Society filed a claim in Vesper first, and the Syndicate's brochure came second. I would like that sort of luck.",
      "News from the gorge: a claim registered to the Society, in order, with the form. I wonder what the Syndicate has had printed about it.",
    ],
    headlines: [
      "Society Registers West Bench Claim, First at the Counter, With the Form",
      "Syndicate Brochure Filed Under 'Late'; Society Pegs the Gorge",
      "Four Pegs, One Fee, One Stamp: Vesper's Claim Goes to the Society",
    ],
    standfirsts: [
      "Three pegs went in before the Syndicate had unpacked its instruments. The Assay House stamped the claim with the stamp it had been saving. Purse: £{purse}. {spin}",
      "The clerk called the Syndicate's brochure for the claim 'very attractive' and 'regrettably second'. Purse: £{purse}. {spin}",
      "The claim went to whoever arrived first. It is the only rule the Assay House has ever been seen to respect. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"established a presence\" on the west bench, with pegs.",
      "A claim was \"secured through diligence\", and a form.",
    ],
    debrief: "Vesper Gorge: the Society filed its west bench claim first, with the form. The Syndicate's brochure is filed under Late.",
    news: {
      head: ["{A} Disputes the Claim, in Print", "{A} Reprints Its Brochure, Larger", "{A} Takes the Matter to the Assay House's Appeals Window"],
      body: [
        "{A}'s surveyors say the claim was 'theirs in spirit'. The Assay House calls this an unusual reason to own land. Nothing in particular was certified by {b}.",
        "A larger brochure is on the way. It will carry the claim's number, and a picture of the claim taken from a better angle than the claimant's.",
        "The Syndicate has asked the clerk for a review. The clerk has asked for a larger stamp.",
      ],
    },
  },
  jumped: {
    piece: { kind: "key", surface: "chest", label: "A Syndicate surveyor's brass key to his instrument case. Nobody remembers taking it. It still fits." },
    memoryLine: [
      "I hear the Society pulled the Syndicate's pegs in Vesper and filed in their place. A peg is a poor thing to fight over. People do it all the time.",
      "News from the gorge: a claim jumped, by force or by form. The Assay House writes it down as a clarification.",
    ],
    headlines: [
      "Syndicate Pegs 'Clarified' Out of the West Bench; Society Files in Their Place",
      "Claim Jumped at Vesper, or, Properly, 'Corrected'",
      "Surveyors Flee Pegging Ground; Assay House Registers Whoever Was Left",
    ],
    standfirsts: [
      "The Syndicate's pegs came out one corner at a time, and the Society's went in behind them. The clerk stamped whatever was on the counter. Purse: £{purse}. {spin}",
      "'A misunderstanding,' said the Society, 'about whose pegs these were.' 'A form,' said the clerk. 'Now it is filed.' Purse: £{purse}. {spin}",
      "The Syndicate's brochure was found in the dust, face down. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"corrected a boundary\" on the west bench.",
      "A rival's pegs were \"relocated to the spoil heap\", in the interests of accuracy.",
    ],
    debrief: "Vesper Gorge: the Society pulled the Syndicate's pegs and filed the west bench claim. The Syndicate will not forget it.",
    news: {
      head: ["{A} Swears Revenge, in Triplicate", "{A} Calls Claim 'Jumped, Plainly, and in Public'", "{A} Brings the Guard Down the Road, Late"],
      body: [
        "{A}'s surveyors ran to the headframe very fast. Their guards came back to the pegs very slowly. The seal of {b} was fixed, at once, to nothing in particular.",
        "The Syndicate has filed a complaint with the Assay House. The House has filed it with the other complaints, in very good order.",
        "{A} calls claim-jumping 'a barbarous and unsportsmanlike act', and promises to do it better next time.",
      ],
    },
  },
  partnered: {
    piece: { kind: "frame", surface: "wall", label: "A joint claim, signed twice and sealed once, by a Guild that arrived before anybody sent for it." },
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
      "The clerk had a form for exactly this, and both sides signed it, slowly. The Guild's seal arrived before anyone sent for it. Purse: £{purse}. {spin}",
      "The ore, when it comes, will be shared at a ratio the Assay House was delighted to work out. Purse: £{purse}. {spin}",
      "Both sides left the counter claiming a victory, which is the point of the form. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"entered a partnership\" on the west bench, under seal.",
      "A claim was \"shared at the line\", to general disappointment.",
    ],
    debrief: "Vesper Gorge: the west bench claim is shared with the Syndicate and sealed by the Guild. Neither side is happy.",
    news: {
      head: ["{A} Shakes Hands, Counts Fingers", "{A} and the Society Share a Seam, and a Grudge", "{A} Calls Partnership 'a Temporary Arrangement, Permanently'"],
      body: [
        "{A} calls the joint claim 'the gorge's most profitable misunderstanding'. The seal, fixed by {b}, was admired by all and read by none.",
        "Both sides asked the Assay House who got the better deal. The House would not say, and billed them both for the answer.",
        "The Syndicate's brochure now has a line about 'our valued partners'. The Society has asked for a larger line.",
      ],
    },
  },
  outpaced: {
    piece: { kind: "envelope", surface: "table", label: "The Syndicate's brochure for the claim you did not file, with your own notes pinned behind it, as an appendix." },
    memoryLine: [
      "I hear the Syndicate filed a claim in Vesper while the Society was still pacing the bench. The Syndicate has beaten me too. You never get used to it.",
      "News from the gorge: the Syndicate filed first, and the Society's notes became an appendix. I shall light a lamp for them.",
    ],
    headlines: [
      "Syndicate First at the Assay Counter; Society's Notes Entered as an Appendix",
      "Vesper Claim to the Syndicate by a Margin of One Stamp",
      "Society Outpaced at Vesper; Brochure Wins by Default",
    ],
    standfirsts: [
      "The Syndicate's clerk brought a binder so thick it had a ribbon. The Assay House stamped it loud enough for the Society to hear. Purse: £{purse}. {spin}",
      "An unfiled claim goes to whoever's brochure is on the counter. There was only one. Purse: £{purse}. {spin}",
      "'Regrettably second,' wrote the clerk, in the margin of the Society's notes. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"observed a claim being registered\", with notes.",
      "A claim was \"lost to a prior brochure\".",
    ],
    debrief: "Vesper Gorge: the Syndicate filed the west bench claim first. The Society's notes are an appendix.",
    news: {
      head: ["{A} Celebrates With a Second Brochure", "{A} Registers the Bench; Guild Certifies, Prompt as Ever", "{A} Offers the Society a Copy of the Brochure, at Cost"],
      body: [
        "{A} filed first and filed thick. The filing, the ribbon and the stamp were all certified by {b}, which was paid for all three.",
        "The Syndicate's surveyors were last seen being photographed with their pegs. The brochure, it is said, will use the photograph.",
        "{A} was praised by the Assay House for its 'punctuality'. The Society was politely asked to take its notes home.",
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
  dug_out: "dug out by hand", blasted_through: "blasted through", sealed: "sealed by the Company", consecrated: "taken over by the Guild",
};
const NAME_CLAIM: Partial<Record<string, string>> = { staked: "claimed by the Society", jumped: "jumped", partnered: "shared with the Syndicate", outpaced: "lost to a brochure" };

export const VESPER_REGION: RegionCopy = {
  chartNote: (c: CampaignState): string => {
    if (!c.history.some((h) => h.region === "vesper")) return "Not yet visited. A dry canyon with a mine, a cloister cut into the cliff, and a guild that bills for every outcome.";
    const mine = c.sites.ends.mine_rescue, claim = c.sites.ends.claim_race;
    const parts: string[] = [];
    if (mine) parts.push(`the Lower Gallery was ${NAME_MINE[mine] ?? mine}`);
    if (claim) parts.push(`the west bench was ${NAME_CLAIM[claim] ?? claim}`);
    const engine = c.sites.ends.winding_engine;   // D-044
    if (engine) parts.push(engine === "engine_fouled" ? "the Syndicate's engine choked on grit" : engine === "engine_blown" ? "the Syndicate's engine was blown up" : engine === "engine_bought" ? "the Syndicate's engineer found a fault, for a fee" : engine === "vein_struck" ? "the Syndicate struck the vein" : "the engine was left running");
    const trig = c.sites.ends.triangulation;   // D-096
    if (trig && trig !== "abandoned") parts.push(trig === "trig_guild" ? "the needles kept the Guild's names" : trig === "trig_committee" ? "the needles got the Committee's names, and a bill" : trig === "trig_sold" ? "the survey was sold for a railway" : "the Syndicate filed its survey first");
    return `Last time: ${parts.length ? parts.join("; ") : "an expedition that left no mark"}.`;
  },
  presence: ["Day {day}: {party} in Vesper Gorge, billed per outcome", "Day {day} in Vesper Gorge, {party}, in the Guild's books"],
  parley: { heading: "A word in the gorge", asked: "Price asked: £{price} · Round {round} · They seem {mood}." },
};
