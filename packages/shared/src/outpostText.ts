import type { ResolutionId } from "./campaignTypes.ts";
import { pluck } from "./regionEndings.ts";
import { ENGINE_COPY } from "./engineText.ts";
import { RAID_COPY } from "./raidText.ts";
import { REAPERS_COPY } from "./reapersText.ts";
import { SALTMARKET_COPY } from "./saltmarketText.ts";
import { VESPER_COPY } from "./vesperText.ts";
import type { OutpostPriority, OutpostStage, SettlementEventKind } from "./worldTypes.ts";

/**
 * Authored copy for the Society's outpost (D-035): what it is called, what the notices say when a crate goes down, what the paper says as it grows
 * (camp, trading post, fortified outpost, settlement, town) and what it says when it is raided or abandoned. Satire aimed at institutions that call a
 * mud-patch a "township" in the prospectus. Fictional throughout; scanned by noRealWorld.test.ts. Pending developer review (docs/AI_CONTENT_REGISTER.md).
 * Placeholders: {name} {stage} {n} {of}.
 */

/** Names the foundation is given (hash3 picks one; refounding a ruin picks another). */
export const OUTPOST_NAMES: readonly string[] = [
  "Quim's Rest", "Provisional Prospect", "Ledger's End", "Fort Reasonable", "Mudbank Amenity", "New Improvement", "Small Mercy", "Hopeful Landing", "Receipt Point", "Saltcake Halt", "Second Thoughts", "Dunmarrow's Regret",
];

export const STAGE_LABEL: Record<OutpostStage, string> = {
  none: "a foundation", camp: "a camp", trading_post: "a trading post", fortified_outpost: "a fortified outpost", settlement: "a settlement", town: "a town",
};
/** The foundation's board, lettered: the post's name, then what it is now (the board stands at every stage; `{name}` is the post's). Set on two lines at the full stop. */
export const BOARD_LINE: Record<OutpostStage, string> = {
  none: "{name}. A Foundation, Pending", camp: "{name}. A Society Camp", trading_post: "{name}. Trading Post", fortified_outpost: "{name}. Fortified Outpost", settlement: "{name}. A Settlement", town: "{name}. Town & Borough",
};
/** The Syndicate's board at its own post (Kessar). */
export const RIVAL_BOARD = "Dunmarrow-Vesk Syndicate. Concessions Bought Here";
export const PRIORITY_LABEL: Record<OutpostPriority, string> = {
  trade: "Trade", military: "Defence", growth: "Growth", extraction: "Extraction", transport: "Transport",
};

/** What the notice says as a crate goes down at the foundation (`{n}` of `{of}`). >= 3, picked by the count. */
export const CRATE_LINES: readonly string[] = [
  "Crate {n} of {of}. The Society thanks you in advance.",
  "Crate {n} of {of} is down. The string has been pulled taut, for morale.",
  "Crate {n} of {of}, set on the stakes. A clerk has already written 'progress' beside it.",
  "Crate {n} of {of} accepted. The foundation has been informed it is a foundation.",
];
export const FOUNDED_LINES: readonly string[] = [
  "The fourth crate is down: {name} is founded. A tent goes up at once, and a form beside it.",
  "{name} exists. It was a patch of scrub this morning, and the Society would like it noted that it still is.",
  "Four crates make a camp. {name} has a flag, a fire and a prospectus.",
];
/** Barrels strengthen the stockade ("powder for the palisade"), chairs the people ("furniture is the vanguard of civilisation"). */
export const DELIVER_LINES: Record<"crate" | "barrel" | "chair", readonly string[]> = {
  crate: ["Another crate for {name}. The stores look a little less like a rumour.", "The crate is taken in. A man counts it twice and finds a third crate, which is wishful.", "Supplies for {name}, logged. Nobody ate anything, which is how it grows."],
  barrel: ["A barrel of powder for the stockade, and a very small speech about safety.", "The barrel is rolled behind the palisade, where it will be a comfort and a worry.", "Powder for {name}: security improves, as does the quality of the nightmares."],
  chair: ["A chair for {name}. Furniture is the vanguard of civilisation, a clerk explains, and sits on it.", "The chair is installed. It is, by some distance, the first chair.", "A chair is delivered. A committee forms around it within the hour."],
};
export const REFUSED_LINES: readonly string[] = [
  "A bottle does not found a settlement, though several have tried.",
  "The foundation declines the bottle. It is a firm and a thirsty foundation.",
  "Nobody will take a bottle for the outpost. The clerks are looking at it with interest and refusing to say why.",
];
export const FOUNDATION_ONLY_CRATES = "Only crates found a camp. The rest can come later, when there is a later.";
export const RUINED_LINES: readonly string[] = [
  "The camp was abandoned and the grass has begun to claim the string. Four crates would raise it again.",
  "A ruin at the foundation. It will be refounded, as soon as someone is blamed for the first time.",
];

