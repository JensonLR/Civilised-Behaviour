import type { ComplicationId } from "./campaignTypes.ts";
import type { PowerId } from "./worldTypes.ts";
import { neutralNumbers, type EndingNumbers, type FavourExtra, type HuntEnding, type MinorDelta } from "./regionEndings.ts";

/**
 * The Great Grey's ledger NUMBERS (D-094, Highmark's third contract: the GDD's hunt). The home power is the Thornfield Reapers (`reapers`), whose barley the herds' old sire is eating and
 * whose drovers count him the luck of the herds; the Syndicate (`rival`) keeps a menagerie agent with a pen by the river; the Brine Houses (`brine`) buy the barley; the Guild (`choir`) mourns
 * whatever is lost. Like the chair and the strike, the hunt leaves the crossing, the toll and the bridge alone (`toll: "keep"`, no `need`): the Lamp-Warden hears of it late. The story of
 * each ending is carried by `rival|reapers` and the Reapers' own mood.
 */
const row = (a: PowerId, b: PowerId | undefined, o: Omit<EndingNumbers, "news" | "rule"> & { rule?: Partial<EndingNumbers["rule"]> }): EndingNumbers => {
  const base = neutralNumbers(a, b);
  return { ...base, ...o, rule: { ...base.rule, ...o.rule }, news: b === undefined ? { a } : { a, b } };
};
const none: MinorDelta = {};

export const HUNT_ENDINGS: Record<HuntEnding, EndingNumbers> = {
  // shot for the Club: the barley is saved and the herds' luck is on a wall in London; the drovers will not forget it, the Syndicate's agent goes home with an empty pen
  grey_trophy: row("reapers", "rival", {
    memory: { gratitude: 2, resentment: 2, contempt: 8 }, relations: { "rival|reapers": 2, "reapers|choir": 3, "brine|reapers": 1 }, grudge: 2,
    minors: { reapers: { trust: -5, grievance: 7, prosperity: 2, playerInfluence: 2 }, brine: none, choir: { prosperity: 2 } },
    rule: { rivalGrievance: 2 },
  }),
  // driven home to his herd, alive: the barley saved and the herds' luck kept; the Reapers' standing in the Society rises, the Committee sulks in its minutes
  grey_driven: row("reapers", undefined, {
    memory: { gratitude: 6, resentment: 0, contempt: 2 }, relations: { "brine|reapers": 3, "ward|reapers": 2, "rival|reapers": -1 }, grudge: 1,
    minors: { reapers: { trust: 9, grievance: -5, playerInfluence: 6, prosperity: 3 }, brine: { trust: 1 }, choir: none },
    rule: { rivalGrievance: 1 },
  }),
  // sold to the Syndicate's menagerie: the barley saved, the luck of the herds in a cage on a barge, the Syndicate a curiosity the richer
  grey_sold: row("reapers", "rival", {
    memory: { gratitude: 0, resentment: 3, contempt: 12 }, relations: { "rival|reapers": -6, "ward|reapers": -2, "rival|brine": 2 }, grudge: -4,
    minors: { reapers: { trust: -6, grievance: 9, playerInfluence: -3, rivalInfluence: 4 }, brine: none, choir: none },
    rule: { rivalProsperity: 3, rivalGrievance: -3 },
  }),
  // gone back to the high pasture: the barley half eaten, nothing won, nothing lost but face
  grey_escaped: row("reapers", "brine", {
    memory: { gratitude: 0, resentment: 0, contempt: 11 }, relations: { "brine|reapers": -2, "reapers|choir": 1, "rival|brine": 1 }, grudge: -1,
    minors: { reapers: { trust: -1, grievance: 2, prosperity: -4 }, brine: { prosperity: 2 }, choir: none },
    rule: { rivalProsperity: 1 },
  }),
};

/** The Reapers' pledged favour ("Bring a Hand Home") is also satisfied by the herds' sire brought home alive. */
export const HUNT_FAVOUR: FavourExtra = { reapers: ["grey_driven"] };

/** The complications the hunt may be dealt (existing `ComplicationId`s only; the chaos director spreads this into `COMPLICATION_POOL`): rain brings the harvest bell forward, fog hides the beast. */
export const HUNT_COMPLICATIONS: Record<"great_grey", readonly ComplicationId[]> = {
  great_grey: ["rain", "fog"],
};
