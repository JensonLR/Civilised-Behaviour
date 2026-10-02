import type { PowerId } from "./worldTypes.ts";
import { neutralNumbers, type EndingNumbers, type MinorDelta, type RaidEnding } from "./regionEndings.ts";

/**
 * The Raid on the Post's ledger NUMBERS (D-045, Kessar's fifth contract: the GDD's outpost defence). The Syndicate (`rival`) has sent a raiding party with torches against the Society's outpost
 * on the south bank; the Ward (`ward`), whose bank it is, watches from the fort and keeps score. The crossing, the toll and the bridge are untouched (`toll: "keep"`): this is the outpost's
 * business, and the outpost's own numbers move in the settlements pipeline (WorldRoom.commitOutcome: a burned post is raided, a held one stands firmer).
 */
const row = (a: PowerId, b: PowerId | undefined, o: Omit<EndingNumbers, "news" | "rule"> & { rule?: Partial<EndingNumbers["rule"]> }): EndingNumbers => {
  const base = neutralNumbers(a, b);
  return { ...base, ...o, rule: { ...base.rule, ...o.rule }, news: b === undefined ? { a } : { a, b } };
};
const none: MinorDelta = {};

export const RAID_ENDINGS: Record<RaidEnding, EndingNumbers> = {
  // the raiders broken in the yard: the Ward respects a post that defends itself, the Syndicate counts its burns
  post_held: row("rival", "ward", {
    memory: { gratitude: 4, resentment: 0, contempt: 0 }, relations: { "ward|rival": 3, "rival|brine": -2 }, grudge: 10,
    minors: { brine: { trust: 2 }, reapers: { trust: 2 }, choir: none },
    rule: { ward: { trust: 4, fear: 2, grievance: 0, prosperity: 2, playerInfluence: 5, rivalInfluence: -4 }, rivalProsperity: -4, rivalGrievance: 8, rivalMil: -6 },
  }),
  // the stores torched: the raid lands, the Ward notes that the Society cannot keep its own yard
  post_burned: row("rival", "ward", {
    memory: { gratitude: 0, resentment: 0, contempt: 10 }, relations: { "ward|rival": -2, "rival|brine": 2 }, grudge: -6,
    minors: { brine: { trust: -2 }, reapers: none, choir: { prosperity: 2 } },
    rule: { ward: { trust: -2, fear: 0, grievance: 0, prosperity: -2, playerInfluence: -5, rivalInfluence: 6 }, rivalProsperity: 4 },
  }),
  // protection money: nobody is hurt, the post stands, and the Syndicate has a new line of business
  protection_paid: row("rival", undefined, {
    memory: { gratitude: 0, resentment: 0, contempt: 14 }, relations: { "ward|rival": -3, "rival|choir": 2 }, grudge: -10,
    minors: { brine: { trust: -1 }, reapers: { trust: -1 }, choir: none },
    rule: { ward: { trust: -3, fear: 0, grievance: 2, prosperity: 0, playerInfluence: -3, rivalInfluence: 8 }, rivalProsperity: 8, rivalGrievance: -6 },
  }),
};