/** Paper copy by event kind (>= 3 heads and bodies each). */
export const SETTLEMENT_NEWS: Record<SettlementEventKind, { head: readonly string[]; body: readonly string[] }> = {
  founded: {
    head: ["Society Founds {name} South of the Bridge", "A Camp Is Raised at {name}", "{name}: A Beginning, Allegedly"],
    body: ["Four crates and a quantity of string have become a camp. The Houses call it promising. The Syndicate calls it a provocation. The Ward is drafting an assessment.", "The first tent is up at {name}. The first complaint arrived before the second.", "A foundation was laid at {name} and a fire lit beside it. The fire has already been blamed."],
  },
  delivered: {
    head: ["Stores Reach {name}", "More Goods for {name}", "{name} Restocked, Mostly"],
    body: ["A delivery of stores reached {name} this week. Supplies are said to be 'adequate in the sense of a declaration'.", "Hauling to {name} continues. An outpost, the Society reminds readers, is a verb.", "The stores at {name} are a little fuller than they were, and a little emptier than they will be."],
  },
  promoted: {
    head: ["{name} Is Now {stage}", "Promotion at {name}: Now {stage}", "{name} Raised to {stage}"],
    body: ["{name} has been upgraded to {stage}. The Society would like it known that nobody asked the ground.", "By decision of the Committee, {name} is {stage}. The sign has been repainted, in a hurry, in the wrong colour.", "{name} grows. It is now {stage}, and has acquired the sort of complaints that come with it."],
  },
  demoted: {
    head: ["{name} Reduced to {stage}", "Setback at {name}", "{name}: A Retrenchment"],
    body: ["{name} has been reduced to {stage}. The Society describes this as 'rightsizing' and nobody is laughing at a decent volume.", "Supplies ran short and so did patience. {name} is {stage} again.", "{name} is smaller than it was. The Committee has asked that it be called 'efficient'."],
  },
  raided: {
    head: ["Unscheduled Inspection at {name}", "{name} Visited in the Night", "Raid at {name}: Regretted Politely"],
    body: ["{name} was inspected in the night by persons unknown, who removed several crates and the sense of security. The Society regards it as communicative.", "A raid on {name}. Damage is described as 'a reminder'. The stores are described as 'gone'.", "Somebody visited {name} and took an interest in its goods. Nobody has claimed it. Everybody has an opinion."],
  },
  abandoned: {
    head: ["{name} Falls to the Grass", "Camp at {name} Abandoned", "{name}: A Ruin, Already"],
    body: ["{name} has been given up. The tents are down, the fire is out and the foundation is a patch of mud with ambitions.", "The camp at {name} could not be kept. It will be raised again, the Society promises, as soon as someone is available to be blamed.", "{name} was left to the weather, which took it with every appearance of relief."],
  },
  road: {
    head: ["A Road Appears Beyond {name}", "Carts Wear a Track Out From {name}", "{name} Gets a Road, or a Rumour of One"],
    body: ["Enough carts have come and gone that a road has formed. The Society claims it as 'infrastructure'. The road makes no claim on the Society.", "A road has worn itself between {name} and the landing, in the manner of a decision nobody made.", "The track from {name} is now officially a road, which means it is officially somebody's fault."],
  },
  telegraph: {
    head: ["Telegraph Poles Reach {name}", "The Wire Comes to {name}", "News Now Travels Faster Than Anyone Can Contradict It"],
    body: ["A telegraph line now runs to {name} and over the Ward's bridge. News will arrive faster and be wrong sooner.", "The poles are up and the wire is strung. The Society has already received its first message, which was a bill.", "A telegraph has been strung to {name}. Scouts and rumours will now be reported in about half the time, in about double the words."],
  },
  launch: {
    head: ["Steam Launch Now Calls at {name}", "A Launch at the Landing", "The Sea Is Shorter Now"],
    body: ["A steam launch now serves {name}, cutting the crossing to a few seconds of unpleasant noise. The Brine Houses have been invited to be impressed.", "The launch works the landing in the hours when the tide permits and a clerk is awake. Passage is faster; the boat is louder.", "A steam launch has replaced the rowing boat. The rowing boat has been retired with a small pension."],
  },
};

/** What the signboard on each stage says (the view letters them; no real-world term in any). */
export const OUTPOST_SIGNS: Record<Exclude<OutpostStage, "none">, string> = {
  camp: "SOCIETY CAMP. PLEASE WIPE YOUR BOOTS ON THE STRING.",
  trading_post: "TRADING POST. CREDIT BY ARRANGEMENT. ARRANGEMENT BY CREDIT.",
  fortified_outpost: "FORTIFIED OUTPOST. THE STOCKADE IS MOSTLY OPINION.",
  settlement: "SETTLEMENT. POPULATION: EXPANDING. PERMISSIONS: PENDING.",
  town: "TOWN. THE CLOCK IS CORRECT TWICE A DAY.",
};
export const FOUNDATION_SIGN = "FUTURE SITE OF SOMETHING. DELIVER CRATES HERE.";

