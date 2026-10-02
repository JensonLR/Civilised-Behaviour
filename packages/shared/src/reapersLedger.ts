import type { CampaignState, ComplicationId, ScenarioTemplateId } from "./campaignTypes.ts";
import type { PowerId } from "./worldTypes.ts";
import { neutralNumbers, type EndingNumbers, type FavourExtra, type MinorDelta, type ReapersEnding } from "./regionEndings.ts";

/**
 * The Reapers' Strike's ledger NUMBERS (D-042, Highmark's second contract; docs/_notes/reapers.md). The home power is the Thornfield Reapers (`reapers`), whose Compact has laid down its scythes over
 * a royal bushel a third too large; the Syndicate (`rival`) holds the Crown's grain contract and a barge of strike-breakers; the Brine Houses (`brine`) buy the barley at the delta, or sell the imports
 * when it rots; the Guild (`choir`) mourns whatever is lost, at a rate. Like the chair, the strike leaves the crossing, the toll and the bridge alone (`toll: "keep"`, no `need`): the Lamp-Warden hears
 * of it late, in her memory. The story of each ending is carried by `rival|reapers`, `brine|reapers` and the Reapers' own mood.
 */
const row = (a: PowerId, b: PowerId | undefined, o: Omit<EndingNumbers, "news" | "rule"> & { rule?: Partial<EndingNumbers["rule"]> }): EndingNumbers => {
  const base = neutralNumbers(a, b);
  return { ...base, ...o, rule: { ...base.rule, ...o.rule }, news: b === undefined ? { a } : { a, b } };
};
const none: MinorDelta = {};

export const REAPERS_ENDINGS: Record<ReapersEnding, EndingNumbers> = {
  // the fraud proven, an honest bushel decreed and the Compact back at the old rate: the Reapers' standing rises, the Syndicate's contract shrinks
  honest_measure: row("reapers", "rival", {
    memory: { gratitude: 4, resentment: 0, contempt: 2 }, relations: { "rival|reapers": -6, "brine|reapers": 3, "ward|reapers": 3, "reapers|choir": 2 }, grudge: 6,
    minors: { reapers: { trust: 10, grievance: -8, playerInfluence: 6, prosperity: 4 }, brine: { trust: 1 }, choir: none },
    rule: { rivalProsperity: -6, rivalGrievance: 6 },
  }),
  // a bonus out of the party's purse: work resumes, nothing is reformed, and everybody knows the price of a harvest now
  bought_back: row("reapers", undefined, {
    memory: { gratitude: 2, resentment: 0, contempt: 6 }, relations: { "rival|reapers": -2, "brine|reapers": 2, "reapers|choir": -2 }, grudge: 2,
    minors: { reapers: { trust: 4, grievance: 2, playerInfluence: 3, prosperity: 3 }, brine: none, choir: none },
    rule: { rivalProsperity: -2 },
  }),
  // the strike-breakers reached the barley: the Syndicate's labour cuts the Crown's grain, and the Reapers will remember who stood and watched
  strike_broken: row("reapers", "rival", {
    memory: { gratitude: 0, resentment: 2, contempt: 10 }, relations: { "rival|reapers": -10, "ward|reapers": -2, "brine|reapers": -3, "rival|brine": 2 }, grudge: -4,
    minors: { reapers: { trust: -8, grievance: 12, fear: 5, prosperity: -6, rivalInfluence: 6, playerInfluence: -4 }, brine: { prosperity: 2 }, choir: none },
    rule: { rivalProsperity: 8, rivalGrievance: -4 },
  }),
  // the rain came with the Compact still out: nobody wins, grain prices rise, the Houses sell the Syndicate's imports and the Guild sings for the barley
  barley_lost: row("reapers", "brine", {
    memory: { gratitude: 0, resentment: 0, contempt: 12 }, relations: { "brine|reapers": -4, "rival|brine": 3, "reapers|choir": 3, "rival|reapers": -3 }, grudge: 0,
    minors: { reapers: { trust: -2, grievance: 6, prosperity: -10 }, brine: { prosperity: 4 }, choir: { prosperity: 2 } },
    rule: { rivalProsperity: 4 },
  }),
};

/** The Reapers' pledged favour ("Bring a Hand Home") is also satisfied by an honest bushel: every hand in the Compact comes home on the old rate. */
export const REAPERS_FAVOUR: FavourExtra = { reapers: ["honest_measure"] };

/**
 * Which of Highmark's two contracts the campaign offers next (called by `pickTemplate(c, "highmark", ...)`; pure and deterministic). The first visit is the chair (the contract every Highmark save
 * before D-042 was offered, so an old campaign's first trip is the one it would have had); after that the region alternates, so a party that keeps coming back sees both and never the same twice
 * running. Kessar's weights are untouched (backcompat.test.ts hashes them).
 */
export function pickHighmarkContract(c: CampaignState): ScenarioTemplateId {
  let last: ScenarioTemplateId | undefined;
  for (const h of c.history) if (h.region === "highmark") last = h.template;
  return last === "succession_dispute" ? "reapers_strike" : "succession_dispute";
}

/** The complications the strike may be dealt (existing `ComplicationId`s only; the chaos director spreads this into `COMPLICATION_POOL`): rain brings the rain forward, outriders the strike-breakers' barge, fog delays both. */
export const REAPERS_COMPLICATIONS: Record<"reapers_strike", readonly ComplicationId[]> = {
  reapers_strike: ["rain", "outriders", "fog"],
};
