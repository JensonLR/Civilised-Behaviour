import type { ComplicationId } from "./campaignTypes.ts";
import type { EndingNumbers, FavourExtra, TrigEnding } from "./regionEndings.ts";

/**
 * The Triangulation's ledger NUMBERS (D-096, Vesper Gorge's fourth contract: the GDD's survey). The home power is the Low Vesper Lamentation Guild (`choir`), whose names the needles already
 * have; the Syndicate (`rival`) is surveying the gorge for a railway; the Houses (`brine`) would carry its ore. Like Vesper's other contracts, the crossing, the toll and the bridge are untouched
 * (`toll: "keep"`, no `need`). The story of each ending is carried by `rival|choir` and the Guild's own mood.
 */
const NO_WARD = { trust: 0, fear: 0, grievance: 0, prosperity: 0, playerInfluence: 0, rivalInfluence: 0 };
const row = (e: Omit<EndingNumbers, "rule"> & { rule: { ward?: Partial<typeof NO_WARD>; lies?: number; rivalProsperity?: number; rivalGrievance?: number } }): EndingNumbers => ({
  ...e,
  rule: { control: undefined, toll: "keep", ward: { ...NO_WARD, ...e.rule.ward }, lies: e.rule.lies ?? 0, rivalProsperity: e.rule.rivalProsperity ?? 0, rivalGrievance: e.rule.rivalGrievance ?? 0 },
});

export const TRIG_ENDINGS: Record<TrigEnding, EndingNumbers> = {
  // the Guild's names on the Society's chart, for the Guild's fee: the Guild is civil for once, the Committee is not, the Syndicate's railway waits
  trig_guild: row({
    rule: { ward: { playerInfluence: 1 }, rivalProsperity: -2, rivalGrievance: 2 },
    memory: { gratitude: 3, resentment: 0, contempt: 2 },
    relations: { "ward|choir": 2, "rival|choir": -2, "brine|choir": 1 },
    grudge: 2,
    minors: { brine: {}, reapers: {}, choir: { trust: 8, grievance: -4, playerInfluence: 5, prosperity: 3 } },
    news: { a: "choir", b: "rival" },
  }),
  // the Committee's names: Mount Fothergill-Pym and six more; the Guild writes each one down, and a sum against it
  trig_committee: row({
    rule: { ward: { playerInfluence: 1 }, rivalProsperity: -2, rivalGrievance: 3 },
    memory: { gratitude: 0, resentment: 4, contempt: 6 },
    relations: { "ward|choir": -1, "rival|choir": 2, "reapers|choir": -1 },
    grudge: 3,
    minors: { brine: {}, reapers: { trust: -1 }, choir: { trust: -6, grievance: 8, prosperity: 2, playerInfluence: 1 } },
    news: { a: "choir", b: "rival" },
  }),
  // sold to the Syndicate for its railway: the Society's arithmetic under the Syndicate's rails, the Houses' ore on them
  trig_sold: row({
    rule: { rivalProsperity: 6, rivalGrievance: -3 },
    memory: { gratitude: 0, resentment: 0, contempt: 8 },
    relations: { "rival|choir": -2, "rival|brine": 3, "ward|rival": 1 },
    grudge: -6,
    minors: { brine: { prosperity: 2 }, reapers: {}, choir: { trust: -2, grievance: 4, rivalInfluence: 4 } },
    news: { a: "choir", b: "rival" },
  }),
  // outsurveyed: the Syndicate's survey is in London first; the gorge is a railway on paper
  trig_outsurveyed: row({
    rule: { rivalProsperity: 4 },
    memory: { gratitude: 0, resentment: 0, contempt: 9 },
    relations: { "rival|choir": 2, "ward|rival": 2 },
    grudge: -4,
    minors: { brine: {}, reapers: {}, choir: { rivalInfluence: 3 } },
    news: { a: "choir", b: "rival" },
  }),
};

/** The Guild's pledged favour is also satisfied by its own names on the Society's chart. */
export const TRIG_FAVOUR: FavourExtra = { choir: ["trig_guild"] };

/** The complications the survey may be dealt (existing `ComplicationId`s only; spread into `COMPLICATION_POOL`): fog and rain slow every round of angles; a rival bid hurries the Syndicate. */
export const TRIG_COMPLICATIONS: Record<"triangulation", readonly ComplicationId[]> = {
  triangulation: ["fog", "rain", "rival_bid"],
};
