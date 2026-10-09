import type { ComplicationId } from "./campaignTypes.ts";
import type { PowerId } from "./worldTypes.ts";
import { neutralNumbers, type EndingNumbers, type MinorDelta, type SiegeEnding } from "./regionEndings.ts";

/**
 * The Siege of the Counting-House's ledger NUMBERS (D-095, Kessar's sixth contract: the GDD's siege). The Syndicate (`rival`) keeps a trading post on the Ward's south bank; the Society
 * besieges it by the book; the Ward (`ward`), whose bank it is, hires out the pickets and watches from the fort. Like the raid, the crossing, the toll and the bridge are untouched
 * (`toll: "keep"`); the post itself is struck by `siegeAftermath` (WorldRoom.commitOutcome) on any won or bought ending.
 */
const row = (a: PowerId, b: PowerId | undefined, o: Omit<EndingNumbers, "news" | "rule"> & { rule?: Partial<EndingNumbers["rule"]> }): EndingNumbers => {
  const base = neutralNumbers(a, b);
  return { ...base, ...o, rule: { ...base.rule, ...o.rule }, news: b === undefined ? { a } : { a, b } };
};
const none: MinorDelta = {};

export const SIEGE_ENDINGS: Record<SiegeEnding, EndingNumbers> = {
  // surrendered with the honours of war: correct, bloodless and absurd; the Ward is impressed by the form, the Syndicate loses a post and keeps its ledger
  siege_honours: row("rival", "ward", {
    memory: { gratitude: 3, resentment: 0, contempt: 2 }, relations: { "ward|rival": 2, "rival|brine": -2 }, grudge: 8,
    minors: { brine: { trust: 1 }, reapers: none, choir: none },
    rule: { ward: { trust: 3, fear: 1, grievance: 0, prosperity: 1, playerInfluence: 5, rivalInfluence: -6 }, rivalProsperity: -6, rivalGrievance: 6, rivalMil: -2 },
  }),
  // taken by storm: the post is the Society's and the Ward's bank has blood on it; the Syndicate will remember
  siege_stormed: row("rival", "ward", {
    memory: { gratitude: 1, resentment: 3, contempt: 2 }, relations: { "ward|rival": 3, "rival|brine": -3, "rival|choir": -1 }, grudge: 14,
    minors: { brine: { fear: 2 }, reapers: none, choir: { grievance: 1 } },
    rule: { ward: { trust: 1, fear: 4, grievance: 2, prosperity: 0, playerInfluence: 4, rivalInfluence: -8 }, rivalProsperity: -8, rivalGrievance: 12, rivalMil: -6 },
  }),
  // bought as a going concern: the Committee has its siege and the Syndicate has its price; the Ward has noted what a siege costs
  siege_bought: row("rival", undefined, {
    memory: { gratitude: 0, resentment: 0, contempt: 12 }, relations: { "ward|rival": -1, "rival|choir": 2 }, grudge: -4,
    minors: { brine: { trust: -1 }, reapers: none, choir: none },
    rule: { ward: { trust: -1, fear: 0, grievance: 1, prosperity: 1, playerInfluence: 1, rivalInfluence: -3 }, rivalProsperity: 6, rivalGrievance: -4 },
  }),
  // the relief got through: the siege is lifted, the post stands, and the Ward has seen the Society besiege a tent and lose
  siege_lifted: row("rival", "ward", {
    memory: { gratitude: 0, resentment: 0, contempt: 10 }, relations: { "ward|rival": -2, "rival|brine": 2 }, grudge: -6,
    minors: { brine: none, reapers: { trust: -1 }, choir: none },
    rule: { ward: { trust: -2, fear: 0, grievance: 0, prosperity: 0, playerInfluence: -4, rivalInfluence: 6 }, rivalProsperity: 4, rivalGrievance: 2 },
  }),
};

/** The complications the siege may be dealt (existing `ComplicationId`s only; the chaos director spreads this into `COMPLICATION_POOL`): a bigger relief, a late launch, full water butts. */
export const SIEGE_COMPLICATIONS: Record<"counting_house", readonly ComplicationId[]> = {
  counting_house: ["reinforcements", "fog", "rain"],
};