/** What HQ keeps of each way an expedition ended (D-035): one object each, on the planning table, in the strongbox or on the marquee's back wall. Exhaustive, so a new ending must be remembered. */
export type HqPieceKind = "lamp" | "bridge" | "portrait" | "crate" | "frame" | "stone" | "board" | "key" | "pennant" | "model" | "envelope" | "barrel";
export type HqSurface = "table" | "chest" | "wall";
export const HISTORY_PIECE: Record<ResolutionId, { kind: HqPieceKind; surface: HqSurface; label: string }> = {
  ...pluck(VESPER_COPY, "piece"), ...pluck(SALTMARKET_COPY, "piece"), ...pluck(REAPERS_COPY, "piece"), ...pluck(ENGINE_COPY, "piece"), ...pluck(RAID_COPY, "piece"),   // D-037 (regionEndings.ts)
  paid: { kind: "frame", surface: "wall", label: "A receipt for the toll, framed, with the Warden's thumbprint." },
  bargained: { kind: "frame", surface: "wall", label: "The discount, in writing. Nobody can believe it either." },
  bribed: { kind: "envelope", surface: "chest", label: "An empty envelope, kept in case it is ever asked for." },
  forced: { kind: "lamp", surface: "table", label: "A captured lamp from the Ward's wall, still warm with disapproval." },
  sabotaged: { kind: "bridge", surface: "table", label: "A fragment of the bridge. It was a good bridge." },
  rival_secured: { kind: "board", surface: "wall", label: "A Syndicate tariff board, taken down and hung up out of spite." },
  abandoned: { kind: "frame", surface: "wall", label: "An empty frame, for the expedition that did not happen." },
  ransomed: { kind: "frame", surface: "wall", label: "The ransom receipt for Mr. Quim, itemised." },
  rescued: { kind: "portrait", surface: "wall", label: "Mr. Quim's portrait, in which he looks relieved, injured and billed." },
  slipped_away: { kind: "key", surface: "chest", label: "A bent key, from a cage that was not locked after all." },
  hostage_lost: { kind: "portrait", surface: "wall", label: "A portrait with a black ribbon. The insurers have been informed." },
  seized: { kind: "crate", surface: "chest", label: "A stencilled Syndicate crate, rehomed." },
  tipped_off: { kind: "frame", surface: "wall", label: "A note of thanks from the Ward's pickets, which they will deny writing." },
  burned: { kind: "board", surface: "table", label: "A scorched board from a Syndicate wagon." },
  passed: { kind: "envelope", surface: "chest", label: "A Syndicate cheque, framed in the hope that it will clear." },
  mediated: { kind: "stone", surface: "table", label: "A survey stake from Marker Stone No. 4: a border, mediated." },
  sided_ward: { kind: "pennant", surface: "wall", label: "A pennant of the Ward, loaned with conditions." },
  sided_syndicate: { kind: "pennant", surface: "wall", label: "A Syndicate pennant. It has been hung low." },
  provoked: { kind: "barrel", surface: "table", label: "A bent rifle barrel, a lesson in diplomacy." },
  escalated: { kind: "stone", surface: "table", label: "A cracked piece of a marker stone, after the argument." },
  // D-036: what HQ keeps of Highmark's chair (the existing piece kinds: a seating plan, a council's sheet, a key, a counterfoil)
  backed_elder: { kind: "frame", surface: "wall", label: "A seating plan of Highmark's court, the elder heir's name underlined twice." },
  backed_younger: { kind: "frame", surface: "wall", label: "A seating plan of Highmark's court, the younger heir's name underlined, then crossed out, then underlined." },
  regency: { kind: "envelope", surface: "chest", label: "A council's three signatures on one sheet, in three different inks, and a fourth for luck." },
  usurped: { kind: "key", surface: "chest", label: "A key to a door at Highmark that the Society says it found open." },
  crown_sold: { kind: "envelope", surface: "chest", label: "A counterfoil from the Syndicate's cheque for a crown. It cleared; the Society wishes it knew how." },
};
export const MODEL_LABEL = "A scale model of the outpost, to the scale of a prospectus.";
export const PENNANT_LABEL: Record<"road" | "telegraph" | "launch", string> = {
  road: "A pennant for the road, which is the first thing the Committee will take credit for.",
  telegraph: "A pennant for the telegraph, tied to a very small pole.",
  launch: "A pennant for the steam launch, which is smaller than the launch.",
};
