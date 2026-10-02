import type { PowerId } from "./worldTypes.ts";
import { neutralNumbers, type EndingNumbers, type EngineEnding, type FavourExtra, type MinorDelta } from "./regionEndings.ts";

/**
 * The Winding Engine's ledger NUMBERS (D-044, Vesper Gorge's third contract, the sabotage). The Syndicate (`rival`) has leased the Lower Gallery Company's winding engine and is driving a cross-cut
 * at the vein; the Guild (`choir`), the gorge's home power, bills for whatever the afternoon comes to; the Brine Houses (`brine`) ship the ore if anybody strikes it. Like every contract away from
 * Kessar it leaves the crossing, the toll and the bridge alone. The story of each ending is carried by `rival|choir`, `rival|brine` and the Syndicate's grudge.
 */
const row = (a: PowerId, b: PowerId | undefined, o: Omit<EndingNumbers, "news" | "rule"> & { rule?: Partial<EndingNumbers["rule"]> }): EndingNumbers => {
  const base = neutralNumbers(a, b);
  return { ...base, ...o, rule: { ...base.rule, ...o.rule }, news: b === undefined ? { a } : { a, b } };
};
const none: MinorDelta = {};

export const ENGINE_ENDINGS: Record<EngineEnding, EndingNumbers> = {
  // grit in the boiler, unseen: the engine seizes, the Syndicate blames the Company, and the Guild has nobody to bury
  engine_fouled: row("rival", "choir", {
    memory: { gratitude: 3, resentment: 0, contempt: 4 }, relations: { "rival|choir": -3, "rival|brine": -2, "brine|choir": 1 }, grudge: 4,
    minors: { choir: { trust: 2 }, brine: { prosperity: 1 }, reapers: none },
    rule: { rivalProsperity: -6, rivalGrievance: 4 },
  }),
  // the Company's own powder under the boiler: the loudest afternoon in the gorge, and the Guild bills for it
  engine_blown: row("rival", "choir", {
    memory: { gratitude: 0, resentment: 3, contempt: 8 }, relations: { "rival|choir": -6, "ward|rival": 2, "rival|brine": -3, "brine|choir": -2 }, grudge: 12,
    minors: { choir: { prosperity: 5, trust: 1 }, brine: none, reapers: none },
    rule: { rivalProsperity: -10, rivalGrievance: 10, rivalMil: -6 },
  }),
  // the Syndicate's own engineer, paid, finds a fault in his own engine: nobody is hurt and nobody is fooled except the Syndicate
  engine_bought: row("rival", undefined, {
    memory: { gratitude: 0, resentment: 0, contempt: 10 }, relations: { "rival|choir": 2, "rival|brine": 2, "ward|rival": -1 }, grudge: -2,
    minors: { choir: none, brine: { trust: -1 }, reapers: none },
    rule: { rivalProsperity: -3 },
  }),
  // the cross-cut broke through: the Syndicate strikes the vein, files at the Assay House and ships through the Houses
  vein_struck: row("rival", "brine", {
    memory: { gratitude: 0, resentment: 2, contempt: 12 }, relations: { "rival|brine": 5, "rival|choir": 3, "ward|rival": -2 }, grudge: -4,
    minors: { choir: { prosperity: -2, rivalInfluence: 5 }, brine: { prosperity: 3, rivalInfluence: 3 }, reapers: none },
    rule: { rivalProsperity: 10, rivalGrievance: -4 },
  }),
};

/** The Guild's pledged favour ("A Respectable Season of Mourning") is also satisfied by a blown engine: the Guild attends all outcomes, and bills the loud ones. */
export const ENGINE_FAVOUR: FavourExtra = { choir: ["engine_blown"] };
